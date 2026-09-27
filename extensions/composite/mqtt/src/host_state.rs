//! 订阅画像的宿主 KV 持久化(best-effort,不阻塞任何主流程)。
//!
//! **为什么需要它**:订阅表与消息环形缓冲都活在 provider 进程内存里。宿主在
//! provider 进程退出后会拉起新进程(新 resource),旧进程的订阅表随之消失 ——
//! 表现就是「订阅和 topic 一起没了」。把用户订阅(以及 provider 生成的
//! client_id)落到宿主的 KV 里,重开后即可恢复,`clean_session=false` 时
//! 还能顺带续上 broker 侧会话。
//!
//! **为什么是 best-effort**:宿主 KV 在部分版本里是桩实现(读写都成功但读回
//! 永远是空)。这里不猜、不重试,而是**写后读回校验**一次,把结论记进
//! `persistence_ok`,让 UI 能如实告诉用户「本机宿主未启用订阅持久化」。
//! 任何 KV 失败都不得影响连接与订阅本身。

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::ipc::{IpcParts, storage_get, storage_set};
use crate::types::{MqttQos, MqttSubscription};

/// KV 命名空间(宿主会再叠加扩展 id,不会与其他扩展串味)
pub(crate) const STORAGE_NAMESPACE: &str = "mqtt";

/// 画像键前缀
const PROFILE_KEY_PREFIX: &str = "profile/";

/// 画像结构版本(将来改字段时可据此迁移/丢弃)
pub(crate) const PROFILE_VERSION: u32 = 1;

fn default_version() -> u32 {
    PROFILE_VERSION
}

/// 单个持久化订阅
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct StoredSubscription {
    pub topic_filter: String,
    pub qos: u8,
}

impl StoredSubscription {
    pub(crate) fn from_subscription(subscription: &MqttSubscription) -> Self {
        Self {
            topic_filter: subscription.topic_filter.clone(),
            qos: subscription.qos.as_u8(),
        }
    }

    /// 转回运行时订阅;QoS 越界(脏数据)按 AtLeastOnce 兜底而不是整条丢弃
    pub(crate) fn to_subscription(&self) -> MqttSubscription {
        MqttSubscription {
            topic_filter: self.topic_filter.clone(),
            qos: MqttQos::from_u8(self.qos).unwrap_or(MqttQos::AtLeastOnce),
        }
    }
}

/// 某个连接画像:同一 broker 账号下复用
#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct StoredProfile {
    #[serde(default = "default_version")]
    pub version: u32,
    /// provider 生成的 client_id(用户没显式填时保存下来,重开后沿用同一身份)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,
    /// 用户订阅(不含 `auto_subscribe` 的自动过滤器,那条来自连接配置)
    #[serde(default)]
    pub subscriptions: Vec<StoredSubscription>,
    #[serde(default)]
    pub updated_at_ms: u64,
}

impl StoredProfile {
    pub(crate) fn new() -> Self {
        Self {
            version: PROFILE_VERSION,
            client_id: None,
            subscriptions: Vec::new(),
            updated_at_ms: 0,
        }
    }

    /// 恢复出的订阅(过滤空过滤器)
    pub(crate) fn restored_subscriptions(&self) -> Vec<MqttSubscription> {
        self.subscriptions
            .iter()
            .map(StoredSubscription::to_subscription)
            .filter(|subscription| !subscription.topic_filter.trim().is_empty())
            .collect()
    }
}

/// 画像键:按「协议 + 主机 + 端口 + 用户名 + 显式 client_id」派生。
///
/// **刻意不含 provider 生成的随机 client_id**:否则每次 open 都换键,画像
/// 永远命中不了。用户名进键是为了同一 broker 上的不同账号不互相覆盖。
/// 用 FNV-1a(自实现,零依赖)压成长度固定的短键,避免把用户名等明文留在
/// 宿主存储的文件名/键名里。
pub(crate) fn profile_key(
    host: &str,
    port: u16,
    use_tls: bool,
    username: Option<&str>,
    explicit_client_id: &str,
) -> String {
    let mut hasher = Fnv1a64::new();
    for part in [
        "mqtt",
        host,
        &port.to_string(),
        if use_tls { "tls" } else { "plain" },
        username.unwrap_or(""),
        explicit_client_id,
    ] {
        hasher.write(part.as_bytes());
        hasher.write(&[0x1f]);
    }
    format!("{PROFILE_KEY_PREFIX}{:016x}", hasher.finish())
}

/// FNV-1a 64 位(确定性、跨进程稳定,不用于安全场景)
struct Fnv1a64(u64);

impl Fnv1a64 {
    const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x0000_0100_0000_01b3;

    fn new() -> Self {
        Self(Self::OFFSET)
    }

    fn write(&mut self, bytes: &[u8]) {
        for byte in bytes {
            self.0 ^= u64::from(*byte);
            self.0 = self.0.wrapping_mul(Self::PRIME);
        }
    }

    fn finish(&self) -> u64 {
        self.0
    }
}

