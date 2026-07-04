# Tree-sitter Language Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the generated Tree-sitter languages as one marketplace bundle while keeping standalone language packages available for future languages.

**Architecture:** The extensions repo will keep per-language source directories, add a bundle metadata directory, package bundled languages into one tarball, and generate one `language_bundle` marketplace entry plus standalone `language` entries where configured. The host repo will add `language_bundle` as a marketplace/install kind, detect bundle tarballs, install each child language into the existing `extensions/languages/<name>/` layout, and keep a small installed bundle marker for marketplace state.

**Tech Stack:** Node.js ESM scripts and `node:test`; Bash packaging/verification scripts; GitHub Actions YAML; Rust extension-runtime and extension_view crates; existing gpui highlighter language extension loader.

---

## Scope Check

This feature crosses two repositories but is one release flow: the compact marketplace manifest is not usable until the host can install `language_bundle` packages. Execute the tasks in order. Do not switch the generated root `manifest.json` to the compact bundle entry until host support is implemented and tested.

## File Structure

Extensions repository, `/Users/hufei/RustroverProjects/onetcli-extensions`:

- Create `extensions/language-bundle/tree-sitter-languages/extension.build.json`: release metadata for the bundle.
- Create `extensions/language-bundle/tree-sitter-languages/manifest.json`: bundle id, name, version, and included language ids.
- Create `scripts/package-language-bundle-extension.sh`: builds one tarball containing a bundle manifest and many language directories.
- Create `scripts/verify-language-bundle-package.sh`: validates bundle package shape.
- Modify `scripts/sync-tree-sitter-language-extensions.mjs`: adds bundle policy and generates compact root manifest entries.
- Modify `scripts/generate-marketplace-manifest.mjs`: discovers `language_bundle` metadata and emits bundle artifact names.
- Modify `scripts/release-driver.mjs`: validates, packages, verifies, and names language bundle artifacts.
- Modify `scripts/changed-extensions.mjs`: includes `extensions/language-bundle` in extension discovery.
- Modify `.github/workflows/release.yml`: includes bundle metadata root and packages/verifies `language_bundle`.
- Modify `.github/workflows/upload-r2.yml`: includes bundle metadata root and expected artifact names.
- Modify `tests/scripts.test.mjs`: adds bundle package, manifest generation, repository manifest, and release metadata coverage.
- Modify `manifest.json`: replaces bundled per-language marketplace entries with one `tree-sitter-languages` entry after sync changes are in place.

Host repository, `/Users/hufei/RustroverProjects/onetcli`:

- Modify `crates/extension-runtime/src/extension/kind.rs`: adds `LanguageBundle`.
- Modify `crates/extension-runtime/src/extension/mod.rs`: registers `LanguageBundleExtensionProvider` in the built-in registry.
- Create `crates/extension-runtime/src/extension/language_bundle_provider.rs`: lists bundle marker manifests and uninstalls installed bundle markers plus tracked languages.
- Modify `crates/extension-runtime/src/extension_package_layout.rs`: detects bundle package roots.
- Modify `crates/extension-runtime/src/extension_downloader.rs`: installs bundle child languages atomically and writes bundle marker metadata.
- Modify `crates/extension-runtime/src/extension_downloader/marketplace.rs`: parses `language_bundle` marketplace entries.
- Modify `crates/extension-runtime/src/extension_view_host.rs`: maps bundle kind between host and view.
- Modify `crates/extension_view/src/model.rs`: adds `ExtensionKind::LanguageBundle`.
- Modify host tests in `crates/extension-runtime/src/extension/provider_tests.rs`, `crates/extension-runtime/src/extension_downloader_tests.rs`, and `crates/extension-runtime/src/extension_view_host.rs` tests.

Implementation refinement from planning: bundle artifacts should include a root-level `manifest.json` for bundle metadata and direct child language directories. A single-language package is still identified by root `manifest.json + parser.wasm`; a bundle has root `manifest.json` without root `parser.wasm`, plus at least two valid child language directories.

## Task 1: Extensions Bundle Package Tests

**Files:**
- Modify: `tests/scripts.test.mjs`
- Create later: `scripts/package-language-bundle-extension.sh`
- Create later: `scripts/verify-language-bundle-package.sh`

- [ ] **Step 1: Write failing package and verification tests**

Add these tests immediately after `package-language-extension creates a Tree-sitter language package` in `tests/scripts.test.mjs`:

```js
test("package-language-bundle-extension creates a Tree-sitter language bundle package", () => {
  const workdir = makeTempDir();
  createLanguageBundleFixture(workdir, {
    id: "tree-sitter-languages",
    version: "0.1.0",
    languages: [
      { id: "rust", version: "0.24.0", fileExtensions: ["rs"] },
      { id: "javascript", version: "0.23.1", fileExtensions: ["js", "mjs"] },
    ],
  });

  const archivePath = execFileSync(
    "bash",
    [
      path.join(workdir, "scripts/package-language-bundle-extension.sh"),
      "tree-sitter-languages",
      "universal",
      path.join(workdir, "artifacts"),
      "0.1.0",
    ],
    { cwd: workdir, encoding: "utf8" },
  ).trim();

  assert.equal(
    path.basename(archivePath),
    "tree-sitter-languages-language-bundle-universal.tar.gz",
  );
  execFileSync("tar", ["xzf", archivePath, "-C", path.join(workdir, "unpacked")]);

  const bundleManifest = JSON.parse(
    fs.readFileSync(path.join(workdir, "unpacked/manifest.json"), "utf8"),
  );
  assert.equal(bundleManifest.id, "tree-sitter-languages");
  assert.equal(bundleManifest.version, "0.1.0");
  assert.deepEqual(bundleManifest.languages, ["javascript", "rust"]);

  const rustManifest = JSON.parse(
    fs.readFileSync(path.join(workdir, "unpacked/rust/manifest.json"), "utf8"),
  );
  assert.equal(rustManifest.name, "rust");
  assert.equal(rustManifest.version, "0.24.0");
  assert.deepEqual(rustManifest.file_extensions, ["rs"]);
  assert.equal(
    fs.readFileSync(path.join(workdir, "unpacked/rust/parser.wasm"), "utf8"),
    "fake rust parser wasm\n",
  );
  assert.equal(
    fs.readFileSync(path.join(workdir, "unpacked/javascript/parser.wasm"), "utf8"),
    "fake javascript parser wasm\n",
  );

  const output = execFileSync(
    "bash",
    [path.join(workdir, "scripts/verify-language-bundle-package.sh"), archivePath],
    { cwd: workdir, encoding: "utf8" },
  );
  assert.match(output, /Verified language bundle/);
});

test("verify-language-bundle-package rejects empty bundles", () => {
  const workdir = makeTempDir();
  copyScript("verify-language-bundle-package.sh", workdir);
  const archivePath = path.join(workdir, "empty-language-bundle.tar.gz");
  writeJson(path.join(workdir, "bundle-root/manifest.json"), {
    id: "tree-sitter-languages",
    name: "Tree-sitter Languages",
    version: "0.1.0",
    languages: [],
  });
  execFileSync("tar", ["czf", archivePath, "-C", path.join(workdir, "bundle-root"), "."]);

  assert.throws(
    () => execFileSync(
      "bash",
      [path.join(workdir, "scripts/verify-language-bundle-package.sh"), archivePath],
      { cwd: workdir, encoding: "utf8", stdio: "pipe" },
    ),
    /language bundle must contain at least one language/,
  );
});
```

