use super::*;
use crate::protocol::HelperFrameRect;

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

#[test]
fn coalesces_adjacent_cursor_positions() {
    let (tx, rx) = output_mailbox();
    tx.send(HelperEvent::CursorPosition { x: 1, y: 2 }).unwrap();
    tx.send(HelperEvent::CursorPosition { x: 3, y: 4 }).unwrap();

    assert_eq!(Some(HelperEvent::CursorPosition { x: 3, y: 4 }), rx.recv());
}

#[test]
fn coalesces_adjacent_cursor_bitmaps_without_crossing_state_boundaries() {
    let (tx, rx) = output_mailbox();
    tx.send(cursor(1)).unwrap();
    tx.send(cursor(2)).unwrap();
    tx.send(HelperEvent::CursorHidden).unwrap();
    tx.send(cursor(3)).unwrap();

    assert_eq!(Some(cursor(2)), rx.recv());
    assert_eq!(Some(HelperEvent::CursorHidden), rx.recv());
    assert_eq!(Some(cursor(3)), rx.recv());
}

#[test]
fn reconnect_barrier_discards_pending_cursor_state() {
    let (tx, rx) = output_mailbox();
    tx.send(HelperEvent::CursorPosition { x: 1, y: 2 }).unwrap();
    tx.send(cursor(1)).unwrap();
    tx.send(HelperEvent::Reconnecting {
        reason: crate::protocol::HelperReconnectReason::ConnectionLost,
        delay_secs: Some(1),
    })
    .unwrap();

    assert_eq!(
        Some(HelperEvent::Reconnecting {
            reason: crate::protocol::HelperReconnectReason::ConnectionLost,
            delay_secs: Some(1),
        }),
        rx.recv()
    );
}

#[test]
fn merging_drops_an_earlier_rectangle_the_newer_update_covers_completely() {
    let (tx, rx) = output_mailbox();
    tx.send(delta_rects(&[(0, 0, 100, 100)])).unwrap();
    tx.send(delta_rects(&[(0, 0, 100, 100)])).unwrap();

    let Some(HelperEvent::FrameBgraRects { rects, bgra, .. }) = rx.recv() else {
        panic!("expected a merged delta");
    };

    // The repaint supersedes the identical earlier rectangle, so its pixels are not
    // shipped a second time.
    assert_eq!(1, rects.len());
    assert_eq!(100 * 100 * 4, bgra.len());
}

#[test]
fn merging_drops_a_rectangle_split_across_several_newer_rectangles() {
    let (tx, rx) = output_mailbox();
    tx.send(delta_rects(&[(0, 0, 100, 100)])).unwrap();
    tx.send(delta_rects(&[(0, 0, 100, 40), (0, 40, 100, 60)])).unwrap();

    let Some(HelperEvent::FrameBgraRects { rects, bgra, .. }) = rx.recv() else {
        panic!("expected a merged delta");
    };

    // The two newer rectangles together cover the band the earlier one damaged.
    assert_eq!(2, rects.len());
    assert_eq!(100 * 100 * 4, bgra.len());
}

#[test]
fn merging_keeps_a_rectangle_that_is_only_partly_covered() {
    let (tx, rx) = output_mailbox();
    tx.send(delta_rects(&[(0, 0, 100, 100)])).unwrap();
    tx.send(delta_rects(&[(10, 10, 20, 20)])).unwrap();

    let Some(HelperEvent::FrameBgraRects { rects, bgra, .. }) = rx.recv() else {
        panic!("expected a merged delta");
    };

    // The rest of the earlier rectangle still has to reach the embedder, cut into the
    // pieces the newer rectangle left behind.
    assert_eq!(5, rects.len());
    assert_eq!(100 * 100 * 4, bgra.len());
}

