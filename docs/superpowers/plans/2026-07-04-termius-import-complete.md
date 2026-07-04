# Termius Complete Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete Termius connection importer that reads Termius IndexedDB/LevelDB data, decrypts supported local encrypted fields, imports SSH hosts and linked port-forwarding records, and keeps host changes in the existing `connection-import-center` worktree.

**Architecture:** Product-specific parsing lives in a new `termius-importer` WASM component in `onetcli-extensions`. Host changes stay generic in `/Users/hufei/RustroverProjects/onetcli/.worktrees/connection-import-center`: protocol extensions, candidate directory child-file reads, macOS secret reads, batch save of linked SSH plus port-forwarding records, private key persistence, and remote forwarding runtime support. Ordinary Termius snippets are recognized and skipped with diagnostics; they are not imported into Quick Commands.

**Tech Stack:** Rust 2024, `wit-bindgen`, Wasmtime component model, `connection-import-protocol`, `rusty-leveldb` with `MemEnv`, `crypto_secretbox::XSalsa20Poly1305`, GPUI, OnetCli core storage, `russh` remote forwarding APIs.

---

## Scope Check

This plan intentionally spans extension and host work because Termius complete adaptation requires a new importer and generic host capabilities that do not exist today. Keep commits split by repository and by task. Do host edits only in:

`/Users/hufei/RustroverProjects/onetcli/.worktrees/connection-import-center`

Do extension edits in:

`/Users/hufei/RustroverProjects/onetcli-extensions`

Do not read Termius session logs. Do not print or commit real local Termius hostnames, usernames, passwords, private keys, snippets, or raw IndexedDB payloads.

## File Structure

Extension repo:

- Modify `wit/connection-import.wit`: add `port-forwarding` records, SSH init/proxy/jump/private-key-material fields, child-file read API, and secret query namespace.
- Create `extensions/wasm/termius-importer/Cargo.toml`: WASM component crate with pure Rust dependencies.
- Create `extensions/wasm/termius-importer/extension.json`: composite manifest with Termius IndexedDB directory candidates and secret permission.
- Create `extensions/wasm/termius-importer/extension.build.json`: release-driver metadata for universal rust-wasm packaging.
- Create `extensions/wasm/termius-importer/src/lib.rs`: module exports.
- Create `extensions/wasm/termius-importer/src/component.rs`: WIT exports and host capability calls.
- Create `extensions/wasm/termius-importer/src/model.rs`: protocol output records plus Termius normalized entities.
- Create `extensions/wasm/termius-importer/src/crypto.rs`: Termius local `0x04 0x01 + nonce + secretbox` decryptor.
- Create `extensions/wasm/termius-importer/src/leveldb.rs`: host child-file loading into `rusty-leveldb::MemEnv`.
- Create `extensions/wasm/termius-importer/src/idb_codec.rs`: narrow Chromium IndexedDB key/value decoding.
- Create `extensions/wasm/termius-importer/src/termius.rs`: store loading and entity joining.
- Create `extensions/wasm/termius-importer/src/mapper.rs`: Termius entity to import-record mapping.
- Create `extensions/wasm/termius-importer/src/diagnostics.rs`: warning helpers with secret redaction.
- Modify `Cargo.toml`: add `extensions/wasm/termius-importer` workspace member and shared dependencies if useful.
- Modify `manifest.json`: add `termius-importer` composite marketplace entry.
- Modify `tests/scripts.test.mjs`: assert Termius WASM uses shared WIT and composite metadata is valid.

Host worktree:

- Modify `crates/extension-api/wit/connection-import.wit`: mirror extension WIT exactly.
- Modify `crates/connection-import-protocol/src/model.rs`: add new record structs/enums and validation.
- Modify `crates/extension-component/src/connection_import.rs`: extend host trait with child-file read and permission checks.
- Modify `crates/extension-component/src/permissions.rs`: parse `secrets:read:<namespace.key>` and expose `allows_secret_read`.
- Modify `crates/extension-runtime/src/connection_import_provider.rs`: implement child-file read, macOS Keychain secret backend, output kind parsing, and descriptor capability plumbing.
- Modify `crates/extension-wasm/src/connection_import.rs`: bind new WIT methods and enum/record conversions.
- Modify `main/src/home/connection_import_draft.rs`: support port-forwarding drafts and new SSH fields.
- Modify `main/src/home/connection_import_actions.rs`: save selected imports as a batch, persist imported key material, and save linked forwarding records after SSH records.
- Modify `main/src/home/connection_import_model.rs` and `main/src/home/connection_import_window.rs`: handle `PortForwarding` rows and batch save status.
- Modify `crates/core/src/storage/models.rs`: add `PortForwardingKind::Remote`.
- Modify `crates/port_forwarding/src/runtime.rs` and `crates/port_forwarding/src/lib.rs`: build/start remote forwarding requests.
- Modify `crates/ssh/src/ssh.rs` and `crates/ssh/src/lib.rs`: add remote forwarding tunnel wrapper using `russh::client::Handle::tcpip_forward`.
- Modify `crates/port_forwarding_view/src/selects.rs` and `crates/port_forwarding_view/src/form_window.rs`: expose `Remote` kind.
- Modify `crates/onetcli_runtime/src/connections/schema.rs` and `crates/onetcli_runtime/src/connections/extended_build.rs`: accept `Remote` forwarding kind.

---

## Task 1: Host Protocol Model Extensions

**Workdir:** `/Users/hufei/RustroverProjects/onetcli/.worktrees/connection-import-center`

**Files:**
- Modify: `crates/connection-import-protocol/src/model.rs`
- Test: `crates/connection-import-protocol/src/model.rs`

- [ ] **Step 1: Add failing protocol shape tests**

