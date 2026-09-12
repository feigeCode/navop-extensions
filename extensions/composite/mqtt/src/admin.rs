//! MQTT 标准管理适配器:把 [`MqttConnection`] 包装为标准 §3 的资源方法逻辑。
//!
//! 移植自主仓 `crates/mqtt-runtime/src/admin.rs` 的 `MqttAdminAdapter`,
//! 数据模型换成 [`crate::contract`] 的临时契约类型。适配策略(标准属性 -> MQTT 语义映射):
//! - `topics` = 当前订阅列表(topic_type=SUBSCRIPTION,queue_count=QoS)
//! - `topic_write` = false(MQTT 无服务端 Topic 管理)
//! - `groups` = false(MQTT 无订阅组概念)
//! - `clients` = 本地连接自身(客户端 ID/语言/版本/订阅列表)
//! - `message_query` = 对本地 pubsub 环形缓冲按 topic/时间过滤;
//!   ByKey 尽力匹配(topic 或 payload 文本包含),ById 匹配缓冲内合成 ID
//! - `send_message` = publish
//! - `metrics` = 本地收发计数(TPS 取最近窗口内的平均速率)
//! - `cluster_overview` = false(MQTT 无集群概念)

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use chrono::{DateTime, Local, NaiveDate, Utc};
use tokio::sync::RwLock;

use crate::connection::MqttConnection;
use crate::contract::{
    ClusterOverview, CreateTopicRequest, GroupConsumeDetail, MessagePage, MessageQuery,
    MiddlewareCapabilities, MiddlewareClientInfo, MiddlewareError, MiddlewareGroupInfo,
    MiddlewareMessage, MiddlewareMetrics, MiddlewareTopicInfo, SendMessageRequest, SendResult,
    TopicDetail,
};
use crate::pubsub::MqttPubSubHandle;
use crate::types::{MqttMessage, MqttQos, MqttSubscription};

/// 管理视图消息环形缓冲上限,超出丢最旧
pub(crate) const MQTT_ADMIN_BUFFER_CAPACITY: usize = 1000;

/// TPS 统计窗口(秒):取窗口内平均速率
const TPS_WINDOW_SECS: i64 = 5;

/// 发送消息默认 QoS(未在 properties 中指定 "qos" 时)
const DEFAULT_SEND_QOS: MqttQos = MqttQos::AtLeastOnce;

/// 缓冲消息:携带合成 ID("mqtt-<seq>",seq 单调递增,供 ById 查询)
#[derive(Clone, Debug)]
pub(crate) struct BufferedMessage {
    /// 合成消息 ID("mqtt-<seq>")
    pub id: String,
    /// 原始 MQTT 消息
    pub message: MqttMessage,
}

/// 管理适配器内部状态(纯数据,便于单测)
#[derive(Debug, Default)]
pub(crate) struct AdminInnerState {
    /// 消息环形缓冲
    pub buffer: VecDeque<BufferedMessage>,
    /// 下一个序号
    pub next_seq: u64,
    /// 累计接收消息数
    pub received_total: u64,
    /// 累计发送消息数
    pub sent_total: u64,
    /// 今日接收消息数(本地日期翻转时清零)
    pub received_today: u64,
    /// 今日日期(本地时区)
    pub today: Option<NaiveDate>,
    /// 最近接收时间戳(用于 TPS 统计,容量与缓冲一致)
    pub recent_received: VecDeque<DateTime<Utc>>,
    /// 最近发送时间戳(用于 TPS 统计)
    pub recent_sent: VecDeque<DateTime<Utc>>,
}

/// MQTT 标准管理适配器
///
/// 包持一个连接的共享句柄;首次调用管理方法时惰性打开 pubsub 接收端,
/// 之后每次调用先排水(try_recv)广播缓冲再执行查询,保证计数与消息缓冲尽量新鲜。
pub(crate) struct MqttAdminAdapter {
    /// 共享连接句柄
    connection: Arc<RwLock<Box<dyn MqttConnection>>>,
    /// 内部状态(短临界区,无 await,使用 std Mutex)
    inner: Mutex<AdminInnerState>,
    /// 惰性打开的 pubsub 接收端(仅有一个,保留历史消息)
    receiver: tokio::sync::Mutex<Option<MqttPubSubHandle>>,
}

impl MqttAdminAdapter {
    /// 创建适配器(不立即打开消息流,首次调用管理方法时打开)
    pub(crate) fn new(connection: Arc<RwLock<Box<dyn MqttConnection>>>) -> Self {
        Self {
            connection,
            inner: Mutex::new(AdminInnerState::default()),
            receiver: tokio::sync::Mutex::new(None),
        }
    }

    /// 打开(仅一次)pubsub 接收端
    async fn ensure_receiver(&self) -> Result<(), MiddlewareError> {
        let mut receiver_guard = self.receiver.lock().await;
        if receiver_guard.is_some() {
            return Ok(());
        }
        let guard = self.connection.read().await;
        let handle = guard
            .open_pubsub()
            .map_err(|error| MiddlewareError::Connection(error.to_string()))?;
        *receiver_guard = Some(handle);
        Ok(())
    }

