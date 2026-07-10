use ironrdp_client::rdp::RdpOutputEvent;

use crate::pixels::rdp_u32_pixels_to_bgra;
use crate::protocol::HelperEvent;

#[derive(Default)]
pub(super) struct RdpOutputMapper {
    connected: bool,
}

impl RdpOutputMapper {
    pub(super) fn map(&mut self, event: RdpOutputEvent) -> Vec<HelperEvent> {
        match event {
            RdpOutputEvent::Image {
                buffer,
                width,
                height,
            } => {
                let width = width.get();
                let height = height.get();
                let mut events = Vec::with_capacity(if self.connected { 1 } else { 2 });
                if !self.connected {
                    events.push(HelperEvent::Connected { width, height });
                    self.connected = true;
                }
                events.push(HelperEvent::frame(
                    width,
                    height,
                    rdp_u32_pixels_to_bgra(&buffer),
                ));
                events
            }
            RdpOutputEvent::ConnectionFailure(error) => vec![HelperEvent::ConnectionFailure {
                message: format!("{error:#}"),
            }],
            RdpOutputEvent::Terminated(result) => vec![HelperEvent::Terminated {
                message: match result {
                    Ok(reason) => reason.to_string(),
                    Err(error) => format!("{error:#}"),
                },
            }],
            RdpOutputEvent::PointerDefault => vec![HelperEvent::CursorDefault],
            RdpOutputEvent::PointerHidden => vec![HelperEvent::CursorHidden],
            RdpOutputEvent::PointerPosition { x, y } => {
                vec![HelperEvent::CursorPosition { x, y }]
            }
            RdpOutputEvent::PointerBitmap(_) => vec![HelperEvent::CursorDefault],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reports_connected_only_when_first_frame_arrives() {
        let mut mapper = RdpOutputMapper::default();
        let first = mapper.map(RdpOutputEvent::Image {
            buffer: vec![0x00112233],
            width: std::num::NonZeroU16::new(1).unwrap(),
            height: std::num::NonZeroU16::new(1).unwrap(),
        });

        assert_eq!(
            first,
            vec![
                HelperEvent::Connected {
                    width: 1,
                    height: 1
                },
                HelperEvent::frame(1, 1, vec![0x33, 0x22, 0x11, 0xff])
            ]
        );

        let second = mapper.map(RdpOutputEvent::Image {
            buffer: vec![0x00abcdef],
            width: std::num::NonZeroU16::new(1).unwrap(),
            height: std::num::NonZeroU16::new(1).unwrap(),
        });
        assert_eq!(
            second,
            vec![HelperEvent::frame(1, 1, vec![0xef, 0xcd, 0xab, 0xff])]
        );
    }
}
