use std::io::{Cursor, Write};

use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

use crate::xshell::{SshImportAuthMethod, is_supported_source_path, preview_records_from_sessions};

#[test]
fn parses_ssh_session_without_importing_encrypted_passwords() {
    let session = br#"
[CONNECTION]
Host=prod.example.test
Port=2200
Protocol=SSH

[CONNECTION:AUTHENTICATION]
UserName=deploy
Password=encrypted-secret
"#;

    let records =
        preview_records_from_sessions(vec![("Prod/SSH.xsh".to_string(), session.as_slice())], true);

    assert_eq!(1, records.len());
    let record = &records[0];
    assert_eq!("xshell:prod-ssh", record.id);
    assert_eq!("xshell", record.importer_id);
    assert_eq!("Xshell", record.source_label);
    assert_eq!(Some("Prod/SSH.xsh"), record.source_id.as_deref());
    assert_eq!("ssh", record.kind);
    assert_eq!("SSH", record.display_name);
    assert_eq!("unsupported", record.password_status);
    let ssh = record.ssh.as_ref().unwrap();
    assert_eq!("SSH", ssh.name);
    assert_eq!("prod.example.test", ssh.host);
    assert_eq!(Some(2200), ssh.port);
    assert_eq!("deploy", ssh.username);
    assert_eq!(SshImportAuthMethod::AutoPublicKey, ssh.auth_method);
}

#[test]
fn parses_utf16le_xshell_session_files() {
    let session = "\u{feff}[CONNECTION]\r\nHost=utf16.example.test\r\nPort=2201\r\nProtocol=SSH\r\n\r\n[CONNECTION:AUTHENTICATION]\r\nUserName=deploy\r\n";
    let mut bytes = Vec::new();
    for unit in session.encode_utf16() {
        bytes.extend_from_slice(&unit.to_le_bytes());
    }

    let records = preview_records_from_sessions(
        vec![("Utf16/Session.xsh".to_string(), bytes.as_slice())],
        false,
    );

    assert_eq!(1, records.len());
    let ssh = records[0].ssh.as_ref().unwrap();
    assert_eq!("utf16.example.test", ssh.host);
    assert_eq!(Some(2201), ssh.port);
    assert_eq!("deploy", ssh.username);
}

#[test]
fn recognizes_xshell_source_extensions_case_insensitively() {
    assert!(is_supported_source_path("Session.XsH"));
    assert!(is_supported_source_path("Backup.XtS"));
    assert!(!is_supported_source_path("sessions.zip"));
}

#[test]
fn parses_xshell_xts_backup_sessions() {
    let archive = xts_backup(&[
        (
            "Xshell/Prod/Web.xsh",
            session("web.example.test", 2201, "deploy"),
        ),
        (
            "Xshell/Prod/Database.xsh",
            session("db.example.test", 22, "dba"),
        ),
        (
            "Xftp/ignored.xsh",
            session("ignored.example.test", 22, "ignored"),
        ),
    ]);

    let records = preview_records_from_sessions(
        vec![("team-backup.xts".to_string(), archive.as_slice())],
        false,
    );

    assert_eq!(2, records.len());
    assert_eq!("Database", records[0].display_name);
    assert_eq!("db.example.test", records[0].ssh.as_ref().unwrap().host);
    assert_eq!("Web", records[1].display_name);
    assert_eq!("web.example.test", records[1].ssh.as_ref().unwrap().host);
    assert_eq!(
        Some("team-backup.xts!/Xshell/Prod/Web.xsh"),
        records[1].source_id.as_deref()
    );
}

#[test]
fn decodes_legacy_gbk_xts_session_names() {
    let mut archive = xts_backup(&[("Xshell/abcd.xsh", session("cn.example.test", 22, "deploy"))]);
    replace_zip_filename(
        &mut archive,
        b"Xshell/abcd.xsh",
        b"Xshell/\xd6\xd0\xce\xc4.xsh",
    );

    let records = preview_records_from_sessions(
        vec![("chinese-backup.xts".to_string(), archive.as_slice())],
        false,
    );

    assert_eq!(1, records.len());
    assert_eq!("中文", records[0].display_name);
    assert_eq!(
        Some("chinese-backup.xts!/Xshell/中文.xsh"),
        records[0].source_id.as_deref()
    );
}

#[test]
fn serializes_auth_method_with_host_protocol_shape() {
    let session = br#"
[CONNECTION]
Host=prod.example.test
Port=22
Protocol=SSH
"#;

    let records = preview_records_from_sessions(
        vec![("Prod/SSH.xsh".to_string(), session.as_slice())],
        false,
    );

    let json = serde_json::to_value(&records[0]).unwrap();
    assert_eq!(
        serde_json::json!("auto_public_key"),
        json["ssh"]["auth_method"]
    );
}

fn xts_backup(entries: &[(&str, String)]) -> Vec<u8> {
    let mut archive = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    archive
        .start_file("xts.zcf", options)
        .expect("start xts metadata");
    archive
        .write_all(b"[SessionInfo]\nVersion=6.0\n")
        .expect("write xts metadata");
    for (path, contents) in entries {
        archive.start_file(path, options).expect("start session");
        archive
            .write_all(contents.as_bytes())
            .expect("write session");
    }
    archive.finish().expect("finish archive").into_inner()
}

fn session(host: &str, port: u16, username: &str) -> String {
    format!(
        "[CONNECTION]\nHost={host}\nPort={port}\nProtocol=SSH\n\n\
         [CONNECTION:AUTHENTICATION]\nUserName={username}\n"
    )
}

fn replace_zip_filename(archive: &mut [u8], from: &[u8], to: &[u8]) {
    assert_eq!(from.len(), to.len());
    let mut replacements = 0;
    for index in 0..=archive.len() - from.len() {
        if &archive[index..index + from.len()] == from {
            archive[index..index + to.len()].copy_from_slice(to);
            replacements += 1;
        }
    }
    assert_eq!(2, replacements, "replace local and central ZIP names");
}
