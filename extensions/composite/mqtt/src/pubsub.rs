//! MQTT 实时消息流句柄(基于 tokio broadcast)。
//!
//! 移植自主仓 `crates/mqtt-runtime/src/pubsub.rs`;provider 侧只使用
//! 非阻塞的 [`MqttPubSubHandle::try_recv`] 供管理适配器批量排水(drain)。

use crate::types::MqttMessage;
use tokio::sync::broadcast;

/// 消息广播通道容量;lagged 时丢弃旧消息。
pub(crate) const MQTT_MESSAGE_CHANNEL_CAPACITY: usize = 1024;

/// MQTT 实时消息流接收端。
///
/// 由 [`crate::connection::MqttConnection::open_pubsub`] 创建;
/// 连接断开(drop sender)后 `try_recv` 返回 `None`。
pub(crate) struct MqttPubSubHandle {
    receiver: broadcast::Receiver<MqttMessage>,
}

impl MqttPubSubHandle {
    pub(crate) fn new(receiver: broadcast::Receiver<MqttMessage>) -> Self {
        Self { receiver }
    }

    /// 非阻塞接收:有待处理消息返回 `Some`;无消息或通道已关闭返回 `None`。
    ///
    /// 滞后(Lagged)表示本接收端消费过慢、旧消息已被广播端丢弃,此时跳过继续取后续消息。
    pub(crate) fn try_recv(&mut self) -> Option<MqttMessage> {
        loop {
            match self.receiver.try_recv() {
                Ok(message) => return Some(message),
                Err(broadcast::error::TryRecvError::Lagged(_)) => continue,
                Err(broadcast::error::TryRecvError::Empty)
                | Err(broadcast::error::TryRecvError::Closed) => return None,
            }
        }
    }
}