    /// 排水广播缓冲:把接收端 pending 消息并入内部环形缓冲并更新计数
    async fn drain_stream(&self) {
        if self.ensure_receiver().await.is_err() {
            return;
        }
        let mut receiver_guard = self.receiver.lock().await;
        let Some(handle) = receiver_guard.as_mut() else {
            return;
        };
        let mut incoming = Vec::new();
        while let Some(message) = handle.try_recv() {
            incoming.push(message);
        }
        if incoming.is_empty() {
            return;
        }
        let now = Utc::now();
        let mut inner = match self.inner.lock() {
            Ok(inner) => inner,
            Err(poisoned) => poisoned.into_inner(),
        };
        for message in incoming {
            record_received(&mut inner, message, now);
        }
    }

    /// 能力位(标准 §3:MQTT 以「创建/删除 Topic」承载「订阅/取消订阅」)
    pub(crate) fn capabilities(&self) -> MiddlewareCapabilities {
        MiddlewareCapabilities {
            topics: true,
            topic_write: true,
            groups: false,
            clients: true,
            message_query: true,
            send_message: true,
            metrics: true,
            cluster_overview: false,
        }
    }

    /// 集群概览(MQTT 无集群概念,能力位 false,兜底报错)
    pub(crate) async fn cluster_overview(&self) -> Result<ClusterOverview, MiddlewareError> {
        Err(MiddlewareError::unsupported_capability("cluster_overview"))
    }

    /// 指标快照(本地收发计数 + 5 秒 TPS 窗口)
    pub(crate) async fn metrics_snapshot(&self) -> Result<MiddlewareMetrics, MiddlewareError> {
        self.drain_stream().await;
        let subscription_count = {
            let guard = self.connection.read().await;
            guard
                .list_subscriptions()
                .await
                .map_err(|error| MiddlewareError::Connection(error.to_string()))?
                .len() as u64
        };
        let inner = lock_inner(&self.inner);
        Ok(metrics_from_state(&inner, subscription_count, Utc::now()))
    }

    /// Topic 列表 = 当前订阅列表
    pub(crate) async fn list_topics(&self) -> Result<Vec<MiddlewareTopicInfo>, MiddlewareError> {
        self.drain_stream().await;
        let guard = self.connection.read().await;
        let subscriptions = guard
            .list_subscriptions()
            .await
            .map_err(|error| MiddlewareError::Connection(error.to_string()))?;
        Ok(subscriptions.iter().map(sub_to_topic_info).collect())
    }

    /// Topic 详情(MQTT 无服务端队列位点概念,返回空统计)
    pub(crate) fn topic_detail(&self, topic: &str) -> Result<TopicDetail, MiddlewareError> {
        Ok(TopicDetail {
            topic: topic.to_string(),
            stats: Vec::new(),
        })
    }

    /// 创建 Topic = 订阅主题过滤器(标准 §3:MQTT 语义)。
    ///
    /// QoS 取 `CreateTopicRequest.attributes` 里的 `qos`,其次 `queue_count`,
    /// 缺省取默认发送 QoS(AtLeastOnce)。
    pub(crate) async fn create_topic(
        &self,
        request: CreateTopicRequest,
    ) -> Result<(), MiddlewareError> {
        let filter = request.topic.trim().to_string();
        if filter.is_empty() {
            return Err(MiddlewareError::Config(
                "创建的 Topic 名称不能为空".to_string(),
            ));
        }
        let qos = topic_qos(&request);
        let guard = self.connection.read().await;
        guard
            .subscribe(&filter, qos)
            .await
            .map_err(|error| MiddlewareError::Connection(error.to_string()))
    }

    /// 更新 Topic = 以新的 QoS 订阅(覆盖式;broker 侧改为重复订阅,幂等)。
    pub(crate) async fn update_topic(
        &self,
        request: CreateTopicRequest,
    ) -> Result<(), MiddlewareError> {
        self.create_topic(request).await
    }

    /// 删除 Topic = 取消订阅主题过滤器(标准 §3:MQTT 语义)。
    pub(crate) async fn delete_topic(&self, topic: &str) -> Result<(), MiddlewareError> {
        let guard = self.connection.read().await;
        guard
            .unsubscribe(topic)
            .await
            .map_err(|error| MiddlewareError::Connection(error.to_string()))
    }

    /// 发送消息 = publish(QoS 取 properties 中的 "qos",缺省 AtLeastOnce)
    pub(crate) async fn send_message(
        &self,
        request: SendMessageRequest,
    ) -> Result<SendResult, MiddlewareError> {
        let qos = send_qos_from_properties(&request.properties);
        let retain = send_retain_from_properties(&request.properties);
        let guard = self.connection.read().await;
        guard
            .publish(&request.topic, &request.body, qos, retain)
            .await
            .map_err(|error| MiddlewareError::Connection(error.to_string()))?;
        drop(guard);
        let now = Utc::now();
        let mut inner = match self.inner.lock() {
            Ok(inner) => inner,
            Err(poisoned) => poisoned.into_inner(),
        };
        record_sent(&mut inner, now);
        Ok(SendResult {
            // MQTT 协议无 broker 回执消息 ID,使用本地合成 ID
            message_id: format!("mqtt-sent-{}", inner.sent_total),
            status: "OK".to_string(),
        })
    }

