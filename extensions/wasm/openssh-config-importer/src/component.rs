wit_bindgen::generate!({
    path: "../../../wit",
    world: "connection-importer",
});

use onet::extension::{connection_import::CandidateFile, connection_import_host};

struct OpensshConfigImporter;

impl Guest for OpensshConfigImporter {
    fn descriptor() -> String {
        serde_json::json!({
            "id": "openssh-config",
            "display_name": "OpenSSH Config",
            "description": "Import SSH hosts from OpenSSH client config",
            "icon": "terminal",
            "vendor": "OnetCli",
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
        let candidates = connection_import_host::list_candidate_files("openssh-config");
        let files = read_configs(&candidates);
        let availability = if files.is_empty() {
            serde_json::json!("no_data")
        } else {
            serde_json::json!({ "available": { "estimated_count": null } })
        };

        serde_json::json!({
            "importer_id": "openssh-config",
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
        let candidates = connection_import_host::list_candidate_files("openssh-config");
        let files = read_configs(&candidates);
        let records = crate::openssh_config::preview_records_from_configs(
            files
                .iter()
                .map(|(path, bytes)| (path.clone(), bytes.as_slice())),
            options.include_passwords,
        );
        serde_json::to_string(&records).unwrap_or_else(|_| "[]".to_string())
    }
}

fn read_configs(candidates: &[CandidateFile]) -> Vec<(String, Vec<u8>)> {
    candidates
        .iter()
        .filter_map(|candidate| {
            connection_import_host::read_file(&candidate.id)
                .ok()
                .map(|bytes| (candidate.path.clone(), bytes))
        })
        .collect()
}

export!(OpensshConfigImporter);
