use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ImportRecord {
    pub id: String,
    pub importer_id: String,
    pub source_label: String,
    pub source_id: Option<String>,
    pub kind: String,
    pub display_name: String,
    pub database: Option<DatabaseImportRecord>,
    pub ssh: Option<serde_json::Value>,
    pub port_forwarding: Option<serde_json::Value>,
    pub password_status: String,
    pub warnings: Vec<ImportWarning>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct DatabaseImportRecord {
    pub database_type: serde_json::Value,
    pub name: String,
    pub host: String,
    pub port: Option<u16>,
    pub username: String,
    pub password: Option<String>,
    pub database: Option<String>,
    pub extra_params: BTreeMap<String, String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ImportWarning {
    pub code: String,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct RedisConnection {
    path: String,
    id: Option<String>,
    name: Option<String>,
    host: String,
    port: Option<u16>,
    username: Option<String>,
    database: Option<String>,
    tls: Option<bool>,
}

pub fn preview_records_from_store_files<'a, I>(
    files: I,
    _include_passwords: bool,
) -> Vec<ImportRecord>
where
    I: IntoIterator<Item = (String, &'a [u8])>,
{
    let mut records = Vec::new();
    for (path, bytes) in files {
        let Ok(value) = serde_json::from_slice::<Value>(bytes) else {
            continue;
        };
        for connection in collect_connections(&value) {
            let key = connection
                .id
                .clone()
                .or_else(|| connection.name.clone())
                .unwrap_or_else(|| connection.path.clone());
            let name = connection.name.clone().unwrap_or_else(|| key.clone());
            let mut extra_params = BTreeMap::new();
            if let Some(tls) = connection.tls {
                extra_params.insert("tls".to_string(), tls.to_string());
            }

            records.push(ImportRecord {
                id: format!("redis-desktop:{}", slug(&key)),
                importer_id: "redis-desktop".to_string(),
                source_label: "Redis Desktop".to_string(),
                source_id: Some(format!("{path}:{}", connection.path)),
                kind: "database".to_string(),
                display_name: name.clone(),
                database: Some(DatabaseImportRecord {
                    database_type: serde_json::json!({ "external": { "id": "redis" } }),
                    name,
                    host: connection.host,
                    port: connection.port,
                    username: connection.username.unwrap_or_default(),
                    password: None,
                    database: connection.database,
                    extra_params,
                }),
                ssh: None,
                port_forwarding: None,
                password_status: "unsupported".to_string(),
                warnings: Vec::new(),
            });
        }
    }
    records
}

fn collect_connections(value: &Value) -> Vec<RedisConnection> {
    let mut out = Vec::new();
    collect_connections_at(value, "", &mut out);
    out
}

fn collect_connections_at(value: &Value, path: &str, out: &mut Vec<RedisConnection>) {
    match value {
        Value::Object(map) => {
            if let Some(host) = text_field(value, &["host", "hostname", "address"]) {
                out.push(RedisConnection {
                    path: path.to_string(),
                    id: text_field(value, &["id", "uuid"]),
                    name: text_field(value, &["name", "label", "title"]),
                    host,
                    port: port_field(value, &["port"]),
                    username: text_field(value, &["username", "user"]),
                    database: text_field(value, &["db", "database", "databaseIndex"])
                        .or_else(|| number_field(value, &["db", "database", "databaseIndex"])),
                    tls: bool_field(value, &["tls", "ssl", "useTLS", "useSsl"]),
                });
                return;
            }
            for (key, child) in map {
                let child_path = if path.is_empty() {
                    key.to_string()
                } else {
                    format!("{path}/{key}")
                };
                collect_connections_at(child, &child_path, out);
            }
        }
        Value::Array(items) => {
            for (index, child) in items.iter().enumerate() {
                let child_path = if path.is_empty() {
                    index.to_string()
                } else {
                    format!("{path}/{index}")
                };
                collect_connections_at(child, &child_path, out);
            }
        }
        _ => {}
    }
}

fn text_field(value: &Value, keys: &[&str]) -> Option<String> {
    let object = value.as_object()?;
    keys.iter().find_map(|key| {
        object
            .iter()
            .find(|(candidate, _)| candidate.eq_ignore_ascii_case(key))
            .and_then(|(_, value)| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    })
}

fn number_field(value: &Value, keys: &[&str]) -> Option<String> {
    let object = value.as_object()?;
    keys.iter().find_map(|key| {
        object
            .iter()
            .find(|(candidate, _)| candidate.eq_ignore_ascii_case(key))
            .and_then(|(_, value)| value.as_u64())
            .map(|value| value.to_string())
    })
}

fn port_field(value: &Value, keys: &[&str]) -> Option<u16> {
    let object = value.as_object()?;
    keys.iter().find_map(|key| {
        let value = object
            .iter()
            .find(|(candidate, _)| candidate.eq_ignore_ascii_case(key))?
            .1;
        match value {
            Value::Number(number) => number.as_u64().and_then(|port| u16::try_from(port).ok()),
            Value::String(text) => text.trim().parse::<u16>().ok(),
            _ => None,
        }
    })
}

fn bool_field(value: &Value, keys: &[&str]) -> Option<bool> {
    let object = value.as_object()?;
    keys.iter().find_map(|key| {
        object
            .iter()
            .find(|(candidate, _)| candidate.eq_ignore_ascii_case(key))
            .and_then(|(_, value)| value.as_bool())
    })
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
        "connection".to_string()
    } else {
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_redis_store_json_without_passwords() {
        let json = br#"{
          "connections": [
            {
              "id": "redis-prod",
              "name": "Prod Redis",
              "host": "redis.example.test",
              "port": 6380,
              "username": "default",
              "password": "secret",
              "db": 2,
              "tls": true
            }
          ]
        }"#;

        let records = preview_records_from_store_files(
            vec![("store.json".to_string(), json.as_slice())],
            true,
        );

        assert_eq!(1, records.len());
        let record = &records[0];
        assert_eq!("redis-desktop:redis-prod", record.id);
        assert_eq!("redis-desktop", record.importer_id);
        assert_eq!("Redis Desktop", record.source_label);
        assert_eq!(
            Some("store.json:connections/0"),
            record.source_id.as_deref()
        );
        assert_eq!("database", record.kind);
        assert_eq!("Prod Redis", record.display_name);
        assert_eq!("unsupported", record.password_status);
        let database = record.database.as_ref().unwrap();
        assert_eq!(
            serde_json::json!({ "external": { "id": "redis" } }),
            database.database_type
        );
        assert_eq!("redis.example.test", database.host);
        assert_eq!(Some(6380), database.port);
        assert_eq!("default", database.username);
        assert_eq!(Some("2"), database.database.as_deref());
        assert!(database.password.is_none());
        assert_eq!(
            Some("true"),
            database.extra_params.get("tls").map(String::as_str)
        );
    }
}
