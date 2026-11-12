use crate::component::candidate_directory_prefix;
use crate::securecrt::{
    QuickCommandImportRecord, SourceKind, SshImportAuthMethod, append_workspace_records,
    classify_source, preview_records_from_sources, preview_records_from_sources_with_passphrase,
};

#[test]
fn preview_protocol_serializes_records_as_a_sequence() {
    let source = br#"S:"Hostname"=prod.example.test
S:"Protocol Name"=SSH2
S:"Username"=deploy
"#;
    let result = preview_records_from_sources(
        vec![("Sessions/Production/API.ini".into(), source.as_slice())],
        false,
    );

    let json = crate::component::serialize_preview_records(&result);
    let records: Vec<serde_json::Value> = serde_json::from_str(&json).unwrap();

    assert_eq!(records.len(), 1);
    assert_eq!(records[0]["kind"], "ssh");
    assert_eq!(records[0]["ssh"]["host"], "prod.example.test");
}

#[test]
fn parses_ini_and_omits_encrypted_password() {
    let source = br#"S:"Hostname"=prod.example.test
S:"Protocol Name"=SSH2
D:"[SSH2] Port"=00000016
S:"Username"=deploy
S:"Password V2"=02:deadbeef
"#;
    let result = preview_records_from_sources(
        vec![("Sessions/Production/API.ini".into(), source.as_slice())],
        true,
    );

    assert_eq!(result.records.len(), 1);
    let record = &result.records[0];
    assert!(
        record
            .id
            .starts_with("securecrt:sessions-production-api-ini:")
    );
    assert_eq!(record.password_status, "unsupported");
    assert!(!serde_json::to_string(record).unwrap().contains("deadbeef"));
    assert_eq!(record.ssh.as_ref().unwrap().port, Some(22));
    assert_eq!(
        record.ssh.as_ref().unwrap().auth_method,
        SshImportAuthMethod::Password { password: None }
    );
}

#[test]
fn parses_utf16_ini_and_identity_filename_v2() {
    let text = "S:\"Hostname\"=00000022 6500780061006d0070006c0065002e0063006f006d00\r\nS:\"Protocol Name\"=SSH1\r\nS:\"Username\"=deploy\r\nS:\"Identity Filename V2\"=/home/me/.ssh/id_ed25519\r\n";
    let bytes = utf16_le(text);
    let result = preview_records_from_sources(
        vec![("Sessions/utf16/Session.ini".into(), bytes.as_slice())],
        false,
    );

    let ssh = result.records[0].ssh.as_ref().unwrap();
    assert_eq!(ssh.host, "example.com");
    assert_eq!(ssh.port, Some(22));
    assert_eq!(
        ssh.auth_method,
        SshImportAuthMethod::PrivateKey {
            key_path: "/home/me/.ssh/id_ed25519".to_string(),
            passphrase: None,
        }
    );
}

#[test]
fn xml_export_yields_ssh_and_telnet_sessions_and_counts_skipped_protocols() {
    let xml = br#"<?xml version="1.0" encoding="UTF-8"?>
<VanDyke version="3.0">
  <key name="Sessions">
    <key name="Production">
      <key name="Gateway">
        <string name="Protocol Name">SSH2</string>
        <string name="Hostname">gateway.example.com</string>
        <dword name="[SSH2] Port">2202</dword>
        <string name="Username">deploy</string>
        <string name="Identity Filename V2">/Users/deploy/.ssh/id_ed25519</string>
        <string name="Password V2">securecrt-secret-sentinel</string>
      </key>
      <key name="Console">
        <string name="Protocol Name">Telnet</string>
        <string name="Hostname">console.example.com</string>
        <dword name="[Telnet] Port">2323</dword>
        <string name="Username">admin</string>
      </key>
    </key>
    <key name="Ignored RDP">
      <string name="Protocol Name">RDP</string>
      <string name="Hostname">desktop.example.com</string>
      <dword name="Port">3389</dword>
    </key>
  </key>
</VanDyke>"#;
    let result = preview_records_from_sources(vec![("export.xml".into(), xml.as_slice())], true);

    assert_eq!(result.records.len(), 2);
    let ssh = result
        .records
        .iter()
        .find(|record| record.kind == "ssh")
        .expect("ssh record");
    assert_eq!(ssh.display_name, "Gateway");
    assert_eq!(
        ssh.source_id.as_deref(),
        Some("export.xml#Sessions/Production/Gateway")
    );
    assert_eq!(
        ssh.ssh.as_ref().unwrap().group_path.as_deref(),
        Some("Production")
    );
    assert_eq!(ssh.ssh.as_ref().unwrap().port, Some(2202));
    assert_eq!(
        ssh.ssh.as_ref().unwrap().auth_method,
        SshImportAuthMethod::PrivateKey {
            key_path: "/Users/deploy/.ssh/id_ed25519".to_string(),
            passphrase: None,
        }
    );
    assert!(
        !serde_json::to_string(ssh)
            .unwrap()
            .contains("securecrt-secret-sentinel")
    );

    let telnet = result
        .records
        .iter()
        .find(|record| record.kind == "telnet")
        .expect("telnet record");
    let payload = telnet.telnet.as_ref().unwrap();
    assert_eq!(payload.host, "console.example.com");
    assert_eq!(payload.port, Some(2323));
    assert_eq!(payload.username.as_deref(), Some("admin"));
    assert_eq!(payload.group_path.as_deref(), Some("Production"));
    assert!(telnet.ssh.is_none());

    let summary = result
        .warnings
        .iter()
        .find(|warning| warning.code == "securecrt_unsupported_protocols")
        .expect("skipped protocol summary");
    assert_eq!(
        summary.message,
        "Skipped 1 session(s) with unsupported protocols (RDP 1)."
    );
}

