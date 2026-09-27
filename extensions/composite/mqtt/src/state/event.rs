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

use std::collections::{HashMap, VecDeque};
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

/// 单次 `event/read` 返回批次的**字节**预算(约 512 KiB)。
///
/// 事件批整体内联在一个 IPC 响应帧里,宿主单帧上限 16 MiB(`framing::MAX_MSG_SIZE`),
/// 而一条大 payload 就足以把帧顶爆 —— 宿主会判协议错误并断开 transport,UI 只能
/// 看到「连接已断开」这种无从下手的报错。所以按**实测字节**切批:这一轮装不下的
/// 事件挪进 [`ProviderEventStream::pending`],下一轮长轮询继续吐(不丢消息)。
const MQTT_EVENT_BATCH_MAX_BYTES: usize = 512 * 1024;

/// 单流待发事件的积压上限(约 512 KiB)。
///
/// 纯粹是内存护栏:极端情况下(例如消息洪峰 + UI 拉取很慢)宁可丢弃**并计入
/// `dropped_count`**(UI 会如实显示丢了多少),也不要让 provider 无限涨内存。
const MQTT_EVENT_PENDING_MAX_BYTES: usize = 512 * 1024;

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
    /// 消息源资源 ID —— 资源关闭时据此定向回收(事件协议本身不携带资源标识)
    resource_id: String,
    /// 独立广播接收端(独立游标,与管理适配器的排水互不影响)
    handle: MqttPubSubHandle,
    /// 累计丢弃(广播滞后 + 积压溢出)消息数,随每次 read 一起上报
    dropped: u64,
    /// 流内消息序号(单调递增;`message_id` = `mqtt-live-<seq>`)
    next_seq: u64,
    /// 广播端已关闭(连接被释放)
    closed: bool,
    /// 上一轮因字节预算没装下的已序列化事件(`(事件, 序列化字节数)`)
    pending: VecDeque<(serde_json::Value, usize)>,
    /// `pending` 当前占用的字节数
    pending_bytes: usize,
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

    /// 回收某个资源名下的事件流(资源关闭时调用)。
    ///
    /// 之前这里是无条件 `clear()`,虽然"顺手"清干净了,但语义不对:关一个连接
    /// 会把别的连接正在用的流一起关掉。反过来漏清更糟 —— 上限只有 16 条,僵尸
    /// 流会占满配额,后续连接再也开不出流。
    pub(crate) fn close_for_resource(&mut self, resource_id: &str) {
        self.streams
            .retain(|_, stream| stream.resource_id != resource_id);
    }

    /// 清掉消息源已经不在资源表里的流(流未显式 close 就被遗弃时的兜底)
    fn prune_stale(&mut self, mut is_live: impl FnMut(&str) -> bool) {
        self.streams
            .retain(|_, stream| is_live(&stream.resource_id));
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
        // 先清掉消息源已消失的流,再判上限:否则被遗弃的僵尸流会把 16 条配额占死
        let resources = &self.resources;
        self.events
            .prune_stale(|resource_id| resources.contains_key(resource_id));
        if self.events.len() >= MAX_EVENT_STREAMS {
            return Err(boxed_error(
                error_codes::RESOURCE_BUSY,
                format!("MQTT 实时消息流数量已达上限({MAX_EVENT_STREAMS})"),
            ));
        }
        let (resource_id, _resource) = match self.sole_resource_with_id() {
            Ok(found) => found,
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
        let resource_id = resource_id.to_string();
        // 资源 ID 已复制出来,这里不再借用 `sole_resource_with_id` 的返回引用,
        // 以便随后插入流表时对状态取可变借用
        let handle = match self.resources.get(&resource_id) {
            Some(resource) => resource
                .open_pubsub()
                .await
                .map_err(crate::error::middleware_error)?,
            None => return Err(resource_error()),
        };
        let stream_id = format!("mqtt-stream-{}", Uuid::new_v4());
        self.events.streams.insert(
            stream_id.clone(),
            ProviderEventStream {
                kind: kind.to_string(),
                resource_id,
                handle,
                dropped: 0,
                next_seq: 0,
                closed: false,
                pending: VecDeque::new(),
                pending_bytes: 0,
            },
        );
        Ok(stream_id)
    }

    /// 读取一批事件(`event/read`)。
    ///
    /// 顺序:先吐上一轮没装下的积压;再从广播通道排水(非阻塞);批次仍为空且
    /// `wait_ms > 0` 时做一次**有上限**的阻塞等待(见 [`MQTT_EVENT_READ_MAX_WAIT_MS`])。
    /// 未知/已关闭的流返回 `closed: true` 的空批(UI 据此停止轮询)。
    ///
    /// 批次按 [`MQTT_EVENT_BATCH_MAX_BYTES`] 切,装不下的进 pending 而不是丢弃 ——
    /// 大消息场景下 UI 会看到略慢但完整的尾巴,而不是一帧把 transport 顶爆。
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

        let mut events: Vec<serde_json::Value> = Vec::new();
        let mut used = 0usize;

        // 1) 上一轮的积压优先(保持顺序:积压一定比通道里的更早)
        while let Some((event, size)) = stream.pending.pop_front() {
            stream.pending_bytes = stream.pending_bytes.saturating_sub(size);
            if !events.is_empty() && used.saturating_add(size) > MQTT_EVENT_BATCH_MAX_BYTES {
                stream.pending.push_front((event, size));
                stream.pending_bytes = stream.pending_bytes.saturating_add(size);
                break;
            }
            used = used.saturating_add(size);
            events.push(event);
        }

        // 2) 通道排水:装不下的进 pending,超出积压上限的丢弃并计数
        if events.len() < max_events {
            let (messages, dropped) = stream.handle.drain_available(max_events - events.len());
            stream.dropped = stream.dropped.saturating_add(dropped);
            for message in messages {
                let event = stream.event_for(&message);
                let size = serialized_len(&event);
                if !events.is_empty() && used.saturating_add(size) > MQTT_EVENT_BATCH_MAX_BYTES {
                    if stream.pending_bytes.saturating_add(size) <= MQTT_EVENT_PENDING_MAX_BYTES {
                        stream.pending.push_back((event, size));
                        stream.pending_bytes = stream.pending_bytes.saturating_add(size);
                    } else {
                        stream.dropped = stream.dropped.saturating_add(1);
                    }
                    continue;
                }
                used = used.saturating_add(size);
                events.push(event);
            }
        }

        // 3) 批次空且允许等待:再等一条,避免 UI 空转
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

/// 事件序列化后的字节数(用于字节预算;序列化失败按 0 计,不影响计数逻辑)
fn serialized_len(event: &serde_json::Value) -> usize {
    serde_json::to_vec(event).map_or(0, |bytes| bytes.len())
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
                resource_id: "mqtt-resource-test".to_string(),
                handle: MqttPubSubHandle::new(sender.subscribe()),
                dropped: 0,
                next_seq: 0,
                closed: false,
                pending: VecDeque::new(),
                pending_bytes: 0,
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

    #[test]
    fn close_for_resource_only_drops_matching_streams() {
        let (sender, _) = broadcast::channel(4);
        let (mut table, stream_id) = table_with_stream(&sender);
        table.close_for_resource("mqtt-resource-other");
        assert_eq!(table.len(), 1, "别的资源关掉不该影响本流");
        table.close_for_resource("mqtt-resource-test");
        assert_eq!(table.len(), 0);
        assert!(!table.remove(&stream_id));
    }

    #[test]
    fn prune_stale_drops_streams_without_live_resource() {
        let (sender, _) = broadcast::channel(4);
        let (mut table, _) = table_with_stream(&sender);
        table.prune_stale(|resource_id| resource_id == "mqtt-resource-other");
        assert_eq!(table.len(), 0);
    }

    #[test]
    fn serialized_len_counts_json_escaped_size() {
        let plain = serialized_len(&serde_json::json!({"body_text": "abcd"}));
        let escaped = serialized_len(&serde_json::json!({"body_text": "\u{1}abcd"}));
        assert!(escaped > plain, "控制字符会被转义成 6 字节");
    }
}
