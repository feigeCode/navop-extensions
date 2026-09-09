use std::{collections::HashMap, time::Duration};

use bollard::{Docker, query_parameters::ListContainersOptionsBuilder};
use extension_protocol::{
    envelope::{Request, Response, RpcMessage},
    error::{ProtocolError, error_codes},
    framing::{recv_msg_async, send_msg_async},
    lifecycle::InitResult,
    method,
    resource::{
        ResourceCloseParams, ResourceInvokeParams, ResourceOpenParams, ResourceOpenResult,
        ResourcePingParams,
    },
    result_ref::ResultRef,
};
use interprocess::local_socket::{
    GenericNamespaced, ToNsName,
    tokio::{Stream, prelude::*},
};
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use tokio::io::AsyncWriteExt;

type ProviderResult = Result<Value, Box<ProtocolError>>;

#[derive(Default)]
struct State {
    resources: HashMap<String, Docker>,
}

#[tokio::main]
async fn main() {
    let socket = std::env::var("ONETCLI_EXT_SOCKET").unwrap_or_else(|error| {
        eprintln!("missing ONETCLI_EXT_SOCKET: {error}");
        std::process::exit(2);
    });
    let name = socket
        .to_ns_name::<GenericNamespaced>()
        .expect("valid host socket name");
    let stream = tokio::time::timeout(Duration::from_secs(5), Stream::connect(name))
        .await
        .expect("connect timeout")
        .expect("connect host socket");
    let (mut reader, mut writer) = tokio::io::split(stream);
    let mut state = State::default();
    while let Ok(RpcMessage::Request(request)) = recv_msg_async(&mut reader).await {
        let exit = request.method == method::SHUTDOWN;
        let response = handle(&mut state, request).await;
        if send_msg_async(&mut writer, &RpcMessage::Response(response))
            .await
            .is_err()
            || exit
        {
            break;
        }
    }
    let _ = writer.shutdown().await;
}

async fn handle(state: &mut State, request: Request) -> Response {
    let result = dispatch(state, &request.method, request.params).await;
    match result {
        Ok(value) => Response::ok(request.id, value),
        Err(error) => Response::err(request.id, *error),
    }
}

async fn dispatch(state: &mut State, method_name: &str, params: Value) -> ProviderResult {
    match method_name {
        method::INIT => serialize(
            InitResult::new(env!("CARGO_PKG_VERSION"))
                .with_api("extension", "1.0")
                .with_method(method::RESOURCE_OPEN)
                .with_method(method::RESOURCE_PING)
                .with_method(method::RESOURCE_INVOKE)
                .with_method(method::RESOURCE_CLOSE),
        ),
        method::RESOURCE_OPEN => open(state, params).await,
        method::RESOURCE_PING => ping(state, params).await,
        method::RESOURCE_INVOKE => invoke(state, params).await,
        method::RESOURCE_CLOSE => close(state, params),
        method::SHUTDOWN => {
            state.resources.clear();
            Ok(Value::Null)
        }
        _ => Err(protocol(
            error_codes::METHOD_NOT_FOUND,
            "unsupported method",
        )),
    }
}

async fn open(state: &mut State, params: Value) -> ProviderResult {
    let params: ResourceOpenParams = parse(params)?;
    if params.resource_type != "docker" {
        return Err(invalid("resourceType must be docker"));
    }
    let socket = params
        .config
        .get("socket")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("socket is required"))?;
    let path = expand_socket(socket)?;
    let docker = Docker::connect_with_unix(&path, 120, bollard::API_DEFAULT_VERSION)
        .map_err(|error| unavailable(error.to_string()))?
        .negotiate_version()
        .await
        .map_err(|error| unavailable(error.to_string()))?;
    let version = docker
        .version()
        .await
        .map_err(|error| unavailable(error.to_string()))?;
    let resource_id = uuid::Uuid::new_v4().to_string();
    state.resources.insert(resource_id.clone(), docker);
    serialize(ResourceOpenResult {
        resource_id,
        capabilities: vec![
            "docker/system/info".into(),
            "docker/container/list".into(),
            "docker/container/inspect".into(),
        ],
        metadata: Some(json!({
            "client": "bollard",
            "server_version": version.version,
            "api_version": version.api_version,
            "operations": "read-only"
        })),
    })
}

