wit_bindgen::generate!({
    path: "../../../wit",
    world: "connection-importer",
});

use onet::extension::{connection_import::CandidateFile, connection_import_host};

struct DbeaverImporter;

impl Guest for DbeaverImporter {
    fn descriptor() -> String {
        serde_json::json!({
            "id": "dbeaver",
            "display_name": "DBeaver",
            "description": "Import database connections from DBeaver",
            "icon": "database",
            "vendor": "OnetCli",
            "supported_platforms": ["macos", "windows"],
            "output_kinds": ["database"],
            "capabilities": {
                "supports_scan": true,
                "supports_password_import": true,
                "supports_manual_file_pick": true,
                "supports_incremental_preview": false
            }
        })
        .to_string()
    }

    fn scan() -> String {
        let candidates = connection_import_host::list_candidate_files("dbeaver");
        let data_sources = candidates
            .iter()
            .filter(|candidate| candidate.id.contains("data-sources"))
            .filter(|candidate| connection_import_host::read_file(&candidate.id).is_ok())
            .count();
        let availability = if data_sources > 0 {
            serde_json::json!({ "available": { "estimated_count": null } })
        } else {
            serde_json::json!("no_data")
        };

        serde_json::json!({
            "importer_id": "dbeaver",
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
        let candidates = connection_import_host::list_candidate_files("dbeaver");
        let data_sources = read_first(&candidates, "data-sources");
        let credentials = options
            .include_passwords
            .then(|| read_first(&candidates, "credentials"))
            .flatten();
        let records = data_sources
            .as_deref()
            .map(|bytes| {
                crate::dbeaver::preview_records(
                    bytes,
                    credentials.as_deref(),
                    options.include_passwords,
                )
            })
            .unwrap_or_default();
        serde_json::to_string(&records).unwrap_or_else(|_| "[]".to_string())
    }
}

fn read_first(candidates: &[CandidateFile], id_part: &str) -> Option<Vec<u8>> {
    candidates
        .iter()
        .filter(|candidate| candidate.id.contains(id_part))
        .find_map(|candidate| connection_import_host::read_file(&candidate.id).ok())
}

export!(DbeaverImporter);
