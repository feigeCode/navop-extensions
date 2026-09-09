//! TDengine driver 的 server,基于共享 [`extension_driver`] 的 Tokio-first 运行时。
//!
//! 主循环(reader / per-request task / 取消 / pump)全部下沉到
//! `extension_driver::serve_async`;本文件只负责 transport 接入
//! ([`run`] / [`handle_stream`])和给 [`crate::handlers`] 复用的错误构造 helper。
//!
//! taos 连接器本身是异步的(WebSocket),因此与 duckdb 的同步运行时不同,
//! 这里走 async trait([`extension_driver::AsyncNativeDriver`])。

// ProtocolError 是 wire 契约类型,Err 类型大小固定,协议层如此,统一 allow。
#![allow(clippy::result_large_err)]

use anyhow::{Context, Result};
use extension_driver::serve_async;
use extension_protocol::error::{ErrorCode, ErrorData, ProtocolError, error_codes};
use interprocess::local_socket::tokio::prelude::*;
use interprocess::local_socket::{GenericNamespaced, ToNsName, tokio::Stream};
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tracing::warn;

use crate::driver::TdengineDriver;

/// 标准入口:作为 `extension-host` 启动的子进程运行。
///
/// 流程:宿主先 listen 并把 socket 名通过 `ONETCLI_EXT_SOCKET` 透传过来,本进程
/// 主动 connect,然后把 transport 交给 [`serve_async`]。
pub async fn run(socket_name: &str) -> Result<()> {
    let name = socket_name
        .to_ns_name::<GenericNamespaced>()
        .with_context(|| format!("invalid local socket name {socket_name:?}"))?;
    tracing::info!(socket = %socket_name, "tdengine driver connecting back to host");
    let stream = Stream::connect(name)
        .await
        .context("failed to connect to host listener")?;
    let (reader, writer) = tokio::io::split(stream);
    serve_async(TdengineDriver::new(), reader, writer).await
}

/// 备用入口:**反向**模式——driver 自己 listen,客户端 connect(仅供开发/集成测试)。
pub async fn run_as_listener(socket_name: &str) -> Result<()> {
    use interprocess::local_socket::{ListenerOptions, tokio::prelude::*};

    let name = socket_name
        .to_ns_name::<GenericNamespaced>()
        .with_context(|| format!("invalid local socket name {socket_name:?}"))?;
    let listener = ListenerOptions::new()
        .name(name)
        .create_tokio()
        .context("failed to create local socket listener")?;
    tracing::info!(socket = %socket_name, "tdengine driver listening (developer mode)");

    loop {
        let stream = listener.accept().await?;
        tokio::spawn(async move {
            if let Err(error) = handle_connection(stream).await {
                warn!("TDengine IPC connection failed: {error:#}");
            }
        });
    }
}

/// 暴露给集成测试:直接用一对 reader/writer 当 transport,免去 socket。
pub async fn handle_stream<R, W>(reader: R, writer: W) -> Result<()>
where
    R: AsyncReadExt + Unpin + Send,
    W: AsyncWriteExt + Unpin + Send + 'static,
{
    serve_async(TdengineDriver::new(), reader, writer).await
}

async fn handle_connection(stream: Stream) -> Result<()> {
    let (reader, writer) = tokio::io::split(stream);
    serve_async(TdengineDriver::new(), reader, writer).await
}

// ===================== 给 handlers 复用的 helper =====================

/// 把 `anyhow::Error` 包成带错误链的 `ProtocolError`。
pub(crate) fn protocol_error_from_anyhow(code: ErrorCode, error: anyhow::Error) -> ProtocolError {
    let mut pe = ProtocolError::new(code, format!("{error:#}"));
    pe = pe.with_data(ErrorData::new().with_extra(serde_json::json!({
        "chain": error
            .chain()
            .map(|e| e.to_string())
            .collect::<Vec<_>>(),
    })));
    pe
}

/// 必传参数缺失。
pub(crate) fn missing_param(name: &str) -> ProtocolError {
    ProtocolError::new(
        error_codes::INVALID_PARAMS,
        format!("missing required parameter `{name}`"),
    )
}

/// 通用 invalid_params。
pub(crate) fn invalid_params(message: impl Into<String>) -> ProtocolError {
    ProtocolError::new(error_codes::INVALID_PARAMS, message)
}

/// 用于反序列化 params 时报错。
pub(crate) fn params_deserialize_error(error: serde_json::Error) -> ProtocolError {
    ProtocolError::new(
        error_codes::INVALID_PARAMS,
        format!("failed to deserialize params: {error}"),
    )
}

/// 序列化结果时报错(不应发生)。
pub(crate) fn serialize_error(error: serde_json::Error) -> ProtocolError {
    ProtocolError::new(
        error_codes::INTERNAL_ERROR,
        format!("failed to serialize result: {error}"),
    )
}

#[allow(dead_code)] // 为通知路径预留
pub(crate) fn method_not_found(method_name: &str) -> ProtocolError {
    ProtocolError::new(
        error_codes::METHOD_NOT_FOUND,
        format!("method `{method_name}` is not implemented in TDengine driver"),
    )
}

/// 兼容 duckdb 驱动遗留的 `params["config"]` 取值(未使用 Value 的告告压制)。
#[allow(dead_code)]
pub(crate) fn config_value_of(params: &Value) -> Value {
    params.get("config").cloned().unwrap_or(Value::Null)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn protocol_error_from_anyhow_includes_chain() {
        let err = anyhow::anyhow!("root").context("middle").context("top");
        let pe = protocol_error_from_anyhow(error_codes::SQL_SYNTAX_ERROR, err);
        assert_eq!(pe.code, error_codes::SQL_SYNTAX_ERROR);
        assert!(pe.message.contains("top"));
        let data = pe.data.unwrap();
        let chain = data.extra.unwrap();
        assert!(chain["chain"].as_array().is_some());
    }

    #[test]
    fn missing_param_uses_invalid_params_code() {
        let pe = missing_param("conn_id");
        assert_eq!(pe.code, error_codes::INVALID_PARAMS);
        assert!(pe.message.contains("conn_id"));
    }

    #[test]
    fn invalid_params_carries_message() {
        let pe = invalid_params("bad");
        assert_eq!(pe.code, error_codes::INVALID_PARAMS);
        assert_eq!(pe.message, "bad");
    }

    #[test]
    fn params_deserialize_error_classifies_as_invalid_params() {
        let inner = serde_json::from_str::<Value>("nope").unwrap_err();
        let pe = params_deserialize_error(inner);
        assert_eq!(pe.code, error_codes::INVALID_PARAMS);
    }
}
