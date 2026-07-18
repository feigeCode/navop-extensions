use anyhow::Context as _;
use ironrdp::input::{Database, MouseButton, MousePosition, Operation, Scancode, WheelRotations};
use ironrdp_client::rdp::{DvcPipeProxyFactory, RdpClient, RdpInputEvent, RdpOutputEvent};
use smallvec::SmallVec;
use tokio::sync::mpsc;

use crate::clipboard::{TextClipboardController, text_clipboard};
use crate::output_mailbox::{OutputReceiver, OutputSender, output_mailbox};
use crate::protocol::{ConnectRequest, HelperEvent, HelperMouseButton, HelperRequest};

mod config;
mod output;

use output::RdpOutputMapper;

pub struct RdpRuntime {
    pub input_tx: mpsc::UnboundedSender<RdpInputEvent>,
    pub output_rx: OutputReceiver,
    pub clipboard: TextClipboardController,
}

pub fn start(connect: ConnectRequest) -> anyhow::Result<RdpRuntime> {
    let config = config::build_config(connect)?;
    let (input_tx, input_rx) = RdpInputEvent::create_channel();
    let (output_tx, output_rx) = mpsc::channel::<RdpOutputEvent>(64);
    let (helper_output_tx, helper_output_rx) = output_mailbox();
    let (clipboard, cliprdr_factory) = text_clipboard(input_tx.clone(), helper_output_tx.clone());
    let dvc_pipe_proxy_factory = DvcPipeProxyFactory::new(input_tx.clone());
    let client = RdpClient {
        config,
        output_event_sender: output_tx,
        input_event_receiver: input_rx,
        cliprdr_factory: Some(cliprdr_factory),
        dvc_pipe_proxy_factory,
    };

    spawn_client_thread(client, output_rx, helper_output_tx)?;
    Ok(RdpRuntime {
        input_tx,
        output_rx: helper_output_rx,
        clipboard,
    })
}

pub fn apply_input_request(
    request: HelperRequest,
    input_tx: &mpsc::UnboundedSender<RdpInputEvent>,
    input_database: &mut Database,
    clipboard: &TextClipboardController,
) -> anyhow::Result<bool> {
    match request {
        HelperRequest::Resize {
            width,
            height,
            scale_factor,
        } => input_tx
            .send(RdpInputEvent::Resize {
                width,
                height,
                scale_factor,
                physical_size: None,
            })
            .map_err(|_| anyhow::anyhow!("RDP input channel closed"))?,
        HelperRequest::MouseMove { x, y } => send_operations(
            input_database,
            input_tx,
            [Operation::MouseMove(MousePosition { x, y })],
        ),
        HelperRequest::MouseButton { button, pressed } => send_operations(
            input_database,
            input_tx,
            [mouse_button_operation(button, pressed)],
        ),
        HelperRequest::Wheel { vertical, units } => send_operations(
            input_database,
            input_tx,
            [Operation::WheelRotations(WheelRotations {
                is_vertical: vertical,
                rotation_units: units,
            })],
        ),
        HelperRequest::Key {
            code,
            extended,
            pressed,
        } => send_operations(
            input_database,
            input_tx,
            [key_operation(code, extended, pressed)?],
        ),
        HelperRequest::Text { text } => send_text(input_database, input_tx, &text),
        HelperRequest::ClipboardText { text } => clipboard.set_local_text(text)?,
        HelperRequest::ClipboardFiles { paths } => clipboard.set_local_files(paths)?,
        HelperRequest::Close => {
            input_tx
                .send(RdpInputEvent::Close)
                .map_err(|_| anyhow::anyhow!("RDP input channel closed"))?;
            return Ok(false);
        }
        HelperRequest::Connect { .. } => {
            anyhow::bail!("Connect request is only valid as the first message")
        }
    }
    Ok(true)
}

fn spawn_client_thread(
    client: RdpClient,
    mut output_rx: mpsc::Receiver<RdpOutputEvent>,
    helper_output_tx: OutputSender,
) -> anyhow::Result<()> {
    std::thread::Builder::new()
        .name("onetcli-rdp-helper-runtime".to_string())
        .spawn(move || {
            let runtime = tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build();
            let Ok(runtime) = runtime else {
                let _ = helper_output_tx.send(HelperEvent::ConnectionFailure {
                    message: "failed to create RDP tokio runtime".to_string(),
                });
                return;
            };

            let output_sender = helper_output_tx.clone();
            runtime.spawn(async move {
                let mut output_mapper = RdpOutputMapper::default();
                while let Some(event) = output_rx.recv().await {
                    for helper_event in output_mapper.map(event) {
                        if output_sender.send(helper_event).is_err() {
                            return;
                        }
                    }
                }
            });
            runtime.block_on(client.run());
        })
        .context("spawn RDP client thread")?;
    Ok(())
}

