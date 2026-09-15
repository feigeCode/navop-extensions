//! MQTT 实时消息事件流表(标准 §5.2)。
//!
//! 事件流把连接内的 `pubsub` 广播(`MqttConnection::open_pubsub`)暴露给宿主 UI:
//! UI 用 `navop.event.open(resource, kind)` 打开、`navop.event.read(handle, n, waitMs)`
//! 长轮询拉取、`navop.event.close(handle)` 释放。
//!
//! 设计取舍:
//! - **不额外建缓冲**:广播通道(`MQTT_MESSAGE_CHANNEL_CAPACITY` = 1024)本身就是有界缓冲,
//!   每个流持有一个独立接收端(独立游标),因此不需要后台泵任务;
//!   `EventOpenParams.capacity` 因此被忽略(协议兼容),丢弃量由广播滞后如实上报。
//! - **读侧阻塞有上限**:本 provider 的 IPC 循环串行处理请求,长时间阻塞会拖住
//!   ping/其他 invoke,所以 `event/read` 最多等待 [`MQTT_EVENT_READ_MAX_WAIT_MS`]。
//! - **消息源唯一**:事件协议不携带资源标识(宿主固定传 `conn_id: None`),
//!   因此只有**恰好一个**连接打开时才能打开事件流,见 [`ProviderState::sole_resource`]。

use std::collections::HashMap;
use std::time::Duration;

use extension_protocol::{
    error::{ProtocolError, error_codes},
    event_stream::{EventOpenParams, EventOpenResult, EventReadParams, EventReadResult},
};
use tokio::time::timeout;
use uuid::Uuid;

use super::{ProviderState, SoleResourceError};
use crate::admin::live_to_model;
use crate::error::{boxed_error, invalid_params, resource_error, serialize};
use crate::pubsub::{MqttPubSubEvent, MqttPubSubHandle};
use crate::types::MqttMessage;

/// 实时消息事件流的 kind(与 `MqttResource::metadata` 的 `message_stream_kind` 同值)。
pub(crate) const MQTT_MESSAGE_EVENT_KIND: &str = "mqtt/message/events";

/// 同时在开的事件流上限(每个流占用一个广播接收端)。
const MAX_EVENT_STREAMS: usize = 16;

/// 单次 `event/read` 允许的最长阻塞等待。
///
/// 宿主的 `navop.event.read` 把 UI 的 `waitMs` 原样下发(上限 60_000,见
/// `shell_plugin_host/event.rs`),但本 provider 的请求循环是串行的:
/// 读侧阻塞期间,同进程的 ping 与其他 invoke 都要排队。取 250ms 作为上限,
/// UI 侧按此做长轮询(≈4 次/秒),既避免忙等,也不会让其他请求明显变慢。
pub(crate) const MQTT_EVENT_READ_MAX_WAIT_MS: u32 = 250;

/// 一个已打开的事件流。
pub(crate) struct ProviderEventStream {
    /// 事件流 kind(当前仅 [`MQTT_MESSAGE_EVENT_KIND`])
    #[allow(dead_code)]
    kind: String,
    /// 独立广播接收端(独立游标,与管理适配器的排水互不影响)
    handle: MqttPubSubHandle,
    /// 累计丢弃(广播滞后)消息数,随每次 read 一起上报
    dropped: u64,
    /// 流内消息序号(单调递增;`message_id` = `mqtt-live-<seq>`)
    next_seq: u64,
    /// 广播端已关闭(连接被释放)
    closed: bool,
}

impl ProviderEventStream {
    /// 取下一条事件的序号
    fn next_seq(&mut self) -> u64 {
        let seq = self.next_seq;
        self.next_seq = self.next_seq.saturating_add(1);
        seq
    }

    /// 把一条消息转为事件 JSON(标准消息模型,见 [`live_to_model`])
    fn event_for(&mut self, message: &MqttMessage) -> serde_json::Value {
        let seq = self.next_seq();
        serde_json::to_value(live_to_model(seq, message)).unwrap_or(serde_json::Value::Null)
    }
}

