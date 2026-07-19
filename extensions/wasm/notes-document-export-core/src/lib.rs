#[cfg(feature = "docx")]
use image::GenericImageView;
#[cfg(feature = "html")]
use pulldown_cmark::{Options, Parser, html};
#[cfg(feature = "docx")]
use std::io::Cursor;
#[cfg(feature = "docx")]
use std::io::Write;
#[cfg(feature = "docx")]
use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

#[derive(Clone, Debug)]
pub struct ExportAsset {
    pub path: String,
    pub media_type: String,
    pub bytes: Vec<u8>,
}

#[derive(Clone, Debug)]
pub struct ExportTheme {
    pub dark: bool,
    pub background: u32,
    pub foreground: u32,
    pub border: u32,
    pub muted: u32,
    pub accent: u32,
}

#[derive(Clone, Debug)]
pub struct ExportInput {
    pub title: String,
    pub source: String,
    pub assets: Vec<ExportAsset>,
    pub theme: ExportTheme,
}

#[cfg(feature = "html")]
pub fn render_html(input: &ExportInput) -> Vec<u8> {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_FOOTNOTES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    let mut body = String::new();
    html::push_html(&mut body, Parser::new_ext(&input.source, options));
    body = inline_html_images(&body, &input.assets);
    let background = css_color(input.theme.background);
    let foreground = css_color(input.theme.foreground);
    let muted = css_color(input.theme.muted);
    let border = css_color(input.theme.border);
    let accent = css_color(input.theme.accent);
    format!(
        "<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>{}</title><style>:root{{color-scheme:{}}}*{{box-sizing:border-box}}body{{max-width:900px;margin:0 auto;padding:48px 32px;background:{};color:{};font:16px/1.7 -apple-system,BlinkMacSystemFont,\"Segoe UI\",\"PingFang SC\",\"Microsoft YaHei\",sans-serif}}h1,h2,h3,h4,h5,h6{{line-height:1.3;margin:1.5em 0 .6em}}h1{{font-size:2.1em;border-bottom:1px solid {};padding-bottom:.3em}}a{{color:{}}}blockquote{{margin:1em 0;padding:.25em 1em;border-left:4px solid {};color:{}}}code{{background:color-mix(in srgb,{} 10%,transparent);padding:.15em .35em;border-radius:4px}}pre{{overflow:auto;padding:16px;border:1px solid {};border-radius:8px}}pre code{{padding:0;background:none}}table{{border-collapse:collapse;width:100%}}th,td{{border:1px solid {};padding:.5em .75em;text-align:left}}img{{max-width:100%;height:auto}}</style></head><body>{}</body></html>",
        escape_html(&input.title),
        if input.theme.dark { "dark" } else { "light" },
        background,
        foreground,
        border,
        accent,
        accent,
        muted,
        foreground,
        border,
        border,
        body
    )
    .into_bytes()
}

#[cfg(feature = "html")]
fn css_color(value: u32) -> String {
    format!("#{:06x}", value & 0x00ff_ffff)
}

#[cfg(feature = "html")]
fn base64_encode(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let first = chunk[0] as usize;
        let second = chunk.get(1).copied().unwrap_or(0) as usize;
        let third = chunk.get(2).copied().unwrap_or(0) as usize;
        output.push(ALPHABET[(first >> 2) & 0x3f] as char);
        output.push(ALPHABET[((first << 4) | (second >> 4)) & 0x3f] as char);
        output.push(if chunk.len() > 1 {
            ALPHABET[((second << 2) | (third >> 6)) & 0x3f] as char
        } else {
            '='
        });
        output.push(if chunk.len() > 2 {
            ALPHABET[third & 0x3f] as char
        } else {
            '='
        });
    }
    output
}

#[cfg(feature = "html")]
fn inline_html_images(body: &str, assets: &[ExportAsset]) -> String {
    let mut output = String::with_capacity(body.len());
    let mut remaining = body;
    while let Some(start) = remaining.find("src=\"") {
        let value_start = start + 5;
        output.push_str(&remaining[..value_start]);
        let Some(end) = remaining[value_start..].find('"') else {
            output.push_str(&remaining[value_start..]);
            return output;
        };
        let source = &remaining[value_start..value_start + end];
        let normalized = percent_decode(&source.replace("&amp;", "&"));
        if let Some(asset) = assets
            .iter()
            .find(|asset| asset.path == source || asset.path == normalized)
        {
            output.push_str(&format!(
                "data:{};base64,{}",
                asset.media_type,
                base64_encode(&asset.bytes)
            ));
        } else {
            output.push_str(source);
        }
        remaining = &remaining[value_start + end..];
    }
    output.push_str(remaining);
    output
}

