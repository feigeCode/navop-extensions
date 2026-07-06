# Navicat Lite And OpenSSH Importers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the resource import extensions discover Navicat Premium Lite connections from `conn.plist`, keep Windows coverage in the manifest, and confirm the existing OpenSSH Config importer covers `~/.ssh/config`.

**Architecture:** Reuse the existing WASM importer crates. Extend `navicat_importer_wasm` instead of creating a second Navicat importer, because Lite stores the same product family under a new plist path and schema. Do not create a duplicate SSH importer: `openssh_config_importer_wasm` already exists and is registered, so the work there is verification and small coverage tightening if needed.

**Tech Stack:** Rust 2024 WASM components, `plist`, `serde`, composite `extension.json` manifests, Node script tests, `wasm32-wasip2` builds.

---

## File Structure

- Modify `extensions/wasm/navicat-importer/src/navicat.rs`: parse both legacy Navicat preference plists and Navicat Lite `conn.plist`.
- Modify `extensions/wasm/navicat-importer/extension.json`: add Lite macOS and likely Windows candidate paths plus matching `fs:read` permissions.
- Modify `tests/scripts.test.mjs`: assert the Navicat manifest declares Lite paths and Windows platform support.
- Verify `extensions/wasm/openssh-config-importer/extension.json`: already declares `~/.ssh/config`, Linux `~/.ssh/config`, and Windows `%USERPROFILE%/.ssh/config`.
- Verify `extensions/wasm/openssh-config-importer/src/openssh_config.rs`: already parses OpenSSH `Host` blocks into SSH records.

## Findings To Preserve

- Local Lite file: `/Users/hufei/Library/Application Support/PremiumSoft CyberTech/Navicat CC/Common/conn.plist`.
- The Lite file is XML plist.
- Lite records use lowercase fields such as `host`, `port`, `username`, `customdblist`, `ssh_param`, and `ssl_param`.
- `serviceprovider` is `Default` in the observed file, so database type must be inferred from a parent path segment such as `MySQL` or `Oracle`.
- Nested `ssh_param` dictionaries can also contain `host`, `port`, and `username`; they must not be imported as separate database records.
- Windows cannot be verified from this macOS machine, but the analogous candidate path should be `%APPDATA%/PremiumSoft CyberTech/Navicat CC/Common/conn.plist`, following the repo's existing `%APPDATA%/...` manifest style.

---

### Task 1: Add A Failing Navicat Lite Parser Test

**Files:**
- Modify: `extensions/wasm/navicat-importer/src/navicat.rs`

- [ ] **Step 1: Write the failing test**

Add this test in the existing `#[cfg(test)] mod tests` block:

```rust
#[test]
fn parses_navicat_lite_conn_plist_and_ignores_nested_ssh_params() {
    let plist = br#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Connections</key>
  <dict>
    <key>MySQL</key>
    <dict>
      <key>prod-lite</key>
      <dict>
        <key>host</key><string>lite-db.example.test</string>
        <key>port</key><string>3307</string>
        <key>username</key><string>lite_user</string>
        <key>defaultdatabase</key><string>orders</string>
        <key>serviceprovider</key><string>Default</string>
        <key>savepassword</key><true/>
        <key>ssh_param</key>
        <dict>
          <key>host</key><string>jump.example.test</string>
          <key>port</key><string>22</string>
          <key>username</key><string>jump_user</string>
          <key>authtype</key><integer>0</integer>
        </dict>
      </dict>
    </dict>
  </dict>
</dict>
</plist>"#;

    let records = preview_records_from_plists(
        vec![("conn.plist".to_string(), plist.as_slice())],
        true,
    );

    assert_eq!(1, records.len());
    let record = &records[0];
    assert_eq!("navicat:conn-prod-lite", record.id);
    assert_eq!("navicat", record.importer_id);
    assert_eq!("Navicat", record.source_label);
    assert_eq!(
        Some("conn.plist:Connections/MySQL/prod-lite"),
        record.source_id.as_deref()
    );
    assert_eq!("database", record.kind);
    assert_eq!("prod-lite", record.display_name);
    assert_eq!("unsupported", record.password_status);

    let database = record.database.as_ref().unwrap();
    assert_eq!("my_sql", database.database_type);
    assert_eq!("lite-db.example.test", database.host);
    assert_eq!(Some(3307), database.port);
    assert_eq!("lite_user", database.username);
    assert_eq!(Some("orders"), database.database.as_deref());
    assert!(database.password.is_none());
}
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
rtk cargo test -p navicat_importer_wasm parses_navicat_lite_conn_plist_and_ignores_nested_ssh_params
```

