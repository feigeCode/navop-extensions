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
use rumqttc::{
    AsyncClient, ConnectionError, Event, Incoming, MqttOptions, TlsConfiguration, Transport,
};
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::WebPkiSupportedAlgorithms;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{ClientConfig, DigitallySignedStruct, Error as RustlsError, SignatureScheme};
use tokio::sync::{Mutex, broadcast, mpsc, watch};
use tokio::time::timeout;

use crate::connection::MqttConnection;
use crate::pubsub::{MQTT_MESSAGE_CHANNEL_CAPACITY, MqttPubSubHandle};
use crate::types::{MqttConnectionConfig, MqttError, MqttMessage, MqttQos, MqttSubscription};

/// 自动订阅使用的 QoS(与主仓发送默认 QoS 一致,取 AtLeastOnce)
const AUTO_SUBSCRIBE_QOS: MqttQos = MqttQos::AtLeastOnce;

/// 标准 §4:client_id 留空时由 provider 生成 `navop-mqtt-<随机后缀>`
const CLIENT_ID_PREFIX: &str = "navop-mqtt-";

/// poll 错误退避间隔(秒),避免断连期间忙等
const POLL_ERROR_BACKOFF_SECS: u64 = 1;

/// 事件循环致命退出后的统一错误文案(可操作:告诉用户重开连接)
const EVENTLOOP_DEAD_DETAIL: &str =
    "连接已断开且无法自动恢复（broker 拒绝认证或事件循环已退出），请关闭并重新打开该连接";

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

/// ring 提供的签名校验算法集(跳过证书校验模式下仍需按算法集校验握手签名)
fn signature_algorithms() -> WebPkiSupportedAlgorithms {
    rustls::crypto::ring::default_provider().signature_verification_algorithms
}

/// 「跳过服务端证书校验」模式下的校验器:接受任意证书链与主机名。
///
/// 只放行「证书是否可信」这一层;握手签名的完整性仍按 ring 算法集正常校验——
/// 跳过的是信任判断,不是 TLS 本身。仅用于自签/内网调试。
#[derive(Debug)]
struct AcceptAnyServerCertificate;