#[cfg(feature = "html")]
fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%'
            && index + 2 < bytes.len()
            && let (Some(high), Some(low)) =
                (hex_digit(bytes[index + 1]), hex_digit(bytes[index + 2]))
        {
            output.push(high << 4 | low);
            index += 3;
        } else {
            output.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(output).unwrap_or_else(|_| value.to_owned())
}

#[cfg(feature = "html")]
fn hex_digit(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[cfg(any(feature = "pdf", feature = "docx"))]
#[derive(Clone, Debug)]
struct DocumentLine {
    kind: LineKind,
    text: String,
}

#[cfg(any(feature = "pdf", feature = "docx"))]
#[derive(Clone, Debug)]
struct TableData {
    rows: Vec<Vec<String>>,
}

#[cfg(any(feature = "pdf", feature = "docx"))]
#[derive(Clone, Debug)]
struct ImageData {
    alt: String,
    path: String,
}

#[cfg(any(feature = "pdf", feature = "docx"))]
#[derive(Clone, Debug)]
enum LineKind {
    Blank,
    Heading(u8),
    Body,
    Quote,
    Bullet,
    Ordered,
    Code,
    Table(TableData),
    Image(ImageData),
}

#[cfg(any(feature = "pdf", feature = "docx"))]
fn document_lines(source: &str) -> Vec<DocumentLine> {
    let mut lines = Vec::new();
    let mut code = false;
    let source_lines: Vec<&str> = source.lines().collect();
    let mut index = 0;
    while index < source_lines.len() {
        let raw = source_lines[index];
        let trimmed = raw.trim_end();
        if trimmed.trim_start().starts_with("```") || trimmed.trim_start().starts_with("~~~") {
            code = !code;
            index += 1;
            continue;
        }
        if code {
            lines.push(DocumentLine {
                kind: LineKind::Code,
                text: trimmed.to_owned(),
            });
            index += 1;
            continue;
        }
        let start = trimmed.trim_start();
        if start.is_empty() {
            lines.push(DocumentLine {
                kind: LineKind::Blank,
                text: String::new(),
            });
            index += 1;
            continue;
        }
        if is_table_row(start)
            && source_lines
                .get(index + 1)
                .is_some_and(|line| is_table_separator(line.trim()))
        {
            let mut rows = Vec::new();
            rows.push(parse_table_row(start));
            index += 2;
            while index < source_lines.len() && is_table_row(source_lines[index].trim()) {
                rows.push(parse_table_row(source_lines[index].trim()));
                index += 1;
            }
            lines.push(DocumentLine {
                kind: LineKind::Table(TableData { rows }),
                text: String::new(),
            });
            continue;
        }
        if let Some(image) = parse_image(start) {
            lines.push(DocumentLine {
                kind: LineKind::Image(image),
                text: String::new(),
            });
            index += 1;
            continue;
        }
        let heading_marks = start
            .chars()
            .take_while(|character| *character == '#')
            .count();
        if (1..=6).contains(&heading_marks) && start.as_bytes().get(heading_marks) == Some(&b' ') {
            lines.push(DocumentLine {
                kind: LineKind::Heading(heading_marks as u8),
                text: clean_inline(&start[heading_marks + 1..]),
            });
        } else if let Some(text) = start.strip_prefix("> ") {
            lines.push(DocumentLine {
                kind: LineKind::Quote,
                text: clean_inline(text),
            });
        } else if let Some(text) = start
            .strip_prefix("- ")
            .or_else(|| start.strip_prefix("* "))
            .or_else(|| start.strip_prefix("+ "))
        {
            lines.push(DocumentLine {
                kind: LineKind::Bullet,
                text: clean_inline(text),
            });
        } else if let Some((_number, text)) = ordered_list_item(start) {
            lines.push(DocumentLine {
                kind: LineKind::Ordered,
                text: clean_inline(text),
            });
        } else {
            lines.push(DocumentLine {
                kind: LineKind::Body,
                text: clean_inline(start),
            });
        }
        index += 1;
    }
    lines
}

#[cfg(any(feature = "pdf", feature = "docx"))]
fn is_table_row(line: &str) -> bool {
    line.contains('|') && line.trim_matches('|').contains('|')
}

#[cfg(any(feature = "pdf", feature = "docx"))]
fn is_table_separator(line: &str) -> bool {
    let cells = line.trim_matches('|').split('|').map(str::trim);
    let mut found = false;
    for cell in cells {
        if cell.len() < 3
            || !cell
                .chars()
                .all(|character| matches!(character, '-' | ':' | ' '))
        {
            return false;
        }
        found = true;
    }
    found
}

#[cfg(any(feature = "pdf", feature = "docx"))]
fn parse_table_row(line: &str) -> Vec<String> {
    line.trim_matches('|')
        .split('|')
        .map(|cell| clean_inline(cell.trim()))
        .collect()
}

#[cfg(any(feature = "pdf", feature = "docx"))]
fn parse_image(line: &str) -> Option<ImageData> {
    let start = line.strip_prefix("![")?;
    let label_end = start.find("](")?;
    let target = &start[label_end + 2..].trim_end_matches(')');
    let path = target
        .trim()
        .trim_matches(|character| matches!(character, '<' | '>'));
    (!path.is_empty()).then(|| ImageData {
        alt: start[..label_end].to_owned(),
        path: path.to_owned(),
    })
}

#[cfg(any(feature = "pdf", feature = "docx"))]
fn ordered_list_item(line: &str) -> Option<(&str, &str)> {
    let dot = line.find(". ")?;
    let number = &line[..dot];
    (!number.is_empty() && number.bytes().all(|byte| byte.is_ascii_digit()))
        .then_some((number, &line[dot + 2..]))
}

#[cfg(any(feature = "pdf", feature = "docx"))]
fn clean_inline(source: &str) -> String {
    let mut text = source
        .replace("**", "")
        .replace("__", "")
        .replace("~~", "")
        .replace('`', "");
    while let Some(open) = text.find("![") {
        let Some(label_end) = text[open + 2..].find("](").map(|index| open + 2 + index) else {
            break;
        };
        let Some(target_end) = text[label_end + 2..]
            .find(')')
            .map(|index| label_end + 2 + index)
        else {
            break;
        };
        let replacement = text[open + 2..label_end].to_owned();
        text.replace_range(open..=target_end, &replacement);
    }
    while let Some(open) = text.find('[') {
        let Some(label_end) = text[open + 1..].find("](").map(|index| open + 1 + index) else {
            break;
        };
        let Some(target_end) = text[label_end + 2..]
            .find(')')
            .map(|index| label_end + 2 + index)
        else {
            break;
        };
        let replacement = text[open + 1..label_end].to_owned();
        text.replace_range(open..=target_end, &replacement);
    }
    text
}

#[cfg(feature = "pdf")]
pub fn render_pdf(input: &ExportInput) -> Result<Vec<u8>, String> {
    let source = &input.source;
    let assets = &input.assets;
    let pages = layout_pdf_pages(&document_lines(source), assets);
    let mut objects = vec![Vec::new(); 5 + pages.len() * 2];
    objects[0] = b"<< /Type /Catalog /Pages 2 0 R >>".to_vec();
    let kids = (0..pages.len())
        .map(|index| format!("{} 0 R", 6 + index * 2))
        .collect::<Vec<_>>()
        .join(" ");
    objects[1] = format!("<< /Type /Pages /Kids [{kids}] /Count {} >>", pages.len()).into_bytes();
    objects[2] = b"<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [4 0 R] >>".to_vec();
    objects[3] = b"<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 5 >> >>".to_vec();
    objects[4] = b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>".to_vec();
    for (index, content) in pages.into_iter().enumerate() {
        let page_id = 6 + index * 2;
        let content_id = page_id + 1;
        objects[page_id - 1] = format!("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 5 0 R >> >> /Contents {content_id} 0 R >>").into_bytes();
        objects[content_id - 1] = stream_object(content.into_bytes());
    }
    Ok(write_pdf(objects))
}

#[cfg(feature = "pdf")]
fn layout_pdf_pages(lines: &[DocumentLine], assets: &[ExportAsset]) -> Vec<String> {
    let mut pages = vec![String::from("q 1 1 1 rg 0 0 595 842 re f Q\n")];
    let mut y = 788.0f32;
    for line in lines {
        if let LineKind::Table(table) = &line.kind {
            render_pdf_table(table, &mut pages, &mut y);
            continue;
        }
        if let LineKind::Image(image) = &line.kind {
            if let Some(asset) = assets.iter().find(|asset| asset.path == image.path)
                && let Some((command, width, height)) = pdf_inline_image(asset, 487.0, 300.0)
            {
                if y - height < 58.0 {
                    pages.push(String::from("q 1 1 1 rg 0 0 595 842 re f Q\n"));
                    y = 788.0;
                }
                pages.last_mut().unwrap().push_str(&format!(
                    "q {width:.1} 0 0 {height:.1} 54 {:.1} cm\n{command}\nQ\n",
                    y - height
                ));
                y -= height + 12.0;
                continue;
            }
            let fallback = if image.alt.is_empty() {
                "Image"
            } else {
                &image.alt
            };
            pages
                .last_mut()
                .unwrap()
                .push_str(&pdf_text_commands(fallback, 11.0, 54.0, y));
            y -= 17.0;
            continue;
        }
        let (size, indent, leading) = match &line.kind {
            LineKind::Blank => {
                y -= 8.0;
                continue;
            }
            LineKind::Heading(1) => (24.0, 0.0, 34.0),
            LineKind::Heading(2) => (20.0, 0.0, 29.0),
            LineKind::Heading(_) => (16.0, 0.0, 24.0),
            LineKind::Bullet | LineKind::Ordered => (11.0, 18.0, 17.0),
            LineKind::Quote => (11.0, 18.0, 17.0),
            LineKind::Code => (10.0, 12.0, 15.0),
            LineKind::Body => (11.0, 0.0, 17.0),
            LineKind::Table(_) | LineKind::Image(_) => unreachable!(),
        };
        let display_text = match &line.kind {
            LineKind::Bullet => format!("- {}", line.text),
            LineKind::Ordered => format!("1. {}", line.text),
            _ => line.text.clone(),
        };
        for wrapped in wrap_text(&display_text, size, 487.0 - indent) {
            if y < 58.0 {
                pages.push(String::from("q 1 1 1 rg 0 0 595 842 re f Q\n"));
                y = 788.0;
            }
            pages.last_mut().unwrap().push_str(&pdf_text_commands(
                &wrapped,
                size,
                54.0 + indent,
                y,
            ));
            y -= leading;
        }
        if matches!(line.kind, LineKind::Heading(_)) {
            y -= 4.0;
        }
    }
    pages
}

#[cfg(feature = "pdf")]
fn render_pdf_table(table: &TableData, pages: &mut Vec<String>, y: &mut f32) {
    let columns = table.rows.iter().map(Vec::len).max().unwrap_or(0);
    if columns == 0 {
        return;
    }
    let cell_width = 487.0 / columns as f32;
    let row_height = 25.0;
    for (row_index, row) in table.rows.iter().enumerate() {
        if *y - row_height < 58.0 {
            pages.push(String::from("q 1 1 1 rg 0 0 595 842 re f Q\n"));
            *y = 788.0;
        }
        let bottom = *y - row_height;
        if row_index == 0 {
            pages.last_mut().unwrap().push_str(&format!(
                "q 0.94 0.96 0.98 rg 54 {bottom:.1} 487 {row_height:.1} re f Q\n"
            ));
        }
        for column in 0..columns {
            let x = 54.0 + column as f32 * cell_width;
            pages.last_mut().unwrap().push_str(&format!(
                "q 0.65 0.68 0.72 RG 0.6 w {x:.1} {bottom:.1} {cell_width:.1} {row_height:.1} re S Q\n"
            ));
            if let Some(text) = row.get(column) {
                let max_chars = ((cell_width - 8.0) / 6.0).max(1.0) as usize;
                let display = text.chars().take(max_chars).collect::<String>();
                pages.last_mut().unwrap().push_str(&pdf_text_commands(
                    &display,
                    if row_index == 0 { 10.5 } else { 10.0 },
                    x + 4.0,
                    bottom + 8.0,
                ));
            }
        }
        *y = bottom;
    }
    *y -= 12.0;
}

#[cfg(feature = "pdf")]
fn pdf_inline_image(
    asset: &ExportAsset,
    max_width: f32,
    max_height: f32,
) -> Option<(String, f32, f32)> {
    let image = decode_pdf_image(asset)?;
    let width = image.width;
    let height = image.height;
    if width == 0 || height == 0 {
        return None;
    }
    let scale = (max_width / width as f32)
        .min(max_height / height as f32)
        .min(1.0);
    let display_height = height as f32 * scale;
    let display_width = width as f32 * scale;
    let data = hex_encode(&image.rgb);
    Some((
        format!("BI /W {width} /H {height} /CS /RGB /BPC 8 /F /ASCIIHexDecode ID\n{data}>\nEI"),
        display_width,
        display_height,
    ))
}

#[cfg(feature = "pdf")]
struct PdfImage {
    width: u32,
    height: u32,
    rgb: Vec<u8>,
}

#[cfg(feature = "pdf")]
fn decode_pdf_image(asset: &ExportAsset) -> Option<PdfImage> {
    if asset.media_type != "image/svg+xml" {
        let image = image::load_from_memory(&asset.bytes).ok()?;
        let image = if image.width() > 400 || image.height() > 300 {
            image.thumbnail(400, 300)
        } else {
            image
        }
        .to_rgb8();
        let (width, height) = image.dimensions();
        return Some(PdfImage {
            width,
            height,
            rgb: image.into_raw(),
        });
    }
    let options = resvg::usvg::Options::default();
    let tree = resvg::usvg::Tree::from_data(&asset.bytes, &options).ok()?;
    let size = tree.size();
    let scale = (400.0 / size.width()).min(300.0 / size.height()).min(1.0);
    let width = (size.width() * scale).round().max(1.0) as u32;
    let height = (size.height() * scale).round().max(1.0) as u32;
    let mut pixmap = resvg::tiny_skia::Pixmap::new(width, height)?;
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::from_scale(scale, scale),
        &mut pixmap.as_mut(),
    );
    let mut rgb = Vec::with_capacity((width * height * 3) as usize);
    for pixel in pixmap.data().chunks_exact(4) {
        let alpha = u16::from(pixel[3]);
        rgb.push((u16::from(pixel[0]) + 255 - alpha).min(255) as u8);
        rgb.push((u16::from(pixel[1]) + 255 - alpha).min(255) as u8);
        rgb.push((u16::from(pixel[2]) + 255 - alpha).min(255) as u8);
    }
    Some(PdfImage { width, height, rgb })
}

