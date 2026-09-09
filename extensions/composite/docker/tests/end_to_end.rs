use std::{fs, path::Path, sync::Arc, time::Duration};

use extension_host::{
    NegotiationConfig, ProcessRpcSession, ProcessRpcSessionConfig, SpawnConfig,
    UniversalPluginClient,
};
use extension_protocol::{
    resource::{ResourceCloseParams, ResourceInvokeParams, ResourceOpenParams},
    result_ref::ResultRef,
};
use serde_json::{Value, json};

fn copy_executable(source: &Path, destination: &Path) {
    fs::copy(source, destination).expect("copy provider executable");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = fs::metadata(destination).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(destination, permissions).unwrap();
    }
}

#[tokio::test]
#[ignore = "requires NAVOP_DOCKER_SOCKET pointing to a live Docker daemon"]
async fn live_docker_provider_smoke() {
    let socket = std::env::var("NAVOP_DOCKER_SOCKET")
        .expect("NAVOP_DOCKER_SOCKET is required, e.g. unix://~/.docker/run/docker.sock");
    let root = tempfile::tempdir().unwrap();
    let bin_dir = root.path().join("bin");
    fs::create_dir_all(&bin_dir).unwrap();
    copy_executable(
        Path::new(env!("CARGO_BIN_EXE_docker-provider")),
        &bin_dir.join("docker-provider"),
    );
    let spawn = SpawnConfig::new(bin_dir.join("docker-provider"))
        .with_program_root(root.path())
        .with_ready_timeout(Duration::from_secs(5));
    let config = ProcessRpcSessionConfig::new(
        spawn,
        NegotiationConfig::new("0.17.0", "docker-e2e").offer_api("extension", "1.0"),
    )
    .with_request_timeout(Duration::from_secs(10))
    .with_shutdown_grace_ms(2_500)
    .with_label("com.navop.docker::main");
    let session = Arc::new(ProcessRpcSession::start(config).await.unwrap());
    let client = UniversalPluginClient::new(Arc::clone(&session));
    let opened = client
        .open_resource(&ResourceOpenParams {
            resource_type: "docker".into(),
            config: json!({"socket": socket}),
            metadata: None,
        })
        .await
        .expect("open Docker resource");

    assert!(opened.capabilities.contains(&"docker/system/info".into()));
    let info = invoke(
        &client,
        &opened.resource_id,
        "docker/system/info",
        Value::Null,
    )
    .await;
    assert!(
        info.is_object(),
        "Docker info must be a JSON object: {info}"
    );
    let listed = invoke(
        &client,
        &opened.resource_id,
        "docker/container/list",
        Value::Null,
    )
    .await;
    let containers = listed["containers"].as_array().expect("container array");
    if let Some(id) = containers
        .first()
        .and_then(|container| container["id"].as_str())
    {
        let inspected = invoke(
            &client,
            &opened.resource_id,
            "docker/container/inspect",
            json!({"id": id}),
        )
        .await;
        assert!(
            inspected.is_object(),
            "container inspect must return a JSON object: {inspected}"
        );
    }

    client
        .close_resource(&ResourceCloseParams {
            resource_id: opened.resource_id,
        })
        .await
        .expect("close Docker resource");
    session.shutdown().await;
}

async fn invoke(
    client: &extension_host::UniversalPluginClient,
    resource_id: &str,
    method: &str,
    params: Value,
) -> Value {
    let result = client
        .invoke_resource(&ResourceInvokeParams {
            resource_id: resource_id.into(),
            method: method.into(),
            params,
        })
        .await
        .unwrap_or_else(|error| panic!("{method} failed: {error}"));
    let ResultRef::Inline { value } = result.result else {
        panic!("{method} must return inline JSON")
    };
    value
}
