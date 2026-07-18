use super::*;

#[test]
fn keeps_only_latest_pending_frame() {
    let (tx, rx) = output_mailbox();
    tx.send(frame(1)).unwrap();
    tx.send(frame(2)).unwrap();
    tx.send(frame(3)).unwrap();

    assert_eq!(Some(frame(3)), rx.recv());
}

#[test]
fn preserves_control_order_while_replacing_frames() {
    let (tx, rx) = output_mailbox();
    tx.send(HelperEvent::Status {
        message: "one".into(),
    })
    .unwrap();
    tx.send(frame(1)).unwrap();
    tx.send(HelperEvent::ClipboardText { text: "two".into() })
        .unwrap();
    tx.send(frame(2)).unwrap();

    assert_eq!(
        Some(HelperEvent::Status {
            message: "one".into()
        }),
        rx.recv()
    );
    assert_eq!(
        Some(HelperEvent::ClipboardText { text: "two".into() }),
        rx.recv()
    );
    assert_eq!(Some(frame(2)), rx.recv());
}

#[test]
fn terminal_event_discards_pending_frame() {
    let (tx, rx) = output_mailbox();
    tx.send(frame(7)).unwrap();
    tx.send(HelperEvent::Terminated {
        message: "closed".into(),
    })
    .unwrap();

    assert_eq!(
        Some(HelperEvent::Terminated {
            message: "closed".into()
        }),
        rx.recv()
    );
    drop(tx);
    assert_eq!(None, rx.recv());
}

#[test]
fn keeps_keyframe_when_coalescing_dirty_rectangles() {
    let (tx, rx) = output_mailbox();
    tx.send(HelperEvent::frame(128, 128, vec![0; 128 * 128 * 4]))
        .unwrap();
    tx.send(HelperEvent::FrameBgraRects {
        width: 128,
        height: 128,
        rects: vec![crate::protocol::HelperFrameRect {
            x: 0,
            y: 0,
            width: 1,
            height: 1,
            byte_len: 4,
        }],
        bgra: vec![1, 2, 3, 255],
    })
    .unwrap();

    assert!(matches!(
        rx.recv(),
        Some(HelperEvent::FrameBgraBytes { .. })
    ));
    assert!(matches!(
        rx.recv(),
        Some(HelperEvent::FrameBgraRects { .. })
    ));
}

#[test]
fn last_sender_drop_wakes_receiver() {
    let (tx, rx) = output_mailbox();
    let waiter = std::thread::spawn(move || rx.recv());

    drop(tx);

    assert_eq!(None, waiter.join().unwrap());
}

#[test]
fn send_fails_after_receiver_is_dropped() {
    let (tx, rx) = output_mailbox();
    drop(rx);

    assert!(tx.send(frame(1)).is_err());
}

fn frame(value: u8) -> HelperEvent {
    HelperEvent::frame(1, 1, vec![value, 0, 0, 255])
}