/// 事件流表(provider 全局;上限 [`MAX_EVENT_STREAMS`])
#[derive(Default)]
pub(crate) struct ProviderEventStreamTable {
    streams: HashMap<String, ProviderEventStream>,
}

impl ProviderEventStreamTable {
    pub(crate) fn len(&self) -> usize {
        self.streams.len()
    }

    pub(crate) fn clear(&mut self) {
        self.streams.clear();
    }

    fn remove(&mut self, stream_id: &str) -> bool {
        self.streams.remove(stream_id).is_some()
    }
}

impl ProviderState {
    /// 打开实时消息事件流(`event/open`)。
    ///
    /// 未知 kind 返回 `METHOD_NOT_FOUND`;无连接返回 `RESOURCE_CLOSED`;
    /// 多连接返回 `RESOURCE_BUSY`(事件协议不携带资源标识,无法唯一定位消息源)。
    pub(crate) async fn open_event_stream(
        &mut self,
        params: EventOpenParams,
    ) -> Result<serde_json::Value, Box<ProtocolError>> {
        if params.conn_id.is_some() {
            return Err(invalid_params(
                "配置错误: MQTT 事件流不支持 conn_id(由连接自身定位消息源)",
            ));
        }
        let stream_id = self.open_message_event_stream(&params.kind).await?;
        serialize(EventOpenResult { stream_id })
    }

    /// 打开实时消息事件流并返回 `stream_id`。
    ///
    /// `event/open`(宿主 `navop.event`) 与 `middleware/message/stream`(工作台 invoke,
    /// 返回 `ResultRef::EventStream`) 共用同一实现,保证两条入口的 kind 校验、
    /// 唯一连接约束与上限语义完全一致。
    pub(crate) async fn open_message_event_stream(
        &mut self,
        kind: &str,
    ) -> Result<String, Box<ProtocolError>> {
        if kind != MQTT_MESSAGE_EVENT_KIND {
            return Err(boxed_error(
                error_codes::METHOD_NOT_FOUND,
                format!("unknown MQTT event stream kind `{kind}`"),
            ));
        }
        if self.events.len() >= MAX_EVENT_STREAMS {
            return Err(boxed_error(
                error_codes::RESOURCE_BUSY,
                format!("MQTT 实时消息流数量已达上限({MAX_EVENT_STREAMS})"),
            ));
        }
        let resource = match self.sole_resource() {
            Ok(resource) => resource,
            Err(SoleResourceError::None) => return Err(resource_error()),
            Err(SoleResourceError::Ambiguous(count)) => {
                return Err(boxed_error(
                    error_codes::RESOURCE_BUSY,
                    format!(
                        "MQTT 实时消息流需要唯一连接,当前已打开 {count} 个连接:请关闭多余连接后重试"
                    ),
                ));
            }
        };
        let handle = resource
            .open_pubsub()
            .await
            .map_err(crate::error::middleware_error)?;
        let stream_id = format!("mqtt-stream-{}", Uuid::new_v4());
        self.events.streams.insert(
            stream_id.clone(),
            ProviderEventStream {
                kind: kind.to_string(),
                handle,
                dropped: 0,
                next_seq: 0,
                closed: false,
            },
        );
        Ok(stream_id)
    }

    /// 读取一批事件(`event/read`)。
    ///
    /// 顺序:先非阻塞排空已到达的消息;批次为空且 `wait_ms > 0` 时再做一次
    /// **有上限**的阻塞等待(见 [`MQTT_EVENT_READ_MAX_WAIT_MS`])。
    /// 未知/已关闭的流返回 `closed: true` 的空批(UI 据此停止轮询)。
    pub(crate) async fn read_event_stream(
        &mut self,
        params: EventReadParams,
    ) -> Result<serde_json::Value, Box<ProtocolError>> {
        let max_events = params.effective_max_events() as usize;
        let wait_ms = params.wait_ms.unwrap_or(0).min(MQTT_EVENT_READ_MAX_WAIT_MS);
        let Some(stream) = self.events.streams.get_mut(&params.stream_id) else {
            return serialize(EventReadResult {
                events: Vec::new(),
                closed: true,
                dropped_count: 0,
            });
        };

        let mut events = Vec::new();
        let (messages, dropped) = stream.handle.drain_available(max_events);
        stream.dropped = stream.dropped.saturating_add(dropped);
        for message in messages {
            events.push(stream.event_for(&message));
        }

        if events.is_empty() && wait_ms > 0 && !stream.closed {
            match timeout(
                Duration::from_millis(u64::from(wait_ms)),
                stream.handle.recv(),
            )
            .await
            {
                Ok(MqttPubSubEvent::Message(message)) => events.push(stream.event_for(&message)),
                Ok(MqttPubSubEvent::Lagged(dropped)) => {
                    stream.dropped = stream.dropped.saturating_add(dropped);
                }
                Ok(MqttPubSubEvent::Closed) => stream.closed = true,
                // 等待超时:返回空批,由 UI 发起下一轮长轮询
                Err(_elapsed) => {}
            }
        }

        serialize(EventReadResult {
            events,
            closed: stream.closed,
            dropped_count: stream.dropped,
        })
    }

