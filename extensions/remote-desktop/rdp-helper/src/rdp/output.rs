use ironrdp_client::rdp::RdpOutputEvent;

use crate::pixels::rdp_u32_pixels_to_bgra;
use crate::protocol::{HelperEvent, HelperFrameRect, HelperReconnectReason};

#[derive(Default)]
pub(super) struct RdpOutputMapper {
    connected: bool,
    base_size: Option<(u16, u16)>,
    // IronRDP may publish pointer state before its first image. The main
    // process treats `Connected` as the session barrier, so retain only the
    // latest pre-connect appearance and position and flush them after it.
    pending_cursor: PendingCursor,
}

#[derive(Default)]
struct PendingCursor {
    appearance: Option<HelperEvent>,
    position: Option<(u16, u16)>,
}

impl PendingCursor {
    fn record(&mut self, event: HelperEvent) {
        match event {
            HelperEvent::CursorPosition { x, y } => self.position = Some((x, y)),
            event @ (HelperEvent::CursorDefault
            | HelperEvent::CursorHidden
            | HelperEvent::CursorRgbaBytes { .. }) => self.appearance = Some(event),
            _ => debug_assert!(false, "only cursor events may be buffered"),
        }
    }

    fn append_to(&mut self, events: &mut Vec<HelperEvent>) {
        if let Some(appearance) = self.appearance.take() {
            events.push(appearance);
        }
        if let Some((x, y)) = self.position.take() {
            events.push(HelperEvent::CursorPosition { x, y });
        }
    }

    fn clear(&mut self) {
        self.appearance = None;
        self.position = None;
    }
}

