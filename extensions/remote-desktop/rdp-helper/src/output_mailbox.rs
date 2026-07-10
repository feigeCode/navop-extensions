use std::collections::VecDeque;
use std::fmt;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};

use crate::protocol::HelperEvent;

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
    sender_count: usize,
    receiver_alive: bool,
}

pub fn output_mailbox() -> (OutputSender, OutputReceiver) {
    let shared = Arc::new(Shared {
        state: Mutex::new(State {
            control: VecDeque::new(),
            latest_frame: None,
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
            frame @ HelperEvent::FrameBgraBytes { .. } => state.latest_frame = Some(frame),
            terminal @ (HelperEvent::ConnectionFailure { .. } | HelperEvent::Terminated { .. }) => {
                state.latest_frame = None;
                state.control.push_back(terminal);
            }
            control => state.control.push_back(control),
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
        drop(state);
        self.shared.ready.notify_all();
    }
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
mod tests {
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
    fn last_sender_drop_wakes_receiver() {
        let (tx, rx) = output_mailbox();
        let waiter = std::thread::spawn(move || rx.recv());

        drop(tx);

        assert_eq!(None, waiter.join().unwrap());
    }

    fn frame(value: u8) -> HelperEvent {
        HelperEvent::frame(1, 1, vec![value, 0, 0, 255])
    }
}