/// 读取画像。`Err` 表示宿主不支持 KV 或 KV 故障(调用方应停止后续尝试)。
pub(crate) async fn load_profile<R, W>(
    ipc: &mut IpcParts<R, W>,
    key: &str,
    next_id: &std::sync::atomic::AtomicI64,
) -> Result<Option<StoredProfile>, String>
where
    R: tokio::io::AsyncReadExt + Unpin,
    W: tokio::io::AsyncWriteExt + Unpin,
{
    let value = storage_get(ipc, key, next_id)
        .await
        .map_err(|error| error.message)?;
    let Some(value) = value else {
        return Ok(None);
    };
    // 脏数据(结构变了/被别的扩展写了同名键)当作「没有画像」,不打断连接
    match serde_json::from_value::<StoredProfile>(value) {
        Ok(profile) if profile.version == PROFILE_VERSION => Ok(Some(profile)),
        Ok(profile) => {
            eprintln!(
                "mqtt: ignoring stored profile with unsupported version {}",
                profile.version
            );
            Ok(None)
        }
        Err(error) => {
            eprintln!("mqtt: ignoring unreadable stored profile: {error}");
            Ok(None)
        }
    }
}

/// 写入画像。返回是否**确实落盘**(写后读回比对)。
pub(crate) async fn save_profile<R, W>(
    ipc: &mut IpcParts<R, W>,
    key: &str,
    profile: &StoredProfile,
    next_id: &std::sync::atomic::AtomicI64,
) -> Result<bool, String>
where
    R: tokio::io::AsyncReadExt + Unpin,
    W: tokio::io::AsyncWriteExt + Unpin,
{
    let value: Value = serde_json::to_value(profile).map_err(|error| error.to_string())?;
    storage_set(ipc, key, value.clone(), next_id)
        .await
        .map_err(|error| error.message)?;
    // 读回校验:宿主 KV 是桩实现时这里立刻失败,避免 UI 误以为订阅已被保存。
    let read_back = storage_get(ipc, key, next_id)
        .await
        .map_err(|error| error.message)?;
    Ok(
        matches!(serde_json::from_value::<StoredProfile>(read_back.unwrap_or(Value::Null)), Ok(stored)
        if stored.version == profile.version && stored.subscriptions == profile.subscriptions),
    )
}

/// 当前 Unix 毫秒(画像里的 `updated_at_ms`,便于人工排查)
pub(crate) fn now_unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_key_is_stable_and_scoped() {
        let base = profile_key("broker.local", 1883, false, Some("alice"), "");
        assert_eq!(
            base,
            profile_key("broker.local", 1883, false, Some("alice"), "")
        );
        assert!(base.starts_with(PROFILE_KEY_PREFIX));
        // 每个维度都参与派生
        assert_ne!(
            base,
            profile_key("broker.local", 1884, false, Some("alice"), "")
        );
        assert_ne!(
            base,
            profile_key("broker.local", 1883, true, Some("alice"), "")
        );
        assert_ne!(
            base,
            profile_key("other.local", 1883, false, Some("alice"), "")
        );
        assert_ne!(base, profile_key("broker.local", 1883, false, None, ""));
        assert_ne!(
            base,
            profile_key("broker.local", 1883, false, Some("alice"), "cid")
        );
    }

    #[test]
    fn stored_profile_roundtrips() {
        let profile = StoredProfile {
            version: PROFILE_VERSION,
            client_id: Some("navop-mqtt-abc".to_string()),
            subscriptions: vec![StoredSubscription {
                topic_filter: "sensors/#".to_string(),
                qos: 2,
            }],
            updated_at_ms: 42,
        };
        let json = serde_json::to_string(&profile).expect("序列化");
        let back: StoredProfile = serde_json::from_str(&json).expect("反序列化");
        assert_eq!(back.subscriptions, profile.subscriptions);
        assert_eq!(back.client_id.as_deref(), Some("navop-mqtt-abc"));
    }

    #[test]
    fn missing_version_defaults_and_dirty_qos_falls_back() {
        let profile: StoredProfile =
            serde_json::from_str(r#"{"subscriptions":[{"topic_filter":"a/b","qos":9}]}"#)
                .expect("缺 version 应可解析");
        assert_eq!(profile.version, PROFILE_VERSION);
        let restored = profile.restored_subscriptions();
        assert_eq!(restored.len(), 1);
        assert_eq!(restored[0].qos, MqttQos::AtLeastOnce);
        assert_eq!(restored[0].topic_filter, "a/b");
    }

    #[test]
    fn empty_filters_are_dropped() {
        let profile = StoredProfile {
            version: PROFILE_VERSION,
            client_id: None,
            subscriptions: vec![
                StoredSubscription {
                    topic_filter: "   ".to_string(),
                    qos: 0,
                },
                StoredSubscription {
                    topic_filter: "#".to_string(),
                    qos: 1,
                },
            ],
            updated_at_ms: 0,
        };
        assert_eq!(profile.restored_subscriptions().len(), 1);
    }
}
