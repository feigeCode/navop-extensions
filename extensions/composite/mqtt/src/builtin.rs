//! MQTT 连接实现(基于 rumqttc)。
//!
//! 移植自主仓 `crates/mqtt-runtime/src/builtin.rs`(builtin-mqtt feature),按 provider 侧裁剪:
//! - 去掉 SSH 隧道(标准 §4:SSH 隧道由宿主连接窗口统一提供,provider 侧不感知)
//! - 订阅恢复从 `connect()` 移到 poll 任务的 ConnAck 分支:
//!   初始连接与 rumqttc 自动重连都走同一条路径,broker 重启后订阅不再丢失
//! - broker 以 BadUserNamePassword/NotAuthorized 拒绝连接时视为**致命认证错误**:
//!   poll 任务退出并通知 `connect()` 立即失败,不再等待 ConnAck 超时

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use async_trait::async_trait;
use rumqttc::{AsyncClient, ConnectionError, Event, Incoming, MqttOptions, Transport};
use tokio::sync::{Mutex, broadcast, mpsc, watch};
use tokio::time::timeout;

use crate::connection::MqttConnection;
use crate::pubsub::{MQTT_MESSAGE_CHANNEL_CAPACITY, MqttPubSubHandle};
use crate::types::{MqttConnectionConfig, MqttError, MqttMessage, MqttQos, MqttSubscription};

/// provider 打开资源时自动订阅的主题过滤器。
///
/// 标准 §3 未定义订阅管理方法,而消息查询/指标依赖输入消息流,
/// 因此 provider 代表用户订阅全量主题 `#`,订阅列表经 `middleware/topic/list` 呈现。
const AUTO_SUBSCRIBE_FILTER: &str = "#";

/// 自动订阅使用的 QoS(与主仓发送默认 QoS 一致,取 AtLeastOnce)
const AUTO_SUBSCRIBE_QOS: MqttQos = MqttQos::AtLeastOnce;

/// 标准 §4:client_id 留空时由 provider 生成 `navop-mqtt-<随机后缀>`
const CLIENT_ID_PREFIX: &str = "navop-mqtt-";

/// poll 错误退避间隔(秒),避免断连期间忙等
const POLL_ERROR_BACKOFF_SECS: u64 = 1;

fn normalize_direct_host(host: &str) -> String {
    if host.eq_ignore_ascii_case("localhost") {
        return "127.0.0.1".to_string();
    }
    host.to_string()
}

fn map_qos(qos: MqttQos) -> rumqttc::QoS {
    match qos {
        MqttQos::AtMostOnce => rumqttc::QoS::AtMostOnce,
        MqttQos::AtLeastOnce => rumqttc::QoS::AtLeastOnce,
        MqttQos::ExactlyOnce => rumqttc::QoS::ExactlyOnce,
    }
}

/// 判断是否为致命认证错误(不应重试)
fn is_fatal_auth_error(error: &ConnectionError) -> bool {
    matches!(
        error,
        ConnectionError::ConnectionRefused(
            rumqttc::ConnectReturnCode::BadUserNamePassword
                | rumqttc::ConnectReturnCode::NotAuthorized
        )
    )
}

/// MQTT 连接实现(rumqttc AsyncClient + EventLoop)
pub(crate) struct MqttConnectionImpl {
    config: MqttConnectionConfig,
    client: Option<AsyncClient>,
    poll_task: Option<tokio::task::JoinHandle<()>>,
    connected: Arc<AtomicBool>,
    /// 连接状态 watch(poll 任务写,connect 等待初始 ConnAck)
    connected_tx: watch::Sender<bool>,
    subscriptions: Arc<Mutex<Vec<MqttSubscription>>>,
    message_tx: broadcast::Sender<MqttMessage>,
}

impl MqttConnectionImpl {
    pub(crate) fn new(config: MqttConnectionConfig) -> Self {
        let (message_tx, _) = broadcast::channel(MQTT_MESSAGE_CHANNEL_CAPACITY);
        let (connected_tx, _) = watch::channel(false);
        // 预置自动订阅:poll 任务收到 ConnAck 后统一恢复(含断线重连)
        let subscriptions = Arc::new(Mutex::new(vec![MqttSubscription {
            topic_filter: AUTO_SUBSCRIBE_FILTER.to_string(),
            qos: AUTO_SUBSCRIBE_QOS,
        }]));
        Self {
            config,
            client: None,
            poll_task: None,
            connected: Arc::new(AtomicBool::new(false)),
            connected_tx,
            subscriptions,
            message_tx,
        }
    }

