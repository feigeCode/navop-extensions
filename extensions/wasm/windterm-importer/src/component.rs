wit_bindgen::generate!({
    path: "../../../wit",
    world: "connection-importer",
});

use std::collections::BTreeSet;

use onet::extension::{
    connection_import::{CandidateFile, Platform},
    connection_import_host,
};

use crate::windterm::{DiscoveredFiles, InputFile, TargetPlatform};

struct WindtermImporter;

impl Guest for WindtermImporter {
    fn descriptor() -> String {
        serde_json::json!({
            "id": "windterm",
            "display_name": "WindTerm",
            "description": "Import SSH/Telnet sessions, groups, QuickBar commands, and keybindings from WindTerm",
            "icon": "terminal",
            "vendor": "Navop",
            "supported_platforms": ["macos", "windows", "linux"],
            "output_kinds": if host_supports_keybindings() {
                serde_json::json!(["ssh", "telnet", "quick_command", "workspace", "keybinding"])
            } else {
                serde_json::json!(["ssh", "telnet", "quick_command", "workspace"])
            },
            "capabilities": {
                "supports_scan": true,
                "supports_password_import": false,
                "supports_manual_file_pick": true,
                "supports_manual_directory_pick": true,
                "manual_file_pick_prompt": "Select WindTerm user.sessions, quickbar.config, or wind.keymaps",
                "manual_directory_pick_prompt": "Select WindTerm installation or .wind profile directory",
                "supports_incremental_preview": false
            }
        })
        .to_string()
    }

    fn scan() -> String {
        let platform = map_platform(connection_import_host::current_platform());
        let include_keybindings = host_supports_keybindings();
        let candidates = connection_import_host::list_candidate_files("windterm");
        let files = discover_windterm_files(&candidates);
        let report =
            crate::windterm::scan_report_from_files(&files, platform, include_keybindings);
        serde_json::to_string(&report).unwrap_or_else(|_| {
            serde_json::json!({
                "importer_id": "windterm",
                "availability": "no_data",
                "discovered_files": [],
                "warnings": [],
                "discovered_workspace_paths": []
            })
            .to_string()
        })
    }

    fn preview(options: ImportOptions) -> String {
        let platform = map_platform(connection_import_host::current_platform());
        let include_keybindings = host_supports_keybindings();
        let candidates = connection_import_host::list_candidate_files("windterm");
        let files = discover_windterm_files(&candidates);
        let records = crate::windterm::preview_records_from_files(
            &files,
            platform,
            options.include_passwords,
            include_keybindings,
        );
        serde_json::to_string(&records).unwrap_or_else(|_| "[]".to_string())
    }
}

fn host_supports_keybindings() -> bool {
    std::env::var("NAVOP_IMPORT_CAPABILITIES")
        .ok()
        .is_some_and(|caps| {
            caps.split(',')
                .any(|cap| cap.trim().eq_ignore_ascii_case("keybinding"))
        })
}

fn map_platform(platform: Platform) -> TargetPlatform {
    match platform {
        Platform::Macos => TargetPlatform::Macos,
        Platform::Windows => TargetPlatform::Windows,
        Platform::Linux => TargetPlatform::Linux,
    }
}

fn discover_windterm_files(candidates: &[CandidateFile]) -> DiscoveredFiles {
    let mut files = DiscoveredFiles::default();
    let mut seen_paths = BTreeSet::new();

    for candidate in candidates {
        if let Ok(entries) = connection_import_host::read_directory(&candidate.id) {
            walk_candidate_dir(
                candidate,
                "",
                entries,
                0,
                &mut files,
                &mut seen_paths,
            );
            continue;
        }

        if let Ok(bytes) = connection_import_host::read_file(&candidate.id) {
            let file_name = file_name_of(&candidate.path);
            let input = InputFile {
                candidate_id: candidate.id.clone(),
                display_path: candidate.path.clone(),
                bytes,
            };
            classify_and_push(file_name, input, &mut files, &mut seen_paths);
        }
    }

    files.sort_deterministic();
    files
}

fn walk_candidate_dir(
    candidate: &CandidateFile,
    relative_prefix: &str,
    entries: Vec<onet::extension::connection_import::DirectoryEntry>,
    depth: usize,
    files: &mut DiscoveredFiles,
    seen_paths: &mut BTreeSet<String>,
) {
    if depth > 6 {
        return;
    }

    for entry in entries {
        if !safe_entry_name(&entry.name) {
            continue;
        }
        let relative = if relative_prefix.is_empty() {
            entry.name.clone()
        } else {
            format!("{relative_prefix}/{}", entry.name)
        };

        if entry.is_dir {
            if should_skip_dir(&entry.name, relative_prefix) {
                continue;
            }
            if let Ok(children) =
                connection_import_host::read_candidate_directory(&candidate.id, &relative)
            {
                walk_candidate_dir(candidate, &relative, children, depth + 1, files, seen_paths);
            }
            continue;
        }

        if !is_windterm_target_file(&entry.name) {
            continue;
        }
        if let Ok(bytes) =
            connection_import_host::read_candidate_child_file(&candidate.id, &relative)
        {
            let display_path = format!(
                "{}/{}",
                candidate.path.trim_end_matches(['/', '\\']),
                relative
            );
            let input = InputFile {
                candidate_id: candidate.id.clone(),
                display_path,
                bytes,
            };
            classify_and_push(&entry.name, input, files, seen_paths);
        }
    }
}

fn classify_and_push(
    file_name: &str,
    input: InputFile,
    files: &mut DiscoveredFiles,
    seen_paths: &mut BTreeSet<String>,
) {
    let lower = file_name.to_ascii_lowercase();
    let dedup_key = input.display_path.replace('\\', "/");
    if !seen_paths.insert(dedup_key) {
        return;
    }
    if lower == "user.sessions" || lower.ends_with(".sessions") {
        files.session_files.push(input);
    } else if lower == "quickbar.config" {
        files.quickbar_files.push(input);
    } else if lower == "wind.keymaps" || lower.ends_with(".keymaps") {
        files.keymap_files.push(input);
    }
}

fn is_windterm_target_file(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower == "user.sessions"
        || lower == "quickbar.config"
        || lower == "wind.keymaps"
        || lower.ends_with(".keymaps")
}

fn should_skip_dir(name: &str, relative_prefix: &str) -> bool {
    if matches!(
        name,
        "logs" | "themes" | "locales" | "schemes" | "vendors" | "plugins" | "palettes"
    ) {
        return true;
    }
    if name == ".wind" && relative_prefix.ends_with(".wind") {
        return true;
    }
    false
}

fn file_name_of(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

fn safe_entry_name(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains(['/', '\\'])
}

export!(WindtermImporter);
