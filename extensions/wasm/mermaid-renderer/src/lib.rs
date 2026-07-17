wit_bindgen::generate!({
    path: "wit",
    world: "document-renderer",
});

use onet::extension::document_render::Theme;

struct MermaidRenderer;

impl Guest for MermaidRenderer {
    fn render_document(input: Request) -> Result<Artifact, String> {
        if input.renderer != "mermaid" {
            return Err(format!("unsupported renderer: {}", input.renderer));
        }
        let theme = build_theme(&input.theme);
        let svg = mermaid_render::render_to_svg(&input.source, &theme)
            .map_err(|error| format!("{error:#}"))?;
        Ok(Artifact {
            media_type: "image/svg+xml".to_owned(),
            bytes: svg.into_bytes(),
            intrinsic_width: None,
            intrinsic_height: None,
        })
    }
}

fn build_theme(input: &Theme) -> mermaid_render::MermaidTheme {
    use gpui::{Hsla, rgb};
    use mermaid_render::{AccentColor, MermaidTheme, text_color_for_background};
    let color = |value: u32| -> Hsla { rgb(value).into() };
    let git_branch_colors = [
        input.accent,
        0x0f7b6c,
        0xd9730d,
        0x9b51e0,
        input.danger,
        0x2f80ed,
        0x27ae60,
        0xf2c94c,
    ]
    .map(color);
    let git_branch_label_colors = git_branch_colors.map(text_color_for_background);
    let accent_colors = [
        (input.accent, input.background),
        (0x0f7b6c, 0xdbeddb),
        (0x9a6700, 0xfdecc8),
        (0x6940a5, 0xe8deee),
        (input.danger, 0xffe2dd),
        (0x1f6f8b, 0xd3e5ef),
    ]
    .into_iter()
    .map(|(foreground, background)| AccentColor {
        foreground: color(foreground),
        background: color(background),
    })
    .collect();
    MermaidTheme {
        dark_mode: input.dark,
        font_family: input.font_family.clone(),
        background: color(input.background),
        primary_color: color(input.background),
        primary_text_color: color(input.foreground),
        primary_border_color: color(input.border),
        secondary_color: color(input.background),
        tertiary_color: color(input.background),
        line_color: color(input.muted),
        text_color: color(input.foreground),
        edge_label_background: color(input.background),
        cluster_background: color(input.background),
        cluster_border: color(input.border),
        note_background: color(0xfff7d6),
        note_border: color(0xe8c547),
        actor_background: color(input.background),
        actor_border: color(input.border),
        activation_background: color(input.background),
        activation_border: color(input.border),
        git_branch_colors,
        git_branch_label_colors,
        er_attr_bg_odd: color(input.background),
        er_attr_bg_even: color(input.background),
        error_color: color(input.danger),
        warning_color: color(0xd9730d),
        accent_colors,
    }
}

export!(MermaidRenderer);