#[cfg(feature = "pdf")]
fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut output = String::with_capacity(bytes.len().saturating_mul(2));
    for byte in bytes {
        output.push(HEX[(byte >> 4) as usize] as char);
        output.push(HEX[(byte & 0x0f) as usize] as char);
    }
    output
}

#[cfg(feature = "pdf")]
fn pdf_text_commands(text: &str, size: f32, x: f32, y: f32) -> String {
    let mut output = String::new();
    let mut run = String::new();
    let mut ascii = None;
    let mut cursor_x = x;
    let flush = |output: &mut String, run: &mut String, ascii: bool, cursor_x: &mut f32| {
        if run.is_empty() {
            return;
        }
        if ascii {
            output.push_str(&format!(
                "BT /F2 {size:.1} Tf 0.12 0.12 0.12 rg 1 0 0 1 {:.1} {:.1} Tm ({}) Tj ET\n",
                *cursor_x,
                y,
                pdf_literal(run)
            ));
        } else {
            output.push_str(&format!(
                "BT /F1 {size:.1} Tf 0.12 0.12 0.12 rg 1 0 0 1 {:.1} {:.1} Tm <{}> Tj ET\n",
                *cursor_x,
                y,
                utf16be_hex(run)
            ));
        }
        *cursor_x += run
            .chars()
            .map(|character| {
                if character.is_ascii() {
                    size * 0.55
                } else {
                    size
                }
            })
            .sum::<f32>();
        run.clear();
    };
    for character in text.chars() {
        let character_ascii = character.is_ascii();
        if let Some(current_ascii) = ascii
            && current_ascii != character_ascii
        {
            flush(&mut output, &mut run, current_ascii, &mut cursor_x);
        }
        ascii = Some(character_ascii);
        run.push(character);
    }
    if let Some(ascii) = ascii {
        flush(&mut output, &mut run, ascii, &mut cursor_x);
    }
    output
}

