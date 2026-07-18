use ironrdp_client::rdp::RdpOutputEvent;

use crate::pixels::rdp_u32_pixels_to_bgra;
use crate::protocol::{HelperEvent, HelperFrameRect};

const DIRTY_TILE_SIZE: usize = 64;
const FULL_FRAME_THRESHOLD_PERCENT: usize = 60;

#[derive(Default)]
pub(super) struct RdpOutputMapper {
    connected: bool,
    previous: Option<PreviousFrame>,
}

struct PreviousFrame {
    width: u16,
    height: u16,
    pixels: Vec<u32>,
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
                let frame = self.map_frame(width, height, &buffer);
                self.previous = Some(PreviousFrame {
                    width,
                    height,
                    pixels: buffer,
                });
                if let Some(frame) = frame {
                    events.push(frame);
                }
                events
            }
            RdpOutputEvent::ConnectionFailure(error) => vec![HelperEvent::ConnectionFailure {
                message: format!("{error:#}"),
            }],
            RdpOutputEvent::Terminated(result) => vec![HelperEvent::Terminated {
                message: match result {
                    Ok(reason) => reason.to_string(),
                    Err(error) => error.report().to_string(),
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

    fn map_frame(&self, width: u16, height: u16, pixels: &[u32]) -> Option<HelperEvent> {
        let Some(previous) = self.previous.as_ref() else {
            return Some(HelperEvent::frame(
                width,
                height,
                rdp_u32_pixels_to_bgra(pixels),
            ));
        };
        if previous.width != width || previous.height != height {
            return Some(HelperEvent::frame(
                width,
                height,
                rdp_u32_pixels_to_bgra(pixels),
            ));
        }

        let rects = dirty_rects(&previous.pixels, pixels, width as usize, height as usize);
        if rects.is_empty() {
            return None;
        }
        let changed_area: usize = rects
            .iter()
            .map(|rect| usize::from(rect.width) * usize::from(rect.height))
            .sum();
        let total_area = usize::from(width) * usize::from(height);
        if changed_area * 100 >= total_area * FULL_FRAME_THRESHOLD_PERCENT {
            return Some(HelperEvent::frame(
                width,
                height,
                rdp_u32_pixels_to_bgra(pixels),
            ));
        }

        let mut bgra = Vec::with_capacity(changed_area * 4);
        for rect in &rects {
            append_rect_bgra(&mut bgra, pixels, width as usize, rect);
        }
        Some(HelperEvent::FrameBgraRects {
            width,
            height,
            rects,
            bgra,
        })
    }
}

fn dirty_rects(
    previous: &[u32],
    current: &[u32],
    width: usize,
    height: usize,
) -> Vec<HelperFrameRect> {
    let tiles_x = width.div_ceil(DIRTY_TILE_SIZE);
    let tiles_y = height.div_ceil(DIRTY_TILE_SIZE);
    let mut rects = Vec::new();
    for tile_y in 0..tiles_y {
        let mut tile_x = 0;
        while tile_x < tiles_x {
            while tile_x < tiles_x
                && !tile_changed(previous, current, width, height, tile_x, tile_y)
            {
                tile_x += 1;
            }
            if tile_x == tiles_x {
                break;
            }
            let start_x = tile_x;
            tile_x += 1;
            while tile_x < tiles_x && tile_changed(previous, current, width, height, tile_x, tile_y)
            {
                tile_x += 1;
            }
            let x = start_x * DIRTY_TILE_SIZE;
            let y = tile_y * DIRTY_TILE_SIZE;
            let rect_width = (tile_x * DIRTY_TILE_SIZE).min(width) - x;
            let rect_height = ((tile_y + 1) * DIRTY_TILE_SIZE).min(height) - y;
            rects.push(HelperFrameRect {
                x: x as u16,
                y: y as u16,
                width: rect_width as u16,
                height: rect_height as u16,
                byte_len: rect_width * rect_height * 4,
            });
        }
    }
    rects
}

fn tile_changed(
    previous: &[u32],
    current: &[u32],
    width: usize,
    height: usize,
    tile_x: usize,
    tile_y: usize,
) -> bool {
    let start_x = tile_x * DIRTY_TILE_SIZE;
    let start_y = tile_y * DIRTY_TILE_SIZE;
    let end_x = (start_x + DIRTY_TILE_SIZE).min(width);
    let end_y = (start_y + DIRTY_TILE_SIZE).min(height);
    (start_y..end_y).any(|y| {
        let row = y * width;
        (start_x..end_x).any(|x| previous[row + x] != current[row + x])
    })
}

fn append_rect_bgra(
    output: &mut Vec<u8>,
    pixels: &[u32],
    framebuffer_width: usize,
    rect: &HelperFrameRect,
) {
    let x = usize::from(rect.x);
    let y = usize::from(rect.y);
    let width = usize::from(rect.width);
    let height = usize::from(rect.height);
    for row in 0..height {
        let start = (y + row) * framebuffer_width + x;
        for pixel in &pixels[start..start + width] {
            let [_, r, g, b] = pixel.to_be_bytes();
            output.extend_from_slice(&[b, g, r, 0xff]);
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

    #[test]
    fn emits_dirty_rectangles_for_small_screen_updates() {
        let mut mapper = RdpOutputMapper::default();
        let mut first_pixels = vec![0; 128 * 128];
        let first = mapper.map(image(&first_pixels, 128, 128));
        assert!(matches!(
            first.last(),
            Some(HelperEvent::FrameBgraBytes { .. })
        ));

        first_pixels[65 * 128 + 65] = 0x00112233;
        let second = mapper.map(image(&first_pixels, 128, 128));

        assert!(matches!(
            second.as_slice(),
            [HelperEvent::FrameBgraRects {
                width: 128,
                height: 128,
                ..
            }]
        ));
    }

    fn image(buffer: &[u32], width: u16, height: u16) -> RdpOutputEvent {
        RdpOutputEvent::Image {
            buffer: buffer.to_vec(),
            width: std::num::NonZeroU16::new(width).unwrap(),
            height: std::num::NonZeroU16::new(height).unwrap(),
        }
    }

    #[test]
    #[ignore = "manual performance benchmark"]
    fn benchmarks_sparse_frame_transport() {
        const WIDTH: u16 = 1280;
        const HEIGHT: u16 = 720;
        const FRAMES: usize = 60;
        let pixels = usize::from(WIDTH) * usize::from(HEIGHT);
        let baseline_frame = vec![0u32; pixels];

        let baseline_started = std::time::Instant::now();
        for _ in 0..FRAMES {
            std::hint::black_box(rdp_u32_pixels_to_bgra(&baseline_frame));
        }
        let baseline_elapsed = baseline_started.elapsed();

        let optimized_started = std::time::Instant::now();
        let mut mapper = RdpOutputMapper::default();
        let mut optimized_bytes = 0usize;
        for frame in 0..FRAMES {
            let mut pixels = baseline_frame.clone();
            let x = (frame * 17) % usize::from(WIDTH);
            let y = (frame * 11) % usize::from(HEIGHT);
            pixels[y * usize::from(WIDTH) + x] = 0x00112233;
            for event in mapper.map(image(&pixels, WIDTH, HEIGHT)) {
                optimized_bytes += match event {
                    HelperEvent::FrameBgraBytes { bgra, .. }
                    | HelperEvent::FrameBgraRects { bgra, .. } => bgra.len(),
                    _ => 0,
                };
            }
        }
        let optimized_elapsed = optimized_started.elapsed();
        let baseline_bytes = pixels * 4 * FRAMES;

        println!(
            "baseline_ms={} optimized_ms={} baseline_bytes={} optimized_bytes={}",
            baseline_elapsed.as_secs_f64() * 1000.0,
            optimized_elapsed.as_secs_f64() * 1000.0,
            baseline_bytes,
            optimized_bytes
        );
    }
}