Append tests in `crates/connection-import-protocol/src/model.rs` under a new `#[cfg(test)] mod tests`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn base_record(kind: ImportRecordKind) -> ImportRecord {
        ImportRecord {
            id: "termius:record".to_string(),
            importer_id: "termius".to_string(),
            source_label: "Termius".to_string(),
            source_id: Some("host-local-1".to_string()),
            kind,
            display_name: "record".to_string(),
            database: None,
            ssh: None,
            port_forwarding: None,
            password_status: PasswordImportStatus::Unsupported,
            warnings: Vec::new(),
        }
    }

    #[test]
    fn validates_port_forwarding_payload_shape() {
        let mut record = base_record(ImportRecordKind::PortForwarding);
        record.port_forwarding = Some(PortForwardingImportRecord {
            name: "db tunnel".to_string(),
            ssh_source_id: "termius:host:1".to_string(),
            kind: PortForwardingImportKind::Local,
            bind_host: "127.0.0.1".to_string(),
            bind_port: 15432,
            target_host: "db.internal".to_string(),
            target_port: 5432,
        });

        assert_eq!(Ok(()), record.validate_shape());
    }

    #[test]
    fn rejects_port_forwarding_without_port_forwarding_payload() {
        let record = base_record(ImportRecordKind::PortForwarding);

        assert!(matches!(
            record.validate_shape(),
            Err(ImportProtocolError::MismatchedRecordPayload { .. })
        ));
    }

    #[test]
    fn ssh_record_round_trips_init_script_proxy_jump_and_key_material() {
        let record = SshImportRecord {
            name: "prod".to_string(),
            host: "prod.example.test".to_string(),
            port: Some(22),
            username: "deploy".to_string(),
            auth_method: SshImportAuthMethod::PrivateKeyMaterial {
                private_key: Some("-----BEGIN OPENSSH PRIVATE KEY-----\nfixture\n".to_string()),
                passphrase: Some("secret".to_string()),
                file_name_hint: Some("key-local-1".to_string()),
            },
            init_script: Some("echo ready".to_string()),
            jump_server: Some(SshJumpServerImportRecord {
                host: "jump.example.test".to_string(),
                port: 22,
                username: "jump".to_string(),
                auth_method: SshImportAuthMethod::Agent,
            }),
            proxy: Some(SshProxyImportRecord {
                kind: SshProxyImportKind::Socks5,
                host: "proxy.example.test".to_string(),
                port: 1080,
                username: Some("proxy-user".to_string()),
                password: None,
            }),
        };

        let json = serde_json::to_string(&record).unwrap();
        let decoded: SshImportRecord = serde_json::from_str(&json).unwrap();

        assert_eq!(record, decoded);
    }

    #[test]
    fn secret_query_round_trips_permission_scope() {
        let query = SecretQuery {
            service: "Termius".to_string(),
            account: "localKey".to_string(),
            namespace: Some("termius".to_string()),
            key: Some("localkey".to_string()),
        };

        let json = serde_json::to_string(&query).unwrap();
        let decoded: SecretQuery = serde_json::from_str(&json).unwrap();

        assert_eq!(query, decoded);
    }
}
```

- [ ] **Step 2: Run the failing protocol tests**

Run:

```bash
rtk cargo test -p connection-import-protocol port_forwarding_payload_shape ssh_record_round_trips
```

Expected: FAIL because `PortForwardingImportRecord`, `source_id`, `port_forwarding`, proxy, jump, private-key-material, and `SecretQuery.namespace/key` types do not exist.

- [ ] **Step 3: Extend protocol model types**

Modify `crates/connection-import-protocol/src/model.rs`:

```rust
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ImportRecordKind {
    Database,
    Ssh,
    PortForwarding,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ImportRecord {
    pub id: String,
    pub importer_id: String,
    pub source_label: String,
    #[serde(default)]
    pub source_id: Option<String>,
    pub kind: ImportRecordKind,
    pub display_name: String,
    pub database: Option<DatabaseImportRecord>,
    pub ssh: Option<SshImportRecord>,
    #[serde(default)]
    pub port_forwarding: Option<PortForwardingImportRecord>,
    pub password_status: PasswordImportStatus,
    pub warnings: Vec<ImportWarning>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SshImportRecord {
    pub name: String,
    pub host: String,
    pub port: Option<u16>,
    pub username: String,
    pub auth_method: SshImportAuthMethod,
    #[serde(default)]
    pub init_script: Option<String>,
    #[serde(default)]
    pub jump_server: Option<SshJumpServerImportRecord>,
    #[serde(default)]
    pub proxy: Option<SshProxyImportRecord>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SshJumpServerImportRecord {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_method: SshImportAuthMethod,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SshProxyImportRecord {
    pub kind: SshProxyImportKind,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SshProxyImportKind {
    Socks5,
    Http,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SshImportAuthMethod {
    Password { password: Option<String> },
    PrivateKey { key_path: String, passphrase: Option<String> },
    PrivateKeyMaterial {
        private_key: Option<String>,
        passphrase: Option<String>,
        file_name_hint: Option<String>,
    },
    Agent,
    AutoPublicKey,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PortForwardingImportRecord {
    pub name: String,
    pub ssh_source_id: String,
    pub kind: PortForwardingImportKind,
    pub bind_host: String,
    pub bind_port: u16,
    pub target_host: String,
    pub target_port: u16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PortForwardingImportKind {
    Local,
    Dynamic,
    Remote,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SecretQuery {
    pub service: String,
    pub account: String,
    #[serde(default)]
    pub namespace: Option<String>,
    #[serde(default)]
    pub key: Option<String>,
}
```

Update `validate_shape`:

```rust
let matches_payload = matches!(
    (
        self.kind,
        self.database.is_some(),
        self.ssh.is_some(),
        self.port_forwarding.is_some()
    ),
    (ImportRecordKind::Database, true, false, false)
        | (ImportRecordKind::Ssh, false, true, false)
        | (ImportRecordKind::PortForwarding, false, false, true)
);
```

- [ ] **Step 4: Run protocol tests**

Run:

```bash
rtk cargo test -p connection-import-protocol
```

Expected: PASS.

- [ ] **Step 5: Commit host protocol model**

Run:

```bash
rtk git add crates/connection-import-protocol/src/model.rs
rtk git commit -m "feat: extend connection import protocol for Termius"
```

Expected: commit succeeds in the host worktree.

---

## Task 2: WIT and WASM Runtime Host API

**Workdir:** `/Users/hufei/RustroverProjects/onetcli/.worktrees/connection-import-center`

**Files:**
- Modify: `crates/extension-api/wit/connection-import.wit`
- Modify: `crates/extension-wasm/src/connection_import.rs`
- Modify: `/Users/hufei/RustroverProjects/onetcli-extensions/wit/connection-import.wit`
- Test: `crates/extension-wasm/src/connection_import.rs`
- Test: `/Users/hufei/RustroverProjects/onetcli-extensions/tests/scripts.test.mjs`

- [ ] **Step 1: Update host WIT**

In `crates/extension-api/wit/connection-import.wit`, make these protocol additions:

```wit
enum import-record-kind {
    database,
    ssh,
    port-forwarding,
}

enum port-forwarding-kind {
    local,
    dynamic,
    remote,
}

record port-forwarding-import-record {
    name: string,
    ssh-source-id: string,
    kind: port-forwarding-kind,
    bind-host: string,
    bind-port: u16,
    target-host: string,
    target-port: u16,
}

enum ssh-proxy-kind {
    socks5,
    http,
}

record ssh-proxy-import-record {
    kind: ssh-proxy-kind,
    host: string,
    port: u16,
    username: option<string>,
    password: option<string>,
}

record ssh-jump-server-import-record {
    host: string,
    port: u16,
    username: string,
    auth-method: ssh-import-auth-method,
}

record ssh-import-record {
    name: string,
    host: string,
    port: option<u16>,
    username: string,
    auth-method: ssh-import-auth-method,
    init-script: option<string>,
    jump-server: option<ssh-jump-server-import-record>,
    proxy: option<ssh-proxy-import-record>,
}

record import-record {
    id: string,
    importer-id: string,
    source-label: string,
    source-id: option<string>,
    kind: import-record-kind,
    display-name: string,
    database: option<database-import-record>,
    ssh: option<ssh-import-record>,
    port-forwarding: option<port-forwarding-import-record>,
    password-status: password-import-status,
    warnings: list<import-warning>,
}

record directory-entry {
    candidate-id: string,
    name: string,
    is-dir: bool,
}

record secret-query {
    service: string,
    account: string,
    namespace: option<string>,
    key: option<string>,
}
```

Add a host function:

```wit
read-candidate-child-file: func(candidate-id: string, relative-path: string) -> result<list<u8>, host-error>;
```

For `ssh-import-auth-method`, keep existing fields and add:

```wit
private-key: option<string>,
file-name-hint: option<string>,
```

- [ ] **Step 2: Copy WIT to extension repo**

Copy the host WIT content exactly into:

`/Users/hufei/RustroverProjects/onetcli-extensions/wit/connection-import.wit`

Use `apply_patch`; do not use shell redirection.

- [ ] **Step 3: Update WASM runtime conversions**

Modify `crates/extension-wasm/src/connection_import.rs`:

```rust
async fn read_candidate_child_file(
    &mut self,
    candidate_id: String,
    relative_path: String,
) -> wasmtime::Result<Result<Vec<u8>, Wit::HostError>> {
    if let Err(error) = self.candidate_access().candidate(&candidate_id) {
        return Ok(Err(wit_host_error(error)));
    }
    Ok(self
        .host
        .read_candidate_child_file(&candidate_id, &relative_path)
        .map_err(wit_host_error))
}
```

Update `read_secret` conversion:

```rust
connection_import_protocol::SecretQuery {
    service: query.service,
    account: query.account,
    namespace: query.namespace,
    key: query.key,
}
```

Update WIT enum conversion for `ImportRecordKind::PortForwarding` anywhere conversion helpers exist.

- [ ] **Step 4: Run WIT drift and WASM compile tests**

Run:

```bash
rtk cargo test -p extension-wasm connection_import
rtk node --test /Users/hufei/RustroverProjects/onetcli-extensions/tests/scripts.test.mjs
```

Expected: host WASM tests pass and extension WIT drift test passes.

- [ ] **Step 5: Commit WIT/runtime changes in both repos**

Host worktree:

```bash
rtk git add crates/extension-api/wit/connection-import.wit crates/extension-wasm/src/connection_import.rs
rtk git commit -m "feat: extend connection import WIT host API"
```

Extension repo:

```bash
rtk git add wit/connection-import.wit
rtk git commit -m "feat: sync connection import WIT for Termius"
```

Expected: two separate commits, one per repo.

---

## Task 3: Host Candidate Child Reads and Secret Permissions

**Workdir:** `/Users/hufei/RustroverProjects/onetcli/.worktrees/connection-import-center`

**Files:**
- Modify: `crates/extension-component/src/connection_import.rs`
- Modify: `crates/extension-component/src/permissions.rs`
- Modify: `crates/extension-runtime/src/connection_import_provider.rs`
- Modify: `crates/extension-runtime/src/extension/manifest/security_rules.rs`
- Test: `crates/extension-component/src/connection_import.rs`
- Test: `crates/extension-component/src/permissions.rs`
- Test: `crates/extension-runtime/src/connection_import_provider.rs`
- Test: `crates/extension-runtime/src/extension/manifest/security_rules.rs`

- [ ] **Step 1: Add failing child-read and secret permission tests**

In `crates/extension-component/src/connection_import.rs`, add:

```rust
#[test]
fn candidate_child_read_rejects_parent_escape() {
    let access = CandidateFileAccess::new(
        vec![CandidateFile {
            id: "termius-db".to_string(),
            platform: None,
            path: "~/Library/Application Support/Termius/IndexedDB/file__0.indexeddb.leveldb".to_string(),
        }],
        PermissionSet::new([
            "fs:read:~/Library/Application Support/Termius/IndexedDB/file__0.indexeddb.leveldb",
        ]),
    );

    let error = access
        .validate_child("termius-db", "../Login Data")
        .unwrap_err();

    assert!(matches!(error, HostAccessError::PermissionDenied(_)));
}
```

In `crates/extension-component/src/permissions.rs`, add:

```rust
#[test]
fn secret_read_permission_matches_namespace_and_key() {
    let permissions = PermissionSet::new(["secrets:read:termius.localkey"]);

    assert!(permissions.allows_secret_read("termius", "localkey"));
    assert!(!permissions.allows_secret_read("termius", "other"));
}
```

In `crates/extension-runtime/src/extension/manifest/security_rules.rs`, add:

```rust
#[test]
fn secret_permission_allows_termius_localkey_scope() {
    let permission = validate_permission("secrets:read:termius.localkey").unwrap();

    assert_eq!(permission.raw, "secrets:read:termius.localkey");
}
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
rtk cargo test -p extension-component candidate_child_read_rejects_parent_escape secret_read_permission_matches_namespace_and_key
rtk cargo test -p extension-runtime secret_permission_allows_termius_localkey_scope
```

Expected: FAIL because `validate_child` and `allows_secret_read` do not exist.

- [ ] **Step 3: Extend permissions and candidate access**

In `crates/extension-component/src/permissions.rs`, add:

```rust
secret_read: BTreeSet<(String, String)>,
```

Parse:

```rust
} else if let Some(scope) = permission.strip_prefix("secrets:read:") {
    if let Some((namespace, key)) = scope.split_once('.') {
        self.secret_read
            .insert((namespace.to_string(), key.to_string()));
    }
}
```

Expose:

```rust
pub fn allows_secret_read(&self, namespace: &str, key: &str) -> bool {
    self.secret_read
        .contains(&(namespace.to_string(), key.to_string()))
        || self.secret_read.contains(&(namespace.to_string(), "*".to_string()))
}
```

In `crates/extension-component/src/connection_import.rs`, extend the trait:

```rust
fn read_candidate_child_file(
    &self,
    candidate_id: &str,
    relative_path: &str,
) -> Result<Vec<u8>, HostAccessError>;
```

Add candidate path validation:

```rust
pub fn validate_child(
    &self,
    candidate_id: &str,
    relative_path: &str,
) -> Result<(CandidateFile, std::path::PathBuf), HostAccessError> {
    let candidate = self.candidate(candidate_id)?.clone();
    let child = std::path::Path::new(relative_path);
    if child.is_absolute()
        || child.components().any(|component| {
            matches!(
                component,
                std::path::Component::ParentDir | std::path::Component::RootDir | std::path::Component::Prefix(_)
            )
        })
    {
        return Err(HostAccessError::PermissionDenied(relative_path.to_string()));
    }
    Ok((candidate, child.to_path_buf()))
}
```

- [ ] **Step 4: Implement provider child reads and Keychain secret read**

In `crates/extension-runtime/src/connection_import_provider.rs`, implement:

```rust
fn read_candidate_child_file(
    &self,
    candidate_id: &str,
    relative_path: &str,
) -> Result<Vec<u8>, HostAccessError> {
    let (candidate, child) = self.candidate_access().validate_child(candidate_id, relative_path)?;
    let root = expand_connection_import_path(&candidate.path);
    let path = root.join(child);
    std::fs::read(&path).map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            HostAccessError::NotFound(path.display().to_string())
        } else {
            HostAccessError::Io(error.to_string())
        }
    })
}
```

Implement secret permission scope:

```rust
fn secret_scope(query: &SecretQuery) -> (String, String) {
    let namespace = query
        .namespace
        .clone()
        .unwrap_or_else(|| query.service.to_ascii_lowercase().replace(' ', "-"));
    let key = query
        .key
        .clone()
        .unwrap_or_else(|| query.account.to_ascii_lowercase().replace(' ', ""));
    (namespace, key)
}
```

In `read_secret`, check:

```rust
let (namespace, key) = secret_scope(&query);
if !self.permissions.allows_secret_read(&namespace, &key) {
    return SecretResult::PermissionDenied;
}
read_platform_secret(&query)
```

For macOS only:

```rust
#[cfg(target_os = "macos")]
fn read_platform_secret(query: &SecretQuery) -> SecretResult {
    use security_framework::os::macos::keychain::SecKeychain;
    use security_framework::passwords::get_generic_password;

    match get_generic_password(None::<&SecKeychain>, &query.service, &query.account) {
        Ok(bytes) => String::from_utf8(bytes)
            .map(|value| SecretResult::Included { value })
            .unwrap_or(SecretResult::Unsupported),
        Err(_) => SecretResult::Missing,
    }
}

#[cfg(not(target_os = "macos"))]
fn read_platform_secret(_query: &SecretQuery) -> SecretResult {
    SecretResult::Unsupported
}
```

Add `security-framework` as a target-specific dependency if the crate is not already available.

- [ ] **Step 5: Run host capability tests**

Run:

```bash
rtk cargo test -p extension-component connection_import permissions
rtk cargo test -p extension-runtime connection_import_provider
```

Expected: PASS.

- [ ] **Step 6: Commit host capability changes**

Run:

```bash
rtk git add crates/extension-component/src/connection_import.rs crates/extension-component/src/permissions.rs crates/extension-runtime/src/connection_import_provider.rs crates/extension-runtime/src/extension/manifest/security_rules.rs Cargo.toml Cargo.lock
rtk git commit -m "feat: add connection import directory and secret host access"
```

Expected: commit succeeds in the host worktree.

---

## Task 4: Host Drafts, Batch Save, and Private Key Persistence

**Workdir:** `/Users/hufei/RustroverProjects/onetcli/.worktrees/connection-import-center`

**Files:**
- Modify: `main/src/home/connection_import_draft.rs`
- Modify: `main/src/home/connection_import_actions.rs`
- Modify: `main/src/home/connection_import_model.rs`
- Modify: `main/src/home/connection_import_window.rs`
- Test: `main/src/home/connection_import_draft_tests.rs`
- Test: `main/src/home/connection_import_model_tests.rs`

- [ ] **Step 1: Add failing SSH extended-field draft test**

In `main/src/home/connection_import_draft_tests.rs`, add:

```rust
#[test]
fn ssh_import_preserves_init_script_proxy_and_jump_server() {
    let draft = EditableImportDraft::new(ssh_record_with_init_proxy_jump());

    let connection = draft.to_stored_connection().unwrap();
    let params = connection.to_ssh_params().unwrap();

    assert_eq!(Some("echo ready"), params.init_script.as_deref());
    assert_eq!("jump.example.test", params.jump_server.unwrap().host);
    assert_eq!("proxy.example.test", params.proxy.unwrap().host);
}
```

Add a helper record using `SshImportRecord { init_script: Some(...), proxy: Some(...), jump_server: Some(...) }`.

- [ ] **Step 2: Add failing port-forwarding draft and batch save tests**

In `main/src/home/connection_import_draft_tests.rs`, add:

```rust
#[test]
fn port_forwarding_import_draft_converts_after_ssh_source_is_resolved() {
    let draft = EditableImportDraft::new(port_forwarding_record(
        "termius:pf:1",
        "termius:host:1",
        connection_import_protocol::PortForwardingImportKind::Remote,
    ));

    let connection = draft
        .to_port_forwarding_connection(42)
        .expect("forwarding draft should convert with resolved ssh id");
    let params = connection.to_port_forwarding_params().unwrap();

    assert_eq!(42, params.ssh_connection_id);
    assert_eq!(one_core::storage::PortForwardingKind::Remote, params.kind);
    assert_eq!("127.0.0.1", params.bind_host);
    assert_eq!(8022, params.bind_port);
    assert_eq!("local.internal", params.target_host);
    assert_eq!(22, params.target_port);
}
```

In `main/src/home/connection_import_model_tests.rs`, add:

```rust
#[test]
fn batch_save_keeps_selected_ssh_before_dependent_forwarding() {
    let mut state = ImportCenterState::empty_for_tests();
    state.apply_preview_records(vec![
        ssh_record("termius:host:1"),
        port_forwarding_record("termius:pf:1", "termius:host:1"),
    ]);

    assert_eq!(
        vec!["termius:host:1".to_string(), "termius:pf:1".to_string()],
        state.batch_save_row_ids()
    );
}
```

- [ ] **Step 3: Run draft/model tests and verify RED**

Run:

```bash
rtk cargo test -p main connection_import_draft connection_import_model
```

Expected: FAIL because port-forwarding draft conversion, `Remote`, and extended SSH fields are not implemented.

- [ ] **Step 4: Implement extended SSH conversion**

In `main/src/home/connection_import_draft.rs`, map:

```rust
init_script: imported.init_script.clone(),
jump_server: imported.jump_server.as_ref().map(import_jump_server),
proxy: imported.proxy.as_ref().map(import_proxy),
```

Add helpers:

```rust
fn import_jump_server(jump: &connection_import_protocol::SshJumpServerImportRecord) -> JumpServerConfig {
    JumpServerConfig {
        host: jump.host.clone(),
        port: jump.port,
        username: jump.username.clone(),
        auth_method: import_ssh_auth_method(&jump.auth_method),
    }
}

fn import_proxy(proxy: &connection_import_protocol::SshProxyImportRecord) -> ProxyConfig {
    ProxyConfig {
        proxy_type: match proxy.kind {
            connection_import_protocol::SshProxyImportKind::Socks5 => ProxyType::Socks5,
            connection_import_protocol::SshProxyImportKind::Http => ProxyType::Http,
        },
        host: proxy.host.clone(),
        port: proxy.port,
        username: proxy.username.clone(),
        password: proxy.password.clone(),
    }
}
```

- [ ] **Step 5: Implement port-forwarding draft conversion**

Add `PortForwarding` to `ImportDraftKind`.

In `EditableImportDraft::new`, branch on `ImportRecordKind::PortForwarding`.

Add:

```rust
pub(crate) fn to_port_forwarding_connection(
    &self,
    ssh_connection_id: i64,
) -> Result<StoredConnection, String> {
    let ImportDraftPayload::Record(record) = &self.payload;
    let imported = record
        .port_forwarding
        .as_ref()
        .ok_or_else(|| "端口转发导入记录缺少端口转发配置".to_string())?;
    let params = PortForwardingParams {
        ssh_connection_id,
        kind: match imported.kind {
            PortForwardingImportKind::Local => PortForwardingKind::Local,
            PortForwardingImportKind::Dynamic => PortForwardingKind::Dynamic,
            PortForwardingImportKind::Remote => PortForwardingKind::Remote,
        },
        bind_host: imported.bind_host.clone(),
        bind_port: imported.bind_port,
        target_host: imported.target_host.clone(),
        target_port: imported.target_port,
    };
    Ok(StoredConnection::new_port_forwarding(
        required_text(&self.name, "连接名称")?,
        params,
        None,
    ))
}
```

- [ ] **Step 6: Implement imported private key persistence**

In `main/src/home/connection_import_actions.rs`, add:

```rust
fn imported_private_keys_dir() -> Result<std::path::PathBuf, String> {
    let dir = one_core::storage::get_config_dir()
        .map_err(|error| error.to_string())?
        .join("imported-private-keys");
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn persist_imported_private_key(record_id: &str, private_key: &str) -> Result<String, String> {
    let file_name = format!("{}.key", sanitize_key_file_name(record_id));
    let path = imported_private_keys_dir()?.join(file_name);
    std::fs::write(&path, private_key).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
    }
    Ok(path.to_string_lossy().to_string())
}

fn sanitize_key_file_name(value: &str) -> String {
    value
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect()
}
```

Before SSH conversion, transform `PrivateKeyMaterial { private_key: Some(..) }` into `PrivateKey { key_path, passphrase }` by writing the key through `persist_imported_private_key`.

- [ ] **Step 7: Implement batch save with source id map**

In `main/src/home/connection_import_actions.rs`, add:

```rust
pub(crate) fn save_import_drafts(
    drafts: &[EditableImportDraft],
    cx: &mut App,
) -> Vec<(String, ImportSaveResult)> {
    let mut results = Vec::new();
    let mut ssh_id_by_source = std::collections::HashMap::<String, i64>::new();

    for draft in drafts.iter().filter(|draft| draft.selected && draft.kind() == ImportDraftKind::Ssh) {
        let source_id = draft.source_id().to_string();
        match save_import_draft(draft, cx) {
            Ok(ImportSaveResult::Saved { connection_id: Some(id) }) => {
                ssh_id_by_source.insert(source_id.clone(), id);
                results.push((source_id, ImportSaveResult::Saved { connection_id: Some(id) }));
            }
            Ok(result) => results.push((source_id, result)),
            Err(error) => results.push((source_id, ImportSaveResult::Failed { message: error })),
        }
    }

    for draft in drafts.iter().filter(|draft| draft.selected && draft.kind() == ImportDraftKind::PortForwarding) {
        let source_id = draft.source_id().to_string();
        let Some(ssh_source_id) = draft.forwarding_ssh_source_id() else {
            results.push((source_id, ImportSaveResult::Failed { message: "端口转发缺少 SSH 来源".to_string() }));
            continue;
        };
        let Some(ssh_id) = ssh_id_by_source.get(ssh_source_id).copied() else {
            results.push((source_id, ImportSaveResult::Failed { message: "端口转发引用的 SSH 连接未导入".to_string() }));
            continue;
        };
        results.push((source_id.clone(), save_port_forwarding_draft(draft, ssh_id, cx)));
    }

    results
}
```

If `ImportSaveResult` is still an enum with only `Saved` and `SkippedDuplicate`, add:

```rust
Failed { message: String },
```

Update `ConnectionImportWindow::save_selected` to call `save_import_drafts` once and mark row results.

- [ ] **Step 8: Run main import tests**

Run:

```bash
rtk cargo test -p main connection_import_draft connection_import_model connection_import_window
```

Expected: PASS.

- [ ] **Step 9: Commit host draft/save changes**

Run:

```bash
rtk git add main/src/home/connection_import_draft.rs main/src/home/connection_import_actions.rs main/src/home/connection_import_model.rs main/src/home/connection_import_window.rs main/src/home/connection_import_draft_tests.rs main/src/home/connection_import_model_tests.rs main/src/home/connection_import_window_tests.rs
rtk git commit -m "feat: save linked connection import records"
```

Expected: commit succeeds in the host worktree.

---

## Task 5: Remote Port Forwarding Support

**Workdir:** `/Users/hufei/RustroverProjects/onetcli/.worktrees/connection-import-center`

**Files:**
- Modify: `crates/core/src/storage/models.rs`
- Modify: `crates/ssh/src/ssh.rs`
- Modify: `crates/ssh/src/lib.rs`
- Modify: `crates/port_forwarding/src/runtime.rs`
- Modify: `crates/port_forwarding/src/lib.rs`
- Modify: `crates/port_forwarding/src/runtime_tests.rs`
- Modify: `crates/port_forwarding_view/src/selects.rs`
- Modify: `crates/port_forwarding_view/src/form_window.rs`
- Modify: `crates/onetcli_runtime/src/connections/schema.rs`
- Modify: `crates/onetcli_runtime/src/connections/extended_build.rs`

- [ ] **Step 1: Add failing storage/runtime tests**

In `crates/core/src/storage/models.rs`, extend the existing port-forwarding roundtrip test:

```rust
#[test]
fn stored_connection_remote_port_forwarding_roundtrip() {
    let connection = StoredConnection::new_port_forwarding(
        "remote ssh".to_string(),
        PortForwardingParams {
            ssh_connection_id: 7,
            kind: PortForwardingKind::Remote,
            bind_host: "0.0.0.0".to_string(),
            bind_port: 8022,
            target_host: "127.0.0.1".to_string(),
            target_port: 22,
        },
        None,
    );

    let params = connection.to_port_forwarding_params().unwrap();
    assert_eq!(PortForwardingKind::Remote, params.kind);
    assert_eq!("Remote", params.kind.label());
}
```

In `crates/port_forwarding/src/runtime_tests.rs`, add:

```rust
#[test]
fn remote_request_uses_referenced_ssh_connection_and_forwarding_params() {
    let request =
        build_remote_forwarding_request(&remote_forwarding_connection(7), &ssh_connection(7))
            .unwrap();

    assert_eq!(request.bind_host, "0.0.0.0");
    assert_eq!(request.bind_port, 8022);
    assert_eq!(request.target_host, "127.0.0.1");
    assert_eq!(request.target_port, 22);
    assert_eq!(request.ssh_config.host, "bastion.example.com");
}
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
rtk cargo test -p core stored_connection_remote_port_forwarding_roundtrip
rtk cargo test -p port_forwarding remote_request_uses_referenced_ssh_connection_and_forwarding_params
```

Expected: FAIL because `Remote` and remote request builder do not exist.

- [ ] **Step 3: Add `PortForwardingKind::Remote`**

In `crates/core/src/storage/models.rs`:

```rust
pub enum PortForwardingKind {
    #[default]
    Local,
    Dynamic,
    Remote,
}

impl PortForwardingKind {
    pub fn label(&self) -> &'static str {
        match self {
            Self::Local => "Local",
            Self::Dynamic => "Dynamic SOCKS",
            Self::Remote => "Remote",
        }
    }
}
```

- [ ] **Step 4: Add SSH remote forwarding tunnel**

In `crates/ssh/src/ssh.rs`, add a handler channel sender:

```rust
struct RusshHandler {
    forwarded_tx: Option<tokio::sync::mpsc::UnboundedSender<Channel<client::Msg>>>,
}

impl client::Handler for RusshHandler {
    type Error = russh::Error;

    async fn check_server_key(&mut self, _server_public_key: &PublicKey) -> Result<bool, Self::Error> {
        Ok(true)
    }

    async fn server_channel_open_forwarded_tcpip(
        &mut self,
        channel: Channel<client::Msg>,
        _connected_address: &str,
        _connected_port: u32,
        _originator_address: &str,
        _originator_port: u32,
        _session: &mut client::Session,
    ) -> Result<(), Self::Error> {
        if let Some(tx) = &self.forwarded_tx {
            let _ = tx.send(channel);
        }
        Ok(())
    }
}
```

Keep existing connects using `RusshHandler { forwarded_tx: None }`.

Add:

```rust
pub struct RemotePortForwardConfig {
    pub bind_host: String,
    pub bind_port: u16,
    pub target_host: String,
    pub target_port: u16,
}

pub struct RemotePortForwardTunnel {
    bind_host: String,
    bind_port: u16,
    shutdown_tx: Option<oneshot::Sender<()>>,
    accept_task: Option<tokio::task::JoinHandle<()>>,
    client: Arc<Mutex<RusshClient>>,
}

impl RemotePortForwardTunnel {
    pub async fn close(&mut self) -> Result<()> {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        if let Some(task) = self.accept_task.take() {
            let _ = task.await;
        }
        let mut guard = self.client.lock().await;
        guard
            .session
            .cancel_tcpip_forward(self.bind_host.clone(), self.bind_port as u32)
            .await?;
        guard.disconnect().await
    }
}
```

Add `start_remote_port_forward_with_config(config, forward_config)` that connects with a `forwarded_tx`, calls:

```rust
client.session.tcpip_forward(bind_host.clone(), bind_port as u32).await?;
```

and for every received forwarded channel:

```rust
let mut inbound = channel.into_stream();
let mut outbound = TcpStream::connect((target_host.as_str(), target_port)).await?;
copy_bidirectional(&mut inbound, &mut outbound).await?;
```

Export `RemotePortForwardConfig`, `RemotePortForwardTunnel`, and `start_remote_port_forward_with_config` from `crates/ssh/src/lib.rs`.

- [ ] **Step 5: Add port_forwarding runtime remote request and start**

In `crates/port_forwarding/src/runtime.rs`, add:

```rust
pub struct RemoteForwardingRequest {
    pub ssh_config: SshConnectConfig,
    pub bind_host: String,
    pub bind_port: u16,
    pub target_host: String,
    pub target_port: u16,
}
```

Add `remote_tunnels: HashMap<i64, RemotePortForwardTunnel>` to `PortForwardingRuntime`.

Add:

```rust
pub async fn start_remote(
    &mut self,
    connection_id: i64,
    request: RemoteForwardingRequest,
) -> Result<()> {
    if self.is_running(connection_id) {
        bail!("Port Forwarding connection is already running");
    }
    let tunnel = start_remote_port_forward_with_config(
        request.ssh_config,
        RemotePortForwardConfig {
            bind_host: request.bind_host,
            bind_port: request.bind_port,
            target_host: request.target_host,
            target_port: request.target_port,
        },
    )
    .await?;
    self.remote_tunnels.insert(connection_id, tunnel);
    Ok(())
}
```

Add `build_remote_forwarding_request` mirroring local builder but requiring `PortForwardingKind::Remote`.

- [ ] **Step 6: Update UI/schema parsers**

Add `Remote` to:

- `ForwardingKindSelectItem::all()` in `crates/port_forwarding_view/src/selects.rs`
- validation logic in `crates/port_forwarding_view/src/form_window.rs`
- enum field in `crates/onetcli_runtime/src/connections/schema.rs`
- `parse_port_forwarding_kind` in `crates/onetcli_runtime/src/connections/extended_build.rs`

Use:

```rust
"Remote" | "remote" => Ok(PortForwardingKind::Remote),
```

- [ ] **Step 7: Run remote forwarding tests**

Run:

```bash
rtk cargo test -p core stored_connection_remote_port_forwarding_roundtrip
rtk cargo test -p port_forwarding
rtk cargo test -p onetcli_runtime port_forwarding
rtk cargo check -p port_forwarding_view
```

Expected: PASS.

- [ ] **Step 8: Commit remote forwarding support**

Run:

```bash
rtk git add crates/core/src/storage/models.rs crates/ssh/src/ssh.rs crates/ssh/src/lib.rs crates/port_forwarding/src/runtime.rs crates/port_forwarding/src/lib.rs crates/port_forwarding/src/runtime_tests.rs crates/port_forwarding_view/src/selects.rs crates/port_forwarding_view/src/form_window.rs crates/onetcli_runtime/src/connections/schema.rs crates/onetcli_runtime/src/connections/extended_build.rs
rtk git commit -m "feat: add remote port forwarding support"
```

Expected: commit succeeds in the host worktree.

---

## Task 6: Scaffold Termius WASM Importer

**Workdir:** `/Users/hufei/RustroverProjects/onetcli-extensions`

**Files:**
- Modify: `Cargo.toml`
- Create: `extensions/wasm/termius-importer/Cargo.toml`
- Create: `extensions/wasm/termius-importer/extension.json`
- Create: `extensions/wasm/termius-importer/extension.build.json`
- Create: `extensions/wasm/termius-importer/src/lib.rs`
- Create: `extensions/wasm/termius-importer/src/component.rs`
- Create: `extensions/wasm/termius-importer/src/model.rs`

- [ ] **Step 1: Add failing workspace package check**

Run:

```bash
rtk cargo test -p termius_importer_wasm
```

Expected: FAIL because the package does not exist.

- [ ] **Step 2: Add workspace member and crate manifest**

In root `Cargo.toml`, add:

```toml
"extensions/wasm/termius-importer",
```

Create `extensions/wasm/termius-importer/Cargo.toml`:

```toml
[package]
name = "termius_importer_wasm"
version = "0.1.0"
edition.workspace = true
publish.workspace = true

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
anyhow.workspace = true
base64.workspace = true
crypto_secretbox = { version = "0.2.0-pre.0", default-features = false, features = ["alloc", "salsa20"] }
hex.workspace = true
integer-encoding = "3"
rusty-leveldb = { version = "4.0.1", default-features = false }
serde.workspace = true
serde_json.workspace = true
thiserror = "2"
wit-bindgen = "0.57.1"
```

- [ ] **Step 3: Add composite manifest and build metadata**

Create `extensions/wasm/termius-importer/extension.build.json`:

```json
{
  "id": "termius-importer",
  "kind": "composite",
  "language": "rust-wasm",
  "path": "extensions/wasm/termius-importer",
  "package": "termius_importer_wasm",
  "binary": "termius_importer_wasm.wasm",
  "targets": ["universal"],
  "releaseTagPrefix": "termius-importer-v",
  "r2Prefix": "extensions/termius-importer"
}
```

Create `extensions/wasm/termius-importer/extension.json`:

```json
{
  "schema_version": 1,
  "id": "com.onetcli.importer.termius",
  "name": "Termius Importer",
  "description": "Rust WASM connection importer for Termius",
  "version": "0.1.0",
  "publisher": "OnetCli",
  "engines": { "onetcli": ">=0.7.0" },
  "api": { "extension": "1.0" },
  "runtime": {
    "wasm": [
      {
        "id": "termius-importer",
        "module": "wasm/termius_importer_wasm.wasm",
        "kind": "component",
        "timeout_ms": 10000,
        "max_memory_mb": 128
      }
    ]
  },
  "permissions": [
    "fs:read:~/Library/Application Support/Termius/IndexedDB/file__0.indexeddb.leveldb",
    "fs:read:%APPDATA%/Termius/IndexedDB/file__0.indexeddb.leveldb",
    "fs:read:~/.config/Termius/IndexedDB/file__0.indexeddb.leveldb",
    "secrets:read:termius.localkey"
  ],
  "contributes": {
    "connectionImporters": [
      {
        "id": "termius",
        "runtimeId": "termius-importer",
        "displayName": "Termius",
        "description": "Import SSH connections and port forwarding rules from Termius",
        "icon": "terminal",
        "outputKinds": ["ssh", "port-forwarding"],
        "platforms": ["macos", "windows", "linux"],
        "candidateFiles": [
          {
            "id": "termius-macos-indexeddb",
            "platform": "macos",
            "path": "~/Library/Application Support/Termius/IndexedDB/file__0.indexeddb.leveldb"
          },
          {
            "id": "termius-windows-indexeddb",
            "platform": "windows",
            "path": "%APPDATA%/Termius/IndexedDB/file__0.indexeddb.leveldb"
          },
          {
            "id": "termius-linux-indexeddb",
            "platform": "linux",
            "path": "~/.config/Termius/IndexedDB/file__0.indexeddb.leveldb"
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 4: Add minimal component**

Create `src/lib.rs`:

```rust
mod component;
mod model;
```

Create `src/component.rs`:

```rust
wit_bindgen::generate!({
    path: "../../../wit",
    world: "connection-importer",
});

struct TermiusImporter;

impl Guest for TermiusImporter {
    fn descriptor() -> String {
        serde_json::json!({
            "id": "termius",
            "display_name": "Termius",
            "description": "Import SSH connections and port forwarding rules from Termius",
            "icon": "terminal",
            "vendor": "OnetCli",
            "supported_platforms": ["macos", "windows", "linux"],
            "output_kinds": ["ssh", "port_forwarding"],
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
        serde_json::json!({
            "importer_id": "termius",
            "availability": "no_data",
            "discovered_files": [],
            "warnings": []
        })
        .to_string()
    }

    fn preview(_options: ImportOptions) -> String {
        "[]".to_string()
    }
}

export!(TermiusImporter);
```

Create `src/model.rs` with protocol structs mirroring `connection-import-protocol` JSON:

```rust
use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ImportWarning {
    pub code: String,
    pub message: String,
}
```

- [ ] **Step 5: Build scaffold**

Run:

```bash
rtk cargo test -p termius_importer_wasm
rtk cargo build --release -p termius_importer_wasm --target wasm32-wasip2
```

Expected: PASS.

- [ ] **Step 6: Commit scaffold**

Run:

```bash
rtk git add Cargo.toml Cargo.lock extensions/wasm/termius-importer
rtk git commit -m "feat: scaffold Termius WASM importer"
```

Expected: commit succeeds in the extension repo.

---

## Task 7: Termius Crypto and LevelDB Directory Loader

**Workdir:** `/Users/hufei/RustroverProjects/onetcli-extensions`

**Files:**
- Create: `extensions/wasm/termius-importer/src/crypto.rs`
- Create: `extensions/wasm/termius-importer/src/leveldb.rs`
- Modify: `extensions/wasm/termius-importer/src/lib.rs`
- Modify: `extensions/wasm/termius-importer/src/component.rs`

- [ ] **Step 1: Add failing crypto tests**

In `src/crypto.rs`, add tests first:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crypto_secretbox::{
        aead::{Aead, KeyInit},
        Key, Nonce, XSalsa20Poly1305,
    };

    #[test]
    fn decrypts_termius_local_crypto_payload() {
        let key = [7u8; 32];
        let nonce = [9u8; 24];
        let cipher = XSalsa20Poly1305::new(Key::from_slice(&key));
        let encrypted = cipher.encrypt(Nonce::from_slice(&nonce), b"hello".as_ref()).unwrap();
        let mut payload = vec![0x04, 0x01];
        payload.extend_from_slice(&nonce);
        payload.extend_from_slice(&encrypted);

        assert_eq!(
            "hello",
            decrypt_local_string(&key, &payload).unwrap()
        );
    }

    #[test]
    fn rejects_secretbox_payload_with_wrong_prefix() {
        let key = [7u8; 32];
        let error = decrypt_local_string(&key, b"not-termius").unwrap_err();

        assert!(error.to_string().contains("unsupported Termius encrypted value"));
    }
}
```

- [ ] **Step 2: Implement crypto decryptor**

Implement:

```rust
use crypto_secretbox::{
    aead::{Aead, KeyInit},
    Key, Nonce, XSalsa20Poly1305,
};

pub fn decode_local_key(value: &str) -> anyhow::Result<[u8; 32]> {
    let bytes = base64::decode(value)
        .or_else(|_| hex::decode(value))
        .unwrap_or_else(|_| value.as_bytes().to_vec());
    let key: [u8; 32] = bytes
        .try_into()
        .map_err(|_| anyhow::anyhow!("Termius local key must be 32 bytes"))?;
    Ok(key)
}

pub fn decrypt_local_string(key: &[u8; 32], payload: &[u8]) -> anyhow::Result<String> {
    if payload.len() < 42 || payload[0] != 0x04 || payload[1] != 0x01 {
        anyhow::bail!("unsupported Termius encrypted value");
    }
    let nonce = &payload[2..26];
    let ciphertext = &payload[26..];
    let cipher = XSalsa20Poly1305::new(Key::from_slice(key));
    let plain = cipher
        .decrypt(Nonce::from_slice(nonce), ciphertext)
        .map_err(|_| anyhow::anyhow!("Termius encrypted value authentication failed"))?;
    Ok(String::from_utf8(plain)?)
}
```

- [ ] **Step 3: Add failing MemEnv LevelDB loader test**

In `src/leveldb.rs`, add:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use rusty_leveldb::{DB, LdbIterator, Options};

    #[test]
    fn opens_leveldb_from_host_supplied_files() {
        let mut options = rusty_leveldb::in_memory();
        options.create_if_missing = true;
        {
            let mut db = DB::open("termius", options.clone()).unwrap();
            db.put(b"key", b"value").unwrap();
            db.flush().unwrap();
        }
        let files = export_mem_env_files(&options, "termius");

        let mut db = open_from_files("termius", files).unwrap();
        assert_eq!(b"value".to_vec(), db.get(b"key").unwrap());
    }
}
```

If `export_mem_env_files` cannot be implemented through public `MemEnv`, replace this test with a fixture created by `create_leveldb_files_for_tests()` that writes through `Options.env.open_writable_file`.

- [ ] **Step 4: Implement LevelDB loader using `MemEnv`**

Implement:

```rust
pub struct HostFile {
    pub relative_path: String,
    pub bytes: Vec<u8>,
}

pub fn open_from_files(db_name: &str, files: Vec<HostFile>) -> anyhow::Result<rusty_leveldb::DB> {
    let mut options = rusty_leveldb::in_memory();
    options.create_if_missing = false;
    for file in files {
        let path = std::path::Path::new(db_name).join(&file.relative_path);
        let mut writer = options
            .env
            .open_writable_file(&path)
            .map_err(|error| anyhow::anyhow!("{error}"))?;
        use std::io::Write;
        writer.write_all(&file.bytes)?;
    }
    rusty_leveldb::DB::open(db_name, options).map_err(|error| anyhow::anyhow!("{error}"))
}
```

In `component.rs`, read directory entries and then each non-directory child:

```rust
fn read_leveldb_candidate(candidate_id: &str) -> Vec<crate::leveldb::HostFile> {
    let Ok(entries) = connection_import_host::read_directory(candidate_id) else {
        return Vec::new();
    };
    entries
        .into_iter()
        .filter(|entry| !entry.is_dir)
        .filter_map(|entry| {
            connection_import_host::read_candidate_child_file(candidate_id, &entry.name)
                .ok()
                .map(|bytes| crate::leveldb::HostFile {
                    relative_path: entry.name,
                    bytes,
                })
        })
        .collect()
}
```

- [ ] **Step 5: Run importer tests**

Run:

```bash
rtk cargo test -p termius_importer_wasm crypto leveldb
```

Expected: PASS.

- [ ] **Step 6: Commit crypto and LevelDB loader**

Run:

```bash
rtk git add extensions/wasm/termius-importer/src/crypto.rs extensions/wasm/termius-importer/src/leveldb.rs extensions/wasm/termius-importer/src/lib.rs extensions/wasm/termius-importer/src/component.rs Cargo.lock
rtk git commit -m "feat: read encrypted Termius LevelDB data"
```

Expected: commit succeeds in the extension repo.

---

## Task 8: Termius IndexedDB Codec and Entity Reader

**Workdir:** `/Users/hufei/RustroverProjects/onetcli-extensions`

**Files:**
- Create: `extensions/wasm/termius-importer/src/idb_codec.rs`
- Create: `extensions/wasm/termius-importer/src/termius.rs`
- Modify: `extensions/wasm/termius-importer/src/model.rs`
- Modify: `extensions/wasm/termius-importer/src/lib.rs`

- [ ] **Step 1: Add failing entity-reader tests with synthetic data**

In `src/termius.rs`, add tests that use normalized synthetic store rows, not real user data:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn joins_host_ssh_config_identity_key_proxy_chain_and_forwarding() {
        let stores = TermiusStores::synthetic(vec![
            row("hosts", "host-1", serde_json::json!({
                "local_id": "host-1",
                "label": "Prod",
                "address": "prod.example.test",
                "ssh_config": "ssh-config-1"
            })),
            row("ssh_configs", "ssh-config-1", serde_json::json!({
                "local_id": "ssh-config-1",
                "port": 2200,
                "identity": "identity-1",
                "startup_snippet": "snippet-1",
                "proxy": "proxy-1",
                "host_chain": "chain-1"
            })),
            row("ssh_identities", "identity-1", serde_json::json!({
                "local_id": "identity-1",
                "username": "deploy",
                "password": "secret",
                "key": "key-1"
            })),
            row("keys", "key-1", serde_json::json!({
                "local_id": "key-1",
                "label": "prod-key",
                "private_key": "fixture-private-key",
                "passphrase": "fixture-passphrase"
            })),
            row("snippets", "snippet-1", serde_json::json!({
                "local_id": "snippet-1",
                "label": "startup",
                "script": "echo ready"
            })),
            row("proxies", "proxy-1", serde_json::json!({
                "local_id": "proxy-1",
                "type": "socks",
                "host": "proxy.example.test",
                "port": 1080
            })),
            row("host_chains", "chain-1", serde_json::json!({
                "local_id": "chain-1",
                "hosts": ["jump-1"]
            })),
            row("hosts", "jump-1", serde_json::json!({
                "local_id": "jump-1",
                "label": "Jump",
                "address": "jump.example.test",
                "ssh_config": "jump-config"
            })),
            row("ssh_configs", "jump-config", serde_json::json!({
                "local_id": "jump-config",
                "port": 22,
                "identity": "jump-identity"
            })),
            row("ssh_identities", "jump-identity", serde_json::json!({
                "local_id": "jump-identity",
                "username": "jump",
                "password": null
            })),
            row("pf_rules", "pf-1", serde_json::json!({
                "local_id": "pf-1",
                "label": "remote ssh",
                "host": "host-1",
                "pf_type": "Remote Rule",
                "bound_address": "0.0.0.0",
                "local_port": 22,
                "hostname": "127.0.0.1",
                "remote_port": 8022
            }))
        ]);

        let model = read_model_from_stores(stores, true).unwrap();

        assert_eq!(1, model.hosts.len());
        assert_eq!("Prod", model.hosts[0].label);
        assert_eq!(Some("echo ready"), model.hosts[0].init_script.as_deref());
        assert_eq!(1, model.port_forwardings.len());
        assert_eq!(TermiusPortForwardingKind::Remote, model.port_forwardings[0].kind);
    }
}
```

- [ ] **Step 2: Implement Termius normalized models**

In `src/model.rs`, add:

```rust
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TermiusModel {
    pub hosts: Vec<TermiusHost>,
    pub port_forwardings: Vec<TermiusPortForwarding>,
    pub skipped: Vec<ImportWarning>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TermiusHost {
    pub source_id: String,
    pub label: String,
    pub address: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub private_key: Option<TermiusPrivateKey>,
    pub init_script: Option<String>,
    pub proxy: Option<TermiusProxy>,
    pub jump_server: Option<TermiusJumpServer>,
    pub warnings: Vec<ImportWarning>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TermiusPrivateKey {
    pub source_id: String,
    pub label: Option<String>,
    pub private_key: Option<String>,
    pub passphrase: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TermiusProxy {
    pub kind: TermiusProxyKind,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub password: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TermiusProxyKind {
    Socks5,
    Http,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TermiusJumpServer {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: TermiusAuth,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TermiusAuth {
    Password(Option<String>),
    PrivateKey(TermiusPrivateKey),
    Agent,
    AutoPublicKey,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TermiusPortForwarding {
    pub source_id: String,
    pub label: String,
    pub host_source_id: String,
    pub kind: TermiusPortForwardingKind,
    pub bind_host: String,
    pub bind_port: u16,
    pub target_host: String,
    pub target_port: u16,
    pub warnings: Vec<ImportWarning>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TermiusPortForwardingKind {
    Local,
    Dynamic,
    Remote,
}
```

- [ ] **Step 3: Implement store reader from decoded values**

In `src/termius.rs`, implement `TermiusStores` as a map:

```rust
pub struct TermiusStores {
    stores: std::collections::BTreeMap<String, Vec<serde_json::Value>>,
}

pub fn read_model_from_stores(
    stores: TermiusStores,
    include_passwords: bool,
) -> anyhow::Result<TermiusModel> {
    let hosts = stores.by_local_id("hosts");
    let ssh_configs = stores.by_local_id("ssh_configs");
    let identities = stores.by_local_id("ssh_identities");
    let keys = stores.by_local_id("keys");
    let snippets = stores.by_local_id("snippets");
    let proxies = stores.by_local_id("proxies");
    let chains = stores.by_local_id("host_chains");
    let mut out = TermiusModel {
        hosts: Vec::new(),
        port_forwardings: Vec::new(),
        skipped: Vec::new(),
    };
    for host_value in stores.values("hosts") {
        if host_value.get("telnet_config").is_some() && host_value.get("ssh_config").is_none() {
            out.skipped.push(ImportWarning {
                code: "termius_telnet_skipped".to_string(),
                message: "Termius Telnet host skipped because OnetCli has no Telnet import target".to_string(),
            });
            continue;
        }
        let Some(source_id) = string_field(host_value, "local_id") else {
            continue;
        };
        let Some(address) = string_field(host_value, "address") else {
            out.skipped.push(ImportWarning {
                code: "termius_host_missing_address".to_string(),
                message: "Termius SSH host skipped because its address is missing".to_string(),
            });
            continue;
        };
        let label = string_field(host_value, "label").unwrap_or(source_id).to_string();
        let ssh_config_id = string_field(host_value, "ssh_config").unwrap_or_default();
        let ssh_config = stores.get("ssh_configs", ssh_config_id);
        let identity = ssh_config
            .and_then(|config| string_field(config, "identity"))
            .and_then(|id| stores.get("ssh_identities", id));
        let username = identity
            .and_then(|value| string_field(value, "username"))
            .unwrap_or_default()
            .to_string();
        out.hosts.push(TermiusHost {
            source_id: source_id.to_string(),
            label,
            address: address.to_string(),
            port: ssh_config.and_then(|value| u16_field(value, "port")).unwrap_or(22),
            username,
            password: include_passwords
                .then(|| identity.and_then(|value| string_field(value, "password")).map(str::to_string))
                .flatten(),
            private_key: include_passwords
                .then(|| identity.and_then(|value| private_key_for_identity(&stores, value)))
                .flatten(),
            init_script: ssh_config
                .and_then(|config| string_field(config, "startup_snippet"))
                .and_then(|id| stores.get("snippets", id))
                .and_then(|snippet| string_field(snippet, "script"))
                .map(str::to_string),
            proxy: ssh_config
                .and_then(|config| string_field(config, "proxy"))
                .and_then(|id| stores.get("proxies", id))
                .and_then(parse_proxy),
            jump_server: ssh_config
                .and_then(|config| string_field(config, "host_chain"))
                .and_then(|id| stores.get("host_chains", id))
                .and_then(|chain| first_jump_server(&stores, chain, include_passwords)),
            warnings: Vec::new(),
        });
    }
    for pf_value in stores.values("pf_rules") {
        if let Some(forwarding) = parse_port_forwarding(pf_value) {
            out.port_forwardings.push(forwarding);
        }
    }
    if !stores.values("snippets").is_empty() {
        out.skipped.push(ImportWarning {
            code: "termius_snippets_skipped".to_string(),
            message: "Termius ordinary snippets skipped because Quick Commands import is out of scope".to_string(),
        });
    }
    if !stores.values("known_hosts").is_empty() {
        out.skipped.push(ImportWarning {
            code: "termius_known_hosts_skipped".to_string(),
            message: "Termius known_hosts skipped because OnetCli has no known-hosts import target".to_string(),
        });
    }
    Ok(out)
}
```

The implementation must:

- default SSH port to `22`
- skip hosts with missing address
- include `password`, `private_key`, and `passphrase` only when `include_passwords` is true
- always include decrypted labels, addresses, usernames, proxy hosts, chain hosts, and forwarding labels when available
- map Termius proxy type `"socks"` to `Socks5` and `"http"` to `Http`
- map one host-chain hop to `TermiusJumpServer`
- add a warning for extra host-chain hops beyond the first

- [ ] **Step 4: Implement narrow IDB codec entrypoint**

In `src/idb_codec.rs`, define a conservative decoder:

```rust
pub struct DecodedStoreRow {
    pub store_name: String,
    pub value: serde_json::Value,
}

pub fn decode_indexeddb_rows<I>(entries: I) -> Vec<DecodedStoreRow>
where
    I: IntoIterator<Item = (Vec<u8>, Vec<u8>)>,
{
    entries
        .into_iter()
        .filter_map(|(key, value)| decode_indexeddb_row(&key, &value).ok())
        .collect()
}
```

Implement `decode_indexeddb_row` with explicit errors for unknown key/value forms. The first supported forms must be:

- store metadata rows that identify object store names
- object store data rows for Termius stores
- V8 structured clone objects containing strings, numbers, booleans, arrays, nulls, and nested objects

Keep rejected value forms as warnings in `termius.rs`; do not silently parse raw strings out of LevelDB bytes.

- [ ] **Step 5: Run entity reader tests**

Run:

```bash
rtk cargo test -p termius_importer_wasm termius idb_codec
```

Expected: PASS with synthetic fixtures only.

- [ ] **Step 6: Commit entity reader**

Run:

```bash
rtk git add extensions/wasm/termius-importer/src/idb_codec.rs extensions/wasm/termius-importer/src/termius.rs extensions/wasm/termius-importer/src/model.rs extensions/wasm/termius-importer/src/lib.rs
rtk git commit -m "feat: decode Termius IndexedDB entities"
```

Expected: commit succeeds in the extension repo.

---

## Task 9: Termius Mapper and Preview Output

**Workdir:** `/Users/hufei/RustroverProjects/onetcli-extensions`

**Files:**
- Create: `extensions/wasm/termius-importer/src/mapper.rs`
- Create: `extensions/wasm/termius-importer/src/diagnostics.rs`
- Modify: `extensions/wasm/termius-importer/src/component.rs`
- Modify: `extensions/wasm/termius-importer/src/model.rs`
- Modify: `extensions/wasm/termius-importer/src/lib.rs`

- [ ] **Step 1: Add failing mapper tests**

In `src/mapper.rs`, add:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_host_with_startup_proxy_jump_and_private_key_material() {
        let model = TermiusModel {
            hosts: vec![fixture_host_with_everything()],
            port_forwardings: Vec::new(),
            skipped: Vec::new(),
        };

        let records = map_records(model);

        assert_eq!(1, records.len());
        let record = &records[0];
        assert_eq!("ssh", record.kind);
        assert_eq!(Some("host-1"), record.source_id.as_deref());
        let ssh = record.ssh.as_ref().unwrap();
        assert_eq!(Some("echo ready"), ssh.init_script.as_deref());
        assert!(ssh.proxy.is_some());
        assert!(ssh.jump_server.is_some());
        assert!(matches!(
            ssh.auth_method,
            SshImportAuthMethod::PrivateKeyMaterial { .. }
        ));
    }

    #[test]
    fn maps_remote_forwarding_to_port_forwarding_record() {
        let model = TermiusModel {
            hosts: vec![fixture_host("host-1")],
            port_forwardings: vec![fixture_remote_forwarding("pf-1", "host-1")],
            skipped: Vec::new(),
        };

        let records = map_records(model);
        let forwarding = records
            .iter()
            .find(|record| record.kind == "port_forwarding")
            .unwrap()
            .port_forwarding
            .as_ref()
            .unwrap();

        assert_eq!("termius:host:host-1", forwarding.ssh_source_id);
        assert_eq!("remote", forwarding.kind);
        assert_eq!(8022, forwarding.bind_port);
        assert_eq!("127.0.0.1", forwarding.target_host);
        assert_eq!(22, forwarding.target_port);
    }

    #[test]
    fn ordinary_snippets_are_skipped_not_mapped_to_quick_commands() {
        let diagnostics = skipped_snippet_warning(3);

        assert_eq!("termius_snippets_skipped", diagnostics.code);
        assert!(diagnostics.message.contains("Quick Commands"));
    }
}
```

- [ ] **Step 2: Implement protocol output structs**

In `src/model.rs`, add serializable output structs that match `connection-import-protocol` JSON:

```rust
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct ImportRecord {
    pub id: String,
    pub importer_id: String,
    pub source_label: String,
    pub source_id: Option<String>,
    pub kind: String,
    pub display_name: String,
    pub database: Option<serde_json::Value>,
    pub ssh: Option<SshImportRecord>,
    pub port_forwarding: Option<PortForwardingImportRecord>,
    pub password_status: String,
    pub warnings: Vec<ImportWarning>,
}
```

Define `SshImportRecord`, `SshImportAuthMethod`, `SshJumpServerImportRecord`, `SshProxyImportRecord`, and `PortForwardingImportRecord` with `#[serde(rename_all = "snake_case")]` enum variants matching host protocol.

- [ ] **Step 3: Implement mapper**

Map:

- `TermiusHost.source_id` -> `ImportRecord.source_id`
- `TermiusHost.label` -> `display_name` and `ssh.name`
- `TermiusHost.address` -> `ssh.host`
- `TermiusHost.port` -> `ssh.port`
- `TermiusHost.username` -> `ssh.username`
- password -> `SshImportAuthMethod::Password`
- private key material -> `SshImportAuthMethod::PrivateKeyMaterial`
- no secret auth -> `Agent` or `AutoPublicKey`
- `TermiusHost.init_script` -> `ssh.init_script`
- `TermiusProxyKind::Socks5` -> `socks5`
- `TermiusProxyKind::Http` -> `http`
- `TermiusPortForwardingKind::Local` -> `local`
- `TermiusPortForwardingKind::Dynamic` -> `dynamic`
- `TermiusPortForwardingKind::Remote` -> `remote`

Use stable ids:

```rust
fn ssh_record_id(source_id: &str) -> String {
    format!("termius:host:{source_id}")
}

fn forwarding_record_id(source_id: &str) -> String {
    format!("termius:pf:{source_id}")
}
```

- [ ] **Step 4: Wire preview**

In `src/component.rs`, implement:

```rust
fn preview(options: ImportOptions) -> String {
    let candidates = connection_import_host::list_candidate_files("termius");
    let local_key = read_termius_local_key();
    let records = crate::termius::preview_from_candidates(&candidates, local_key, options.include_passwords)
        .map(crate::mapper::map_records)
        .unwrap_or_else(|error| vec![crate::diagnostics::error_record(error)]);
    serde_json::to_string(&records).unwrap_or_else(|_| "[]".to_string())
}
```

Read the key:

```rust
fn read_termius_local_key() -> Option<[u8; 32]> {
    match connection_import_host::read_secret(&SecretQuery {
        service: "Termius".to_string(),
        account: "localKey".to_string(),
        namespace: Some("termius".to_string()),
        key: Some("localkey".to_string()),
    }) {
        SecretResult::Included(value) => crate::crypto::decode_local_key(&value).ok(),
        _ => None,
    }
}
```

- [ ] **Step 5: Run mapper and component tests**

Run:

```bash
rtk cargo test -p termius_importer_wasm mapper component
```

Expected: PASS.

- [ ] **Step 6: Commit mapper/preview**

Run:

```bash
rtk git add extensions/wasm/termius-importer/src/mapper.rs extensions/wasm/termius-importer/src/diagnostics.rs extensions/wasm/termius-importer/src/component.rs extensions/wasm/termius-importer/src/model.rs extensions/wasm/termius-importer/src/lib.rs
rtk git commit -m "feat: map Termius data to import records"
```

Expected: commit succeeds in the extension repo.

---

## Task 10: Register and Package Termius Importer

**Workdir:** `/Users/hufei/RustroverProjects/onetcli-extensions`

**Files:**
- Modify: `manifest.json`
- Modify: `tests/scripts.test.mjs`

- [ ] **Step 1: Add failing manifest test**

In `tests/scripts.test.mjs`, add:

```js
test("Termius importer is registered as a composite WASM importer", () => {
  const globalManifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "manifest.json"), "utf8"));
  const entry = globalManifest.extensions.find((extension) => extension.id === "termius-importer");

  assert.equal(entry?.kind, "composite");
  assert.equal(entry?.manifest, "termius-importer/manifest.json");

  const sourceManifest = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "extensions/wasm/termius-importer/extension.json"), "utf8"),
  );
  const importer = sourceManifest.contributes.connectionImporters[0];
  assert.deepEqual(importer.outputKinds, ["ssh", "port-forwarding"]);
  assert.ok(
    sourceManifest.permissions.includes("secrets:read:termius.localkey"),
    "Termius importer must declare localKey secret permission",
  );
});
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
rtk node --test tests/scripts.test.mjs
```

Expected: FAIL because `manifest.json` does not include `termius-importer`.

- [ ] **Step 3: Register root manifest entry**

Add to `manifest.json`:

```json
{
  "id": "termius-importer",
  "kind": "composite",
  "name": "Termius Importer",
  "version": "0.1.0",
  "release_tag": "termius-importer-v0.1.0",
  "description": "Rust WASM connection importer for Termius",
  "file_extensions": [],
  "manifest": "termius-importer/manifest.json"
}
```

- [ ] **Step 4: Run packaging verification**

Run:

```bash
rtk cargo build --release -p termius_importer_wasm --target wasm32-wasip2
rtk node --test tests/scripts.test.mjs
rtk node scripts/release-driver.mjs termius-importer 0.1.0 --target universal --artifact-dir artifacts/termius-importer-0.1.0
```

Expected: PASS and creates `artifacts/termius-importer-0.1.0/termius-importer-composite-universal.tar.gz`.

- [ ] **Step 5: Commit registration**

Run:

```bash
rtk git add manifest.json tests/scripts.test.mjs
rtk git commit -m "feat: register Termius importer package"
```

Expected: commit succeeds in the extension repo.

---

## Task 11: Host End-to-End Importer Visibility and Save Tests

**Workdir:** `/Users/hufei/RustroverProjects/onetcli/.worktrees/connection-import-center`

**Files:**
- Modify: `crates/extension-runtime/src/extension/composite_provider_tests.rs`
- Modify: `crates/extension-runtime/src/extension_runtime_wasm_contract_tests.rs`
- Modify: `main/src/home/connection_import_draft_tests.rs`
- Modify: `main/src/home/connection_import_window_tests.rs`

- [ ] **Step 1: Add fixture WAT protocol test for Termius port-forwarding output**

Update `crates/extension-wasm/fixtures/connection-import/termius_importer_core.wat` so its `preview` returns JSON containing one SSH record and one `port_forwarding` record. Include:

```json
{
  "id": "termius:pf:1",
  "importer_id": "termius",
  "source_label": "Termius",
  "source_id": "pf-1",
  "kind": "port_forwarding",
  "display_name": "remote ssh",
  "database": null,
  "ssh": null,
  "port_forwarding": {
    "name": "remote ssh",
    "ssh_source_id": "termius:host:1",
    "kind": "remote",
    "bind_host": "0.0.0.0",
    "bind_port": 8022,
    "target_host": "127.0.0.1",
    "target_port": 22
  },
  "password_status": "unsupported",
  "warnings": []
}
```

- [ ] **Step 2: Add host preview test**

In `crates/extension-runtime/src/extension_runtime_wasm_contract_tests.rs`, assert:

```rust
assert!(records.iter().any(|record| record.kind == ImportRecordKind::PortForwarding));
assert_eq!(
    Some(PortForwardingImportKind::Remote),
    records
        .iter()
        .find_map(|record| record.port_forwarding.as_ref().map(|pf| pf.kind))
);
```

- [ ] **Step 3: Add batch save test for linked SSH plus forwarding**

In `main/src/home/connection_import_draft_tests.rs`, add a pure conversion test proving a selected SSH and selected forwarding record produce two `StoredConnection`s when the SSH id is known. In `main/src/home/connection_import_window_tests.rs`, add a model-level test proving row statuses are updated separately for SSH and forwarding records.

- [ ] **Step 4: Run host end-to-end tests**

Run:

```bash
rtk cargo test -p extension-runtime connection_import_provider
rtk cargo test -p extension-wasm connection_import
rtk cargo test -p main connection_import
```

Expected: PASS.

- [ ] **Step 5: Commit host E2E tests**

Run:

```bash
rtk git add crates/extension-runtime/src/extension/composite_provider_tests.rs crates/extension-runtime/src/extension_runtime_wasm_contract_tests.rs crates/extension-wasm/fixtures/connection-import/termius_importer_core.wat main/src/home/connection_import_draft_tests.rs main/src/home/connection_import_window_tests.rs
rtk git commit -m "test: cover Termius linked import flow"
```

Expected: commit succeeds in the host worktree.

---

## Task 12: Final Verification

**Workdir:** both repos as specified.

- [ ] **Step 1: Verify extension repo**

From `/Users/hufei/RustroverProjects/onetcli-extensions`, run:

```bash
rtk cargo test -p termius_importer_wasm
rtk cargo fmt --all --check
rtk cargo build --release -p termius_importer_wasm --target wasm32-wasip2
rtk node --test tests/scripts.test.mjs
rtk node scripts/release-driver.mjs termius-importer 0.1.0 --target universal --artifact-dir artifacts/termius-importer-0.1.0
```

Expected: all commands pass.

- [ ] **Step 2: Verify host worktree**

From `/Users/hufei/RustroverProjects/onetcli/.worktrees/connection-import-center`, run:

```bash
rtk cargo test -p connection-import-protocol
rtk cargo test -p extension-component connection_import permissions
rtk cargo test -p extension-wasm connection_import
rtk cargo test -p extension-runtime connection_import
rtk cargo test -p main connection_import
rtk cargo test -p port_forwarding
rtk cargo check -p main
```

Expected: all commands pass.

- [ ] **Step 3: Install local composite package for visibility check**

From `/Users/hufei/RustroverProjects/onetcli-extensions`, after packaging:

```bash
rtk mkdir -p ~/.config/one-hub/extensions/composite/termius-importer
rtk tar xzf artifacts/termius-importer-0.1.0/termius-importer-composite-universal.tar.gz -C ~/.config/one-hub/extensions/composite/termius-importer
```

Expected: installed folder contains `extension.json` and `wasm/termius_importer_wasm.wasm`.

- [ ] **Step 4: Verify no real Termius data leaked**

From `/Users/hufei/RustroverProjects/onetcli-extensions`, run:

```bash
rtk rg -n "BEGIN OPENSSH PRIVATE KEY|localKey|password|prod\\.example|Termius/Session|session-log" extensions/wasm/termius-importer docs/superpowers tests
```

Expected: no real private key, password, or session-log content. Synthetic words in tests are acceptable only when they are clearly fixture values.

- [ ] **Step 5: Final status summary**

Report:

- extension commit list for Termius importer
- host commit list from `connection-import-center`
- verification commands and pass/fail status
- any remaining warnings, especially unsupported Telnet/known_hosts and ordinary snippets skipped from Quick Commands

Do not mark the active goal complete until all success criteria in `docs/superpowers/specs/2026-07-04-termius-import-design.md` are proven by current files and command output.