#[test]
fn xml_telnet_session_produces_telnet_record_with_group_path() {
    let xml = format!(
        r#"<VanDyke><key name="Sessions">
  <key name="Core"><key name="Switch">
    <string name="Protocol Name">Telnet</string>
    <string name="Hostname">core-sw-01</string>
    <string name="Username">admin</string>
    <string name="Password V2">{V1_PASSWORD_CIPHERTEXT}</string>
  </key></key>
</key></VanDyke>"#
    );
    let result = preview_records_from_sources(vec![("export.xml".into(), xml.as_bytes())], true);

    assert_eq!(result.records.len(), 1);
    let record = &result.records[0];
    assert_eq!(record.kind, "telnet");
    assert_eq!(record.password_status, "included");
    let payload = record.telnet.as_ref().unwrap();
    assert_eq!(payload.host, "core-sw-01");
    assert_eq!(payload.port, Some(23));
    assert_eq!(payload.username.as_deref(), Some("admin"));
    assert_eq!(payload.password.as_deref(), Some("mySecretPassword123"));
    assert_eq!(payload.group_path.as_deref(), Some("Core"));
    assert_eq!(
        record.source_id.as_deref(),
        Some("export.xml#Sessions/Core/Switch")
    );
    assert!(record.warnings.is_empty());
}

#[test]
fn xml_same_leaf_names_in_different_groups_have_unique_ids() {
    let xml = br#"<VanDyke><key name="Sessions">
<key name="A"><key name="Host"><string name="Protocol Name">SSH2</string><string name="Hostname">a.example</string></key></key>
<key name="B"><key name="Host"><string name="Protocol Name">SSH2</string><string name="Hostname">b.example</string></key></key>
</key></VanDyke>"#;
    let result = preview_records_from_sources(vec![("settings.xml".into(), xml.as_slice())], false);

    assert_eq!(result.records.len(), 2);
    assert_ne!(result.records[0].id, result.records[1].id);
    assert_eq!(result.records[0].display_name, "Host");
    assert_eq!(result.records[1].display_name, "Host");
}

#[test]
fn slug_collisions_and_unicode_paths_keep_distinct_stable_records() {
    let source = br#"S:"Hostname"=api.example.test
S:"Protocol Name"=SSH2
"#;
    let sources = vec![
        ("Sessions/A-B.ini".to_string(), source.as_slice()),
        ("Sessions/A_B.ini".to_string(), source.as_slice()),
        ("Sessions/会话/生产.ini".to_string(), source.as_slice()),
        ("Sessions/会话/测试.ini".to_string(), source.as_slice()),
    ];
    let first = preview_records_from_sources(sources.clone(), false);
    let second = preview_records_from_sources(sources, false);

    assert_eq!(first.records.len(), 4);
    assert_eq!(
        first
            .records
            .iter()
            .map(|record| &record.id)
            .collect::<std::collections::BTreeSet<_>>()
            .len(),
        4
    );
    assert_eq!(
        first
            .records
            .iter()
            .map(|record| &record.id)
            .collect::<Vec<_>>(),
        second
            .records
            .iter()
            .map(|record| &record.id)
            .collect::<Vec<_>>()
    );
}

#[test]
fn ini_session_paths_preserve_nested_group_directories() {
    let source = br#"S:"Hostname"=api.example.test
S:"Protocol Name"=SSH2
"#;
    let result = preview_records_from_sources(
        vec![(
            "Sessions/Production/Staging/API.ini".to_string(),
            source.as_slice(),
        )],
        false,
    );

    let ssh = result.records[0].ssh.as_ref().unwrap();
    assert_eq!(ssh.name, "API");
    assert_eq!(ssh.group_path.as_deref(), Some("Production/Staging"));
}

#[test]
fn windows_ini_session_paths_preserve_nested_group_directories() {
    let source = br#"S:"Hostname"=api.example.test
S:"Protocol Name"=SSH2
"#;
    let result = preview_records_from_sources(
        vec![(
            r"C:\Users\tester\AppData\Roaming\VanDyke\Config\Sessions\Production\Staging\API.ini"
                .to_string(),
            source.as_slice(),
        )],
        false,
    );

    let ssh = result.records[0].ssh.as_ref().unwrap();
    assert_eq!(ssh.name, "API");
    assert_eq!(ssh.group_path.as_deref(), Some("Production/Staging"));
}

