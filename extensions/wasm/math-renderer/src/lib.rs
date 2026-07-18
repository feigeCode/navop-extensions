wit_bindgen::generate!({ path: "../../../wit", world: "document-renderer" });

use kymo_tex_layout::{LayoutOptions, layout, to_display_list};
use kymo_tex_parser::parser::parse;
use kymo_tex_svg::{SvgOptions, render_to_svg};
use kymo_tex_types::{color::Color, math_style::MathStyle};

struct MathRenderer;

impl Guest for MathRenderer {
    fn render_document(input: Request) -> Result<Artifact, String> {
        if input.renderer != "math" {
            return Err(format!("unsupported renderer: {}", input.renderer));
        }
        let ast = parse(input.source.trim()).map_err(|error| format!("公式语法错误：{error}"))?;
        let color = rgb(input.theme.foreground);
        let layout_options = LayoutOptions::default()
            .with_style(MathStyle::Display)
            .with_color(color);
        let display_list = to_display_list(&layout(&ast, &layout_options));
        let scale = f64::from(input.scale_factor.clamp(0.5, 4.0));
        let svg = render_to_svg(
            &display_list,
            &SvgOptions {
                font_size: 40.0 * scale,
                padding: 10.0 * scale,
                stroke_width: 1.5 * scale,
                embed_glyphs: true,
                font_dir: String::new(),
            },
        );
        Ok(Artifact {
            media_type: "image/svg+xml".to_owned(),
            bytes: svg.into_bytes(),
            intrinsic_width: None,
            intrinsic_height: None,
        })
    }
}

fn rgb(value: u32) -> Color {
    Color {
        r: ((value >> 16) & 0xff) as f32 / 255.0,
        g: ((value >> 8) & 0xff) as f32 / 255.0,
        b: (value & 0xff) as f32 / 255.0,
        a: 1.0,
    }
}

export!(MathRenderer);
