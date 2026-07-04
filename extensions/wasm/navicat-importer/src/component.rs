wit_bindgen::generate!({
    path: "../../../wit",
    world: "connection-importer",
});

use onet::extension::{connection_import::CandidateFile, connection_import_host};

struct NavicatImporter;

impl Guest for NavicatImporter {
    fn descriptor() -> String {
        serde_json::json!({
            "id": "navicat",
            "display_name": "Navicat",
            "description": "Import database connections from Navicat",
            "icon": "database",
            "vendor": "OnetCli",
            "supported_platforms": ["macos"],
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
        let candidates = connection_import_host::list_candidate_files("navicat");
        let readable = read_plists(&candidates).len();
        let availability = if readable > 0 {
            serde_json::json!({ "available": { "estimated_count": null } })
        } else {
            serde_json::json!("no_data")
        };

        serde_json::json!({
            "importer_id": "navicat",
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
        let candidates = connection_import_host::list_candidate_files("navicat");
        let plists = read_plists(&candidates);
        let records = crate::navicat::preview_records_from_plists(
            plists
                .iter()
                .map(|(path, bytes)| (path.clone(), bytes.as_slice())),
            options.include_passwords,
        );
        serde_json::to_string(&records).unwrap_or_else(|_| "[]".to_string())
    }
}

fn read_plists(candidates: &[CandidateFile]) -> Vec<(String, Vec<u8>)> {
    candidates
        .iter()
        .filter_map(|candidate| {
            connection_import_host::read_file(&candidate.id)
                .ok()
                .map(|bytes| (candidate.path.clone(), bytes))
        })
        .collect()
}

export!(NavicatImporter);