    /// 订阅组列表(MQTT 无订阅组概念,能力位 groups=false,兜底报错)
    pub(crate) fn list_groups(&self) -> Result<Vec<MiddlewareGroupInfo>, MiddlewareError> {
        Err(MiddlewareError::unsupported_capability("groups"))
    }

    /// 订阅组客户端:本地连接自身即唯一"客户端"(忽略 group 参数)
    pub(crate) async fn group_clients(
        &self,
        _group: &str,
    ) -> Result<Vec<MiddlewareClientInfo>, MiddlewareError> {
        self.drain_stream().await;
        let guard = self.connection.read().await;
        let subscriptions = guard
            .list_subscriptions()
            .await
            .map_err(|error| MiddlewareError::Connection(error.to_string()))?;
        let config = guard.config();
        let client_id = if config.client_id.is_empty() {
            format!("{}:{}", config.host, config.port)
        } else {
            config.client_id.clone()
        };
        Ok(vec![MiddlewareClientInfo {
            client_id,
            client_addr: None,
            language: Some("RUST".to_string()),
            version: Some(format!("MQTT {}", crate::types::MQTT_PROTOCOL_VERSION)),
            subscriptions: subscriptions
                .iter()
                .map(|subscription| subscription.topic_filter.clone())
                .collect(),
        }])
    }

    /// 订阅组消费详情(MQTT 无订阅组概念,兜底报错)
    pub(crate) fn group_detail(&self) -> Result<GroupConsumeDetail, MiddlewareError> {
        Err(MiddlewareError::unsupported_capability("groups"))
    }

    /// 消息查询:过滤本地环形缓冲并分页
    pub(crate) async fn query_messages(
        &self,
        query: MessageQuery,
    ) -> Result<MessagePage, MiddlewareError> {
        self.drain_stream().await;
        let inner = lock_inner(&self.inner);
        Ok(filter_and_paginate(&inner.buffer, &query))
    }
}

/// 锁定内部状态(中毒时恢复数据继续,移植自 admin.rs 的处理方式)
fn lock_inner(inner: &Mutex<AdminInnerState>) -> std::sync::MutexGuard<'_, AdminInnerState> {
    match inner.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    }
}

/// 记录一条接收消息(更新缓冲/计数/TPS 窗口);日期翻转时清零今日计数。
/// 独立为纯函数以便单测注入固定时间。
pub(crate) fn record_received(
    inner: &mut AdminInnerState,
    message: MqttMessage,
    now: DateTime<Utc>,
) {
    let today = now.with_timezone(&Local).date_naive();
    if inner.today != Some(today) {
        inner.today = Some(today);
        inner.received_today = 0;
    }
    let seq = inner.next_seq;
    inner.next_seq = inner.next_seq.saturating_add(1);
    inner.buffer.push_back(BufferedMessage {
        id: format!("mqtt-{seq}"),
        message,
    });
    while inner.buffer.len() > MQTT_ADMIN_BUFFER_CAPACITY {
        inner.buffer.pop_front();
    }
    inner.received_total = inner.received_total.saturating_add(1);
    inner.received_today = inner.received_today.saturating_add(1);
    inner.recent_received.push_back(now);
    while inner.recent_received.len() > MQTT_ADMIN_BUFFER_CAPACITY {
        inner.recent_received.pop_front();
    }
}

/// 记录一条发送消息(更新计数/TPS 窗口)
pub(crate) fn record_sent(inner: &mut AdminInnerState, now: DateTime<Utc>) {
    inner.sent_total = inner.sent_total.saturating_add(1);
    inner.recent_sent.push_back(now);
    while inner.recent_sent.len() > MQTT_ADMIN_BUFFER_CAPACITY {
        inner.recent_sent.pop_front();
    }
}

/// MQTT 主题过滤器匹配(支持 `+` 单层与 `#` 多层通配符)
pub(crate) fn mqtt_topic_match(filter: &str, topic: &str) -> bool {
    let filter_parts: Vec<&str> = filter.split('/').collect();
    let topic_parts: Vec<&str> = topic.split('/').collect();
    let mut fi = 0;
    let mut ti = 0;
    while fi < filter_parts.len() {
        let part = filter_parts[fi];
        if part == "#" {
            // "#" 必须是最后一段,匹配剩余全部(含空)
            return fi + 1 == filter_parts.len();
        }
        if ti >= topic_parts.len() {
            return false;
        }
        if part == "+" {
            fi += 1;
            ti += 1;
            continue;
        }
        if part != topic_parts[ti] {
            return false;
        }
        fi += 1;
        ti += 1;
    }
    ti == topic_parts.len()
}

