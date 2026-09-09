//! 连接配置解析与 DSN 构造。
//!
//! `conn/test` / `conn/open` 的 `config` 由宿主按 driver.json 的 Connection 表单生成:
//! `{ host, port, username, password, database?, schema?, connect_timeout? }`。
//! 这里解析为 [`TdConnectionConfig`] 并组装 taos DSN。
//!
//! DSN 构造逻辑移植自主仓 `crates/db/src/tdengine/connection.rs` 的 `build_dsn`:
//! `ws://user:pass@host:port[/db]`,默认端口 6041(taosAdapter WebSocket 通道)。

use std::collections::HashMap;

use serde::Deserialize;
use serde_json::Value;

/// TDengine 默认端口:taosAdapter 的 WebSocket REST/service 端口。
pub const TDENGINE_DEFAULT_PORT: u16 = 6041;

/// TDengine 默认连接超时时间(秒)。
pub const DEFAULT_CONNECT_TIMEOUT_SECS: u64 = 30;

/// 驱动接受的连接配置(与 driver.json Connection 表单字段一一对应)。
#[derive(Clone, Debug, Deserialize)]
pub struct TdConnectionConfig {
    /// 主机名,默认 127.0.0.1。
    #[serde(default = "default_host")]
    pub host: String,
    /// 端口,默认 6041(taosAdapter)。
    #[serde(default = "default_port")]
    pub port: u16,
    /// 用户名,默认 root;为空时 DSN 省略 userinfo,由驱动侧默认值补齐。
    #[serde(default)]
    pub username: String,
    /// 密码,默认 taosdata(TDengine 出厂默认)。
    #[serde(default)]
    pub password: String,
    /// 默认数据库,可空;非空时拼入 DSN 路径。
    #[serde(default)]
    pub database: Option<String>,
    /// WebSocket scheme:ws(默认)/ wss(以及 http/https 别名)。
    #[serde(default)]
    pub schema: Option<String>,
    /// 连接超时(秒),默认 30。
    #[serde(default)]
    pub connect_timeout: Option<u64>,
    /// 兼容宿主透传的附加参数(忽略未知键)。
    #[serde(default)]
    #[allow(dead_code)]
    pub extra_params: HashMap<String, String>,
}

fn default_host() -> String {
    "127.0.0.1".to_string()
}

fn default_port() -> u16 {
    TDENGINE_DEFAULT_PORT
}

impl Default for TdConnectionConfig {
    fn default() -> Self {
        Self {
            host: default_host(),
            port: default_port(),
            username: String::new(),
            password: String::new(),
            database: None,
            schema: None,
            connect_timeout: None,
            extra_params: HashMap::new(),
        }
    }
}

impl TdConnectionConfig {
    /// 从 `conn/test` / `conn/open` params 的 `config` 字段解析。
    pub fn from_config_value(config: &Value) -> anyhow::Result<Self> {
        Ok(serde_json::from_value(config.clone())?)
    }

    /// 连接超时(秒),未配置时用默认值。
    pub fn connect_timeout_secs(&self) -> u64 {
        self.connect_timeout
            .filter(|value| *value > 0)
            .unwrap_or(DEFAULT_CONNECT_TIMEOUT_SECS)
    }
}

/// 组装 taos DSN:`ws://user:pass@host:port[/database]`。
///
/// - scheme 由 `schema` 参数决定,默认 `ws`(经 taosAdapter 的 WebSocket 通道),可选 `wss`;
/// - 用户名/密码/库名按百分号编码,避免特殊字符破坏 DSN 解析;
/// - 用户名或密码为空时省略 userinfo,交由驱动侧默认值(root / taosdata)。
///
/// 与主仓 `build_dsn` 保持一致;区别是这里的 schema 来自配置字段而非 extra_params。
pub fn build_dsn(config: &TdConnectionConfig) -> String {
    // schema 参数支持 ws/wss(以及 http/https 别名),默认 ws。
    let scheme = match config
        .schema
        .as_deref()
        .map(str::trim)
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("http") | Some("ws") => "ws",
        Some("https") | Some("wss") => "wss",
        _ => "ws",
    };

    let mut dsn = format!("{scheme}://");

    let username = config.username.trim();
    if !username.is_empty() {
        dsn.push_str(&percent_encode_dsn_component(username));
        if !config.password.is_empty() {
            dsn.push(':');
            dsn.push_str(&percent_encode_dsn_component(&config.password));
        }
        dsn.push('@');
    }

    dsn.push_str(&config.host);
    dsn.push(':');
    dsn.push_str(&config.port.to_string());

    if let Some(database) = configured_database(config) {
        dsn.push('/');
        dsn.push_str(&percent_encode_dsn_component(&database));
    }

    dsn
}

