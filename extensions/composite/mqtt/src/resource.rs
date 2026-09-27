//! MQTT 中间件资源:持有一个连接与其管理适配器,按标准 §3 分发 `middleware/*` 方法。
//!
//! 方法名常量与响应包装类型统一取自契约模块(`middleware_contract`),
//! 与 rocketmq-provider 的分发写法保持一致。

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};

use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::RwLock;

use crate::admin::MqttAdminAdapter;
use crate::builtin::MqttConnectionImpl;
use crate::connection::MqttConnection;
use crate::contract::{
    self, CapabilitiesResponse, ClientListResponse, CreateTopicRequest, GroupListResponse,
    MessageQuery, MetricsResponse, MiddlewareError, SendMessageRequest, TopicListResponse,
};
use crate::error::{ProviderResult, boxed_error, invalid_params, middleware_error, serialize};
use crate::host_state::{StoredProfile, StoredSubscription, now_unix_ms, save_profile};
use crate::ipc::IpcParts;
use crate::pubsub::MqttPubSubHandle;
use crate::types::{MqttConnectionConfig, MqttSubscription};
use extension_protocol::error::error_codes;

/// 标准方法名分发与 open 能力声明统一取自契约 crate(标准 §3)
use contract::methods;

/// 订阅画像的宿主 KV 持久化状态(每个资源一份)。
///
/// 宿主 KV 在部分版本里是桩实现(写成功但读回永远为空),因此 `persistence_ok`
/// 是**实测结论**而不是乐观假设:写后读回一次,读不回就置 false,并让 UI 如实
/// 说明「本机宿主未启用订阅持久化,重启后订阅会丢」,而不是默默丢数据。
pub(crate) struct ProfileState {
    /// 宿主 KV 中的画像键(按 host/port/tls/username/显式 client_id 派生)
    key: String,
    /// 宿主 KV 是否真的落盘
    persistence_ok: AtomicBool,
    /// 本次 open 从 KV 恢复的订阅条数
    restored_subscriptions: usize,
}

impl ProfileState {
    pub(crate) fn new(key: String, restored_subscriptions: usize) -> Self {
        Self {
            key,
            persistence_ok: AtomicBool::new(false),
            restored_subscriptions,
        }
    }

    fn enabled(&self) -> bool {
        !self.key.is_empty() && self.persistence_ok.load(Ordering::Relaxed)
    }
}

/// 一个已打开的 MQTT 资源:连接 + 管理适配器
pub(crate) struct MqttResource {
    connection: Arc<RwLock<Box<dyn MqttConnection>>>,
    admin: MqttAdminAdapter,
    profile: ProfileState,
}

impl MqttResource {
    /// 建立连接并创建资源(open 即连接测试:连不上即失败)。
    ///
    /// `seed` 是从宿主 KV 恢复出来的订阅:在**建立连接之前**写进本地订阅表,
    /// 于是首次 ConnAck 就会把它们 SUBSCRIBE 回去(provider 重启后订阅不会丢)。
    pub(crate) async fn connect(
        config: MqttConnectionConfig,
        seed: Vec<MqttSubscription>,
        profile: ProfileState,
    ) -> Result<Self, Box<extension_protocol::error::ProtocolError>> {
        let mut connection = MqttConnectionImpl::new(config);
        if !seed.is_empty() {
            connection
                .seed_subscriptions(seed)
                .await
                .map_err(|error| middleware_error(error.into()))?;
        }
        connection
            .connect()
            .await
            .map_err(|error| middleware_error(error.into()))?;
        let connection: Arc<RwLock<Box<dyn MqttConnection>>> =
            Arc::new(RwLock::new(Box::new(connection)));
        let admin = MqttAdminAdapter::new(Arc::clone(&connection));
        Ok(Self {
            connection,
            admin,
            profile,
        })
    }

    /// open 响应元数据(不含任何凭据)
    pub(crate) async fn metadata(&self) -> Value {
        let guard = self.connection.read().await;
        let config = guard.config();
        json!({
            "standard_version": contract::STANDARD_VERSION,
            "client": "rumqttc",
            "mqtt_version": crate::types::MQTT_PROTOCOL_VERSION,
            "broker": config.server_info(),
            "client_id": config.client_id,
            "tls": config.use_tls,
            "clean_session": config.clean_session,
            "auto_subscribe": config.auto_subscribe,
            // 实时消息事件流的 kind:UI 用它调用 navop.event.open (见标准 §5.2)
            "message_stream_kind": crate::state::MQTT_MESSAGE_EVENT_KIND,
            // 订阅持久化实况:UI 据此提示"订阅已从上次会话恢复"或"本机宿主不支持持久化"
            "persistence": if self.profile.enabled() { "host" } else { "unavailable" },
            "restored_subscriptions": self.profile.restored_subscriptions,
        })
    }