#[test]
fn merged_payload_keeps_the_pixels_of_the_rectangles_it_keeps() {
    let (tx, rx) = output_mailbox();
    tx.send(delta_rects(&[(0, 0, 10, 10), (50, 50, 10, 10)])).unwrap();
    tx.send(delta_rects(&[(0, 0, 10, 10)])).unwrap();

    let Some(HelperEvent::FrameBgraRects { rects, bgra, .. }) = rx.recv() else {
        panic!("expected a merged delta");
    };

    // The dropped rectangle's block is gone from the payload, and the remaining blocks
    // stay in order next to the newer update.
    assert_eq!(vec![(50, 50, 10, 10), (0, 0, 10, 10)].len(), rects.len());
    assert_eq!((50, 50), (rects[0].x, rects[0].y));
    assert_eq!((0, 0), (rects[1].x, rects[1].y));
    assert_eq!(10 * 10 * 4 * 2, bgra.len());
    let block = 10 * 10 * 4;
    assert!(bgra[..block].iter().all(|byte| *byte == 2));
    assert!(bgra[block..].iter().all(|byte| *byte == 1));
}

#[test]
fn merged_rectangles_never_overlap() {
    let width = 8u16;
    let height = 8u16;

    let mut state = 12345u64;
    let mut random = move || {
        state = state
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        ((state >> 33) % 65_536) as u32
    };

    for attempt in 0..5_000u32 {
        let mut updates = Vec::new();
        for _ in 0..2 {
            let count = 1 + random() % 2;
            let mut boxes = Vec::new();
            for _ in 0..count {
                let x = u16::try_from(random() % u32::from(width)).unwrap();
                let y = u16::try_from(random() % u32::from(height)).unwrap();
                let w = 1 + u16::try_from(random() % u32::from(width - x)).unwrap();
                let h = 1 + u16::try_from(random() % u32::from(height - y)).unwrap();
                boxes.push((x, y, w, h));
            }
            updates.push(boxes);
        }

        let HelperEvent::FrameBgraRects {
            rects: first_rects,
            bgra: first_bgra,
            ..
        } = normalize_delta(delta_boxes(&updates[0], 1))
        else {
            panic!("expected a delta");
        };
        let HelperEvent::FrameBgraRects {
            rects: second_rects,
            bgra: second_bgra,
            ..
        } = normalize_delta(delta_boxes(&updates[1], 2))
        else {
            panic!("expected a delta");
        };

        let (rects, _) = merge_delta_payload(first_rects, first_bgra, second_rects, second_bgra);

        for (index, first) in rects.iter().enumerate() {
            for second in &rects[index + 1..] {
                let left = first.x.max(second.x);
                let top = first.y.max(second.y);
                let right = (first.x + first.width).min(second.x + second.width);
                let bottom = (first.y + first.height).min(second.y + second.height);
                assert!(
                    left >= right || top >= bottom,
                    "attempt {attempt}: {updates:?} merged into overlapping rectangles",
                );
            }
        }
    }
}

#[test]
fn merged_deltas_reproduce_the_updates_they_fold_together() {
    let width = 32u16;
    let height = 32u16;

    for seed in 1..40u64 {
        let mut state = seed.wrapping_mul(0x9e37_79b9_7f4a_7c15).wrapping_add(1);
        let mut random = move || {
            state = state
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            ((state >> 33) % 65_536) as u32
        };

        let updates: Vec<HelperEvent> = (0..5)
            .map(|index| {
                let value = u8::try_from(index + 1).unwrap();
                let count = 1 + random() % 4;
                let mut boxes = Vec::new();
                for _ in 0..count {
                    let x = u16::try_from(random() % u32::from(width)).unwrap();
                    let y = u16::try_from(random() % u32::from(height)).unwrap();
                    let w = 1 + u16::try_from(random() % u32::from(width - x)).unwrap();
                    let h = 1 + u16::try_from(random() % u32::from(height - y)).unwrap();
                    boxes.push((x, y, w, h));
                }
                delta_boxes(&boxes, value)
            })
            .collect();

        // What the embedder draws when it applies every update as it arrives, and which
        // pixels the updates touched at all.
        let mut expected = vec![0u32; usize::from(width) * usize::from(height)];
        let mut covered = vec![false; usize::from(width) * usize::from(height)];
        for update in &updates {
            let HelperEvent::FrameBgraRects { rects, bgra, .. } = update else {
                panic!("expected a delta");
            };
            apply_delta(&mut expected, width, rects, bgra);
            for rect in rects {
                for row in rect.y..rect.y + rect.height {
                    for column in rect.x..rect.x + rect.width {
                        covered[usize::from(row) * usize::from(width) + usize::from(column)] = true;
                    }
                }
            }
        }

        let (tx, rx) = output_mailbox();
        for update in updates {
            tx.send(update).unwrap();
        }
        let Some(HelperEvent::FrameBgraRects { rects, bgra, .. }) = rx.recv() else {
            panic!("expected a merged delta");
        };

        let mut actual = vec![0u32; usize::from(width) * usize::from(height)];
        apply_delta(&mut actual, width, &rects, &bgra);

        // Folding the updates together must not change a single pixel.
        assert_eq!(expected, actual, "seed {seed} changed the drawn image");
        // The payload carries every pixel the updates touched exactly once, and nothing
        // else.
        let mut overlap = 0usize;
        for (index, first) in rects.iter().enumerate() {
            for second in &rects[index + 1..] {
                let left = first.x.max(second.x);
                let top = first.y.max(second.y);
                let right = (first.x + first.width).min(second.x + second.width);
                let bottom = (first.y + first.height).min(second.y + second.height);
                if left < right && top < bottom {
                    overlap += usize::from(right - left) * usize::from(bottom - top) * 4;
                }
            }
        }
        assert_eq!(0, overlap, "seed {seed} shipped overlapping rectangles");
        assert_eq!(
            covered.iter().filter(|pixel| **pixel).count() * 4,
            bgra.len(),
            "seed {seed} shipped more than the union of the updates",
        );
    }
}

