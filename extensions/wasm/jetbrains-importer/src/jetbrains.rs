use quick_xml::{Reader, escape::unescape, events::Event};
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

#[derive(Clone, Debug, Default)]
struct DataSource {
    name: Option<String>,
    uuid: Option<String>,
    driver_ref: Option<String>,
    jdbc_url: Option<String>,
    username: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct JdbcParts {
    database_type: String,
    host: String,
    port: Option<u16>,
    database: Option<String>,
}

pub fn preview_records_from_xml_files<'a, I>(
    files: I,
    _include_passwords: bool,
) -> Vec<ImportRecord>
where
    I: IntoIterator<Item = (String, &'a [u8])>,
{
    let mut records = Vec::new();
    for (path, bytes) in files {
        let Ok(text) = std::str::from_utf8(bytes) else {
            continue;
        };
        for source in parse_data_sources(text) {
            let Some(jdbc_url) = source.jdbc_url.as_deref() else {
                continue;
            };
            let Some(parts) = parse_jdbc_url(jdbc_url, source.driver_ref.as_deref()) else {
                continue;
            };
            let source_key = source.uuid.as_deref().unwrap_or_else(|| {
                source
                    .name
                    .as_deref()
                    .filter(|value| !value.is_empty())
                    .unwrap_or("data-source")
            });
            let name = source
                .name
                .clone()
                .unwrap_or_else(|| source_key.to_string());
            records.push(ImportRecord {
                id: format!("jetbrains:{}-{}", slug(&file_stem(&path)), slug(source_key)),
                importer_id: "jetbrains".to_string(),
                source_label: "JetBrains".to_string(),
                source_id: Some(format!("{path}:{source_key}")),
                kind: "database".to_string(),
                display_name: name.clone(),
                database: Some(DatabaseImportRecord {
                    database_type: parts.database_type,
                    name,
                    host: parts.host,
                    port: parts.port,
                    username: source.username.unwrap_or_default(),
                    password: None,
                    database: parts.database,
                    extra_params: BTreeMap::new(),
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

fn parse_data_sources(text: &str) -> Vec<DataSource> {
    let mut reader = Reader::from_str(text);
    reader.config_mut().trim_text(true);
    let mut current = None::<DataSource>;
    let mut current_tag = None::<String>;
    let mut out = Vec::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) => {
                let tag = tag_name(event.name().as_ref());
                if tag == "data-source" {
                    let mut source = DataSource::default();
                    for attr in event.attributes().flatten() {
                        let key = tag_name(attr.key.as_ref());
                        let Ok(value) = attr.decode_and_unescape_value(reader.decoder()) else {
                            continue;
                        };
                        match key.as_str() {
                            "name" => source.name = Some(value.into_owned()),
                            "uuid" => source.uuid = Some(value.into_owned()),
                            _ => {}
                        }
                    }
                    current = Some(source);
                    current_tag = None;
                } else if current.is_some() {
                    current_tag = Some(tag);
                }
            }
            Ok(Event::Text(text)) => {
                let Some(source) = current.as_mut() else {
                    continue;
                };
                let Some(tag) = current_tag.as_deref() else {
                    continue;
                };
                let Ok(decoded) = text.decode() else {
                    continue;
                };
                let value = unescape(&decoded)
                    .map(|value| value.into_owned())
                    .unwrap_or_else(|_| decoded.into_owned());
                let value = value.trim();
                if value.is_empty() {
                    continue;
                }
                match tag {
                    "driver-ref" => source.driver_ref = Some(value.to_string()),
                    "jdbc-url" => source.jdbc_url = Some(value.to_string()),
                    "user-name" | "username" => source.username = Some(value.to_string()),
                    _ => {}
                }
            }
            Ok(Event::End(event)) => {
                let tag = tag_name(event.name().as_ref());
                if tag == "data-source" {
                    if let Some(source) = current.take() {
                        out.push(source);
                    }
                }
                current_tag = None;
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
    }

    out
}

fn parse_jdbc_url(url: &str, driver_ref: Option<&str>) -> Option<JdbcParts> {
    let database_type =
        database_type_from_jdbc(url).or_else(|| driver_ref.and_then(database_type))?;
    if database_type == "sqlite" {
        let path = url.strip_prefix("jdbc:sqlite:")?.to_string();
        return Some(JdbcParts {
            database_type,
            host: path.clone(),
            port: None,
            database: Some(path),
        });
    }

    if let Some(rest) = url.strip_prefix("jdbc:sqlserver://") {
        let rest = rest.split('?').next().unwrap_or(rest);
        let (host_port, params) = rest.split_once(';').unwrap_or((rest, ""));
        let (host, port) = split_host_port(host_port);
        return Some(JdbcParts {
            database_type,
            host: host.to_string(),
            port,
            database: semicolon_param(params, "databaseName"),
        });
    }

    if let Some(rest) = url.strip_prefix("jdbc:oracle:thin:@//") {
        let rest = rest.split('?').next().unwrap_or(rest);
        let (host_port, database) = rest.split_once('/').unwrap_or((rest, ""));
        let (host, port) = split_host_port(host_port);
        return Some(JdbcParts {
            database_type,
            host: host.to_string(),
            port,
            database: non_empty(database),
        });
    }

    let rest = url.strip_prefix("jdbc:")?;
    let (_, rest) = rest.split_once("://")?;
    let rest = rest.split('?').next().unwrap_or(rest);
    let (host_port, database) = rest.split_once('/').unwrap_or((rest, ""));
    let (host, port) = split_host_port(host_port);
    Some(JdbcParts {
        database_type,
        host: host.to_string(),
        port,
        database: non_empty(database),
    })
}

fn database_type_from_jdbc(url: &str) -> Option<String> {
    let rest = url.strip_prefix("jdbc:")?;
    let family = rest.split([':', '/']).next().unwrap_or_default().trim();
    database_type(family)
}

fn database_type(raw: &str) -> Option<String> {
    let normalized = raw
        .trim()
        .to_ascii_lowercase()
        .replace([' ', '-', '.'], "_");
    match normalized.as_str() {
        "mysql" | "mysql_8" | "mariadb" => Some("my_sql".to_string()),
        "postgres" | "postgresql" | "pgsql" => Some("postgre_sql".to_string()),
        "sqlite" | "sqlite3" => Some("sqlite".to_string()),
        "duckdb" => Some("duck_db".to_string()),
        "sqlserver" | "sql_server" | "mssql" => Some("sql_server".to_string()),
        "oracle" | "oracle_thin" => Some("oracle".to_string()),
        "clickhouse" | "click_house" => Some("click_house".to_string()),
        _ => None,
    }
}

fn split_host_port(value: &str) -> (&str, Option<u16>) {
    let Some((host, port)) = value.rsplit_once(':') else {
        return (value, None);
    };
    match port.parse::<u16>() {
        Ok(port) => (host, Some(port)),
        Err(_) => (value, None),
    }
}

fn semicolon_param(params: &str, key: &str) -> Option<String> {
    params.split(';').find_map(|part| {
        let (candidate, value) = part.split_once('=')?;
        candidate
            .eq_ignore_ascii_case(key)
            .then(|| value.trim().to_string())
            .filter(|value| !value.is_empty())
    })
}

fn non_empty(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_string())
}

fn tag_name(bytes: &[u8]) -> String {
    std::str::from_utf8(bytes)
        .unwrap_or_default()
        .rsplit(':')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase()
}

fn file_stem(path: &str) -> String {
    path.replace(".xml", "")
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
    fn parses_datagrip_data_sources_xml_without_passwords() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<application>
  <component name="DataSourceManagerImpl" format="xml">
    <data-source source="LOCAL" name="Prod MySQL" uuid="mysql-prod">
      <driver-ref>mysql.8</driver-ref>
      <jdbc-url>jdbc:mysql://db.example.test:3307/app</jdbc-url>
      <user-name>root</user-name>
      <password>secret</password>
    </data-source>
  </component>
</application>"#;

        let records = preview_records_from_xml_files(
            vec![(
                "DataGrip2024.3/options/dataSources.xml".to_string(),
                xml.as_slice(),
            )],
            true,
        );

        assert_eq!(1, records.len());
        let record = &records[0];
        assert_eq!(
            "jetbrains:datagrip2024-3-options-datasources-mysql-prod",
            record.id
        );
        assert_eq!("jetbrains", record.importer_id);
        assert_eq!("JetBrains", record.source_label);
        assert_eq!(
            Some("DataGrip2024.3/options/dataSources.xml:mysql-prod"),
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