#[test]
fn xml_button_bar_send_actions_become_quick_commands() {
    let xml = br#"<VanDyke>
  <key name="Sessions">
    <key name="API"><string name="Protocol Name">SSH2</string><string name="Hostname">api.example</string></key>
  </key>
  <key name="Button Bars">
    <key name="Network">
      <key name="b0">
        <string name="Name">show interfaces</string>
        <string name="Function">SEND</string>
        <string name="Command">show interfaces\\r</string>
      </key>
      <key name="b1">
        <string name="Name">open settings</string>
        <string name="Function">MENU</string>
        <string name="Command">ignored</string>
      </key>
    </key>
  </key>
</VanDyke>"#;
    let result = preview_records_from_sources(vec![("export.xml".into(), xml.as_slice())], false);

    assert_eq!(result.records.len(), 2);
    assert_eq!(result.records[0].kind, "ssh");
    assert_eq!(result.records[1].kind, "quick_command");
    let command = result.records[1].quick_command.as_ref().unwrap();
    assert_eq!(command.name, "show interfaces");
    assert_eq!(command.command, "show interfaces\r");
    assert_eq!(command.group_name.as_deref(), Some("Network"));
    assert_eq!(command.sort_order, 0);
    assert!(
        result
            .warnings
            .iter()
            .any(|warning| warning.code == "securecrt_button_action_not_imported")
    );
}