    /// 把当前订阅表写回宿主 KV(best-effort:任何失败都不影响订阅本身)。
    ///
    /// 只存**用户手工订阅**:`auto_subscribe` 那条来自连接配置,重连时会自动加回,
    /// 存下来反而会在用户改配置后复活成幽灵订阅。
    pub(crate) async fn persist_subscriptions<R, W>(
        &self,
        ipc: &mut IpcParts<R, W>,
        next_id: &AtomicI64,
    ) -> bool
    where
        R: AsyncReadExt + Unpin,
        W: AsyncWriteExt + Unpin,
    {
        if self.profile.key.is_empty() {
            return false;
        }
        let (client_id, subscriptions) = {
            let guard = self.connection.read().await;
            let config = guard.config();
            let subscriptions = match guard.list_subscriptions().await {
                Ok(subscriptions) => subscriptions,
                Err(error) => {
                    eprintln!("mqtt: skip persisting subscriptions: {error}");
                    return false;
                }
            };
            (config.client_id.clone(), subscriptions)
        };
        let auto_filter = {
            let guard = self.connection.read().await;
            guard.config().auto_subscribe.trim().to_string()
        };
        let profile = StoredProfile {
            version: crate::host_state::PROFILE_VERSION,
            client_id: (!client_id.trim().is_empty()).then_some(client_id),
            subscriptions: subscriptions
                .iter()
                .filter(|subscription| {
                    auto_filter.is_empty() || subscription.topic_filter != auto_filter
                })
                .map(StoredSubscription::from_subscription)
                .collect(),
            updated_at_ms: now_unix_ms(),
        };
        match save_profile(ipc, &self.profile.key, &profile, next_id).await {
            Ok(true) => {
                self.profile.persistence_ok.store(true, Ordering::Relaxed);
                true
            }
            Ok(false) => {
                // 宿主 KV 是桩实现(写成功但读回为空):记下来,别再让 UI 误以为已保存
                self.profile.persistence_ok.store(false, Ordering::Relaxed);
                eprintln!(
                    "mqtt: host storage is not durable; subscriptions will not survive a restart"
                );
                false
            }
            Err(error) => {
                self.profile.persistence_ok.store(false, Ordering::Relaxed);
                eprintln!("mqtt: failed to persist subscriptions: {error}");
                false
            }
        }
    }

    /// 为该连接的实时消息流打开一个独立的广播接收端。
    ///
    /// 与管理适配器的内部接收端互不影响(broadcast 多接收端语义)。
    pub(crate) async fn open_pubsub(&self) -> Result<MqttPubSubHandle, MiddlewareError> {
        self.admin.open_pubsub_handle().await
    }

    /// 断开连接(资源关闭时调用)
    pub(crate) async fn disconnect(&self) {
        let mut guard = self.connection.write().await;
        let _ = guard.disconnect().await;
    }

