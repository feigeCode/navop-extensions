wit_bindgen::generate!({
    path: "../../../wit",
    world: "connection-importer",
});

use onet::extension::{connection_import::CandidateFile, connection_import_host};

struct XshellImporter;

impl Guest for XshellImporter {
    fn descriptor() -> String {
        serde_json::json!({
            "id": "xshell",
            "display_name": "Xshell .xsh/.xts",
            "description": "Import SSH sessions from Xshell .xsh files and .xts backups",
            "icon": "terminal",
            "vendor": "Navop",
            "supported_platforms": ["macos", "windows", "linux"],
            "output_kinds": ["ssh"],
            "capabilities": {
                "supports_scan": true,
                "supports_password_import": false,
                "supports_manual_file_pick": true,
                "supports_incremental_preview": false
            }
        })
        .to_string()
    }

    fn scan() -> String {
        let candidates = connection_import_host::list_candidate_files("xshell");
        let sessions = read_sessions(&candidates);
        let availability = if sessions.is_empty() {
            serde_json::json!("no_data")
        } else {
            serde_json::json!({ "available": { "estimated_count": sessions.len() } })
        };

        serde_json::json!({
            "importer_id": "xshell",
            "availability": availability,
            "discovered_files": candidates.into_iter().map(|candidate| {
                serde_json::json!({
                    "candidate_id": candidate.id,
                    "display_path": candidate.path
                })
            }).collect::<Vec<_>>(),
            "warnings": []
        })
        .to_string()
    }

    fn preview(options: ImportOptions) -> String {
        let candidates = connection_import_host::list_candidate_files("xshell");
        let sessions = read_sessions(&candidates);
        let records = crate::xshell::preview_records_from_sessions(
            sessions
                .iter()
                .map(|(path, bytes)| (path.clone(), bytes.as_slice())),
            options.include_passwords,
        );
        serde_json::to_string(&records).unwrap_or_else(|_| "[]".to_string())
    }
}

fn read_sessions(candidates: &[CandidateFile]) -> Vec<(String, Vec<u8>)> {
    let mut sessions = Vec::new();
    for candidate in candidates {
        if let Ok(entries) = connection_import_host::read_directory(&candidate.id) {
            for entry in entries {
                if entry.is_dir || !crate::xshell::is_supported_source_path(&entry.name) {
                    continue;
                }
                if let Ok(bytes) = connection_import_host::read_candidate_child_file(
                    &entry.candidate_id,
                    &entry.name,
                ) {
                    sessions.push((entry.name, bytes));
                }
            }
            continue;
        }
        if crate::xshell::is_supported_source_path(&candidate.path)
            && let Ok(bytes) = connection_import_host::read_file(&candidate.id)
        {
            sessions.push((candidate.path.clone(), bytes));
        }
    }
    sessions
}

export!(XshellImporter);
