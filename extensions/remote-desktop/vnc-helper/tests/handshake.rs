//! End-to-end handshake tests that reproduce the desktop app's transport order.
//!
//! The app writes `ClientHello` and then waits for `ServerHello` *before* it
//! sends `Connect`, so the helper must answer the hello without waiting for the
//! connect request. vnc-helper 0.3.0 only wrote `ServerHello` after reading
//! `Connect` and thus deadlocked against the app until the hello timeout fired.

use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::Duration;

const HELPER_HELLO_TIMEOUT: Duration = Duration::from_secs(10);

fn spawn_helper() -> (Child, ChildStdin, Receiver<String>) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_navop-vnc-helper"))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .expect("spawn vnc helper");
    let stdin = child.stdin.take().expect("helper stdin");
    let stdout = child.stdout.take().expect("helper stdout");
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if tx.send(line).is_err() {
                break;
            }
        }
    });
    (child, stdin, rx)
}

fn write_line(stdin: &mut impl Write, line: &str) {
    writeln!(stdin, "{line}").expect("write helper request");
    stdin.flush().expect("flush helper request");
}

fn read_event(rx: &Receiver<String>) -> String {
    rx.recv_timeout(HELPER_HELLO_TIMEOUT)
        .expect("helper did not answer within the hello timeout")
}

fn stop(mut child: Child) {
    let _ = child.kill();
    let _ = child.wait();
}

#[test]
fn answers_server_hello_before_the_app_sends_connect() {
    let (child, mut stdin, rx) = spawn_helper();

    write_line(
        &mut stdin,
        r#"{"type":"ClientHello","protocol_version":2,"app_version":"0.23.2"}"#,
    );

    // The app has not sent Connect yet; the hello must still arrive.
    let hello = read_event(&rx);
    assert!(
        hello.contains(r#""type":"ServerHello""#),
        "unexpected first event: {hello}"
    );
    assert!(
        hello.contains(r#""protocol_version":2"#),
        "unexpected hello protocol version: {hello}"
    );

    write_line(
        &mut stdin,
        r#"{"type":"Connect","destination":"127.0.0.1:9","username":null,"password":null,"domain":null,"width":800,"height":600}"#,
    );

    let next = read_event(&rx);
    assert!(
        next.contains(r#""type":"Status""#) || next.contains(r#""type":"Reconnecting""#),
        "unexpected event after Connect: {next}"
    );

    stop(child);
}

#[test]
fn legacy_connect_gets_no_server_hello() {
    let (child, mut stdin, rx) = spawn_helper();

    write_line(
        &mut stdin,
        r#"{"type":"Connect","destination":"127.0.0.1:9","username":null,"password":null,"domain":null,"width":800,"height":600}"#,
    );

    let first = read_event(&rx);
    assert!(
        !first.contains(r#""type":"ServerHello""#),
        "legacy apps must not receive a hello: {first}"
    );
    assert!(
        first.contains(r#""type":"Status""#) || first.contains(r#""type":"Reconnecting""#),
        "unexpected first event: {first}"
    );

    stop(child);
}
