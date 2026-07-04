use serde::Serialize;
use std::collections::BTreeMap;

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
pub struct SshImportAuthMethod {
    pub kind: String,
    pub password: Option<String>,
    pub key_path: Option<String>,
    pub private_key: Option<String>,
    pub passphrase: Option<String>,
    pub file_name_hint: Option<String>,
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
        .filter_map(|(path, bytes)| parse_session(&path, bytes))
        .collect()
}

fn parse_session(path: &str, bytes: &[u8]) -> Option<ImportRecord> {
    let text = std::str::from_utf8(bytes).ok()?;
    let ini = parse_ini(text);
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
            auth_method: SshImportAuthMethod {
                kind: "auto_public_key".to_string(),
                password: None,
                key_path: None,
                private_key: None,
                passphrase: None,
                file_name_hint: None,
            },
            init_script: None,
            jump_server: None,
            proxy: None,
        }),
        port_forwarding: None,
        password_status: "unsupported".to_string(),
        warnings: Vec::new(),
    })
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
    path.rsplit(['/', '\\'])
        .next()
        .unwrap_or(path)
        .strip_suffix(".xsh")
        .unwrap_or_else(|| path.rsplit(['/', '\\']).next().unwrap_or(path))
        .to_string()
}

fn slug(path: &str) -> String {
    let stem = path
        .strip_suffix(".xsh")
        .unwrap_or(path)
        .trim_matches(['/', '\\']);
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ssh_session_without_importing_encrypted_passwords() {
        let session = br#"
[CONNECTION]
Host=prod.example.test
Port=2200
Protocol=SSH

[CONNECTION:AUTHENTICATION]
UserName=deploy
Password=encrypted-secret
"#;

        let records = preview_records_from_sessions(
            vec![("Prod/SSH.xsh".to_string(), session.as_slice())],
            true,
        );

        assert_eq!(1, records.len());
        let record = &records[0];
        assert_eq!("xshell:prod-ssh", record.id);
        assert_eq!("xshell", record.importer_id);
        assert_eq!("Xshell", record.source_label);
        assert_eq!(Some("Prod/SSH.xsh"), record.source_id.as_deref());
        assert_eq!("ssh", record.kind);
        assert_eq!("SSH", record.display_name);
        assert_eq!("unsupported", record.password_status);
        let ssh = record.ssh.as_ref().unwrap();
        assert_eq!("SSH", ssh.name);
        assert_eq!("prod.example.test", ssh.host);
        assert_eq!(Some(2200), ssh.port);
        assert_eq!("deploy", ssh.username);
        assert_eq!("auto_public_key", ssh.auth_method.kind);
        assert!(ssh.auth_method.password.is_none());
    }
}
