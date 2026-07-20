use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ImportRecord {
    pub id: String,
    pub importer_id: String,
    pub source_label: String,
    pub source_id: Option<String>,
    pub kind: String,
    pub display_name: String,
    pub database: Option<serde_json::Value>,
    pub ssh: Option<SshImportRecord>,
    pub port_forwarding: Option<serde_json::Value>,
    pub password_status: String,
    pub warnings: Vec<ImportWarning>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct SshImportRecord {
    pub name: String,
    pub host: String,
    pub port: Option<u16>,
    pub username: String,
    pub auth_method: SshImportAuthMethod,
    pub init_script: Option<String>,
    pub jump_server: Option<serde_json::Value>,
    pub proxy: Option<serde_json::Value>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SshImportAuthMethod {
    Password {
        password: Option<String>,
    },
    PrivateKey {
        key_path: String,
        passphrase: Option<String>,
    },
    Agent,
    AutoPublicKey,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ImportWarning {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
struct WindTermSession {
    #[serde(rename = "session.uuid")]
    uuid: Option<String>,
    #[serde(rename = "session.protocol")]
    protocol: Option<String>,
    #[serde(rename = "session.label")]
    label: Option<String>,
    #[serde(rename = "session.group")]
    group: Option<String>,
    #[serde(rename = "session.target")]
    target: Option<String>,
    #[serde(rename = "session.port")]
    port: Option<serde_json::Value>,
    #[serde(rename = "session.user")]
    user: Option<String>,
    #[serde(rename = "session.description")]
    description: Option<String>,
    #[serde(rename = "session.autoLogin")]
    auto_login: Option<serde_json::Value>,
    #[serde(rename = "ssh.autoLogin")]
    ssh_auto_login: Option<serde_json::Value>,
    #[serde(rename = "ssh.identityFilePath")]
    identity_file_path: Option<String>,
    #[serde(rename = "ssh.agent")]
    agent: Option<serde_json::Value>,
    #[serde(rename = "ssh.authAgent")]
    auth_agent: Option<serde_json::Value>,
    #[serde(rename = "ssh.authPassword")]
    auth_password: Option<serde_json::Value>,
    #[serde(rename = "session.autoExecution")]
    auto_execution: Option<String>,
    #[serde(rename = "session.proxy")]
    proxy: Option<serde_json::Value>,
    #[serde(rename = "session.proxyHost")]
    proxy_host: Option<String>,
    #[serde(rename = "session.proxyJumpServer1")]
    jump_server: Option<serde_json::Value>,
    #[serde(rename = "ssh.tunnels")]
    tunnels: Option<serde_json::Value>,
}

#[derive(Debug)]
struct ParsedTarget {
    host: String,
    username: Option<String>,
    port: Option<u16>,
    inline_password_ignored: bool,
}

pub fn preview_records_from_session_files<'a, I>(
    files: I,
    _include_passwords: bool,
) -> Vec<ImportRecord>
where
    I: IntoIterator<Item = (String, &'a [u8])>,
{
    let mut records = Vec::new();
    let mut seen_ids = BTreeSet::new();
    for (path, bytes) in files {
        let Ok(sessions) = serde_json::from_slice::<Vec<WindTermSession>>(bytes) else {
            continue;
        };
        for session in sessions {
            let Some(record) = record_from_session(&path, session) else {
                continue;
            };
            if seen_ids.insert(record.id.clone()) {
                records.push(record);
            }
        }
    }
    records
}

fn record_from_session(path: &str, session: WindTermSession) -> Option<ImportRecord> {
    if !trimmed(session.protocol.as_deref()).eq_ignore_ascii_case("ssh") {
        return None;
    }

    let target = parse_target(trimmed(session.target.as_deref()))?;
    let port = parse_port(session.port.as_ref())
        .or(target.port)
        .or(Some(22));
    let username = non_empty(session.user)
        .or(target.username)
        .unwrap_or_default();
    let label = non_empty(session.label).or_else(|| non_empty(session.description));
    let group = non_empty(session.group);
    let display_name = label.unwrap_or_else(|| target.host.clone());
    let source_id = non_empty(session.uuid).unwrap_or_else(|| {
        format!(
            "{}:{}:{}:{}",
            path,
            group.as_deref().unwrap_or_default(),
            target.host,
            port.unwrap_or(22)
        )
    });
    let id = format!("windterm:{}", slug(&source_id));

    let encrypted_auto_login =
        has_data(session.auto_login.as_ref()) || has_data(session.ssh_auto_login.as_ref());
    let identity_file_path = non_empty(session.identity_file_path);
    let auth_method = if let Some(key_path) = identity_file_path {
        SshImportAuthMethod::PrivateKey {
            key_path,
            passphrase: None,
        }
    } else if truthy(session.agent.as_ref()) || truthy(session.auth_agent.as_ref()) {
        SshImportAuthMethod::Agent
    } else if truthy(session.auth_password.as_ref()) {
        SshImportAuthMethod::Password { password: None }
    } else {
        SshImportAuthMethod::AutoPublicKey
    };

    let mut warnings = Vec::new();
    if encrypted_auto_login {
        warnings.push(warning(
            "windterm_encrypted_auto_login",
            "WindTerm auto-login data is encrypted and was not imported.",
        ));
    }
    if target.inline_password_ignored {
        warnings.push(warning(
            "windterm_inline_password_ignored",
            "A password embedded in the target was intentionally not imported.",
        ));
    }
    if username.is_empty() {
        warnings.push(warning(
            "windterm_missing_username",
            "WindTerm did not expose a plaintext SSH username for this session.",
        ));
    }
    if has_data(session.proxy.as_ref()) || non_empty(session.proxy_host).is_some() {
        warnings.push(warning(
            "windterm_proxy_not_imported",
            "WindTerm proxy settings are not imported yet.",
        ));
    }
    if has_data(session.jump_server.as_ref()) {
        warnings.push(warning(
            "windterm_jump_server_not_imported",
            "WindTerm jump-server settings are not imported yet.",
        ));
    }
    if has_data(session.tunnels.as_ref()) {
        warnings.push(warning(
            "windterm_tunnels_not_imported",
            "WindTerm SSH tunnel settings are not imported yet.",
        ));
    }

    let init_script = non_empty(session.auto_execution);

    Some(ImportRecord {
        id,
        importer_id: "windterm".to_string(),
        source_label: "WindTerm".to_string(),
        source_id: Some(source_id),
        kind: "ssh".to_string(),
        display_name: display_name.clone(),
        database: None,
        ssh: Some(SshImportRecord {
            name: display_name,
            host: target.host,
            port,
            username,
            auth_method,
            init_script,
            jump_server: None,
            proxy: None,
        }),
        port_forwarding: None,
        password_status: if encrypted_auto_login || target.inline_password_ignored {
            "unsupported".to_string()
        } else {
            "missing".to_string()
        },
        warnings,
    })
}

fn parse_target(value: &str) -> Option<ParsedTarget> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    let value = value
        .strip_prefix("ssh://")
        .or_else(|| value.strip_prefix("SSH://"))
        .unwrap_or(value);
    let value = value.split('/').next().unwrap_or(value);
    let (user_info, host_port) = value
        .rsplit_once('@')
        .map_or((None, value), |(user, host)| (Some(user), host));
    let (username, inline_password_ignored) = user_info.map_or((None, false), |user_info| {
        let (username, password) = user_info
            .split_once(':')
            .map_or((user_info, None), |(user, password)| (user, Some(password)));
        (non_empty(Some(username.to_string())), password.is_some())
    });
    let (host, port) = parse_host_port(host_port)?;
    Some(ParsedTarget {
        host,
        username,
        port,
        inline_password_ignored,
    })
}

fn parse_host_port(value: &str) -> Option<(String, Option<u16>)> {
    let value = value.trim();
    if let Some(rest) = value.strip_prefix('[') {
        let (host, suffix) = rest.split_once(']')?;
        if host.is_empty() {
            return None;
        }
        let port = suffix
            .strip_prefix(':')
            .and_then(|value| value.parse().ok());
        return Some((host.to_string(), port));
    }
    if value.matches(':').count() == 1 {
        let (host, port) = value.rsplit_once(':')?;
        if let Ok(port) = port.parse::<u16>() {
            return non_empty(Some(host.to_string())).map(|host| (host, Some(port)));
        }
    }
    non_empty(Some(value.to_string())).map(|host| (host, None))
}

fn parse_port(value: Option<&serde_json::Value>) -> Option<u16> {
    match value? {
        serde_json::Value::Number(number) => {
            number.as_u64().and_then(|port| u16::try_from(port).ok())
        }
        serde_json::Value::String(value) => value.trim().parse().ok(),
        _ => None,
    }
}

fn truthy(value: Option<&serde_json::Value>) -> bool {
    match value {
        Some(serde_json::Value::Bool(value)) => *value,
        Some(serde_json::Value::Number(value)) => value.as_u64().is_some_and(|value| value != 0),
        Some(serde_json::Value::String(value)) => {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes"
            )
        }
        _ => false,
    }
}

fn has_data(value: Option<&serde_json::Value>) -> bool {
    match value {
        None | Some(serde_json::Value::Null) => false,
        Some(serde_json::Value::Bool(value)) => *value,
        Some(serde_json::Value::Number(value)) => value.as_u64().is_some_and(|value| value != 0),
        Some(serde_json::Value::String(value)) => !value.trim().is_empty(),
        Some(serde_json::Value::Array(value)) => !value.is_empty(),
        Some(serde_json::Value::Object(value)) => !value.is_empty(),
    }
}

fn warning(code: &str, message: &str) -> ImportWarning {
    ImportWarning {
        code: code.to_string(),
        message: message.to_string(),
    }
}

fn trimmed(value: Option<&str>) -> &str {
    value.unwrap_or_default().trim()
}

fn non_empty(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn slug(value: &str) -> String {
    let mut out = String::new();
    let mut last_dash = false;
    for ch in value.chars().flat_map(char::to_lowercase) {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            last_dash = false;
        } else if !last_dash && !out.is_empty() {
            out.push('-');
            last_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        "session".to_string()
    } else {
        out
    }
}
