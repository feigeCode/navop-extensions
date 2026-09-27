//! 反向 Host API 通道:secret 经宿主 `host/secret/resolve` 解析 `secret://self/...`
//! 引用,KV 经 `host/storage/{get,set}` 持久化订阅画像。
//!
//! **帧匹配**:provider 与宿主共用同一条 socket。provider 在处理入站请求的
//! 过程中可能反向调用宿主,此时读者流上到达的既可能是我们等待的响应,也可能
//! 是宿主发来的新请求/通知(如 `$/cancelRequest`)。「发一帧、下一帧就是响应」
//! 的旧实现遇到插队帧会错配响应、并把宿主请求当错误丢弃。现在统一走
//! [`IpcParts::request_host`]:按 id 匹配响应,其余帧进推迟队列,由服务循环
//! 稍后按序处理,保证零丢帧。
//!
//! 宿主在打开资源前已按扩展清单的权限完成授权检查(secret 需
//! `secrets:read:self.*`);KV 存储以扩展 id 为命名空间,无需额外授权。

use std::{
    collections::VecDeque,
    sync::atomic::{AtomicI64, Ordering},
};

use extension_protocol::{
    conn::SecretRef,
    envelope::{Request, RequestId, RpcMessage},
    error::{ProtocolError, error_codes},
    framing::{recv_msg_async, send_msg_async},
    host::{
        ResolveSecretParams, ResolveSecretResult, StorageGetParams, StorageGetResult,
        StorageSetParams,
    },
    method,
};
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::error::{boxed_error, invalid_params};

/// 等待宿主响应期间最多推迟多少帧;超出说明协议状态机已经跑偏,宁可直接失败。
const MAX_DEFERRED_FRAMES: usize = 64;

pub(crate) struct IpcParts<R, W>
where
    R: AsyncReadExt + Unpin,
    W: AsyncWriteExt + Unpin,
{
    pub(crate) reader: R,
    pub(crate) writer: W,
    /// 等待反向响应期间到达、尚未处理的入站帧(宿主请求 / 通知)。
    deferred: VecDeque<RpcMessage>,
}

impl<R, W> IpcParts<R, W>
where
    R: AsyncReadExt + Unpin,
    W: AsyncWriteExt + Unpin,
{
    pub(crate) fn new(reader: R, writer: W) -> Self {
        Self {
            reader,
            writer,
            deferred: VecDeque::new(),
        }
    }

    /// 取出一帧被推迟的入站消息;服务循环优先消费它,保证顺序。
    pub(crate) fn take_deferred(&mut self) -> Option<RpcMessage> {
        self.deferred.pop_front()
    }

    /// 向宿主发一个反向请求,并等到**同一 id** 的响应。
    ///
    /// 期间到达的入站请求/通知进推迟队列(不丢弃、不误判)。
    pub(crate) async fn request_host(
        &mut self,
        method_name: &str,
        params: Value,
        next_id: &AtomicI64,
    ) -> Result<Value, Box<ProtocolError>> {
        let id = RequestId::Number(next_id.fetch_add(1, Ordering::SeqCst));
        let request = Request::new(id.clone(), method_name, params);
        send_msg_async(&mut self.writer, &RpcMessage::Request(request))
            .await
            .map_err(|error| {
                boxed_error(
                    error_codes::INTERNAL_ERROR,
                    format!("failed to send host request `{method_name}`: {error}"),
                )
            })?;

        loop {
            let message = recv_msg_async::<_, RpcMessage>(&mut self.reader)
                .await
                .map_err(|error| {
                    boxed_error(
                        error_codes::INTERNAL_ERROR,
                        format!("failed to receive host response for `{method_name}`: {error}"),
                    )
                })?;
            match message {
                RpcMessage::Response(response) => {
                    if response.id != id {
                        // 不是我们等的这一帧:理论上不该出现,记一笔后跳过。
                        eprintln!("mqtt: ignoring host response with unexpected id");
                        continue;
                    }
                    if let Some(error) = response.error() {
                        return Err(Box::new(error.clone()));
                    }
                    return response.result().cloned().ok_or_else(|| {
                        boxed_error(
                            error_codes::INTERNAL_ERROR,
                            format!(
                                "host method `{method_name}` returned neither result nor error"
                            ),
                        )
                    });
                }
                other => {
                    if self.deferred.len() >= MAX_DEFERRED_FRAMES {
                        return Err(boxed_error(
                            error_codes::INTERNAL_ERROR,
                            format!("too many frames queued while awaiting `{method_name}`"),
                        ));
                    }
                    self.deferred.push_back(other);
                }
            }
        }
    }
}

/// 请求宿主解析 secret 引用。
pub(crate) async fn resolve_secret<R, W>(
    ipc: &mut IpcParts<R, W>,
    secret_ref: &SecretRef,
    next_id: &AtomicI64,
) -> Result<Vec<u8>, Box<ProtocolError>>
where
    R: AsyncReadExt + Unpin,
    W: AsyncWriteExt + Unpin,
{
    let params = serde_json::to_value(ResolveSecretParams {
        secret_ref: secret_ref.clone(),
    })
    .map_err(|error| invalid_params(error.to_string()))?;
    let value = ipc
        .request_host(method::HOST_RESOLVE_SECRET, params, next_id)
        .await?;
    let result: ResolveSecretResult =
        serde_json::from_value(value).map_err(|error| invalid_params(error.to_string()))?;
    Ok(result.value)
}

/// 读取宿主 KV 中某个键的值。
///
/// 返回 `Ok(None)` 表示「键不存在」**或**「宿主未实现 KV(桩实现恒返回空)」;
/// 调用方按 best-effort 处理,不得把它当成错误。
pub(crate) async fn storage_get<R, W>(
    ipc: &mut IpcParts<R, W>,
    key: &str,
    next_id: &AtomicI64,
) -> Result<Option<Value>, Box<ProtocolError>>
where
    R: AsyncReadExt + Unpin,
    W: AsyncWriteExt + Unpin,
{
    let params = serde_json::to_value(StorageGetParams {
        key: key.to_string(),
        namespace: Some(crate::host_state::STORAGE_NAMESPACE.to_string()),
    })
    .map_err(|error| invalid_params(error.to_string()))?;
    let value = ipc
        .request_host(method::HOST_STORAGE_GET, params, next_id)
        .await?;
    let result: StorageGetResult =
        serde_json::from_value(value).map_err(|error| invalid_params(error.to_string()))?;
    Ok(result.value)
}

/// 写入宿主 KV。宿主未实现时是无害的 no-op,调用方随后用 [`storage_get`] 复核。
pub(crate) async fn storage_set<R, W>(
    ipc: &mut IpcParts<R, W>,
    key: &str,
    value: Value,
    next_id: &AtomicI64,
) -> Result<(), Box<ProtocolError>>
where
    R: AsyncReadExt + Unpin,
    W: AsyncWriteExt + Unpin,
{
    let params = serde_json::to_value(StorageSetParams {
        key: key.to_string(),
        value,
        namespace: Some(crate::host_state::STORAGE_NAMESPACE.to_string()),
        ttl_secs: None,
    })
    .map_err(|error| invalid_params(error.to_string()))?;
    ipc.request_host(method::HOST_STORAGE_SET, params, next_id)
        .await?;
    Ok(())
}