#[test]
fn xml_button_bar_preserves_xml_order_and_duplicate_labels() {
    let xml = br#"<VanDyke>
  <key name="Button Bars">
    <key name="Network">
      <key name="b2">
        <string name="Name">ping</string>
        <string name="Function">SEND</string>
        <string name="Command">ping first</string>
      </key>
      <key name="b10">
        <string name="Name">ping</string>
        <string name="Function">SEND</string>
        <string name="Command">ping second</string>
      </key>
      <key name="b1">
        <string name="Name">last</string>
        <string name="Function">SEND</string>
        <string name="Command">echo last</string>
      </key>
    </key>
  </key>
</VanDyke>"#;
    let result = preview_records_from_sources(vec![("export.xml".into(), xml.as_slice())], false);

    assert_eq!(result.records.len(), 3);
    let commands = result
        .records
        .iter()
        .map(|record| record.quick_command.as_ref().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(
        commands
            .iter()
            .map(|command| command.command.as_str())
            .collect::<Vec<_>>(),
        vec!["ping first", "ping second", "echo last"]
    );
    assert_eq!(
        commands
            .iter()
            .map(|command| command.sort_order)
            .collect::<Vec<_>>(),
        vec![0, 1, 2]
    );
    assert_ne!(result.records[0].id, result.records[1].id);
    assert!(
        result.records[0]
            .source_id
            .as_deref()
            .unwrap()
            .ends_with("/b2")
    );
    assert!(
        result.records[1]
            .source_id
            .as_deref()
            .unwrap()
            .ends_with("/b10")
    );
}

#[test]
fn malformed_xml_discards_partial_records() {
    let xml = br#"<VanDyke>
  <key name="Sessions">
    <key name="Complete">
      <string name="Protocol Name">SSH2</string>
      <string name="Hostname">complete.example</string>
    </key>
    <key name="Truncated">
      <string name="Protocol Name">SSH2</string>
      <string name="Hostname">truncated.example</string>
"#;
    let result = preview_records_from_sources(vec![("broken.xml".into(), xml.as_slice())], false);

    assert!(result.records.is_empty());
    assert_eq!(
        result
            .warnings
            .iter()
            .filter(|warning| warning.code == "securecrt_xml_parse_failed")
            .count(),
        1
    );
}

#[test]
fn invalid_ports_warn_and_default_to_22() {
    let ini = br#"S:"Hostname"=ini.example
S:"Protocol Name"=SSH2
D:"[SSH2] Port"=00010000
"#;
    let xml = br#"<VanDyke><key name="Sessions"><key name="XML">
<string name="Protocol Name">SSH2</string><string name="Hostname">xml.example</string>
<dword name="[SSH2] Port">65536</dword>
</key></key></VanDyke>"#;
    let result = preview_records_from_sources(
        vec![
            ("Sessions/Invalid.ini".into(), ini.as_slice()),
            ("export.xml".into(), xml.as_slice()),
        ],
        false,
    );

    assert_eq!(result.records.len(), 2);
    assert!(
        result
            .records
            .iter()
            .all(|record| record.ssh.as_ref().unwrap().port == Some(22))
    );
    assert_eq!(
        result
            .warnings
            .iter()
            .filter(|warning| warning.code == "securecrt_ssh_port_invalid")
            .count(),
        2
    );
}

#[test]
fn ssh_session_without_hostname_warns_instead_of_silently_disappearing() {
    let source = br#"S:"Protocol Name"=SSH2
S:"Username"=deploy
"#;
    let result = preview_records_from_sources(
        vec![("Sessions/MissingHost.ini".into(), source.as_slice())],
        false,
    );

    assert!(result.records.is_empty());
    assert!(
        result
            .warnings
            .iter()
            .any(|warning| warning.code == "securecrt_ssh_hostname_missing")
    );
}

#[test]
fn include_passwords_never_exposes_securecrt_ciphertext() {
    let source = br#"S:"Hostname"=prod.example.test
S:"Protocol Name"=SSH2
S:"Password V2"=02:never-return-this
"#;
    for include_passwords in [false, true] {
        let result = preview_records_from_sources(
            vec![("Sessions/Password.ini".into(), source.as_slice())],
            include_passwords,
        );
        let serialized = serde_json::to_string(&result).unwrap();
        assert!(!serialized.contains("never-return-this"));
        assert_eq!(
            result.records[0].ssh.as_ref().unwrap().auth_method,
            SshImportAuthMethod::Password { password: None }
        );
    }
}

#[test]
fn parses_utf16_be_xml() {
    let xml = r#"<VanDyke><key name="Sessions"><key name="UTF16"><string name="Protocol Name">SSH2</string><string name="Hostname">utf16.example</string></key></key></VanDyke>"#;
    let bytes = utf16_be(xml);
    let result =
        preview_records_from_sources(vec![("settings.xml".into(), bytes.as_slice())], false);

    assert_eq!(
        result.records[0].ssh.as_ref().unwrap().host,
        "utf16.example"
    );
}

#[test]
fn button_bar_send_actions_become_global_quick_commands() {
    let source = br#"Z:"Keyword HL Video BBar"=00000003
 SEND,sh ip int br\\r,ip br,,,0,4,
 SEND,configure terminal\\r,conf t,,,0,7,
 MENU_TOGGLE_KEYWORD_HIGHLIGHTING,,Highlight on/off,,,0,0,
"#;
    let result =
        preview_records_from_sources(vec![("ButtonBarV5.ini".into(), source.as_slice())], false);

    assert_eq!(result.records.len(), 2);
    assert!(
        result
            .warnings
            .iter()
            .any(|warning| warning.code == "securecrt_button_action_not_imported")
    );
    assert_quick_command(
        result.records[0].quick_command.as_ref().unwrap(),
        "ip br",
        "sh ip int br\r",
        0,
    );
    assert_quick_command(
        result.records[1].quick_command.as_ref().unwrap(),
        "conf t",
        "configure terminal\r",
        1,
    );
}

#[test]
fn command_manager_send_actions_become_global_quick_commands() {
    let source = b"\xef\xbb\xbfZ:\"Default\"=00000001\n SEND,df -h,disk usage,,,0,1,,\nD:\"Is Command List\"=00000001\n";
    let result = preview_records_from_sources(
        vec![("Commands/__Commands__.ini".into(), source.as_slice())],
        false,
    );

    assert_eq!(result.records.len(), 1);
    assert!(result.warnings.is_empty());
    let command = result.records[0].quick_command.as_ref().unwrap();
    assert_eq!(command.name, "disk usage");
    assert_eq!(command.command, "df -h");
    assert_eq!(command.group_name.as_deref(), Some("Default"));
    assert_eq!(
        command.description.as_deref(),
        Some("Imported from SecureCRT quick commands")
    );
    assert_eq!(command.sort_order, 0);
}

#[test]
fn nested_command_manager_folders_become_quick_command_groups() {
    let source = br#"Z:"Default"=00000001
 SEND,uptime,system uptime,,,0,1,,
"#;
    let result = preview_records_from_sources(
        vec![(
            r"Commands\Linux\Production\__Commands__.ini".into(),
            source.as_slice(),
        )],
        false,
    );

    assert_eq!(result.records.len(), 1);
    let command = result.records[0].quick_command.as_ref().unwrap();
    assert_eq!(command.group_name.as_deref(), Some("Linux/Production"));
}

#[test]
fn named_command_lists_preserve_folder_and_list_grouping() {
    let source = br#"Z:"Diagnostics"=00000001
 SEND,uptime,system uptime,,,0,1,,
"#;
    let result = preview_records_from_sources(
        vec![("Commands/Linux/__Commands__.ini".into(), source.as_slice())],
        false,
    );

    assert_eq!(result.records.len(), 1);
    let command = result.records[0].quick_command.as_ref().unwrap();
    assert_eq!(command.group_name.as_deref(), Some("Linux/Diagnostics"));
}

#[test]
fn button_bar_groups_are_not_replaced_by_parent_folder_names() {
    let source = br#"Z:"Ops"=00000001
 SEND,uptime,system uptime,,,0,1,,
"#;
    let result = preview_records_from_sources(
        vec![(
            "Commands/Linux/ButtonBarCustom.ini".into(),
            source.as_slice(),
        )],
        false,
    );

    assert_eq!(result.records.len(), 1);
    let command = result.records[0].quick_command.as_ref().unwrap();
    assert_eq!(command.group_name.as_deref(), Some("Ops"));
}

#[test]
fn button_pause_is_preserved_without_dropping_following_text() {
    let source = br#"Z:"Ops"=00000001
 SEND,ena\\r\\pFOLLOWING_TEXT\\r,enable,,,0,5,
"#;
    let result = preview_records_from_sources(
        vec![("ButtonBarCustom.ini".into(), source.as_slice())],
        false,
    );

    let command = &result.records[0].quick_command.as_ref().unwrap().command;
    assert!(command.contains(r"\pFOLLOWING_TEXT"));
    assert!(command.ends_with('\r'));
}

#[test]
fn quoted_button_bar_fields_preserve_commas_and_quotes() {
    let source = br#"Z:"Ops"=00000001
 SEND,"printf ""%s,%s"" foo bar\\r",csv command,,,0,5,
"#;
    let result = preview_records_from_sources(
        vec![("ButtonBarCustom.ini".into(), source.as_slice())],
        false,
    );

    let command = &result.records[0].quick_command.as_ref().unwrap().command;
    assert_eq!(command, "printf \"%s,%s\" foo bar\r");
}

#[test]
fn credential_username_enriches_session_without_importing_password() {
    let session = br#"S:"Hostname"=prod.example.test
S:"Protocol Name"=SSH2
S:"Credential Title"=Deploy
S:"Password V2"=02:deadbeef
"#;
    let credential = br#"S:"Username"=00000006 4400650070006c006f007900
S:"Password V2"=02:credential-secret
"#;
    let result = preview_records_from_sources(
        vec![
            ("Sessions/Production/API.ini".into(), session.as_slice()),
            ("Credentials/Deploy.ini".into(), credential.as_slice()),
        ],
        true,
    );

    assert_eq!(result.records.len(), 1);
    let record = &result.records[0];
    assert_eq!(record.ssh.as_ref().unwrap().username, "Deploy");
    assert_eq!(record.password_status, "unsupported");
    assert!(
        !serde_json::to_string(record)
            .unwrap()
            .contains("credential-secret")
    );
}

#[test]
fn credential_password_status_enriches_session_without_exposing_ciphertext() {
    let session = br#"S:"Hostname"=prod.example.test
S:"Protocol Name"=SSH2
S:"Credential Title"=Deploy
"#;
    let credential = br#"S:"Username"=deploy
S:"Password V2"=02:credential-secret
"#;
    let result = preview_records_from_sources(
        vec![
            ("Sessions/Production/API.ini".into(), session.as_slice()),
            ("Credentials/Deploy.ini".into(), credential.as_slice()),
        ],
        true,
    );

    assert_eq!(result.records.len(), 1);
    let record = &result.records[0];
    assert_eq!(record.password_status, "unsupported");
    assert!(matches!(
        record.ssh.as_ref().unwrap().auth_method,
        SshImportAuthMethod::Password { password: None }
    ));
    assert!(
        record
            .warnings
            .iter()
            .any(|warning| warning.code == "securecrt_password_decrypt_failed")
    );
    assert!(
        !serde_json::to_string(record)
            .unwrap()
            .contains("credential-secret")
    );
}

#[test]
fn xml_button_bar_preserves_duplicate_button_keys() {
    let xml = br#"<VanDyke>
  <key name="Button Bars">
    <key name="Network">
      <key name="button">
        <string name="Name">first</string>
        <string name="Function">SEND</string>
        <string name="Command">echo first</string>
      </key>
      <key name="button">
        <string name="Name">second</string>
        <string name="Function">SEND</string>
        <string name="Command">echo second</string>
      </key>
    </key>
  </key>
</VanDyke>"#;
    let result = preview_records_from_sources(vec![("export.xml".into(), xml.as_slice())], false);

    assert_eq!(result.records.len(), 2);
    assert_eq!(
        result.records[0].quick_command.as_ref().unwrap().command,
        "echo first"
    );
    assert_eq!(
        result.records[1].quick_command.as_ref().unwrap().command,
        "echo second"
    );
    assert_ne!(result.records[0].id, result.records[1].id);
}

#[test]
fn credential_username_enriches_xml_session_without_importing_password() {
    let xml = br#"<VanDyke>
  <key name="Sessions">
    <key name="API">
      <string name="Protocol Name">SSH2</string>
      <string name="Hostname">api.example.test</string>
      <string name="Credential Title">Deploy</string>
      <string name="Password V2">session-secret</string>
    </key>
  </key>
</VanDyke>"#;
    let credential = br#"S:"Username"=deploy
S:"Password V2"=02:credential-secret
"#;
    let result = preview_records_from_sources(
        vec![
            ("export.xml".into(), xml.as_slice()),
            ("Credentials/Deploy.ini".into(), credential.as_slice()),
        ],
        true,
    );

    assert_eq!(result.records.len(), 1);
    let record = &result.records[0];
    assert_eq!(record.ssh.as_ref().unwrap().username, "deploy");
    assert_eq!(record.password_status, "unsupported");
    let serialized = serde_json::to_string(record).unwrap();
    assert!(!serialized.contains("credential-secret"));
    assert!(!serialized.contains("session-secret"));
}

#[test]
fn classifies_xml_sessions_buttons_and_templates() {
    assert_eq!(classify_source("settings.xml"), Some(SourceKind::Xml));
    assert_eq!(
        classify_source("Sessions/Production/API.ini"),
        Some(SourceKind::SessionIni)
    );
    assert_eq!(
        classify_source("ButtonBarV5.ini"),
        Some(SourceKind::ButtonBar)
    );
    assert_eq!(
        classify_source("Commands/__Commands__.ini"),
        Some(SourceKind::ButtonBar)
    );
    assert_eq!(
        classify_source(r"Commands\Linux\__Commands__.ini"),
        Some(SourceKind::ButtonBar)
    );
    assert_eq!(
        classify_source("Sessions/__Commands__.ini"),
        Some(SourceKind::SessionIni)
    );
    assert_eq!(classify_source("Sessions/Default.ini"), None);
    assert_eq!(classify_source("notes.txt"), None);
}

#[test]
fn parses_securecrt_folder_data_into_workspace_records() {
    let source = "\u{feff}D:\"Is Expanded\"=00000001\r\n\
Z:\"Session List V2\"=00000005\r\n\
 Default\r\n\
 Default_LocalShell\r\n\
 Default_RDP\r\n\
 Default_Serial\r\n\
 172.31.15.186\r\n\
Z:\"Folder List V2\"=00000002\r\n\
 test\r\n\
 test3\r\n";

    let result = preview_records_from_sources(
        vec![("Sessions/__FolderData__.ini".into(), source.as_bytes())],
        false,
    );

    assert_eq!(
        result
            .records
            .iter()
            .filter(|record| record.kind == "workspace")
            .map(|record| record.workspace.as_ref().unwrap().path.as_str())
            .collect::<Vec<_>>(),
        vec!["test", "test3"]
    );
}

#[test]
fn parses_nested_folder_data_and_lowercase_list_key() {
    let source = "z:\"Folder List V2\"=00000001\n Staging\n";
    let result = preview_records_from_sources(
        vec![(
            r"Sessions\Production\__FolderData.ini".into(),
            source.as_bytes(),
        )],
        false,
    );

    assert_eq!(
        result
            .records
            .iter()
            .map(|record| record.workspace.as_ref().unwrap().path.as_str())
            .collect::<Vec<_>>(),
        vec!["Production", "Production/Staging"]
    );
}

#[test]
fn folder_data_nested_paths_include_all_ancestor_workspaces_without_duplicates() {
    let source = "Z:\"Folder List V2\"=00000002\n Production/Staging\n Production\n";
    let result = preview_records_from_sources(
        vec![("Sessions/__FolderData__.ini".into(), source.as_bytes())],
        false,
    );

    assert_eq!(
        result
            .records
            .iter()
            .map(|record| record.workspace.as_ref().unwrap().path.as_str())
            .collect::<Vec<_>>(),
        vec!["Production", "Production/Staging"]
    );
}

#[test]
fn empty_folder_data_does_not_create_workspace_records() {
    let result = preview_records_from_sources(
        vec![(
            "Sessions/__FolderData__.ini".into(),
            b"Z:\"Folder List V2\"=00000000\n".as_slice(),
        )],
        false,
    );

    assert!(result.records.is_empty());
}

#[test]
fn workspace_records_include_empty_session_directories_and_are_deduplicated() {
    let mut result = preview_records_from_sources(Vec::<(String, &[u8])>::new(), false);
    append_workspace_records(
        &mut result,
        vec![
            "Production".to_string(),
            "Production".to_string(),
            r"Production\Staging".to_string(),
        ],
    );

    assert_eq!(
        result
            .records
            .iter()
            .map(|record| record.workspace.as_ref().unwrap().path.as_str())
            .collect::<Vec<_>>(),
        vec!["Production", "Production/Staging"]
    );
}

#[test]
fn selected_securecrt_directories_preserve_logical_root_prefixes() {
    assert_eq!(
        candidate_directory_prefix(
            "/Users/test/Library/Application Support/VanDyke/SecureCRT/Config"
        ),
        ""
    );
    assert_eq!(
        candidate_directory_prefix(
            "/Users/test/Library/Application Support/VanDyke/SecureCRT/Config/Sessions"
        ),
        "Sessions"
    );
    assert_eq!(
        candidate_directory_prefix(
            "/Users/test/Library/Application Support/VanDyke/SecureCRT/Config/Sessions/Production"
        ),
        "Sessions/Production"
    );
    assert_eq!(
        candidate_directory_prefix(
            r"C:\Users\test\AppData\Roaming\VanDyke\SecureCRT\Config\Commands\Linux"
        ),
        "Commands/Linux"
    );
    assert_eq!(
        candidate_directory_prefix(
            r"C:\Users\test\AppData\Roaming\VanDyke\SecureCRT\Config\Sessions\Production\Commands"
        ),
        "Sessions/Production/Commands"
    );
}

fn assert_quick_command(
    command: &QuickCommandImportRecord,
    name: &str,
    value: &str,
    sort_order: i32,
) {
    assert_eq!(command.name, name);
    assert_eq!(command.command, value);
    assert_eq!(command.group_name.as_deref(), Some("Keyword HL Video BBar"));
    assert_eq!(command.sort_order, sort_order);
    assert_eq!(command.connection_source_id, None);
}

fn utf16_le(text: &str) -> Vec<u8> {
    let mut bytes = vec![0xff, 0xfe];
    for unit in text.encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }
    bytes
}

