# Termius Connection Import Design

## Status

Approved direction: complete adaptation of Termius formal data, with ordinary snippets and Quick Commands out of scope for this round.

Host-side changes must be made in the existing host worktree:

`/Users/hufei/RustroverProjects/onetcli/.worktrees/connection-import-center`

## Confirmed Termius Data Source

The importer is based on the local Termius installation, not on guessed export files.

- App: `/Applications/Termius.app`
- Bundle id: `com.termius-dmg.mac`
- Version observed locally: `9.40.1`
- Primary data directory: `~/Library/Application Support/Termius`
- Formal connection data: `~/Library/Application Support/Termius/IndexedDB/file__0.indexeddb.leveldb`
- Chromium WebSQL metadata: `~/Library/Application Support/Termius/databases/Databases.db`

`Databases.db` is not the connection data source. The real application data is stored through Dexie on Chromium IndexedDB, backed by LevelDB.

The inspected Termius application code defines stores for `hosts`, `groups`, `ssh_configs`, `telnet_configs`, `ssh_identities`, `keys`, `pf_rules`, `host_chains`, `proxies`, `snippets`, `snippets_packages`, `known_hosts`, and related entities. The relevant stores use the same Dexie index shape: `++local_id,&local_id,&id,status`.

## Encryption Model

Termius encrypts many useful fields locally. The importer must treat encrypted IndexedDB values as first-class data rather than scanning strings out of LevelDB files.

Confirmed local crypto behavior:

- The local key is stored in macOS Keychain under service `Termius`, account `localKey`.
- The local key is 32 bytes.
- Local encrypted values use a byte format equivalent to:
  - `0x04 0x01`
  - 24-byte nonce
  - XSalsa20-Poly1305 secretbox ciphertext
- The encryption overhead is 42 bytes.

The importer may decrypt non-secret fields needed for import, such as host labels, addresses, usernames, proxy hosts, and port-forwarding labels. Secret-bearing fields are gated by `include_passwords`.

Secret-bearing fields include:

- identity password
- private key material
- private key passphrase

When `include_passwords` is false, these fields must not be returned from the WASM component, written to logs, embedded in preview diagnostics, or saved by the host.

## Goals

1. Add a Termius WASM connection importer in `onetcli-extensions`.
2. Use Termius IndexedDB/LevelDB plus the Termius local crypto model as the canonical source.
3. Import SSH hosts into OnetCli SSH/SFTP connections.
4. Import Termius local, dynamic, and remote port forwarding rules.
5. Map Termius startup snippets to OnetCli SSH `init_script`.
6. Map Termius proxy settings to OnetCli SSH proxy settings where OnetCli supports the proxy type.
7. Map Termius host chains to OnetCli jump server settings where OnetCli can represent the chain.
8. Preserve security boundaries for passwords, passphrases, and private key material.
9. Keep host additions generic. The host must not contain Termius-specific path or product logic.
10. Make unsupported Termius entities visible as skipped or warning diagnostics instead of silently pretending they were imported.

## Non-Goals

1. Ordinary Termius snippets are not imported into OnetCli Quick Commands in this round.
2. Termius session logs are not read.
3. Termius `known_hosts` are not imported unless OnetCli adds a first-class known-hosts model later.
4. Telnet records are recognized but not saved as SSH records. If the host has no first-class Telnet import target, they are reported as skipped with a clear reason.
5. The importer does not depend on running the Termius Electron app at import time.

## Architecture

The implementation has two cooperating parts:

- Extension repo: one new WASM component, `extensions/wasm/termius-importer`.
- Host repo: generic connection import protocol, filesystem, secret, preview, and save support added in the existing host worktree.

The Termius importer owns product-specific parsing:

- Termius IndexedDB object-store discovery
- Chromium IndexedDB key/value decoding needed for Termius Dexie stores
- Termius encrypted field decoding
- Termius entity normalization
- Mapping Termius entities to connection import records

The host owns product-independent capabilities:

- Reading declared candidate files and child files under declared candidate directories
- Reading secrets through a generic secret query
- Previewing new import record kinds
- Saving SSH records and linked port-forwarding records in the correct order
- Persisting private key material only when import options permit secrets

## WASM Importer Layout

The new crate should follow the existing DBeaver importer shape:

- `src/component.rs`: WIT bindings and exported `descriptor`, `scan`, and `preview`
- `src/termius.rs`: high-level scan and preview orchestration
- `src/indexeddb.rs`: LevelDB and IndexedDB store access
- `src/idb_codec.rs`: minimal Chromium IndexedDB/V8 value decoding needed by the Termius stores
- `src/crypto.rs`: Termius local crypto decoding
- `src/model.rs`: Termius source models and normalized internal models
- `src/mapper.rs`: mapping normalized models into connection import records
- `src/diagnostics.rs`: warnings and skipped-record reasons

The importer should use a pure Rust LevelDB reader. The current practical candidate is `rusty-leveldb`, because it avoids linking native LevelDB into a WASI component.

