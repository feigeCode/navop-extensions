use super::*;

#[test]
fn read_first_request_stops_after_client_hello() {
    // The app blocks until ServerHello arrives, so the helper must not consume
    // (let alone block on) the Connect line while parsing the first request.
    let connect_line =
        r#"{"type":"Connect","destination":"host:5900","username":null,"password":"secret","domain":null,"width":800,"height":600}"#;
    let input = vec![
        Ok(r#"{"type":"ClientHello","protocol_version":2,"app_version":"0.23.2"}"#.to_string()),
        Ok(connect_line.to_string()),
    ];
    let mut lines = input.into_iter();

    let first = read_first_request(&mut lines).expect("first request");

    match first {
        FirstRequest::ClientHello { protocol_version } => assert_eq!(protocol_version, 2),
        FirstRequest::Connect(_) => panic!("expected ClientHello"),
    }
    assert_eq!(lines.next().expect("connect line").unwrap(), connect_line);
}

#[test]
fn read_first_request_accepts_legacy_connect() {
    let input = vec![Ok(
        r#"{"type":"Connect","destination":"host:5900","username":null,"password":null,"domain":null,"width":800,"height":600}"#
            .to_string(),
    )];
    let mut lines = input.into_iter();

    let first = read_first_request(&mut lines).expect("legacy connect request");

    match first {
        FirstRequest::Connect(connect) => assert_eq!(connect.destination, "host:5900"),
        FirstRequest::ClientHello { .. } => panic!("expected Connect"),
    }
}

#[test]
fn read_first_request_rejects_other_requests() {
    let input = vec![Ok(r#"{"type":"Ping","sequence":1}"#.to_string())];
    let mut lines = input.into_iter();

    let error = read_first_request(&mut lines).expect_err("ping cannot start a session");

    assert!(
        error
            .to_string()
            .contains("first helper request must be ClientHello or Connect")
    );
}

#[test]
fn rejects_client_hello_with_unsupported_version() {
    let error = require_protocol_version(1).expect_err("version mismatch must fail");

    assert!(
        error
            .to_string()
            .contains("unsupported helper protocol version 1")
    );
    assert!(require_protocol_version(2).is_ok());
}

#[test]
fn converts_handshake_and_heartbeat_requests_to_no_input() {
    assert_eq!(
        request_to_input(HelperRequest::ClientHello {
            protocol_version: 2,
            app_version: "0.23.2".to_string(),
        }),
        None
    );
    assert_eq!(request_to_input(HelperRequest::Ping { sequence: 7 }), None);
    assert_eq!(request_to_input(HelperRequest::RequestFullFrame), None);
}

#[test]
fn connect_options_preserve_structured_credentials() {
    let options = connect_options(protocol::ConnectRequest {
        destination: "host:5900".to_string(),
        username: Some("alice".to_string()),
        password: Some("secret".to_string()),
        domain: Some("example".to_string()),
        width: 800,
        height: 600,
    });

    assert_eq!(options.username.as_deref(), Some("alice"));
    assert_eq!(options.password.as_deref(), Some("secret"));
    assert_eq!(options.domain.as_deref(), Some("example"));
}

#[test]
fn converts_extended_key_request_to_prefixed_scancode() {
    let input = request_to_input(HelperRequest::Key {
        code: 0x48,
        extended: true,
        pressed: true,
    });

    assert_eq!(
        input,
        Some(RemoteDesktopInput::Key {
            key: RemoteKey::Scancode(0xe048),
            pressed: true
        })
    );
}

#[test]
fn converts_keysym_request_to_remote_keysym() {
    let input = request_to_input(HelperRequest::KeySym {
        keysym: b':' as u32,
        pressed: true,
    });

    assert_eq!(
        input,
        Some(RemoteDesktopInput::Key {
            key: RemoteKey::KeySym(b':' as u32),
            pressed: true,
        })
    );
}

#[test]
fn converts_clipboard_files_request_without_losing_paths() {
    let input = request_to_input(HelperRequest::ClipboardFiles {
        paths: vec![r"C:\Users\Rachel\notes.txt".to_string()],
    });

    assert_eq!(
        input,
        Some(RemoteDesktopInput::ClipboardFiles {
            paths: vec![r"C:\Users\Rachel\notes.txt".to_string()],
        })
    );
}

#[test]
fn converts_cursor_bitmap_to_binary_helper_event() {
    let event = output_to_event(RemoteDesktopOutput::CursorBitmap(
        crate::runtime::RemoteDesktopCursor {
            width: 2,
            height: 1,
            hotspot_x: 1,
            hotspot_y: 0,
            rgba: vec![1, 2, 3, 255, 4, 5, 6, 128],
        },
    ));

    assert_eq!(
        event,
        HelperEvent::CursorRgbaBytes {
            width: 2,
            height: 1,
            hotspot_x: 1,
            hotspot_y: 0,
            rgba: vec![1, 2, 3, 255, 4, 5, 6, 128],
        }
    );
}
