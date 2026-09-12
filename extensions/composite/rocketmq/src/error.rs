//! provider 侧错误辅助:参数解析、序列化与中间件错误到协议错误的映射。

use extension_protocol::error::{ErrorCode, ProtocolError, error_codes};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;

use crate::contract::MiddlewareError;

pub(crate) type ProviderResult = Result<Value, Box<ProtocolError>>;

pub(crate) fn boxed_error(code: ErrorCode, message: impl Into<String>) -> Box<ProtocolError> {
    Box::new(ProtocolError::new(code, message))
}

pub(crate) fn invalid_params(message: impl Into<String>) -> Box<ProtocolError> {
    boxed_error(error_codes::INVALID_PARAMS, message)
}

pub(crate) fn resource_error() -> Box<ProtocolError> {
    boxed_error(error_codes::RESOURCE_CLOSED, "RocketMQ 资源未打开或已关闭")
}

pub(crate) fn parse_params<T: DeserializeOwned>(value: Value) -> Result<T, Box<ProtocolError>> {
    serde_json::from_value(value)
        .map_err(|error| invalid_params(format!("配置错误: 参数解析失败: {error}")))
}

pub(crate) fn serialize<T: Serialize>(value: T) -> ProviderResult {
    serde_json::to_value(value).map_err(|error| invalid_params(format!("结果序列化失败: {error}")))
}

/// 中间件统一错误 → 协议错误。
///
/// 错误文本保留标准 §3 约定前缀(配置错误:/协议错误:/不支持的操作:/
/// 操作超时:/连接错误:/认证错误:),错误码按类别映射。
pub(crate) fn middleware_error(error: MiddlewareError) -> Box<ProtocolError> {
    let code = match &error {
        MiddlewareError::Config(_) => error_codes::INVALID_PARAMS,
        MiddlewareError::Protocol(_) => error_codes::INTERNAL_ERROR,
        MiddlewareError::Unsupported(_) => error_codes::CAPABILITY_DISABLED,
        MiddlewareError::Timeout(_) => error_codes::IO_TIMEOUT,
        MiddlewareError::Connection(_) => error_codes::IO_CONNECTION_REFUSED,
        MiddlewareError::Auth(_) => error_codes::AUTH_FAILED,
    };
    boxed_error(code, error.to_string())
}
