//! IPC provider 服务循环:连接宿主 local_socket 并分发协议方法。
//!
//! 仿照 elasticsearch provider 的 server 模块;MQTT 不提供 job 与 event stream
//! 方法(标准 §3 未定义),相关方法返回 METHOD_NOT_FOUND。

mod lifecycle;
mod resource;
mod stream;

use std::time::Duration;

use extension_protocol::{
    envelope::{Request, Response, RpcMessage},
    error::error_codes,
    framing::{recv_msg_async, send_msg_async},
    method,
};
use interprocess::local_socket::{
    GenericNamespaced, ToNsName,
    tokio::{Stream, prelude::*},
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::{
    error::{ProviderResult, boxed_error},
    ipc::IpcParts,
    state::ProviderState,
};

const SOCKET_ENV_VAR: &str = "ONETCLI_EXT_SOCKET";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

pub(crate) async fn run() {
    let socket_name = std::env::var(SOCKET_ENV_VAR).unwrap_or_else(|error| {
        eprintln!("missing {SOCKET_ENV_VAR}: {error}");
        std::process::exit(2);
    });
    let name = socket_name
        .to_ns_name::<GenericNamespaced>()
        .expect("valid host-provided local socket name");
    let stream = match tokio::time::timeout(CONNECT_TIMEOUT, Stream::connect(name)).await {
        Ok(Ok(stream)) => stream,
        Ok(Err(error)) => {
            eprintln!("failed to connect extension socket: {error}");
            std::process::exit(3);
        }
        Err(_) => {
            eprintln!("timed out connecting extension socket");
            std::process::exit(4);
        }
    };

    let (reader, writer) = tokio::io::split(stream);
    let (reader, mut writer) = serve(reader, writer).await;
    let _ = writer.shutdown().await;
    let _ = reader;
}

async fn serve<R, W>(mut reader: R, mut writer: W) -> (R, W)
where
    R: AsyncReadExt + Unpin,
    W: AsyncWriteExt + Unpin,
{
    let mut state = ProviderState::new();
    while let Ok(message) = recv_msg_async::<_, RpcMessage>(&mut reader).await {
        let RpcMessage::Request(request) = message else {
            continue;
        };
        let mut ipc = IpcParts::new(reader, writer);
        let (response, should_exit) = handle_request(&mut ipc, &mut state, request).await;
        reader = ipc.reader;
        writer = ipc.writer;
        if send_msg_async(&mut writer, &RpcMessage::Response(response))
            .await
            .is_err()
        {
            break;
        }
        if should_exit {
            break;
        }
    }
    (reader, writer)
}

async fn handle_request<R, W>(
    ipc: &mut IpcParts<R, W>,
    state: &mut ProviderState,
    request: Request,
) -> (Response, bool)
where
    R: AsyncReadExt + Unpin,
    W: AsyncWriteExt + Unpin,
{
    let should_exit = request.method == method::SHUTDOWN;
    let result = dispatch(ipc, state, &request.method, request.params).await;
    let response = match result {
        Ok(result) => Response::ok(request.id, result),
        Err(error) => Response::err(request.id, *error),
    };
    (response, should_exit)
}

async fn dispatch<R, W>(
    ipc: &mut IpcParts<R, W>,
    state: &mut ProviderState,
    method_name: &str,
    params: serde_json::Value,
) -> ProviderResult
where
    R: AsyncReadExt + Unpin,
    W: AsyncWriteExt + Unpin,
{
    match method_name {
        method::INIT => lifecycle::init(),
        method::RESOURCE_OPEN => resource::open(ipc, state, params).await,
        method::RESOURCE_PING => resource::ping(state, params),
        method::RESOURCE_INVOKE => resource::invoke(state, params).await,
        method::RESOURCE_CLOSE => resource::close(state, params).await,
        method::BLOB_OPEN => Err(boxed_error(
            error_codes::METHOD_NOT_FOUND,
            "MQTT results are opened by resource invoke",
        )),
        method::BLOB_READ => stream::read_blob(state, params),
        method::BLOB_CLOSE => stream::close_blob(state, params),
        method::JOB_START
        | method::JOB_STATUS
        | method::JOB_CANCEL
        | method::JOB_RESULT
        | method::JOB_CLOSE => Err(boxed_error(
            error_codes::METHOD_NOT_FOUND,
            format!("MQTT provider does not implement job method `{method_name}`"),
        )),
        method::EVENT_OPEN | method::EVENT_READ | method::EVENT_CLOSE => Err(boxed_error(
            error_codes::METHOD_NOT_FOUND,
            format!("MQTT provider does not implement event method `{method_name}`"),
        )),
        method::SHUTDOWN => lifecycle::shutdown(state),
        _ => Err(boxed_error(
            error_codes::METHOD_NOT_FOUND,
            format!("unknown method `{method_name}`"),
        )),
    }
}
