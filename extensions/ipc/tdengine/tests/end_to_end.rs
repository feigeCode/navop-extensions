//! TDengine IPC 驱动的端到端测试(不依赖真实 TDengine 服务端)。
//!
//! 仿 duckdb 的 tests/extension_protocol.rs:用 `tokio::io::duplex` 内存 transport
//! 拉起驱动 server(`tdengine_driver::server::handle_stream`),再以
//! `extension-host` 的 JsonRpcClient 走完整 wire 协议:
//! - init 握手与 methods/features 声明;
//! - `$/ping`、重复 init、未 init 先调方法等协议行为;
//! - `conn/test` / `conn/open` 的失败路径(连接不可达端口);
//! - `ddl/build*` 纯方法在无连接状态下可用。

use std::time::Duration;

use extension_host::{FramedTransport, HostError, JsonRpcClient, RequestOptions};
use extension_protocol::conn::ConnOpenParams;
use extension_protocol::error::error_codes;
use extension_protocol::lifecycle::{Capability, InitParams, InitResult};
use extension_protocol::method;
use serde_json::{Value, json};

/// 与 driver.json `methods` / `src/driver.rs::declared_methods` 保持一致的全集。
const DECLARED_METHODS: &[&str] = &[
    method::PING,
    method::SHUTDOWN,
    method::CONN_TEST,
    method::CONN_OPEN,
    method::CONN_CLOSE,
    method::CONN_PING,
    method::CONN_USE,
    method::QUERY_START,
    method::CURSOR_FETCH,
    method::CURSOR_CLOSE,
    method::CURSOR_CANCEL,
    method::EXEC_RUN,
    method::EXEC_BATCH,
    method::SCHEMA_OBJECT_VIEW,
    method::SCHEMA_DATABASES,
    method::SCHEMA_OBJECTS,
    method::SCHEMA_COLUMNS,
    method::SCHEMA_VIEWS,
    method::DDL_BUILD,
    method::DDL_BUILD_CREATE_TABLE,
    method::DDL_BUILD_ALTER_TABLE,
    method::DDL_BUILD_DROP,
];

/// 拉起内存 transport 的驱动 server,返回 (client owner, handle, server task)。
async fn start_driver() -> (
    JsonRpcClient,
    JsonRpcClientHandle,
    tokio::task::JoinHandle<anyhow::Result<()>>,
) {
    let (client_stream, server_stream) = tokio::io::duplex(1024 * 1024);
    let (server_reader, server_writer) = tokio::io::split(server_stream);
    let server = tokio::spawn(async move {
        tdengine_driver::server::handle_stream(server_reader, server_writer).await
    });
    let (reader, writer) = tokio::io::split(client_stream);
    let client = JsonRpcClient::start(FramedTransport::new(reader, writer));
    let handle = client.handle();
    (client, handle, server)
}

/// extension-host 的客户端句柄别名(便于测试内传递)。
type JsonRpcClientHandle = extension_host::JsonRpcClientHandle;

/// 不可达的连接目标:127.0.0.1 的 tcpmux 保留端口,本地必然连接拒绝。
fn unreachable_config() -> Value {
    json!({
        "host": "127.0.0.1",
        "port": 1,
        "username": "root",
        "password": "taosdata",
        "connect_timeout": 3,
    })
}

async fn init(handle: &JsonRpcClientHandle, timeout: &RequestOptions) -> InitResult {
    handle
        .call(
            method::INIT,
            serde_json::to_value(InitParams::new("0.10.0", "tdengine-e2e")).unwrap(),
            timeout.clone(),
        )
        .await
        .expect("init should succeed")
}

#[tokio::test]
async fn tdengine_driver_declares_full_method_set() {
    let (client, handle, server) = start_driver().await;
    let timeout = RequestOptions::default().with_timeout(Duration::from_secs(5));

    let ping: Value = handle
        .call(method::PING, json!({}), timeout.clone())
        .await
        .expect("$/ping should answer before init");
    assert_eq!(Some(true), ping["pong"].as_bool());

    let init = init(&handle, &timeout).await;
    assert_eq!(init.extension_version, env!("CARGO_PKG_VERSION"));
    assert!(init.has_feature(Capability::RICH_ERRORS));
    assert!(init.has_feature(Capability::DDL_BUILDER));
    assert!(init.has_feature(Capability::BATCH_EXEC));
    assert!(init.has_feature(Capability::SCHEMA_INTROSPECTION));
    // TDengine 经典模型不支持事务,不应声明。
    assert!(!init.has_feature(Capability::TRANSACTIONS));
    assert!(init.drivers_ready.iter().any(|d| d == "tdengine"));
    for method_name in DECLARED_METHODS {
        assert!(
            init.declares_method(method_name),
            "init result should declare {method_name}"
        );
    }

    client_shutdown(client, server).await;
}

