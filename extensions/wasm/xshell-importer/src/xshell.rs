use encoding_rs::GBK;
use serde::Serialize;
use std::collections::BTreeMap;
use std::io::{Cursor, Read};

use zip::ZipArchive;

const MAX_XTS_SESSION_COUNT: usize = 4096;
const MAX_XSH_FILE_SIZE: u64 = 4 * 1024 * 1024;
const MAX_XTS_TOTAL_SESSION_SIZE: u64 = 32 * 1024 * 1024;

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
    PrivateKeyMaterial {
        private_key: Option<String>,
        passphrase: Option<String>,
        file_name_hint: Option<String>,
    },
    Agent,
    AutoPublicKey,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ImportWarning {
    pub code: String,
    pub message: String,
}

pub fn preview_records_from_sessions<'a, I>(
    sessions: I,
    _include_passwords: bool,
) -> Vec<ImportRecord>
where
    I: IntoIterator<Item = (String, &'a [u8])>,
{
    sessions
        .into_iter()
        .flat_map(|(path, bytes)| parse_source(&path, bytes))
        .collect()
}

pub fn is_supported_source_path(path: &str) -> bool {
    ["xsh", "xts"]
        .into_iter()
        .any(|extension| has_extension(path, extension))
}

fn parse_source(path: &str, bytes: &[u8]) -> Vec<ImportRecord> {
    if has_extension(path, "xts") {
        return parse_xts_backup(path, bytes);
    }
    parse_session(path, bytes).into_iter().collect()
}

fn parse_xts_backup(archive_path: &str, bytes: &[u8]) -> Vec<ImportRecord> {
    let Ok(mut archive) = ZipArchive::new(Cursor::new(bytes)) else {
        return Vec::new();
    };
    let mut sessions = Vec::new();
    let mut total_size = 0_u64;
    for index in 0..archive.len() {
        let Ok(mut entry) = archive.by_index(index) else {
            continue;
        };
        let entry_name = decode_xts_entry_name(entry.name_raw(), entry.name());
        if !is_xts_session_entry(&entry_name, entry.is_dir()) {
            continue;
        }
        let entry_size = entry.size();
        if entry_size > MAX_XSH_FILE_SIZE
            || total_size.saturating_add(entry_size) > MAX_XTS_TOTAL_SESSION_SIZE
        {
            continue;
        }
        let mut session = Vec::with_capacity(entry_size as usize);
        if entry.read_to_end(&mut session).is_err() {
            continue;
        }
        total_size += entry_size;
        sessions.push((format!("{archive_path}!/{entry_name}"), session));
        if sessions.len() >= MAX_XTS_SESSION_COUNT {
            break;
        }
    }
    sessions.sort_by(|left, right| left.0.cmp(&right.0));
    sessions
        .into_iter()
        .filter_map(|(path, bytes)| parse_session(&path, &bytes))
        .collect()
}

fn decode_xts_entry_name(raw_name: &[u8], fallback: &str) -> String {
    if let Ok(name) = std::str::from_utf8(raw_name) {
        return name.to_string();
    }
    let (name, _, had_errors) = GBK.decode(raw_name);
    if had_errors {
        fallback.to_string()
    } else {
        name.into_owned()
    }
}

fn is_xts_session_entry(path: &str, is_dir: bool) -> bool {
    !is_dir && path.to_ascii_lowercase().starts_with("xshell/") && has_extension(path, "xsh")
}

fn has_extension(path: &str, extension: &str) -> bool {
    path.rsplit_once('.')
        .is_some_and(|(_, suffix)| suffix.eq_ignore_ascii_case(extension))
}

fn parse_session(path: &str, bytes: &[u8]) -> Option<ImportRecord> {
    let text = decode_session_text(bytes)?;
    let ini = parse_ini(&text);
    let connection = ini.get("connection")?;
    let protocol = field(connection, "protocol").unwrap_or("SSH");
    if !protocol.eq_ignore_ascii_case("ssh") {
        return None;
    }
    let host = field(connection, "host")?.to_string();
    let name = session_name(path);
    let port = field(connection, "port")
        .and_then(|value| value.parse::<u16>().ok())
        .or(Some(22));
    let username = ini
        .get("connection:authentication")
        .and_then(|auth| field(auth, "username"))
        .unwrap_or_default()
        .to_string();

    Some(ImportRecord {
        id: format!("xshell:{}", slug(path)),
        importer_id: "xshell".to_string(),
        source_label: "Xshell".to_string(),
        source_id: Some(path.to_string()),
        kind: "ssh".to_string(),
        display_name: name.clone(),
        database: None,
        ssh: Some(SshImportRecord {
            name,
            host,
            port,
            username,
            auth_method: SshImportAuthMethod::AutoPublicKey,
            init_script: None,
            jump_server: None,
            proxy: None,
        }),
        port_forwarding: None,
        password_status: "unsupported".to_string(),
        warnings: Vec::new(),
    })
}

fn decode_session_text(bytes: &[u8]) -> Option<String> {
    if bytes.starts_with(&[0xff, 0xfe]) {
        return decode_utf16_units(&bytes[2..], u16::from_le_bytes);
    }
    if bytes.starts_with(&[0xfe, 0xff]) {
        return decode_utf16_units(&bytes[2..], u16::from_be_bytes);
    }
    std::str::from_utf8(bytes)
        .ok()
        .map(|text| text.trim_start_matches('\u{feff}').to_string())
}

fn decode_utf16_units(bytes: &[u8], from_bytes: fn([u8; 2]) -> u16) -> Option<String> {
    if !bytes.len().is_multiple_of(2) {
        return None;
    }
    let units = bytes
        .chunks_exact(2)
        .map(|chunk| from_bytes([chunk[0], chunk[1]]));
    std::char::decode_utf16(units)
        .collect::<Result<String, _>>()
        .ok()
}

fn parse_ini(text: &str) -> BTreeMap<String, BTreeMap<String, String>> {
    let mut out = BTreeMap::new();
    let mut section = String::new();
    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }
        if let Some(name) = line
            .strip_prefix('[')
            .and_then(|line| line.strip_suffix(']'))
        {
            section = name.trim().to_ascii_lowercase();
            out.entry(section.clone()).or_insert_with(BTreeMap::new);
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        out.entry(section.clone())
            .or_insert_with(BTreeMap::new)
            .insert(key.trim().to_ascii_lowercase(), value.trim().to_string());
    }
    out
}

fn field<'a>(section: &'a BTreeMap<String, String>, key: &str) -> Option<&'a str> {
    section
        .get(&key.to_ascii_lowercase())
        .map(String::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn session_name(path: &str) -> String {
    let file_name = path.rsplit(['/', '\\']).next().unwrap_or(path);
    strip_xsh_extension(file_name).to_string()
}

fn slug(path: &str) -> String {
    let stem = strip_xsh_extension(path).trim_matches(['/', '\\']);
    let mut out = String::new();
    let mut last_dash = false;
    for ch in stem.chars().flat_map(char::to_lowercase) {
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

fn strip_xsh_extension(path: &str) -> &str {
    if has_extension(path, "xsh") {
        &path[..path.len() - ".xsh".len()]
    } else {
        path
    }
}
