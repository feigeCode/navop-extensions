use std::collections::{BTreeMap, BTreeSet};

use super::model::{
    CredentialMetadata, ImportRecord, ImportWarning, PasswordPolicy, SessionProtocol,
    SkippedProtocols, classify_protocol, default_port, enrich_from_credential, field,
    invalid_port_warning, session_record,
};
use super::source::{normalize_workspace_path, session_file_group_path};

pub(crate) fn parse_session(
    path: &str,
    text: &str,
    credentials: &BTreeMap<String, CredentialMetadata>,
    policy: PasswordPolicy<'_>,
    warnings: &mut Vec<ImportWarning>,
    skipped: &mut SkippedProtocols,
) -> Option<ImportRecord> {
    let mut fields = parse_fields(text);
    enrich_from_credential(&mut fields, credentials);
    let protocol = field(&fields, "Protocol Name").unwrap_or_default();
    let source_id = path.replace('\\', "/");
    // 被跳过的协议不解析端口，免得为不会导入的会话报端口告警。
    let port = match classify_protocol(&protocol) {
        SessionProtocol::Unsupported => None,
        _ => protocol_port(&fields, &protocol, &source_id, warnings),
    };
    session_record(
        source_id,
        session_file_group_path(path),
        session_name(path),
        &fields,
        port,
        policy,
        warnings,
        skipped,
    )
}

pub(crate) fn parse_folder_names(text: &str) -> Vec<String> {
    let mut lines = text.lines();
    while let Some(line) = lines.next() {
        let line = line.trim_start_matches('\u{feff}').trim();
        let Some((key, count)) = line.split_once('=') else {
            continue;
        };
        let Some(key_name) = list_key_name(key) else {
            continue;
        };
        if !key_name.eq_ignore_ascii_case("Folder List V2") {
            continue;
        }
        let Some(count) = u32::from_str_radix(count.trim(), 16)
            .ok()
            .and_then(|count| usize::try_from(count).ok())
        else {
            return Vec::new();
        };
        return lines
            .by_ref()
            .take(count.min(4096))
            .filter_map(normalize_workspace_path)
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
    }
    Vec::new()
}

fn list_key_name(key: &str) -> Option<&str> {
    let key = key.trim();
    let (_, quoted) = key.split_once(":\"")?;
    quoted.strip_suffix('"')
}

pub(crate) fn parse_fields(text: &str) -> BTreeMap<String, String> {
    let mut fields = BTreeMap::new();
    for line in text.lines().map(str::trim) {
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let Some(key) = key
            .trim()
            .strip_prefix("S:\"")
            .or_else(|| key.trim().strip_prefix("D:\""))
            .and_then(|key| key.strip_suffix('"'))
        else {
            continue;
        };
        fields.insert(key.to_ascii_lowercase(), decode_value(value));
    }
    fields
}

fn protocol_port(
    fields: &BTreeMap<String, String>,
    protocol: &str,
    source_id: &str,
    warnings: &mut Vec<ImportWarning>,
) -> Option<u16> {
    let key = protocol.trim().to_ascii_lowercase();
    let default = default_port(&key);
    let keys = [format!("[{key}] port"), "port".to_string()];
    for key in keys {
        if let Some(value) = fields.get(&key) {
            if let Some(port) = parse_hex_port(value) {
                return Some(port);
            }
            warnings.push(invalid_port_warning(protocol, source_id));
            return Some(default);
        }
    }
    Some(default)
}

fn parse_hex_port(value: &str) -> Option<u16> {
    u32::from_str_radix(value.trim(), 16)
        .ok()
        .and_then(|port| u16::try_from(port).ok())
}

fn decode_value(value: &str) -> String {
    let value = value.trim();
    let mut parts = value.split_whitespace();
    let Some(_length) = parts.next() else {
        return String::new();
    };
    let Some(hex) = parts.next() else {
        return value.to_string();
    };
    if parts.next().is_some() || hex.len() % 2 != 0 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return value.to_string();
    }
    let bytes: Vec<u8> = hex
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| (hex_nibble(pair[0]) << 4) | hex_nibble(pair[1]))
        .collect();
    if !bytes.len().is_multiple_of(2) {
        return value.to_string();
    }
    let units = bytes
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]));
    std::char::decode_utf16(units)
        .collect::<Result<String, _>>()
        .unwrap_or_else(|_| value.to_string())
        .trim_end_matches('\0')
        .to_string()
}

fn hex_nibble(byte: u8) -> u8 {
    match byte {
        b'0'..=b'9' => byte - b'0',
        b'a'..=b'f' => byte - b'a' + 10,
        b'A'..=b'F' => byte - b'A' + 10,
        _ => 0,
    }
}

fn session_name(path: &str) -> String {
    let name = path.rsplit(['/', '\\']).next().unwrap_or(path);
    name.strip_suffix(".ini")
        .or_else(|| name.strip_suffix(".INI"))
        .unwrap_or(name)
        .to_string()
}
