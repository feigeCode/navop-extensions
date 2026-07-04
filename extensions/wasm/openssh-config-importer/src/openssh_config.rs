use serde::Serialize;

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

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct HostBlock {
    aliases: Vec<String>,
    host_name: Option<String>,
    user: Option<String>,
    port: Option<u16>,
    identity_file: Option<String>,
}

pub fn preview_records_from_configs<'a, I>(
    configs: I,
    _include_passwords: bool,
) -> Vec<ImportRecord>
where
    I: IntoIterator<Item = (String, &'a [u8])>,
{
    let mut records = Vec::new();
    for (path, bytes) in configs {
        let Ok(text) = std::str::from_utf8(bytes) else {
            continue;
        };
        for block in parse_blocks(text) {
            for alias in importable_aliases(&block.aliases) {
                let host = block.host_name.clone().unwrap_or_else(|| alias.to_string());
                let auth_method = match block.identity_file.clone() {
                    Some(key_path) => SshImportAuthMethod {
                        kind: "private_key".to_string(),
                        password: None,
                        key_path: Some(key_path),
                        private_key: None,
                        passphrase: None,
                        file_name_hint: None,
                    },
                    None => SshImportAuthMethod {
                        kind: "auto_public_key".to_string(),
                        password: None,
                        key_path: None,
                        private_key: None,
                        passphrase: None,
                        file_name_hint: None,
                    },
                };
                records.push(ImportRecord {
                    id: format!("openssh-config:{}", slug(alias)),
                    importer_id: "openssh-config".to_string(),
                    source_label: "OpenSSH Config".to_string(),
                    source_id: Some(format!("{path}:{alias}")),
                    kind: "ssh".to_string(),
                    display_name: alias.to_string(),
                    database: None,
                    ssh: Some(SshImportRecord {
                        name: alias.to_string(),
                        host,
                        port: block.port.or(Some(22)),
                        username: block.user.clone().unwrap_or_default(),
                        auth_method,
                        init_script: None,
                        jump_server: None,
                        proxy: None,
                    }),
                    port_forwarding: None,
                    password_status: "unsupported".to_string(),
                    warnings: Vec::new(),
                });
            }
        }
    }
    records
}

fn parse_blocks(text: &str) -> Vec<HostBlock> {
    let mut out = Vec::new();
    let mut current = None::<HostBlock>;

    for raw_line in text.lines() {
        let line = strip_comment(raw_line).trim();
        if line.is_empty() {
            continue;
        }
        let Some((key, value)) = split_directive(line) else {
            continue;
        };
        if key.eq_ignore_ascii_case("host") {
            if let Some(block) = current.take() {
                out.push(block);
            }
            current = Some(HostBlock {
                aliases: split_words(value)
                    .into_iter()
                    .map(ToOwned::to_owned)
                    .collect(),
                ..HostBlock::default()
            });
            continue;
        }

        let Some(block) = current.as_mut() else {
            continue;
        };
        match key.to_ascii_lowercase().as_str() {
            "hostname" => block.host_name = Some(unquote(value).to_string()),
            "user" => block.user = Some(unquote(value).to_string()),
            "port" => block.port = unquote(value).parse::<u16>().ok(),
            "identityfile" => {
                if block.identity_file.is_none() {
                    block.identity_file = Some(unquote(value).to_string());
                }
            }
            _ => {}
        }
    }

    if let Some(block) = current {
        out.push(block);
    }
    out
}

fn importable_aliases(aliases: &[String]) -> impl Iterator<Item = &str> {
    aliases
        .iter()
        .map(String::as_str)
        .filter(|alias| !alias.contains(['*', '?', '!']) && !alias.is_empty())
}

fn split_directive(line: &str) -> Option<(&str, &str)> {
    line.split_once(char::is_whitespace)
        .map(|(key, value)| (key.trim(), value.trim()))
        .filter(|(key, value)| !key.is_empty() && !value.is_empty())
}

fn split_words(value: &str) -> Vec<&str> {
    value.split_whitespace().map(unquote).collect()
}

fn strip_comment(line: &str) -> &str {
    let mut quoted = false;
    for (index, ch) in line.char_indices() {
        if ch == '"' {
            quoted = !quoted;
        } else if ch == '#' && !quoted {
            return &line[..index];
        }
    }
    line
}

fn unquote(value: &str) -> &str {
    let value = value.trim();
    value
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .unwrap_or(value)
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
        "host".to_string()
    } else {
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_host_entry_with_identity_file_without_passwords() {
        let config = br#"
Host *
  ServerAliveInterval 30

Host prod-api
  HostName api.example.test
  User deploy
  Port 2202
  IdentityFile ~/.ssh/prod_api
"#;

        let records = preview_records_from_configs(
            vec![("~/.ssh/config".to_string(), config.as_slice())],
            true,
        );

        assert_eq!(1, records.len());
        let record = &records[0];
        assert_eq!("openssh-config:prod-api", record.id);
        assert_eq!("openssh-config", record.importer_id);
        assert_eq!("OpenSSH Config", record.source_label);
        assert_eq!(Some("~/.ssh/config:prod-api"), record.source_id.as_deref());
        assert_eq!("ssh", record.kind);
        assert_eq!("prod-api", record.display_name);
        assert_eq!("unsupported", record.password_status);
        let ssh = record.ssh.as_ref().unwrap();
        assert_eq!("prod-api", ssh.name);
        assert_eq!("api.example.test", ssh.host);
        assert_eq!(Some(2202), ssh.port);
        assert_eq!("deploy", ssh.username);
        assert_eq!("private_key", ssh.auth_method.kind);
        assert_eq!(Some("~/.ssh/prod_api"), ssh.auth_method.key_path.as_deref());
        assert!(ssh.auth_method.password.is_none());
        assert!(ssh.auth_method.passphrase.is_none());
    }
}