Expected: FAIL because the current parser does not infer database type from the Lite parent path and does not read lowercase field names.

---

### Task 2: Extend Navicat Parser For Lite Schema

**Files:**
- Modify: `extensions/wasm/navicat-importer/src/navicat.rs`

- [ ] **Step 1: Replace the plist reader and field helpers**

Update the parser to auto-read XML/binary plists, do case-insensitive key lookup, infer database type from path segments, and skip nested parameter dictionaries:

```rust
pub fn preview_records_from_plists<'a, I>(plists: I, _include_passwords: bool) -> Vec<ImportRecord>
where
    I: IntoIterator<Item = (String, &'a [u8])>,
{
    let mut records = Vec::new();
    for (path, bytes) in plists {
        let Ok(value) = Value::from_reader(bytes) else {
            continue;
        };
        collect_records(&path, "", &value, &mut records);
    }
    records
}

fn record_from_dict(path: &str, key_path: &str, dict: &Dictionary) -> Option<ImportRecord> {
    if is_parameter_dict(key_path) {
        return None;
    }

    let raw_type = text_field(
        dict,
        &[
            "ConnType",
            "Type",
            "DatabaseType",
            "DBType",
            "Driver",
            "serviceprovider",
        ],
    )
    .filter(|value| !value.eq_ignore_ascii_case("default"))
    .or_else(|| database_type_from_key_path(key_path))?;

    let database_type = database_type(&raw_type)?;
    let host = text_field(
        dict,
        &["Host", "Hostname", "Server", "IP", "SocketHost", "host"],
    )
    .or_else(|| text_field(dict, &["DatabaseFile", "FilePath", "dbfilename", "savepath"]))
    .unwrap_or_default();
    if host.is_empty() && database_type != "sqlite" {
        return None;
    }

    let source_id = if key_path.is_empty() {
        path.to_string()
    } else {
        format!("{path}:{key_path}")
    };
    let fallback_name = key_path
        .rsplit('/')
        .next()
        .filter(|value| !value.is_empty())
        .unwrap_or(path);
    let id_seed = if key_path.is_empty() {
        path.to_string()
    } else {
        format!("{path}:{fallback_name}")
    };
    let name = text_field(
        dict,
        &[
            "Name",
            "Title",
            "ConnectionName",
            "DisplayName",
            "name",
            "title",
            "connectionname",
            "displayname",
        ],
    )
    .unwrap_or_else(|| fallback_name.to_string());

    Some(ImportRecord {
        id: format!("navicat:{}", slug(&id_seed)),
        importer_id: "navicat".to_string(),
        source_label: "Navicat".to_string(),
        source_id: Some(source_id),
        kind: "database".to_string(),
        display_name: name.clone(),
        database: Some(DatabaseImportRecord {
            database_type,
            name,
            host,
            port: port_field(dict, &["Port", "port"]),
            username: text_field(dict, &["UserName", "Username", "User", "UID", "username"])
                .unwrap_or_default(),
            password: None,
            database: text_field(
                dict,
                &[
                    "Database",
                    "DatabaseName",
                    "InitialDatabase",
                    "Schema",
                    "defaultdatabase",
                ],
            ),
            extra_params: BTreeMap::new(),
        }),
        ssh: None,
        port_forwarding: None,
        password_status: "unsupported".to_string(),
        warnings: Vec::new(),
    })
}

fn text_field(dict: &Dictionary, keys: &[&str]) -> Option<String> {
    dict_value(dict, keys)
        .and_then(value_text)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn dict_value<'a>(dict: &'a Dictionary, keys: &[&str]) -> Option<&'a Value> {
    for key in keys {
        if let Some(value) = dict.get(*key) {
            return Some(value);
        }
        if let Some((_, value)) = dict
            .iter()
            .find(|(existing, _)| existing.eq_ignore_ascii_case(key))
        {
            return Some(value);
        }
    }
    None
}

fn port_field(dict: &Dictionary, keys: &[&str]) -> Option<u16> {
    keys.iter().find_map(|key| match dict_value(dict, &[*key]) {
        Some(Value::Integer(_)) => dict_value(dict, &[*key])
            .and_then(Value::as_unsigned_integer)
            .and_then(|port| u16::try_from(port).ok()),
        Some(Value::String(text)) => text.trim().parse::<u16>().ok(),
        _ => None,
    })
}

fn database_type_from_key_path(key_path: &str) -> Option<String> {
    key_path
        .split('/')
        .rev()
        .find(|segment| database_type(segment).is_some())
        .map(ToOwned::to_owned)
}

fn is_parameter_dict(key_path: &str) -> bool {
    key_path.split('/').any(|segment| {
        matches!(
            segment.to_ascii_lowercase().as_str(),
            "ssh_param" | "http_param" | "ssl_param" | "compatibility_param"
        )
    })
}
```

