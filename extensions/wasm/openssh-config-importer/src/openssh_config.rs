use serde::Serialize;
use std::collections::BTreeSet;

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

#[derive(Clone, Debug, Default, PartialEq, Eq)]
struct HostBlock {
    aliases: Vec<String>,
    host_name: Option<String>,
    user: Option<String>,
    port: Option<u16>,
    identity_file: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct KnownHostEntry {
    host: String,
    port: u16,
}

pub fn preview_records_from_configs<'a, I>(
    configs: I,
    _include_passwords: bool,
) -> Vec<ImportRecord>
where
    I: IntoIterator<Item = (String, &'a [u8])>,
{
    let mut records = Vec::new();
    let mut seen_endpoints = BTreeSet::new();
    for (path, bytes) in configs {
        let Ok(text) = std::str::from_utf8(bytes) else {
            continue;
        };
        if is_known_hosts_path(&path) {
            for entry in parse_known_hosts(text) {
                if seen_endpoints.insert(endpoint_key(&entry.host, entry.port)) {
                    records.push(record_from_known_host(&path, &entry));
                }
            }
            continue;
        }

        for block in parse_blocks(text) {
            for alias in importable_aliases(&block.aliases) {
                let host = block.host_name.clone().unwrap_or_else(|| alias.to_string());
                let port = block.port.unwrap_or(22);
                seen_endpoints.insert(endpoint_key(&host, port));
                let auth_method = match block.identity_file.clone() {
                    Some(key_path) => SshImportAuthMethod::PrivateKey {
                        key_path,
                        passphrase: None,
                    },
                    None => SshImportAuthMethod::AutoPublicKey,
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
                        port: Some(port),
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

fn record_from_known_host(path: &str, entry: &KnownHostEntry) -> ImportRecord {
    let endpoint = endpoint_display(&entry.host, entry.port);
    ImportRecord {
        id: format!("openssh-config:known-hosts-{}", slug(&endpoint)),
        importer_id: "openssh-config".to_string(),
        source_label: "OpenSSH Config".to_string(),
        source_id: Some(format!("{path}:{endpoint}")),
        kind: "ssh".to_string(),
        display_name: endpoint.clone(),
        database: None,
        ssh: Some(SshImportRecord {
            name: endpoint,
            host: entry.host.clone(),
            port: Some(entry.port),
            username: String::new(),
            auth_method: SshImportAuthMethod::AutoPublicKey,
            init_script: None,
            jump_server: None,
            proxy: None,
        }),
        port_forwarding: None,
        password_status: "unsupported".to_string(),
        warnings: Vec::new(),
    }
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

fn parse_known_hosts(text: &str) -> Vec<KnownHostEntry> {
    let mut entries = Vec::new();
    for raw_line in text.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut fields = line.split_whitespace();
        let Some(hosts) = fields.next() else {
            continue;
        };
        if hosts.starts_with('@') {
            continue;
        }
        for host_pattern in hosts.split(',') {
            if let Some(entry) = parse_known_host_pattern(host_pattern) {
                entries.push(entry);
            }
        }
    }
    entries
}

fn parse_known_host_pattern(pattern: &str) -> Option<KnownHostEntry> {
    let pattern = pattern.trim();
    if pattern.is_empty() || pattern.starts_with('|') || pattern.contains(['*', '?', '!']) {
        return None;
    }

    if let Some(rest) = pattern.strip_prefix('[') {
        let (host, port) = rest.split_once("]:")?;
        let port = port.parse::<u16>().ok()?;
        if host.is_empty() {
            return None;
        }
        return Some(KnownHostEntry {
            host: host.to_string(),
            port,
        });
    }

    Some(KnownHostEntry {
        host: pattern.to_string(),
        port: 22,
    })
}

fn is_known_hosts_path(path: &str) -> bool {
    path.rsplit(|ch| ch == '/' || ch == '\\')
        .next()
        .is_some_and(|name| name.eq_ignore_ascii_case("known_hosts"))
}

fn endpoint_key(host: &str, port: u16) -> String {
    format!("{}:{port}", host.to_ascii_lowercase())
}

fn endpoint_display(host: &str, port: u16) -> String {
    if port == 22 {
        host.to_string()
    } else {
        format!("{host}:{port}")
    }
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
        assert_eq!(
            SshImportAuthMethod::PrivateKey {
                key_path: "~/.ssh/prod_api".to_string(),
                passphrase: None
            },
            ssh.auth_method
        );

        let json = serde_json::to_value(record).unwrap();
        assert_eq!(
            serde_json::json!({
                "private_key": {
                    "key_path": "~/.ssh/prod_api",
                    "passphrase": null
                }
            }),
            json["ssh"]["auth_method"]
        );
    }

    #[test]
    fn parses_known_hosts_entries_as_host_only_connections() {
        let known_hosts = br#"
host-only.example.test ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIhost
[port.example.test]:2202 ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQport
host-only.example.test,alias.example.test ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIalias
|1|hashed|entry ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIhashed
@cert-authority *.example.test ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIcert
"#;

        let records = preview_records_from_configs(
            vec![("~/.ssh/known_hosts".to_string(), known_hosts.as_slice())],
            true,
        );

        assert_eq!(3, records.len());

        let first = &records[0];
        assert_eq!(
            "openssh-config:known-hosts-host-only-example-test",
            first.id
        );
        assert_eq!(
            "~/.ssh/known_hosts:host-only.example.test",
            first.source_id.as_deref().unwrap()
        );
        assert_eq!("host-only.example.test", first.display_name);
        let first_ssh = first.ssh.as_ref().unwrap();
        assert_eq!("host-only.example.test", first_ssh.host);
        assert_eq!(Some(22), first_ssh.port);
        assert_eq!("", first_ssh.username);
        assert_eq!(SshImportAuthMethod::AutoPublicKey, first_ssh.auth_method);

        let json = serde_json::to_value(first).unwrap();
        assert_eq!(
            serde_json::json!("auto_public_key"),
            json["ssh"]["auth_method"]
        );

        let second = &records[1];
        assert_eq!(
            "openssh-config:known-hosts-port-example-test-2202",
            second.id
        );
        let second_ssh = second.ssh.as_ref().unwrap();
        assert_eq!("port.example.test", second_ssh.host);
        assert_eq!(Some(2202), second_ssh.port);

        let third = &records[2];
        assert_eq!("alias.example.test", third.display_name);
        let third_ssh = third.ssh.as_ref().unwrap();
        assert_eq!("alias.example.test", third_ssh.host);
        assert_eq!(Some(22), third_ssh.port);
    }
}
