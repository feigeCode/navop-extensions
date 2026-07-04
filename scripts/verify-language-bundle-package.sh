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

node - "$TMP_DIR" "$BUNDLE_MANIFEST" <<'NODE'
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