Add this helper near `createLanguageExtensionFixture`:

```js
function createLanguageBundleFixture(workdir, options = {}) {
  const id = options.id || "tree-sitter-languages";
  const version = options.version || "0.1.0";
  const languages = options.languages || [
    { id: "rust", version: "0.24.0", fileExtensions: ["rs"] },
    { id: "javascript", version: "0.23.1", fileExtensions: ["js"] },
  ];
  copyScript("package-language-bundle-extension.sh", workdir);
  copyScript("verify-language-bundle-package.sh", workdir);
  writeJson(path.join(workdir, `extensions/language-bundle/${id}/extension.build.json`), {
    id,
    kind: "language_bundle",
    language: "tree-sitter-wasm-bundle",
    path: `extensions/language-bundle/${id}`,
    targets: ["universal"],
    releaseTagPrefix: `${id}-v`,
    r2Prefix: `extensions/${id}`,
  });
  writeJson(path.join(workdir, `extensions/language-bundle/${id}/manifest.json`), {
    id,
    name: "Tree-sitter Languages",
    version,
    languages: languages.map((language) => language.id).sort(),
  });
  for (const language of languages) {
    writeJson(path.join(workdir, `extensions/language/${language.id}/manifest.json`), {
      name: language.id,
      version: language.version,
      file_extensions: language.fileExtensions,
    });
    fs.writeFileSync(
      path.join(workdir, `extensions/language/${language.id}/parser.wasm`),
      `fake ${language.id} parser wasm\n`,
    );
    fs.writeFileSync(
      path.join(workdir, `extensions/language/${language.id}/highlights.scm`),
      `(${language.id}_node) @variable\n`,
    );
  }
}
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
rtk node --test tests/scripts.test.mjs
```

Expected: FAIL because `copyScript("package-language-bundle-extension.sh", workdir)` cannot find the new scripts.

- [ ] **Step 3: Commit the failing tests**

```bash
rtk git add tests/scripts.test.mjs
rtk git commit -m "test: cover tree-sitter language bundle packaging"
```

## Task 2: Extensions Bundle Package Scripts

**Files:**
- Create: `scripts/package-language-bundle-extension.sh`
- Create: `scripts/verify-language-bundle-package.sh`
- Modify: `tests/scripts.test.mjs` only if the failing test needs a path correction

- [ ] **Step 1: Create `scripts/package-language-bundle-extension.sh`**

Create the file with this content:

```bash
#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 4 ]; then
  echo "Usage: $0 <bundle-id> <target-triple> <artifact-dir> <version>" >&2
  exit 2
fi

BUNDLE_ID="$1"
TARGET="$2"
ARTIFACT_DIR="$3"
VERSION="$4"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [ "$TARGET" != "universal" ]; then
  echo "Tree-sitter language bundles must use the universal target, got: ${TARGET}" >&2
  exit 1
fi

BUNDLE_DIR="${REPO_DIR}/extensions/language-bundle/${BUNDLE_ID}"
BUNDLE_MANIFEST="${BUNDLE_DIR}/manifest.json"
if [ ! -f "$BUNDLE_MANIFEST" ]; then
  echo "Missing language bundle manifest: ${BUNDLE_MANIFEST}" >&2
  exit 1
fi

PACKAGE_ROOT="${REPO_DIR}/target/extension-packages/${TARGET}/${BUNDLE_ID}"
ARCHIVE_NAME="${BUNDLE_ID}-language-bundle-${TARGET}.tar.gz"

rm -rf "$PACKAGE_ROOT"
mkdir -p "$PACKAGE_ROOT" "$ARTIFACT_DIR"

BUNDLE_MANIFEST="$BUNDLE_MANIFEST" \
PACKAGE_ROOT="$PACKAGE_ROOT" \
VERSION="$VERSION" \
node <<'NODE'
const fs = require("fs");
const path = require("path");

const source = process.env.BUNDLE_MANIFEST;
const target = path.join(process.env.PACKAGE_ROOT, "manifest.json");
const version = process.env.VERSION;
const manifest = JSON.parse(fs.readFileSync(source, "utf8"));
manifest.version = version;
manifest.languages = [...new Set((manifest.languages || []).map(String))].sort();
if (!manifest.id || !manifest.name || !manifest.version || manifest.languages.length === 0) {
  throw new Error("language bundle manifest requires id, name, version, and non-empty languages");
}
fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

LANGUAGES="$(
  BUNDLE_MANIFEST="$BUNDLE_MANIFEST" node <<'NODE'
const fs = require("fs");
const manifest = JSON.parse(fs.readFileSync(process.env.BUNDLE_MANIFEST, "utf8"));
for (const language of [...new Set((manifest.languages || []).map(String))].sort()) {
  console.log(language);
}
NODE
)"

while IFS= read -r LANGUAGE_ID; do
  [ -n "$LANGUAGE_ID" ] || continue
  SOURCE_DIR="${REPO_DIR}/extensions/language/${LANGUAGE_ID}"
  if [ ! -f "${SOURCE_DIR}/manifest.json" ]; then
    echo "Missing language manifest: ${SOURCE_DIR}/manifest.json" >&2
    exit 1
  fi
  if [ ! -f "${SOURCE_DIR}/parser.wasm" ]; then
    echo "Missing Tree-sitter parser wasm: ${SOURCE_DIR}/parser.wasm" >&2
    exit 1
  fi
  LANGUAGE_TARGET="${PACKAGE_ROOT}/${LANGUAGE_ID}"
  mkdir -p "$LANGUAGE_TARGET"
  cp "${SOURCE_DIR}/manifest.json" "${LANGUAGE_TARGET}/manifest.json"
  cp "${SOURCE_DIR}/parser.wasm" "${LANGUAGE_TARGET}/parser.wasm"
  for QUERY in highlights.scm injections.scm locals.scm; do
    if [ -f "${SOURCE_DIR}/${QUERY}" ]; then
      cp "${SOURCE_DIR}/${QUERY}" "${LANGUAGE_TARGET}/${QUERY}"
    fi
  done
done <<< "$LANGUAGES"

tar czf "${ARTIFACT_DIR}/${ARCHIVE_NAME}" -C "$PACKAGE_ROOT" .
echo "${ARTIFACT_DIR}/${ARCHIVE_NAME}"
```

- [ ] **Step 2: Create `scripts/verify-language-bundle-package.sh`**

Create the file with this content:

```bash
#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <language-bundle-package.tar.gz>" >&2
  exit 2
fi

PACKAGE="$1"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

tar xzf "$PACKAGE" -C "$TMP_DIR"

BUNDLE_MANIFEST="${TMP_DIR}/manifest.json"
if [ ! -f "$BUNDLE_MANIFEST" ]; then
  echo "Missing root-level bundle manifest.json" >&2
  exit 1
fi

if [ -f "${TMP_DIR}/parser.wasm" ]; then
  echo "language bundle must not contain root-level parser.wasm" >&2
  exit 1
fi

node <<'NODE' "$TMP_DIR" "$BUNDLE_MANIFEST"
const fs = require("fs");
const path = require("path");

const root = process.argv[2];
const bundleManifestPath = process.argv[3];
const bundle = JSON.parse(fs.readFileSync(bundleManifestPath, "utf8"));

for (const key of ["id", "name", "version"]) {
  if (!bundle[key] || !String(bundle[key]).trim()) {
    console.error(`bundle manifest missing ${key}`);
    process.exit(1);
  }
}
if (!Array.isArray(bundle.languages) || bundle.languages.length === 0) {
  console.error("language bundle must contain at least one language");
  process.exit(1);
}

const expected = [...new Set(bundle.languages.map(String))].sort();
const actual = fs.readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  console.error(`bundle languages mismatch: manifest=${expected.join(",")} actual=${actual.join(",")}`);
  process.exit(1);
}

for (const language of expected) {
  const dir = path.join(root, language);
  const manifestPath = path.join(dir, "manifest.json");
  const wasmPath = path.join(dir, "parser.wasm");
  if (!fs.existsSync(manifestPath)) {
    console.error(`Missing ${language}/manifest.json`);
    process.exit(1);
  }
  if (!fs.existsSync(wasmPath)) {
    console.error(`Missing ${language}/parser.wasm`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  for (const key of ["name", "version"]) {
    if (!manifest[key]) {
      console.error(`${language}/manifest.json missing ${key}`);
      process.exit(1);
    }
  }
  if (!Array.isArray(manifest.file_extensions)) {
    console.error(`${language}/manifest.json file_extensions must be an array`);
    process.exit(1);
  }
  if (manifest.sha256_wasm !== undefined) {
    const value = String(manifest.sha256_wasm).replace(/^sha256:/, "");
    if (!/^[0-9a-fA-F]{64}$/.test(value)) {
      console.error(`${language}/manifest.json sha256_wasm must be a 64 character hex digest`);
      process.exit(1);
    }
  }
}
NODE

echo "Verified language bundle ${PACKAGE}"
```

- [ ] **Step 3: Make scripts executable**

Run:

```bash
rtk chmod +x scripts/package-language-bundle-extension.sh scripts/verify-language-bundle-package.sh
```

Expected: command exits 0.

- [ ] **Step 4: Run package tests**

Run:

```bash
rtk node --test tests/scripts.test.mjs
```

Expected: PASS for the new package tests. If unrelated existing tests fail, capture the failing test names before continuing.

- [ ] **Step 5: Commit package scripts**

```bash
rtk git add scripts/package-language-bundle-extension.sh scripts/verify-language-bundle-package.sh tests/scripts.test.mjs
rtk git commit -m "feat: package tree-sitter language bundle"
```

## Task 3: Extensions Metadata and Marketplace Script Support

**Files:**
- Create: `extensions/language-bundle/tree-sitter-languages/extension.build.json`
- Create: `extensions/language-bundle/tree-sitter-languages/manifest.json`
- Modify: `scripts/generate-marketplace-manifest.mjs`
- Modify: `scripts/release-driver.mjs`
- Modify: `scripts/changed-extensions.mjs`
- Modify: `tests/scripts.test.mjs`

- [ ] **Step 1: Write failing marketplace and repository tests**

In `tests/scripts.test.mjs`, update `extensionBuildEntries()` roots to include `extensions/language-bundle`:

```js
const roots = ["extensions/ipc", "extensions/remote-desktop", "extensions/mcp-helper", "extensions/acp-agent", "extensions/wasm", "extensions/language", "extensions/language-bundle"];
```

Update `manifestFileForKind(kind)` with:

```js
if (kind === "language_bundle") return "manifest.json";
```

Add this test after `generate-marketplace-manifest supports language extensions`:

```js
test("generate-marketplace-manifest supports language bundles", () => {
  const workdir = makeTempDir();
  copyScript("generate-marketplace-manifest.mjs", workdir);
  fs.mkdirSync(path.join(workdir, "artifacts"), { recursive: true });
  writeJson(path.join(workdir, "extensions/language-bundle/tree-sitter-languages/extension.build.json"), {
    id: "tree-sitter-languages",
    kind: "language_bundle",
    language: "tree-sitter-wasm-bundle",
    path: "extensions/language-bundle/tree-sitter-languages",
    targets: ["universal"],
  });
  writeJson(path.join(workdir, "extensions/language-bundle/tree-sitter-languages/manifest.json"), {
    id: "tree-sitter-languages",
    name: "Tree-sitter Languages",
    version: "0.1.0",
    languages: ["javascript", "rust"],
    file_extensions: ["js", "mjs", "rs"],
  });
  const fileName = "tree-sitter-languages-language-bundle-universal.tar.gz";
  fs.writeFileSync(
    path.join(workdir, "artifacts/sha256sums.txt"),
    `${createHash("sha256").update(fileName).digest("hex")}  ${fileName}\n`,
  );

  execFileSync("node", [path.join(workdir, "scripts/generate-marketplace-manifest.mjs")], {
    cwd: workdir,
    env: {
      ...process.env,
      ARTIFACT_DIR: "artifacts",
      EXTENSION_VERSION: "0.1.0",
      EXTENSION_ID: "tree-sitter-languages",
      RELEASE_TAG: "tree-sitter-languages-v0.1.0",
    },
  });

  const extensionManifest = JSON.parse(
    fs.readFileSync(path.join(workdir, "artifacts/extension-manifest.json"), "utf8"),
  );
  const entry = extensionManifest.extensions[0];
  assert.equal(entry.id, "tree-sitter-languages");
  assert.equal(entry.kind, "language_bundle");
  assert.deepEqual(entry.file_extensions, ["js", "mjs", "rs"]);
  assert.equal(entry.artifacts.universal.file, fileName);
});
```

- [ ] **Step 2: Run focused script tests and verify failure**

Run:

```bash
rtk node --test tests/scripts.test.mjs
```

Expected: FAIL because `generate-marketplace-manifest.mjs` cannot discover `extensions/language-bundle`.

- [ ] **Step 3: Add bundle metadata files**

Create `extensions/language-bundle/tree-sitter-languages/extension.build.json`:

```json
{
  "id": "tree-sitter-languages",
  "kind": "language_bundle",
  "language": "tree-sitter-wasm-bundle",
  "path": "extensions/language-bundle/tree-sitter-languages",
  "targets": [
    "universal"
  ],
  "releaseTagPrefix": "tree-sitter-languages-v",
  "r2Prefix": "extensions/tree-sitter-languages"
}
```

Create `extensions/language-bundle/tree-sitter-languages/manifest.json` with the current bundled languages:

