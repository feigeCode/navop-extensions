#[path = "button_bar.rs"]
mod button_bar;
#[path = "decrypt.rs"]
mod decrypt;
#[path = "ini.rs"]
mod ini;
#[path = "model.rs"]
mod model;
#[path = "source.rs"]
mod source;
#[path = "text.rs"]
mod text;
#[path = "xml.rs"]
mod xml;

use std::collections::{BTreeMap, BTreeSet};

use model::{CredentialMetadata, PasswordPolicy, SkippedProtocols, warning};
pub use model::{
    ImportRecord, ImportWarning, PreviewResult, QuickCommandImportRecord, SshImportAuthMethod,
};
pub(crate) use source::session_directory_group_path;
pub use source::{SourceKind, classify_source};

/// 未设置配置口令时使用的默认值；`component` 侧显式透传，便于将来接 UI 输入。
pub(crate) use decrypt::DEFAULT_PASSPHRASE;

/// 用默认（空）配置口令解析导入源。
pub fn preview_records_from_sources<'a, I>(sources: I, include_passwords: bool) -> PreviewResult
where
    I: IntoIterator<Item = (String, &'a [u8])>,
{
    preview_records_from_sources_with_passphrase(
        sources,
        include_passwords,
        decrypt::DEFAULT_PASSPHRASE,
    )
}

/// 与 [`preview_records_from_sources`] 相同，但可显式传入 SecureCRT 配置口令
/// （用户在 SecureCRT 里设过 "Configuration Passphrase" 时才有必要）。
pub fn preview_records_from_sources_with_passphrase<'a, I>(
    sources: I,
    include_passwords: bool,
    passphrase: &str,
) -> PreviewResult
where
    I: IntoIterator<Item = (String, &'a [u8])>,
{
    let mut result = PreviewResult::default();
    let policy = PasswordPolicy {
        include_passwords,
        passphrase,
    };
    let mut skipped = SkippedProtocols::default();
    let mut seen = BTreeSet::new();
    let mut credentials = BTreeMap::new();
    let mut decoded_sources = Vec::new();
    for (path, bytes) in sources {
        let Some(kind) = classify_source(&path) else {
            continue;
        };
        let Some(text) = text::decode_text(bytes) else {
            result.warnings.push(model::warning(
                "securecrt_source_decode_failed",
                format!("SecureCRT source could not be decoded: {path}"),
            ));
            continue;
        };
        if is_credential_path(&path) {
            let credential_fields = ini::parse_fields(&text);
            credentials.insert(
                credential_key(&path),
                credential_metadata(&credential_fields, include_passwords, passphrase),
            );
            continue;
        }
        decoded_sources.push((path, text, kind));
    }

    for (path, text, kind) in decoded_sources {
        let parsed = match kind {
            SourceKind::SessionIni => {
                ini::parse_session(
                    &path,
                    &text,
                    &credentials,
                    policy,
                    &mut result.warnings,
                    &mut skipped,
                )
            }
            .into_iter()
            .collect(),
            SourceKind::FolderData => folder_data_records(&path, &text),
            SourceKind::Xml => xml::parse_export(
                &path,
                &text,
                &credentials,
                policy,
                &mut result.warnings,
                &mut skipped,
            ),
            SourceKind::ButtonBar => {
                button_bar::parse_button_bar(&path, &text, &mut result.warnings)
            }
        };
        for record in parsed {
            if seen.insert(record.id.clone()) {
                result.records.push(record);
            } else {
                result.warnings.push(model::warning(
                    "securecrt_duplicate_record_id",
                    format!(
                        "A duplicate SecureCRT import record was skipped: {}",
                        record.source_id.as_deref().unwrap_or(&record.id)
                    ),
                ));
            }
        }
    }
    // 被跳过的非 SSH/Telnet 会话在这里统一报一次，scan 与 preview 共用同一条解析路径。
    if let Some(summary) = skipped.summary_warning() {
        result.warnings.push(summary);
    }
    if let Some(summary) =
        diagnostics_warning(&result.records, &result.warnings, policy.include_passwords)
    {
        result.warnings.push(summary);
    }
    result
}

/// 把「导入了多少条 / 还有多少条没进来、为什么」汇总成一条告警。
///
/// 用户看到「222 个会话只进来 144 个」时，唯一能自救的信息就是这条：
/// 缺主机名的会话、解密失败的密码分别有多少条、失败原因是什么。
/// 没有任何异常时返回 `None`，避免每次都往界面上塞一条无意义的告警。
pub(crate) fn diagnostics_warning(
    records: &[ImportRecord],
    warnings: &[ImportWarning],
    include_passwords: bool,
) -> Option<ImportWarning> {
    let ssh = records.iter().filter(|record| record.kind == "ssh").count();
    let telnet = records
        .iter()
        .filter(|record| record.kind == "telnet")
        .count();
    // 记录级告警（例如解密失败）挂在 record.warnings 上，扫描级告警在 warnings 里，
    // 两处都要统计，否则最关键的失败原因会被漏掉。
    let mut missing_hostname = 0;
    let mut password_failures: std::collections::BTreeMap<String, usize> =
        std::collections::BTreeMap::new();
    for warning in warnings
        .iter()
        .chain(records.iter().flat_map(|record| record.warnings.iter()))
    {
        if warning.code == "securecrt_ssh_hostname_missing"
            || warning.code == "securecrt_telnet_hostname_missing"
        {
            missing_hostname += 1;
        } else if warning.code == "securecrt_password_decrypt_failed" {
            *password_failures
                .entry(decrypt_failure_reason(&warning.message))
                .or_default() += 1;
        }
    }
    // 源里根本没有密码（XML 导出没勾「包含个人配置数据」是最常见的一种），
    // 和「有密文但解不开」是两件事，必须分开报，否则用户会去查错方向。
    // 只统计「本该有密码、源里却没有」的会话：私钥/Agent 认证本来就不带密码，
    // 把它们算进来只会让这条告警变成每次都响的噪音。
    let without_password = if include_passwords {
        records
            .iter()
            .filter(|record| match record.kind.as_str() {
                // 既没有密码、也没有私钥的会话最可疑：XML 导出没勾
                // 「包含个人配置数据」时，整批 SSH 会话都会长成这样。
                "ssh" => matches!(
                    record.ssh.as_ref().map(|ssh| &ssh.auth_method),
                    Some(SshImportAuthMethod::Password { password: None })
                        | Some(SshImportAuthMethod::AutoPublicKey)
                ),
                "telnet" => record
                    .telnet
                    .as_ref()
                    .is_some_and(|telnet| telnet.password.is_none()),
                _ => false,
            })
            .count()
    } else {
        0
    };
    if missing_hostname == 0 && password_failures.is_empty() && without_password == 0 {
        return None;
    }

    let mut parts = vec![format!(
        "Imported {ssh} SSH and {telnet} Telnet session(s)."
    )];
    if missing_hostname > 0 {
        parts.push(format!(
            "Skipped {missing_hostname} session(s) without a hostname."
        ));
    }
    if without_password > 0 {
        parts.push(format!(
            "{without_password} imported session(s) carry no saved password in the source."
        ));
    }
    if !password_failures.is_empty() {
        let failed: usize = password_failures.values().sum();
        let detail = password_failures
            .iter()
            .map(|(reason, count)| format!("{reason}: {count}"))
            .collect::<Vec<_>>()
            .join(", ");
        parts.push(format!(
            "{failed} password(s) could not be decrypted ({detail})."
        ));
    }
    Some(warning("securecrt_import_diagnostics", parts.join(" ")))
}

/// 从告警文案里取回失败原因；文案由 [`password_outcome`] 统一生成。
fn decrypt_failure_reason(message: &str) -> String {
    let reason = message
        .rsplit_once(':')
        .map(|(_, tail)| tail)
        .unwrap_or(message)
        .trim();
    reason.trim_end_matches('.').to_string()
}

/// 解出 Credentials 目录里一条凭据的用户名与密码。
///
/// 凭据密码与会话密码同源同算法，因此在这里一次性解好，供引用它的会话复用。
fn credential_metadata(
    fields: &BTreeMap<String, String>,
    include_passwords: bool,
    passphrase: &str,
) -> CredentialMetadata {
    let ciphertext =
        model::field(fields, "Password V2").or_else(|| model::field(fields, "Password"));
    let mut metadata = CredentialMetadata {
        username: model::field(fields, "Username"),
        has_ciphertext: ciphertext.is_some(),
        password: None,
        password_error: None,
    };
    if !include_passwords {
        return metadata;
    }
    if let Some(ciphertext) = ciphertext {
        match decrypt::decrypt_config_password(&ciphertext, passphrase) {
            Ok(password) => metadata.password = Some(password),
            Err(error) => metadata.password_error = Some(error),
        }
    }
    metadata
}

pub(crate) fn append_workspace_records<I>(result: &mut PreviewResult, groups: I)
where
    I: IntoIterator<Item = String>,
{
    let mut seen = result
        .records
        .iter()
        .map(|record| record.id.clone())
        .collect::<BTreeSet<_>>();
    for path in groups {
        let Some(path) = source::normalize_workspace_path(&path) else {
            continue;
        };
        let record = model::workspace_record(format!("Sessions/{path}"), path);
        if seen.insert(record.id.clone()) {
            result.records.push(record);
        }
    }
}

fn folder_data_records(path: &str, text: &str) -> Vec<ImportRecord> {
    let parent = source::session_file_group_path(path);
    let mut records = Vec::new();
    let mut seen = BTreeSet::new();
    for folder in ini::parse_folder_names(text) {
        let workspace_path = match parent.as_deref() {
            Some(parent) => source::normalize_workspace_path(&format!("{parent}/{folder}")),
            None => source::normalize_workspace_path(&folder),
        };
        let Some(workspace_path) = workspace_path else {
            continue;
        };
        for workspace_path in workspace_path_ancestors(&workspace_path) {
            if seen.insert(workspace_path.clone()) {
                records.push(model::workspace_record(
                    format!("{}#{workspace_path}", path.replace('\\', "/")),
                    workspace_path,
                ));
            }
        }
    }
    records
}

fn workspace_path_ancestors(path: &str) -> Vec<String> {
    let Some(path) = source::normalize_workspace_path(path) else {
        return Vec::new();
    };
    let mut current = String::new();
    path.split('/')
        .map(|part| {
            if !current.is_empty() {
                current.push('/');
            }
            current.push_str(part);
            current.clone()
        })
        .collect()
}

fn is_credential_path(path: &str) -> bool {
    let normalized = path.replace('\\', "/");
    normalized
        .split('/')
        .rev()
        .skip(1)
        .any(|part| part.eq_ignore_ascii_case("Credentials"))
}

fn credential_key(path: &str) -> String {
    path.rsplit(['/', '\\'])
        .next()
        .unwrap_or(path)
        .trim_end_matches(".ini")
        .trim_end_matches(".INI")
        .to_ascii_lowercase()
}