Keep the existing `collect_records`, `value_text`, `database_type`, and `slug` functions unless the compiler points out duplicate definitions from the replacement.

- [ ] **Step 2: Align database type aliases with other importers**

Update `database_type` to include the broader aliases already used by DBeaver and JetBrains importers:

```rust
fn database_type(raw: &str) -> Option<String> {
    let normalized = raw
        .trim()
        .to_ascii_lowercase()
        .replace([' ', '-', '.'], "_");
    match normalized.as_str() {
        "mysql" | "mariadb" | "mysql8" | "mysql5" => Some("my_sql".to_string()),
        "postgres" | "postgresql" | "pgsql" | "postgres_jdbc" => {
            Some("postgre_sql".to_string())
        }
        "sqlite" | "sqlite3" => Some("sqlite".to_string()),
        "oracle" | "oci" | "oracle_thin" => Some("oracle".to_string()),
        "sqlserver" | "sql_server" | "mssql" | "microsoft_sql_server" => {
            Some("sql_server".to_string())
        }
        _ => None,
    }
}
```

- [ ] **Step 3: Run parser tests**

Run:

```bash
rtk cargo test -p navicat_importer_wasm
```

Expected: PASS for both the existing legacy plist test and the new Lite `conn.plist` test.

---

### Task 3: Add Navicat Lite Manifest Coverage

**Files:**
- Modify: `tests/scripts.test.mjs`
- Modify: `extensions/wasm/navicat-importer/extension.json`

- [ ] **Step 1: Write the failing manifest assertions**

Extend the existing `"Navicat importer is registered as a composite WASM importer"` test:

```javascript
  const candidatePaths = importer.candidateFiles.map((candidate) => candidate.path);

  assert.ok(
    candidatePaths.includes("~/Library/Application Support/PremiumSoft CyberTech/Navicat CC/Common/conn.plist"),
    "Navicat importer should declare macOS Navicat Premium Lite conn.plist candidate",
  );
  assert.ok(
    candidatePaths.includes("%APPDATA%/PremiumSoft CyberTech/Navicat CC/Common/conn.plist"),
    "Navicat importer should declare Windows Navicat Premium Lite conn.plist candidate",
  );
  assert.ok(importer.platforms.includes("windows"), "Navicat Lite candidate should enable Windows scanning");
  assert.ok(
    sourceManifest.permissions.includes(
      "fs:read:~/Library/Application Support/PremiumSoft CyberTech/Navicat CC/Common/conn.plist",
    ),
    "Navicat importer should permit macOS Lite conn.plist reads",
  );
  assert.ok(
    sourceManifest.permissions.includes(
      "fs:read:%APPDATA%/PremiumSoft CyberTech/Navicat CC/Common/conn.plist",
    ),
    "Navicat importer should permit Windows Lite conn.plist reads",
  );
```

- [ ] **Step 2: Run the script test and verify it fails**

Run:

```bash
rtk node --test tests/scripts.test.mjs
```

Expected: FAIL because the Lite candidate paths and Windows platform are not declared yet.

- [ ] **Step 3: Update `extension.json`**

Add these permissions:

```json
"fs:read:~/Library/Application Support/PremiumSoft CyberTech/Navicat CC/Common/conn.plist",
"fs:read:%APPDATA%/PremiumSoft CyberTech/Navicat CC/Common/conn.plist"
```