```json
{
  "id": "tree-sitter-languages",
  "name": "Tree-sitter Languages",
  "version": "0.1.0",
  "languages": [
    "astro",
    "c",
    "cmake",
    "cpp",
    "csharp",
    "css",
    "diff",
    "ejs",
    "elixir",
    "erb",
    "go",
    "graphql",
    "html",
    "java",
    "javascript",
    "jsdoc",
    "kotlin",
    "lua",
    "make",
    "markdown",
    "markdown_inline",
    "php",
    "proto",
    "python",
    "ruby",
    "rust",
    "scala",
    "svelte",
    "swift",
    "toml",
    "tsx",
    "typescript",
    "yaml",
    "zig"
  ],
  "file_extensions": [
    "astro",
    "c",
    "cc",
    "cmake",
    "cpp",
    "cs",
    "css",
    "cxx",
    "diff",
    "ejs",
    "erb",
    "ex",
    "exs",
    "go",
    "gql",
    "graphql",
    "h",
    "hpp",
    "htm",
    "html",
    "hxx",
    "java",
    "js",
    "jsdoc",
    "kt",
    "ktm",
    "kts",
    "lua",
    "makefile",
    "mak",
    "markdown",
    "md",
    "mdx",
    "mjs",
    "mk",
    "patch",
    "php",
    "php3",
    "php4",
    "php5",
    "proto",
    "py",
    "pyw",
    "phtml",
    "rb",
    "rs",
    "scala",
    "sc",
    "scss",
    "svelte",
    "swift",
    "toml",
    "ts",
    "tsx",
    "yaml",
    "yml",
    "zig"
  ]
}
```

- [ ] **Step 4: Update metadata roots and kind handling**

Modify each hardcoded metadata root list in `scripts/generate-marketplace-manifest.mjs`, `scripts/release-driver.mjs`, and `scripts/changed-extensions.mjs` to include `extensions/language-bundle`.

In `scripts/generate-marketplace-manifest.mjs`:

- `manifestFileName("language_bundle")` must return `"manifest.json"`.
- `artifactFileName(metadata, target)` must return `${metadata.id}-language-bundle-${target}.tar.gz` for `language_bundle`.
- `extensionEntry.file_extensions` must be set for both `language` and `language_bundle`.

Use this condition:

```js
if (metadata.kind === "language" || metadata.kind === "language_bundle") {
  extensionEntry.file_extensions = sourceManifest.file_extensions || [];
}
```

In `scripts/release-driver.mjs`:

- `buildDriver()` should accept `language === "tree-sitter-wasm-bundle"` with target `universal` and validate every bundle language has `parser.wasm`.
- `packageDriver()` should call `package-language-bundle-extension.sh` for `metadata.kind === "language_bundle"`.
- `verifyScriptName("language_bundle")` should return `verify-language-bundle-package.sh`.
- `packagePath()` should return `${metadata.id}-language-bundle-${target}.tar.gz`.

- [ ] **Step 5: Run script tests**

Run:

```bash
rtk node --test tests/scripts.test.mjs
```

Expected: PASS for marketplace generation and package tests.

- [ ] **Step 6: Commit metadata and script support**

```bash
rtk git add extensions/language-bundle scripts/generate-marketplace-manifest.mjs scripts/release-driver.mjs scripts/changed-extensions.mjs tests/scripts.test.mjs
rtk git commit -m "feat: add language bundle release metadata"
```

## Task 4: Extensions Root Manifest Generation and Workflows

**Files:**
- Modify: `scripts/sync-tree-sitter-language-extensions.mjs`
- Modify: `manifest.json`
- Modify: `.github/workflows/release.yml`
- Modify: `.github/workflows/upload-r2.yml`
- Modify: `tests/scripts.test.mjs`

- [ ] **Step 1: Update repository manifest tests**

Replace the final per-language entry assertions in `Tree-sitter language extensions cover every non-built-in host language` with bundle-aware assertions:

```js
  const bundleEntry = globalEntries.get("tree-sitter-languages");
  assert.equal(bundleEntry?.kind, "language_bundle");
  assert.equal(bundleEntry?.manifest, "tree-sitter-languages/manifest.json");

  const bundledFileExtensions = new Set();
  for (const id of expectedLanguageIds) {
    const metadata = JSON.parse(
      fs.readFileSync(path.join(languageRoot, id, "extension.build.json"), "utf8"),
    );
    assert.equal(metadata.id, id);
    assert.equal(metadata.kind, "language");
    assert.equal(metadata.language, "tree-sitter-wasm");
    assert.equal(metadata.path, `extensions/language/${id}`);
    assert.deepEqual(metadata.targets, ["universal"]);
    assert.equal(metadata.releaseTagPrefix, `${id}-v`);
    assert.equal(metadata.r2Prefix, `extensions/${id}`);

    const sourceManifest = JSON.parse(
      fs.readFileSync(path.join(languageRoot, id, "manifest.json"), "utf8"),
    );
    assert.equal(sourceManifest.name, id);
    assert.equal(typeof sourceManifest.version, "string");
    assert.ok(sourceManifest.version.length > 0, `${id} manifest version should not be empty`);
    assert.ok(Array.isArray(sourceManifest.file_extensions), `${id} file_extensions should be an array`);
    for (const extension of sourceManifest.file_extensions) {
      bundledFileExtensions.add(extension);
    }
    assert.ok(
      fs.existsSync(path.join(languageRoot, id, "parser.wasm")),
      `${id} should include parser.wasm`,
    );

    assert.equal(globalEntries.has(id), false, `${id} should be represented by the bundle entry`);
  }
  assert.deepEqual(
    bundleEntry?.file_extensions,
    [...bundledFileExtensions].sort(),
  );
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
rtk node --test tests/scripts.test.mjs
```

Expected: FAIL because the root manifest still contains per-language entries.

- [ ] **Step 3: Update `sync-tree-sitter-language-extensions.mjs` bundle policy**

Add bundle metadata near the `languages` array:

```js
const defaultBundle = {
  id: "tree-sitter-languages",
  name: "Tree-sitter Languages",
  version: "0.1.0",
  description: "Tree-sitter syntax highlighter language bundle",
};
```

Update `lang()` to carry a bundle policy:

```js
function lang(id, crateName, fileExtensions, options = {}) {
  return {
    id,
    crateName,
    fileExtensions,
    subdir: options.subdir || "",
    functionFrom: options.functionFrom || "",
    bundle: options.bundle === false ? false : "default",
  };
}
```

Add this helper:

```js
function bundledLanguages() {
  return languages.filter((entry) => entry.bundle !== false);
}
```

Update `syncRootManifest()` so it removes generated language entries and the default bundle id, then adds one bundle entry and any standalone language entries:

```js
function syncRootManifest() {
  const manifestPath = path.join(repoRoot, "manifest.json");
  const manifest = readJsonIfExists(manifestPath);
  if (!manifest || !Array.isArray(manifest.extensions)) {
    throw new Error(`Invalid root manifest: ${manifestPath}`);
  }

  const generatedIds = new Set(languages.map((entry) => entry.id));
  generatedIds.add(defaultBundle.id);
  const nonGeneratedEntries = manifest.extensions.filter((entry) => !generatedIds.has(entry.id));

  const bundleEntries = [buildBundleRootEntry()];
  const standaloneEntries = languages
    .filter((entry) => entry.bundle === false)
    .map(languageRootEntry);

  manifest.extensions = [...nonGeneratedEntries, ...bundleEntries, ...standaloneEntries];
  writeJson(manifestPath, manifest);
}
```