/// 配置中的默认数据库(去空白,空串视为未指定)。
fn configured_database(config: &TdConnectionConfig) -> Option<String> {
    config
        .database
        .as_ref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

/// 对 DSN 组件做百分号编码(仅保留 URI 非保留字符)。
fn percent_encode_dsn_component(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(*byte as char)
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

#[cfg(test)]
mod tests {
    use super::*;

    // === 以下 DSN 单测移植自主仓 crates/db/src/tdengine/connection.rs ===

    #[test]
    fn dsn_uses_ws_scheme_and_credentials_by_default() {
        let config = TdConnectionConfig {
            username: "root".to_string(),
            password: "taosdata".to_string(),
            ..Default::default()
        };
        assert_eq!(build_dsn(&config), "ws://root:taosdata@127.0.0.1:6041");
    }

    #[test]
    fn dsn_appends_database_when_present() {
        let config = TdConnectionConfig {
            host: "db.internal".to_string(),
            username: "root".to_string(),
            password: "taosdata".to_string(),
            database: Some(" power_db ".to_string()),
            ..Default::default()
        };
        assert_eq!(
            build_dsn(&config),
            "ws://root:taosdata@db.internal:6041/power_db"
        );
    }

    #[test]
    fn dsn_supports_wss_scheme_param() {
        let config = TdConnectionConfig {
            host: "cloud.tdengine.com".to_string(),
            port: 443,
            username: "root".to_string(),
            password: "taosdata".to_string(),
            schema: Some("wss".to_string()),
            ..Default::default()
        };
        assert_eq!(
            build_dsn(&config),
            "wss://root:taosdata@cloud.tdengine.com:443"
        );
    }

    #[test]
    fn dsn_supports_http_https_scheme_aliases() {
        let config = TdConnectionConfig {
            username: "root".to_string(),
            password: "taosdata".to_string(),
            schema: Some("http".to_string()),
            ..Default::default()
        };
        assert_eq!(build_dsn(&config), "ws://root:taosdata@127.0.0.1:6041");

        let config = TdConnectionConfig {
            username: "root".to_string(),
            password: "taosdata".to_string(),
            schema: Some("HTTPS".to_string()),
            ..Default::default()
        };
        assert_eq!(build_dsn(&config), "wss://root:taosdata@127.0.0.1:6041");
    }

    #[test]
    fn dsn_omits_userinfo_when_username_empty() {
        let config = TdConnectionConfig {
            username: String::new(),
            password: "taosdata".to_string(),
            ..Default::default()
        };
        // 用户名省略后由驱动侧使用默认 root/taosdata。
        assert_eq!(build_dsn(&config), "ws://127.0.0.1:6041");
    }

    #[test]
    fn dsn_omits_password_when_empty() {
        let config = TdConnectionConfig {
            username: "root".to_string(),
            password: String::new(),
            ..Default::default()
        };
        assert_eq!(build_dsn(&config), "ws://root@127.0.0.1:6041");
    }

    #[test]
    fn dsn_percent_encodes_special_characters() {
        let config = TdConnectionConfig {
            username: "root".to_string(),
            password: "p@ss/w:rd".to_string(),
            ..Default::default()
        };
        assert_eq!(
            build_dsn(&config),
            "ws://root:p%40ss%2Fw%3Ard@127.0.0.1:6041"
        );
    }

    #[test]
    fn dsn_ignores_blank_database() {
        let config = TdConnectionConfig {
            username: "root".to_string(),
            password: "taosdata".to_string(),
            database: Some("   ".to_string()),
            ..Default::default()
        };
        assert_eq!(build_dsn(&config), "ws://root:taosdata@127.0.0.1:6041");
    }

    #[test]
    fn config_parses_json_form_values() {
        let config: TdConnectionConfig = serde_json::from_value(serde_json::json!({
            "host": "10.0.0.8",
            "port": 6041,
            "username": "root",
            "password": "taosdata",
        }))
        .unwrap();
        assert_eq!(config.host, "10.0.0.8");
        assert_eq!(config.port, 6041);
        assert_eq!(config.connect_timeout_secs(), DEFAULT_CONNECT_TIMEOUT_SECS);
    }

    #[test]
    fn config_applies_defaults_when_fields_missing() {
        let config: TdConnectionConfig = serde_json::from_value(serde_json::json!({})).unwrap();
        assert_eq!(config.host, "127.0.0.1");
        assert_eq!(config.port, TDENGINE_DEFAULT_PORT);
        assert_eq!(config.connect_timeout_secs(), 30);
    }
}