fn utf16_be(text: &str) -> Vec<u8> {
    let mut bytes = vec![0xfe, 0xff];
    for unit in text.encode_utf16() {
        bytes.extend_from_slice(&unit.to_be_bytes());
    }
    bytes
}

// ---- 密码解密（移植自 scrt-go-migrate 的向量） ----

/// Go 端已验证的三条向量，这里当端到端夹具用：
/// V1 无前缀、`02:` SHA256、`03:` bcrypt-pbkdf（口令均为 `configpass`，
/// 其中 V1 与口令无关）。
const V1_PASSWORD_CIPHERTEXT: &str = "c9d42f89c85d3c089d115db0e899c2070d653048467f869d196d689f754269d5d04ec18a59b46a5c94c39574a0593ed896cd25e84707089f";
const V2_02_PASSWORD_CIPHERTEXT: &str = "02:ce03b492b17bdd0e66ddce4732ddbbe6afb25537207e4e1b61b35472cd5320f0b7b597cb8a27f1986301290565f50233e0eeefd794ae86ff85ccaf44276133eb";
const V2_03_PASSWORD_CIPHERTEXT: &str = "03:000102030405060708090a0b0c0d0e0fdc2bbba761e1186c63ec87155e157c0882bd8806c52e6b100ec0d3136513a24e4df7fe48eaf506e7f00e21def5abe00fd4769bffe21d210e3a66f9115c7e03a8";