    /// 按 §3 分发资源方法
    pub(crate) async fn invoke(&self, method: &str, params: Value) -> ProviderResult {
        match method {
            methods::CAPABILITIES => self.capabilities(),
            methods::METRICS => {
                let metrics = self
                    .admin
                    .metrics_snapshot()
                    .await
                    .map_err(middleware_error)?;
                serialize(MetricsResponse { metrics })
            }
            methods::CLUSTER_OVERVIEW => {
                let overview = self
                    .admin
                    .cluster_overview()
                    .await
                    .map_err(middleware_error)?;
                serialize(overview)
            }
            methods::TOPIC_LIST => {
                let topics = self.admin.list_topics().await.map_err(middleware_error)?;
                serialize(TopicListResponse { topics })
            }
            methods::TOPIC_DETAIL => {
                let topic = topic_param(&params)?;
                let detail = self.admin.topic_detail(&topic).map_err(middleware_error)?;
                serialize(detail)
            }
            methods::TOPIC_CREATE => {
                // 标准 §3:创建 Topic;MQTT 语义为订阅该主题过滤器。
                let request: CreateTopicRequest = parse_request(&params)?;
                self.admin
                    .create_topic(request)
                    .await
                    .map(|()| Value::Null)
                    .map_err(middleware_error)
            }
            methods::TOPIC_UPDATE => {
                // 标准的 Topic 更新;MQTT 语义为以新 QoS 重新订阅(覆盖式)。
                let request: CreateTopicRequest = parse_request(&params)?;
                self.admin
                    .update_topic(request)
                    .await
                    .map(|()| Value::Null)
                    .map_err(middleware_error)
            }
            methods::TOPIC_DELETE => {
                // 标准的 Topic 删除;MQTT 语义为取消订阅该主题过滤器。
                let topic = topic_param(&params)?;
                self.admin
                    .delete_topic(&topic)
                    .await
                    .map(|()| Value::Null)
                    .map_err(middleware_error)
            }
            methods::GROUP_LIST => {
                let groups = self.admin.list_groups().map_err(middleware_error)?;
                serialize(GroupListResponse { groups })
            }
            methods::GROUP_DETAIL => {
                let _ = group_param(&params)?;
                self.admin
                    .group_detail()
                    .map(|_| Value::Null)
                    .map_err(middleware_error)
            }
            methods::GROUP_CLIENTS => {
                let group = group_param(&params)?;
                let clients = self
                    .admin
                    .group_clients(&group)
                    .await
                    .map_err(middleware_error)?;
                serialize(ClientListResponse { clients })
            }
            methods::MESSAGE_QUERY => {
                let query: MessageQuery = parse_request(&params)?;
                let page = self
                    .admin
                    .query_messages(query)
                    .await
                    .map_err(middleware_error)?;
                serialize(page)
            }
            methods::MESSAGE_SEND => {
                let request: SendMessageRequest = parse_request(&params)?;
                let result = self
                    .admin
                    .send_message(request)
                    .await
                    .map_err(middleware_error)?;
                serialize(result)
            }
            // 实时消息事件流返回的是事件流引用而不是 JSON,且需要 `&mut ProviderState`
            // 登记流表,因此在 `server/resource.rs::invoke` 进入本分发**之前**特判。
            // 这里保留显式分支:一旦那条特判被摘掉,报错要说清是被绕过的路由,
            // 而不是含糊的 "unknown method"。
            methods::MESSAGE_STREAM => Err(boxed_error(
                error_codes::METHOD_NOT_FOUND,
                "middleware/message/stream 由 server/resource.rs::invoke 特判,不应到达资源分发",
            )),
            _ => Err(boxed_error(
                error_codes::METHOD_NOT_FOUND,
                format!("unknown MQTT middleware method `{method}`"),
            )),
        }
    }

    /// 能力位响应(CapabilitiesResponse,标准 §3)
    fn capabilities(&self) -> ProviderResult {
        serialize(CapabilitiesResponse {
            standard_version: contract::STANDARD_VERSION,
            capabilities: self.admin.capabilities(),
        })
    }
}

/// 解析 `{"topic": string}` 参数
fn topic_param(params: &Value) -> Result<String, Box<extension_protocol::error::ProtocolError>> {
    let topic = params
        .get("topic")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|topic| !topic.is_empty())
        .ok_or_else(|| invalid_params("配置错误: `topic` 不能为空"))?;
    Ok(topic.to_string())
}

/// 解析 `{"group": string}` 参数
fn group_param(params: &Value) -> Result<String, Box<extension_protocol::error::ProtocolError>> {
    let group = params
        .get("group")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|group| !group.is_empty())
        .ok_or_else(|| invalid_params("配置错误: `group` 不能为空"))?;
    Ok(group.to_string())
}

/// 解析 tagged enum / 结构化请求参数(MessageQuery、SendMessageRequest、CreateTopicRequest)
fn parse_request<T: serde::de::DeserializeOwned>(
    params: &Value,
) -> Result<T, Box<extension_protocol::error::ProtocolError>> {
    serde_json::from_value(params.clone())
        .map_err(|error| invalid_params(format!("配置错误: 无效的请求参数: {error}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn contract_methods_cover_standard_table() {
        // 标准 §3 方法表逐项核对(方法名常量取自契约 crate,此处守护分发完整性)
        let expected = [
            "middleware/capabilities",
            "middleware/metrics",
            "middleware/cluster/overview",
            "middleware/topic/list",
            "middleware/topic/detail",
            "middleware/topic/create",
            "middleware/topic/update",
            "middleware/topic/delete",
            "middleware/group/list",
            "middleware/group/detail",
            "middleware/group/clients",
            "middleware/message/query",
            "middleware/message/send",
            // 实时消息事件流(宿主 event/* 的 invoke 等价入口,见 server/resource.rs)
            "middleware/message/stream",
        ];
        for method in expected {
            assert!(methods::ALL.contains(&method), "缺少方法 {method}");
        }
        assert_eq!(methods::ALL.len(), 14);
    }

    #[test]
    fn topic_param_requires_non_empty_topic() {
        assert!(topic_param(&json!({"topic": "a/b"})).is_ok());
        assert!(topic_param(&json!({"topic": "  "})).is_err());
        assert!(topic_param(&json!({})).is_err());
    }

    #[test]
    fn group_param_requires_non_empty_group() {
        assert!(group_param(&json!({"group": "g1"})).is_ok());
        assert!(group_param(&json!({"group": ""})).is_err());
    }
}
