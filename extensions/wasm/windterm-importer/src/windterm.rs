use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const WINDTERM_IMPORTER_ID: &str = "windterm";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TargetPlatform {
    Macos,
    Windows,
    Linux,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct InputFile {
    pub candidate_id: String,
    pub display_path: String,
    pub bytes: Vec<u8>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct DiscoveredFiles {
    pub session_files: Vec<InputFile>,
    pub quickbar_files: Vec<InputFile>,
    pub keymap_files: Vec<InputFile>,
}

impl DiscoveredFiles {
    pub fn is_empty(&self) -> bool {
        self.session_files.is_empty()
            && self.quickbar_files.is_empty()
            && self.keymap_files.is_empty()
    }

    pub fn sort_deterministic(&mut self) {
        self.session_files.sort_by(|a, b| {
            let a_nested = a.display_path.replace('\\', "/").contains(".wind/.wind");
            let b_nested = b.display_path.replace('\\', "/").contains(".wind/.wind");
            (a_nested, &a.display_path).cmp(&(b_nested, &b.display_path))
        });
        self.quickbar_files.sort_by(|a, b| {
            let a_nested = a.display_path.replace('\\', "/").contains(".wind/.wind");
            let b_nested = b.display_path.replace('\\', "/").contains(".wind/.wind");
            (a_nested, &a.display_path).cmp(&(b_nested, &b.display_path))
        });
        self.keymap_files.sort_by(|a, b| {
            let a_profile = !a.display_path.replace('\\', "/").contains("profiles");
            let b_profile = !b.display_path.replace('\\', "/").contains("profiles");
            (a_profile, &a.display_path).cmp(&(b_profile, &b.display_path))
        });
    }

    pub fn all_files(&self) -> impl Iterator<Item = &InputFile> {
        self.session_files
            .iter()
            .chain(self.quickbar_files.iter())
            .chain(self.keymap_files.iter())
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ImportScanReport {
    pub importer_id: String,
    pub availability: Value,
    pub discovered_files: Vec<DiscoveredFile>,
    pub warnings: Vec<ImportWarning>,
    pub discovered_workspace_paths: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct DiscoveredFile {
    pub candidate_id: String,
    pub display_path: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ImportRecord {
    pub id: String,
    pub importer_id: String,
    pub source_label: String,
    pub source_id: Option<String>,
    pub kind: String,
    pub display_name: String,
    pub database: Option<Value>,
    pub ssh: Option<SshImportRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub telnet: Option<TelnetImportRecord>,
    pub port_forwarding: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub quick_command: Option<QuickCommandImportRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub workspace: Option<WorkspaceImportRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keybinding: Option<KeybindingImportRecord>,
    pub password_status: String,
    pub warnings: Vec<ImportWarning>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct SshImportRecord {
    pub name: String,
    pub host: String,
    pub port: Option<u16>,
    pub username: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_path: Option<String>,
    pub auth_method: SshImportAuthMethod,
    pub init_script: Option<String>,
    pub jump_server: Option<SshJumpServerImportRecord>,
    pub proxy: Option<SshProxyImportRecord>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct TelnetImportRecord {
    pub name: String,
    pub host: String,
    pub port: Option<u16>,
    pub username: Option<String>,
    pub password: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_path: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct QuickCommandImportRecord {
    pub name: String,
    pub command: String,
    pub group_name: Option<String>,
    pub shortcut: Option<String>,
    pub description: Option<String>,
    pub sort_order: i32,
    pub connection_source_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct WorkspaceImportRecord {
    pub path: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct KeybindingImportRecord {
    pub action_id: String,
    pub shortcuts: Vec<String>,
    pub source_action: Option<String>,
    pub description: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct SshJumpServerImportRecord {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_method: SshImportAuthMethod,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct SshProxyImportRecord {
    pub kind: SshProxyImportKind,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SshProxyImportKind {
    Socks5,
    Http,
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
    port: Option<Value>,
    #[serde(rename = "session.user")]
    user: Option<String>,
    #[serde(rename = "session.description")]
    description: Option<String>,
    #[serde(rename = "session.autoLogin")]
    auto_login: Option<Value>,
    #[serde(rename = "ssh.autoLogin")]
    ssh_auto_login: Option<Value>,
    #[serde(rename = "ssh.identityFilePath")]
    identity_file_path: Option<String>,
    #[serde(rename = "ssh.identityFilePath.windows")]
    identity_file_path_windows: Option<String>,
    #[serde(rename = "ssh.identityFilePath.macos")]
    identity_file_path_macos: Option<String>,
    #[serde(rename = "ssh.identityFilePath.linux")]
    identity_file_path_linux: Option<String>,
    #[serde(rename = "ssh.agent")]
    agent: Option<Value>,
    #[serde(rename = "ssh.authAgent")]
    auth_agent: Option<Value>,
    #[serde(rename = "ssh.authPassword")]
    auth_password: Option<Value>,
    #[serde(rename = "session.autoExecution")]
    auto_execution: Option<String>,
    #[serde(rename = "ssh.autoExecution")]
    ssh_auto_execution: Option<String>,
    #[serde(rename = "session.proxy")]
    proxy: Option<Value>,
    #[serde(rename = "session.proxyHost")]
    proxy_host: Option<String>,
    #[serde(rename = "session.proxyJumpServer1")]
    jump_server: Option<Value>,
    #[serde(rename = "ssh.tunnels")]
    tunnels: Option<Value>,
}

#[derive(Debug)]
struct ParsedTarget {
    host: String,
    username: Option<String>,
    port: Option<u16>,
    inline_password_ignored: bool,
}

#[derive(Clone, Debug)]
struct NormalizedSession {
    uuid: String,
    protocol: String,
    label: Option<String>,
    group: Option<String>,
    target: String,
    port: Option<u16>,
    user: Option<String>,
    encrypted_auto_login: bool,
    identity_file: Option<String>,
    use_agent: bool,
    auth_password: bool,
    init_script: Option<String>,
    proxy_value: Option<Value>,
    proxy_host: Option<String>,
    jump_server_ref: Option<String>,
    has_tunnels: bool,
}

pub fn scan_report_from_files(
    files: &DiscoveredFiles,
    platform: TargetPlatform,
    include_keybindings: bool,
) -> ImportScanReport {
    if files.is_empty() {
        return ImportScanReport {
            importer_id: WINDTERM_IMPORTER_ID.to_string(),
            availability: serde_json::json!("no_data"),
            discovered_files: Vec::new(),
            warnings: Vec::new(),
            discovered_workspace_paths: Vec::new(),
        };
    }

    let mut warnings = Vec::new();
    let mut workspace_paths = BTreeSet::new();
    let mut seen_ids = BTreeSet::new();

    for file in &files.session_files {
        let (records, file_warnings) =
            parse_sessions_bytes(&file.display_path, &file.bytes, platform);
        for record in records {
            if let Some(group) = record
                .ssh
                .as_ref()
                .and_then(|ssh| ssh.group_path.as_deref())
                .or_else(|| {
                    record
                        .telnet
                        .as_ref()
                        .and_then(|telnet| telnet.group_path.as_deref())
                })
            {
                workspace_paths.insert(group.to_string());
            }
            seen_ids.insert(record.id);
        }
        warnings.extend(file_warnings);
    }

    for file in &files.quickbar_files {
        for record in parse_quickbar_bytes(&file.bytes) {
            seen_ids.insert(record.id);
        }
    }

    if include_keybindings {
        if let Some(keymap_file) = files.keymap_files.first() {
            if let Ok(text) = std::str::from_utf8(&keymap_file.bytes) {
                for record in parse_keymaps_text(text, platform == TargetPlatform::Macos) {
                    seen_ids.insert(record.id);
                }
            }
        }
    }

    let estimated_count = seen_ids.len() as u32;
    let availability = if estimated_count > 0 {
        serde_json::json!({ "available": { "estimated_count": estimated_count } })
    } else {
        serde_json::json!("no_data")
    };

    ImportScanReport {
        importer_id: WINDTERM_IMPORTER_ID.to_string(),
        availability,
        discovered_files: files
            .all_files()
            .map(|file| DiscoveredFile {
                candidate_id: file.candidate_id.clone(),
                display_path: file.display_path.clone(),
            })
            .collect(),
        warnings,
        discovered_workspace_paths: workspace_paths.into_iter().collect(),
    }
}

pub fn preview_records_from_files(
    files: &DiscoveredFiles,
    platform: TargetPlatform,
    _include_passwords: bool,
    include_keybindings: bool,
) -> Vec<ImportRecord> {
    let mut records = Vec::new();
    let mut seen_ids = BTreeSet::new();

    for file in &files.session_files {
        let (parsed, _warnings) = parse_sessions_bytes(&file.display_path, &file.bytes, platform);
        for record in parsed {
            if seen_ids.insert(record.id.clone()) {
                records.push(record);
            }
        }
    }

    for file in &files.quickbar_files {
        for record in parse_quickbar_bytes(&file.bytes) {
            if seen_ids.insert(record.id.clone()) {
                records.push(record);
            }
        }
    }

    if include_keybindings {
        if let Some(keymap_file) = files.keymap_files.first() {
            if let Ok(text) = std::str::from_utf8(&keymap_file.bytes) {
                for record in parse_keymaps_text(text, platform == TargetPlatform::Macos) {
                    if seen_ids.insert(record.id.clone()) {
                        records.push(record);
                    }
                }
            }
        }
    }

    records
}

pub fn preview_records_from_session_files<'a, I>(
    files: I,
    include_passwords: bool,
) -> Vec<ImportRecord>
where
    I: IntoIterator<Item = (String, &'a [u8])>,
{
    let discovered = DiscoveredFiles {
        session_files: files
            .into_iter()
            .map(|(display_path, bytes)| InputFile {
                candidate_id: String::new(),
                display_path,
                bytes: bytes.to_vec(),
            })
            .collect(),
        quickbar_files: Vec::new(),
        keymap_files: Vec::new(),
    };
    preview_records_from_files(&discovered, TargetPlatform::Linux, include_passwords, false)
}

pub fn parse_sessions_bytes(
    path: &str,
    bytes: &[u8],
    platform: TargetPlatform,
) -> (Vec<ImportRecord>, Vec<ImportWarning>) {
    let Ok(sessions) = serde_json::from_slice::<Vec<WindTermSession>>(bytes) else {
        return (Vec::new(), Vec::new());
    };

    let mut normalized = Vec::with_capacity(sessions.len());
    for (index, session) in sessions.into_iter().enumerate() {
        let identity_file = extract_identity_file(&session, platform);
        let protocol = trimmed(session.protocol.as_deref()).to_string();
        let target = trimmed(session.target.as_deref()).to_string();
        let group = session.group.as_deref().and_then(normalize_group_path);
        let port = parse_port(session.port.as_ref());
        let label = non_empty(session.label).or_else(|| non_empty(session.description));
        let uuid = non_empty(session.uuid).unwrap_or_else(|| {
            format!(
                "{}:{}:{}:{}:{}",
                path,
                group.as_deref().unwrap_or_default(),
                target,
                port.unwrap_or(0),
                index
            )
        });
        let encrypted_auto_login =
            has_data(session.auto_login.as_ref()) || has_data(session.ssh_auto_login.as_ref());
        let use_agent = truthy(session.agent.as_ref()) || truthy(session.auth_agent.as_ref());
        let auth_password = truthy(session.auth_password.as_ref());
        let init_script =
            non_empty(session.auto_execution).or_else(|| non_empty(session.ssh_auto_execution));
        let jump_server_ref = session
            .jump_server
            .as_ref()
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty() && !s.eq_ignore_ascii_case("none"))
            .map(str::to_string);
        let has_tunnels = has_data(session.tunnels.as_ref());

        normalized.push(NormalizedSession {
            uuid,
            protocol,
            label,
            group,
            target,
            port,
            user: non_empty(session.user),
            encrypted_auto_login,
            identity_file,
            use_agent,
            auth_password,
            init_script,
            proxy_value: session.proxy,
            proxy_host: non_empty(session.proxy_host),
            jump_server_ref,
            has_tunnels,
        });
    }

    let ssh_index: HashMap<String, &NormalizedSession> = normalized
        .iter()
        .filter(|s| s.protocol.eq_ignore_ascii_case("ssh"))
        .map(|s| (s.uuid.clone(), s))
        .collect();

    let mut records = Vec::new();
    let mut skipped_by_protocol: BTreeMap<String, usize> = BTreeMap::new();

    for raw in &normalized {
        if raw.protocol.eq_ignore_ascii_case("ssh") {
            if let Some(record) = build_ssh_record(raw, &ssh_index) {
                records.push(record);
            }
        } else if raw.protocol.eq_ignore_ascii_case("telnet") {
            if let Some(record) = build_telnet_record(raw) {
                records.push(record);
            }
        } else {
            let key = if raw.protocol.is_empty() {
                "Unknown".to_string()
            } else {
                raw.protocol.clone()
            };
            *skipped_by_protocol.entry(key).or_insert(0) += 1;
        }
    }

    let mut warnings = Vec::new();
    if !skipped_by_protocol.is_empty() {
        let detail = skipped_by_protocol
            .into_iter()
            .map(|(proto, count)| format!("{proto}: {count}"))
            .collect::<Vec<_>>()
            .join(", ");
        warnings.push(warning(
            "windterm_skipped_protocols",
            &format!("Skipped non-SSH/Telnet WindTerm sessions ({detail})"),
        ));
    }

    (records, warnings)
}

fn build_ssh_record(
    raw: &NormalizedSession,
    ssh_index: &HashMap<String, &NormalizedSession>,
) -> Option<ImportRecord> {
    let target = parse_target(&raw.target)?;
    let port = raw.port.or(target.port).or(Some(22));
    let username = raw.user.clone().or(target.username).unwrap_or_default();
    let display_name = raw.label.clone().unwrap_or_else(|| target.host.clone());
    let id = format!("windterm:{}", slug(&raw.uuid));

    let (auth_method, password_status, mut warnings) = resolve_ssh_auth(raw);

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

    let jump_server = raw
        .jump_server_ref
        .as_deref()
        .and_then(|jump_ref| resolve_jump_server(jump_ref, ssh_index, &mut warnings));

    let proxy = resolve_proxy(raw.proxy_value.as_ref(), raw.proxy_host.as_deref(), &mut warnings);

    if raw.has_tunnels {
        warnings.push(warning(
            "windterm_tunnels_not_imported",
            "WindTerm SSH tunnel settings are not imported yet.",
        ));
    }

    Some(ImportRecord {
        id,
        importer_id: WINDTERM_IMPORTER_ID.to_string(),
        source_label: "WindTerm".to_string(),
        source_id: Some(raw.uuid.clone()),
        kind: "ssh".to_string(),
        display_name: display_name.clone(),
        database: None,
        ssh: Some(SshImportRecord {
            name: display_name,
            host: target.host,
            port,
            username,
            group_path: raw.group.clone(),
            auth_method,
            init_script: raw.init_script.clone(),
            jump_server,
            proxy,
        }),
        telnet: None,
        port_forwarding: None,
        quick_command: None,
        workspace: None,
        keybinding: None,
        password_status: password_status.to_string(),
        warnings,
    })
}

fn build_telnet_record(raw: &NormalizedSession) -> Option<ImportRecord> {
    let target = parse_target(&raw.target)?;
    let port = raw.port.or(target.port).or(Some(23));
    let username = raw.user.clone().or(target.username);
    let display_name = raw.label.clone().unwrap_or_else(|| target.host.clone());
    let id = format!("windterm:telnet:{}", slug(&raw.uuid));

    let (password_status, warnings) = if raw.encrypted_auto_login {
        (
            "unsupported",
            vec![warning(
                "windterm_encrypted_auto_login",
                "WindTerm auto-login data is encrypted and was not imported.",
            )],
        )
    } else {
        ("missing", Vec::new())
    };

    Some(ImportRecord {
        id,
        importer_id: WINDTERM_IMPORTER_ID.to_string(),
        source_label: "WindTerm".to_string(),
        source_id: Some(raw.uuid.clone()),
        kind: "telnet".to_string(),
        display_name: display_name.clone(),
        database: None,
        ssh: None,
        telnet: Some(TelnetImportRecord {
            name: display_name,
            host: target.host,
            port,
            username,
            password: None,
            group_path: raw.group.clone(),
        }),
        port_forwarding: None,
        quick_command: None,
        workspace: None,
        keybinding: None,
        password_status: password_status.to_string(),
        warnings,
    })
}

fn resolve_ssh_auth(raw: &NormalizedSession) -> (SshImportAuthMethod, &'static str, Vec<ImportWarning>) {
    let mut warnings = Vec::new();
    if raw.encrypted_auto_login {
        warnings.push(warning(
            "windterm_encrypted_auto_login",
            "WindTerm auto-login data is encrypted and was not imported.",
        ));
    }

    if let Some(key_path) = &raw.identity_file {
        return (
            SshImportAuthMethod::PrivateKey {
                key_path: key_path.clone(),
                passphrase: None,
            },
            "unsupported",
            warnings,
        );
    }
    if raw.use_agent {
        return (SshImportAuthMethod::Agent, "unsupported", warnings);
    }
    if raw.auth_password || raw.encrypted_auto_login {
        return (
            SshImportAuthMethod::Password { password: None },
            if raw.encrypted_auto_login {
                "unsupported"
            } else {
                "missing"
            },
            warnings,
        );
    }

    (SshImportAuthMethod::AutoPublicKey, "missing", warnings)
}

fn resolve_jump_server(
    jump_ref: &str,
    ssh_index: &HashMap<String, &NormalizedSession>,
    warnings: &mut Vec<ImportWarning>,
) -> Option<SshJumpServerImportRecord> {
    let jump_uuid = jump_ref.split(',').next().map(str::trim).unwrap_or_default();
    let Some(jump_raw) = ssh_index.get(jump_uuid) else {
        warnings.push(warning(
            "windterm_jump_server_not_found",
            &format!("Jump server reference not found: {jump_ref}"),
        ));
        return None;
    };
    let target = parse_target(&jump_raw.target)?;
    let (auth_method, _, _) = resolve_ssh_auth(jump_raw);
    Some(SshJumpServerImportRecord {
        host: target.host,
        port: jump_raw.port.or(target.port).unwrap_or(22),
        username: jump_raw
            .user
            .clone()
            .or(target.username)
            .unwrap_or_else(|| "root".to_string()),
        auth_method,
    })
}

fn resolve_proxy(
    proxy_value: Option<&Value>,
    proxy_host: Option<&str>,
    warnings: &mut Vec<ImportWarning>,
) -> Option<SshProxyImportRecord> {
    if let Some(raw_str) = proxy_value.and_then(Value::as_str) {
        let trimmed = raw_str.trim();
        if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("none") {
            return None;
        }
        if let Some(parsed) = parse_proxy_url(trimmed, warnings) {
            return Some(parsed);
        }
    }
    if has_data(proxy_value) || proxy_host.is_some() {
        warnings.push(warning(
            "windterm_proxy_not_imported",
            "WindTerm proxy settings are not imported yet.",
        ));
    }
    None
}

fn parse_proxy_url(
    proxy_str: &str,
    warnings: &mut Vec<ImportWarning>,
) -> Option<SshProxyImportRecord> {
    let (scheme, rest) = proxy_str.split_once("://")?;
    let kind = match scheme.to_ascii_lowercase().as_str() {
        "socks5" | "socks5h" => SshProxyImportKind::Socks5,
        "http" | "https" => SshProxyImportKind::Http,
        other => {
            warnings.push(warning(
                "windterm_unsupported_proxy",
                &format!("Unsupported proxy scheme: {other}"),
            ));
            return None;
        }
    };
    let authority = rest.split('/').next().unwrap_or(rest);
    let (userinfo, host_port) = match authority.rsplit_once('@') {
        Some((u, hp)) => (Some(u), hp),
        None => (None, authority),
    };
    let (username, password) = match userinfo {
        Some(u) => match u.split_once(':') {
            Some((user, pass)) => (
                (!user.is_empty()).then(|| user.to_string()),
                Some(pass.to_string()),
            ),
            None => ((!u.is_empty()).then(|| u.to_string()), None),
        },
        None => (None, None),
    };
    let (host, port) = split_host_port(host_port)?;
    let default_port = match scheme.to_ascii_lowercase().as_str() {
        "https" => 443,
        "http" => 80,
        _ => 1080,
    };
    Some(SshProxyImportRecord {
        kind,
        host,
        port: port.unwrap_or(default_port),
        username,
        password,
    })
}

fn extract_identity_file(session: &WindTermSession, platform: TargetPlatform) -> Option<String> {
    let candidates = match platform {
        TargetPlatform::Windows => [
            session.identity_file_path_windows.as_deref(),
            session.identity_file_path.as_deref(),
            session.identity_file_path_linux.as_deref(),
            session.identity_file_path_macos.as_deref(),
        ],
        TargetPlatform::Macos => [
            session.identity_file_path_macos.as_deref(),
            session.identity_file_path.as_deref(),
            session.identity_file_path_linux.as_deref(),
            session.identity_file_path_windows.as_deref(),
        ],
        TargetPlatform::Linux => [
            session.identity_file_path_linux.as_deref(),
            session.identity_file_path.as_deref(),
            session.identity_file_path_macos.as_deref(),
            session.identity_file_path_windows.as_deref(),
        ],
    };

    for candidate in candidates.into_iter().flatten() {
        let trimmed = candidate.trim();
        if !trimmed.is_empty() {
            let normalized = trimmed.replace('\\', "/");
            let cleaned = normalized
                .strip_suffix(".pub")
                .unwrap_or(&normalized)
                .to_string();
            return Some(cleaned);
        }
    }
    None
}

fn normalize_group_path(raw: &str) -> Option<String> {
    let normalized = raw.replace('\\', "/");
    let parts = normalized
        .split('/')
        .map(str::trim)
        .filter(|part| !part.is_empty() && !matches!(*part, "." | ".."))
        .collect::<Vec<_>>();
    (!parts.is_empty()).then(|| parts.join("/"))
}

pub fn parse_quickbar_bytes(bytes: &[u8]) -> Vec<ImportRecord> {
    let Ok(value) = serde_json::from_slice::<Value>(bytes) else {
        return Vec::new();
    };
    let Some(items) = value.as_array() else {
        return Vec::new();
    };

    let mut records = Vec::new();
    for (index, item) in items.iter().enumerate() {
        let Some(map) = item.as_object() else {
            continue;
        };
        let raw_text = map
            .get("quick.text")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let command = normalize_quickbar_command(raw_text);
        if command.is_empty() {
            continue;
        }
        let label = map
            .get("quick.label")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| command.clone());
        let group_name = map
            .get("quick.group")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);
        let uuid = map
            .get("quick.uuid")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .unwrap_or_else(|| format!("quickbar-{index}"));
        let shortcut = map
            .get("quick.shortcut")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string);

        records.push(ImportRecord {
            id: format!("windterm:quick:{uuid}"),
            importer_id: WINDTERM_IMPORTER_ID.to_string(),
            source_label: "WindTerm".to_string(),
            source_id: Some(uuid),
            kind: "quick_command".to_string(),
            display_name: label.clone(),
            database: None,
            ssh: None,
            telnet: None,
            port_forwarding: None,
            quick_command: Some(QuickCommandImportRecord {
                name: label,
                command,
                group_name,
                shortcut,
                description: None,
                sort_order: index as i32,
                connection_source_id: None,
            }),
            workspace: None,
            keybinding: None,
            password_status: "unsupported".to_string(),
            warnings: Vec::new(),
        });
    }
    records
}

fn normalize_quickbar_command(raw: &str) -> String {
    let mut text = raw
        .replace("\\r\\n", "\n")
        .replace("\\n", "\n")
        .replace("\\r", "\n");
    text = text.replace("\r\n", "\n").replace('\r', "\n");
    text.trim_end_matches('\n').trim().to_string()
}

pub fn parse_keymaps_text(text: &str, prefer_macos: bool) -> Vec<ImportRecord> {
    let mut bindings: BTreeMap<&'static str, (String, Vec<String>, Vec<String>)> = BTreeMap::new();

    for block in extract_keymap_blocks(text) {
        let Some(keys) = extract_json_string_field(&block, "keys") else {
            continue;
        };
        let Some(action) = extract_json_string_field(&block, "action") else {
            continue;
        };
        if let Some(modes) = extract_json_string_field(&block, "modes") {
            if (modes.contains("command") || modes.contains("local"))
                && !modes.contains("normal")
                && !modes.contains("remote")
            {
                continue;
            }
        }
        let Some((navop_action_id, label)) = map_windterm_action(&action) else {
            continue;
        };
        let Some(shortcut) = convert_windterm_keys(&keys, prefer_macos) else {
            continue;
        };
        let entry = bindings
            .entry(navop_action_id)
            .or_insert_with(|| (label.to_string(), Vec::new(), Vec::new()));
        if !entry.1.contains(&shortcut) {
            entry.1.push(shortcut);
        }
        if !entry.2.contains(&action) {
            entry.2.push(action);
        }
    }

    bindings
        .into_iter()
        .map(|(navop_action_id, (label, shortcuts, source_actions))| ImportRecord {
            id: format!("windterm:keybinding:{navop_action_id}"),
            importer_id: WINDTERM_IMPORTER_ID.to_string(),
            source_label: "WindTerm".to_string(),
            source_id: Some(navop_action_id.to_string()),
            kind: "keybinding".to_string(),
            display_name: label,
            database: None,
            ssh: None,
            telnet: None,
            port_forwarding: None,
            quick_command: None,
            workspace: None,
            keybinding: Some(KeybindingImportRecord {
                action_id: navop_action_id.to_string(),
                shortcuts,
                source_action: Some(source_actions.join(", ")),
                description: None,
            }),
            password_status: "unsupported".to_string(),
            warnings: Vec::new(),
        })
        .collect()
}

fn extract_keymap_blocks(text: &str) -> Vec<String> {
    let mut blocks = Vec::new();
    let mut in_string = false;
    let mut escaped = false;
    let mut depth: usize = 0;
    let mut start: Option<usize> = None;

    for (idx, ch) in text.char_indices() {
        if in_string {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }
        match ch {
            '"' => in_string = true,
            '{' => {
                if depth == 0 {
                    start = Some(idx);
                }
                depth += 1;
            }
            '}' => {
                if depth > 0 {
                    depth -= 1;
                    if depth == 0 {
                        if let Some(begin) = start.take() {
                            blocks.push(text[begin..=idx].to_string());
                        }
                    }
                }
            }
            _ => {}
        }
    }
    blocks
}

fn extract_json_string_field(block: &str, field: &str) -> Option<String> {
    let needle = format!("\"{field}\"");
    let pos = block.find(&needle)?;
    let rest = &block[pos + needle.len()..];
    let colon = rest.find(':')?;
    let after_colon = rest[colon + 1..].trim_start();
    let after_quote = after_colon.strip_prefix('"')?;
    let mut out = String::new();
    let mut escaped = false;
    for ch in after_quote.chars() {
        if escaped {
            match ch {
                'n' => out.push('\n'),
                'r' => out.push('\r'),
                't' => out.push('\t'),
                '\\' => out.push('\\'),
                '"' => out.push('"'),
                other => out.push(other),
            }
            escaped = false;
        } else if ch == '\\' {
            escaped = true;
        } else if ch == '"' {
            return Some(out);
        } else {
            out.push(ch);
        }
    }
    None
}

fn map_windterm_action(action: &str) -> Option<(&'static str, &'static str)> {
    match action {
        "Window.ToggleFullScreen" => Some(("window.toggle_fullscreen", "Toggle Fullscreen")),
        "Window.ActivateNextView" => Some(("app.switch_next_tab", "Switch to Next Tab")),
        "Window.ActivatePreviousView" => {
            Some(("app.switch_previous_tab", "Switch to Previous Tab"))
        }
        "Window.CloseActiveView" => Some(("app.close_active_tab", "Close Active Tab")),
        "Terminal.DuplicateSession" | "Window.DuplicateView" => {
            Some(("app.duplicate_tab", "Duplicate Tab"))
        }
        "Application.Exit" | "Window.Close" => Some(("app.quit", "Quit Application")),
        "Terminal.NewSession" => Some(("home.new_connection", "New Connection")),
        "Terminal.OpenSession" | "Window.GotoSession" => {
            Some(("home.quick_open", "Quick Open Connection"))
        }
        "Text.Copy" => Some(("terminal.copy", "Terminal Copy")),
        "Text.Paste" => Some(("terminal.paste", "Terminal Paste")),
        "Text.SelectAll" | "Terminal.SelectAll" => {
            Some(("terminal.select_all", "Terminal Select All"))
        }
        "Terminal.ClearScreen" => Some(("terminal.clear_screen", "Terminal Clear Screen")),
        "Text.Find" => Some(("terminal.search_forward", "Terminal Search Forward")),
        "Text.FindPrevious" => Some(("terminal.search_backward", "Terminal Search Backward")),
        "Text.ZoomIn" => Some(("terminal.increase_font", "Terminal Increase Font")),
        "Text.ZoomOut" => Some(("terminal.decrease_font", "Terminal Decrease Font")),
        _ => None,
    }
}

fn convert_windterm_keys(keys: &str, prefer_macos: bool) -> Option<String> {
    let trimmed = keys.trim();
    if !trimmed.starts_with('<') || !trimmed.ends_with('>') {
        return None;
    }
    let inner = &trimmed[1..trimmed.len() - 1];
    if inner.contains('<') || inner.contains('>') {
        return None;
    }

    let mut ctrl = false;
    let mut alt = false;
    let mut shift = false;
    let mut meta = false;
    let mut key: Option<String> = None;

    for raw_token in inner.split('+') {
        let token = raw_token.trim();
        if token.is_empty() {
            continue;
        }
        match token.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => ctrl = true,
            "alt" | "option" => alt = true,
            "shift" => shift = true,
            "meta" | "cmd" | "command" | "super" => meta = true,
            other => {
                if key.is_some() {
                    return None;
                }
                let normalized = match other {
                    "pgup" | "pageup" => "pageup".to_string(),
                    "pgdown" | "pagedown" => "pagedown".to_string(),
                    "esc" => "escape".to_string(),
                    "ins" => "insert".to_string(),
                    "del" => "delete".to_string(),
                    "bs" => "backspace".to_string(),
                    "return" => "enter".to_string(),
                    _ => other.to_string(),
                };
                if !is_supported_key_name(&normalized) {
                    return None;
                }
                key = Some(normalized);
            }
        }
    }

    let key = key?;
    if prefer_macos && ctrl && !meta && !shift && !alt {
        return None;
    }
    if !prefer_macos && meta {
        return None;
    }

    let mut parts = Vec::new();
    if ctrl {
        parts.push("ctrl".to_string());
    }
    if alt {
        parts.push("alt".to_string());
    }
    if shift {
        parts.push("shift".to_string());
    }
    if meta {
        parts.push("cmd".to_string());
    }
    parts.push(key);
    Some(parts.join("-"))
}

fn is_supported_key_name(key: &str) -> bool {
    if key.len() == 1 {
        let ch = key.chars().next().unwrap_or_default();
        return ch.is_ascii_alphanumeric()
            || matches!(
                ch,
                '-' | '=' | '[' | ']' | '\\' | ';' | '\'' | ',' | '.' | '/' | '`'
            );
    }
    matches!(
        key,
        "enter"
            | "escape"
            | "backspace"
            | "tab"
            | "space"
            | "insert"
            | "delete"
            | "home"
            | "end"
            | "pageup"
            | "pagedown"
            | "up"
            | "down"
            | "left"
            | "right"
            | "f1"
            | "f2"
            | "f3"
            | "f4"
            | "f5"
            | "f6"
            | "f7"
            | "f8"
            | "f9"
            | "f10"
            | "f11"
            | "f12"
    )
}

fn parse_target(target: &str) -> Option<ParsedTarget> {
    if target.is_empty() {
        return None;
    }
    let without_scheme = target
        .strip_prefix("ssh://")
        .or_else(|| target.strip_prefix("SSH://"))
        .or_else(|| target.strip_prefix("telnet://"))
        .or_else(|| target.strip_prefix("TELNET://"))
        .unwrap_or(target);
    let authority = without_scheme.split('/').next().unwrap_or(without_scheme);
    let (user_part, host_port) = match authority.rsplit_once('@') {
        Some((user, host)) => (Some(user), host),
        None => (None, authority),
    };
    let (username, inline_password_ignored) = match user_part {
        Some(user) => match user.split_once(':') {
            Some((name, _password)) => (non_empty(Some(name.to_string())), true),
            None => (non_empty(Some(user.to_string())), false),
        },
        None => (None, false),
    };
    let (host, port) = split_host_port(host_port)?;
    Some(ParsedTarget {
        host,
        username,
        port,
        inline_password_ignored,
    })
}

fn split_host_port(host_port: &str) -> Option<(String, Option<u16>)> {
    let trimmed = host_port.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(rest) = trimmed.strip_prefix('[') {
        let (host, after) = rest.split_once(']')?;
        let host = host.trim();
        if host.is_empty() {
            return None;
        }
        let port = after
            .strip_prefix(':')
            .and_then(|value| value.parse::<u16>().ok())
            .filter(|port| *port > 0);
        return Some((host.to_string(), port));
    }
    if let Some((host, port)) = trimmed.rsplit_once(':') {
        if !host.contains(':') {
            if let Ok(port) = port.parse::<u16>() {
                if port > 0 && !host.trim().is_empty() {
                    return Some((host.trim().to_string(), Some(port)));
                }
            }
        }
    }
    Some((trimmed.to_string(), None))
}

fn parse_port(value: Option<&Value>) -> Option<u16> {
    match value? {
        Value::Number(number) => number
            .as_u64()
            .and_then(|port| u16::try_from(port).ok())
            .filter(|port| *port > 0),
        Value::String(text) => text.trim().parse::<u16>().ok().filter(|port| *port > 0),
        _ => None,
    }
}

fn truthy(value: Option<&Value>) -> bool {
    match value {
        Some(Value::Bool(flag)) => *flag,
        Some(Value::Number(number)) => number.as_i64().unwrap_or(0) != 0,
        Some(Value::String(text)) => matches!(
            text.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes" | "on"
        ),
        _ => false,
    }
}

fn has_data(value: Option<&Value>) -> bool {
    match value {
        None | Some(Value::Null) => false,
        Some(Value::Bool(flag)) => *flag,
        Some(Value::Number(number)) => number.as_i64().unwrap_or(0) != 0,
        Some(Value::String(text)) => {
            let trimmed = text.trim();
            !trimmed.is_empty() && !trimmed.eq_ignore_ascii_case("none")
        }
        Some(Value::Array(items)) => !items.is_empty(),
        Some(Value::Object(entries)) => !entries.is_empty(),
    }
}

fn non_empty(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn trimmed(value: Option<&str>) -> &str {
    value.map(str::trim).unwrap_or("")
}

fn warning(code: &str, message: &str) -> ImportWarning {
    ImportWarning {
        code: code.to_string(),
        message: message.to_string(),
    }
}

fn slug(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
        } else if !out.ends_with('-') {
            out.push('-');
        }
    }
    out.trim_matches('-').to_string()
}
