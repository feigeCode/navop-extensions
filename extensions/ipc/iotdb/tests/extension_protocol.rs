use std::collections::BTreeSet;
use std::time::Duration;

use extension_host::{FramedTransport, JsonRpcClient, RequestOptions};
use extension_protocol::lifecycle::{InitParams, InitResult};
use extension_protocol::method;
use serde_json::{Value, json};

#[tokio::test]
async fn iotdb_driver_declares_manifest_methods() {
    let (client_stream, server_stream) = tokio::io::duplex(1024 * 1024);
    let (server_reader, server_writer) = tokio::io::split(server_stream);
    let server = tokio::spawn(async move {
        iotdb_driver::server::handle_stream(server_reader, server_writer).await
    });

    let (reader, writer) = tokio::io::split(client_stream);
    let client = JsonRpcClient::start(FramedTransport::new(reader, writer));
    let handle = client.handle();
    let timeout = RequestOptions::default().with_timeout(Duration::from_secs(2));

    let ping: Value = handle
        .call(method::PING, json!({}), timeout.clone())
        .await
        .expect("$/ping should succeed");
    assert_eq!(Some(true), ping["pong"].as_bool());

    let init: InitResult = handle
        .call(
            method::INIT,
            serde_json::to_value(InitParams::new("onetcli-test", "iotdb-test")).unwrap(),
            timeout.clone(),
        )
        .await
        .expect("init should succeed");
    assert!(init.drivers_ready.iter().any(|driver| driver == "iotdb"));

    for method_name in declared_driver_methods() {
        assert!(
            init.declares_method(&method_name),
            "init result should declare {method_name}"
        );
    }

    let manifest_methods: BTreeSet<String> = declared_driver_methods().into_iter().collect();
    let init_methods: BTreeSet<String> = init.methods.into_iter().collect();
    assert_eq!(manifest_methods, init_methods);

    let bad_open = handle
        .call::<Value>(
            method::CONN_OPEN,
            json!({ "driver_id": "duckdb", "config": { "host": "127.0.0.1" } }),
            timeout.clone(),
        )
        .await
        .expect_err("wrong driver_id should be rejected");
    assert!(bad_open.to_string().contains("unsupported driver_id"));

    let _: Value = handle
        .call(method::SHUTDOWN, json!({}), timeout)
        .await
        .expect("shutdown should succeed");
    let _ = server.await.expect("server task should join");
}

fn declared_driver_methods() -> Vec<String> {
    let manifest: Value =
        serde_json::from_str(include_str!("../driver.json")).expect("driver.json is valid json");
    manifest["methods"]
        .as_array()
        .expect("methods is an array")
        .iter()
        .map(|method| method.as_str().expect("method is string").to_string())
        .collect()
}
