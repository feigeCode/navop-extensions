# Tree-sitter Language Bundle Design

## Status

Approved direction: publish the current Tree-sitter language extensions as one bundle in the marketplace manifest, while preserving support for future languages to ship as independent language packages.

The extensions repository owns marketplace metadata, language package layout, release scripts, verification scripts, and generated root manifest entries.

The host repository owns local package detection and installation behavior. Host-side changes must be made in:

`/Users/hufei/RustroverProjects/onetcli`

## Goals

1. Reduce the root `manifest.json` size and marketplace entry count by replacing the current per-language entries with one `tree-sitter-languages` bundle entry.
2. Keep the installed runtime layout compatible with the existing highlighter loader: one installed directory per language under `extensions/languages/<language-name>/`.
3. Keep existing single-language package support for future languages that should not be included in the default bundle.
4. Preserve the existing per-language source layout under `extensions/language/<id>/`.
5. Keep per-language `manifest.json`, `parser.wasm`, and optional query files unchanged inside installed language directories.
6. Avoid merging multiple Tree-sitter parsers into one wasm module.
7. Make release, verification, and tests cover both bundled and standalone language paths.

## Non-Goals

1. Do not combine multiple Tree-sitter parsers into a single `parser.wasm`.
2. Do not remove support for `kind: "language"` packages.
3. Do not redesign the highlighter registry or Tree-sitter wasm loading model.
4. Do not introduce multiple bundles in the first implementation. The model should allow that later, but this round only needs the default bundle.
5. Do not change database driver, remote desktop provider, MCP helper, ACP agent, or composite extension packaging behavior.

## Current State

The root `manifest.json` currently lists every generated language extension as a separate `kind: "language"` extension. Each language has its own source directory:

```text
extensions/language/<id>/
  extension.build.json
  manifest.json
  parser.wasm
  highlights.scm
  injections.scm
  locals.scm
```

The release path packages each language as:

```text
<id>-language-universal.tar.gz
  manifest.json
  parser.wasm
  highlights.scm
  injections.scm
  locals.scm
```

The host currently installs one language package into `extensions/languages/<name>/` and the highlighter scans direct child directories of `extensions/languages/`. That runtime model should remain the final installed shape after installing the bundle.

## Proposed Package Model

Add one generated marketplace entry for the default bundle:

```json
{
  "id": "tree-sitter-languages",
  "kind": "language_bundle",
  "name": "Tree-sitter Languages",
  "version": "0.1.0",
  "release_tag": "tree-sitter-languages-v0.1.0",
  "description": "Tree-sitter syntax highlighter language bundle",
  "file_extensions": ["astro", "c", "h", "cpp"],
  "manifest": "tree-sitter-languages/manifest.json"
}
```

The exact `file_extensions` list is the union of bundled language extensions. It is used for marketplace search and display. It does not replace per-language manifests.

The bundle artifact should be named consistently with existing artifact naming:

```text
tree-sitter-languages-language-bundle-universal.tar.gz
```

The tarball should contain language directories directly at the archive root:

```text
astro/
  manifest.json
  parser.wasm
  highlights.scm
  injections.scm
javascript/
  manifest.json
  parser.wasm
  highlights.scm
  injections.scm
  locals.scm
rust/
  manifest.json
  parser.wasm
  highlights.scm
```

This layout makes the bundle easy to verify and lets the host install each language into the existing runtime layout without a second internal metadata format.

## Standalone Language Support

Language generation should support a bundle policy per language. The policy can live in the `languages` table in `scripts/sync-tree-sitter-language-extensions.mjs`.

Initial behavior:

- `bundle: "default"` or omitted: include the language in the default `tree-sitter-languages` bundle and omit its individual root marketplace entry.
- `bundle: false`: keep the language as a standalone `kind: "language"` root marketplace entry and publish it through the existing single-language package path.

This keeps the current languages compact while allowing future experimental, very large, unstable, or separately versioned languages to ship independently.

The implementation should not require a future standalone language to use a different source layout. Standalone and bundled languages both continue to live under `extensions/language/<id>/`.

