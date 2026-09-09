//! MQTT 领域类型:连接配置、错误、QoS、消息与订阅。
//!
//! 移植自主仓 `crates/mqtt-runtime/src/types.rs`,按 provider 侧需要裁剪:
//! - 去掉 `id`/`name`/`credential_reference`/`ssh_tunnel`(连接标识与凭据引用由宿主持有,
//!   标准 §4 规定 SSH 隧道由宿主连接窗口统一提供,provider 侧不感知)
//! - 错误文本统一携带标准 §3 前缀(`连接错误:`/`协议错误:` 等)
//! - 协议版本固定 MQTT 3.1.1(rumqttc v4),V5 仅在主仓预留

use crate::contract::MiddlewareError;

/// MQTT 协议版本(provider 侧固定使用 MQTT 3.1.1)
pub(crate) const MQTT_PROTOCOL_VERSION: &str = "3.1.1";

/// MQTT 连接配置(运行时)
#[derive(Clone, Debug)]
pub(crate) struct MqttConnectionConfig {
    /// 主机地址
    pub host: String,
    /// 端口(非 TLS 默认 1883,TLS 默认 8883)
    pub port: u16,
    /// 客户端 ID(空串表示连接时自动生成 `navop-mqtt-<随机后缀>`,见标准 §4)
    pub client_id: String,
    /// 用户名
    pub username: Option<String>,
    /// 密码(经宿主 reverse Host API 解析 `secret://self/...` 后注入)
    pub password: Option<String>,
    /// 是否启用 TLS(表单未暴露,预留 8883 端口场景,默认 false)
    pub use_tls: bool,
    /// 连接超时(秒)
    pub timeout: u64,
    /// keep-alive 间隔(秒;标准 §4 表单默认 60)
    pub keep_alive_secs: u64,
    /// 清除会话
    pub clean_session: bool,
}

fn default_timeout() -> u64 {
    10
}

fn default_keep_alive() -> u64 {
    // 标准 §4:keep_alive_secs 表单默认 60(主仓原默认 30,这里以标准为准)
    60
}

impl Default for MqttConnectionConfig {
    fn default() -> Self {
        Self {
            host: "127.0.0.1".to_string(),
            port: 1883,
            client_id: String::new(),
            username: None,
            password: None,
            use_tls: false,
            timeout: default_timeout(),
            keep_alive_secs: default_keep_alive(),
            clean_session: true,
        }
    }
}

impl MqttConnectionConfig {
    /// 服务器信息显示
    pub(crate) fn server_info(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}

/// MQTT 错误(错误文本携带标准 §3 前缀)
#[derive(Debug)]
pub(crate) enum MqttError {
    /// 协议错误(编解码或请求失败)
    Protocol(String),
    /// 操作超时
    Timeout(String),
    /// 尚未连接到 MQTT 服务器
    NotConnected,
    /// 认证错误(broker 拒绝凭据)
    Auth(String),
}

impl std::fmt::Display for MqttError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Protocol(detail) => write!(f, "协议错误: {detail}"),
            Self::Timeout(detail) => write!(f, "操作超时: {detail}"),
            Self::NotConnected => write!(f, "连接错误: 尚未连接到 MQTT 服务器"),
            Self::Auth(detail) => write!(f, "认证错误: {detail}"),
        }
    }
}

impl std::error::Error for MqttError {}

impl From<MqttError> for MiddlewareError {
    fn from(error: MqttError) -> Self {
        match error {
            MqttError::Timeout(detail) => Self::Timeout(detail),
            // NotConnected 无明细文本,转为固定的连接错误说明
            MqttError::NotConnected => Self::Connection("尚未连接到 MQTT 服务器".to_string()),
            MqttError::Auth(detail) => Self::Auth(detail),
            MqttError::Protocol(detail) => Self::Protocol(detail),
        }
    }
}

/// MQTT QoS 等级(AtMostOnce/AtLeastOnce/ExactlyOnce 为 MQTT 规范术语,移植保留)
#[allow(clippy::enum_variant_names)]
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) enum MqttQos {
    /// 最多一次(0)
    #[default]
    AtMostOnce,
    /// 至少一次(1)
    AtLeastOnce,
    /// 恰好一次(2)
    ExactlyOnce,
}