fn session_with_password(ciphertext: &str) -> Vec<u8> {
    format!(
        "S:\"Hostname\"=prod.example.test\nS:\"Protocol Name\"=SSH2\nS:\"Username\"=deploy\nS:\"Password V2\"={ciphertext}\n"
    )
    .into_bytes()
}

fn imported_password(record: &crate::securecrt::ImportRecord) -> Option<String> {
    match &record.ssh.as_ref().expect("ssh record").auth_method {
        SshImportAuthMethod::Password { password } => password.clone(),
        other => panic!("expected password auth, got {other:?}"),
    }
}

#[test]
fn imports_v1_password_when_passwords_are_requested() {
    let session = session_with_password(V1_PASSWORD_CIPHERTEXT);
    let result = preview_records_from_sources(
        vec![("Sessions/Production/API.ini".into(), session.as_slice())],
        true,
    );

    let record = &result.records[0];
    assert_eq!(record.password_status, "included");
    assert_eq!(
        imported_password(record).as_deref(),
        Some("mySecretPassword123")
    );
    assert!(record.warnings.is_empty());
}

#[test]
fn imports_v2_sha256_password_when_passwords_are_requested() {
    let session = session_with_password(V2_02_PASSWORD_CIPHERTEXT);
    let result = preview_records_from_sources_with_passphrase(
        vec![("Sessions/Production/API.ini".into(), session.as_slice())],
        true,
        "configpass",
    );

    let record = &result.records[0];
    assert_eq!(record.password_status, "included");
    assert_eq!(imported_password(record).as_deref(), Some("pass-02-vector"));
}

