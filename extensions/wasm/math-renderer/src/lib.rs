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
        let svg = with_background(svg, input.theme.background)?;
        Ok(Artifact {
            media_type: "image/svg+xml".to_owned(),
            bytes: svg.into_bytes(),
            intrinsic_width: None,
            intrinsic_height: None,
        })
    }
}

fn with_background(mut svg: String, background: u32) -> Result<String, String> {
    let root_end = svg
        .find('>')
        .ok_or_else(|| "数学公式渲染器生成了无效 SVG".to_owned())?;
    let rect = format!(
        r##"<rect width="100%" height="100%" fill="#{:06x}"/>"##,
        background & 0x00ff_ffff
    );
    svg.insert_str(root_end + 1, &rect);
    Ok(svg)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_svg_uses_the_document_theme_background() {
        let svg = with_background(
            "<svg viewBox=\"0 0 10 10\"><path/></svg>".to_owned(),
            0xf7f6f3,
        )
        .unwrap();

        assert!(svg.starts_with(
            "<svg viewBox=\"0 0 10 10\"><rect width=\"100%\" height=\"100%\" fill=\"#f7f6f3\"/>"
        ));
    }

    #[test]
    fn align_environment_renders_to_svg() {
        let ast = parse(
            r"\begin{align}
y &= 2x + 1 \\
z &= x^2 - 3
\end{align}",
        )
        .unwrap();
        let display_list = to_display_list(&layout(&ast, &LayoutOptions::default()));
        let svg = render_to_svg(&display_list, &SvgOptions::default());

        assert!(svg.starts_with("<svg"));
        assert!(svg.ends_with("</svg>"));
    }
}