impl ServerCertVerifier for AcceptAnyServerCertificate {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, RustlsError> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, RustlsError> {
        rustls::crypto::verify_tls12_signature(message, cert, dss, &signature_algorithms())
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, RustlsError> {
        rustls::crypto::verify_tls13_signature(message, cert, dss, &signature_algorithms())
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        signature_algorithms().supported_schemes()
    }
}

/// 读取 TLS 材料:内联 PEM 优先,其次文件路径;两者都没有则 None。
///
/// 读不到直接报错(带路径与原因),**不静默降级**到系统根证书:静默降级会让用户
/// 以为自签证书已生效,而真实失败原因还藏在 TLS 校验里看不出来。
/// 证书文件只有几 KiB,这里用同步 IO(tokio 未开 `fs` feature)。
fn read_tls_material(
    inline_pem: &str,
    path: &str,
    label: &str,
) -> Result<Option<Vec<u8>>, MqttError> {
    let inline = inline_pem.trim();
    if !inline.is_empty() {
        return Ok(Some(inline.as_bytes().to_vec()));
    }
    let path = path.trim();
    if path.is_empty() {
        return Ok(None);
    }
    std::fs::read(path).map(Some).map_err(|error| {
        MqttError::Config(format!("读取{label}文件 `{path}` 失败: {error}"))
    })
}

/// 构建 TLS 传输。
///
/// - 未提供任何 TLS 材料:沿用 rumqttc 默认配置(系统根证书),老配置行为不变
/// - 提供 CA(内联或路径):以该 CA 作为信任根(自签证书直接填这里即可)
/// - 提供客户端证书/私钥:mTLS(同时必须提供 CA)
/// - `tls_skip_verify`:接受任意服务端证书(与 mTLS 互斥)
fn build_transport(config: &MqttConnectionConfig) -> Result<Transport, MqttError> {
    if !config.has_custom_tls() {
        return Ok(Transport::tls_with_default_config());
    }

    let has_cert = !config.tls_client_cert_path.trim().is_empty();
    let has_key = !config.tls_client_key_path.trim().is_empty();
    if has_cert != has_key {
        return Err(MqttError::Config(
            "mTLS 需要同时提供客户端证书与私钥（tls_client_cert_path / tls_client_key_path）"
                .to_string(),
        ));
    }
    if config.tls_skip_verify && has_cert {
        return Err(MqttError::Config(
            "「跳过证书校验」与 mTLS 互斥：跳过校验时无法验证客户端证书链".to_string(),
        ));
    }

    if config.tls_skip_verify {
        let client_config = ClientConfig::builder()
            .dangerous()
            .with_custom_certificate_verifier(Arc::new(AcceptAnyServerCertificate))
            .with_no_client_auth();
        return Ok(Transport::tls_with_config(TlsConfiguration::Rustls(
            Arc::new(client_config),
        )));
    }

    let Some(ca) = read_tls_material(&config.tls_ca_pem, &config.tls_ca_path, "CA 证书")? else {
        return Err(MqttError::Config(
            "自定义 TLS 与 mTLS 都需要 CA 证书：请填入 `tls_ca_pem` 或 `tls_ca_path`".to_string(),
        ));
    };
    let client_auth = if has_cert {
        let cert = read_tls_material("", &config.tls_client_cert_path, "客户端证书")?
            .unwrap_or_default();
        let key =
            read_tls_material("", &config.tls_client_key_path, "客户端私钥")?.unwrap_or_default();
        Some((cert, key))
    } else {
        None
    };

    Ok(Transport::tls_with_config(TlsConfiguration::Simple {
        ca,
        alpn: None,
        client_auth,
    }))
}

/// MQTT 连接实现(rumqttc AsyncClient + EventLoop)
pub(crate) struct MqttConnectionImpl {
    config: MqttConnectionConfig,
    client: Option<AsyncClient>,
    poll_task: Option<tokio::task::JoinHandle<()>>,
    connected: Arc<AtomicBool>,
    /// 事件循环存活标志:poll 任务因致命错误(如重连时认证被拒)退出后置 false,
    /// 此后所有 client 请求都应返回可操作的连接错误,而非 rumqttc 的 channel 文案。
    eventloop_alive: Arc<AtomicBool>,
    /// 连接状态 watch(poll 任务写,connect 等待初始 ConnAck)
    connected_tx: watch::Sender<bool>,
    subscriptions: Arc<Mutex<Vec<MqttSubscription>>>,
    message_tx: broadcast::Sender<MqttMessage>,
}

impl MqttConnectionImpl {
    pub(crate) fn new(config: MqttConnectionConfig) -> Self {
        let (message_tx, _) = broadcast::channel(MQTT_MESSAGE_CHANNEL_CAPACITY);
        let (connected_tx, _) = watch::channel(false);
        // 预置自动订阅(表单 auto_subscribe,空串表示不自动订阅):
        // poll 任务收到 ConnAck 后统一恢复(含断线重连)
        let filter = config.auto_subscribe.trim();
        let seed = (!filter.is_empty())
            .then(|| MqttSubscription {
                topic_filter: filter.to_string(),
                qos: AUTO_SUBSCRIBE_QOS,
            })
            .into_iter()
            .collect();
        let subscriptions = Arc::new(Mutex::new(seed));
        Self {
            config,
            client: None,
            poll_task: None,
            connected: Arc::new(AtomicBool::new(false)),
            eventloop_alive: Arc::new(AtomicBool::new(true)),
            connected_tx,
            subscriptions,
            message_tx,
        }
    }

    fn require_client(&self) -> Result<&AsyncClient, MqttError> {
        self.client.as_ref().ok_or(MqttError::NotConnected)
    }

    /// 面向「需要向 eventloop 发请求」的操作(publish/subscribe/unsubscribe)的守卫:
    /// 未连接报 NotConnected;事件循环已致命退出时报可操作的连接错误。
    fn require_sendable_client(&self) -> Result<&AsyncClient, MqttError> {
        let client = self.require_client()?;
        if !self.eventloop_alive.load(Ordering::SeqCst) {
            return Err(MqttError::Connection(EVENTLOOP_DEAD_DETAIL.to_string()));
        }
        Ok(client)
    }

    /// 把 rumqttc 客户端错误归类:「eventloop channel 已关闭」是连接级故障,
    /// 给出可操作文案;其余保持协议错误原样。
    fn classify_client_error(error: rumqttc::ClientError, action: &str) -> MqttError {
        let text = error.to_string();
        if text.contains("Failed to send mqtt requests to eventloop") {
            MqttError::Connection(EVENTLOOP_DEAD_DETAIL.to_string())
        } else {
            MqttError::Protocol(format!("{action}: {text}"))
        }
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
        // 标准 §4:client_id 留空时由 provider 生成 `navop-mqtt-<随机后缀>`。
        // 上层(server/resource.rs)在 open 时已尽可能用宿主 KV 里保存过的 id 回填
        // `config.client_id`,所以这里生成的随机 id 只在「首次连接且宿主无 KV」时出现。
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
            options.set_transport(build_transport(&self.config)?);
        }
        if let Some(will) = &self.config.last_will {
            options.set_last_will(rumqttc::LastWill::new(
                will.topic.clone(),
                will.payload.clone(),
                map_qos(will.qos),
                will.retain,
            ));
        }