    fn require_client(&self) -> Result<&AsyncClient, MqttError> {
        self.client.as_ref().ok_or(MqttError::NotConnected)
    }

    /// 等待初始 ConnAck 或致命错误,先到者胜
    async fn wait_for_connack(
        &self,
        mut rx: watch::Receiver<bool>,
        mut fatal_rx: mpsc::UnboundedReceiver<String>,
    ) -> Result<(), MqttError> {
        let deadline = Duration::from_secs(self.config.timeout.max(1));
        match timeout(deadline, async {
            loop {
                if *rx.borrow_and_update() {
                    return Ok(());
                }
                tokio::select! {
                    changed = rx.changed() => {
                        if changed.is_err() {
                            return Ok(());
                        }
                    }
                    fatal = fatal_rx.recv() => {
                        if let Some(detail) = fatal {
                            return Err(MqttError::Auth(detail));
                        }
                    }
                }
            }
        })
        .await
        {
            Ok(result) => result,
            Err(_) => Err(MqttError::Timeout(
                "mqtt broker did not acknowledge the connection in time".to_string(),
            )),
        }
    }
}

impl Drop for MqttConnectionImpl {
    fn drop(&mut self) {
        // 兜底终止 poll 任务(正常路径由 disconnect() 处理)
        if let Some(task) = self.poll_task.take() {
            task.abort();
        }
    }
}

#[async_trait]
impl MqttConnection for MqttConnectionImpl {
    fn config(&self) -> &MqttConnectionConfig {
        &self.config
    }

    async fn connect(&mut self) -> Result<(), MqttError> {
        if self.client.is_some() {
            return Ok(());
        }

        let host = normalize_direct_host(&self.config.host);
        // 标准 §4:client_id 留空时由 provider 生成 `navop-mqtt-<随机后缀>`
        let client_id = if self.config.client_id.trim().is_empty() {
            format!("{CLIENT_ID_PREFIX}{}", uuid::Uuid::new_v4())
        } else {
            self.config.client_id.trim().to_string()
        };
        // 回写生成的 client_id,供 group/clients 等管理视图读取
        self.config.client_id = client_id.clone();

        let mut options = MqttOptions::new(client_id, &host, self.config.port);
        options.set_keep_alive(Duration::from_secs(self.config.keep_alive_secs.max(1)));
        options.set_clean_session(self.config.clean_session);
        if let Some(username) = self
            .config
            .username
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            let password = self.config.password.clone().unwrap_or_default();
            options.set_credentials(username.to_string(), password);
        }
        if self.config.use_tls {
            options.set_transport(Transport::tls_with_default_config());
        }

        let (client, event_loop) = AsyncClient::new(options, MQTT_MESSAGE_CHANNEL_CAPACITY);

        let connected = self.connected.clone();
        let connected_tx = self.connected_tx.clone();
        let message_tx = self.message_tx.clone();
        let subscriptions = self.subscriptions.clone();
        let (fatal_tx, fatal_rx) = mpsc::unbounded_channel();

        connected.store(false, Ordering::SeqCst);
        connected_tx.send_replace(false);

        let poll_client = client.clone();
        let poll_task = tokio::spawn(async move {
            let client = poll_client;
            let mut event_loop = event_loop;
            loop {
                match event_loop.poll().await {
                    Ok(Event::Incoming(Incoming::ConnAck(_))) => {
                        connected.store(true, Ordering::SeqCst);
                        let _ = connected_tx.send(true);
                        // 恢复本地订阅表中的订阅(移植自 builtin.rs connect() 的重订阅循环,
                        // 移至 ConnAck 分支以覆盖 rumqttc 自动重连后的订阅恢复)
                        let to_restore = subscriptions.lock().await.clone();
                        for subscription in to_restore {
                            if let Err(error) = client
                                .subscribe(&subscription.topic_filter, map_qos(subscription.qos))
                                .await
                            {
                                eprintln!(
                                    "mqtt: failed to restore subscription `{}`: {error}",
                                    subscription.topic_filter
                                );
                            }
                        }
                    }
                    Ok(Event::Incoming(Incoming::Disconnect)) => {
                        connected.store(false, Ordering::SeqCst);
                        let _ = connected_tx.send(false);
                    }
                    Ok(Event::Incoming(Incoming::Publish(publish))) => {
                        let qos = MqttQos::from_u8(publish.qos as u8).unwrap_or_default();
                        let message = MqttMessage {
                            topic: publish.topic.clone(),
                            payload: publish.payload.to_vec(),
                            qos,
                            retain: publish.retain,
                            received_at: chrono::Utc::now(),
                        };
                        // lagged 时丢弃旧消息,不影响 poll 循环
                        let _ = message_tx.send(message);
                    }
                    Ok(_) => {}
                    Err(error) => {
                        if is_fatal_auth_error(&error) {
                            // 认证被拒不应重试:通知 connect() 立即失败
                            let _ = fatal_tx.send(format!(
                                "mqtt broker refused the connection (bad username or password): {error}"
                            ));
                            connected.store(false, Ordering::SeqCst);
                            let _ = connected_tx.send(false);
                            break;
                        }
                        eprintln!("mqtt: eventloop poll error, reconnecting: {error}");
                        connected.store(false, Ordering::SeqCst);
                        let _ = connected_tx.send(false);
                        // rumqttc 在下一次 poll 时自动重连;稍作退避避免忙等
                        tokio::time::sleep(Duration::from_secs(POLL_ERROR_BACKOFF_SECS)).await;
                    }
                }
            }
        });