#[test]
fn imports_v2_bcrypt_password_when_passwords_are_requested() {
    let session = session_with_password(V2_03_PASSWORD_CIPHERTEXT);
    let result = preview_records_from_sources_with_passphrase(
        vec![("Sessions/Production/API.ini".into(), session.as_slice())],
        true,
        "configpass",
    );

    let record = &result.records[0];
    assert_eq!(record.password_status, "included");
    assert_eq!(imported_password(record).as_deref(), Some("pass-03-vector"));
}

#[test]
fn password_is_not_decrypted_when_the_caller_does_not_ask_for_it() {
    let session = session_with_password(V2_02_PASSWORD_CIPHERTEXT);
    let result = preview_records_from_sources(
        vec![("Sessions/Production/API.ini".into(), session.as_slice())],
        false,
    );

    let record = &result.records[0];
    assert_eq!(record.password_status, "unsupported");
    assert_eq!(imported_password(record), None);
    assert!(
        !serde_json::to_string(record)
            .unwrap()
            .contains("pass-02-vector")
    );
}

#[test]
fn credential_password_is_decrypted_and_reused_by_referencing_sessions() {
    let session = br#"S:"Hostname"=prod.example.test
S:"Protocol Name"=SSH2
S:"Credential Title"=Deploy
"#;
    let credential = format!("S:\"Username\"=deploy\nS:\"Password V2\"={V1_PASSWORD_CIPHERTEXT}\n");
    let result = preview_records_from_sources(
        vec![
            (
                "Sessions/Production/API.ini".to_string(),
                session.as_slice(),
            ),
            ("Credentials/Deploy.ini".to_string(), credential.as_bytes()),
        ],
        true,
    );

    assert_eq!(result.records.len(), 1);
    let record = &result.records[0];
    assert_eq!(record.password_status, "included");
    assert_eq!(
        imported_password(record).as_deref(),
        Some("mySecretPassword123")
    );
}

#[test]
fn xml_export_password_is_decrypted_too() {
    let xml = format!(
        r#"<VanDyke>
  <key name="Sessions">
    <key name="Production">
      <key name="API">
        <string name="Hostname">prod.example.test</string>
        <string name="Protocol Name">SSH2</string>
        <string name="Username">deploy</string>
        <string name="Password V2">{V2_02_PASSWORD_CIPHERTEXT}</string>
      </key>
    </key>
  </key>
</VanDyke>"#
    );
    let result = preview_records_from_sources_with_passphrase(
        vec![("export.xml".into(), xml.as_bytes())],
        true,
        "configpass",
    );

    let record = &result.records[0];
    assert_eq!(record.password_status, "included");
    assert_eq!(imported_password(record).as_deref(), Some("pass-02-vector"));
}

#[test]
fn ini_telnet_session_produces_telnet_record_with_password() {
    let source = "S:\"Hostname\"=core-sw-01\nS:\"Protocol Name\"=Telnet\nD:\"[Telnet] Port\"=00000913\nS:\"Username\"=admin\nS:\"Password\"=plainSecret123\n";
    let result = preview_records_from_sources(
        vec![(
            "Sessions/Core/Switch/core-sw-01.ini".into(),
            source.as_bytes(),
        )],
        true,
    );

    assert_eq!(result.records.len(), 1);
    let record = &result.records[0];
    assert_eq!(record.kind, "telnet");
    assert_eq!(record.password_status, "included");
    assert!(record.ssh.is_none());
    let payload = record.telnet.as_ref().unwrap();
    assert_eq!(payload.name, "core-sw-01");
    assert_eq!(payload.host, "core-sw-01");
    assert_eq!(payload.port, Some(2323));
    assert_eq!(payload.username.as_deref(), Some("admin"));
    assert_eq!(payload.password.as_deref(), Some("plainSecret123"));
    assert_eq!(payload.group_path.as_deref(), Some("Core/Switch"));
    assert!(record.warnings.is_empty());
    assert!(
        !result
            .warnings
            .iter()
            .any(|warning| warning.code == "securecrt_unsupported_protocols")
    );
}

