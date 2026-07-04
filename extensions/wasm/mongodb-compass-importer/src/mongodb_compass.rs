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
struct CompassConnection {
    id: Option<String>,
    name: Option<String>,
    uri: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct MongoUri {
    scheme: String,
    username: Option<String>,
    host: String,
    port: Option<u16>,
    database: Option<String>,
    query: Option<String>,
}

pub fn preview_records_from_connection_files<'a, I>(
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
            let Some(uri) = parse_mongo_uri(&connection.uri) else {
                continue;
            };
            let key = connection
                .id
                .clone()
                .unwrap_or_else(|| file_stem(&path).to_string());
            let name = connection.name.clone().unwrap_or_else(|| key.clone());
            let mut extra_params = BTreeMap::new();
            extra_params.insert("connection_string".to_string(), sanitize_uri(&uri));

            records.push(ImportRecord {
                id: format!("mongodb-compass:{}", slug(&key)),
                importer_id: "mongodb-compass".to_string(),
                source_label: "MongoDB Compass".to_string(),
                source_id: Some(path.clone()),
                kind: "database".to_string(),
                display_name: name.clone(),
                database: Some(DatabaseImportRecord {
                    database_type: serde_json::json!({ "external": { "id": "mongodb" } }),
                    name,
                    host: uri.host,
                    port: uri.port,
                    username: uri.username.unwrap_or_default(),
                    password: None,
                    database: uri.database,
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

fn collect_connections(value: &Value) -> Vec<CompassConnection> {
    let mut out = Vec::new();
    collect_connections_from_value(value, &mut out);
    out
}

fn collect_connections_from_value(value: &Value, out: &mut Vec<CompassConnection>) {
    match value {
        Value::Object(map) => {
            if let Some(uri) = find_connection_uri(value) {
                out.push(CompassConnection {
                    id: find_string_field(value, &["id", "uuid"]),
                    name: find_string_field(value, &["name", "title"]).or_else(|| {
                        value
                            .get("favorite")
                            .and_then(|favorite| find_string_field(favorite, &["name", "title"]))
                    }),
                    uri,
                });
                return;
            }
            for child in map.values() {
                collect_connections_from_value(child, out);
            }
        }
        Value::Array(items) => {
            for child in items {
                collect_connections_from_value(child, out);
            }
        }
        _ => {}
    }
}

fn find_connection_uri(value: &Value) -> Option<String> {
    find_string_field(value, &["connectionString", "connection_string", "uri"]).or_else(|| {
        value
            .get("connectionOptions")
            .and_then(|connection_options| {
                find_string_field(
                    connection_options,
                    &["connectionString", "connection_string", "uri"],
                )
            })
    })
}

fn find_string_field(value: &Value, keys: &[&str]) -> Option<String> {
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

fn parse_mongo_uri(uri: &str) -> Option<MongoUri> {
    let (scheme, rest) = uri.split_once("://")?;
    if !matches!(scheme, "mongodb" | "mongodb+srv") {
        return None;
    }
    let (authority_and_path, query) = rest.split_once('?').map_or((rest, None), |(left, right)| {
        (left, Some(right.to_string()))
    });
    let (authority, database) = authority_and_path
        .split_once('/')
        .map_or((authority_and_path, None), |(left, right)| {
            (left, non_empty(right.split('/').next().unwrap_or_default()))
        });
    let (userinfo, hosts) = authority
        .rsplit_once('@')
        .map_or((None, authority), |(userinfo, hosts)| {
            (Some(userinfo), hosts)
        });
    let username = userinfo
        .and_then(|value| {
            value
                .split_once(':')
                .map_or(Some(value), |(name, _)| Some(name))
        })
        .and_then(percent_decode);
    let first_host = hosts.split(',').next()?.trim();
    let (host, port) = split_host_port(first_host);
    if host.is_empty() {
        return None;
    }
    Some(MongoUri {
        scheme: scheme.to_string(),
        username,
        host: host.to_string(),
        port,
        database,
        query,
    })
}

fn sanitize_uri(uri: &MongoUri) -> String {
    let mut out = format!("{}://", uri.scheme);
    if let Some(username) = uri.username.as_deref().filter(|value| !value.is_empty()) {
        out.push_str(&percent_encode_userinfo(username));
        out.push('@');
    }
    out.push_str(&uri.host);
    if let Some(port) = uri.port {
        out.push(':');
        out.push_str(&port.to_string());
    }
    if let Some(database) = uri.database.as_deref().filter(|value| !value.is_empty()) {
        out.push('/');
        out.push_str(database);
    }
    if let Some(query) = uri.query.as_deref().filter(|value| !value.is_empty()) {
        out.push('?');
        out.push_str(query);
    }
    out
}

fn split_host_port(value: &str) -> (&str, Option<u16>) {
    let value = value.trim();
    let Some((host, port)) = value.rsplit_once(':') else {
        return (value, None);
    };
    match port.parse::<u16>() {
        Ok(port) => (host.trim_matches(['[', ']']), Some(port)),
        Err(_) => (value.trim_matches(['[', ']']), None),
    }
}

fn non_empty(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(hex) = std::str::from_utf8(&bytes[index + 1..index + 3]) {
                if let Ok(byte) = u8::from_str_radix(hex, 16) {
                    out.push(byte);
                    index += 3;
                    continue;
                }
            }
        }
        out.push(bytes[index]);
        index += 1;
    }
    String::from_utf8(out).ok()
}

fn percent_encode_userinfo(value: &str) -> String {
    let mut out = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

fn file_stem(path: &str) -> &str {
    path.rsplit(['/', '\\'])
        .next()
        .unwrap_or(path)
        .split('.')
        .next()
        .unwrap_or("connection")
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
    fn parses_compass_connection_json_and_sanitizes_uri_password() {
        let json = br#"{
          "id": "favorite-1",
          "favorite": { "name": "Prod Mongo" },
          "connectionOptions": {
            "connectionString": "mongodb://mongo-user:secret@mongo.example.test:27018/app?authSource=admin"
          }
        }"#;

        let records = preview_records_from_connection_files(
            vec![("Connections/favorite-1.json".to_string(), json.as_slice())],
            true,
        );

        assert_eq!(1, records.len());
        let record = &records[0];
        assert_eq!("mongodb-compass:favorite-1", record.id);
        assert_eq!("mongodb-compass", record.importer_id);
        assert_eq!("MongoDB Compass", record.source_label);
        assert_eq!(
            Some("Connections/favorite-1.json"),
            record.source_id.as_deref()
        );
        assert_eq!("database", record.kind);
        assert_eq!("Prod Mongo", record.display_name);
        assert_eq!("unsupported", record.password_status);
        let database = record.database.as_ref().unwrap();
        assert_eq!(
            serde_json::json!({ "external": { "id": "mongodb" } }),
            database.database_type
        );
        assert_eq!("mongo.example.test", database.host);
        assert_eq!(Some(27018), database.port);
        assert_eq!("mongo-user", database.username);
        assert_eq!(Some("app"), database.database.as_deref());
        assert!(database.password.is_none());
        assert_eq!(
            Some("mongodb://mongo-user@mongo.example.test:27018/app?authSource=admin"),
            database
                .extra_params
                .get("connection_string")
                .map(String::as_str)
        );
    }
}