#[tokio::test]
async fn method_calls_before_init_are_rejected() {
    let (client, handle, server) = start_driver().await;
    let timeout = RequestOptions::default().with_timeout(Duration::from_secs(5));

    let err = handle
        .call_raw(
            method::CONN_TEST,
            json!({ "driver_id": "tdengine", "config": unreachable_config() }),
            timeout.clone(),
        )
        .await
        .unwrap_err();
    assert!(
        matches!(
            &err,
            HostError::Protocol(pe) if pe.code == error_codes::NOT_INITIALIZED
        ),
        "expected NOT_INITIALIZED before init, got {err:?}"
    );

    let _ = init(&handle, &timeout).await;
    // init 之后重复 init → ALREADY_INITIALIZED。
    let err = handle
        .call_raw(
            method::INIT,
            serde_json::to_value(InitParams::new("0.10.0", "tdengine-e2e-2")).unwrap(),
            timeout,
        )
        .await
        .unwrap_err();
    assert!(
        matches!(
            &err,
            HostError::Protocol(pe) if pe.code == error_codes::ALREADY_INITIALIZED
        ),
        "expected ALREADY_INITIALIZED on second init, got {err:?}"
    );

    client_shutdown(client, server).await;
}

#[tokio::test]
async fn conn_test_failure_path_reports_connection_refused() {
    let (client, handle, server) = start_driver().await;
    let timeout = RequestOptions::default().with_timeout(Duration::from_secs(15));

    let _ = init(&handle, &timeout).await;
    let err = handle
        .call_raw(
            method::CONN_TEST,
            json!({ "driver_id": "tdengine", "config": unreachable_config() }),
            timeout.clone(),
        )
        .await
        .unwrap_err();
    assert!(
        matches!(
            &err,
            HostError::Protocol(pe) if pe.code == error_codes::IO_CONNECTION_REFUSED
        ),
        "expected IO_CONNECTION_REFUSED for unreachable host, got {err:?}"
    );

    // 错误 driver_id 在连接之前即被拒绝。
    let err = handle
        .call_raw(
            method::CONN_TEST,
            json!({ "driver_id": "postgres", "config": unreachable_config() }),
            timeout,
        )
        .await
        .unwrap_err();
    assert!(
        matches!(
            &err,
            HostError::Protocol(pe) if pe.code == error_codes::INVALID_PARAMS
        ),
        "expected INVALID_PARAMS for foreign driver_id, got {err:?}"
    );

    client_shutdown(client, server).await;
}

#[tokio::test]
async fn conn_open_failure_path_reports_connection_refused() {
    let (client, handle, server) = start_driver().await;
    let timeout = RequestOptions::default().with_timeout(Duration::from_secs(15));

    let _ = init(&handle, &timeout).await;
    let err = handle
        .call_raw(
            method::CONN_OPEN,
            serde_json::to_value(ConnOpenParams::new("tdengine", unreachable_config())).unwrap(),
            timeout,
        )
        .await
        .unwrap_err();
    assert!(
        matches!(
            &err,
            HostError::Protocol(pe) if pe.code == error_codes::IO_CONNECTION_REFUSED
        ),
        "expected IO_CONNECTION_REFUSED for conn/open failure, got {err:?}"
    );

    client_shutdown_no_wait(client, server).await;
}

