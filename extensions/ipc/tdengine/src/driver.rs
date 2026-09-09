//! TDengine 驱动接入共享运行时([`extension_driver`] 的 Tokio-first 路径)。
//!
//! - [`TdengineDriver`] 是控制面/工厂:`init` / `conn/open` / connless 纯方法
//!   (`conn/test`、`ddl/build*`)。
//! - [`TdengineConnection`] 是每连接执行体,独占一个 [`TdSession`] 与该连接的
//!   游标状态;并发/取消/写回串行化全部由 `serve_async` 运行时承担。
//!
//! 业务逻辑复用 [`crate::handlers`],这里只做工厂 + 路由。

// ProtocolError 是 wire 契约类型,Err 类型大小固定,统一 allow。
#![allow(clippy::result_large_err)]

use std::sync::atomic::{AtomicI64, Ordering};

use async_trait::async_trait;
use extension_driver::{AsyncDriverConnection, AsyncNativeDriver, AsyncOpenedConnection};
use extension_protocol::conn::ConnOpenParams;
use extension_protocol::error::{ProtocolError, error_codes};
use extension_protocol::lifecycle::{Capability, InitParams, InitResult};
use extension_protocol::method;
use serde_json::Value;

use crate::handlers;
use crate::protocol::TdConnectionConfig;
use crate::server::{invalid_params, params_deserialize_error, protocol_error_from_anyhow};
use crate::state::ConnectionState;
use crate::tdengine_session::TdSession;

/// 驱动要求的最低宿主版本(与 driver.json engines.onetcli 一致)。
const MINIMUM_HOST_VERSION: &str = "0.10.0";

/// TDengine 驱动控制面。init 握手用 once-flag 防重入。
pub struct TdengineDriver {
    initialized: AtomicI64,
}

impl TdengineDriver {
    pub fn new() -> Self {
        Self {
            initialized: AtomicI64::new(0),
        }
    }
}

impl Default for TdengineDriver {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl AsyncNativeDriver for TdengineDriver {
    /// `init` 握手:校验宿主版本,声明 features / methods / driver id。
    async fn init(&self, params: &Value) -> Result<Value, ProtocolError> {
        let params: InitParams =
            serde_json::from_value(params.clone()).map_err(params_deserialize_error)?;
        ensure_compatible_host(&params.host_version)?;

        if self
            .initialized
            .compare_exchange(0, 1, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err(ProtocolError::new(
                error_codes::ALREADY_INITIALIZED,
                "driver already initialized",
            ));
        }

        let mut result = InitResult::new(env!("CARGO_PKG_VERSION"))
            .with_api("database", "1.0")
            .with_feature(Capability::RICH_ERRORS)
            .with_feature(Capability::DDL_BUILDER)
            .with_feature(Capability::BATCH_EXEC)
            .with_feature(Capability::SCHEMA_INTROSPECTION)
            .with_driver("tdengine");
        for method_name in declared_methods() {
            result = result.with_method(*method_name);
        }
        serde_json::to_value(result).map_err(params_deserialize_error)
    }

    /// `conn/open`:建 DSN 连接并完成 SERVER_STATUS 握手。
    async fn open_connection(
        &self,
        params: &Value,
    ) -> Result<AsyncOpenedConnection, ProtocolError> {
        let p: ConnOpenParams =
            serde_json::from_value(params.clone()).map_err(params_deserialize_error)?;
        handlers::ensure_tdengine_driver(&p.driver_id)?;
        let config = TdConnectionConfig::from_config_value(&p.config)
            .map_err(|e| invalid_params(format!("invalid connection config: {e}")))?;

        let session = TdSession::connect(&config)
            .await
            .map_err(|e| protocol_error_from_anyhow(error_codes::IO_CONNECTION_REFUSED, e))?;
        let server_version = session
            .server_version()
            .await
            .map_err(|e| protocol_error_from_anyhow(error_codes::SERVER_CLOSED_CONNECTION, e))?;

        // conn_id 由本进程统一分配(简单自增),保证跨连接全局唯一。
        static NEXT_CONN_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
        let conn_id = NEXT_CONN_ID.fetch_add(1, Ordering::SeqCst);
        let open_result = serde_json::json!({
            "conn_id": conn_id,
            "server_info": {
                "version": server_version,
                "features": ["timeseries", "websocket"],
            }
        });

        Ok(AsyncOpenedConnection {
            conn_id,
            open_result,
            connection: Box::new(TdengineConnection {
                session,
                state: ConnectionState::new(),
            }),
        })
    }