#[cfg(feature = "pdf")]
fn pdf_literal(text: &str) -> String {
    text.chars()
        .filter(|character| !character.is_control() || matches!(character, '\t'))
        .flat_map(|character| match character {
            '(' => "\\(".chars().collect::<Vec<_>>(),
            ')' => "\\)".chars().collect::<Vec<_>>(),
            '\\' => "\\\\".chars().collect::<Vec<_>>(),
            '\t' => "    ".chars().collect::<Vec<_>>(),
            other => vec![other],
        })
        .collect()
}

#[cfg(feature = "pdf")]
fn wrap_text(text: &str, size: f32, max_width: f32) -> Vec<String> {
    if text.is_empty() {
        return vec![String::new()];
    }
    let mut output = Vec::new();
    let mut current = String::new();
    let mut width = 0.0;
    for character in text.chars() {
        let character_width = if character.is_ascii() {
            size * 0.55
        } else {
            size
        };
        if width + character_width > max_width && !current.is_empty() {
            output.push(std::mem::take(&mut current));
            width = 0.0;
        }
        current.push(character);
        width += character_width;
    }
    if !current.is_empty() {
        output.push(current);
    }
    output
}

#[cfg(feature = "pdf")]
fn utf16be_hex(text: &str) -> String {
    let mut output = String::with_capacity(text.len() * 4);
    for unit in text.encode_utf16() {
        output.push_str(&format!("{unit:04X}"));
    }
    output
}

