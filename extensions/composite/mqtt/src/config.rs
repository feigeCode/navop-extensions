//! resource/open 配置解析:标准 §4 的 MQTT 连接表单字段 + 宿主注入的 secret 引用。
//!
//! 表单字段:host(必填,默认 127.0.0.1)、port(必填,默认 1883)、username、
//! password(secret,经 `credential_refs["password"]` 以 `secret://self/...` 注入)、
//! client_id(默认 `navop-mqtt-<随机后缀>` 由 provider 生成)、keep_alive_secs(默认 60)。
//! SSH 隧道字段由宿主连接窗口统一提供,provider 侧不感知(标准 §4)。

use std::collections::BTreeMap;

use extension_protocol::{conn::SecretRef, error::ProtocolError, resource::ResourceOpenParams};
use serde::Deserialize;
use serde_json::{Value, from_value};

use crate::contract::MiddlewareError;
use crate::error::middleware_error;
use crate::types::MqttConnectionConfig;

/// 解析结果类型(别名:OpenPlan 与协议错误)
pub(crate) type OpenPlanResult = Result<OpenPlan, Box<ProtocolError>>;

/// 标准 §1:实现扩展的 IPC runtime 暴露的资源类型(全局统一)
pub(crate) const RESOURCE_TYPE: &str = "middleware";

/// 表单默认端口(非 TLS)
const DEFAULT_PORT: u16 = 1883;

/// 标准 §4:keep_alive_secs 表单默认值
const DEFAULT_KEEP_ALIVE_SECS: u64 = 60;

#[derive(Debug, Deserialize)]
struct OpenConfig {
    host: String,
    #[serde(default)]
    port: Option<u16>,
    #[serde(default)]
    username: Option<String>,
    /// 明文密码(仅开发调试直连场景;表单正常路径走 credential_refs)
    #[serde(default)]
    password: Option<String>,
    #[serde(default)]
    client_id: Option<String>,
    #[serde(default)]
    keep_alive_secs: Option<u64>,
    /// TLS 开关(表单未暴露,预留 8883 端口场景)
    #[serde(default)]
    use_tls: Option<bool>,
    #[serde(default)]
    credential_refs: BTreeMap<String, String>,
}

/// 待解析的密码:secret 引用(经宿主 reverse Host API)或明文
#[derive(Debug)]
pub(crate) enum PendingPassword {
    None,
    Direct(String),
    Reference(SecretRef),
}

/// resource/open 解析结果:连接配置 + 待解析密码
#[derive(Debug)]
pub(crate) struct OpenPlan {
    pub config: MqttConnectionConfig,
    pub password: PendingPassword,
}

/// 解析 resource/open 参数(字段错误统一以 `配置错误:` 前缀返回)
pub(crate) fn parse_open_params(params: Value) -> OpenPlanResult {
    let params: ResourceOpenParams = from_value(params)
        .map_err(|error| middleware_error(MiddlewareError::Config(error.to_string())))?;
    if params.resource_type != RESOURCE_TYPE {
        return Err(middleware_error(MiddlewareError::Config(format!(
            "resource type 必须为 `{RESOURCE_TYPE}`"
        ))));
    }
    let config: OpenConfig = from_value(params.config).map_err(|error| {
        middleware_error(MiddlewareError::Config(format!(
            "无效的 MQTT 配置: {error}"
        )))
    })?;

    let host = config.host.trim().to_string();
    if host.is_empty() {
        return Err(middleware_error(MiddlewareError::Config(
            "`host` 不能为空".to_string(),
        )));
    }

    let password = match config
        .credential_refs
        .get("password")
        .filter(|value| !value.trim().is_empty())
    {
        Some(reference) => PendingPassword::Reference(SecretRef::new(reference.clone())),
        None => match config.password.as_deref().map(str::trim) {
            Some(password) if !password.is_empty() => PendingPassword::Direct(password.to_string()),
            _ => PendingPassword::None,
        },
    };

    let config = MqttConnectionConfig {
        host,
        port: config.port.unwrap_or(DEFAULT_PORT),
        client_id: config
            .client_id
            .as_deref()
            .map(str::trim)
            .unwrap_or_default()
            .to_string(),
        username: config
            .username
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string),
        // 明文密码在此只是占位,Reference 场景由调用方回填
        password: None,
        use_tls: config.use_tls.unwrap_or(false),
        timeout: MqttConnectionConfig::default().timeout,
        keep_alive_secs: config
            .keep_alive_secs
            .unwrap_or(DEFAULT_KEEP_ALIVE_SECS)
            .max(1),
        clean_session: true,
    };

    Ok(OpenPlan { config, password })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn open_params(config: Value) -> OpenPlanResult {
        parse_open_params(json!({
            "resource_type": RESOURCE_TYPE,
            "config": config,
        }))
    }

    #[test]
    fn parses_standard_form_fields_with_defaults() {
        let plan = open_params(json!({"host": "broker.local"})).expect("最小配置应成功");
        assert_eq!(plan.config.host, "broker.local");
        assert_eq!(plan.config.port, 1883);
        assert_eq!(plan.config.keep_alive_secs, 60);
        assert!(plan.config.client_id.is_empty());
        assert!(plan.config.username.is_none());
        assert!(!plan.config.use_tls);
        assert!(plan.config.clean_session);
        assert!(matches!(plan.password, PendingPassword::None));
    }

    #[test]
    fn keeps_explicit_fields_and_trims() {
        let plan = open_params(json!({
            "host": " broker.local ",
            "port": 8883,
            "username": " alice ",
            "client_id": " my-client ",
            "keep_alive_secs": 30,
            "use_tls": true,
        }))
        .expect("完整配置应成功");
        assert_eq!(plan.config.host, "broker.local");
        assert_eq!(plan.config.port, 8883);
        assert_eq!(plan.config.username.as_deref(), Some("alice"));
        assert_eq!(plan.config.client_id, "my-client");
        assert_eq!(plan.config.keep_alive_secs, 30);
        assert!(plan.config.use_tls);
    }

    #[test]
    fn password_ref_wins_over_plaintext() {
        let plan = open_params(json!({
            "host": "broker.local",
            "password": "plain",
            "credential_refs": {"password": "secret://self/7:password"},
        }))
        .expect("配置应成功");
        let PendingPassword::Reference(reference) = plan.password else {
            panic!("应优先使用 secret 引用");
        };
        assert_eq!(reference.secret_ref, "secret://self/7:password");
    }

    #[test]
    fn plaintext_password_is_tolerated() {
        let plan = open_params(json!({
            "host": "broker.local",
            "password": "plain",
        }))
        .expect("配置应成功");
        assert!(matches!(plan.password, PendingPassword::Direct(secret) if secret == "plain"));
    }

    #[test]
    fn empty_host_is_rejected_with_config_prefix() {
        let error = open_params(json!({"host": "  "})).expect_err("空 host 应失败");
        assert!(error.message.contains("配置错误:"));
    }

    #[test]
    fn wrong_resource_type_is_rejected() {
        let error = parse_open_params(json!({
            "resource_type": "something-else",
            "config": {"host": "broker.local"},
        }))
        .expect_err("资源类型不匹配应失败");
        assert!(error.message.contains("配置错误:"));
    }

    #[test]
    fn invalid_field_types_are_rejected() {
        let error = open_params(json!({"host": "broker.local", "port": "not-a-number"}))
            .expect_err("非法端口应失败");
        assert!(error.message.contains("配置错误:"));
    }
}
