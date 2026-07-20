wit_bindgen::generate!({
    path: "../../../wit",
    world: "connection-importer",
});

use onet::extension::{connection_import::CandidateFile, connection_import_host};

struct WindtermImporter;

struct SessionFile {
    candidate_id: String,
    path: String,
    bytes: Vec<u8>,
}

impl Guest for WindtermImporter {
    fn descriptor() -> String {
        serde_json::json!({
            "id": "windterm",
            "display_name": "WindTerm",
            "description": "Import SSH sessions from WindTerm profiles",
            "icon": "terminal",
            "vendor": "Navop",
            "supported_platforms": ["macos", "windows", "linux"],
            "output_kinds": ["ssh"],
            "capabilities": {
                "supports_scan": true,
                "supports_password_import": false,
                "supports_manual_file_pick": true,
                "manual_file_pick_prompt": "Select a WindTerm user.sessions file",
                "supports_incremental_preview": false
            }
        })
        .to_string()
    }

    fn scan() -> String {
        let candidates = connection_import_host::list_candidate_files("windterm");
        let files = read_session_files(&candidates);
        let availability = if files.is_empty() {
            serde_json::json!("no_data")
        } else {
            serde_json::json!({ "available": { "estimated_count": null } })
        };

        serde_json::json!({
            "importer_id": "windterm",
            "availability": availability,
            "discovered_files": files.iter().map(|file| {
                serde_json::json!({
                    "candidate_id": file.candidate_id,
                    "display_path": file.path
                })
            }).collect::<Vec<_>>(),
            "warnings": []
        })
        .to_string()
    }

    fn preview(options: ImportOptions) -> String {
        let candidates = connection_import_host::list_candidate_files("windterm");
        let files = read_session_files(&candidates);
        let records = crate::windterm::preview_records_from_session_files(
            files
                .iter()
                .map(|file| (file.path.clone(), file.bytes.as_slice())),
            options.include_passwords,
        );
        serde_json::to_string(&records).unwrap_or_else(|_| "[]".to_string())
    }
}

fn read_session_files(candidates: &[CandidateFile]) -> Vec<SessionFile> {
    let mut files = Vec::new();
    for candidate in candidates {
        if let Ok(entries) = connection_import_host::read_directory(&candidate.id) {
            for entry in entries {
                if !entry.is_dir || !safe_profile_name(&entry.name) {
                    continue;
                }
                let relative_path = format!("{}/terminal/user.sessions", entry.name);
                if let Ok(bytes) = connection_import_host::read_candidate_child_file(
                    &entry.candidate_id,
                    &relative_path,
                ) {
                    files.push(SessionFile {
                        candidate_id: candidate.id.clone(),
                        path: format!("{}/{}", candidate.path, relative_path),
                        bytes,
                    });
                }
            }
            continue;
        }

        if let Ok(bytes) = connection_import_host::read_file(&candidate.id) {
            files.push(SessionFile {
                candidate_id: candidate.id.clone(),
                path: candidate.path.clone(),
                bytes,
            });
        }
    }
    files
}

fn safe_profile_name(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains(['/', '\\'])
}

export!(WindtermImporter);
