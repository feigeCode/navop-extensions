use plist::{Dictionary, Value};
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

pub fn preview_records_from_plists<'a, I>(plists: I, _include_passwords: bool) -> Vec<ImportRecord>
where
    I: IntoIterator<Item = (String, &'a [u8])>,
{
    let mut records = Vec::new();
    for (path, bytes) in plists {
        let Ok(value) = Value::from_reader_xml(bytes) else {
            continue;
        };
        collect_records(&path, "", &value, &mut records);
    }
    records
}

fn collect_records(path: &str, key_path: &str, value: &Value, records: &mut Vec<ImportRecord>) {
    let Some(dict) = value.as_dictionary() else {
        return;
    };
    if let Some(record) = record_from_dict(path, key_path, dict) {
        records.push(record);
    }
    for (key, child) in dict {
        let child_path = if key_path.is_empty() {
            key.to_string()
        } else {
            format!("{key_path}/{key}")
        };
        collect_records(path, &child_path, child, records);
    }
}

fn record_from_dict(path: &str, key_path: &str, dict: &Dictionary) -> Option<ImportRecord> {
    let raw_type = text_field(
        dict,
        &["ConnType", "Type", "DatabaseType", "DBType", "Driver"],
    )?;
    let database_type = database_type(&raw_type)?;
    let host = text_field(dict, &["Host", "Hostname", "Server", "IP", "SocketHost"])
        .or_else(|| text_field(dict, &["DatabaseFile", "FilePath"]))
        .unwrap_or_default();
    if host.is_empty() && database_type != "sqlite" {
        return None;
    }
    let source_id = if key_path.is_empty() {
        path.to_string()
    } else {
        format!("{path}:{key_path}")
    };
    let fallback_name = key_path
        .rsplit('/')
        .next()
        .filter(|value| !value.is_empty())
        .unwrap_or(path);
    let id_seed = if key_path.is_empty() {
        path.to_string()
    } else {
        format!("{path}:{fallback_name}")
    };
    let name = text_field(dict, &["Name", "Title", "ConnectionName", "DisplayName"])
        .unwrap_or_else(|| fallback_name.to_string());

    Some(ImportRecord {
        id: format!("navicat:{}", slug(&id_seed)),
        importer_id: "navicat".to_string(),
        source_label: "Navicat".to_string(),
        source_id: Some(source_id),
        kind: "database".to_string(),
        display_name: name.clone(),
        database: Some(DatabaseImportRecord {
            database_type,
            name,
            host,
            port: port_field(dict, &["Port"]),
            username: text_field(dict, &["UserName", "Username", "User", "UID"])
                .unwrap_or_default(),
            password: None,
            database: text_field(
                dict,
                &["Database", "DatabaseName", "InitialDatabase", "Schema"],
            ),
            extra_params: BTreeMap::new(),
        }),
        ssh: None,
        port_forwarding: None,
        password_status: "unsupported".to_string(),
        warnings: Vec::new(),
    })
}

fn text_field(dict: &Dictionary, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        dict.get(*key)
            .and_then(value_text)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    })
}

fn value_text(value: &Value) -> Option<&str> {
    match value {
        Value::String(text) => Some(text),
        _ => None,
    }
}

fn port_field(dict: &Dictionary, keys: &[&str]) -> Option<u16> {
    keys.iter().find_map(|key| match dict.get(*key) {
        Some(Value::Integer(_)) => dict
            .get(*key)
            .and_then(Value::as_unsigned_integer)
            .and_then(|port| u16::try_from(port).ok()),
        Some(Value::String(text)) => text.trim().parse::<u16>().ok(),
        _ => None,
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
        "oracle" | "oci" => Some("oracle".to_string()),
        "sqlserver" | "sql_server" | "mssql" => Some("sql_server".to_string()),
        _ => None,
    }
}

fn slug(value: &str) -> String {
    let stem = value.replace(".plist", "");
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
        "connection".to_string()
    } else {
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_navicat_mysql_server_from_preferences_plist_without_passwords() {
        let plist = br#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Servers</key>
  <dict>
    <key>mysql-prod</key>
    <dict>
      <key>Name</key><string>Prod MySQL</string>
      <key>ConnType</key><string>MYSQL</string>
      <key>Host</key><string>db.example.test</string>
      <key>Port</key><integer>3307</integer>
      <key>UserName</key><string>root</string>
      <key>Database</key><string>app</string>
      <key>Password</key><string>encrypted-secret</string>
    </dict>
  </dict>
</dict>
</plist>"#;

        let records = preview_records_from_plists(
            vec![(
                "com.prect.NavicatPremium.plist".to_string(),
                plist.as_slice(),
            )],
            true,
        );

        assert_eq!(1, records.len());
        let record = &records[0];
        assert_eq!("navicat:com-prect-navicatpremium-mysql-prod", record.id);
        assert_eq!("navicat", record.importer_id);
        assert_eq!("Navicat", record.source_label);
        assert_eq!(
            Some("com.prect.NavicatPremium.plist:Servers/mysql-prod"),
            record.source_id.as_deref()
        );
        assert_eq!("database", record.kind);
        assert_eq!("Prod MySQL", record.display_name);
        assert_eq!("unsupported", record.password_status);
        let database = record.database.as_ref().unwrap();
        assert_eq!("my_sql", database.database_type);
        assert_eq!("db.example.test", database.host);
        assert_eq!(Some(3307), database.port);
        assert_eq!("root", database.username);
        assert_eq!(Some("app"), database.database.as_deref());
        assert!(database.password.is_none());
    }
}
