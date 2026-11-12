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

use model::{CredentialMetadata, PasswordPolicy, SkippedProtocols};
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
    result
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