        // 等待初始 ConnAck(带超时);clean_session=false 时 broker 可能回放保留订阅
        if let Err(error) = self
            .wait_for_connack(self.connected_tx.subscribe(), fatal_rx)
            .await
        {
            // 连接失败时终止 poll 任务,避免其继续在后台重试
            poll_task.abort();
            return Err(error);
        }

        self.client = Some(client);
        self.poll_task = Some(poll_task);

        Ok(())
    }

    async fn disconnect(&mut self) -> Result<(), MqttError> {
        if let Some(client) = self.client.take() {
            let _ = client.disconnect().await;
        }
        if let Some(task) = self.poll_task.take() {
            task.abort();
        }
        self.connected.store(false, Ordering::SeqCst);
        self.connected_tx.send_replace(false);
        Ok(())
    }

    async fn publish(
        &self,
        topic: &str,
        payload: &[u8],
        qos: MqttQos,
        retain: bool,
    ) -> Result<(), MqttError> {
        let client = self.require_client()?;
        client
            .publish(topic, map_qos(qos), retain, payload.to_vec())
            .await
            .map_err(|error| MqttError::Protocol(format!("publish failed: {error}")))?;
        Ok(())
    }

    async fn list_subscriptions(&self) -> Result<Vec<MqttSubscription>, MqttError> {
        Ok(self.subscriptions.lock().await.clone())
    }

    fn open_pubsub(&self) -> Result<MqttPubSubHandle, MqttError> {
        Ok(MqttPubSubHandle::new(self.message_tx.subscribe()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn localhost_is_normalized() {
        assert_eq!(normalize_direct_host("localhost"), "127.0.0.1");
        assert_eq!(normalize_direct_host("LOCALHOST"), "127.0.0.1");
        assert_eq!(
            normalize_direct_host("broker.example.com"),
            "broker.example.com"
        );
        assert_eq!(normalize_direct_host("127.0.0.1"), "127.0.0.1");
    }

    #[test]
    fn qos_maps_to_rumqttc() {
        assert_eq!(map_qos(MqttQos::AtMostOnce), rumqttc::QoS::AtMostOnce);
        assert_eq!(map_qos(MqttQos::AtLeastOnce), rumqttc::QoS::AtLeastOnce);
        assert_eq!(map_qos(MqttQos::ExactlyOnce), rumqttc::QoS::ExactlyOnce);
    }

    #[test]
    fn fatal_auth_errors_are_recognized() {
        assert!(is_fatal_auth_error(&ConnectionError::ConnectionRefused(
            rumqttc::ConnectReturnCode::BadUserNamePassword
        )));
        assert!(is_fatal_auth_error(&ConnectionError::ConnectionRefused(
            rumqttc::ConnectReturnCode::NotAuthorized
        )));
        assert!(!is_fatal_auth_error(&ConnectionError::ConnectionRefused(
            rumqttc::ConnectReturnCode::ServiceUnavailable
        )));
        assert!(!is_fatal_auth_error(&ConnectionError::Io(
            std::io::Error::other("boom")
        )));
    }

    #[test]
    fn new_impl_seeds_auto_subscription() {
        let impl_ = MqttConnectionImpl::new(MqttConnectionConfig::default());
        let subscriptions = impl_.subscriptions.try_lock().expect("锁不应被占用");
        assert_eq!(subscriptions.len(), 1);
        assert_eq!(subscriptions[0].topic_filter, "#");
        assert_eq!(subscriptions[0].qos, MqttQos::AtLeastOnce);
    }
}