The IndexedDB decoder should be deliberately narrow. It only needs the Chromium IndexedDB structures and serialized JavaScript values observed in Termius stores. It should reject unknown value forms with diagnostics instead of guessing.

## Candidate Paths

The extension manifest should declare the formal Termius data directory per platform.

macOS:

- `~/Library/Application Support/Termius/IndexedDB/file__0.indexeddb.leveldb`

Windows:

- `%APPDATA%/Termius/IndexedDB/file__0.indexeddb.leveldb`

Linux:

- `~/.config/Termius/IndexedDB/file__0.indexeddb.leveldb`

The host must support candidate directories, not only single files, because Chromium IndexedDB data is spread across variable LevelDB files such as `.ldb`, `.log`, and `MANIFEST-*`.

## Host Protocol Changes

The WIT and `connection-import-protocol` model need generic extensions.

Filesystem capability:

- Add an API that lets a component read files under a declared candidate directory by returned child identity or relative child path.
- The host must enforce that the requested child stays under the declared candidate directory.
- The component must not receive arbitrary filesystem access beyond manifest permissions.

Secret capability:

- Implement `read_secret` for macOS Keychain.
- Keep the query generic: service, account, and optional label/namespace fields.
- Termius queries service `Termius`, account `localKey`.
- Unsupported platforms return a structured unavailable result, not a panic.

Import record model:

- Add `port-forwarding` as an import record kind.
- Extend SSH records with optional source id, init script, proxy, jump server, and private-key-material fields.
- Add diagnostics to records or preview results so unsupported Termius entities and partial mappings are visible.
- Preserve a stable source reference so linked records can refer to the imported SSH host.

Save flow:

- Save selected records as a batch.
- Insert selected SSH records first.
- Build a map from source SSH id to newly inserted OnetCli connection id.
- Insert selected port-forwarding records after their SSH connection exists.
- If a selected forwarding rule refers to a skipped or unselected SSH host, skip that forwarding rule and report it.

## SSH Mapping

Termius `hosts` are the root importable entities.

Mapping:

- `host.label` -> OnetCli connection name
- `host.address` -> SSH host
- `ssh_config.port` -> SSH port, defaulting to 22 when missing
- `ssh_identity.username` -> SSH username
- `ssh_identity.password` -> password auth only when `include_passwords` is true
- `ssh_identity` using private key -> private key auth only when key material can be safely persisted
- `ssh_config.startup_snippet.script` -> OnetCli `init_script`
- Termius proxy -> OnetCli proxy when type and fields are supported
- Termius host chain -> OnetCli jump server when representable

If a host has no usable address after decryption, it is skipped. If a host has an address but incomplete credentials, it is imported with the safest available auth method and a warning.

Private key handling:

- Termius stores private key content, while OnetCli currently uses key paths.
- When `include_passwords` is false, private key content and passphrases are not returned. The SSH auth method falls back to agent or auto public key with a warning.
- When `include_passwords` is true, the import record may carry private key material to the host save layer.
- The host save layer writes imported private keys into an OnetCli-managed secrets directory with owner-only permissions and stores the resulting key path.
- Private key file names must be derived from stable ids, not labels, to avoid leaking names or creating unsafe paths.

## Proxy Mapping

Termius proxies should be mapped when their decrypted fields are complete.

Supported mappings:

- Termius HTTP proxy -> OnetCli HTTP proxy
- Termius SOCKS proxy -> OnetCli SOCKS5 proxy

Unsupported or incomplete proxy settings should not block importing the base SSH host. The importer attaches a warning to the SSH record and leaves the proxy unset.

## Host Chain Mapping

Termius host chains can contain one or more hops.

Mapping:

- A single complete hop maps to OnetCli `jump_server`.
- A multi-hop chain maps as far as OnetCli can represent.
- If OnetCli only supports one jump server, the first hop is imported and the remaining hops are reported as unsupported for that connection.

The importer must avoid inventing SSH hosts for incomplete chain hops. It should only map hops with decrypted host, port, and username data.

## Port Forwarding Mapping

Termius `pf_rules` are linked to a host. They must become linked OnetCli port-forwarding entries, not independent SSH records.

Termius field meanings used by the mapper:

- `host`: owning Termius host reference
- `label`: forwarding name
- `pf_type`: forwarding kind
- `bound_address`: bind address
- `local_port`: local-side port
- `remote_port`: remote-side port
- `hostname`: target hostname

Mappings:

- `Local Rule`: local bind `bound_address:local_port` forwards through SSH to `hostname:remote_port`.
- `Dynamic Rule`: local SOCKS bind `bound_address:local_port`. Target host and target port are ignored if present.
- `Remote Rule`: remote bind `bound_address:remote_port` forwards through SSH to `hostname:local_port`.

OnetCli currently supports local and dynamic forwarding. The complete adaptation includes adding remote forwarding to OnetCli storage and runtime rather than silently skipping Termius `Remote Rule`.

## Remote Forwarding Runtime

The host implementation should add a first-class remote forwarding kind.

Storage:

- Add `Remote` to the persisted forwarding kind enum.
- Ensure existing local and dynamic records migrate without data loss.

Runtime:

- Use the existing SSH backend's remote forwarding APIs.
- Ask the server to listen on the remote bind address and port.
- For each forwarded connection from the server, open a local TCP connection to the configured target host and port.
- Shut down the remote listener when the OnetCli forwarding session stops.

Preview and UI:

- Display remote forwarding as a distinct forwarding kind.
- Do not label remote rules as local rules.

## Telnet and Other Termius Entities

The importer should recognize the following Termius entities and account for them in diagnostics:

- `telnet_configs`: skipped unless the host import protocol gains a Telnet target
- `snippets`: ordinary snippets skipped because Quick Commands are out of scope
- `snippets_packages`: skipped with snippets
- `known_hosts`: skipped because OnetCli has no import target for this data
- `groups` and tags: used for display context when possible, otherwise reported as metadata not imported

This is still considered complete adaptation for this round because the importer understands the entities and gives deterministic outcomes. It must not silently drop them.

## Error Handling and Diagnostics

The importer should produce structured diagnostics for:

- Termius IndexedDB directory missing
- LevelDB files unreadable
- Unsupported IndexedDB serialized value form
- macOS Keychain local key missing
- Encrypted field could not be decrypted
- Missing host address
- Missing referenced identity, key, proxy, snippet, chain, or forwarding owner host
- Secret fields omitted because `include_passwords` is false
- Private key imported as agent or auto-public-key fallback
- Remote forwarding unsupported in older host builds
- Ordinary snippets skipped because Quick Commands are out of scope

Diagnostics must not include plaintext passwords, private keys, passphrases, session log content, or full raw IndexedDB payloads.

## Security Requirements

1. Do not read Termius session logs.
2. Do not print real Termius data while developing or testing.
3. Do not store real local Termius records as test fixtures.
4. Do not return password, passphrase, or private key data when `include_passwords` is false.
5. Do not write private key files outside an OnetCli-managed directory.
6. Set imported private key files to owner-only permissions where the platform supports it.
7. Keep host filesystem access restricted to declared manifest permissions.
8. Keep host secret access explicit through `read_secret`.

## Testing Strategy

Extension tests:

- Synthetic Termius entity fixtures for SSH hosts, identities, keys, proxies, chains, startup snippets, and forwarding rules
- Synthetic encrypted field tests using generated keys, not real user data
- LevelDB/IndexedDB decoder tests with generated minimal fixture databases or byte fixtures that contain no real user data
- `include_passwords=false` tests proving secret fields are omitted
- Mapper tests for local, dynamic, and remote forwarding
- Mapper tests for skipped snippets and telnet records

Host tests:

- WIT drift check between extension repo and host repo
- Candidate directory child-read permission tests
- Keychain `read_secret` behavior tested behind platform guards or with a mock secret backend
- Protocol serialization tests for SSH extensions and port-forwarding records
- Preview tests for SSH and port-forwarding records
- Batch save tests proving SSH records are inserted before linked forwarding records
- Private key persistence tests using temporary directories and permission checks
- Remote forwarding storage and runtime tests at the lowest practical layer

Packaging tests:

- Build `termius_importer_wasm` for `wasm32-wasip2`
- Verify root composite manifest includes the Termius importer
- Verify extension package contains `extension.json` and the WASM module
- Verify local composite provider can list the Termius importer

## Implementation Order

1. Update and test host protocol models in the host worktree.
2. Add generic host capabilities for candidate directory child reads and secret reads.
3. Add host preview and batch save support for linked SSH plus port-forwarding records.
4. Add remote forwarding storage and runtime support.
5. Add the Termius WASM importer crate and extension manifest.
6. Implement Termius parser, crypto, mapper, diagnostics, and tests.
7. Register the importer in the root composite manifest and release scripts.
8. Run extension and host verification commands.

## Verification Commands

Extension repo:

```bash
rtk cargo test -p termius_importer_wasm
rtk cargo fmt --all --check
rtk cargo build --release -p termius_importer_wasm --target wasm32-wasip2
rtk node --test tests/scripts.test.mjs
```

Host worktree:

```bash
rtk cargo test -p connection-import-protocol
rtk cargo test -p extension-wasm
rtk cargo test -p extension-runtime connection_import
rtk cargo test -p port_forwarding
rtk cargo check -p main
```

## Success Criteria

The work is complete when:

1. The Termius importer appears as a local composite connection importer.
2. The importer reads the formal IndexedDB/LevelDB data directory.
3. Encrypted non-secret fields decrypt through the Termius local key when available.
4. SSH hosts import into OnetCli with correct host, port, username, auth, init script, proxy, and jump-server data where representable.
5. Passwords, passphrases, and private keys obey `include_passwords`.
6. Local, dynamic, and remote Termius forwarding rules import as OnetCli forwarding records linked to the imported SSH host.
7. Ordinary snippets are skipped with diagnostics and are not imported as Quick Commands.
8. Unsupported Termius entities are reported with deterministic diagnostics.
9. Extension and host tests covering the new behavior pass.
10. No real local Termius secrets or private data are committed, logged, or copied into fixtures.