#[cfg(feature = "pdf")]
fn stream_object(bytes: Vec<u8>) -> Vec<u8> {
    let mut output = format!("<< /Length {} >>\nstream\n", bytes.len()).into_bytes();
    output.extend(bytes);
    output.extend_from_slice(b"endstream");
    output
}

#[cfg(feature = "pdf")]
fn write_pdf(objects: Vec<Vec<u8>>) -> Vec<u8> {
    let mut output = b"%PDF-1.7\n%\xE2\xE3\xCF\xD3\n".to_vec();
    let mut offsets = Vec::with_capacity(objects.len());
    for (index, object) in objects.iter().enumerate() {
        offsets.push(output.len());
        output.extend_from_slice(format!("{} 0 obj\n", index + 1).as_bytes());
        output.extend_from_slice(object);
        output.extend_from_slice(b"\nendobj\n");
    }
    let xref = output.len();
    output.extend_from_slice(
        format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1).as_bytes(),
    );
    for offset in offsets {
        output.extend_from_slice(format!("{offset:010} 00000 n \n").as_bytes());
    }
    output.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n",
            objects.len() + 1
        )
        .as_bytes(),
    );
    output
}

#[cfg(feature = "docx")]
pub fn render_docx(input: &ExportInput) -> Result<Vec<u8>, String> {
    let title = &input.title;
    let source = &input.source;
    let assets = &input.assets;
    let cursor = Cursor::new(Vec::new());
    let mut zip = ZipWriter::new(cursor);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    write_zip_file(&mut zip, "[Content_Types].xml", content_types(), options)?;
    write_zip_file(&mut zip, "_rels/.rels", package_relationships(), options)?;
    write_zip_file(
        &mut zip,
        "docProps/core.xml",
        &core_properties(title),
        options,
    )?;
    write_zip_file(&mut zip, "word/styles.xml", styles_xml(), options)?;
    write_zip_file(&mut zip, "word/numbering.xml", numbering_xml(), options)?;
    write_zip_file(
        &mut zip,
        "word/_rels/document.xml.rels",
        &document_relationships(assets),
        options,
    )?;
    write_zip_file(
        &mut zip,
        "word/document.xml",
        &document_xml(source, assets),
        options,
    )?;
    for (index, asset) in assets.iter().enumerate() {
        write_zip_bytes(
            &mut zip,
            &format!("word/media/image{}.{}", index + 1, asset_extension(asset)),
            &asset.bytes,
            options,
        )?;
    }
    zip.finish()
        .map(|cursor| cursor.into_inner())
        .map_err(|error| error.to_string())
}

