//! 资源生命周期与 `middleware/*` 方法分发(标准 §3 资源方法契约)。

use std::sync::Arc;

use extension_protocol::{
    blob::{BlobCloseParams, BlobReadParams},
    resource::{ResourceCloseParams, ResourceInvokeParams, ResourceOpenResult, ResourcePingParams},
};
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use crate::admin::RocketmqConnection;
use crate::config::{PendingOpen, parse_open_params};
use crate::contract::{
    self, CapabilitiesResponse, ClientListResponse, CreateTopicRequest, GroupListResponse,
    MessageQuery, MetricsResponse, SendMessageRequest, TopicListResponse,
};
use crate::error::{
    ProviderResult, invalid_params, middleware_error, parse_params, resource_error, serialize,
};
use crate::ipc::{IpcParts, resolve_secret};
use crate::state::{ProviderState, RESOURCE_ID};

/// 标准方法名分发与 open 能力声明统一取自契约 crate(标准 §3)
use contract::methods;

/// RocketMQ 专用方法(非标准 §3,标准外的运维能力)
const RESET_OFFSET_METHOD: &str = "rocketmq/consumer/reset-offset";

pub(super) async fn open<R, W>(
    ipc: &mut IpcParts<R, W>,
    state: &mut ProviderState,
    params: Value,
) -> ProviderResult
where
    R: AsyncReadExt + Unpin,
    W: AsyncWriteExt + Unpin,
{
    let pending = parse_open_params(params)?;
    let PendingOpen {
        mut params,
        secret_ref,
    } = pending;
    // secret 引用经宿主反向解析后注入(acl=rocketmq 时)
    if let Some(reference) = &secret_ref {
        let secret = resolve_secret(ipc, reference, state.reverse_request_id()).await?;
        let secret = String::from_utf8(secret)
            .map_err(|_| invalid_params("配置错误: RocketMQ SecretKey 不是合法 UTF-8 文本"))?;
        if secret.trim().is_empty() {
            return Err(invalid_params("配置错误: SecretKey 不能为空"));
        }
        params.secret_key = Some(secret);
    }

    let connection = RocketmqConnection::new(Arc::new(params)).map_err(middleware_error)?;
    // 建立到 NameServer 的 Remoting 连接并验证可达
    connection
        .test_connection()
        .await
        .map_err(middleware_error)?;
    let acl_enabled = connection_acl_enabled(&connection);
    let namesrv = connection.params().server_info();
    let resource_id = state.insert_resource(connection).await;
    serialize(ResourceOpenResult {
        resource_id,
        capabilities: {
            let mut capabilities: Vec<String> = methods::ALL
                .iter()
                .map(|method| method.to_string())
                .collect();
            capabilities.push(RESET_OFFSET_METHOD.to_string());
            capabilities
        },
        metadata: Some(json!({
            "standard_version": contract::STANDARD_VERSION,
            "resource": "rocketmq",
            "namesrv_addrs": namesrv,
            "acl_enabled": acl_enabled,
            "protocol": "rocketmq-remoting-json",
            "network": true,
        })),
    })
}

/// 连接是否启用 ACL(经 RemotingClient 侧判定,签名实际生效)
fn connection_acl_enabled(connection: &RocketmqConnection) -> bool {
    connection.acl_enabled()
}

pub(super) fn ping(state: &ProviderState, params: Value) -> ProviderResult {
    let params: ResourcePingParams = parse_params(params)?;
    if params.resource_id != RESOURCE_ID || state.resource().is_none() {
        return Err(resource_error());
    }
    Ok(Value::Null)
}

pub(super) async fn invoke(state: &mut ProviderState, params: Value) -> ProviderResult {
    let params: ResourceInvokeParams = parse_params(params)?;
    if params.resource_id != RESOURCE_ID {
        return Err(resource_error());
    }
    let Some(connection) = state.resource() else {
        return Err(resource_error());
    };
    let value = dispatch_method(connection, &params.method, params.params)
        .await
        .map_err(middleware_error)?;
    serialize(state.blob_result(&params.resource_id, value)?)
}

/// 响应模型 → JSON(序列化失败归一化为协议错误)
fn to_value<T: serde::Serialize>(value: T) -> Result<Value, crate::contract::MiddlewareError> {
    serde_json::to_value(value)
        .map_err(|error| crate::contract::MiddlewareError::Protocol(error.to_string()))
}