Add these helpers:

```js
function buildBundleRootEntry() {
  const bundleManifest = readJsonIfExists(
    path.join(repoRoot, "extensions/language-bundle", defaultBundle.id, "manifest.json"),
  );
  if (!bundleManifest) {
    throw new Error(`Missing generated language bundle manifest for ${defaultBundle.id}`);
  }
  return {
    id: defaultBundle.id,
    kind: "language_bundle",
    name: bundleManifest.name || defaultBundle.name,
    version: bundleManifest.version || defaultBundle.version,
    release_tag: `${defaultBundle.id}-v${bundleManifest.version || defaultBundle.version}`,
    description: defaultBundle.description,
    file_extensions: bundleFileExtensions(),
    manifest: `${defaultBundle.id}/manifest.json`,
  };
}

function languageRootEntry(entry) {
  const sourceManifest = readJsonIfExists(
    path.join(repoRoot, "extensions/language", entry.id, "manifest.json"),
  );
  if (!sourceManifest) {
    throw new Error(`Missing generated language manifest for ${entry.id}`);
  }
  return {
    id: entry.id,
    kind: "language",
    name: sourceManifest.name || entry.id,
    version: sourceManifest.version,
    release_tag: `${entry.id}-v${sourceManifest.version}`,
    description: `Tree-sitter ${entry.id} syntax highlighter`,
    file_extensions: sourceManifest.file_extensions || [],
    manifest: `${entry.id}/manifest.json`,
  };
}

function bundleFileExtensions() {
  const values = new Set();
  for (const entry of bundledLanguages()) {
    const sourceManifest = readJsonIfExists(
      path.join(repoRoot, "extensions/language", entry.id, "manifest.json"),
    );
    if (!sourceManifest) {
      throw new Error(`Missing generated language manifest for ${entry.id}`);
    }
    for (const extension of sourceManifest.file_extensions || []) {
      values.add(extension);
    }
  }
  return [...values].sort();
}
```

- [ ] **Step 4: Regenerate root manifest**

Run:

```bash
rtk node scripts/sync-tree-sitter-language-extensions.mjs --metadata-only
```

Expected: command exits 0 and `manifest.json` contains `tree-sitter-languages` instead of the 34 bundled language entries.

- [ ] **Step 5: Update workflows**

In `.github/workflows/release.yml` and `.github/workflows/upload-r2.yml`, update root arrays to include `extensions/language-bundle`.

In `.github/workflows/release.yml`, add packaging branch:

```bash
          elif [ "${{ matrix.kind }}" = "language_bundle" ]; then
            bash scripts/package-language-bundle-extension.sh "${{ matrix.extension }}" "${{ matrix.target }}" artifacts "${{ needs.prepare.outputs.version }}"
            bash scripts/verify-language-bundle-package.sh "artifacts/${{ matrix.extension }}-language-bundle-${{ matrix.target }}.tar.gz"
```

In `.github/workflows/upload-r2.yml`, add artifact naming to both Node switch statements:

```js
              case "language_bundle":
                console.log(`${process.env.EXTENSION_ID}-language-bundle-${target}.tar.gz`);
                break;
```

In the download pattern block in `.github/workflows/upload-r2.yml`, add:

```bash
          elif [ "${{ steps.extension.outputs.kind }}" = "language_bundle" ]; then
            package_pattern="${{ steps.release.outputs.extension_id }}-language-bundle-*.tar.gz"
```

- [ ] **Step 6: Run full extension repo checks**

Run:

```bash
rtk node --test tests/scripts.test.mjs
rtk ruby -e 'require "yaml"; YAML.load_file(".github/workflows/ci.yml"); YAML.load_file(".github/workflows/release.yml"); YAML.load_file(".github/workflows/upload-r2.yml"); puts "workflow yaml ok"'
```

Expected:

```text
workflow yaml ok
```

and all Node tests pass.

- [ ] **Step 7: Commit root manifest and workflow support**

```bash
rtk git add scripts/sync-tree-sitter-language-extensions.mjs manifest.json .github/workflows/release.yml .github/workflows/upload-r2.yml tests/scripts.test.mjs
rtk git commit -m "feat: publish tree-sitter languages as bundle"
```

## Task 5: Host Kind and Marketplace Model

**Files:**
- Modify: `/Users/hufei/RustroverProjects/onetcli/crates/extension-runtime/src/extension/kind.rs`
- Modify: `/Users/hufei/RustroverProjects/onetcli/crates/extension-runtime/src/extension_downloader/marketplace.rs`
- Modify: `/Users/hufei/RustroverProjects/onetcli/crates/extension_view/src/model.rs`
- Modify: `/Users/hufei/RustroverProjects/onetcli/crates/extension-runtime/src/extension_view_host.rs`
- Modify: `/Users/hufei/RustroverProjects/onetcli/crates/extension-runtime/src/extension/provider_tests.rs`
- Modify: `/Users/hufei/RustroverProjects/onetcli/crates/extension-runtime/src/extension_downloader_tests.rs`

- [ ] **Step 1: Write failing Rust tests**

In `crates/extension-runtime/src/extension/provider_tests.rs`, add:

```rust
#[test]
fn extension_kind_maps_language_bundle_directory() {
    assert_eq!("language_bundles", ExtensionKind::LanguageBundle.dir_name());
}

#[test]
fn extension_kind_parses_language_bundle() {
    let kind: ExtensionKind = serde_json::from_str(r#""language_bundle""#).unwrap();

    assert_eq!(ExtensionKind::LanguageBundle, kind);
}
```

In `crates/extension-runtime/src/extension_downloader_tests.rs`, add:

```rust
#[test]
fn marketplace_manifest_accepts_language_bundle_artifact() {
    let manifest: MarketplaceManifest = serde_json::from_str(
        r#"{
            "schema_version": 2,
            "release_version": "2026.07",
            "extensions": [{
                "id": "tree-sitter-languages",
                "kind": "language_bundle",
                "name": "Tree-sitter Languages",
                "version": "0.1.0",
                "release_tag": "tree-sitter-languages-v0.1.0",
                "description": "Tree-sitter syntax bundle",
                "file_extensions": ["js", "rs"],
                "artifacts": {
                    "universal": {
                        "file": "tree-sitter-languages-language-bundle-universal.tar.gz",
                        "sha256": "abc"
                    }
                }
            }]
        }"#,
    )
    .unwrap();

    let entries = manifest.into_entries();

    assert_eq!(1, entries.len());
    assert_eq!("tree-sitter-languages", entries[0].id);
    assert_eq!(ExtensionKind::LanguageBundle, entries[0].kind);
    assert_eq!(vec!["js".to_string(), "rs".to_string()], entries[0].file_extensions);
}
```

- [ ] **Step 2: Run tests and verify failure**

Run from `/Users/hufei/RustroverProjects/onetcli`:

```bash
rtk cargo test -p extension-runtime extension_kind_parses_language_bundle marketplace_manifest_accepts_language_bundle_artifact
```

Expected: FAIL because `LanguageBundle` does not exist.

- [ ] **Step 3: Implement kind support**