#[test]
fn ini_telnet_session_without_hostname_is_skipped_with_a_warning() {
    let source = br#"S:"Protocol Name"=telnet
S:"Username"=admin
"#;
    let result = preview_records_from_sources(
        vec![("Sessions/Core/NoHost.ini".into(), source.as_slice())],
        false,
    );

    assert!(result.records.is_empty());
    assert!(
        result
            .warnings
            .iter()
            .any(|warning| warning.code == "securecrt_telnet_hostname_missing")
    );
}

#[test]
fn ini_skipped_protocols_are_counted_and_summarized_once() {
    let sessions = [
        (
            "Sessions/RDP/Desktop.ini".to_string(),
            b"S:\"Protocol Name\"=RDP\nS:\"Hostname\"=desktop.example\n".to_vec(),
        ),
        (
            "Sessions/Serial/Console.ini".to_string(),
            b"S:\"Protocol Name\"=Serial\nS:\"Hostname\"=console.example\n".to_vec(),
        ),
        (
            "Sessions/Shell/Local.ini".to_string(),
            b"S:\"Protocol Name\"=Local Shell\nS:\"Hostname\"=local.example\n".to_vec(),
        ),
        (
            "Sessions/Production/API.ini".to_string(),
            b"S:\"Protocol Name\"=SSH2\nS:\"Hostname\"=api.example\n".to_vec(),
        ),
    ];
    let sources = sessions
        .iter()
        .map(|(path, bytes)| (path.clone(), bytes.as_slice()))
        .collect::<Vec<_>>();
    let result = preview_records_from_sources(sources, false);

    assert_eq!(result.records.len(), 1);
    assert_eq!(result.records[0].kind, "ssh");
    let summaries = result
        .warnings
        .iter()
        .filter(|warning| warning.code == "securecrt_unsupported_protocols")
        .collect::<Vec<_>>();
    assert_eq!(summaries.len(), 1);
    assert_eq!(
        summaries[0].message,
        "Skipped 3 session(s) with unsupported protocols (Local Shell 1, RDP 1, Serial 1)."
    );
}

#[test]
fn xml_skipped_protocols_are_merged_into_one_summary() {
    let xml = br#"<VanDyke><key name="Sessions">
<key name="RDP"><key name="Desktop"><string name="Protocol Name">RDP</string><string name="Hostname">d1.example</string></key></key>
<key name="RDP2"><key name="Desktop"><string name="Protocol Name">rdp</string><string name="Hostname">d2.example</string></key></key>
<key name="Serial"><key name="Console"><string name="Protocol Name">Serial</string><string name="Hostname">c1.example</string></key></key>
<key name="Telnet"><key name="Switch"><string name="Protocol Name">Telnet</string><string name="Hostname">s1.example</string></key></key>
</key></VanDyke>"#;
    let result = preview_records_from_sources(vec![("export.xml".into(), xml.as_slice())], false);

    assert_eq!(result.records.len(), 1);
    assert_eq!(result.records[0].kind, "telnet");
    let summaries = result
        .warnings
        .iter()
        .filter(|warning| warning.code == "securecrt_unsupported_protocols")
        .collect::<Vec<_>>();
    assert_eq!(summaries.len(), 1);
    assert_eq!(
        summaries[0].message,
        "Skipped 3 session(s) with unsupported protocols (RDP 2, Serial 1)."
    );
}

#[test]
fn ini_telnet_port_defaults_to_23() {
    let source = br#"S:"Hostname"=core-sw-01
S:"Protocol Name"=telnet
"#;
    let result = preview_records_from_sources(
        vec![("Sessions/Core/Switch.ini".into(), source.as_slice())],
        false,
    );

    let record = &result.records[0];
    assert_eq!(record.kind, "telnet");
    assert_eq!(record.telnet.as_ref().unwrap().port, Some(23));
    assert_eq!(record.password_status, "missing");
}

#[test]
fn telnet_json_payload_matches_the_host_contract() {
    let source = br#"S:"Hostname"=10.0.0.5
S:"Protocol Name"=Telnet
S:"Username"=admin
"#;
    let result = preview_records_from_sources(
        vec![(
            "Sessions/Core/Switch/core-sw-01.ini".into(),
            source.as_slice(),
        )],
        false,
    );

    let json: serde_json::Value =
        serde_json::from_str(&crate::component::serialize_preview_records(&result)).unwrap();
    assert_eq!(json[0]["kind"], "telnet");
    assert!(json[0]["ssh"].is_null());
    assert!(json[0]["database"].is_null());
    assert_eq!(json[0]["telnet"]["host"], "10.0.0.5");
    assert_eq!(json[0]["telnet"]["port"], 23);
    assert_eq!(json[0]["telnet"]["username"], "admin");
    assert_eq!(json[0]["telnet"]["group_path"], "Core/Switch");
}
