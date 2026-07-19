wit_bindgen::generate!({
    path: "../../../wit",
    world: "connection-importer",
});

use onet::extension::{connection_import::CandidateFile, connection_import_host};

struct MongodbCompassImporter;

impl Guest for MongodbCompassImporter {
    fn descriptor() -> String {
        serde_json::json!({
            "id": "mongodb-compass",
            "display_name": "MongoDB Compass",
            "description": "Import MongoDB connection metadata from MongoDB Compass",
            "icon": "database",
            "vendor": "Navop",
            "supported_platforms": ["macos", "windows", "linux"],
            "output_kinds": ["database"],
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
        let candidates = connection_import_host::list_candidate_files("mongodb-compass");
        let files = read_connection_files(&candidates);
        let availability = if files.is_empty() {
            serde_json::json!("no_data")
        } else {
            serde_json::json!({ "available": { "estimated_count": files.len() } })
        };

        serde_json::json!({
            "importer_id": "mongodb-compass",
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
        let candidates = connection_import_host::list_candidate_files("mongodb-compass");
        let files = read_connection_files(&candidates);
        let records = crate::mongodb_compass::preview_records_from_connection_files(
            files
                .iter()
                .map(|(path, bytes)| (path.clone(), bytes.as_slice())),
            options.include_passwords,
        );
        serde_json::to_string(&records).unwrap_or_else(|_| "[]".to_string())
    }
}

fn read_connection_files(candidates: &[CandidateFile]) -> Vec<(String, Vec<u8>)> {
    let mut files = Vec::new();
    for candidate in candidates {
        if candidate.path.to_ascii_lowercase().ends_with(".json") {
            if let Ok(bytes) = connection_import_host::read_file(&candidate.id) {
                files.push((candidate.path.clone(), bytes));
            }
            continue;
        }

        let Ok(entries) = connection_import_host::read_directory(&candidate.id) else {
            continue;
        };
        for entry in entries {
            if entry.is_dir || !entry.name.to_ascii_lowercase().ends_with(".json") {
                continue;
            }
            if let Ok(bytes) =
                connection_import_host::read_candidate_child_file(&entry.candidate_id, &entry.name)
            {
                files.push((entry.name, bytes));
            }
        }
    }
    files
}

export!(MongodbCompassImporter);