In `crates/extension-runtime/src/extension/kind.rs`, add `LanguageBundle` after `Language`, update `dir_name()`, and include it in `all()`:

```rust
pub enum ExtensionKind {
    Language,
    LanguageBundle,
    DatabaseDriver,
    RemoteDesktopProvider,
    McpHelper,
    AcpAgent,
    Composite,
}
```

```rust
Self::LanguageBundle => "language_bundles",
```

In `crates/extension_view/src/model.rs`, add:

```rust
LanguageBundle,
```

In `crates/extension-runtime/src/extension_view_host.rs`, update `to_view_kind()` and `to_host_kind()`:

```rust
host_extension::ExtensionKind::LanguageBundle => extension_view::ExtensionKind::LanguageBundle,
```

```rust
extension_view::ExtensionKind::LanguageBundle => host_extension::ExtensionKind::LanguageBundle,
```

- [ ] **Step 4: Run kind and marketplace tests**

Run:

```bash
rtk cargo test -p extension-runtime extension_kind_parses_language_bundle marketplace_manifest_accepts_language_bundle_artifact
```

Expected: PASS.

- [ ] **Step 5: Commit host kind support**

```bash
rtk git add crates/extension-runtime/src/extension/kind.rs crates/extension-runtime/src/extension_downloader/marketplace.rs crates/extension-runtime/src/extension_view_host.rs crates/extension-runtime/src/extension/provider_tests.rs crates/extension-runtime/src/extension_downloader_tests.rs crates/extension_view/src/model.rs
rtk git commit -m "feat: add language bundle extension kind"
```

## Task 6: Host Bundle Package Detection

**Files:**
- Modify: `/Users/hufei/RustroverProjects/onetcli/crates/extension-runtime/src/extension_package_layout.rs`
- Modify: `/Users/hufei/RustroverProjects/onetcli/crates/extension-runtime/src/extension_downloader_tests.rs`

- [ ] **Step 1: Write failing detection tests**

Add to `crates/extension-runtime/src/extension_downloader_tests.rs`:

```rust
#[test]
fn detect_package_kind_identifies_language_bundle() {
    let tmp = tempfile::TempDir::new().unwrap();
    let bundle_dir = tmp.path().join("tree-sitter-languages");
    fs::create_dir_all(bundle_dir.join("rust")).unwrap();
    fs::create_dir_all(bundle_dir.join("javascript")).unwrap();
    fs::write(
        bundle_dir.join("manifest.json"),
        r#"{
            "id": "tree-sitter-languages",
            "name": "Tree-sitter Languages",
            "version": "0.1.0",
            "languages": ["javascript", "rust"]
        }"#,
    )
    .unwrap();
    fs::write(bundle_dir.join("rust/manifest.json"), r#"{"name":"rust","version":"0.24.0","file_extensions":["rs"]}"#).unwrap();
    fs::write(bundle_dir.join("rust/parser.wasm"), [0u8; 4]).unwrap();
    fs::write(bundle_dir.join("javascript/manifest.json"), r#"{"name":"javascript","version":"0.23.1","file_extensions":["js"]}"#).unwrap();
    fs::write(bundle_dir.join("javascript/parser.wasm"), [0u8; 4]).unwrap();

    assert_eq!(
        ExtensionKind::LanguageBundle,
        detect_package_kind(&bundle_dir).unwrap()
    );
}

#[test]
fn detect_package_kind_keeps_single_wrapped_language_as_language() {
    let tmp = tempfile::TempDir::new().unwrap();
    let wrapped = tmp.path().join("wrapped");
    let language = wrapped.join("rust");
    fs::create_dir_all(&language).unwrap();
    fs::write(language.join("manifest.json"), r#"{"name":"rust"}"#).unwrap();
    fs::write(language.join("parser.wasm"), [0u8; 4]).unwrap();

    assert_eq!(
        ExtensionKind::Language,
        detect_package_kind(&wrapped).unwrap()
    );
}
```

- [ ] **Step 2: Run detection tests and verify failure**

Run:

```bash
rtk cargo test -p extension-runtime detect_package_kind_identifies_language_bundle detect_package_kind_keeps_single_wrapped_language_as_language
```

Expected: the bundle test fails because package detection does not recognize `language_bundle`.

- [ ] **Step 3: Implement detection**

In `extension_package_layout.rs`, update `direct_package_kind(dir)` so it checks language bundle after single package markers:

```rust
    if is_language_bundle_root(dir) {
        return Some(ExtensionKind::LanguageBundle);
    }
```

Add helpers:

```rust
fn is_language_bundle_root(dir: &Path) -> bool {
    if dir.join("parser.wasm").exists() {
        return false;
    }
    let bundle_manifest = dir.join("manifest.json");
    if !bundle_manifest.exists() {
        return false;
    }
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    let mut language_dirs = 0usize;
    for entry in entries.flatten() {
        if ignored_archive_metadata(&entry.file_name()) {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            return false;
        };
        if !file_type.is_dir() {
            if entry.file_name() == OsStr::new("manifest.json") {
                continue;
            }
            return false;
        }
        let path = entry.path();
        if !(path.join("manifest.json").exists() && path.join("parser.wasm").exists()) {
            return false;
        }
        language_dirs += 1;
    }
    language_dirs >= 2
}
```

Update `unrecognized_package_kind()` text to mention `language bundle`.

- [ ] **Step 4: Run detection tests**

Run:

```bash
rtk cargo test -p extension-runtime detect_package_kind_identifies_language_bundle detect_package_kind_keeps_single_wrapped_language_as_language
```

Expected: PASS.

- [ ] **Step 5: Commit detection**

```bash
rtk git add crates/extension-runtime/src/extension_package_layout.rs crates/extension-runtime/src/extension_downloader_tests.rs
rtk git commit -m "feat: detect language bundle packages"
```

## Task 7: Host Bundle Install and Marker Provider

**Files:**
- Create: `/Users/hufei/RustroverProjects/onetcli/crates/extension-runtime/src/extension/language_bundle_provider.rs`
- Modify: `/Users/hufei/RustroverProjects/onetcli/crates/extension-runtime/src/extension/mod.rs`
- Modify: `/Users/hufei/RustroverProjects/onetcli/crates/extension-runtime/src/extension_downloader.rs`
- Modify: `/Users/hufei/RustroverProjects/onetcli/crates/extension-runtime/src/extension/provider_tests.rs`
- Modify: `/Users/hufei/RustroverProjects/onetcli/crates/extension-runtime/src/extension_downloader_tests.rs`

- [ ] **Step 1: Write failing install tests**

Add to `crates/extension-runtime/src/extension_downloader_tests.rs`:

```rust
#[test]
fn install_from_staging_generic_installs_language_bundle_children_and_marker() {
    let tmp = tempfile::TempDir::new().unwrap();
    let root = tmp.path().join("extensions");
    let staging = tmp.path().join("staging");
    write_language_bundle_staging(&staging);

    let mut registry = ExtensionRegistry::new(root.clone());
    registry.register_provider(Arc::new(LanguageExtensionProvider));

    let summary =
        install_from_staging_generic(&staging, &registry, Some(ExtensionKind::LanguageBundle))
            .unwrap();

    assert_eq!(ExtensionKind::LanguageBundle, summary.kind);
    assert_eq!("tree-sitter-languages", summary.name);
    assert_eq!("0.1.0", summary.version);
    assert_eq!(
        vec!["js".to_string(), "rs".to_string()],
        summary.file_extensions
    );
    assert!(root.join("languages/rust/manifest.json").exists());
    assert!(root.join("languages/javascript/manifest.json").exists());
    assert!(root.join("language_bundles/tree-sitter-languages/manifest.json").exists());
}

#[test]
fn install_from_staging_generic_rejects_malformed_language_bundle_before_copy() {
    let tmp = tempfile::TempDir::new().unwrap();
    let root = tmp.path().join("extensions");
    let staging = tmp.path().join("staging");
    fs::create_dir_all(staging.join("rust")).unwrap();
    fs::create_dir_all(staging.join("javascript")).unwrap();
    fs::write(
        staging.join("manifest.json"),
        r#"{
            "id": "tree-sitter-languages",
            "name": "Tree-sitter Languages",
            "version": "0.1.0",
            "languages": ["javascript", "rust"]
        }"#,
    )
    .unwrap();
    fs::write(staging.join("rust/manifest.json"), r#"{"name":"rust","version":"0.24.0","file_extensions":["rs"]}"#).unwrap();
    fs::write(staging.join("rust/parser.wasm"), [0u8; 4]).unwrap();
    fs::write(staging.join("javascript/manifest.json"), r#"{"name":"javascript","version":"0.23.1","file_extensions":["js"]}"#).unwrap();

    let mut registry = ExtensionRegistry::new(root.clone());
    registry.register_provider(Arc::new(LanguageExtensionProvider));

    let err =
        install_from_staging_generic(&staging, &registry, Some(ExtensionKind::LanguageBundle))
            .unwrap_err();

    assert!(err.to_string().contains("parser.wasm"));
    assert!(!root.join("languages/rust").exists());
    assert!(!root.join("language_bundles/tree-sitter-languages").exists());
}
```

Add helper near existing manifest helpers:

```rust
fn write_language_bundle_staging(staging: &std::path::Path) {
    fs::create_dir_all(staging.join("rust")).unwrap();
    fs::create_dir_all(staging.join("javascript")).unwrap();
    fs::write(
        staging.join("manifest.json"),
        r#"{
            "id": "tree-sitter-languages",
            "name": "Tree-sitter Languages",
            "version": "0.1.0",
            "languages": ["javascript", "rust"]
        }"#,
    )
    .unwrap();
    fs::write(
        staging.join("rust/manifest.json"),
        r#"{"name":"rust","version":"0.24.0","file_extensions":["rs"]}"#,
    )
    .unwrap();
    fs::write(staging.join("rust/parser.wasm"), [0u8; 4]).unwrap();
    fs::write(
        staging.join("javascript/manifest.json"),
        r#"{"name":"javascript","version":"0.23.1","file_extensions":["js"]}"#,
    )
    .unwrap();
    fs::write(staging.join("javascript/parser.wasm"), [0u8; 4]).unwrap();
}
```

- [ ] **Step 2: Write failing provider test**

Add to `crates/extension-runtime/src/extension/provider_tests.rs`:

```rust
#[test]
fn language_bundle_provider_lists_installed_bundle_markers() {
    let tmp = tempfile::TempDir::new().unwrap();
    let root = tmp.path().join("extensions");
    let marker_dir = root.join("language_bundles").join("tree-sitter-languages");
    fs::create_dir_all(&marker_dir).unwrap();
    fs::write(
        marker_dir.join("manifest.json"),
        r#"{
            "id": "tree-sitter-languages",
            "name": "Tree-sitter Languages",
            "version": "0.1.0",
            "languages": ["javascript", "rust"],
            "file_extensions": ["js", "rs"]
        }"#,
    )
    .unwrap();

    let mut registry = ExtensionRegistry::new(root);
    registry.register_provider(Arc::new(LanguageBundleExtensionProvider));

    let list = registry
        .list_installed_of(ExtensionKind::LanguageBundle)
        .expect("language bundles should list");

    assert_eq!(1, list.len());
    assert_eq!(ExtensionKind::LanguageBundle, list[0].kind);
    assert_eq!("tree-sitter-languages", list[0].name);
    assert_eq!("0.1.0", list[0].version);
    assert_eq!(vec!["js".to_string(), "rs".to_string()], list[0].file_extensions);
}
```

Update the imports in `provider_tests.rs` to include `LanguageBundleExtensionProvider`.

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
rtk cargo test -p extension-runtime language_bundle_provider_lists_installed_bundle_markers install_from_staging_generic_installs_language_bundle_children_and_marker
```

Expected: FAIL because the provider and install path do not exist.

- [ ] **Step 4: Implement bundle provider**

Create `crates/extension-runtime/src/extension/language_bundle_provider.rs`:

```rust
use std::path::Path;

use anyhow::{Context, Result, anyhow};
use serde::{Deserialize, Serialize};

use crate::extension::{ExtensionKind, ExtensionProvider, ExtensionSummary};

#[derive(Debug, Clone, Serialize, Deserialize)]
struct LanguageBundleManifest {
    id: String,
    name: String,
    version: String,
    #[serde(default)]
    languages: Vec<String>,
    #[serde(default)]
    file_extensions: Vec<String>,
}

pub struct LanguageBundleExtensionProvider;

impl ExtensionProvider for LanguageBundleExtensionProvider {
    fn kind(&self) -> ExtensionKind {
        ExtensionKind::LanguageBundle
    }

    fn list_installed(&self, root: &Path) -> Result<Vec<ExtensionSummary>> {
        if !root.exists() {
            return Ok(Vec::new());
        }
        let mut out = Vec::new();
        for entry in std::fs::read_dir(root).with_context(|| format!("read {}", root.display()))? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }
            let manifest = read_manifest(&entry.path())?;
            out.push(summary_from_manifest(manifest, entry.path()));
        }
        out.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(out)
    }

    fn install_from_dir(&self, dir: &Path) -> Result<ExtensionSummary> {
        let manifest = read_manifest(dir)?;
        Ok(summary_from_manifest(manifest, dir.to_path_buf()))
    }

    fn uninstall(&self, dir: &Path) -> Result<String> {
        let manifest = read_manifest(dir)?;
        std::fs::remove_dir_all(dir).with_context(|| format!("remove {}", dir.display()))?;
        Ok(manifest.id)
    }
}

fn read_manifest(dir: &Path) -> Result<LanguageBundleManifest> {
    let manifest_path = dir.join("manifest.json");
    let bytes = std::fs::read(&manifest_path)
        .with_context(|| format!("read {}", manifest_path.display()))?;
    let manifest: LanguageBundleManifest = serde_json::from_slice(&bytes)
        .with_context(|| format!("parse {}", manifest_path.display()))?;
    if manifest.id.trim().is_empty() {
        return Err(anyhow!("language bundle manifest missing id"));
    }
    if manifest.name.trim().is_empty() {
        return Err(anyhow!("language bundle manifest missing name"));
    }
    Ok(manifest)
}