#[tokio::test]
async fn connless_ddl_builders_work_without_connection() {
    let (client, handle, server) = start_driver().await;
    let timeout = RequestOptions::default().with_timeout(Duration::from_secs(5));

    let _ = init(&handle, &timeout).await;

    // ddl/build:create_database → CREATE DATABASE。
    let create_db: Value = handle
        .call(
            method::DDL_BUILD,
            json!({ "op": "create_database", "payload": { "database_name": "metrics" } }),
            timeout.clone(),
        )
        .await
        .expect("ddl/build create_database should succeed");
    assert_eq!(
        create_db["statements"][0], "CREATE DATABASE `metrics`",
        "unexpected create_database statement: {create_db}"
    );

    // ddl/build:drop_database → DROP DATABASE IF EXISTS。
    let drop_db: Value = handle
        .call(
            method::DDL_BUILD,
            json!({ "op": "drop_database", "payload": { "name": "log_db" } }),
            timeout.clone(),
        )
        .await
        .expect("ddl/build drop_database should succeed");
    assert_eq!(drop_db["statements"][0], "DROP DATABASE IF EXISTS `log_db`");

    // ddl/build:rename_table → ALTER TABLE ... RENAME TO。
    let rename: Value = handle
        .call(
            method::DDL_BUILD,
            json!({ "op": "rename_table", "payload": { "database": "db1", "old_name": "t1", "new_name": "t2" } }),
            timeout.clone(),
        )
        .await
        .expect("ddl/build rename_table should succeed");
    assert_eq!(
        rename["statements"][0],
        "ALTER TABLE `db1`.`t1` RENAME TO `t2`"
    );

    // ddl/build_create_table:库限定名 + 反引号列。
    let create_table: Value = handle
        .call(
            method::DDL_BUILD_CREATE_TABLE,
            json!({
                "spec": {
                    "name": "meters",
                    "database": "power_db",
                    "columns": [
                        { "name": "ts", "type": "TIMESTAMP" },
                        { "name": "current", "type": "FLOAT" }
                    ]
                },
                "options": { "if_not_exists": true }
            }),
            timeout.clone(),
        )
        .await
        .expect("ddl/build_create_table should succeed");
    assert_eq!(
        create_table["sql"],
        "CREATE TABLE IF NOT EXISTS `power_db`.`meters` (\n  `ts` TIMESTAMP,\n  `current` FLOAT\n)"
    );

    // ddl/build_drop:表。
    let drop: Value = handle
        .call(
            method::DDL_BUILD_DROP,
            json!({
                "kind": "table",
                "name": "meters",
                "database": "power_db",
                "if_exists": true
            }),
            timeout.clone(),
        )
        .await
        .expect("ddl/build_drop should succeed");
    assert_eq!(drop["sql"], "DROP TABLE IF EXISTS `power_db`.`meters`");

    // 未知 op → INVALID_PARAMS。
    let err = handle
        .call_raw(
            method::DDL_BUILD,
            json!({ "op": "comment_schema", "payload": {} }),
            timeout.clone(),
        )
        .await
        .unwrap_err();
    assert!(
        matches!(
            &err,
            HostError::Protocol(pe) if pe.code == error_codes::INVALID_PARAMS
        ),
        "expected INVALID_PARAMS for unsupported ddl op, got {err:?}"
    );

    // 未实现的 connless 方法 → METHOD_NOT_FOUND(TDengine 未声明 sql 工具)。
    let err = handle
        .call_raw(method::SQL_FORMAT, json!({ "sql": "SELECT 1" }), timeout)
        .await
        .unwrap_err();
    assert!(
        matches!(
            &err,
            HostError::Protocol(pe) if pe.code == error_codes::METHOD_NOT_FOUND
        ),
        "expected METHOD_NOT_FOUND for sql/format, got {err:?}"
    );

    client_shutdown(client, server).await;
}

#[tokio::test]
async fn shutdown_acknowledges_and_closes_transport() {
    let (_client, handle, server) = start_driver().await;
    let timeout = RequestOptions::default().with_timeout(Duration::from_secs(5));

    let _: Value = handle
        .call(method::SHUTDOWN, json!({ "grace_ms": 100 }), timeout)
        .await
        .expect("shutdown should be acknowledged");

    // shutdown 后 server 主循环退出,transport 关闭。
    let result = server.await.expect("server task should join cleanly");
    result.expect("server should exit without error");
}

/// 关闭客户端并中止 server task。
async fn client_shutdown(
    client: JsonRpcClient,
    server: tokio::task::JoinHandle<anyhow::Result<()>>,
) {
    client.shutdown().await;
    server.abort();
}

/// 与 [`client_shutdown`] 相同(保留独立命名以区分错误路径用例)。
async fn client_shutdown_no_wait(
    client: JsonRpcClient,
    server: tokio::task::JoinHandle<anyhow::Result<()>>,
) {
    client.shutdown().await;
    server.abort();
}