    /// 关闭事件流(`event/close`)。已关闭/未知的流按幂等处理。
    pub(crate) fn close_event_stream(&mut self, stream_id: &str) -> serde_json::Value {
        self.events.remove(stream_id);
        serde_json::Value::Null
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::MqttQos;
    use tokio::sync::broadcast;

    /// 构造一个直接挂在广播通道上的事件流(不依赖真实连接)
    fn table_with_stream(
        sender: &broadcast::Sender<MqttMessage>,
    ) -> (ProviderEventStreamTable, String) {
        let stream_id = "mqtt-stream-test".to_string();
        let mut table = ProviderEventStreamTable::default();
        table.streams.insert(
            stream_id.clone(),
            ProviderEventStream {
                kind: MQTT_MESSAGE_EVENT_KIND.to_string(),
                handle: MqttPubSubHandle::new(sender.subscribe()),
                dropped: 0,
                next_seq: 0,
                closed: false,
            },
        );
        (table, stream_id)
    }

    fn sample_message(topic: &str, payload: &[u8]) -> MqttMessage {
        MqttMessage {
            topic: topic.to_string(),
            payload: payload.to_vec(),
            qos: MqttQos::AtLeastOnce,
            retain: true,
            received_at: chrono::Utc::now(),
        }
    }

    #[test]
    fn event_payload_follows_message_model() {
        let (sender, _) = broadcast::channel(4);
        let (mut table, stream_id) = table_with_stream(&sender);
        let stream = table.streams.get_mut(&stream_id).expect("stream");

        let value = stream.event_for(&sample_message("sensor/1", b"1111"));
        assert_eq!(value["message_id"], "mqtt-live-0");
        assert_eq!(value["topic"], "sensor/1");
        assert_eq!(value["body_text"], "1111");
        assert!(value["body"].is_null(), "实时事件不带原始字节");
        let properties = value["properties"].as_array().expect("properties");
        assert!(properties.contains(&serde_json::json!(["qos", "QoS 1"])));
        assert!(properties.contains(&serde_json::json!(["retain", "true"])));

        // 序号单调递增
        let next = stream.event_for(&sample_message("sensor/2", b"x"));
        assert_eq!(next["message_id"], "mqtt-live-1");
    }

    #[test]
    fn event_payload_marks_binary_body_as_null() {
        let (sender, _) = broadcast::channel(4);
        let (mut table, stream_id) = table_with_stream(&sender);
        let stream = table.streams.get_mut(&stream_id).expect("stream");
        let value = stream.event_for(&sample_message("bin", &[0xFF, 0x00]));
        assert!(value["body_text"].is_null());
    }

    #[test]
    fn close_is_idempotent() {
        let (sender, _) = broadcast::channel(4);
        let (mut table, stream_id) = table_with_stream(&sender);
        assert!(table.remove(&stream_id));
        assert!(!table.remove(&stream_id));
        assert_eq!(table.len(), 0);
    }

    #[test]
    fn table_clear_drops_every_stream() {
        let (sender, _) = broadcast::channel(4);
        let (mut table, _) = table_with_stream(&sender);
        table.clear();
        assert_eq!(table.len(), 0);
    }
}