fn summary_from_manifest(manifest: LanguageBundleManifest, path: std::path::PathBuf) -> ExtensionSummary {
    ExtensionSummary::new(ExtensionKind::LanguageBundle, manifest.id, manifest.version, path)
        .with_description(format!("{} language bundle", manifest.name))
        .with_file_extensions(manifest.file_extensions)
}
```

Update `crates/extension-runtime/src/extension/mod.rs`:

```rust
mod language_bundle_provider;
pub use language_bundle_provider::LanguageBundleExtensionProvider;
```

Register it in `builtin_registry()`:

```rust
registry.register_provider(Arc::new(LanguageBundleExtensionProvider));
```

- [ ] **Step 5: Implement bundle install path**

In `crates/extension-runtime/src/extension_downloader.rs`, add a branch near the start of `install_from_staging_with_policy()` after security policy:

```rust
    if kind == ExtensionKind::LanguageBundle {
        return install_language_bundle_from_package_root(&package_root, registry);
    }
```

Add helper structs and functions in the same file:

```rust
#[derive(Debug, serde::Deserialize, serde::Serialize)]
struct LanguageBundleInstallManifest {
    id: String,
    name: String,
    version: String,
    #[serde(default)]
    languages: Vec<String>,
    #[serde(default)]
    file_extensions: Vec<String>,
}
```

Implement `install_language_bundle_from_package_root()` to:

1. Read root `manifest.json`.
2. Validate bundle id with `validate_install_name`.
3. Validate each listed child has `manifest.json` and `parser.wasm`.
4. Copy children into `registry.root_for(ExtensionKind::Language).join(language_name)`.
5. Write marker `registry.root_for(ExtensionKind::LanguageBundle).join(bundle_id).join("manifest.json")`.
6. Return `ExtensionSummary::new(ExtensionKind::LanguageBundle, bundle_id, version, marker_dir).with_file_extensions(file_extensions)`.

Use the existing `backup_existing_target()`, `restore_failed_install()`, `remove_install_backup()`, and `copy_dir_recursive()` helpers for each language target and the marker target. Keep a `Vec<(PathBuf, Option<PathBuf>)>` of copied targets and backups so failures can restore all touched paths.

- [ ] **Step 6: Run bundle install tests**

Run:

```bash
rtk cargo test -p extension-runtime language_bundle_provider_lists_installed_bundle_markers install_from_staging_generic_installs_language_bundle_children_and_marker install_from_staging_generic_rejects_malformed_language_bundle_before_copy
```

Expected: PASS.

- [ ] **Step 7: Commit install support**

```bash
rtk git add crates/extension-runtime/src/extension/language_bundle_provider.rs crates/extension-runtime/src/extension/mod.rs crates/extension-runtime/src/extension_downloader.rs crates/extension-runtime/src/extension/provider_tests.rs crates/extension-runtime/src/extension_downloader_tests.rs
rtk git commit -m "feat: install language bundle packages"
```

## Task 8: Host View Mapping and Full Host Verification

**Files:**
- Modify: `/Users/hufei/RustroverProjects/onetcli/crates/extension-runtime/src/extension_view_host.rs`
- Modify: `/Users/hufei/RustroverProjects/onetcli/crates/extension_view/src/model.rs`
- Modify: `/Users/hufei/RustroverProjects/onetcli/crates/extension-runtime/src/extension_view_host.rs` tests at bottom

- [ ] **Step 1: Add view round-trip test**

In the tests at the bottom of `extension_view_host.rs`, add:

```rust
#[test]
fn language_bundle_kind_round_trips_between_host_and_view() {
    let host_entry = host_downloader::MarketplaceEntry::from_resolved_urls(
        "tree-sitter-languages",
        host_extension::ExtensionKind::LanguageBundle,
        "Tree-sitter Languages",
        "0.1.0",
        "Tree-sitter syntax bundle",
        vec!["rs".to_string(), "js".to_string()],
        vec!["https://example.test/tree-sitter-languages-language-bundle-universal.tar.gz".to_string()],
        Some("abc".to_string()),
    );

    let view_entry = to_view_entry(host_entry);
    assert_eq!(extension_view::ExtensionKind::LanguageBundle, view_entry.kind);

    let round_tripped = to_host_entry(view_entry);
    assert_eq!(host_extension::ExtensionKind::LanguageBundle, round_tripped.kind);
}
```

- [ ] **Step 2: Run view test**

Run:

```bash
rtk cargo test -p extension-runtime language_bundle_kind_round_trips_between_host_and_view
```

Expected: PASS after Task 5 mapping exists.

- [ ] **Step 3: Run full host checks**

Run from `/Users/hufei/RustroverProjects/onetcli`:

```bash
rtk cargo test -p extension-runtime
rtk cargo test -p extension_view
```

Expected: both pass.

- [ ] **Step 4: Commit host view verification**

```bash
rtk git add crates/extension-runtime/src/extension_view_host.rs crates/extension_view/src/model.rs
rtk git commit -m "test: verify language bundle view mapping"
```

## Task 9: End-to-End Verification

**Files:**
- No new files expected.
- Validate both repositories.

- [ ] **Step 1: Verify extensions repository**

Run from `/Users/hufei/RustroverProjects/onetcli-extensions`:

```bash
rtk node --test tests/scripts.test.mjs
rtk bash scripts/package-language-bundle-extension.sh tree-sitter-languages universal /tmp/onetcli-language-bundle-artifacts 0.1.0
rtk bash scripts/verify-language-bundle-package.sh /tmp/onetcli-language-bundle-artifacts/tree-sitter-languages-language-bundle-universal.tar.gz
rtk ruby -e 'require "yaml"; YAML.load_file(".github/workflows/ci.yml"); YAML.load_file(".github/workflows/release.yml"); YAML.load_file(".github/workflows/upload-r2.yml"); puts "workflow yaml ok"'
```

Expected:

```text
Verified language bundle /tmp/onetcli-language-bundle-artifacts/tree-sitter-languages-language-bundle-universal.tar.gz
workflow yaml ok
```

and all Node tests pass.

- [ ] **Step 2: Verify host repository**

Run from `/Users/hufei/RustroverProjects/onetcli`:

```bash
rtk cargo test -p extension-runtime
rtk cargo test -p extension_view
```

Expected: both pass.

- [ ] **Step 3: Inspect marketplace manifest shape**

Run from `/Users/hufei/RustroverProjects/onetcli-extensions`:

```bash
rtk node -e 'const fs=require("fs"); const m=JSON.parse(fs.readFileSync("manifest.json","utf8")); const ids=m.extensions.filter(e => e.kind === "language" || e.kind === "language_bundle").map(e => `${e.kind}:${e.id}`); console.log(ids.join("\n"));'
```

Expected:

```text
language_bundle:tree-sitter-languages
```

If a future language is intentionally configured with `bundle: false`, the expected output includes one additional `language:<id>` line for that language.

- [ ] **Step 4: Final commits and status**

Run in both repositories:

```bash
rtk git status --short
```

Expected: no uncommitted changes after all task commits.

If any verification fix is needed, commit only the files changed by that fix with a message that names the failing verification, then rerun Step 1 and Step 2 before reporting completion.