#[cfg(feature = "docx")]
fn write_zip_file(
    zip: &mut ZipWriter<Cursor<Vec<u8>>>,
    name: &str,
    contents: &str,
    options: SimpleFileOptions,
) -> Result<(), String> {
    zip.start_file(name, options)
        .map_err(|error| error.to_string())?;
    zip.write_all(contents.as_bytes())
        .map_err(|error| error.to_string())
}

#[cfg(feature = "docx")]
fn write_zip_bytes(
    zip: &mut ZipWriter<Cursor<Vec<u8>>>,
    name: &str,
    contents: &[u8],
    options: SimpleFileOptions,
) -> Result<(), String> {
    zip.start_file(name, options)
        .map_err(|error| error.to_string())?;
    zip.write_all(contents).map_err(|error| error.to_string())
}

#[cfg(feature = "docx")]
fn document_xml(source: &str, assets: &[ExportAsset]) -> String {
    let mut body = String::new();
    for line in document_lines(source) {
        let (style, numbering, text) = match line.kind {
            LineKind::Blank => {
                body.push_str("<w:p/>");
                continue;
            }
            LineKind::Table(table) => {
                body.push_str(&docx_table(&table));
                continue;
            }
            LineKind::Image(image) => {
                if let Some((index, asset)) = assets
                    .iter()
                    .enumerate()
                    .find(|(_, asset)| asset.path == image.path)
                {
                    body.push_str(&docx_image(index + 1, asset, &image.alt));
                } else {
                    body.push_str(&format!(
                        "<w:p><w:r><w:t>{}</w:t></w:r></w:p>",
                        escape_xml(&image.alt)
                    ));
                }
                continue;
            }
            LineKind::Heading(level) => (Some(format!("Heading{}", level.min(3))), None, line.text),
            LineKind::Code => (Some("Code".to_owned()), None, line.text),
            LineKind::Quote => (Some("Quote".to_owned()), None, line.text),
            LineKind::Bullet => (None, Some(1), line.text),
            LineKind::Ordered => (None, Some(2), line.text),
            LineKind::Body => (None, None, line.text),
        };
        body.push_str("<w:p>");
        if style.is_some() || numbering.is_some() {
            body.push_str("<w:pPr>");
            if let Some(style) = style {
                body.push_str(&format!("<w:pStyle w:val=\"{style}\"/>"));
            }
            if let Some(numbering) = numbering {
                body.push_str(&format!(
                    "<w:numPr><w:ilvl w:val=\"0\"/><w:numId w:val=\"{numbering}\"/></w:numPr>"
                ));
            }
            body.push_str("</w:pPr>");
        }
        body.push_str(&format!(
            "<w:r><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>",
            escape_xml(&text)
        ));
    }
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\" xmlns:wp=\"http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:pic=\"http://schemas.openxmlformats.org/drawingml/2006/picture\"><w:body>{body}<w:sectPr><w:pgSz w:w=\"12240\" w:h=\"15840\"/><w:pgMar w:top=\"1440\" w:right=\"1440\" w:bottom=\"1440\" w:left=\"1440\" w:header=\"708\" w:footer=\"708\"/></w:sectPr></w:body></w:document>"
    )
}

#[cfg(feature = "docx")]
fn content_types() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Default Extension="svg" ContentType="image/svg+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>"#
}

#[cfg(feature = "docx")]
fn package_relationships() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>"#
}

