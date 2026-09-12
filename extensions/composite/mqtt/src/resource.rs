//! MQTT 中间件资源:持有一个连接与其管理适配器,按标准 §3 分发 `middleware/*` 方法。
//!
//! 方法名常量与响应包装类型统一取自契约 crate(`middleware_contract`),
//! 与 rocketmq-provider 的分发写法保持一致。

use std::sync::Arc;

use serde_json::{Value, json};
use tokio::sync::RwLock;

use crate::admin::MqttAdminAdapter;
use crate::builtin::MqttConnectionImpl;
use crate::connection::MqttConnection;
use crate::contract::{
    self, CapabilitiesResponse, ClientListResponse, CreateTopicRequest, GroupListResponse,
    MessageQuery, MetricsResponse, SendMessageRequest, TopicListResponse,
};
use crate::error::{ProviderResult, boxed_error, invalid_params, middleware_error, serialize};
use crate::types::MqttConnectionConfig;
use extension_protocol::error::error_codes;

/// 标准方法名分发与 open 能力声明统一取自契约 crate(标准 §3)
use contract::methods;

/// 一个已打开的 MQTT 资源:连接 + 管理适配器
pub(crate) struct MqttResource {
    connection: Arc<RwLock<Box<dyn MqttConnection>>>,
    admin: MqttAdminAdapter,
}

impl MqttResource {
    /// 建立连接并创建资源(open 即连接测试:连不上即失败)
    pub(crate) async fn connect(
        config: MqttConnectionConfig,
    ) -> Result<Self, Box<extension_protocol::error::ProtocolError>> {
        let mut connection = MqttConnectionImpl::new(config);
        connection
            .connect()
            .await
            .map_err(|error| middleware_error(error.into()))?;
        let connection: Arc<RwLock<Box<dyn MqttConnection>>> =
            Arc::new(RwLock::new(Box::new(connection)));
        let admin = MqttAdminAdapter::new(Arc::clone(&connection));
        Ok(Self { connection, admin })
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
            "auto_subscribe": "#",
        })
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
        ];
        for method in expected {
            assert!(methods::ALL.contains(&method), "缺少方法 {method}");
        }
        assert_eq!(methods::ALL.len(), 13);
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