fn send_operations<const N: usize>(
    input_database: &mut Database,
    input_tx: &mpsc::UnboundedSender<RdpInputEvent>,
    operations: [Operation; N],
) {
    send_fast_path(input_tx, input_database.apply(operations));
}

fn send_text(
    input_database: &mut Database,
    input_tx: &mpsc::UnboundedSender<RdpInputEvent>,
    text: &str,
) {
    for character in text.chars() {
        send_operations(
            input_database,
            input_tx,
            [
                Operation::UnicodeKeyPressed(character),
                Operation::UnicodeKeyReleased(character),
            ],
        );
    }
}

fn send_fast_path(
    input_tx: &mpsc::UnboundedSender<RdpInputEvent>,
    events: SmallVec<[ironrdp::pdu::input::fast_path::FastPathInputEvent; 2]>,
) {
    if !events.is_empty() {
        let _ = input_tx.send(RdpInputEvent::FastPath(events));
    }
}

fn mouse_button_operation(button: HelperMouseButton, pressed: bool) -> Operation {
    let button = match button {
        HelperMouseButton::Left => MouseButton::Left,
        HelperMouseButton::Middle => MouseButton::Middle,
        HelperMouseButton::Right => MouseButton::Right,
        HelperMouseButton::X1 => MouseButton::X1,
        HelperMouseButton::X2 => MouseButton::X2,
    };
    if pressed {
        Operation::MouseButtonPressed(button)
    } else {
        Operation::MouseButtonReleased(button)
    }
}

fn key_operation(code: u16, extended: bool, pressed: bool) -> anyhow::Result<Operation> {
    let code = u8::try_from(code).context("RDP scancode must fit in u8")?;
    let scancode = Scancode::from_u8(extended, code);
    Ok(if pressed {
        Operation::KeyPressed(scancode)
    } else {
        Operation::KeyReleased(scancode)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_operation_builds_plain_scancode_events() {
        let operation = key_operation(0x39, false, true).expect("space key operation");
        assert_key_operation(operation, true, false, 0x39);
    }

    #[test]
    fn key_operation_builds_extended_scancode_events() {
        let operation = key_operation(0x48, true, false).expect("arrow key operation");
        assert_key_operation(operation, false, true, 0x48);
    }

    #[test]
    fn key_operation_rejects_out_of_range_scancode() {
        assert!(key_operation(0x100, false, true).is_err());
    }

    #[test]
    fn runtime_uses_coalescing_output_receiver() {
        fn assert_receiver(runtime: &RdpRuntime) {
            let _: &crate::output_mailbox::OutputReceiver = &runtime.output_rx;
        }
        let _contract: fn(&RdpRuntime) = assert_receiver;
    }

    #[test]
    fn apply_clipboard_text_request_advertises_local_text() {
        let (input_tx, mut input_rx) = RdpInputEvent::create_channel();
        let (output_tx, _output_rx) = output_mailbox();
        let (clipboard, _factory) = text_clipboard(input_tx.clone(), output_tx);
        let mut input_database = Database::new();

        let keep_running = apply_input_request(
            HelperRequest::ClipboardText {
                text: "local 中文".to_string(),
            },
            &input_tx,
            &mut input_database,
            &clipboard,
        )
        .expect("clipboard request applies");

        assert!(keep_running);
        match input_rx.try_recv().expect("clipboard advertise") {
            RdpInputEvent::Clipboard(
                ironrdp::cliprdr::backend::ClipboardMessage::SendInitiateCopy(formats),
            ) => assert!(formats.iter().any(|format| {
                format.id() == ironrdp::cliprdr::pdu::ClipboardFormatId::CF_UNICODETEXT
            })),
            other => panic!("expected clipboard advertise, got {other:?}"),
        }
    }

    fn assert_key_operation(
        operation: Operation,
        expected_pressed: bool,
        expected_extended: bool,
        expected_code: u8,
    ) {
        let (pressed, scancode) = match operation {
            Operation::KeyPressed(scancode) => (true, scancode),
            Operation::KeyReleased(scancode) => (false, scancode),
            other => panic!("expected key operation, got {other:?}"),
        };
        assert_eq!(expected_pressed, pressed);
        assert_eq!((expected_extended, expected_code), scancode.as_u8());
    }
}