#[cfg(feature = "docx")]
fn document_relationships(assets: &[ExportAsset]) -> String {
    let mut relationships = String::from(
        "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/><Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering\" Target=\"numbering.xml\"/>",
    );
    for (index, asset) in assets.iter().enumerate() {
        relationships.push_str(&format!(
            "<Relationship Id=\"rId{}\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"media/image{}.{}\"/>",
            index + 3,
            index + 1,
            asset_extension(asset)
        ));
    }
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">{relationships}</Relationships>"
    )
}

#[cfg(feature = "docx")]
fn asset_extension(asset: &ExportAsset) -> &str {
    match asset.media_type.as_str() {
        "image/png" => "png",
        "image/jpeg" => "jpeg",
        "image/gif" => "gif",
        "image/svg+xml" => "svg",
        _ => "bin",
    }
}

#[cfg(feature = "docx")]
fn docx_table(table: &TableData) -> String {
    let columns = table.rows.iter().map(Vec::len).max().unwrap_or(1);
    let width = 9000 / columns as u32;
    let mut xml = "<w:tbl><w:tblPr><w:tblW w:w=\"9000\" w:type=\"dxa\"/><w:tblLayout w:type=\"fixed\"/></w:tblPr><w:tblGrid>"
        .to_owned();
    for _ in 0..columns {
        xml.push_str(&format!("<w:gridCol w:w=\"{width}\"/>"));
    }
    xml.push_str("</w:tblGrid>");
    for (row_index, row) in table.rows.iter().enumerate() {
        xml.push_str("<w:tr>");
        for column in 0..columns {
            let text = row.get(column).map(String::as_str).unwrap_or("");
            let escaped_text = escape_xml(text);
            xml.push_str(&format!(
                "<w:tc><w:tcPr><w:tcW w:w=\"{width}\" w:type=\"dxa\"/><w:tcMar><w:top w:w=\"100\" w:type=\"dxa\"/><w:start w:w=\"120\" w:type=\"dxa\"/><w:bottom w:w=\"100\" w:type=\"dxa\"/><w:end w:w=\"120\" w:type=\"dxa\"/></w:tcMar></w:tcPr><w:p><w:r>{}{}</w:r></w:p></w:tc>",
                if row_index == 0 { "<w:rPr><w:b/></w:rPr>" } else { "" },
                format_args!("<w:t xml:space=\"preserve\">{escaped_text}</w:t>")
            ));
        }
        xml.push_str("</w:tr>");
    }
    xml.push_str("</w:tbl>");
    xml
}

#[cfg(feature = "docx")]
fn docx_image(index: usize, asset: &ExportAsset, alt: &str) -> String {
    let relationship_id = index + 3;
    let (cx, cy) = image::load_from_memory(&asset.bytes)
        .ok()
        .map(|image| image.dimensions())
        .filter(|(width, height)| *width > 0 && *height > 0)
        .map(|(width, height)| {
            let max_width = 5_486_400.0_f64;
            let max_height = 6_400_800.0_f64;
            let scale = (max_width / f64::from(width))
                .min(max_height / f64::from(height))
                .min(9525.0);
            (
                (f64::from(width) * scale).round() as u64,
                (f64::from(height) * scale).round() as u64,
            )
        })
        .unwrap_or((5_486_400, 2_743_200));
    format!(
        "<w:p><w:r><w:drawing><wp:inline><wp:extent cx=\"{cx}\" cy=\"{cy}\"/><wp:docPr id=\"{index}\" name=\"{}\" descr=\"{}\"/><a:graphic><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/picture\"><pic:pic><pic:blipFill><a:blip r:embed=\"rId{relationship_id}\"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x=\"0\" y=\"0\"/><a:ext cx=\"{cx}\" cy=\"{cy}\"/></a:xfrm><a:prstGeom prst=\"rect\"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>",
        escape_xml(&format!("image-{index}.{}", asset_extension(asset))),
        escape_xml(alt)
    )
}

#[cfg(feature = "docx")]
fn styles_xml() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:color w:val="000000"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="200"/></w:pPr><w:rPr><w:b/><w:color w:val="2E74B5"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="140"/></w:pPr><w:rPr><w:b/><w:color w:val="2E74B5"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="100"/></w:pPr><w:rPr><w:b/><w:color w:val="1F4D78"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360"/><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr><w:rPr><w:i/><w:color w:val="666666"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="240"/><w:spacing w:after="80" w:line="280" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Microsoft YaHei"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style></w:styles>"#
}

#[cfg(feature = "docx")]
fn numbering_xml() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="540"/></w:tabs><w:ind w:left="540" w:hanging="270"/><w:spacing w:after="80" w:line="300" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei"/></w:rPr></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="540"/></w:tabs><w:ind w:left="540" w:hanging="270"/><w:spacing w:after="80" w:line="300" w:lineRule="auto"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num></w:numbering>"#
}