## Repository Script Changes

### Language Sync

`scripts/sync-tree-sitter-language-extensions.mjs` should continue generating per-language source files. Its root manifest sync step should change from "all languages become root entries" to:

1. Keep all non-language and non-language-bundle entries that are unrelated to generated languages.
2. Add one generated `language_bundle` entry for bundled languages.
3. Add individual `language` entries only for languages marked `bundle: false`.
4. Preserve deterministic ordering.

The generated bundle entry should derive:

- `id`: `tree-sitter-languages`
- `kind`: `language_bundle`
- `name`: `Tree-sitter Languages`
- `version`: the bundle manifest version
- `release_tag`: `tree-sitter-languages-v<version>`
- `description`: `Tree-sitter syntax highlighter language bundle`
- `file_extensions`: sorted unique union of bundled language file extensions
- `manifest`: `tree-sitter-languages/manifest.json`

### Build Metadata

Add build metadata for the bundle, likely at:

```text
extensions/language-bundle/tree-sitter-languages/extension.build.json
```

It should declare:

```json
{
  "id": "tree-sitter-languages",
  "kind": "language_bundle",
  "language": "tree-sitter-wasm-bundle",
  "path": "extensions/language-bundle/tree-sitter-languages",
  "targets": ["universal"],
  "releaseTagPrefix": "tree-sitter-languages-v",
  "r2Prefix": "extensions/tree-sitter-languages"
}
```

The bundle source manifest can list language ids and bundle metadata without duplicating all parser data:

```json
{
  "name": "Tree-sitter Languages",
  "version": "0.1.0",
  "languages": ["astro", "c", "cpp", "javascript", "rust"]
}
```

### Packaging

Add `scripts/package-language-bundle-extension.sh`.

Responsibilities:

1. Accept bundle id, target, artifact dir, and version.
2. Require target `universal`.
3. Read the bundle manifest or generated language policy to determine included language ids.
4. Validate every included language has `manifest.json` and `parser.wasm`.
5. Copy each included language into a package root as `<language-id>/...`.
6. Preserve each copied per-language manifest version. The bundle has its own version, and child language versions should continue to identify the grammar/parser version.
7. Create `tree-sitter-languages-language-bundle-universal.tar.gz`.

Existing `scripts/package-language-extension.sh` stays in place for standalone languages.

### Verification

Add `scripts/verify-language-bundle-package.sh`.

The verification should:

1. Extract the tarball to a temp directory.
2. Require at least one language directory.
3. Reject root-level `manifest.json + parser.wasm`, because that is a single-language package, not a bundle.
4. For every child directory, require `manifest.json` and `parser.wasm`.
5. Validate each child `manifest.json` has `name`, `version`, and array `file_extensions`.
6. Validate optional `sha256_wasm` as a 64-character hex digest.
7. Reject unsafe or unexpected archive entries through the existing tar extraction safeguards on the host side; the script only validates package shape after extraction.

### Release Driver

`scripts/release-driver.mjs` should recognize:

- `kind: "language_bundle"`
- `language: "tree-sitter-wasm-bundle"`
- `target: "universal"`

Build should validate that included language parser wasm files already exist. Package should call `package-language-bundle-extension.sh`. Verify should call `verify-language-bundle-package.sh`. Artifact naming should use `tree-sitter-languages-language-bundle-universal.tar.gz`.

### Marketplace Manifest Generation

`scripts/generate-marketplace-manifest.mjs` should include `language_bundle` in metadata discovery and artifact naming.

For a `language_bundle`, the generated release manifest entry should include the union `file_extensions` from the source bundle manifest or generated metadata so search remains useful.

## Host Install Changes

The host should add `ExtensionKind::LanguageBundle` serialized as `language_bundle`.

Package detection should recognize a bundle when the package root has no root-level single-package marker and contains at least two significant child directories, with every significant child directory containing `manifest.json + parser.wasm`. This avoids conflicting with the existing compatibility path for a single language package wrapped in one outer directory.

Installation behavior:

1. Stage and validate the tarball using the existing archive safety rules.
2. Detect `language_bundle`.
3. For each child language directory, read its child `manifest.json` and use `name` as the install name.
4. Install each child into `extensions/languages/<name>/`.
5. Use the same backup and restore safety semantics as single-extension install where practical.
6. Register each installed language through the existing language provider or by reusing the same `InstalledExtension::load_from_dir` path.
7. Return an installation summary for the bundle, including the number of installed languages and combined file extensions.

The final installed layout must be:

```text
extensions/languages/astro/
  manifest.json
  parser.wasm
extensions/languages/javascript/
  manifest.json
  parser.wasm
extensions/languages/rust/
  manifest.json
  parser.wasm
```

The highlighter's existing startup scan can then continue to list and lazily register language manifests from direct child directories.

## Data Flow

Generation:

1. `sync-tree-sitter-language-extensions.mjs` refreshes per-language source directories.
2. The same script writes a compact root manifest with one bundle entry plus any standalone language entries.

Release:

1. Release matrix includes `tree-sitter-languages`.
2. `release-driver.mjs` validates the bundle target and parser wasm files.
3. `package-language-bundle-extension.sh` builds one tarball containing many language directories.
4. `verify-language-bundle-package.sh` validates the tarball.
5. `generate-marketplace-manifest.mjs` writes a single release manifest entry for the bundle artifact.

Install:

1. Host downloads the bundle artifact from the marketplace entry.
2. Host stages the tarball.
3. Host detects `language_bundle`.
4. Host copies each child language into the existing language extension root.
5. Host registers or later lazily loads each language using existing highlighter code.

Standalone language install remains unchanged.

## Error Handling

Repository scripts should fail fast for:

- Bundle target other than `universal`.
- Missing bundle metadata.
- Missing included language directory.
- Missing included language `manifest.json`.
- Missing included language `parser.wasm`.
- Invalid per-language manifest JSON.
- Duplicate file extensions are allowed but should be de-duplicated in generated marketplace metadata.

Host install should fail the whole bundle install if any child language is malformed before copying begins. This avoids partially installed bundles from a bad artifact.

If copying begins and a later copy fails, the host should restore previous versions for any language directories it already replaced during that install attempt.

If one language fails to register after copying, the installer should restore the copied bundle changes and report the failing language. This matches the safer behavior of current single-extension installs.

## Testing

Extensions repository tests should cover:

1. Root manifest generation emits one `language_bundle` entry for bundled languages.
2. Root manifest generation keeps `bundle: false` languages as individual `kind: "language"` entries.
3. Bundle marketplace entry contains sorted unique `file_extensions`.
4. Single-language package tests still pass.
5. Bundle package script creates the expected tarball name and layout.
6. Bundle verification accepts valid multi-language packages.
7. Bundle verification rejects empty bundles.
8. Bundle verification rejects child directories missing `manifest.json` or `parser.wasm`.
9. Release driver chooses the language bundle package and verification scripts for `kind: "language_bundle"`.
10. Marketplace manifest generation produces the correct artifact name for `language_bundle`.

Host repository tests should cover:

1. Package detection identifies a multi-language bundle.
2. Package detection still identifies root-level `manifest.json + parser.wasm` as a single `language`.
3. Installing a bundle writes multiple directories under `extensions/languages/`.
4. Installing a bundle replaces existing language directories with backup/restore behavior.
5. A malformed child language causes no partial install.
6. Installed bundle languages appear in the existing language provider list.
7. Existing single-language install tests still pass.

## Compatibility

Existing installed single-language directories remain valid. The highlighter loader continues scanning direct child directories under `extensions/languages/`.

Existing single-language packages remain valid for future standalone language releases and for any already published language artifacts. The marketplace root manifest changes what is advertised by default, but it does not remove the host's ability to install a single-language tarball.

The new `language_bundle` kind requires host support before the compact root manifest can be consumed by released clients. If older clients must remain supported by the same root manifest, the release process needs either a compatibility manifest URL or a rollout step where host support ships before the root manifest is switched to bundle entries.
