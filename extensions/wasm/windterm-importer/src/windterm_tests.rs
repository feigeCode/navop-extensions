use crate::windterm::{SshImportAuthMethod, preview_records_from_session_files};

const FIXTURE: &[u8] = include_bytes!("../fixtures/user.sessions.json");

#[test]
fn parses_windterm_ssh_sessions_and_skips_local_shells() {
    let records = preview_records_from_session_files(
        vec![(
            "~/.wind/profiles/default.v10/terminal/user.sessions".to_string(),
            FIXTURE,
        )],
        false,
    );

    assert_eq!(3, records.len());

    let password_record = &records[0];
    assert_eq!(
        "windterm:11111111-2222-3333-4444-555555555555",
        password_record.id
    );
    assert_eq!("windterm", password_record.importer_id);
    assert_eq!("WindTerm", password_record.source_label);
    assert_eq!(
        Some("11111111-2222-3333-4444-555555555555"),
        password_record.source_id.as_deref()
    );
    assert_eq!("ssh", password_record.kind);
    assert_eq!("Production API", password_record.display_name);
    assert_eq!("unsupported", password_record.password_status);
    assert!(
        password_record
            .warnings
            .iter()
            .any(|warning| { warning.code == "windterm_encrypted_auto_login" })
    );
    let ssh = password_record.ssh.as_ref().unwrap();
    assert_eq!("api.example.test", ssh.host);
    assert_eq!(Some(2202), ssh.port);
    assert_eq!("deploy", ssh.username);
    assert_eq!(
        SshImportAuthMethod::Password { password: None },
        ssh.auth_method
    );

    let key_record = &records[1];
    let key_ssh = key_record.ssh.as_ref().unwrap();
    assert_eq!("2001:db8::10", key_ssh.host);
    assert_eq!(Some(2222), key_ssh.port);
    assert_eq!("ops", key_ssh.username);
    assert_eq!(
        SshImportAuthMethod::PrivateKey {
            key_path: "~/.ssh/windterm_ops".to_string(),
            passphrase: None,
        },
        key_ssh.auth_method
    );

    let host_only = &records[2];
    assert_eq!("host-only.example.test", host_only.display_name);
    assert_eq!("missing", host_only.password_status);
    assert!(
        host_only
            .warnings
            .iter()
            .any(|warning| { warning.code == "windterm_missing_username" })
    );
}

#[test]
fn never_returns_windterm_encrypted_auto_login_data() {
    let without_passwords =
        preview_records_from_session_files(vec![("user.sessions".to_string(), FIXTURE)], false);
    let with_passwords =
        preview_records_from_session_files(vec![("user.sessions".to_string(), FIXTURE)], true);

    assert_eq!(without_passwords, with_passwords);
    let json = serde_json::to_string(&with_passwords).unwrap();
    assert!(!json.contains("SCRUBBED-WINDTERM-AUTO-LOGIN-BLOB"));
}

#[test]
fn serializes_auth_methods_with_host_protocol_shape() {
    let records =
        preview_records_from_session_files(vec![("user.sessions".to_string(), FIXTURE)], false);
    let password = serde_json::to_value(&records[0]).unwrap();
    let private_key = serde_json::to_value(&records[1]).unwrap();
    let auto_public_key = serde_json::to_value(&records[2]).unwrap();

    assert_eq!(
        serde_json::json!({"password": {"password": null}}),
        password["ssh"]["auth_method"]
    );
    assert_eq!(
        serde_json::json!({
            "private_key": {
                "key_path": "~/.ssh/windterm_ops",
                "passphrase": null
            }
        }),
        private_key["ssh"]["auth_method"]
    );
    assert_eq!(
        serde_json::json!("auto_public_key"),
        auto_public_key["ssh"]["auth_method"]
    );
}

#[test]
fn ignores_empty_and_corrupt_session_files_without_panicking() {
    let records = preview_records_from_session_files(
        vec![
            ("empty.sessions".to_string(), b"[]".as_slice()),
            ("corrupt.sessions".to_string(), b"not-json".as_slice()),
        ],
        false,
    );

    assert!(records.is_empty());
}

#[test]
fn deduplicates_the_same_profile_loaded_from_discovery_and_manual_pick() {
    let records = preview_records_from_session_files(
        vec![
            ("discovered/user.sessions".to_string(), FIXTURE),
            ("manual/user.sessions".to_string(), FIXTURE),
        ],
        false,
    );

    assert_eq!(3, records.len());
}