async fn ping(state: &State, params: Value) -> ProviderResult {
    let params: ResourcePingParams = parse(params)?;
    let docker = resource(state, &params.resource_id)?;
    docker
        .ping()
        .await
        .map_err(|e| unavailable(e.to_string()))?;
    Ok(Value::Null)
}

async fn invoke(state: &State, params: Value) -> ProviderResult {
    let params: ResourceInvokeParams = parse(params)?;
    let docker = resource(state, &params.resource_id)?;
    let value = match params.method.as_str() {
        "docker/system/info" => serialize_value(docker.info().await)?,
        "docker/container/list" => {
            let containers = docker
                .list_containers(Some(
                    ListContainersOptionsBuilder::default().all(true).build(),
                ))
                .await
                .map_err(|e| unavailable(e.to_string()))?;
            let rows = containers
                .into_iter()
                .map(|container| json!({
                    "id": container.id,
                    "name": container.names.unwrap_or_default().into_iter().next().unwrap_or_default().trim_start_matches('/'),
                    "image": container.image,
                    "state": container.state,
                    "status": container.status,
                }))
                .collect::<Vec<_>>();
            json!({"containers": rows})
        }
        "docker/container/inspect" => {
            let id = params
                .params
                .get("id")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("container id is required"))?;
            serialize_value(docker.inspect_container(id, None).await)?
        }
        _ => {
            return Err(protocol(
                error_codes::METHOD_NOT_FOUND,
                "unknown Docker operation",
            ));
        }
    };
    serialize(extension_protocol::resource::ResourceInvokeResult {
        result: ResultRef::Inline { value },
    })
}

fn close(state: &mut State, params: Value) -> ProviderResult {
    let params: ResourceCloseParams = parse(params)?;
    if state.resources.remove(&params.resource_id).is_none() {
        return Err(closed());
    }
    Ok(Value::Null)
}

fn resource<'a>(state: &'a State, id: &str) -> Result<&'a Docker, Box<ProtocolError>> {
    state.resources.get(id).ok_or_else(closed)
}

fn expand_socket(value: &str) -> Result<String, Box<ProtocolError>> {
    let path = value
        .strip_prefix("unix://")
        .ok_or_else(|| invalid("only unix:// sockets are supported"))?;
    if let Some(relative) = path.strip_prefix("~/") {
        let home = std::env::var("HOME").map_err(|_| invalid("HOME is unavailable"))?;
        return Ok(format!("{home}/{relative}"));
    }
    if !path.starts_with('/') || path.contains("..") {
        return Err(invalid("socket must be an absolute path"));
    }
    Ok(path.to_owned())
}

fn parse<T: DeserializeOwned>(value: Value) -> Result<T, Box<ProtocolError>> {
    serde_json::from_value(value).map_err(|e| invalid(e.to_string()))
}

fn serialize<T: serde::Serialize>(value: T) -> ProviderResult {
    serde_json::to_value(value).map_err(|e| invalid(e.to_string()))
}

fn serialize_value<T: serde::Serialize, E: std::fmt::Display>(
    result: Result<T, E>,
) -> Result<Value, Box<ProtocolError>> {
    serialize(result.map_err(|e| unavailable(e.to_string()))?)
}

fn protocol(
    code: extension_protocol::error::ErrorCode,
    message: impl Into<String>,
) -> Box<ProtocolError> {
    Box::new(ProtocolError::new(code, message))
}
fn invalid(message: impl Into<String>) -> Box<ProtocolError> {
    protocol(error_codes::INVALID_PARAMS, message)
}
fn unavailable(message: impl Into<String>) -> Box<ProtocolError> {
    protocol(error_codes::INTERNAL_ERROR, message)
}
fn closed() -> Box<ProtocolError> {
    protocol(error_codes::RESOURCE_CLOSED, "Docker resource is not open")
}
