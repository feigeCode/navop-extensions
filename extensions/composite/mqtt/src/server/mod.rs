//! IPC provider 服务循环:连接宿主 local_socket 并分发协议方法。
//!
//! 仿照 elasticsearch provider 的 server 模块;MQTT 不提供 job 方法(标准 §3 未定义),
//! 相关方法返回 METHOD_NOT_FOUND;事件流方法承载实时消息(标准 §5.2,见 `state::event`)。
//!
//! **并发语义**:本循环是串行的(`recv → 处理 → 响应`),所以任何 handler 内的
//! 长阻塞都会让同进程的其他请求排队。事件流的读侧因此把阻塞等待压到
//! `MQTT_EVENT_READ_MAX_WAIT_MS`(250ms)以内,而不是照搬宿主给的 60s 上限。

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

/// 边界保护:宿主帧上限(`extension-protocol/src/framing.rs` 的 `MAX_MSG_SIZE`)。
///
/// 该常量在依赖 crate 里是私有的,而 `extension-protocol` 走 git 依赖,不能顺手
/// 公开,所以这里冗余一份。**为什么必须在 provider 侧兜住**:`write_framed_async`
/// 遇到超限帧会直接返回错误、不写任何字节 —— 也就是说这一条响应发不出去,而
/// 旧实现在写失败时只是 `break` 退出循环,进程随之结束、宿主手里的 request
/// 永远等不到响应,于是整个连接被判死:UI 报 `rpc client is closed`,列表清空。
/// 一行超大的响应不该毁掉整个会话,所以超预算时改发一条小错误帧。
const IPC_MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;
/// envelope 外壳(jsonrpc/id/转义)还要占地方,留 8 KiB 余量避免临界误判。
const FRAME_GUARD_BYTES: usize = 8 * 1024;

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

async fn serve<R, W>(reader: R, writer: W) -> (R, W)
where
    R: AsyncReadExt + Unpin,
    W: AsyncWriteExt + Unpin,
{
    let mut state = ProviderState::new();
    let mut ipc = IpcParts::new(reader, writer);
    loop {
        // 反向 Host API 调用(secret 解析、宿主 KV)期间到达的帧会被推迟到队列里,
        // 而不是丢弃或就地强解成"响应" —— 先消费这些,再读新帧。
        let message = match ipc.take_deferred() {
            Some(message) => message,
            None => match recv_msg_async::<_, RpcMessage>(&mut ipc.reader).await {
                Ok(message) => message,
                Err(_) => break,
            },
        };
        // 通知(例如 `$/cancelRequest`)不是请求:跳过但不丢弃已读到的帧顺序
        let RpcMessage::Request(request) = message else {
            continue;
        };
        // 留一份方法名给超帧降级用(出错时能直接指出是哪条请求撑爆了帧)
        let method = request.method.clone();
        let (response, should_exit) = handle_request(&mut ipc, &mut state, request).await;
        if send_msg_async(
            &mut ipc.writer,
            &RpcMessage::Response(fit_frame(&method, response)),
        )
        .await
        .is_err()
        {
            // 写失败 = 对端已经走了(local socket 断开),此时退出是正确行为
            break;
        }
        if should_exit {
            break;
        }
    }
    (ipc.reader, ipc.writer)
}

/// 把「装不进一帧」的响应换成一条能装进的小错误帧。
///
/// 不这么做的话 `send_msg_async` 会返回错误(它拒绝写出超限帧),而调用方只能
/// 断开会话 —— 对用户来说就是"点几下消息列表就空了"。降级成错误响应后,
/// 请求方拿到一条可读的错误,连接和其余状态都还在。
fn fit_frame(method: &str, response: Response) -> Response {
    let id = response.id.clone();
    let oversized = match serde_json::to_vec(&response) {
        Ok(bytes) => bytes.len() + FRAME_GUARD_BYTES > IPC_MAX_FRAME_BYTES,
        // 连序列化都失败(理论上不会)时同样降级,避免再次触发写失败
        Err(_) => true,
    };
    if !oversized {
        return response;
    }
    // stderr 会被宿主收进 STDERR_TAIL_LINES 尾部日志,是排查这类问题的唯一线索
    eprintln!(
        "response for `{method}` (id {id:?}) exceeds the 16 MiB IPC frame budget; \
         returning an error response instead of dropping the session"
    );
    Response::err(
        id,
        *boxed_error(
            error_codes::INTERNAL_ERROR,
            format!(
                "response for `{method}` exceeds the IPC frame budget ({} MiB); \
                 narrow the request (smaller page_size / shorter time window / fewer messages)",
                IPC_MAX_FRAME_BYTES / (1024 * 1024)
            ),
        ),
    )
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
        method::RESOURCE_INVOKE => resource::invoke(ipc, state, params).await,
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
        // 实时消息事件流(标准 §5.2):kind 见 resource metadata 的 message_stream_kind
        method::EVENT_OPEN => stream::open_event(state, params).await,
        method::EVENT_READ => stream::read_event(state, params).await,
        method::EVENT_CLOSE => stream::close_event(state, params),
        method::SHUTDOWN => lifecycle::shutdown(state),
        _ => Err(boxed_error(
            error_codes::METHOD_NOT_FOUND,
            format!("unknown method `{method_name}`"),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use extension_protocol::envelope::RequestId;

    #[test]
    fn normal_response_survives_frame_check_untouched() {
        let response = Response::ok(1, serde_json::json!({ "messages": [1, 2, 3] }));
        let fitted = fit_frame("middleware/message/query", response);
        assert!(fitted.result().is_some(), "常规响应不应被降级成错误帧");
    }

    #[test]
    fn oversized_response_becomes_a_small_error_frame() {
        // ~20 MiB,超过 16 MiB 帧预算
        let huge = "x".repeat(20 * 1024 * 1024);
        let response = Response::ok(7, serde_json::json!({ "messages": [huge] }));
        let fitted = fit_frame("middleware/message/query", response);

        let error = fitted.error().expect("超限响应必须降级成错误帧");
        assert_eq!(error.code, error_codes::INTERNAL_ERROR);
        assert!(
            error.message.contains("middleware/message/query"),
            "错误里要指出是哪条请求撑爆了帧:{}",
            error.message
        );
        // 关键不变量:降级后的帧真的装得下,否则等于没修
        let bytes = serde_json::to_vec(&fitted).expect("可序列化");
        assert!(bytes.len() + FRAME_GUARD_BYTES < IPC_MAX_FRAME_BYTES);
        // 配错 id 的话请求方永远等不到响应,比超帧更糟
        assert_eq!(fitted.id, RequestId::Number(7));
    }

    #[test]
    fn frame_check_uses_the_documented_16_mib_budget() {
        assert_eq!(IPC_MAX_FRAME_BYTES, 16 * 1024 * 1024);
        // 余量必须为正,否则正好等于上限的帧会被宿主拒收
        assert!(FRAME_GUARD_BYTES > 0);
    }
}
