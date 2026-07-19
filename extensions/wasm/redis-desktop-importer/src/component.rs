wit_bindgen::generate!({
    path: "../../../wit",
    world: "connection-importer",
});

use onet::extension::{connection_import::CandidateFile, connection_import_host};

struct RedisDesktopImporter;

impl Guest for RedisDesktopImporter {
    fn descriptor() -> String {
        serde_json::json!({
            "id": "redis-desktop",
            "display_name": "Redis Desktop",
            "description": "Import Redis connection metadata from Redis desktop clients",
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
        let candidates = connection_import_host::list_candidate_files("redis-desktop");
        let files = read_store_files(&candidates);
        let availability = if files.is_empty() {
            serde_json::json!("no_data")
        } else {
            serde_json::json!({ "available": { "estimated_count": null } })
        };

        serde_json::json!({
            "importer_id": "redis-desktop",
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
        let candidates = connection_import_host::list_candidate_files("redis-desktop");
        let files = read_store_files(&candidates);
        let records = crate::redis_desktop::preview_records_from_store_files(
            files
                .iter()
                .map(|(path, bytes)| (path.clone(), bytes.as_slice())),
            options.include_passwords,
        );
        serde_json::to_string(&records).unwrap_or_else(|_| "[]".to_string())
    }
}

fn read_store_files(candidates: &[CandidateFile]) -> Vec<(String, Vec<u8>)> {
    candidates
        .iter()
        .filter_map(|candidate| {
            connection_import_host::read_file(&candidate.id)
                .ok()
                .map(|bytes| (candidate.path.clone(), bytes))
        })
        .collect()
}

export!(RedisDesktopImporter);