    /// 不依赖连接的纯方法(conn/test、ddl/build*)。
    async fn call_connless(
        &self,
        method_name: &str,
        params: &Value,
    ) -> Result<Value, ProtocolError> {
        match method_name {
            method::CONN_TEST => handlers::handle_conn_test(params).await,
            method::DDL_BUILD => handlers::handle_ddl_build(params),
            method::DDL_BUILD_CREATE_TABLE => handlers::handle_ddl_build_create_table(params),
            method::DDL_BUILD_ALTER_TABLE => handlers::handle_ddl_build_alter_table(params),
            method::DDL_BUILD_DROP => handlers::handle_ddl_build_drop(params),
            other => Err(method_not_found(other)),
        }
    }
}

/// 单个 TDengine 连接的执行体。
pub struct TdengineConnection {
    session: TdSession,
    state: ConnectionState,
}

#[async_trait]
impl AsyncDriverConnection for TdengineConnection {
    async fn call(&mut self, method_name: &str, params: &Value) -> Result<Value, ProtocolError> {
        match method_name {
            method::CONN_PING => handlers::handle_conn_ping(&self.session, params).await,
            method::CONN_USE => handlers::handle_conn_use(&self.session, params).await,
            method::QUERY_START => {
                handlers::handle_query_start(&self.session, &mut self.state, params).await
            }
            method::CURSOR_FETCH => handlers::handle_cursor_fetch(&mut self.state, params).await,
            method::CURSOR_CLOSE => handlers::handle_cursor_close(&mut self.state, params).await,
            method::CURSOR_CANCEL => handlers::handle_cursor_cancel(&mut self.state, params).await,
            method::EXEC_RUN => handlers::handle_exec_run(&self.session, params).await,
            method::EXEC_BATCH => handlers::handle_exec_batch(&self.session, params).await,
            method::SCHEMA_DATABASES => {
                handlers::handle_schema_databases(&self.session, params).await
            }
            method::SCHEMA_OBJECTS => handlers::handle_schema_objects(&self.session, params).await,
            method::SCHEMA_COLUMNS => handlers::handle_schema_columns(&self.session, params).await,
            method::SCHEMA_VIEWS => handlers::handle_schema_views(&self.session, params).await,
            method::SCHEMA_OBJECT_VIEW => {
                handlers::handle_schema_object_view(&self.session, params).await
            }
            // ddl/build* 是纯方法,但宿主可能带 conn_id 路由到这里——一并接受。
            method::DDL_BUILD => handlers::handle_ddl_build(params),
            method::DDL_BUILD_CREATE_TABLE => handlers::handle_ddl_build_create_table(params),
            method::DDL_BUILD_ALTER_TABLE => handlers::handle_ddl_build_alter_table(params),
            method::DDL_BUILD_DROP => handlers::handle_ddl_build_drop(params),
            other => Err(method_not_found(other)),
        }
    }

