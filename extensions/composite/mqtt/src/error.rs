//! provider 错误构造与中间件错误到协议错误的映射。

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
    boxed_error(error_codes::RESOURCE_CLOSED, "MQTT resource is not open")
}

pub(crate) fn parse_params<T: DeserializeOwned>(value: Value) -> Result<T, Box<ProtocolError>> {
    serde_json::from_value(value)
        .map_err(|error| invalid_params(format!("配置错误: 无效的请求参数: {error}")))
}

pub(crate) fn serialize<T: Serialize>(value: T) -> ProviderResult {
    serde_json::to_value(value).map_err(|error| invalid_params(error.to_string()))
}

/// 中间件统一错误 -> 协议错误。
///
/// 错误文本保持标准 §3 前缀(`配置错误:`/`协议错误:`/`不支持的操作:/
/// 操作超时:`/`连接错误:`/`认证错误:`),错误码按语义就近映射。
pub(crate) fn middleware_error(error: MiddlewareError) -> Box<ProtocolError> {
    let code = match &error {
        MiddlewareError::Config(_) => error_codes::INVALID_PARAMS,
        MiddlewareError::Protocol(_) => error_codes::INTERNAL_ERROR,
        MiddlewareError::Unsupported(_) => error_codes::METHOD_NOT_FOUND,
        MiddlewareError::Timeout(_) => error_codes::IO_TIMEOUT,
        MiddlewareError::Connection(_) => error_codes::IO_CONNECTION_REFUSED,
        MiddlewareError::Auth(_) => error_codes::AUTH_FAILED,
    };
    boxed_error(code, error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn middleware_error_maps_codes_and_keeps_prefix() {
        let error = middleware_error(MiddlewareError::Auth("凭据被拒".into()));
        assert_eq!(error.code, error_codes::AUTH_FAILED);
        assert_eq!(error.message, "认证错误: 凭据被拒");

        let error = middleware_error(MiddlewareError::Unsupported(
            "当前中间件不支持该能力: groups".into(),
        ));
        assert_eq!(error.code, error_codes::METHOD_NOT_FOUND);
        assert!(error.message.starts_with("不支持的操作:"));

        let error = middleware_error(MiddlewareError::Timeout("超时".into()));
        assert_eq!(error.code, error_codes::IO_TIMEOUT);

        let error = middleware_error(MiddlewareError::Connection("断连".into()));
        assert_eq!(error.code, error_codes::IO_CONNECTION_REFUSED);

        let error = middleware_error(MiddlewareError::Config("缺字段".into()));
        assert_eq!(error.code, error_codes::INVALID_PARAMS);

        let error = middleware_error(MiddlewareError::Protocol("解码失败".into()));
        assert_eq!(error.code, error_codes::INTERNAL_ERROR);
    }
}
