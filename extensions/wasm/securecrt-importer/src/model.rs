use serde::Serialize;
use std::collections::BTreeMap;

use super::decrypt::{self, DecryptError};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
pub struct PreviewResult {
    pub records: Vec<ImportRecord>,
    pub warnings: Vec<ImportWarning>,
}

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
    pub telnet: Option<TelnetImportRecord>,
    pub port_forwarding: Option<serde_json::Value>,
    pub quick_command: Option<QuickCommandImportRecord>,
    pub workspace: Option<WorkspaceImportRecord>,
    pub password_status: String,
    pub warnings: Vec<ImportWarning>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct SshImportRecord {
    pub name: String,
    pub host: String,
    pub port: Option<u16>,
    pub username: String,
    pub group_path: Option<String>,
    pub auth_method: SshImportAuthMethod,
    pub init_script: Option<String>,
    pub jump_server: Option<serde_json::Value>,
    pub proxy: Option<serde_json::Value>,
}

/// Telnet 连接载荷：宿主侧 `TelnetImportRecord`，没有私钥/跳板机等认证方式。
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct TelnetImportRecord {
    pub name: String,
    pub host: String,
    /// 缺省为 `None`，由宿主回退到 23 端口。
    pub port: Option<u16>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub group_path: Option<String>,
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
pub struct ImportWarning {
    pub code: String,
    pub message: String,
}

/// 密码导入策略：是否导入密码，以及 SecureCRT 配置口令。
#[derive(Clone, Copy, Debug)]
pub(crate) struct PasswordPolicy<'a> {
    pub include_passwords: bool,
    pub passphrase: &'a str,
}

/// 会话协议。只有 SSH 与 Telnet 在宿主侧有对应的记录类型。
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SessionProtocol {
    Ssh,
    Telnet,
    Unsupported,
}

pub(crate) fn classify_protocol(protocol: &str) -> SessionProtocol {
    match protocol.trim().to_ascii_lowercase().as_str() {
        "ssh1" | "ssh2" | "ssh" => SessionProtocol::Ssh,
        "telnet" => SessionProtocol::Telnet,
        _ => SessionProtocol::Unsupported,
    }
}

/// 协议缺省端口：Telnet 23，其余（SSH 系列）22。
pub(crate) fn default_port(protocol: &str) -> u16 {
    match classify_protocol(protocol) {
        SessionProtocol::Telnet => 23,
        _ => 22,
    }
}

/// 端口非法时按协议给出告警（文案与 code 都区分 SSH / Telnet）。
pub(crate) fn invalid_port_warning(protocol: &str, source_id: &str) -> ImportWarning {
    let (code, name, port) = match classify_protocol(protocol) {
        SessionProtocol::Telnet => ("securecrt_telnet_port_invalid", "Telnet", 23),
        _ => ("securecrt_ssh_port_invalid", "SSH", 22),
    };
    warning(
        code,
        format!(
            "A SecureCRT {name} session had an invalid port and defaulted to {port}: {source_id}"
        ),
    )
}

/// 按协议名累计被跳过的会话，解析结束时汇总成一条 warning。
#[derive(Clone, Debug, Default)]
pub(crate) struct SkippedProtocols {
    counts: BTreeMap<String, usize>,
}

impl SkippedProtocols {
    fn record(&mut self, protocol: &str) {
        *self.counts.entry(protocol_label(protocol)).or_default() += 1;
    }

    /// 合并另一批统计（XML 解析状态自带计数器，结束时并入总账）。
    pub(crate) fn merge(&mut self, other: Self) {
        for (label, count) in other.counts {
            *self.counts.entry(label).or_default() += count;
        }
    }

    /// 数量降序（同数量按协议名升序）汇总；没有被跳过的会话时返回 `None`。
    pub(crate) fn summary_warning(&self) -> Option<ImportWarning> {
        if self.counts.is_empty() {
            return None;
        }
        let total: usize = self.counts.values().sum();
        let mut entries = self.counts.iter().collect::<Vec<_>>();
        entries.sort_by(|left, right| right.1.cmp(left.1).then_with(|| left.0.cmp(right.0)));
        let detail = entries
            .iter()
            .map(|(label, count)| format!("{label} {count}"))
            .collect::<Vec<_>>()
            .join(", ");
        Some(warning(
            "securecrt_unsupported_protocols",
            format!("Skipped {total} session(s) with unsupported protocols ({detail})."),
        ))
    }
}