#[cfg(feature = "docx")]
fn core_properties(title: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>{}</dc:title><dc:creator>Navop Notes Document Exporter</dc:creator></cp:coreProperties>"#,
        escape_xml(title)
    )
}

#[cfg(feature = "html")]
fn escape_html(value: &str) -> String {
    escape_xml(value)
}

#[cfg(any(feature = "html", feature = "docx"))]
fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    fn request() -> ExportInput {
        ExportInput {
            title: "导出测试".to_owned(),
            source: "# 标题\n\n正文 **加粗**\n\n| 名称 | 数量 |\n| --- | ---: |\n| 测试 | 1 |\n\n![示例](image.png)\n\n- 项目\n\n1. 第一步\n\n> 引用\n\n```rust\nfn main() {}\n```".to_owned(),
            assets: vec![ExportAsset {
                path: "image.png".to_owned(),
                media_type: "image/png".to_owned(),
                bytes: vec![
                    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0,
                    0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0, 144, 119, 83, 222, 0, 0, 0, 12, 73,
                    68, 65, 84, 8, 215, 99, 248, 207, 192, 0, 0, 3, 1, 1, 0, 24, 221, 141,
                    176, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
                ],
            }],
            theme: ExportTheme {
                dark: false,
                background: 0xffffff,
                foreground: 0x222222,
                border: 0xdddddd,
                muted: 0x777777,
                accent: 0x2563eb,
            },
        }
    }

    #[test]
    fn html_export_is_self_contained() {
        let html = String::from_utf8(render_html(&request())).unwrap();
        assert!(html.contains("<h1>标题</h1>"));
        assert!(html.contains("<style>"));
        assert!(html.contains("data:image/png;base64,"));
    }

    #[test]
    fn html_export_inlines_percent_encoded_asset_paths() {
        let html = inline_html_images(
            r#"<img src="diagram%20one.png">"#,
            &[ExportAsset {
                path: "diagram one.png".to_owned(),
                media_type: "image/png".to_owned(),
                bytes: vec![1, 2, 3],
            }],
        );
        assert!(html.contains("data:image/png;base64,AQID"));
    }

    #[test]
    fn pdf_export_has_valid_header_and_unicode_font() {
        let artifact = render_pdf(&request()).unwrap();
        assert!(artifact.starts_with(b"%PDF-1.7"));
        assert!(String::from_utf8_lossy(&artifact).contains("/STSong-Light"));
        assert!(String::from_utf8_lossy(&artifact).contains("/ASCIIHexDecode"));
        assert!(artifact.len() > 500);
    }

    #[test]
    fn pdf_export_rasterizes_svg_assets() {
        let mut request = request();
        request.source = "![Board](board.svg)".to_owned();
        request.assets = vec![ExportAsset {
            path: "board.svg".to_owned(),
            media_type: "image/svg+xml".to_owned(),
            bytes: br#"<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="red"/></svg>"#.to_vec(),
        }];
        let artifact = render_pdf(&request).unwrap();
        assert!(String::from_utf8_lossy(&artifact).contains("/ASCIIHexDecode"));
    }

    #[test]
    fn word_export_is_a_docx_package_with_document_xml() {
        let artifact = render_docx(&request()).unwrap();
        assert!(artifact.starts_with(b"PK"));
        let mut archive = zip::ZipArchive::new(Cursor::new(artifact)).unwrap();
        let mut document = String::new();
        archive
            .by_name("word/document.xml")
            .unwrap()
            .read_to_string(&mut document)
            .unwrap();
        assert!(document.contains("标题"));
        assert!(document.contains("正文 加粗"));
        assert!(document.contains("<w:numPr>"));
        assert!(document.contains("<w:tbl>"));
        assert!(document.contains("<w:drawing>"));
        assert!(archive.by_name("word/media/image1.png").is_ok());
        let mut numbering = String::new();
        archive
            .by_name("word/numbering.xml")
            .unwrap()
            .read_to_string(&mut numbering)
            .unwrap();
        assert!(numbering.contains("w:numFmt w:val=\"bullet\""));
        assert!(numbering.contains("w:numFmt w:val=\"decimal\""));
    }

    #[test]
    fn writes_visual_qa_samples_when_requested() {
        let Ok(directory) = std::env::var("NAVOP_EXPORT_SAMPLE_DIR") else {
            return;
        };
        std::fs::create_dir_all(&directory).unwrap();
        for (extension, artifact) in [
            ("html", render_html(&request())),
            ("pdf", render_pdf(&request()).unwrap()),
            ("docx", render_docx(&request()).unwrap()),
        ] {
            std::fs::write(
                std::path::Path::new(&directory).join(format!("notes-export-sample.{extension}")),
                artifact,
            )
            .unwrap();
        }
    }
}