    async fn close(&mut self) {
        // WebSocket 会话随 TdSession drop 关闭,无需额外清理;游标状态一并丢弃。
        self.state = ConnectionState::new();
    }
}

fn ensure_compatible_host(host_version: &str) -> Result<(), ProtocolError> {
    let current = semver::Version::parse(host_version).map_err(|error| {
        ProtocolError::new(
            error_codes::SERVER_INCOMPATIBLE,
            format!(
                "this driver requires Navop >= {MINIMUM_HOST_VERSION}; invalid host version {host_version:?}: {error}"
            ),
        )
    })?;
    let requirement = semver::VersionReq::parse(&format!(">={MINIMUM_HOST_VERSION}"))
        .expect("valid minimum host requirement");
    if !requirement.matches(&current) {
        return Err(ProtocolError::new(
            error_codes::SERVER_INCOMPATIBLE,
            format!(
                "this driver requires Navop >= {MINIMUM_HOST_VERSION}; current host version is {current}. Please upgrade Navop"
            ),
        ));
    }
    Ok(())
}

/// init 声明的方法全集(与 driver.json methods 一致)。
pub fn declared_methods() -> &'static [&'static str] {
    &[
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
    ]
}

fn method_not_found(method_name: &str) -> ProtocolError {
    ProtocolError::new(
        error_codes::METHOD_NOT_FOUND,
        format!("method `{method_name}` is not implemented in TDengine driver"),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn declared_methods_cover_driver_json_set() {
        let methods = declared_methods();
        assert!(methods.contains(&method::CONN_TEST));
        assert!(methods.contains(&method::SCHEMA_DATABASES));
        assert!(methods.contains(&method::SCHEMA_OBJECT_VIEW));
        assert!(methods.contains(&method::DDL_BUILD));
        // TDengine 未声明的能力不应出现。
        assert!(!methods.contains(&method::TX_BEGIN));
        assert!(!methods.contains(&method::SCHEMA_SCHEMAS));
        assert!(!methods.contains(&method::DATA_EXPORT));
    }

    #[tokio::test]
    async fn init_rejects_incompatible_host_without_consuming_once_flag() {
        let driver = TdengineDriver::new();
        for host_version in ["0.9.9", "0.10.0-alpha", "invalid"] {
            let err = driver
                .init(&serde_json::json!({
                    "host_version": host_version,
                    "api_offered": {},
                    "instance_id": "test",
                    "config": {},
                }))
                .await
                .unwrap_err();
            assert_eq!(err.code, error_codes::SERVER_INCOMPATIBLE);
            assert_eq!(driver.initialized.load(Ordering::SeqCst), 0);
        }

        driver
            .init(&serde_json::json!({
                "host_version": "0.10.1",
                "api_offered": {},
                "instance_id": "test",
                "config": {},
            }))
            .await
            .unwrap();
        assert_eq!(driver.initialized.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn init_twice_returns_already_initialized() {
        let driver = TdengineDriver::new();
        let params = serde_json::json!({
            "host_version": "1.0.0",
            "api_offered": {},
            "instance_id": "test",
            "config": {},
        });
        driver.init(&params).await.unwrap();
        let err = driver.init(&params).await.unwrap_err();
        assert_eq!(err.code, error_codes::ALREADY_INITIALIZED);
    }

    #[tokio::test]
    async fn init_declares_tdengine_features_and_methods() {
        let driver = TdengineDriver::new();
        let result = driver
            .init(&serde_json::json!({
                "host_version": "1.0.0",
                "api_offered": { "database": "1.0" },
                "instance_id": "test",
                "config": {},
            }))
            .await
            .unwrap();
        assert!(
            result["features"]
                .as_array()
                .unwrap()
                .iter()
                .any(|f| f == "ddl_builder")
        );
        assert!(
            result["features"]
                .as_array()
                .unwrap()
                .iter()
                .any(|f| f == "batch_exec")
        );
        assert!(
            !result["features"]
                .as_array()
                .unwrap()
                .iter()
                .any(|f| f == "transactions")
        );
        assert!(
            result["drivers_ready"]
                .as_array()
                .unwrap()
                .iter()
                .any(|d| d == "tdengine")
        );
        assert!(
            result["methods"]
                .as_array()
                .unwrap()
                .iter()
                .any(|m| m == "schema/object_view")
        );
    }
}
