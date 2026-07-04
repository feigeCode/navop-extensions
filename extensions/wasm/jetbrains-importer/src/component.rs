wit_bindgen::generate!({
    path: "../../../wit",
    world: "connection-importer",
});

use onet::extension::{connection_import::CandidateFile, connection_import_host};

struct JetbrainsImporter;

impl Guest for JetbrainsImporter {
    fn descriptor() -> String {
        serde_json::json!({
            "id": "jetbrains",
            "display_name": "JetBrains IDEs",
            "description": "Import database connections from JetBrains DataGrip and IDE dataSources.xml files",
            "icon": "database",
            "vendor": "OnetCli",
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
        let candidates = connection_import_host::list_candidate_files("jetbrains");
        let files = read_data_source_files(&candidates);
        let availability = if files.is_empty() {
            serde_json::json!("no_data")
        } else {
            serde_json::json!({ "available": { "estimated_count": files.len() } })
        };

        serde_json::json!({
            "importer_id": "jetbrains",
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
        let candidates = connection_import_host::list_candidate_files("jetbrains");
        let files = read_data_source_files(&candidates);
        let records = crate::jetbrains::preview_records_from_xml_files(
            files
                .iter()
                .map(|(path, bytes)| (path.clone(), bytes.as_slice())),
            options.include_passwords,
        );
        serde_json::to_string(&records).unwrap_or_else(|_| "[]".to_string())
    }
}

fn read_data_source_files(candidates: &[CandidateFile]) -> Vec<(String, Vec<u8>)> {
    let mut files = Vec::new();
    for candidate in candidates {
        if candidate.path.to_ascii_lowercase().ends_with(".xml") {
            if let Ok(bytes) = connection_import_host::read_file(&candidate.id) {
                files.push((candidate.path.clone(), bytes));
            }
            continue;
        }

        let Ok(entries) = connection_import_host::read_directory(&candidate.id) else {
            continue;
        };
        for entry in entries {
            if !entry.is_dir || !is_jetbrains_product_dir(&entry.name) {
                continue;
            }
            for file_name in ["dataSources.xml", "dataSources.local.xml"] {
                let relative_path = format!("{}/options/{file_name}", entry.name);
                if let Ok(bytes) = connection_import_host::read_candidate_child_file(
                    &entry.candidate_id,
                    &relative_path,
                ) {
                    files.push((relative_path, bytes));
                }
            }
        }
    }
    files
}

fn is_jetbrains_product_dir(name: &str) -> bool {
    const PREFIXES: &[&str] = &[
        "DataGrip",
        "IntelliJIdea",
        "IdeaIC",
        "PyCharm",
        "PhpStorm",
        "WebStorm",
        "GoLand",
        "Rider",
        "CLion",
        "RubyMine",
        "RustRover",
    ];
    PREFIXES.iter().any(|prefix| name.starts_with(prefix))
}

export!(JetbrainsImporter);
