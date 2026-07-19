wit_bindgen::generate!({ path: "../../../wit", world: "document-exporter" });

struct NotesWordExporter;

impl Guest for NotesWordExporter {
    fn export_document(input: Request) -> Result<Artifact, String> {
        validate(&input, "notes-word", "docx")?;
        Ok(Artifact {
            media_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                .to_owned(),
            extension: "docx".to_owned(),
            bytes: notes_document_export_core::render_docx(&convert(input))?,
        })
    }
}

fn validate(input: &Request, exporter: &str, format: &str) -> Result<(), String> {
    if input.exporter == exporter && input.format == format {
        Ok(())
    } else {
        Err(format!(
            "unsupported exporter or format: {}/{}",
            input.exporter, input.format
        ))
    }
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

export!(NotesWordExporter);
