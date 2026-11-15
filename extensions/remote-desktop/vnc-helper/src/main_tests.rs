use super::*;

#[test]
fn reads_connect_request_after_client_hello() {
    let input = vec![
        Ok(
            r#"{"type":"ClientHello","protocol_version":2,"app_version":"0.23.2"}"#
                .to_string(),
        ),
        Ok(
            r#"{"type":"Connect","destination":"host:5900","username":null,"password":"secret","domain":null,"width":800,"height":600}"#
                .to_string(),
        ),
    ];
    let mut lines = input.into_iter();

    let (request, handshake) = read_connect_request(&mut lines).expect("connect request");

    assert_eq!(handshake, Handshake::V2);
    assert_eq!(request.destination, "host:5900");
    assert_eq!(request.password.as_deref(), Some("secret"));
}

#[test]
fn accepts_connect_without_client_hello() {
    let input = vec![Ok(
        r#"{"type":"Connect","destination":"host:5900","username":null,"password":null,"domain":null,"width":800,"height":600}"#
            .to_string(),
    )];
    let mut lines = input.into_iter();

    let (request, handshake) = read_connect_request(&mut lines).expect("legacy connect request");

    assert_eq!(handshake, Handshake::Legacy);
    assert_eq!(request.destination, "host:5900");
}

#[test]
fn rejects_client_hello_with_unsupported_version() {
    let input = vec![Ok(
        r#"{"type":"ClientHello","protocol_version":1,"app_version":"0.23.1"}"#.to_string(),
    )];
    let mut lines = input.into_iter();

    let error = read_connect_request(&mut lines).expect_err("version mismatch must fail");

    assert!(
        error
            .to_string()
            .contains("unsupported helper protocol version 1")
    );
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
