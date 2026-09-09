//! resource/open 参数解析:标准 §4 RocketMQ 连接表单 → [`RocketmqParams`]。
//!
//! 表单字段:
//! - `namesrv_addrs`(Text,必填;数组或分号/逗号分隔字符串皆可);
//! - `acl_enabled`(Select: none/rocketmq,默认 none);
//! - `access_key`(Text,visibleWhen acl=rocketmq);
//! - `secret_key`(Password,secret,visibleWhen acl=rocketmq;
//!   宿主注入 `credential_refs["secret_key"]` = `secret://self/...` 引用);
//! - `timeout_ms`(Number,默认 5000,映射请求超时)。

use std::collections::BTreeMap;

use extension_protocol::{conn::SecretRef, resource::ResourceOpenParams};
use serde_json::{Value, from_value};

use crate::error::invalid_params;
use crate::state::RESOURCE_TYPE;
use crate::types::RocketmqParams;

/// 待解析的 open 请求:参数 + 可选 secret 引用
pub(crate) struct PendingOpen {
    pub(crate) params: RocketmqParams,
    /// secret_key 的宿主引用(acl=rocketmq 时经 ResolveSecret 反向解析)
    pub(crate) secret_ref: Option<SecretRef>,
}

pub(crate) fn parse_open_params(params: Value) -> Result<PendingOpen, Box<extension_protocol::error::ProtocolError>> {
    let params: ResourceOpenParams =
        from_value(params).map_err(|error| invalid_params(error.to_string()))?;
    if params.resource_type != RESOURCE_TYPE {
        return Err(invalid_params(format!(
            "配置错误: resource type 必须为 `{RESOURCE_TYPE}`"
        )));
    }
    let config = params.config;
    if !config.is_object() {
        return Err(invalid_params("配置错误: config 应为 JSON 对象"));
    }
    let map = config.as_object().expect("已校验为对象");

    let acl_enabled = map
        .get("acl_enabled")
        .and_then(Value::as_str)
        .unwrap_or("none")
        .trim()
        .to_ascii_lowercase();
    let credential_refs: BTreeMap<String, String> = map
        .get("credential_refs")
        .and_then(|value| from_value(value.clone()).ok())
        .unwrap_or_default();

    let mut normalized = map.clone();
    match acl_enabled.as_str() {
        "none" => {
            // 未启用 ACL:忽略可能残留的密钥字段,避免误签名
            normalized.remove("access_key");
            normalized.remove("secret_key");
        }
        "rocketmq" => {
            let access_key = map
                .get("access_key")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| {
                    invalid_params("配置错误: acl_enabled=rocketmq 需要非空 access_key")
                })?;
            normalized.insert("access_key".into(), Value::String(access_key.to_string()));
            let secret_ref = credential_refs
                .get("secret_key")
                .filter(|value| !value.trim().is_empty())
                .map(|value| SecretRef::new(value.clone()))
                .ok_or_else(|| {
                    invalid_params("配置错误: acl_enabled=rocketmq 缺少 secret_key 凭据引用")
                })?;
            // 引用形态:占位非空值,待宿主解析后覆盖
            normalized.insert(
                "secret_key".into(),
                Value::String("pending://secret_key".into()),
            );
            let params = RocketmqParams::try_from(&normalized)
                .map_err(|error| invalid_params(error.to_string()))?;
            return Ok(PendingOpen {
                params,
                secret_ref: Some(secret_ref),
            });
        }
        other => {
            return Err(invalid_params(format!(
                "配置错误: 不支持的 acl_enabled 取值 `{other}`(应为 none/rocketmq)"
            )));
        }
    }

    let params = RocketmqParams::try_from(&normalized)
        .map_err(|error| invalid_params(error.to_string()))?;
    Ok(PendingOpen {
        params,
        secret_ref: None,
    })
}
