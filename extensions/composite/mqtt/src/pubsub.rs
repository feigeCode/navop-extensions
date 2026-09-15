//! MQTT 实时消息流句柄(基于 tokio broadcast)。
//!
//! 移植自主仓 `crates/mqtt-runtime/src/pubsub.rs`;provider 侧两种消费方式:
//! - [`MqttPubSubHandle::drain_available`]:非阻塞排空,供管理适配器批量入环形缓冲,
//!   也供事件流一次 `event/read` 收集当前可读消息;
//! - [`MqttPubSubHandle::recv`]:异步等待,供事件流做**有上限**的阻塞等待。
//!
//! 两种消费各自持有独立的 `broadcast::Receiver`(多接收端语义),
//! 因此事件流的读/写不会推进管理适配器接收端的游标,反之亦然。

use crate::types::MqttMessage;
use tokio::sync::broadcast;

/// 消息广播通道容量;lagged 时丢弃旧消息。
pub(crate) const MQTT_MESSAGE_CHANNEL_CAPACITY: usize = 1024;

/// 一轮异步接收的结果。
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum MqttPubSubEvent {
    /// 收到一条消息
    Message(MqttMessage),
    /// 本接收端消费过慢,tokio 已丢弃 `dropped` 条旧消息(游标已前移,后续消息仍可继续取)
    Lagged(u64),
    /// 广播端已关闭(连接断开或 provider 释放连接)
    Closed,
}

/// MQTT 实时消息流接收端。
///
/// 由 [`crate::connection::MqttConnection::open_pubsub`] 创建
/// (对应 `broadcast::Sender::subscribe`,每个接收端独立游标)。
/// 广播端(连接)drop 后 `drain_available` 返回空批次,`recv` 返回 [`MqttPubSubEvent::Closed`]。
pub(crate) struct MqttPubSubHandle {
    receiver: broadcast::Receiver<MqttMessage>,
}

impl MqttPubSubHandle {
    pub(crate) fn new(receiver: broadcast::Receiver<MqttMessage>) -> Self {
        Self { receiver }
    }

    /// 非阻塞排空:取走当前可读消息(至多 `max` 条),并返回本次观测到的滞后条数。
    ///
    /// 滞后(Lagged)表示本接收端消费过慢、旧消息已被广播端丢弃;调用方应累加该计数
    /// 后再向用户报告(事件流经 `EventReadResult.dropped_count` 表达)。
    /// 「通道已关闭」与「暂无消息」都表现为空批次,需要区分时用 [`Self::recv`]。
    pub(crate) fn drain_available(&mut self, max: usize) -> (Vec<MqttMessage>, u64) {
        let mut messages = Vec::new();
        let mut dropped = 0_u64;
        while messages.len() < max {
            match self.receiver.try_recv() {
                Ok(message) => messages.push(message),
                Err(broadcast::error::TryRecvError::Lagged(count)) => dropped += count,
                Err(broadcast::error::TryRecvError::Empty)
                | Err(broadcast::error::TryRecvError::Closed) => break,
            }
        }
        (messages, dropped)
    }

    /// 异步接收:等待至多一条消息,或直到广播端关闭;滞后单独作为事件上报。
    pub(crate) async fn recv(&mut self) -> MqttPubSubEvent {
        match self.receiver.recv().await {
            Ok(message) => MqttPubSubEvent::Message(message),
            Err(broadcast::error::RecvError::Lagged(dropped)) => MqttPubSubEvent::Lagged(dropped),
            Err(broadcast::error::RecvError::Closed) => MqttPubSubEvent::Closed,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::MqttQos;

    fn sample_message(topic: &str) -> MqttMessage {
        MqttMessage {
            topic: topic.to_string(),
            payload: b"hello".to_vec(),
            qos: MqttQos::AtMostOnce,
            retain: false,
            received_at: chrono::Utc::now(),
        }
    }

    #[test]
    fn drain_available_reports_lagged_count() {
        // 容量 2、发送 4 条:消费端只应拿到后 2 条,并上报滞后 2 条
        let (sender, receiver) = broadcast::channel(2);
        let mut handle = MqttPubSubHandle::new(receiver);
        for index in 0..4 {
            sender
                .send(sample_message(&format!("t/{index}")))
                .expect("send");
        }
        let (messages, dropped) = handle.drain_available(usize::MAX);
        assert_eq!(dropped, 2);
        assert_eq!(
            messages
                .iter()
                .map(|each| each.topic.as_str())
                .collect::<Vec<_>>(),
            vec!["t/2", "t/3"]
        );
        // 已排空:再次调用得到空批次
        let (again, dropped) = handle.drain_available(usize::MAX);
        assert!(again.is_empty());
        assert_eq!(dropped, 0);
    }

    #[test]
    fn drain_available_respects_max() {
        let (sender, receiver) = broadcast::channel(8);
        let mut handle = MqttPubSubHandle::new(receiver);
        for index in 0..5 {
            sender
                .send(sample_message(&format!("t/{index}")))
                .expect("send");
        }
        let (messages, dropped) = handle.drain_available(2);
        assert_eq!(messages.len(), 2);
        assert_eq!(dropped, 0);
        // 未取走的 3 条仍在接收端游标之后
        let (rest, _) = handle.drain_available(usize::MAX);
        assert_eq!(rest.len(), 3);
    }

    #[tokio::test]
    async fn recv_reports_message_then_closed() {
        let (sender, receiver) = broadcast::channel(4);
        let mut handle = MqttPubSubHandle::new(receiver);
        sender.send(sample_message("a/b")).expect("send");
        match handle.recv().await {
            // received_at 是取消息时刻的时间戳,只比对可确定的字段
            MqttPubSubEvent::Message(message) => assert_eq!(message.topic, "a/b"),
            other => panic!("期望收到消息,实际 {other:?}"),
        }
        drop(sender);
        assert_eq!(handle.recv().await, MqttPubSubEvent::Closed);
    }

    #[tokio::test]
    async fn recv_reports_lagged_count() {
        // 容量 2、发送 4 条:消费端只收到后 2 条,滞后 2 条
        let (sender, receiver) = broadcast::channel(2);
        let mut handle = MqttPubSubHandle::new(receiver);
        for index in 0..4 {
            sender
                .send(sample_message(&format!("t/{index}")))
                .expect("send");
        }
        assert_eq!(handle.recv().await, MqttPubSubEvent::Lagged(2));
        match handle.recv().await {
            MqttPubSubEvent::Message(message) => assert_eq!(message.topic, "t/2"),
            other => panic!("期望收到消息,实际 {other:?}"),
        }
    }

    #[tokio::test]
    async fn receivers_are_independent() {
        // 事件流接收端与管理适配器接收端互不推进游标
        let (sender, receiver) = broadcast::channel(4);
        let mut stream = MqttPubSubHandle::new(receiver);
        let mut admin = MqttPubSubHandle::new(sender.subscribe());
        sender.send(sample_message("x")).expect("send");
        assert_eq!(stream.drain_available(usize::MAX).0.len(), 1);
        // 事件流已消费一条,管理端仍能取到同一条
        assert_eq!(admin.drain_available(usize::MAX).0.len(), 1);
    }
}
