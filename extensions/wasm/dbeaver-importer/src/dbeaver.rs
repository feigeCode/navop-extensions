use std::collections::BTreeMap;

use aes::Aes128;
use cbc::cipher::{BlockDecryptMut, KeyIvInit, block_padding::Pkcs7};
use serde_json::Value;

use crate::{
    common::{database_type, owned_field, port_field, slug, str_field},
    model::{DatabaseImportRecord, ImportRecord},
};

pub fn preview_records(
    data_sources_json: &[u8],
    credentials_json: Option<&[u8]>,
    include_passwords: bool,
) -> Vec<ImportRecord> {
    let Ok(root) = serde_json::from_slice::<Value>(data_sources_json) else {
        return Vec::new();
    };
    let credentials = include_passwords
        .then(|| credentials_json.and_then(parse_credentials))
        .flatten();
    let Some(connections) = root.get("connections").and_then(Value::as_object) else {
        return Vec::new();
    };

    connections
        .iter()
        .filter_map(|(connection_id, connection)| {
            let config = connection.get("configuration").unwrap_or(connection);
            let raw_type = str_field(connection, &["provider", "driver", "type"])
                .or_else(|| str_field(config, &["provider", "driver", "type"]))?;
            let database_type = database_type(raw_type)?;
            let name = str_field(connection, &["name"])
                .or_else(|| str_field(config, &["name"]))
                .unwrap_or(connection_id)
                .to_string();
            let host = owned_field(config, &["host", "server", "hostname"]).unwrap_or_default();
            let username = owned_field(config, &["user", "username"]).unwrap_or_default();
            let password = if include_passwords {
                credentials
                    .as_ref()
                    .and_then(|credentials| credential_password(credentials, connection_id))
                    .or_else(|| owned_field(config, &["password"]))
            } else {
                None
            };
            let database = owned_field(config, &["database", "schema"]);
            let port = port_field(config, &["port"]);
            let password_status = if !include_passwords {
                "unsupported"
            } else if password.as_deref().unwrap_or_default().is_empty() {
                "missing"
            } else {
                "included"
            };

            Some(ImportRecord {
                id: format!("dbeaver:{}", slug(connection_id)),
                importer_id: "dbeaver".to_string(),
                source_label: "DBeaver".to_string(),
                kind: "database".to_string(),
                display_name: name.clone(),
                database: Some(DatabaseImportRecord {
                    database_type,
                    name,
                    host,
                    port,
                    username,
                    password,
                    database,
                    extra_params: BTreeMap::new(),
                }),
                ssh: None,
                password_status: password_status.to_string(),
                warnings: Vec::new(),
            })
        })
        .collect()
}

fn credential_password(credentials: &Value, connection_id: &str) -> Option<String> {
    let direct = credentials.get(connection_id)?;
    str_field(direct.get("#connection").unwrap_or(direct), &["password"]).map(ToOwned::to_owned)
}

fn parse_credentials(bytes: &[u8]) -> Option<Value> {
    serde_json::from_slice::<Value>(bytes).ok().or_else(|| {
        decrypt_credentials(bytes).and_then(|plain| serde_json::from_slice(&plain).ok())
    })
}

fn decrypt_credentials(bytes: &[u8]) -> Option<Vec<u8>> {
    type Decryptor = cbc::Decryptor<Aes128>;
    const KEY: [u8; 16] = [
        0xba, 0xbb, 0x4a, 0x9f, 0x77, 0x4a, 0xb8, 0x53, 0xc9, 0x6c, 0x2d, 0x65, 0x3d, 0x2a, 0x02,
        0x9c,
    ];
    if bytes.len() <= 16 {
        return None;
    }
    let (iv, ciphertext) = bytes.split_at(16);
    Decryptor::new(&KEY.into(), iv.into())
        .decrypt_padded_vec_mut::<Pkcs7>(ciphertext)
        .ok()
}

#[cfg(test)]
mod tests {
    use super::preview_records;
    use aes::Aes128;
    use cbc::cipher::{BlockEncryptMut, KeyIvInit, block_padding::Pkcs7};

    #[test]
    fn parses_mysql_data_source_and_password_credentials() {
        let data_sources = br#"{
          "connections": {
            "mysql-prod": {
              "provider": "mysql",
              "name": "Prod MySQL",
              "configuration": {
                "host": "db.example.com",
                "port": "3307",
                "database": "app",
                "user": "root"
              }
            }
          }
        }"#;
        let credentials = br##"{
          "mysql-prod": {
            "#connection": {
              "password": "secret"
            }
          }
        }"##;

        let records = preview_records(data_sources, Some(credentials), true);

        assert_eq!(1, records.len());
        let record = &records[0];
        assert_eq!("dbeaver:mysql-prod", record.id);
        assert_eq!("DBeaver", record.source_label);
        assert_eq!("database", record.kind);
        assert_eq!("Prod MySQL", record.display_name);
        assert_eq!("included", record.password_status);
        let database = record.database.as_ref().unwrap();
        assert_eq!("my_sql", database.database_type);
        assert_eq!("db.example.com", database.host);
        assert_eq!(Some(3307), database.port);
        assert_eq!("root", database.username);
        assert_eq!(Some("secret"), database.password.as_deref());
        assert_eq!(Some("app"), database.database.as_deref());
    }

    #[test]
    fn decrypts_dbeaver_credentials_config() {
        let data_sources = br#"{
          "connections": {
            "pg-prod": {
              "provider": "postgresql",
              "name": "Prod PostgreSQL",
              "configuration": {
                "host": "pg.example.com",
                "port": "5432",
                "database": "app",
                "user": "deploy"
              }
            }
          }
        }"#;
        let encrypted = encrypted_credentials(
            br##"{
          "pg-prod": {
            "#connection": {
              "password": "encrypted-secret"
            }
          }
        }"##,
        );

        let records = preview_records(data_sources, Some(&encrypted), true);

        assert_eq!(1, records.len());
        let database = records[0].database.as_ref().unwrap();
        assert_eq!("postgre_sql", database.database_type);
        assert_eq!(Some("encrypted-secret"), database.password.as_deref());
        assert_eq!("included", records[0].password_status);
    }

    #[test]
    fn omits_plaintext_config_password_when_password_import_is_disabled() {
        let data_sources = br#"{
          "connections": {
            "mysql-local": {
              "provider": "mysql",
              "name": "Local MySQL",
              "configuration": {
                "host": "localhost",
                "port": "3306",
                "database": "app",
                "user": "root",
                "password": "plain-secret"
              }
            }
          }
        }"#;

        let records = preview_records(data_sources, None, false);

        assert_eq!(1, records.len());
        let database = records[0].database.as_ref().unwrap();
        assert_eq!(None, database.password.as_deref());
        assert_eq!("unsupported", records[0].password_status);
    }

    fn encrypted_credentials(plain: &[u8]) -> Vec<u8> {
        type Encryptor = cbc::Encryptor<Aes128>;
        const KEY: [u8; 16] = [
            0xba, 0xbb, 0x4a, 0x9f, 0x77, 0x4a, 0xb8, 0x53, 0xc9, 0x6c, 0x2d, 0x65, 0x3d, 0x2a,
            0x02, 0x9c,
        ];
        let iv = [7u8; 16];
        let mut out = iv.to_vec();
        out.extend(Encryptor::new(&KEY.into(), &iv.into()).encrypt_padded_vec_mut::<Pkcs7>(plain));
        out
    }
}
