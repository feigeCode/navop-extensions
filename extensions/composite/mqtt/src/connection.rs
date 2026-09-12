//! MQTT 连接抽象。
//!
//! 移植自主仓 `crates/mqtt-runtime/src/connection.rs`,按 provider 侧需要裁剪:
//! - 去掉 `ssh_tunnel`/凭据(标准 §4:SSH 隧道由宿主连接窗口统一提供)
//! - 提供 `subscribe`/`unsubscribe`/`is_connected`:企业 MQTT 管理需要动态增删订阅,
//!   而非固定自动订阅 `#`。自动订阅在连接建立时写入订阅表,断线重连后统一恢复,
//!   见 [`crate::builtin`]。

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

    /// 订阅主题过滤器;覆盖式更新本地订阅表并通知 broker。
    async fn subscribe(&self, topic_filter: &str, qos: MqttQos) -> Result<(), MqttError>;

    /// 取消订阅主题过滤器(从本地订阅表移除并通知 broker)。
    async fn unsubscribe(&self, topic_filter: &str) -> Result<(), MqttError>;

    /// 当前订阅列表
    async fn list_subscriptions(&self) -> Result<Vec<MqttSubscription>, MqttError>;

    /// 打开消息流句柄(用于管理视图消费实时消息)
    fn open_pubsub(&self) -> Result<MqttPubSubHandle, MqttError>;
}
