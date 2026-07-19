wit_bindgen::generate!({ path: "../../../wit", world: "document-exporter" });

use pulldown_cmark::{Options, Parser, html};
use std::io::{Cursor, Write};
use zip::{CompressionMethod, ZipWriter, write::SimpleFileOptions};

struct NotesDocumentExporter;

impl Guest for NotesDocumentExporter {
    fn export_document(input: Request) -> Result<Artifact, String> {
        if input.exporter != "notes-documents" {
            return Err(format!("unsupported exporter: {}", input.exporter));
        }
        match input.format.as_str() {
            "html" => Ok(Artifact {
                media_type: "text/html".to_owned(),
                extension: "html".to_owned(),
                bytes: render_html(&input).into_bytes(),
            }),
            "pdf" => Ok(Artifact {
                media_type: "application/pdf".to_owned(),
                extension: "pdf".to_owned(),
                bytes: render_pdf(&input.title, &input.source)?,
            }),
            "docx" => Ok(Artifact {
                media_type:
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        .to_owned(),
                extension: "docx".to_owned(),
                bytes: render_docx(&input.title, &input.source)?,
            }),
            format => Err(format!("unsupported export format: {format}")),
        }
    }
}

fn render_html(input: &Request) -> String {
    let mut options = Options::empty();
    options.insert(Options::ENABLE_TABLES);
    options.insert(Options::ENABLE_FOOTNOTES);
    options.insert(Options::ENABLE_STRIKETHROUGH);
    options.insert(Options::ENABLE_TASKLISTS);
    let mut body = String::new();
    html::push_html(&mut body, Parser::new_ext(&input.source, options));
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
}

fn css_color(value: u32) -> String {
    format!("#{:06x}", value & 0x00ff_ffff)
}

#[derive(Clone, Debug)]
struct DocumentLine {
    kind: LineKind,
    text: String,
}

#[derive(Clone, Copy, Debug)]
enum LineKind {
    Blank,
    Heading(u8),
    Body,
    Quote,
    Bullet,
    Ordered,
    Code,
}

fn document_lines(source: &str) -> Vec<DocumentLine> {
    let mut lines = Vec::new();
    let mut code = false;
    for raw in source.lines() {
        let trimmed = raw.trim_end();
        if trimmed.trim_start().starts_with("```") || trimmed.trim_start().starts_with("~~~") {
            code = !code;
            continue;
        }
        if code {
            lines.push(DocumentLine {
                kind: LineKind::Code,
                text: trimmed.to_owned(),
            });
            continue;
        }
        let start = trimmed.trim_start();
        if start.is_empty() {
            lines.push(DocumentLine {
                kind: LineKind::Blank,
                text: String::new(),
            });
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
    }
    lines
}

fn ordered_list_item(line: &str) -> Option<(&str, &str)> {
    let dot = line.find(". ")?;
    let number = &line[..dot];
    (!number.is_empty() && number.bytes().all(|byte| byte.is_ascii_digit()))
        .then_some((number, &line[dot + 2..]))
}

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

fn render_pdf(_title: &str, source: &str) -> Result<Vec<u8>, String> {
    let pages = layout_pdf_pages(&document_lines(source));
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

fn layout_pdf_pages(lines: &[DocumentLine]) -> Vec<String> {
    let mut pages = vec![String::from("q 1 1 1 rg 0 0 595 842 re f Q\n")];
    let mut y = 788.0f32;
    for line in lines {
        let (size, indent, leading) = match line.kind {
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
        };
        let display_text = match line.kind {
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

fn utf16be_hex(text: &str) -> String {
    let mut output = String::with_capacity(text.len() * 4);
    for unit in text.encode_utf16() {
        output.push_str(&format!("{unit:04X}"));
    }
    output
}

fn stream_object(bytes: Vec<u8>) -> Vec<u8> {
    let mut output = format!("<< /Length {} >>\nstream\n", bytes.len()).into_bytes();
    output.extend(bytes);
    output.extend_from_slice(b"endstream");
    output
}

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

fn render_docx(title: &str, source: &str) -> Result<Vec<u8>, String> {
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
        document_relationships(),
        options,
    )?;
    write_zip_file(
        &mut zip,
        "word/document.xml",
        &document_xml(source),
        options,
    )?;
    zip.finish()
        .map(|cursor| cursor.into_inner())
        .map_err(|error| error.to_string())
}

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

fn document_xml(source: &str) -> String {
    let mut body = String::new();
    for line in document_lines(source) {
        let (style, numbering, text) = match line.kind {
            LineKind::Blank => {
                body.push_str("<w:p/>");
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
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?><w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body>{body}<w:sectPr><w:pgSz w:w=\"12240\" w:h=\"15840\"/><w:pgMar w:top=\"1440\" w:right=\"1440\" w:bottom=\"1440\" w:left=\"1440\" w:header=\"708\" w:footer=\"708\"/></w:sectPr></w:body></w:document>"
    )
}

fn content_types() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>"#
}

fn package_relationships() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>"#
}

fn document_relationships() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>"#
}

fn styles_xml() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:color w:val="000000"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="200"/></w:pPr><w:rPr><w:b/><w:color w:val="2E74B5"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="140"/></w:pPr><w:rPr><w:b/><w:color w:val="2E74B5"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="100"/></w:pPr><w:rPr><w:b/><w:color w:val="1F4D78"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360"/><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr><w:rPr><w:i/><w:color w:val="666666"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="240"/><w:spacing w:after="80" w:line="280" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Microsoft YaHei"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style></w:styles>"#
}

fn numbering_xml() -> &'static str {
    r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="540"/></w:tabs><w:ind w:left="540" w:hanging="270"/><w:spacing w:after="80" w:line="300" w:lineRule="auto"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei"/></w:rPr></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="2"><w:multiLevelType w:val="singleLevel"/><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:tabs><w:tab w:val="num" w:pos="540"/></w:tabs><w:ind w:left="540" w:hanging="270"/><w:spacing w:after="80" w:line="300" w:lineRule="auto"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num></w:numbering>"#
}

fn core_properties(title: &str) -> String {
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>{}</dc:title><dc:creator>Navop Notes Document Exporter</dc:creator></cp:coreProperties>"#,
        escape_xml(title)
    )
}