fn apply_delta(canvas: &mut [u32], width: u16, rects: &[HelperFrameRect], bgra: &[u8]) {
    let mut offset = 0usize;
    for rect in rects {
        let block = &bgra[offset..offset + rect.byte_len];
        offset += rect.byte_len;
        for row in 0..rect.height {
            for column in 0..rect.width {
                let pixel = (usize::from(row) * usize::from(rect.width) + usize::from(column)) * 4;
                let value = u32::from_le_bytes(block[pixel..pixel + 4].try_into().unwrap());
                let index =
                    usize::from(rect.y + row) * usize::from(width) + usize::from(rect.x + column);
                canvas[index] = value;
            }
        }
    }

    assert_eq!(offset, bgra.len(), "the payload does not match its rectangles");
}

/// A delta whose rectangles are all filled with `value`.
fn delta_boxes(rects: &[(u16, u16, u16, u16)], value: u8) -> HelperEvent {
    let mut frame_rects = Vec::new();
    let mut bgra = Vec::new();
    for (x, y, width, height) in rects {
        let byte_len = usize::from(*width) * usize::from(*height) * 4;
        frame_rects.push(HelperFrameRect {
            x: *x,
            y: *y,
            width: *width,
            height: *height,
            byte_len,
        });
        for _ in 0..byte_len / 4 {
            bgra.extend_from_slice(&u32::from(value).to_le_bytes());
        }
    }

    HelperEvent::FrameBgraRects {
        width: 200,
        height: 200,
        rects: frame_rects,
        bgra,
    }
}

#[test]
fn splits_a_merged_payload_at_the_byte_cap() {
    let mut state = pending_state();
    // Each rectangle carries 400 payload bytes.
    queue_delta_with_cap(&mut state, delta_rects(&[(0, 0, 10, 10)]), 500);
    queue_delta_with_cap(&mut state, delta_rects(&[(50, 50, 10, 10)]), 500);

    // Merging both updates would ship 800 bytes in one event, so the cap splits them into
    // two events that each fit under it.
    assert_eq!(2, state.pending_deltas.len());

    let mut shipped = Vec::new();
    let mut corners = Vec::new();
    for event in state.pending_deltas.drain(..) {
        let HelperEvent::FrameBgraRects { rects, bgra, .. } = event else {
            panic!("expected a delta");
        };
        assert!(bgra.len() <= 500, "chunk of {} bytes exceeds the cap", bgra.len());
        shipped.extend_from_slice(&bgra);
        corners.extend(rects.iter().map(|rect| (rect.x, rect.y)));
    }

    // Both updates still reach the consumer, in order and without loss.
    assert_eq!(800, shipped.len());
    assert_eq!(vec![(0, 0), (50, 50)], corners);
}

