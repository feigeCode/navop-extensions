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
    pub database_type: String,
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

pub fn preview_records_from_files<'a, I>(files: I, _include_passwords: bool) -> Vec<ImportRecord>
where
    I: IntoIterator<Item = (String, &'a [u8])>,
{
    let mut records = Vec::new();
    for (path, bytes) in files {
        let Some(value) = parse_structured(bytes) else {
            continue;
        };
        collect_records(&path, "", &value, &mut records);
    }
    records
}

fn parse_structured(bytes: &[u8]) -> Option<Value> {
    serde_json::from_slice(bytes).ok().or_else(|| {
        plist::Value::from_reader_xml(bytes)
            .ok()
            .and_then(|value| serde_json::to_value(value).ok())
    })
}

fn collect_records(path: &str, key_path: &str, value: &Value, records: &mut Vec<ImportRecord>) {
    if let Some(record) = record_from_value(path, key_path, value) {
        records.push(record);
    }
    match value {
        Value::Object(map) => {
            for (key, child) in map {
                let child_path = if key_path.is_empty() {
                    key.to_string()
                } else {
                    format!("{key_path}/{key}")
                };
                collect_records(path, &child_path, child, records);
            }
        }
        Value::Array(items) => {
            for (index, child) in items.iter().enumerate() {
                let child_path = if key_path.is_empty() {
                    index.to_string()
                } else {
                    format!("{key_path}/{index}")
                };
                collect_records(path, &child_path, child, records);
            }
        }
        _ => {}
    }
}

fn record_from_value(path: &str, key_path: &str, value: &Value) -> Option<ImportRecord> {
    let raw_type = text_field(
        value,
        &["driver", "type", "databaseType", "adapter", "engine"],
    )?;
    let database_type = database_type(&raw_type)?;
    let host = text_field(value, &["host", "hostname", "server", "address", "path"])
        .or_else(|| text_field(value, &["databasePath", "databaseFile"]))
        .unwrap_or_default();
    if host.is_empty() && database_type != "sqlite" {
        return None;
    }
    let source_id = if key_path.is_empty() {
        path.to_string()
    } else {
        format!("{path}:{key_path}")
    };
    let record_key = text_field(value, &["id", "uuid"])
        .unwrap_or_else(|| key_path.rsplit('/').next().unwrap_or(path).to_string());
    let name = text_field(value, &["name", "title", "displayName", "connectionName"])
        .unwrap_or_else(|| record_key.clone());

    Some(ImportRecord {
        id: format!("tableplus:{}-{}", slug(&file_stem(path)), slug(&record_key)),
        importer_id: "tableplus".to_string(),
        source_label: "TablePlus".to_string(),
        source_id: Some(source_id),
        kind: "database".to_string(),
        display_name: name.clone(),
        database: Some(DatabaseImportRecord {
            database_type,
            name,
            host,
            port: port_field(value, &["port"]),
            username: text_field(value, &["user", "username", "userName", "uid"])
                .unwrap_or_default(),
            password: None,
            database: text_field(value, &["database", "databaseName", "schema"]),
            extra_params: BTreeMap::new(),
        }),
        ssh: None,
        port_forwarding: None,
        password_status: "unsupported".to_string(),
        warnings: Vec::new(),
    })
}

fn text_field(value: &Value, keys: &[&str]) -> Option<String> {
    let object = value.as_object()?;
    keys.iter().find_map(|key| {
        object
            .iter()
            .find(|(candidate, _)| candidate.eq_ignore_ascii_case(key))
            .and_then(|(_, value)| value_as_text(value))
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    })
}

fn value_as_text(value: &Value) -> Option<&str> {
    match value {
        Value::String(text) => Some(text),
        _ => None,
    }
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

fn database_type(raw: &str) -> Option<String> {
    let normalized = raw
        .trim()
        .to_ascii_lowercase()
        .replace([' ', '-', '.'], "_");
    match normalized.as_str() {
        "mysql" | "mariadb" => Some("my_sql".to_string()),
        "postgres" | "postgresql" | "pgsql" => Some("postgre_sql".to_string()),
        "sqlite" | "sqlite3" => Some("sqlite".to_string()),
        "duckdb" => Some("duck_db".to_string()),
        "sqlserver" | "sql_server" | "mssql" => Some("sql_server".to_string()),
        "oracle" => Some("oracle".to_string()),
        "clickhouse" | "click_house" => Some("click_house".to_string()),
        _ => None,
    }
}

fn file_stem(path: &str) -> String {
    let file = path.rsplit(['/', '\\']).next().unwrap_or(path);
    file.split('.').next().unwrap_or(file).to_string()
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
    fn parses_tableplus_json_export_without_passwords() {
        let json = br#"{
          "connections": [
            {
              "id": "pg-prod",
              "name": "Prod PostgreSQL",
              "driver": "PostgreSQL",
              "host": "pg.example.test",
              "port": 5433,
              "user": "deploy",
              "database": "app",
              "password": "plain-or-encrypted"
            }
          ]
        }"#;

        let records = preview_records_from_files(
            vec![("Connections.json".to_string(), json.as_slice())],
            true,
        );

        assert_eq!(1, records.len());
        let record = &records[0];
        assert_eq!("tableplus:connections-pg-prod", record.id);
        assert_eq!("tableplus", record.importer_id);
        assert_eq!("TablePlus", record.source_label);
        assert_eq!(
            Some("Connections.json:connections/0"),
            record.source_id.as_deref()
        );
        assert_eq!("database", record.kind);
        assert_eq!("Prod PostgreSQL", record.display_name);
        assert_eq!("unsupported", record.password_status);
        let database = record.database.as_ref().unwrap();
        assert_eq!("postgre_sql", database.database_type);
        assert_eq!("pg.example.test", database.host);
        assert_eq!(Some(5433), database.port);
        assert_eq!("deploy", database.username);
        assert_eq!(Some("app"), database.database.as_deref());
        assert!(database.password.is_none());
    }
}