impl RdpOutputMapper {
    pub(super) fn map(&mut self, event: RdpOutputEvent) -> Vec<HelperEvent> {
        match event {
            RdpOutputEvent::Connected
            | RdpOutputEvent::LoginComplete
            | RdpOutputEvent::PostLogonDisplayRedraw
            | RdpOutputEvent::MalformedBitmapDisplayRedraw => Vec::new(),
            // Remote monitor layout and RAIL windowing are not negotiated by this
            // provider, so their events carry no host-visible state.
            RdpOutputEvent::MonitorLayout(_)
            | RdpOutputEvent::WindowingOrders(_)
            | RdpOutputEvent::RailHandshake { .. }
            | RdpOutputEvent::RailDesktopSynchronized { .. }
            | RdpOutputEvent::RailPostHandshakeQueueReleased { .. }
            | RdpOutputEvent::RailExecuteResult(_)
            | RdpOutputEvent::RailExecuteFailed { .. }
            | RdpOutputEvent::RailApplicationId { .. }
            | RdpOutputEvent::RailControl(_)
            | RdpOutputEvent::AutoReconnected => Vec::new(),
            // Reconnect cookies are not requested here, so declining is the only
            // correct answer; dropping the response sender stops the reconnect.
            RdpOutputEvent::AutoReconnecting {
                attempt,
                maximum_attempts,
                ..
            } => {
                tracing::debug!(
                    attempt,
                    maximum_attempts,
                    "Declined an RDP auto-reconnect because the provider manages reconnects"
                );
                Vec::new()
            }
            RdpOutputEvent::DisplayResizeFallback(reason) => {
                tracing::warn!(?reason, "RDP dynamic display resize fell back to reconnect");
                self.reset_session();
                vec![HelperEvent::Reconnecting {
                    reason: HelperReconnectReason::DisplayUpdate,
                    delay_secs: None,
                }]
            }
            RdpOutputEvent::Image {
                buffer,
                width,
                height,
            } => {
                let width = width.get();
                let height = height.get();
                let mut events = Vec::with_capacity(if self.connected { 1 } else { 4 });
                if !self.connected {
                    events.push(HelperEvent::Connected { width, height });
                    self.connected = true;
                    self.pending_cursor.append_to(&mut events);
                }
                self.base_size = Some((width, height));
                events.push(HelperEvent::frame(
                    width,
                    height,
                    rdp_u32_pixels_to_bgra(&buffer),
                ));
                events
            }
            RdpOutputEvent::DesktopUpdate(update) => {
                let (buffer, width, height, region) = update.into_parts();
                let width = width.get();
                let height = height.get();
                let region_width = region
                    .right
                    .checked_sub(region.left)
                    .and_then(|span| span.checked_add(1));
                let region_height = region
                    .bottom
                    .checked_sub(region.top)
                    .and_then(|span| span.checked_add(1));
                let (Some(region_width), Some(region_height)) = (region_width, region_height) else {
                    tracing::warn!(?region, "Ignored malformed RDP dirty region bounds");
                    return Vec::new();
                };
                let expected_pixels = usize::from(region_width).checked_mul(usize::from(region_height));
                if region_width == 0
                    || region_height == 0
                    || region.right >= width
                    || region.bottom >= height
                    || expected_pixels != Some(buffer.len())
                {
                    tracing::warn!(
                        width,
                        height,
                        region = ?region,
                        actual_pixels = buffer.len(),
                        expected_pixels = ?expected_pixels,
                        "Ignored malformed RDP dirty region"
                    );
                    return Vec::new();
                }

                // IronRDP publishes the whole framebuffer as one region whenever the
                // desktop extent changes, including for the very first update of a
                // session. That region is the base frame the embedder renders against.
                let covers_base_frame = region.left == 0
                    && region.top == 0
                    && region_width == width
                    && region_height == height;
                let bgra = rdp_u32_pixels_to_bgra(&buffer);

                if covers_base_frame {
                    let mut events = Vec::with_capacity(if self.connected { 1 } else { 4 });
                    if !self.connected {
                        events.push(HelperEvent::Connected { width, height });
                        self.connected = true;
                        self.pending_cursor.append_to(&mut events);
                    }
                    self.base_size = Some((width, height));
                    events.push(HelperEvent::frame(width, height, bgra));
                    return events;
                }

                if !self.connected {
                    tracing::warn!("Ignored RDP dirty region before the complete base frame");
                    return Vec::new();
                }
                if self.base_size != Some((width, height)) {
                    tracing::warn!(
                        width,
                        height,
                        base_size = ?self.base_size,
                        "Ignored RDP dirty region for a different base frame size"
                    );
                    return Vec::new();
                }

                let byte_len = bgra.len();
                vec![HelperEvent::FrameBgraRects {
                    width,
                    height,
                    rects: vec![HelperFrameRect {
                        x: region.left,
                        y: region.top,
                        width: region_width,
                        height: region_height,
                        byte_len,
                    }],
                    bgra,
                }]
            }
            RdpOutputEvent::ConnectionFailure(error) => {
                self.reset_session();
                vec![HelperEvent::ConnectionFailure {
                    message: error.report().with_locations().to_string(),
                }]
            }
            RdpOutputEvent::Terminated(result) => {
                self.reset_session();
                vec![HelperEvent::Terminated {
                    message: match result {
                        Ok(reason) => reason.to_string(),
                        Err(error) => error.report().to_string(),
                    },
                }]
            }
            RdpOutputEvent::PointerDefault => self.map_cursor(HelperEvent::CursorDefault),
            RdpOutputEvent::PointerHidden => self.map_cursor(HelperEvent::CursorHidden),
            RdpOutputEvent::PointerPosition { x, y } => {
                self.map_cursor(HelperEvent::CursorPosition { x, y })
            }
            RdpOutputEvent::PointerBitmap(pointer) => {
                if pointer.width == 0 || pointer.height == 0 {
                    self.map_cursor(HelperEvent::CursorHidden)
                } else {
                    self.map_cursor(HelperEvent::CursorRgbaBytes {
                        width: pointer.width,
                        height: pointer.height,
                        hotspot_x: pointer.hotspot_x,
                        hotspot_y: pointer.hotspot_y,
                        rgba: pointer.bitmap_data.clone(),
                    })
                }
            }
        }
    }

    fn reset_session(&mut self) {
        self.connected = false;
        self.base_size = None;
        self.pending_cursor.clear();
    }

    fn map_cursor(&mut self, event: HelperEvent) -> Vec<HelperEvent> {
        if self.connected {
            vec![event]
        } else {
            self.pending_cursor.record(event);
            Vec::new()
        }
    }
}

#[cfg(test)]
mod tests {
    use std::io;
    use std::num::NonZeroU16;
    use std::sync::Arc;

    use ironrdp::connector::ConnectorErrorExt as _;
    use ironrdp::graphics::pointer::DecodedPointer;
    use ironrdp::pdu::geometry::InclusiveRectangle;
    use ironrdp_client::rdp::DesktopUpdate;