/// 按 §3 分发到管理接口;错误统一为带标准前缀的 MiddlewareError
async fn dispatch_method(
    connection: &RocketmqConnection,
    method: &str,
    params: Value,
) -> Result<Value, crate::contract::MiddlewareError> {
    match method {
        methods::CAPABILITIES => to_value(CapabilitiesResponse {
            standard_version: contract::STANDARD_VERSION,
            capabilities: connection.capabilities(),
        }),
        methods::METRICS => to_value(MetricsResponse {
            metrics: connection.metrics_snapshot().await?,
        }),
        methods::CLUSTER_OVERVIEW => to_value(connection.cluster_overview().await?),
        methods::TOPIC_LIST => to_value(TopicListResponse {
            topics: connection.list_topics().await?,
        }),
        methods::TOPIC_DETAIL => {
            let topic = require_topic(&params)?;
            to_value(connection.topic_detail(&topic).await?)
        }
        methods::TOPIC_CREATE => {
            let request: CreateTopicRequest = parse_method_params(&params)?;
            connection.create_topic(request).await?;
            Ok(json!({}))
        }
        methods::TOPIC_UPDATE => {
            let request: CreateTopicRequest = parse_method_params(&params)?;
            connection.update_topic(request).await?;
            Ok(json!({}))
        }
        methods::TOPIC_DELETE => {
            let topic = require_topic(&params)?;
            connection.delete_topic(&topic).await?;
            Ok(json!({}))
        }
        methods::GROUP_LIST => to_value(GroupListResponse {
            groups: connection.list_groups().await?,
        }),
        methods::GROUP_DETAIL => {
            let group = require_group(&params)?;
            to_value(connection.group_detail(&group).await?)
        }
        methods::GROUP_CLIENTS => {
            let group = require_group(&params)?;
            to_value(ClientListResponse {
                clients: connection.group_clients(&group).await?,
            })
        }
        methods::MESSAGE_QUERY => {
            let query: MessageQuery = parse_method_params(&params)?;
            to_value(connection.query_messages(query).await?)
        }
        methods::MESSAGE_SEND => {
            let request: SendMessageRequest = parse_method_params(&params)?;
            to_value(connection.send_message(request).await?)
        }
        RESET_OFFSET_METHOD => {
            let group = require_group(&params)?;
            let topic = require_topic(&params)?;
            let timestamp_ms = params
                .get("timestamp")
                .and_then(|value| match value {
                    Value::Number(number) => number.as_i64(),
                    Value::String(text) => text
                        .trim()
                        .parse::<i64>()
                        .ok()
                        // 字符串可为空(缺省重置到当前时刻)
                        .filter(|_| !text.trim().is_empty()),
                    _ => None,
                })
                .unwrap_or_else(|| chrono::Utc::now().timestamp_millis());
            connection
                .reset_consumer_offset(&group, &topic, timestamp_ms)
                .await
        }
        _ => Err(crate::contract::MiddlewareError::Unsupported(format!(
            "未知方法: {method}"
        ))),
    }
}

/// 解析方法参数(serde 失败归一化为配置错误)
fn parse_method_params<T: serde::de::DeserializeOwned>(
    params: &Value,
) -> Result<T, crate::contract::MiddlewareError> {
    serde_json::from_value(params.clone())
        .map_err(|error| crate::contract::MiddlewareError::Config(format!("参数解析失败: {error}")))
}

/// 提取 `{"topic": string}`
fn require_topic(params: &Value) -> Result<String, crate::contract::MiddlewareError> {
    let topic = params
        .get("topic")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|topic| !topic.is_empty())
        .ok_or_else(|| crate::contract::MiddlewareError::Config("缺少非空 topic 参数".into()))?;
    Ok(topic.to_string())
}

/// 提取 `{"group": string}`
fn require_group(params: &Value) -> Result<String, crate::contract::MiddlewareError> {
    let group = params
        .get("group")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|group| !group.is_empty())
        .ok_or_else(|| crate::contract::MiddlewareError::Config("缺少非空 group 参数".into()))?;
    Ok(group.to_string())
}

pub(super) async fn close(state: &mut ProviderState, params: Value) -> ProviderResult {
    let params: ResourceCloseParams = parse_params(params)?;
    if !state.close_resource(&params.resource_id).await {
        return Err(resource_error());
    }
    Ok(Value::Null)
}

pub(super) fn read_blob(state: &mut ProviderState, params: Value) -> ProviderResult {
    let params: BlobReadParams = parse_params(params)?;
    serialize(state.read_blob(params)?)
}

pub(super) fn close_blob(state: &mut ProviderState, params: Value) -> ProviderResult {
    let params: BlobCloseParams = parse_params(params)?;
    state.close_blob(params);
    Ok(Value::Null)
}