/// 协议名归一化后的展示写法：已知协议用 SecureCRT 的官方拼写，未知协议保留原文。
fn protocol_label(protocol: &str) -> String {
    let trimmed = protocol.trim();
    if trimmed.is_empty() {
        return "Unknown".to_string();
    }
    match trimmed.to_ascii_lowercase().as_str() {
        "rdp" => "RDP".to_string(),
        "vnc" => "VNC".to_string(),
        "ftp" => "FTP".to_string(),
        "sftp" => "SFTP".to_string(),
        "serial" => "Serial".to_string(),
        "local shell" | "local_shell" | "localshell" => "Local Shell".to_string(),
        "raw" => "Raw".to_string(),
        _ => trimmed.to_string(),
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct CredentialMetadata {
    pub username: Option<String>,
    /// Credentials 目录里这条凭据是否带了密文（不论是否允许解密）。
    pub has_ciphertext: bool,
    /// 已解密的明文；仅在 `include_passwords` 且解密成功时才有值。
    pub password: Option<String>,
    /// 带密文但解密失败的原因（通常是用户设了 SecureCRT 配置口令）。
    pub password_error: Option<DecryptError>,
}

/// 一个会话最终能拿到什么密码。
pub(crate) enum ResolvedPassword {
    /// 调用方没要求导入密码。
    NotRequested,
    /// 会话和凭据里都没有密码字段。
    Missing,
    /// 解密出的明文。
    Included(String),
    /// 有密文但解不开。
    Failed(DecryptError),
}

impl ResolvedPassword {
    /// 该记录是否「看起来应该有密码」——决定 SSH 认证方式是否算密码认证。
    fn has_ciphertext(&self) -> bool {
        matches!(
            self,
            Self::NotRequested | Self::Included(_) | Self::Failed(_)
        )
    }
}

/// 按 `S:"Protocol Name"` 分派到 SSH / Telnet 记录；其它协议不静默丢弃，
/// 而是记进 `skipped`，由调用方在解析结束时汇总成一条 warning。
#[allow(clippy::too_many_arguments)]
pub(crate) fn session_record(
    source_id: String,
    group_path: Option<String>,
    name: String,
    fields: &BTreeMap<String, String>,
    port: Option<u16>,
    policy: PasswordPolicy<'_>,
    warnings: &mut Vec<ImportWarning>,
    skipped: &mut SkippedProtocols,
) -> Option<ImportRecord> {
    // 没有 `Protocol Name` 的 key 是分组目录而不是会话，静默跳过、不计入跳过数。
    let protocol = field(fields, "Protocol Name")?;
    match classify_protocol(&protocol) {
        SessionProtocol::Ssh => {
            ssh_record(source_id, group_path, name, fields, port, policy, warnings)
        }
        SessionProtocol::Telnet => {
            telnet_record(source_id, group_path, name, fields, port, policy, warnings)
        }
        SessionProtocol::Unsupported => {
            skipped.record(&protocol);
            None
        }
    }
}

pub(crate) fn ssh_record(
    source_id: String,
    group_path: Option<String>,
    name: String,
    fields: &BTreeMap<String, String>,
    port: Option<u16>,
    policy: PasswordPolicy<'_>,
    warnings: &mut Vec<ImportWarning>,
) -> Option<ImportRecord> {
    let Some(host) = field(fields, "Hostname") else {
        warnings.push(warning(
            "securecrt_ssh_hostname_missing",
            format!("A SecureCRT SSH session without a hostname was skipped: {source_id}"),
        ));
        return None;
    };
    let username = field(fields, "Username").unwrap_or_default();
    let identity = field(fields, "Identity Filename V2")
        .or_else(|| field(fields, "Identity File"))
        .filter(|value| !value.is_empty());
    // 私钥认证不消费密码：只保留「有没有密文」这个事实，不做解密——
    // V2-`03:` 每条要走 bcrypt-pbkdf，白白多花上百毫秒没有意义。
    let resolved = if identity.is_some() {
        if has_session_password_material(fields) {
            ResolvedPassword::NotRequested
        } else {
            ResolvedPassword::Missing
        }
    } else {
        resolve_password(fields, policy)
    };
    let password = match &resolved {
        ResolvedPassword::Included(password) => Some(password.clone()),
        _ => None,
    };
    let auth_method = match (identity, resolved.has_ciphertext()) {
        (Some(key_path), _) => SshImportAuthMethod::PrivateKey {
            key_path,
            passphrase: None,
        },
        (None, true) => SshImportAuthMethod::Password {
            password: password.clone(),
        },
        (None, false) => SshImportAuthMethod::AutoPublicKey,
    };
    let (password_status, warnings) = password_outcome(&resolved);
    Some(ImportRecord {
        id: record_id("ssh", &source_id),
        importer_id: "securecrt".to_string(),
        source_label: "SecureCRT".to_string(),
        source_id: Some(source_id),
        kind: "ssh".to_string(),
        display_name: name.clone(),
        database: None,
        ssh: Some(SshImportRecord {
            name,
            host,
            port,
            username,
            group_path,
            auth_method,
            init_script: None,
            jump_server: None,
            proxy: None,
        }),
        telnet: None,
        port_forwarding: None,
        quick_command: None,
        workspace: None,
        password_status: password_status.to_string(),
        warnings,
    })
}

/// Telnet 会话只有用户名/密码，没有私钥与跳板机。
pub(crate) fn telnet_record(
    source_id: String,
    group_path: Option<String>,
    name: String,
    fields: &BTreeMap<String, String>,
    port: Option<u16>,
    policy: PasswordPolicy<'_>,
    warnings: &mut Vec<ImportWarning>,
) -> Option<ImportRecord> {
    let Some(host) = field(fields, "Hostname") else {
        warnings.push(warning(
            "securecrt_telnet_hostname_missing",
            format!("A SecureCRT Telnet session without a hostname was skipped: {source_id}"),
        ));
        return None;
    };
    let username = field(fields, "Username");
    let resolved = resolve_password(fields, policy);
    let password = match &resolved {
        ResolvedPassword::Included(password) => Some(password.clone()),
        _ => None,
    };
    let (password_status, warnings) = password_outcome(&resolved);
    Some(ImportRecord {
        id: record_id("telnet", &source_id),
        importer_id: "securecrt".to_string(),
        source_label: "SecureCRT".to_string(),
        source_id: Some(source_id),
        kind: "telnet".to_string(),
        display_name: name.clone(),
        database: None,
        ssh: None,
        telnet: Some(TelnetImportRecord {
            name,
            host,
            port,
            username,
            password,
            group_path,
        }),
        port_forwarding: None,
        quick_command: None,
        workspace: None,
        password_status: password_status.to_string(),
        warnings,
    })
}

/// 密码解析结果到宿主的 `password_status` 枚举字符串（外加解密失败的告警）。
fn password_outcome(resolved: &ResolvedPassword) -> (&'static str, Vec<ImportWarning>) {
    match resolved {
        ResolvedPassword::NotRequested => ("unsupported", Vec::new()),
        ResolvedPassword::Missing => ("missing", Vec::new()),
        ResolvedPassword::Included(_) => ("included", Vec::new()),
        ResolvedPassword::Failed(error) => (
            "unsupported",
            vec![warning(
                "securecrt_password_decrypt_failed",
                format!(
                    "A SecureCRT password could not be decrypted, so it was not imported: {}.",
                    error.reason()
                ),
            )],
        ),
    }
}

/// 密码来源优先级：Credentials 凭据 > 会话自带字段。
///
/// 凭据明文由 `preview_records_from_sources` 预先解好放进 `password` 字段，
/// 会话自带的密文在这里解。
fn resolve_password(
    fields: &BTreeMap<String, String>,
    policy: PasswordPolicy<'_>,
) -> ResolvedPassword {
    let session_ciphertext = field(fields, "Password V2").or_else(|| field(fields, "Password"));
    let credential_ciphertext = has_value(fields, "Credential Encrypted Password");
    if !policy.include_passwords {
        return if has_session_password_material(fields) {
            ResolvedPassword::NotRequested
        } else {
            ResolvedPassword::Missing
        };
    }
    if let Some(password) = field(fields, "password") {
        return ResolvedPassword::Included(password);
    }
    if let Some(reason) = field(fields, "credential password error") {
        return ResolvedPassword::Failed(decode_reason(&reason));
    }
    let Some(ciphertext) = session_ciphertext else {
        return if credential_ciphertext {
            // 凭据有密文但既没解出明文也没有错误记录：只可能是调用方没要求密码。
            ResolvedPassword::NotRequested
        } else {
            ResolvedPassword::Missing
        };
    };
    match decrypt::decrypt_config_password(&ciphertext, policy.passphrase) {
        Ok(password) => ResolvedPassword::Included(password),
        Err(error) => ResolvedPassword::Failed(error),
    }
}

/// 会话（含其引用的凭据）里是否出现了任何密码材料。
fn has_session_password_material(fields: &BTreeMap<String, String>) -> bool {
    has_value(fields, "Password V2")
        || has_value(fields, "Password")
        || has_value(fields, "Credential Encrypted Password")
        || has_value(fields, "password")
        || has_value(fields, "credential password error")
}

/// 把经 `reason()` 序列化过的错误文本还原成枚举；认不出来时按校验和失败处理。
fn decode_reason(reason: &str) -> DecryptError {
    use DecryptError::*;
    [
        NotCiphertext,
        InvalidHex,
        BadLength,
        UnknownPrefix,
        BadPadding,
        BadChecksum,
        NotText,
    ]
    .into_iter()
    .find(|error| error.reason() == reason)
    .unwrap_or(BadChecksum)
}

pub(crate) fn quick_command_record(
    source_id: String,
    group_name: String,
    name: String,
    command: String,
    sort_order: i32,
) -> ImportRecord {
    ImportRecord {
        id: record_id("quick_command", &source_id),
        importer_id: "securecrt".to_string(),
        source_label: "SecureCRT".to_string(),
        source_id: Some(source_id),
        kind: "quick_command".to_string(),
        display_name: name.clone(),
        database: None,
        ssh: None,
        telnet: None,
        port_forwarding: None,
        quick_command: Some(QuickCommandImportRecord {
            name,
            command,
            group_name: Some(group_name),
            shortcut: None,
            description: Some("Imported from SecureCRT quick commands".to_string()),
            sort_order,
            connection_source_id: None,
        }),
        workspace: None,
        password_status: "missing".to_string(),
        warnings: Vec::new(),
    }
}

pub(crate) fn workspace_record(source_id: String, path: String) -> ImportRecord {
    let display_name = path
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or(&path)
        .to_string();
    ImportRecord {
        id: record_id("workspace", &path),
        importer_id: "securecrt".to_string(),
        source_label: "SecureCRT".to_string(),
        source_id: Some(source_id),
        kind: "workspace".to_string(),
        display_name,
        database: None,
        ssh: None,
        telnet: None,
        port_forwarding: None,
        quick_command: None,
        workspace: Some(WorkspaceImportRecord { path }),
        password_status: "missing".to_string(),
        warnings: Vec::new(),
    }
}

pub(crate) fn field(fields: &BTreeMap<String, String>, key: &str) -> Option<String> {
    fields
        .get(&key.to_ascii_lowercase())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

pub(crate) fn enrich_from_credential(
    fields: &mut BTreeMap<String, String>,
    credentials: &BTreeMap<String, CredentialMetadata>,
) {
    let Some(title) = field(fields, "Credential Title") else {
        return;
    };
    let key = title.to_ascii_lowercase();
    if let Some(credential) = credentials.get(&key) {
        if field(fields, "Username").is_none() {
            if let Some(username) = credential
                .username
                .as_ref()
                .filter(|username| !username.is_empty())
            {
                fields.insert("username".to_string(), username.clone());
            }
        }
        if let Some(password) = credential
            .password
            .as_ref()
            .filter(|value| !value.is_empty())
        {
            fields.insert("password".to_string(), password.clone());
        } else if let Some(error) = credential.password_error {
            fields.insert(
                "credential password error".to_string(),
                error.reason().to_string(),
            );
        } else if credential.has_ciphertext {
            fields.insert(
                "credential encrypted password".to_string(),
                "present".to_string(),
            );
        }
    }
}

pub(crate) fn warning(code: impl Into<String>, message: impl Into<String>) -> ImportWarning {
    ImportWarning {
        code: code.into(),
        message: message.into(),
    }
}

fn has_value(fields: &BTreeMap<String, String>, key: &str) -> bool {
    field(fields, key).is_some()
}

pub(crate) fn slug(value: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for ch in value.chars().flat_map(char::to_lowercase) {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            dash = false;
        } else if !dash && !out.is_empty() {
            out.push('-');
            dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        "record".to_string()
    } else {
        out
    }
}

fn record_id(kind: &str, source_id: &str) -> String {
    let identity = format!("{kind}\0{source_id}");
    format!(
        "securecrt:{}:{:016x}",
        slug(source_id),
        stable_hash(&identity)
    )
}

fn stable_hash(value: &str) -> u64 {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}
