//! MQTT 连接抽象。
//!
//! 移植自主仓 `crates/mqtt-runtime/src/connection.rs`,按 provider 侧需要裁剪:
//! 去掉 `ping`/`is_connected`/`subscribe`/`unsubscribe`(标准 §3 未定义订阅管理方法,
//! provider 在连接建立时自动订阅 `#`,断线重连由 rumqttc 实现内部恢复,见 [`crate::builtin`])。

use crate::pubsub::MqttPubSubHandle;
use crate::types::{MqttConnectionConfig, MqttError, MqttQos, MqttSubscription};
use async_trait::async_trait;

/// MQTT 连接抽象(rumqttc 实现,测试用假连接共用)
#[async_trait]
pub(crate) trait MqttConnection: Send + Sync {
    /// 获取配置
    fn config(&self) -> &MqttConnectionConfig;

    /// 建立连接(等待初始 ConnAck;失败即连接测试失败——标准约定 conn test 语义在 open)
    async fn connect(&mut self) -> Result<(), MqttError>;

    /// 断开连接
    async fn disconnect(&mut self) -> Result<(), MqttError>;

    /// 发布消息
    async fn publish(
        &self,
        topic: &str,
        payload: &[u8],
        qos: MqttQos,
        retain: bool,
    ) -> Result<(), MqttError>;

    /// 当前订阅列表
    async fn list_subscriptions(&self) -> Result<Vec<MqttSubscription>, MqttError>;

    /// 打开消息流句柄(用于管理视图消费实时消息)
    fn open_pubsub(&self) -> Result<MqttPubSubHandle, MqttError>;
}