/// 订阅 -> 标准 Topic 信息(SUBSCRIPTION 类型,queue_count 携带 QoS)
pub(crate) fn sub_to_topic_info(subscription: &MqttSubscription) -> MiddlewareTopicInfo {
    MiddlewareTopicInfo {
        name: subscription.topic_filter.clone(),
        topic_type: Some("SUBSCRIPTION".to_string()),
        queue_count: Some(subscription.qos.as_u8() as u32),
        perm: None,
        message_count: None,
        description: None,
        created_at: None,
    }
}

/// 缓冲消息 -> 标准消息模型
pub(crate) fn buffered_to_model(buffered: &BufferedMessage) -> MiddlewareMessage {
    let message = &buffered.message;
    MiddlewareMessage {
        message_id: buffered.id.clone(),
        topic: message.topic.clone(),
        tag: None,
        key: None,
        body: Some(message.payload.clone()),
        body_text: message.payload_text(),
        store_time: Some(
            message
                .received_at
                .with_timezone(&Local)
                .format("%Y-%m-%d %H:%M:%S")
                .to_string(),
        ),
        born_time: None,
        store_host: None,
        born_host: None,
        retry_times: None,
        properties: vec![
            ("qos".to_string(), message.qos.label().to_string()),
            ("retain".to_string(), message.retain.to_string()),
        ],
    }
}

/// 按查询条件过滤缓冲并分页(纯函数;接受任何缓冲消息引用迭代器)
pub(crate) fn filter_and_paginate<'a, I>(messages: I, query: &MessageQuery) -> MessagePage
where
    I: IntoIterator<Item = &'a BufferedMessage>,
{
    let filtered: Vec<&BufferedMessage> = messages
        .into_iter()
        .filter(|buffered| match query {
            MessageQuery::ByTimeWindow {
                topic,
                begin_unix_ms,
                end_unix_ms,
                ..
            } => {
                let ts = buffered.message.received_at.timestamp_millis();
                ts >= *begin_unix_ms
                    && ts <= *end_unix_ms
                    && (topic == "#" || mqtt_topic_match(topic, &buffered.message.topic))
            }
            MessageQuery::ByKey { topic, key } => {
                (topic == "#" || mqtt_topic_match(topic, &buffered.message.topic))
                    && (key_matches(buffered, key))
            }
            MessageQuery::ById {
                topic,
                message_id: query_id,
            } => buffered.id == *query_id && (topic.is_empty() || buffered.message.topic == *topic),
        })
        .collect();

    let total = filtered.len() as u64;
    let (page, page_size) = match query {
        MessageQuery::ByTimeWindow {
            page, page_size, ..
        } => ((*page).max(1) as usize, (*page_size).max(1) as usize),
        _ => (1, total.max(1) as usize),
    };
    let start = page.saturating_sub(1).saturating_mul(page_size);
    let messages = filtered
        .into_iter()
        .skip(start)
        .take(page_size)
        .map(buffered_to_model)
        .collect::<Vec<_>>();
    let has_more = start + messages.len() < total as usize;
    MessagePage {
        messages,
        total,
        has_more,
    }
}

/// ByKey 尽力匹配:topic 或 payload 文本包含 key(大小写不敏感)
fn key_matches(buffered: &BufferedMessage, key: &str) -> bool {
    let needle = key.to_lowercase();
    if buffered.message.topic.to_lowercase().contains(&needle) {
        return true;
    }
    buffered
        .message
        .payload_text()
        .is_some_and(|text| text.to_lowercase().contains(&needle))
}

/// 由内部状态计算指标快照(纯函数;subscription_count 为当前订阅数)
pub(crate) fn metrics_from_state(
    inner: &AdminInnerState,
    subscription_count: u64,
    now: DateTime<Utc>,
) -> MiddlewareMetrics {
    let tps_in = window_rate(&inner.recent_received, now);
    let tps_out = window_rate(&inner.recent_sent, now);
    MiddlewareMetrics {
        tps_in,
        tps_out,
        topic_count: subscription_count,
        connection_count: 1,
        message_count_today: inner.received_today,
        extras: vec![
            (
                "received_total".to_string(),
                inner.received_total.to_string(),
            ),
            ("sent_total".to_string(), inner.sent_total.to_string()),
            (
                "buffered_messages".to_string(),
                inner.buffer.len().to_string(),
            ),
        ],
    }
}

/// 计算窗口内平均速率(条/秒)
fn window_rate(times: &VecDeque<DateTime<Utc>>, now: DateTime<Utc>) -> f64 {
    let window_start = now - chrono::Duration::seconds(TPS_WINDOW_SECS);
    let count = times
        .iter()
        .filter(|time| **time >= window_start && **time <= now)
        .count();
    count as f64 / TPS_WINDOW_SECS as f64
}

/// 从 properties 中解析发送 QoS("qos" 键,0/1/2)
fn send_qos_from_properties(properties: &[(String, String)]) -> MqttQos {
    properties
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case("qos"))
        .and_then(|(_, value)| value.trim().parse::<u8>().ok())
        .and_then(MqttQos::from_u8)
        .unwrap_or(DEFAULT_SEND_QOS)
}