    use super::*;

    #[test]
    fn reports_connected_only_when_first_base_frame_arrives() {
        let mut mapper = RdpOutputMapper::default();
        assert_eq!(
            mapper.map(image(&[0x00112233], 1, 1)),
            vec![
                HelperEvent::Connected {
                    width: 1,
                    height: 1,
                },
                HelperEvent::frame(1, 1, vec![0x33, 0x22, 0x11, 0xff]),
            ]
        );

        assert_eq!(
            mapper.map(image(&[0x00abcdef], 1, 1)),
            vec![HelperEvent::frame(1, 1, vec![0xef, 0xcd, 0xab, 0xff])]
        );
    }

    #[test]
    fn connection_failure_includes_the_underlying_error() {
        let mut mapper = RdpOutputMapper::default();
        let error = ironrdp::connector::ConnectorError::custom(
            "TLS upgrade",
            io::Error::other("the server only offered TLS 1.0"),
        );

        let events = mapper.map(RdpOutputEvent::ConnectionFailure(error));

        let [HelperEvent::ConnectionFailure { message }] = events.as_slice() else {
            panic!("expected one connection failure event");
        };
        assert!(message.contains("[TLS upgrade @"), "{message}");
        assert!(message.contains("custom error"), "{message}");
        assert!(
            message.contains("caused by: the server only offered TLS 1.0"),
            "{message}"
        );
    }

    #[test]
    fn dirty_region_is_forwarded_without_scanning_or_converting_the_frame() {
        let mut mapper = RdpOutputMapper::default();
        mapper.map(image(&[0; 4], 2, 2));
        let bgra = vec![0x33, 0x22, 0x11, 0xff];

        assert_eq!(
            mapper.map(region(bgra.clone(), 2, 2, 1, 0, 1, 1)),
            vec![HelperEvent::FrameBgraRects {
                width: 2,
                height: 2,
                rects: vec![HelperFrameRect {
                    x: 1,
                    y: 0,
                    width: 1,
                    height: 1,
                    byte_len: bgra.len(),
                }],
                bgra,
            }]
        );
    }

    #[test]
    fn full_extent_desktop_update_establishes_the_base_frame() {
        let mut mapper = RdpOutputMapper::default();

        assert_eq!(
            mapper.map(region(vec![0x33, 0x22, 0x11, 0xff], 1, 1, 0, 0, 1, 1)),
            vec![
                HelperEvent::Connected {
                    width: 1,
                    height: 1,
                },
                HelperEvent::frame(1, 1, vec![0x33, 0x22, 0x11, 0xff]),
            ]
        );
    }

    #[test]
    fn dirty_region_cannot_cross_the_connected_base_frame_barrier() {
        let mut mapper = RdpOutputMapper::default();

        assert!(
            mapper
                .map(region(vec![0, 0, 0, 0xff], 2, 2, 0, 0, 1, 1))
                .is_empty()
        );
        assert_eq!(
            mapper.map(image(&[0], 1, 1)),
            vec![
                HelperEvent::Connected {
                    width: 1,
                    height: 1,
                },
                HelperEvent::frame(1, 1, vec![0, 0, 0, 0xff]),
            ]
        );
    }

    #[test]
    fn dirty_region_must_match_the_current_base_frame() {
        let mut mapper = RdpOutputMapper::default();
        mapper.map(image(&[0; 4], 2, 2));

        // A region packed for a 3x2 framebuffer cannot patch the 2x2 base frame.
        // Malformed payloads themselves are already rejected by `DesktopUpdate::new`,
        // so only the base-frame mismatch remains reachable here.
        assert!(
            mapper
                .map(region(vec![0, 0, 0, 0xff], 3, 2, 0, 0, 1, 1))
                .is_empty()
        );
    }

    #[test]
    fn resize_fallback_resets_first_frame_barrier_for_reconnected_session() {
        let mut mapper = RdpOutputMapper::default();
        mapper.map(image(&[0x00112233, 0, 0, 0], 2, 2));

        assert_eq!(
            mapper.map(RdpOutputEvent::DisplayResizeFallback(
                ironrdp_client::rdp::DisplayResizeFallbackReason::DisplayControlUnavailable,
            )),
            vec![HelperEvent::Reconnecting {
                reason: HelperReconnectReason::DisplayUpdate,
                delay_secs: None,
            }]
        );
        assert!(
            mapper
                .map(region(vec![0, 0, 0, 0xff], 2, 2, 0, 0, 1, 1))
                .is_empty()
        );
        assert_eq!(
            mapper.map(image(&[0x00112233], 1, 1)),
            vec![
                HelperEvent::Connected {
                    width: 1,
                    height: 1,
                },
                HelperEvent::frame(1, 1, vec![0x33, 0x22, 0x11, 0xff]),
            ]
        );
    }