impl MqttQos {
    pub(crate) fn as_u8(self) -> u8 {
        match self {
            Self::AtMostOnce => 0,
            Self::AtLeastOnce => 1,
            Self::ExactlyOnce => 2,
        }
    }

    pub(crate) fn from_u8(value: u8) -> Option<Self> {
        match value {
            0 => Some(Self::AtMostOnce),
            1 => Some(Self::AtLeastOnce),
            2 => Some(Self::ExactlyOnce),
            _ => None,
        }
    }

    pub(crate) fn label(self) -> &'static str {
        match self {
            Self::AtMostOnce => "QoS 0",
            Self::AtLeastOnce => "QoS 1",
            Self::ExactlyOnce => "QoS 2",
        }
    }
}

/// MQTT 消息
#[derive(Clone, Debug)]
pub(crate) struct MqttMessage {
    pub topic: String,
    pub payload: Vec<u8>,
    pub qos: MqttQos,
    pub retain: bool,
    /// 接收时间
    pub received_at: chrono::DateTime<chrono::Utc>,
}

impl MqttMessage {
    /// payload 的 UTF-8 文本(无效 UTF-8 返回 None)
    pub(crate) fn payload_text(&self) -> Option<String> {
        String::from_utf8(self.payload.clone()).ok()
    }
}

/// MQTT 订阅
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct MqttSubscription {
    /// 主题过滤器(支持 + 与 # 通配符)
    pub topic_filter: String,
    pub qos: MqttQos,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn qos_roundtrip() {
        for qos in [
            MqttQos::AtMostOnce,
            MqttQos::AtLeastOnce,
            MqttQos::ExactlyOnce,
        ] {
            assert_eq!(MqttQos::from_u8(qos.as_u8()), Some(qos));
        }
        assert_eq!(MqttQos::from_u8(3), None);
    }

    #[test]
    fn message_payload_text() {
        let message = MqttMessage {
            topic: "a/b".into(),
            payload: b"hi".to_vec(),
            qos: MqttQos::AtLeastOnce,
            retain: false,
            received_at: chrono::Utc::now(),
        };
        assert_eq!(message.payload_text().as_deref(), Some("hi"));

        let binary = MqttMessage {
            payload: vec![0xFF, 0x00],
            ..message
        };
        assert!(binary.payload_text().is_none());
    }

    #[test]
    fn config_defaults_follow_standard() {
        let config = MqttConnectionConfig::default();
        assert_eq!(config.host, "127.0.0.1");
        assert_eq!(config.port, 1883);
        assert_eq!(config.timeout, 10);
        // 标准 §4:keep_alive_secs 默认 60
        assert_eq!(config.keep_alive_secs, 60);
        assert!(config.clean_session);
        assert_eq!(config.server_info(), "127.0.0.1:1883");
    }

    #[test]
    fn mqtt_error_display_carries_prefix() {
        assert!(
            MqttError::NotConnected
                .to_string()
                .starts_with("连接错误: ")
        );
        assert!(
            MqttError::Timeout("slow".to_string())
                .to_string()
                .starts_with("操作超时: ")
        );
        assert!(
            MqttError::Auth("bad".to_string())
                .to_string()
                .starts_with("认证错误: ")
        );
        assert!(
            MqttError::Protocol("broken".to_string())
                .to_string()
                .starts_with("协议错误: ")
        );
    }

    #[test]
    fn mqtt_error_converts_to_middleware_error() {
        let error: MiddlewareError = MqttError::Timeout("slow".to_string()).into();
        assert!(error.to_string().starts_with("操作超时: "));
        let error: MiddlewareError = MqttError::Auth("bad".to_string()).into();
        assert!(error.to_string().starts_with("认证错误: "));
        let error: MiddlewareError = MqttError::NotConnected.into();
        assert!(error.to_string().starts_with("连接错误: "));
    }
}