fn escape_html(value: &str) -> String {
    escape_xml(value)
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

export!(NotesDocumentExporter);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::onet::extension::document_export::Theme;
    use std::io::Read;

    fn request(format: &str) -> Request {
        Request {
            exporter: "notes-documents".to_owned(),
            format: format.to_owned(),
            title: "导出测试".to_owned(),
            source: "# 标题\n\n正文 **加粗**\n\n- 项目\n\n1. 第一步\n\n> 引用\n\n```rust\nfn main() {}\n```".to_owned(),
            theme: Theme {
                dark: false,
                background: 0xffffff,
                foreground: 0x222222,
                border: 0xdddddd,
                muted: 0x777777,
                accent: 0x2563eb,
                danger: 0xdc2626,
                font_family: String::new(),
            },
        }
    }

    #[test]
    fn html_export_is_self_contained() {
        let artifact = NotesDocumentExporter::export_document(request("html")).unwrap();
        let html = String::from_utf8(artifact.bytes).unwrap();
        assert_eq!("html", artifact.extension);
        assert!(html.contains("<h1>标题</h1>"));
        assert!(html.contains("<style>"));
    }

    #[test]
    fn pdf_export_has_valid_header_and_unicode_font() {
        let artifact = NotesDocumentExporter::export_document(request("pdf")).unwrap();
        assert!(artifact.bytes.starts_with(b"%PDF-1.7"));
        assert!(String::from_utf8_lossy(&artifact.bytes).contains("/STSong-Light"));
        assert!(artifact.bytes.len() > 500);
    }

    #[test]
    fn word_export_is_a_docx_package_with_document_xml() {
        let artifact = NotesDocumentExporter::export_document(request("docx")).unwrap();
        assert!(artifact.bytes.starts_with(b"PK"));
        let mut archive = zip::ZipArchive::new(Cursor::new(artifact.bytes)).unwrap();
        let mut document = String::new();
        archive
            .by_name("word/document.xml")
            .unwrap()
            .read_to_string(&mut document)
            .unwrap();
        assert!(document.contains("标题"));
        assert!(document.contains("正文 加粗"));
        assert!(document.contains("<w:numPr>"));
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
        for format in ["html", "pdf", "docx"] {
            let artifact = NotesDocumentExporter::export_document(request(format)).unwrap();
            std::fs::write(
                std::path::Path::new(&directory)
                    .join(format!("notes-export-sample.{}", artifact.extension)),
                artifact.bytes,
            )
            .unwrap();
        }
    }
}