        let (client, event_loop) = AsyncClient::new(options, MQTT_MESSAGE_CHANNEL_CAPACITY);

        let connected = self.connected.clone();
        let connected_tx = self.connected_tx.clone();
        let message_tx = self.message_tx.clone();
        let subscriptions = self.subscriptions.clone();
        let eventloop_alive = self.eventloop_alive.clone();
        let (fatal_tx, fatal_rx) = mpsc::unbounded_channel();

        connected.store(false, Ordering::SeqCst);
        connected_tx.send_replace(false);
        eventloop_alive.store(true, Ordering::SeqCst);

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
                            // 认证被拒不应重试:通知 connect() 立即失败,
                            // 并标记事件循环已死,阻断后续所有 client 请求。
                            eventloop_alive.store(false, Ordering::SeqCst);
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

    async fn seed_subscriptions(
        &mut self,
        subscriptions: Vec<MqttSubscription>,
    ) -> Result<(), MqttError> {
        let mut table = self.subscriptions.lock().await;
        for subscription in subscriptions {
            let filter = subscription.topic_filter.trim().to_string();
            if filter.is_empty() {
                continue;
            }
            // 已存在(auto_subscribe 或恢复列表里的重复项)时不覆盖:重复的
            // SUBSCRIBE 会让 broker 以新 QoS 重订阅,但本地表只该有一份真相。
            if table.iter().any(|existing| existing.topic_filter == filter) {
                continue;
            }
            table.push(MqttSubscription {
                topic_filter: filter,
                qos: subscription.qos,
            });
        }
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
        let client = self.require_sendable_client()?;
        client
            .publish(topic, map_qos(qos), retain, payload.to_vec())
            .await
            .map_err(|error| Self::classify_client_error(error, "publish failed"))?;
        Ok(())
    }

    async fn subscribe(&self, topic_filter: &str, qos: MqttQos) -> Result<(), MqttError> {
        let filter = topic_filter.trim().to_string();
        if filter.is_empty() {
            return Err(MqttError::Protocol(
                "subscription topic filter must not be empty".to_string(),
            ));
        }
        // 先看本地表,决定要不要真的发 SUBSCRIBE
        let already_same_qos = {
            let table = self.subscriptions.lock().await;
            table
                .iter()
                .find(|sub| sub.topic_filter == filter)
                .is_some_and(|existing| existing.qos == qos)
        };
        if already_same_qos {
            return Ok(());
        }
        // **先通报 broker,再改本地表**:反过来写的话,broker 侧失败(事件循环
        // 已死/网络断)时本地表已经多出一条只存在于 provider 记忆里的订阅,
        // 之后既不会重试也恢复不了。
        let client = self.require_sendable_client()?;
        client
            .subscribe(filter.as_str(), map_qos(qos))
            .await
            .map_err(|error| Self::classify_client_error(error, "subscribe failed"))?;
        let mut table = self.subscriptions.lock().await;
        match table.iter_mut().find(|sub| sub.topic_filter == filter) {
            Some(existing) => existing.qos = qos,
            None => table.push(MqttSubscription {
                topic_filter: filter,
                qos,
            }),
        }
        Ok(())
    }