/// 从 properties 中解析发送是否保留("retain" 键,true/false/1/0)
fn send_retain_from_properties(properties: &[(String, String)]) -> bool {
    properties
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case("retain"))
        .and_then(
            |(_, value)| match value.trim().to_ascii_lowercase().as_str() {
                "true" | "1" | "yes" => Some(true),
                "false" | "0" | "no" => Some(false),
                _ => None,
            },
        )
        .unwrap_or(false)
}

/// 从 `CreateTopicRequest` 解析订阅 QoS(优先 attributes["qos"],其次 queue_count)
fn topic_qos(request: &CreateTopicRequest) -> MqttQos {
    request
        .attributes
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case("qos"))
        .and_then(|(_, value)| value.trim().parse::<u8>().ok())
        .or_else(|| request.queue_count.map(|count| count as u8))
        .and_then(MqttQos::from_u8)
        .unwrap_or(DEFAULT_SEND_QOS)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::MqttConnectionConfig;
    use chrono::TimeZone;

    /// 假连接记录的 publish 调用:(topic, payload, qos, retain)
    type RecordedPublish = (String, Vec<u8>, MqttQos, bool);

    /// 测试用假连接共享状态(便于测试侧直接检查)
    struct FakeShared {
        message_tx: tokio::sync::broadcast::Sender<MqttMessage>,
        published: Mutex<Vec<RecordedPublish>>,
        subscriptions: Mutex<Vec<MqttSubscription>>,
        config: MqttConnectionConfig,
    }

    /// 测试用假连接:广播通道 + 记录 publish 调用
    struct FakeConnection {
        shared: Arc<FakeShared>,
    }

    impl FakeConnection {
        /// 返回共享状态与连接,共享状态可注入消息/断言调用记录
        fn new() -> (Arc<FakeShared>, Self) {
            let (message_tx, _) = tokio::sync::broadcast::channel(64);
            let shared = Arc::new(FakeShared {
                message_tx,
                published: Mutex::new(Vec::new()),
                subscriptions: Mutex::new(vec![MqttSubscription {
                    topic_filter: "a/b".into(),
                    qos: MqttQos::AtLeastOnce,
                }]),
                config: MqttConnectionConfig {
                    client_id: "fake-client".into(),
                    ..MqttConnectionConfig::default()
                },
            });
            (shared.clone(), Self { shared })
        }
    }

    #[async_trait::async_trait]
    impl MqttConnection for FakeConnection {
        fn config(&self) -> &MqttConnectionConfig {
            &self.shared.config
        }

        async fn connect(&mut self) -> Result<(), crate::types::MqttError> {
            Ok(())
        }

        async fn disconnect(&mut self) -> Result<(), crate::types::MqttError> {
            Ok(())
        }

        async fn publish(
            &self,
            topic: &str,
            payload: &[u8],
            qos: MqttQos,
            retain: bool,
        ) -> Result<(), crate::types::MqttError> {
            self.shared.published.lock().unwrap().push((
                topic.to_string(),
                payload.to_vec(),
                qos,
                retain,
            ));
            Ok(())
        }

        async fn subscribe(
            &self,
            topic_filter: &str,
            qos: MqttQos,
        ) -> Result<(), crate::types::MqttError> {
            let mut subs = self.shared.subscriptions.lock().unwrap();
            match subs.iter_mut().find(|sub| sub.topic_filter == topic_filter) {
                Some(existing) => existing.qos = qos,
                None => subs.push(MqttSubscription {
                    topic_filter: topic_filter.to_string(),
                    qos,
                }),
            }
            Ok(())
        }

        async fn unsubscribe(&self, topic_filter: &str) -> Result<(), crate::types::MqttError> {
            self.shared
                .subscriptions
                .lock()
                .unwrap()
                .retain(|sub| sub.topic_filter != topic_filter);
            Ok(())
        }

        async fn list_subscriptions(
            &self,
        ) -> Result<Vec<MqttSubscription>, crate::types::MqttError> {
            Ok(self.shared.subscriptions.lock().unwrap().clone())
        }

        fn open_pubsub(&self) -> Result<MqttPubSubHandle, crate::types::MqttError> {
            Ok(MqttPubSubHandle::new(self.shared.message_tx.subscribe()))
        }
    }

    fn message_at(topic: &str, payload: &[u8], unix_secs: i64) -> MqttMessage {
        MqttMessage {
            topic: topic.to_string(),
            payload: payload.to_vec(),
            qos: MqttQos::AtLeastOnce,
            retain: false,
            received_at: Utc.timestamp_opt(unix_secs, 0).unwrap(),
        }
    }

    fn buffered_states(count: usize) -> Vec<BufferedMessage> {
        (0..count)
            .map(|seq| BufferedMessage {
                id: format!("mqtt-{seq}"),
                message: message_at("a/b", format!("msg-{seq}").as_bytes(), 1_700_000_000),
            })
            .collect()
    }

    #[test]
    fn topic_match_supports_mqtt_wildcards() {
        assert!(mqtt_topic_match("a/b", "a/b"));
        assert!(mqtt_topic_match("a/+", "a/b"));
        assert!(mqtt_topic_match("#", "any/thing"));
        assert!(mqtt_topic_match("a/#", "a/b/c"));
        assert!(!mqtt_topic_match("a/b", "a/b/c"));
        assert!(!mqtt_topic_match("a/+/c", "a/b"));
        assert!(!mqtt_topic_match("a/#/c", "a/b/c"));
        assert!(!mqtt_topic_match("a", "b"));
    }

    #[test]
    fn sub_to_topic_info_maps_fields() {
        let info = sub_to_topic_info(&MqttSubscription {
            topic_filter: "sensors/+".into(),
            qos: MqttQos::ExactlyOnce,
        });
        assert_eq!(info.name, "sensors/+");
        assert_eq!(info.topic_type.as_deref(), Some("SUBSCRIPTION"));
        assert_eq!(info.queue_count, Some(2));
        assert!(info.perm.is_none());
    }

    #[test]
    fn record_received_rolls_today_counter_and_caps_buffer() {
        let mut inner = AdminInnerState::default();
        let day1 = Utc.with_ymd_and_hms(2025, 1, 1, 1, 0, 0).unwrap();
        // 与 day1 相差一整天,任意时区下本地日期均不同
        let day2 = day1 + chrono::Duration::days(1);

        record_received(&mut inner, message_at("t", b"1", 0), day1);
        record_received(&mut inner, message_at("t", b"2", 0), day1);
        assert_eq!(inner.received_today, 2);
        assert_eq!(inner.received_total, 2);

        record_received(&mut inner, message_at("t", b"3", 0), day2);
        assert_eq!(inner.received_today, 1, "日期翻转后今日计数应清零");
        assert_eq!(inner.received_total, 3);
        assert_eq!(inner.buffer.len(), 3);
        assert_eq!(inner.buffer.back().unwrap().id, "mqtt-2");
    }

    #[test]
    fn buffer_capacity_drops_oldest() {
        let mut inner = AdminInnerState::default();
        let now = Utc::now();
        for seq in 0..(MQTT_ADMIN_BUFFER_CAPACITY as u64 + 10) {
            record_received(&mut inner, message_at("t", &seq.to_le_bytes(), 0), now);
        }
        assert_eq!(inner.buffer.len(), MQTT_ADMIN_BUFFER_CAPACITY);
        assert_eq!(inner.buffer.front().unwrap().id, "mqtt-10");
        assert_eq!(inner.next_seq, MQTT_ADMIN_BUFFER_CAPACITY as u64 + 10);
    }

    #[test]
    fn filter_by_time_window_applies_topic_and_range() {
        let buffer = buffered_states(4);
        // received_at = 1_700_000_000s -> 1_700_000_000_000ms
        let query = MessageQuery::ByTimeWindow {
            topic: "a/#".into(),
            begin_unix_ms: 1_699_999_000_000,
            end_unix_ms: 1_700_001_000_000,
            page: 1,
            page_size: 10,
        };
        let page = filter_and_paginate(&buffer, &query);
        assert_eq!(page.total, 4);
        assert!(!page.has_more);

        let other_topic = vec![BufferedMessage {
            id: "mqtt-x".into(),
            message: message_at("other", b"x", 1_700_000_000),
        }];
        assert_eq!(filter_and_paginate(&other_topic, &query).total, 0);
    }

    #[test]
    fn filter_by_key_matches_topic_or_payload() {
        let buffer = vec![
            BufferedMessage {
                id: "mqtt-0".into(),
                message: message_at("a/b", b"hello ORDER-1", 1_700_000_000),
            },
            BufferedMessage {
                id: "mqtt-1".into(),
                message: message_at("ORDER-2/c", b"other", 1_700_000_000),
            },
            BufferedMessage {
                id: "mqtt-2".into(),
                message: message_at("a/c", b"unrelated", 1_700_000_000),
            },
        ];
        let query = MessageQuery::ByKey {
            topic: "#".into(),
            key: "order-1".into(),
        };
        let page = filter_and_paginate(&buffer, &query);
        assert_eq!(page.total, 1);
        assert_eq!(page.messages[0].message_id, "mqtt-0");

        let by_topic = MessageQuery::ByKey {
            topic: "#".into(),
            key: "order-2".into(),
        };
        assert_eq!(filter_and_paginate(&buffer, &by_topic).total, 1);
    }

    #[test]
    fn filter_by_id_matches_synthetic_id() {
        let buffer = buffered_states(3);
        let query = MessageQuery::ById {
            topic: "a/b".into(),
            message_id: "mqtt-1".into(),
        };
        let page = filter_and_paginate(&buffer, &query);
        assert_eq!(page.total, 1);
        assert_eq!(page.messages[0].message_id, "mqtt-1");
        assert_eq!(page.messages[0].body_text.as_deref(), Some("msg-1"));

        let wrong_topic = MessageQuery::ById {
            topic: "zzz".into(),
            message_id: "mqtt-1".into(),
        };
        assert_eq!(filter_and_paginate(&buffer, &wrong_topic).total, 0);
    }

    #[test]
    fn pagination_slices_and_reports_has_more() {
        let buffer = buffered_states(25);
        let query = MessageQuery::ByTimeWindow {
            topic: "#".into(),
            begin_unix_ms: 0,
            end_unix_ms: i64::MAX,
            page: 2,
            page_size: 10,
        };
        let page = filter_and_paginate(&buffer, &query);
        assert_eq!(page.messages.len(), 10);
        assert_eq!(page.total, 25);
        assert!(page.has_more);
        assert_eq!(page.messages[0].message_id, "mqtt-10");

        let last = MessageQuery::ByTimeWindow {
            topic: "#".into(),
            begin_unix_ms: 0,
            end_unix_ms: i64::MAX,
            page: 3,
            page_size: 10,
        };
        let page = filter_and_paginate(&buffer, &last);
        assert_eq!(page.messages.len(), 5);
        assert!(!page.has_more);
    }

    #[test]
    fn buffered_to_model_maps_fields() {
        let buffered = BufferedMessage {
            id: "mqtt-7".into(),
            message: message_at("a/b", "订单".as_bytes(), 1_700_000_000),
        };
        let model = buffered_to_model(&buffered);
        assert_eq!(model.message_id, "mqtt-7");
        assert_eq!(model.topic, "a/b");
        assert_eq!(model.body_text.as_deref(), Some("订单"));
        assert_eq!(model.body.as_deref(), Some("订单".as_bytes()));
        assert!(model.store_time.is_some());
        assert!(!model.properties.is_empty());
    }

    #[test]
    fn metrics_from_state_computes_window_rate() {
        let mut inner = AdminInnerState::default();
        let now = Utc::now();
        // 最近 5 秒内(0~3.6s 间隔)10 条 -> tps = 2.0
        for offset in 0..10 {
            record_received(
                &mut inner,
                message_at("t", b"x", 0),
                now - chrono::Duration::milliseconds(offset * 400),
            );
        }
        record_sent(&mut inner, now);
        let metrics = metrics_from_state(&inner, 3, now);
        assert_eq!(metrics.topic_count, 3);
        assert_eq!(metrics.connection_count, 1);
        assert_eq!(metrics.message_count_today, 10);
        assert!((metrics.tps_in - 2.0).abs() < 1e-9);
        assert!((metrics.tps_out - 0.2).abs() < 1e-9);
        assert_eq!(
            metrics
                .extras
                .iter()
                .find(|(key, _)| key == "received_total")
                .map(|(_, value)| value.as_str()),
            Some("10")
        );
    }

    #[test]
    fn send_qos_resolves_from_properties() {
        assert_eq!(
            send_qos_from_properties(&[("qos".into(), "2".into())]),
            MqttQos::ExactlyOnce
        );
        assert_eq!(
            send_qos_from_properties(&[("QoS".into(), "0".into())]),
            MqttQos::AtMostOnce
        );
        assert_eq!(send_qos_from_properties(&[]), DEFAULT_SEND_QOS);
        assert_eq!(
            send_qos_from_properties(&[("qos".into(), "bad".into())]),
            DEFAULT_SEND_QOS
        );
    }

    /// 构造适配器与可注入/可断言的假连接共享状态
    fn adapter() -> (Arc<FakeShared>, MqttAdminAdapter) {
        let (shared, connection) = FakeConnection::new();
        let connection: Arc<RwLock<Box<dyn MqttConnection>>> =
            Arc::new(RwLock::new(Box::new(connection)));
        let adapter = MqttAdminAdapter::new(connection);
        (shared, adapter)
    }

    #[tokio::test]
    async fn capabilities_declare_mqtt_surface() {
        let (_, adapter) = adapter();
        let caps = adapter.capabilities();
        assert!(
            caps.topics
                && caps.topic_write
                && caps.clients
                && caps.message_query
                && caps.send_message
                && caps.metrics
        );
        assert!(!caps.groups && !caps.cluster_overview);
    }

    #[tokio::test]
    async fn list_topics_reflects_subscriptions() {
        let (_, adapter) = adapter();
        let topics = adapter.list_topics().await.expect("订阅列表应成功");
        assert_eq!(topics.len(), 1);
        assert_eq!(topics[0].name, "a/b");
        assert_eq!(topics[0].topic_type.as_deref(), Some("SUBSCRIPTION"));
        assert_eq!(topics[0].queue_count, Some(1));
    }

    #[tokio::test]
    async fn send_message_publishes_with_default_qos() {
        let (shared, adapter) = adapter();
        let result = adapter
            .send_message(SendMessageRequest {
                topic: "a/b".into(),
                body: b"ping".to_vec(),
                ..SendMessageRequest::default()
            })
            .await
            .expect("发送应成功");
        assert_eq!(result.status, "OK");
        assert!(result.message_id.starts_with("mqtt-sent-"));

        let published = shared.published.lock().unwrap().clone();
        assert_eq!(published.len(), 1);
        assert_eq!(published[0].0, "a/b");
        assert_eq!(published[0].1, b"ping".to_vec());
        assert_eq!(published[0].2, DEFAULT_SEND_QOS);
        assert!(!published[0].3);
    }

    #[tokio::test]
    async fn send_message_honours_retain_property() {
        let (shared, adapter) = adapter();
        adapter
            .send_message(SendMessageRequest {
                topic: "a/b".into(),
                body: b"kept".to_vec(),
                properties: vec![("retain".into(), "true".into())],
                ..SendMessageRequest::default()
            })
            .await
            .expect("发送应成功");
        let published = shared.published.lock().unwrap().clone();
        assert_eq!(published.len(), 1);
        assert!(published[0].3, "retain=true 应保留消息");

        adapter
            .send_message(SendMessageRequest {
                topic: "a/b".into(),
                body: b"drop".to_vec(),
                properties: vec![("retain".into(), "false".into())],
                ..SendMessageRequest::default()
            })
            .await
            .expect("发送应成功");
        let published = shared.published.lock().unwrap().clone();
        assert!(!published[1].3);
    }

    #[tokio::test]
    async fn create_topic_subscribes_into_subscription_table() {
        let (shared, adapter) = adapter();
        adapter
            .create_topic(CreateTopicRequest {
                topic: "sensors/+".into(),
                attributes: vec![("qos".into(), "2".into())],
                ..CreateTopicRequest::default()
            })
            .await
            .expect("订阅应成功");
        let subs = shared.subscriptions.lock().unwrap().clone();
        assert!(subs.iter().any(|sub| sub.topic_filter == "sensors/+"));
        assert!(
            subs.iter()
                .any(|sub| sub.topic_filter == "sensors/+" && sub.qos == MqttQos::ExactlyOnce)
        );
    }

    #[tokio::test]
    async fn delete_topic_unsibscribes() {
        let (shared, adapter) = adapter();
        adapter
            .create_topic(CreateTopicRequest {
                topic: "temp".into(),
                ..CreateTopicRequest::default()
            })
            .await
            .expect("订阅应成功");
        adapter.delete_topic("temp").await.expect("取消订阅应成功");
        let subs = shared.subscriptions.lock().unwrap().clone();
        assert!(!subs.iter().any(|sub| sub.topic_filter == "temp"));
    }

    #[tokio::test]
    async fn query_reads_streamed_messages() {
        let (shared, adapter) = adapter();
        // 先触发一次管理调用,惰性打开 pubsub 接收端(此后广播才有订阅者)
        adapter.list_topics().await.expect("首次调用应打开消息流");

        // 向广播通道注入两条消息
        assert!(
            shared
                .message_tx
                .send(message_at("a/b", b"hello", 1_700_000_000))
                .is_ok()
        );
        assert!(
            shared
                .message_tx
                .send(message_at("a/b", b"world", 1_700_000_000))
                .is_ok()
        );

        let query = MessageQuery::ByKey {
            topic: "#".into(),
            key: "WORLD".into(),
        };
        let page = adapter.query_messages(query).await.expect("查询应成功");
        assert_eq!(page.total, 1);
        assert_eq!(page.messages[0].body_text.as_deref(), Some("world"));

        let by_id = MessageQuery::ById {
            topic: "a/b".into(),
            message_id: page.messages[0].message_id.clone(),
        };
        assert_eq!(
            adapter
                .query_messages(by_id)
                .await
                .expect("按 ID 查询")
                .total,
            1
        );
    }

    #[tokio::test]
    async fn group_clients_reports_local_connection() {
        let (_, adapter) = adapter();
        let clients = adapter.group_clients("local").await.expect("客户端应成功");
        assert_eq!(clients.len(), 1);
        assert_eq!(clients[0].client_id, "fake-client");
        assert_eq!(clients[0].language.as_deref(), Some("RUST"));
        assert_eq!(clients[0].subscriptions, vec!["a/b".to_string()]);
    }

    #[tokio::test]
    async fn unsupported_capabilities_return_errors() {
        let (_, adapter) = adapter();
        assert!(matches!(
            adapter.cluster_overview().await.unwrap_err(),
            MiddlewareError::Unsupported(_)
        ));
        assert!(matches!(
            adapter.list_groups().unwrap_err(),
            MiddlewareError::Unsupported(_)
        ));
    }

    #[tokio::test]
    async fn topic_detail_returns_empty_stats() {
        let (_, adapter) = adapter();
        let detail = adapter.topic_detail("a/b").expect("详情应成功");
        assert_eq!(detail.topic, "a/b");
        assert!(detail.stats.is_empty());
    }

    #[tokio::test]
    async fn metrics_snapshot_counts_subscriptions_and_messages() {
        let (shared, adapter) = adapter();
        adapter.list_topics().await.expect("首次调用应打开消息流");
        shared
            .message_tx
            .send(message_at("a/b", b"ping", 1_700_000_000))
            .expect("注入消息");
        let metrics = adapter.metrics_snapshot().await.expect("指标应成功");
        assert_eq!(metrics.topic_count, 1);
        assert_eq!(metrics.connection_count, 1);
        assert_eq!(metrics.message_count_today, 1);
    }
}
