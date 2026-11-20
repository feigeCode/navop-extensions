use crate::windterm::{
    SshImportAuthMethod, TargetPlatform, parse_keymaps_text, parse_quickbar_bytes,
    parse_sessions_bytes, preview_records_from_session_files,
};

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
    assert_eq!(Some("Production".to_string()), ssh.group_path);
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

#[test]
fn parses_groups_jump_servers_windows_keys_quickbar_and_keymaps() {
    let sessions_json = r#"[
        {
            "session.group": "其他开发机",
            "session.label": "mine 101.89",
            "session.port": 22,
            "session.protocol": "SSH",
            "session.target": "user@192.168.101.89",
            "session.uuid": "6025bb00-1333-46f8-be58-586908a1f7a8",
            "session.autoLogin": "encrypted-blob"
        },
        {
            "session.group": "竞品卡或其他架构\\平台",
            "session.port": 22,
            "session.protocol": "SSH",
            "session.proxy": "socks5://127.0.0.1:1080",
            "session.proxyJumpServer1": "6025bb00-1333-46f8-be58-586908a1f7a8,mine 101.89",
            "session.target": "root@10.123.0.141",
            "session.uuid": "8134051c-e9e0-4d69-8dd1-be2a62fd38ca",
            "ssh.identityFilePath.windows": "~\\.ssh\\id_rsa.pub"
        }
    ]"#
    .as_bytes();
    let (records, _) = parse_sessions_bytes("user.sessions", sessions_json, TargetPlatform::Windows);
    assert_eq!(2, records.len());
    let second = records[1].ssh.as_ref().unwrap();
    assert_eq!(Some("竞品卡或其他架构/平台".to_string()), second.group_path);
    assert_eq!(
        SshImportAuthMethod::PrivateKey {
            key_path: "~/.ssh/id_rsa".to_string(),
            passphrase: None,
        },
        second.auth_method
    );
    let jump = second.jump_server.as_ref().unwrap();
    assert_eq!("192.168.101.89", jump.host);
    assert_eq!("user", jump.username);
    let proxy = second.proxy.as_ref().unwrap();
    assert_eq!("127.0.0.1", proxy.host);
    assert_eq!(1080, proxy.port);

    let quickbar_json = r#"[
        {
            "quick.group": "快速",
            "quick.label": "watch fps",
            "quick.text": "sudo watch -n 1 cat /sys/kernel/debug/mtvpu0/info\\n",
            "quick.uuid": "54ad536f"
        }
    ]"#
    .as_bytes();
    let quick_records = parse_quickbar_bytes(quickbar_json);
    assert_eq!(1, quick_records.len());
    assert_eq!("quick_command", quick_records[0].kind);
    assert_eq!(
        "sudo watch -n 1 cat /sys/kernel/debug/mtvpu0/info",
        quick_records[0].quick_command.as_ref().unwrap().command
    );

    let keymaps = r#"[
        { "keys": "<Ctrl+Shift+D>", "action": "Terminal.DuplicateSession" },
        { "keys": "<Meta+C>", "action": "Text.Copy" },
        { "keys": "<Ctrl+Shift+C>", "action": "Text.Copy" },
        { "keys": "<F11>", "action": "Window.ToggleFullScreen" }
    ]"#;
    let win_bindings = parse_keymaps_text(keymaps, false);
    assert_eq!(3, win_bindings.len());
    let dup = win_bindings
        .iter()
        .find(|r| r.keybinding.as_ref().is_some_and(|k| k.action_id == "app.duplicate_tab"))
        .unwrap();
    assert_eq!(vec!["ctrl-shift-d".to_string()], dup.keybinding.as_ref().unwrap().shortcuts);

    let discovered = crate::windterm::DiscoveredFiles {
        session_files: vec![crate::windterm::InputFile {
            candidate_id: "c1".to_string(),
            display_path: "user.sessions".to_string(),
            bytes: sessions_json.to_vec(),
        }],
        quickbar_files: vec![crate::windterm::InputFile {
            candidate_id: "c2".to_string(),
            display_path: "quickbar.config".to_string(),
            bytes: quickbar_json.to_vec(),
        }],
        keymap_files: vec![crate::windterm::InputFile {
            candidate_id: "c3".to_string(),
            display_path: "wind.keymaps".to_string(),
            bytes: keymaps.as_bytes().to_vec(),
        }],
    };

    let legacy_host_records = crate::windterm::preview_records_from_files(
        &discovered,
        TargetPlatform::Windows,
        false,
        false,
    );
    assert_eq!(3, legacy_host_records.len());
    assert!(legacy_host_records.iter().all(|r| r.kind != "keybinding"));

    let capable_host_records = crate::windterm::preview_records_from_files(
        &discovered,
        TargetPlatform::Windows,
        false,
        true,
    );
    assert_eq!(6, capable_host_records.len());
    assert_eq!(
        3,
        capable_host_records
            .iter()
            .filter(|r| r.kind == "keybinding")
            .count()
    );
}
