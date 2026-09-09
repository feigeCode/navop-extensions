//! 中间件标准契约再导出:类型与常量统一来自 `middleware-contract`(middleware-base)。
//!
//! > 标准 `middleware-base/docs/middleware-standard.md` §3 是唯一事实源;
//! > 本模块不再持有本地副本,保证与其他实现扩展(rocketmq-provider)与共享控制台
//! > UI(base.js)消费的序列化形状完全一致。
//! > 仅再导出本 provider 实际消费的类型;完整契约(MQTT 用不到的集群/订阅组队列
//! > 统计等)见 `middleware_contract` crate 本体。
//!
//! 历史:该 crate 就绪前本文件曾按标准 §3 的 JSON 形状临时定义契约类型,
//! 就绪后已整体切换为再导出(字段与 serde 属性逐字一致,行为不变)。

pub(crate) use middleware_contract::{
    CapabilitiesResponse, ClientListResponse, ClusterOverview, CreateTopicRequest,
    GroupConsumeDetail, GroupListResponse, MessagePage, MessageQuery, MetricsResponse,
    MiddlewareCapabilities, MiddlewareClientInfo, MiddlewareError, MiddlewareGroupInfo,
    MiddlewareMessage, MiddlewareMetrics, MiddlewareTopicInfo, STANDARD_VERSION,
    SendMessageRequest, SendResult, TopicDetail, TopicListResponse,
};

/// 标准方法名常量(标准 §3),分发与 open 能力声明统一取自契约 crate
pub(crate) use middleware_contract::methods;

#[cfg(test)]
mod tests {
    // 以下测试源自临时契约时期,切换后继续守护正式契约 crate 与 MQTT provider
    // 的预期一致:外标签查询枚举、字节数组消息体、缺字段容忍与标准错误前缀。
    use super::*;
    use serde::{Serialize, de::DeserializeOwned};

    /// serde 往返断言辅助:序列化后再反序列化应得到相等结构
    fn assert_roundtrip<T>(value: &T)
    where
        T: Serialize + DeserializeOwned + PartialEq + std::fmt::Debug,
    {
        let json = serde_json::to_string(value).expect("序列化失败");
        let back: T = serde_json::from_str(&json).expect("反序列化失败");
        assert_eq!(&back, value, "serde 往返不一致, json = {json}");
    }

    #[test]
    fn message_query_uses_external_tag_shape() {
        // 标准 §3:tagged enum 序列化为 {"ByTimeWindow":{...}} 外标签格式
        let query = MessageQuery::ByTimeWindow {
            topic: "sensors/#".into(),
            begin_unix_ms: 0,
            end_unix_ms: i64::MAX,
            page: 1,
            page_size: 20,
        };
        let json = serde_json::to_string(&query).expect("序列化失败");
        assert!(json.starts_with(r#"{"ByTimeWindow":"#), "实际: {json}");
        assert_roundtrip(&query);

        let by_key = MessageQuery::ByKey {
            topic: "#".into(),
            key: "order".into(),
        };
        assert_roundtrip(&by_key);

        let by_id = MessageQuery::ById {
            topic: "a/b".into(),
            message_id: "mqtt-1".into(),
        };
        assert_roundtrip(&by_id);
    }

    #[test]
    fn message_query_accepts_external_tag_input() {
        let query: MessageQuery = serde_json::from_value(serde_json::json!({
            "ByKey": {"topic": "#", "key": "hello"}
        }))
        .expect("外标签格式应可反序列化");
        assert_eq!(
            query,
            MessageQuery::ByKey {
                topic: "#".into(),
                key: "hello".into(),
            }
        );
    }

    #[test]
    fn models_tolerate_missing_fields() {
        // 契约向前兼容:JSON 缺失字段时按默认值反序列化
        let topic: MiddlewareTopicInfo =
            serde_json::from_str(r#"{"name":"only-name"}"#).expect("缺失字段应可反序列化");
        assert_eq!(topic.name, "only-name");
        assert_eq!(topic.topic_type, None);

        let page: MessagePage = serde_json::from_str("{}").expect("空对象应可反序列化");
        assert!(page.messages.is_empty());
        assert_eq!(page.total, 0);
        assert!(!page.has_more);
    }

    #[test]
    fn send_request_body_is_byte_array() {
        let request = SendMessageRequest {
            topic: "a/b".into(),
            body: vec![104, 105],
            properties: vec![("qos".into(), "1".into())],
            ..SendMessageRequest::default()
        };
        let json = serde_json::to_string(&request).expect("序列化失败");
        assert!(json.contains(r#""body":[104,105]"#), "实际: {json}");
        assert_roundtrip(&request);
    }

    #[test]
    fn middleware_error_display_carries_standard_prefix() {
        assert_eq!(
            MiddlewareError::Config("缺少 host".into()).to_string(),
            "配置错误: 缺少 host"
        );
        assert_eq!(
            MiddlewareError::Unsupported("当前中间件不支持该能力: groups".into()).to_string(),
            "不支持的操作: 当前中间件不支持该能力: groups"
        );
        assert_eq!(
            MiddlewareError::Auth("broker 拒绝连接".into()).to_string(),
            "认证错误: broker 拒绝连接"
        );
    }
}
