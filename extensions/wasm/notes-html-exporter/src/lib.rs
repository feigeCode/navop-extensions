wit_bindgen::generate!({ path: "../../../wit", world: "document-exporter" });

struct NotesHtmlExporter;

impl Guest for NotesHtmlExporter {
    fn export_document(input: Request) -> Result<Artifact, String> {
        validate(&input, "notes-html", "html")?;
        Ok(Artifact {
            media_type: "text/html".to_owned(),
            extension: "html".to_owned(),
            bytes: notes_document_export_core::render_html(&convert(input)),
        })
    }
}

fn validate(input: &Request, exporter: &str, format: &str) -> Result<(), String> {
    if input.exporter != exporter || input.format != format {
        return Err(format!(
            "unsupported exporter or format: {}/{}",
            input.exporter, input.format
        ));
    }
    Ok(())
}

fn convert(input: Request) -> notes_document_export_core::ExportInput {
    notes_document_export_core::ExportInput {
        title: input.title,
        source: input.source,
        assets: input
            .assets
            .into_iter()
            .map(|asset| notes_document_export_core::ExportAsset {
                path: asset.path,
                media_type: asset.media_type,
                bytes: asset.bytes,
            })
            .collect(),
        theme: notes_document_export_core::ExportTheme {
            dark: input.theme.dark,
            background: input.theme.background,
            foreground: input.theme.foreground,
            border: input.theme.border,
            muted: input.theme.muted,
            accent: input.theme.accent,
        },
    }
}

export!(NotesHtmlExporter);
