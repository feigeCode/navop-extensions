use std::collections::VecDeque;
use std::fmt;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};

use crate::protocol::{HelperEvent, HelperFrameRect};

pub struct OutputSender {
    shared: Arc<Shared>,
}

pub struct OutputReceiver {
    shared: Arc<Shared>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MailboxClosed;

struct Shared {
    state: Mutex<State>,
    ready: Condvar,
}

struct State {
    control: VecDeque<HelperEvent>,
    latest_frame: Option<HelperEvent>,
    latest_delta: Option<HelperEvent>,
    sender_count: usize,
    receiver_alive: bool,
}

pub fn output_mailbox() -> (OutputSender, OutputReceiver) {
    let shared = Arc::new(Shared {
        state: Mutex::new(State {
            control: VecDeque::new(),
            latest_frame: None,
            latest_delta: None,
            sender_count: 1,
            receiver_alive: true,
        }),
        ready: Condvar::new(),
    });
    (
        OutputSender {
            shared: shared.clone(),
        },
        OutputReceiver { shared },
    )
}

impl OutputSender {
    pub fn send(&self, event: HelperEvent) -> Result<(), MailboxClosed> {
        let mut state = lock(&self.shared);
        if !state.receiver_alive {
            return Err(MailboxClosed);
        }
        match event {
            frame @ HelperEvent::FrameBgraBytes { .. } => {
                state.latest_frame = Some(frame);
                state.latest_delta = None;
            }
            delta @ HelperEvent::FrameBgraRects { .. } => {
                state.latest_delta = Some(match state.latest_delta.take() {
                    Some(previous) => merge_deltas(previous, delta),
                    None => normalize_delta(delta),
                });
            }
            terminal @ (HelperEvent::ConnectionFailure { .. } | HelperEvent::Terminated { .. }) => {
                state.latest_frame = None;
                state.latest_delta = None;
                discard_pending_cursor_events(&mut state.control);
                state.control.push_back(terminal);
            }
            reconnecting @ HelperEvent::Reconnecting { .. } => {
                discard_pending_cursor_events(&mut state.control);
                state.control.push_back(reconnecting);
            }
            control => enqueue_control(&mut state.control, control),
        }
        drop(state);
        self.shared.ready.notify_one();
        Ok(())
    }
}

impl Clone for OutputSender {
    fn clone(&self) -> Self {
        lock(&self.shared).sender_count += 1;
        Self {
            shared: self.shared.clone(),
        }
    }
}

impl Drop for OutputSender {
    fn drop(&mut self) {
        let mut state = lock(&self.shared);
        state.sender_count = state.sender_count.saturating_sub(1);
        let closed = state.sender_count == 0;
        drop(state);
        if closed {
            self.shared.ready.notify_all();
        }
    }
}

impl OutputReceiver {
    pub fn recv(&self) -> Option<HelperEvent> {
        let mut state = lock(&self.shared);
        loop {
            if let Some(control) = state.control.pop_front() {
                return Some(control);
            }
            if let Some(frame) = state.latest_frame.take() {
                return Some(frame);
            }
            if let Some(delta) = state.latest_delta.take() {
                return Some(delta);
            }
            if state.sender_count == 0 {
                return None;
            }
            state = self
                .shared
                .ready
                .wait(state)
                .unwrap_or_else(|error| error.into_inner());
        }
    }
}

impl Drop for OutputReceiver {
    fn drop(&mut self) {
        let mut state = lock(&self.shared);
        state.receiver_alive = false;
        state.control.clear();
        state.latest_frame = None;
        state.latest_delta = None;
        drop(state);
        self.shared.ready.notify_all();
    }
}

fn merge_deltas(previous: HelperEvent, next: HelperEvent) -> HelperEvent {
    match (previous, next) {
        (
            HelperEvent::FrameBgraRects {
                width,
                height,
                rects,
                bgra,
            },
            HelperEvent::FrameBgraRects {
                width: next_width,
                height: next_height,
                rects: next_rects,
                bgra: next_bgra,
            },
        ) if width == next_width && height == next_height => {
            let (rects, bgra) = merge_delta_payload(rects, bgra, next_rects, next_bgra);
            HelperEvent::FrameBgraRects {
                width,
                height,
                rects,
                bgra,
            }
        }
        (_, next) => next,
    }
}

/// Upper bound on the rectangles a merged delta may carry. Past it the helper stops
/// trimming and appends instead, so a pathological stream cannot grow a payload without
/// limit.
const MAX_MERGED_DELTA_RECTS: usize = 4096;

/// Folds the newer update's rectangles into the pending payload.
///
/// The newer update supersedes every pixel it covers, so the part of an earlier
/// rectangle that it covers can leave the payload instead of being applied first and
/// overwritten right after. Without this, a queue of overlapping repaints (a scroll band,
/// then the repaint on top of it) ships the shared pixels once per repaint, which is what
/// turns one screen change into tens of megabytes downstream.
fn merge_delta_payload(
    rects: Vec<HelperFrameRect>,
    bgra: Vec<u8>,
    next_rects: Vec<HelperFrameRect>,
    next_bgra: Vec<u8>,
) -> (Vec<HelperFrameRect>, Vec<u8>) {
    let entries = fold_payload(split_payload(&rects, &bgra), split_payload(&next_rects, &next_bgra));
    join_payload(entries)
}

/// Trims a delta against itself, so the rectangles it carries stop covering each other.
///
/// One update paints all of its rectangles from the same composited image, so where two
/// of them overlap the later one already writes the same pixels.
fn normalize_delta(event: HelperEvent) -> HelperEvent {
    match event {
        HelperEvent::FrameBgraRects {
            width,
            height,
            rects,
            bgra,
        } => {
            let entries = fold_payload(Vec::new(), split_payload(&rects, &bgra));
            let (rects, bgra) = join_payload(entries);
            HelperEvent::FrameBgraRects {
                width,
                height,
                rects,
                bgra,
            }
        }
        event => event,
    }
}

/// Applies `covers` to `entries` in order, trimming from the earlier rectangles whatever a
/// later one covers. The result holds pairwise disjoint rectangles carrying every pixel of
/// the union exactly once.
fn fold_payload(mut entries: Vec<DeltaEntry>, covers: Vec<DeltaEntry>) -> Vec<DeltaEntry> {
    for (cover, cover_pixels) in covers {
        if entries.len() > MAX_MERGED_DELTA_RECTS {
            entries.push((cover, cover_pixels));
            continue;
        }

        let mut trimmed = Vec::with_capacity(entries.len() + 1);
        for (rect, pixels) in entries {
            trim_covered_pixels(&rect, &pixels, &cover, &mut trimmed);
        }
        trimmed.push((cover, cover_pixels));
        entries = trimmed;
    }

    entries
}

/// A rectangle of a delta together with the pixels it occupies in the payload.
type DeltaEntry = (HelperFrameRect, Vec<u8>);

fn split_payload(rects: &[HelperFrameRect], bgra: &[u8]) -> Vec<DeltaEntry> {
    let mut entries = Vec::with_capacity(rects.len());
    let mut offset = 0usize;

    for rect in rects {
        let end = offset.saturating_add(rect.byte_len);
        entries.push((
            rect.clone(),
            bgra.get(offset..end).unwrap_or_default().to_vec(),
        ));
        offset = end;
    }

    entries
}

fn join_payload(entries: Vec<DeltaEntry>) -> (Vec<HelperFrameRect>, Vec<u8>) {
    let mut rects = Vec::with_capacity(entries.len());
    let mut bgra = Vec::new();

    for (rect, pixels) in entries {
        bgra.extend_from_slice(&pixels);
        rects.push(HelperFrameRect {
            byte_len: pixels.len(),
            ..rect
        });
    }

    (rects, bgra)
}

/// Pushes `rect` minus `cover`, with the matching pixels, into `parts`.
fn trim_covered_pixels(
    rect: &HelperFrameRect,
    pixels: &[u8],
    cover: &HelperFrameRect,
    parts: &mut Vec<DeltaEntry>,
) {
    let rect_left = usize::from(rect.x);
    let rect_top = usize::from(rect.y);
    let rect_right = rect_left + usize::from(rect.width);
    let rect_bottom = rect_top + usize::from(rect.height);

    let cover_left = usize::from(cover.x);
    let cover_top = usize::from(cover.y);
    let cover_right = cover_left + usize::from(cover.width);
    let cover_bottom = cover_top + usize::from(cover.height);

    let left = cover_left.max(rect_left);
    let top = cover_top.max(rect_top);
    let right = cover_right.min(rect_right);
    let bottom = cover_bottom.min(rect_bottom);

    if left >= right || top >= bottom {
        parts.push((rect.clone(), pixels.to_vec()));
        return;
    }

    // The rows outside the covered band survive whole, inside it only the columns next to
    // the covered one do.
    push_band(rect, pixels, rect_top, top, rect_left, rect_right, parts);
    push_band(rect, pixels, bottom, rect_bottom, rect_left, rect_right, parts);
    push_band(rect, pixels, top, bottom, rect_left, left, parts);
    push_band(rect, pixels, top, bottom, right, rect_right, parts);
}

/// Copies the rows `[row_start, row_end)` and columns `[column_start, column_end)` of
/// `rect` out of `pixels` into a part of its own.
#[allow(clippy::too_many_arguments)]
fn push_band(
    rect: &HelperFrameRect,
    pixels: &[u8],
    row_start: usize,
    row_end: usize,
    column_start: usize,
    column_end: usize,
    parts: &mut Vec<DeltaEntry>,
) {
    if row_start >= row_end || column_start >= column_end {
        return;
    }

    let rect_left = usize::from(rect.x);
    let rect_top = usize::from(rect.y);
    let stride = usize::from(rect.width) * 4;
    let band_width = column_end - column_start;
    let mut band = Vec::with_capacity(band_width * (row_end - row_start) * 4);

    for row in row_start..row_end {
        let start = (row - rect_top) * stride + (column_start - rect_left) * 4;
        let end = start + band_width * 4;
        let Some(slice) = pixels.get(start..end) else {
            // A truncated payload: keep nothing rather than half a band.
            return;
        };
        band.extend_from_slice(slice);
    }

    // Every coordinate is a sub-range of `rect`'s fields, so it stays within `u16`.
    #[allow(clippy::cast_possible_truncation)]
    let part = HelperFrameRect {
        x: column_start as u16,
        y: row_start as u16,
        width: band_width as u16,
        height: (row_end - row_start) as u16,
        byte_len: band.len(),
    };
    parts.push((part, band));
}

fn enqueue_control(control: &mut VecDeque<HelperEvent>, event: HelperEvent) {
    match (control.back_mut(), event) {
        (
            Some(HelperEvent::CursorPosition { x, y }),
            HelperEvent::CursorPosition {
                x: next_x,
                y: next_y,
            },
        ) => {
            *x = next_x;
            *y = next_y;
        }
        (
            Some(previous @ HelperEvent::CursorRgbaBytes { .. }),
            next @ HelperEvent::CursorRgbaBytes { .. },
        ) => *previous = next,
        (_, event) => control.push_back(event),
    }
}

fn discard_pending_cursor_events(control: &mut VecDeque<HelperEvent>) {
    control.retain(|event| {
        !matches!(
            event,
            HelperEvent::CursorDefault
                | HelperEvent::CursorHidden
                | HelperEvent::CursorPosition { .. }
                | HelperEvent::CursorRgbaBytes { .. }
        )
    });
}

impl fmt::Debug for OutputSender {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.debug_struct("OutputSender").finish()
    }
}

impl fmt::Debug for OutputReceiver {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.debug_struct("OutputReceiver").finish()
    }
}

impl fmt::Display for MailboxClosed {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("RDP helper output mailbox is closed")
    }
}

impl std::error::Error for MailboxClosed {}

fn lock(shared: &Shared) -> MutexGuard<'_, State> {
    shared
        .state
        .lock()
        .unwrap_or_else(|error| error.into_inner())
}

#[cfg(test)]
#[path = "output_mailbox_tests.rs"]
mod tests;