    #[test]
    fn emits_decoded_pointer_bitmap_without_json_encoding_pixels() {
        let mut mapper = RdpOutputMapper::default();
        let rgba = vec![0x11, 0x22, 0x33, 0x44, 0xaa, 0xbb, 0xcc, 0xdd];
        mapper.map(image(&[0, 0], 2, 1));

        let events = mapper.map(RdpOutputEvent::PointerBitmap(Arc::new(DecodedPointer {
            width: 2,
            height: 1,
            hotspot_x: 1,
            hotspot_y: 0,
            bitmap_data: rgba.clone(),
        })));

        assert_eq!(
            events,
            vec![HelperEvent::CursorRgbaBytes {
                width: 2,
                height: 1,
                hotspot_x: 1,
                hotspot_y: 0,
                rgba,
            }]
        );
    }

    #[test]
    fn maps_zero_sized_pointer_bitmap_to_hidden_cursor() {
        let mut mapper = RdpOutputMapper::default();
        mapper.map(image(&[0], 1, 1));

        let events = mapper.map(RdpOutputEvent::PointerBitmap(Arc::new(
            DecodedPointer::new_invisible(),
        )));

        assert_eq!(events, vec![HelperEvent::CursorHidden]);
    }

    #[test]
    fn flushes_latest_preconnect_cursor_state_after_connected_and_before_frame() {
        let mut mapper = RdpOutputMapper::default();
        let rgba = vec![0x11, 0x22, 0x33, 0x44, 0xaa, 0xbb, 0xcc, 0xdd];
        assert!(
            mapper
                .map(RdpOutputEvent::PointerBitmap(Arc::new(DecodedPointer {
                    width: 2,
                    height: 1,
                    hotspot_x: 1,
                    hotspot_y: 0,
                    bitmap_data: rgba.clone(),
                })))
                .is_empty()
        );
        assert!(
            mapper
                .map(RdpOutputEvent::PointerPosition { x: 3, y: 4 })
                .is_empty()
        );

        assert_eq!(
            mapper.map(image(&[0, 0], 2, 1)),
            vec![
                HelperEvent::Connected {
                    width: 2,
                    height: 1,
                },
                HelperEvent::CursorRgbaBytes {
                    width: 2,
                    height: 1,
                    hotspot_x: 1,
                    hotspot_y: 0,
                    rgba,
                },
                HelperEvent::CursorPosition { x: 3, y: 4 },
                HelperEvent::frame(2, 1, vec![0, 0, 0, 0xff, 0, 0, 0, 0xff]),
            ]
        );
    }

    fn image(buffer: &[u32], width: u16, height: u16) -> RdpOutputEvent {
        RdpOutputEvent::Image {
            buffer: buffer.to_vec(),
            width: NonZeroU16::new(width).unwrap(),
            height: NonZeroU16::new(height).unwrap(),
        }
    }

    /// Builds a dirty-region event from BGRA bytes, round-tripping them through
    /// IronRDP's packed `0x00RRGGBB` pixel representation.
    fn region(
        bgra: Vec<u8>,
        width: u16,
        height: u16,
        x: u16,
        y: u16,
        region_width: u16,
        region_height: u16,
    ) -> RdpOutputEvent {
        let buffer = bgra
            .chunks_exact(4)
            .map(|pixel| u32::from_be_bytes([0, pixel[2], pixel[1], pixel[0]]))
            .collect::<Vec<u32>>();
        RdpOutputEvent::DesktopUpdate(
            DesktopUpdate::new(
                buffer,
                NonZeroU16::new(width).unwrap(),
                NonZeroU16::new(height).unwrap(),
                InclusiveRectangle {
                    left: x,
                    top: y,
                    right: x + region_width - 1,
                    bottom: y + region_height - 1,
                },
            )
            .expect("test dirty region must be a consistent desktop update"),
        )
    }
}