Add `"windows"` to `contributes.connectionImporters[0].platforms`.

Add these candidate files:

```json
{
  "id": "navicat-macos-lite-cc-conn",
  "platform": "macos",
  "path": "~/Library/Application Support/PremiumSoft CyberTech/Navicat CC/Common/conn.plist"
},
{
  "id": "navicat-windows-lite-cc-conn",
  "platform": "windows",
  "path": "%APPDATA%/PremiumSoft CyberTech/Navicat CC/Common/conn.plist"
}
```

- [ ] **Step 4: Run the script test again**

Run:

```bash
rtk node --test tests/scripts.test.mjs
```

Expected: PASS.

---

### Task 4: Verify Existing OpenSSH Config Importer

**Files:**
- Read: `extensions/wasm/openssh-config-importer/extension.json`
- Read: `extensions/wasm/openssh-config-importer/src/openssh_config.rs`
- Read: `manifest.json`
- Read: `tests/scripts.test.mjs`

- [ ] **Step 1: Confirm there is no need for a duplicate plugin**

Verify these facts:

```text
extensions/wasm/openssh-config-importer/extension.json declares:
- id: openssh-config
- outputKinds: ["ssh"]
- platforms: ["macos", "windows", "linux"]
- candidateFiles:
  - ~/.ssh/config for macOS
  - ~/.ssh/config for Linux
  - %USERPROFILE%/.ssh/config for Windows

manifest.json registers:
- id: openssh-config-importer
- kind: composite
- manifest: openssh-config-importer/manifest.json
```

- [ ] **Step 2: Run OpenSSH importer tests**

Run:

```bash
rtk cargo test -p openssh_config_importer_wasm
```

Expected: PASS. The existing unit test should parse a concrete `Host prod-api` block, ignore wildcard `Host *`, preserve `HostName`, `User`, `Port`, and `IdentityFile`, and emit one SSH import record.

- [ ] **Step 3: Run registration test**

Run:

```bash
rtk node --test tests/scripts.test.mjs
```

Expected: PASS. The existing script test should confirm the OpenSSH importer is registered and declares `.ssh/config` candidates.

- [ ] **Step 4: Stop if a separately named SSH plugin is still requested**

If product requirements still demand a second, differently named plugin for `~/.ssh/config`, pause and ask for confirmation. A duplicate importer would scan the same file and produce overlapping SSH records.

---

### Task 5: Final Verification And Packaging Checks

**Files:**
- No new files.

- [ ] **Step 1: Format check**

Run:

```bash
rtk cargo fmt --all --check
```

Expected: PASS.

- [ ] **Step 2: Rust tests**

Run:

```bash
rtk cargo test -p navicat_importer_wasm
rtk cargo test -p openssh_config_importer_wasm
```

Expected: PASS.

- [ ] **Step 3: Manifest/script tests**

Run:

```bash
rtk node --test tests/scripts.test.mjs
```

Expected: PASS.

- [ ] **Step 4: WASM builds**

Run:

```bash
rtk cargo build --release -p navicat_importer_wasm --target wasm32-wasip2
rtk cargo build --release -p openssh_config_importer_wasm --target wasm32-wasip2
```

Expected: PASS. If `wasm32-wasip2` is missing, run `rtk rustup target add wasm32-wasip2` and retry.

- [ ] **Step 5: Commit**

Run:

```bash
rtk git add extensions/wasm/navicat-importer/src/navicat.rs extensions/wasm/navicat-importer/extension.json tests/scripts.test.mjs docs/superpowers/plans/2026-07-05-navicat-lite-and-openssh-importers.md
rtk git commit -m "feat: support Navicat Lite connection import"
```

Expected: commit succeeds. Do not include unrelated files.

---

## Self-Review

- Spec coverage: Navicat Lite macOS path, likely Windows path, parser schema change, nested `ssh_param` guard, and OpenSSH Config verification are all covered.
- Marker scan: no forbidden markers or unspecified test steps remain.
- Type consistency: Rust snippets use existing `ImportRecord`, `DatabaseImportRecord`, `Dictionary`, `Value`, `BTreeMap`, and helper naming in `navicat.rs`.