#[test]
fn cuts_a_rectangle_that_exceeds_the_cap_into_bands() {
    let mut state = pending_state();
    // One 10x10 rectangle: 400 payload bytes over 10 rows of 40 bytes.
    queue_delta_with_cap(&mut state, delta_rects(&[(0, 0, 10, 10)]), 120);

    let mut rows = 0usize;
    let mut bytes = 0usize;
    for event in state.pending_deltas.drain(..) {
        let HelperEvent::FrameBgraRects { rects, bgra, .. } = event else {
            panic!("expected a delta");
        };
        assert!(bgra.len() <= 120, "chunk of {} bytes exceeds the cap", bgra.len());
        for rect in rects {
            rows += usize::from(rect.height);
            assert_eq!(usize::from(rect.width) * usize::from(rect.height) * 4, rect.byte_len);
        }
        bytes += bgra.len();
    }

    // Every row of the damaged block still arrives exactly once.
    assert_eq!(10, rows);
    assert_eq!(400, bytes);
}

#[test]
fn never_ships_an_event_larger_than_the_cap_when_the_consumer_falls_behind() {
    let mut state = pending_state();

    for index in 0..20u16 {
        let left = (index % 4) * 20;
        let top = (index / 4) * 20;
        queue_delta_with_cap(&mut state, delta_rects(&[(left, top, 10, 10)]), 500);
    }

    // A slow consumer must not turn the backlog into events bigger than the cap: the cap
    // is what keeps a single update's processing time predictable.
    let mut covered = Vec::new();
    for event in state.pending_deltas.drain(..) {
        let HelperEvent::FrameBgraRects { rects, bgra, .. } = event else {
            panic!("expected a delta");
        };
        assert!(
            bgra.len() <= 500,
            "event of {} bytes exceeds the cap",
            bgra.len()
        );
        for rect in rects {
            covered.push((rect.x, rect.y));
        }
    }

    for index in 0..20u16 {
        let expected = ((index % 4) * 20, (index / 4) * 20);
        assert!(covered.contains(&expected), "lost the update at {expected:?}");
    }
}

#[test]
fn folds_overlapping_updates_while_a_slow_consumer_catches_up() {
    let mut state = pending_state();

    for _ in 0..20 {
        queue_delta_with_cap(&mut state, delta_rects(&[(0, 0, 10, 10)]), 500);
    }

    // Repaints of the same block share their pixels, so folding them keeps the backlog
    // bounded instead of queueing one event per repaint.
    assert!(
        state.pending_deltas.len() <= MAX_PENDING_DELTA_EVENTS,
        "queued {} events",
        state.pending_deltas.len()
    );
    assert!(
        queued_bytes(&state) < 20 * 400,
        "kept {} bytes of 20 identical repaints",
        queued_bytes(&state)
    );
}

fn pending_state() -> State {
    State {
        control: VecDeque::new(),
        latest_frame: None,
        pending_deltas: VecDeque::new(),
        sender_count: 1,
        receiver_alive: true,
    }
}

/// A delta whose rectangles are filled with their index, so a test can tell which
/// pixels survived a merge.
fn delta_rects(rects: &[(u16, u16, u16, u16)]) -> HelperEvent {
    let mut frame_rects = Vec::new();
    let mut bgra = Vec::new();
    for (index, (x, y, width, height)) in rects.iter().enumerate() {
        let byte_len = usize::from(*width) * usize::from(*height) * 4;
        frame_rects.push(HelperFrameRect {
            x: *x,
            y: *y,
            width: *width,
            height: *height,
            byte_len,
        });
        bgra.extend(std::iter::repeat_n(u8::try_from(index + 1).unwrap(), byte_len));
    }

    HelperEvent::FrameBgraRects {
        width: 200,
        height: 200,
        rects: frame_rects,
        bgra,
    }
}

fn frame(value: u8) -> HelperEvent {
    HelperEvent::frame(1, 1, vec![value, 0, 0, 255])
}

fn cursor(value: u8) -> HelperEvent {
    HelperEvent::CursorRgbaBytes {
        width: 1,
        height: 1,
        hotspot_x: 0,
        hotspot_y: 0,
        rgba: vec![value, 0, 0, 255],
    }
}