    async fn unsubscribe(&self, topic_filter: &str) -> Result<(), MqttError> {
        let filter = topic_filter.trim().to_string();
        if filter.is_empty() {
            return Err(MqttError::Protocol(
                "subscription topic filter must not be empty".to_string(),
            ));
        }
        // 同上:先确认本地有这条订阅(没有就报错,不必打扰 broker),
        // 再通报 broker,最后才从本地表移除。
        {
            let table = self.subscriptions.lock().await;
            if !table.iter().any(|sub| sub.topic_filter == filter) {
                return Err(MqttError::Protocol(format!(
                    "no active subscription for `{filter}`"
                )));
            }
        }
        let client = self.require_sendable_client()?;
        client
            .unsubscribe(filter.as_str())
            .await
            .map_err(|error| Self::classify_client_error(error, "unsubscribe failed"))?;
        let mut table = self.subscriptions.lock().await;
        table.retain(|sub| sub.topic_filter != filter);
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

    #[test]
    fn empty_auto_subscribe_seeds_nothing() {
        let impl_ = MqttConnectionImpl::new(MqttConnectionConfig {
            auto_subscribe: "  ".into(),
            ..MqttConnectionConfig::default()
        });
        assert!(impl_.subscriptions.try_lock().unwrap().is_empty());
    }

    /// 构建 TLS 传输并断言失败(Transport 未实现 Debug,不能用 `expect_err`)
    fn transport_error(config: &MqttConnectionConfig) -> MqttError {
        match build_transport(config) {
            Ok(_) => panic!("期望 TLS 传输构建失败"),
            Err(error) => error,
        }
    }

    #[test]
    fn default_config_uses_system_roots() {
        let config = MqttConnectionConfig::default();
        assert!(!config.has_custom_tls());
        assert_eq!(config.tls_mode(), "off");
        // 无 TLS 材料 → 沿用 rumqttc 默认配置(系统根证书)
        let transport = build_transport(&config).expect("默认 TLS 传输应构建成功");
        assert!(matches!(
            transport,
            Transport::Tls(TlsConfiguration::Simple { .. } | TlsConfiguration::Rustls(_))
        ));

        // 空白材料不算配置(避免表单留白触发自定义分支)
        let config = MqttConnectionConfig {
            use_tls: true,
            tls_ca_pem: "   \n ".into(),
            tls_ca_path: "  ".into(),
            ..MqttConnectionConfig::default()
        };
        assert!(!config.has_custom_tls());
        assert_eq!(config.tls_mode(), "system-roots");
    }

    #[test]
    fn inline_ca_selects_custom_roots() {
        let config = MqttConnectionConfig {
            use_tls: true,
            tls_ca_pem: "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----".into(),
            ..MqttConnectionConfig::default()
        };
        assert_eq!(config.tls_mode(), "custom-ca");
        let Transport::Tls(TlsConfiguration::Simple { ca, client_auth, .. }) =
            build_transport(&config).expect("自定义 CA 应构建成功")
        else {
            panic!("自定义 CA 应走 TlsConfiguration::Simple");
        };
        assert!(String::from_utf8(ca).unwrap().contains("BEGIN CERTIFICATE"));
        assert!(client_auth.is_none());
    }

    #[test]
    fn ca_file_is_read_from_path() {
        let dir = tempfile::tempdir().expect("临时目录");
        let path = dir.path().join("ca.pem");
        std::fs::write(&path, b"-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----").unwrap();
        let config = MqttConnectionConfig {
            use_tls: true,
            tls_ca_path: path.display().to_string(),
            ..MqttConnectionConfig::default()
        };
        let Transport::Tls(TlsConfiguration::Simple { ca, .. }) =
            build_transport(&config).expect("CA 文件应读取成功")
        else {
            panic!("CA 文件应走 TlsConfiguration::Simple");
        };
        assert!(String::from_utf8(ca).unwrap().contains("BEGIN CERTIFICATE"));

        // 读取失败必须报配置错误(不静默降级到系统根)
        let error = transport_error(&MqttConnectionConfig {
            use_tls: true,
            tls_ca_path: dir.path().join("missing.pem").display().to_string(),
            ..MqttConnectionConfig::default()
        });
        assert!(matches!(error, MqttError::Config(_)));
        assert!(error.to_string().starts_with("配置错误: "), "{error}");
    }

    #[test]
    fn mutual_tls_requires_cert_and_key_and_ca() {
        let cert = MqttConnectionConfig {
            use_tls: true,
            tls_client_cert_path: "/tmp/client.pem".into(),
            tls_ca_pem: "ca".into(),
            ..MqttConnectionConfig::default()
        };
        let error = transport_error(&cert);
        assert!(error.to_string().contains("同时提供客户端证书与私钥"), "{error}");

        // 证书/私钥齐备但没有 CA:mTLS 无法建立信任根,必须报错而不是用系统根
        let no_ca = MqttConnectionConfig {
            use_tls: true,
            tls_client_cert_path: "/tmp/client.pem".into(),
            tls_client_key_path: "/tmp/client.key".into(),
            ..MqttConnectionConfig::default()
        };
        assert_eq!(no_ca.tls_mode(), "mutual");
        let error = transport_error(&no_ca);
        assert!(error.to_string().contains("需要 CA 证书"), "{error}");
    }

    #[test]
    fn skip_verify_builds_insecure_rustls_config() {
        let config = MqttConnectionConfig {
            use_tls: true,
            tls_skip_verify: true,
            ..MqttConnectionConfig::default()
        };
        assert_eq!(config.tls_mode(), "skip-verify");
        let Transport::Tls(TlsConfiguration::Rustls(client_config)) =
            build_transport(&config).expect("跳过校验应构建成功")
        else {
            panic!("跳过校验应走 TlsConfiguration::Rustls");
        };
        // 跳过校验模式不额外设置 ALPN,也不要求任何信任根
        assert!(client_config.alpn_protocols.is_empty());

        // 与 mTLS 互斥
        let conflicted = MqttConnectionConfig {
            use_tls: true,
            tls_skip_verify: true,
            tls_client_cert_path: "/tmp/client.pem".into(),
            tls_client_key_path: "/tmp/client.key".into(),
            ..MqttConnectionConfig::default()
        };
        let error = transport_error(&conflicted);
        assert!(error.to_string().contains("互斥"), "{error}");
    }
}
