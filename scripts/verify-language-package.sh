#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <language-package.tar.gz>" >&2
  exit 2
fi

PACKAGE="$1"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

tar xzf "$PACKAGE" -C "$TMP_DIR"

MANIFEST="${TMP_DIR}/manifest.json"
if [ ! -f "$MANIFEST" ]; then
  echo "Missing root-level manifest.json" >&2
  exit 1
fi

if [ ! -f "${TMP_DIR}/parser.wasm" ]; then
  echo "Missing root-level parser.wasm" >&2
  exit 1
fi

node <<'NODE' "$MANIFEST"
const fs = require("fs");

const manifestPath = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

for (const key of ["name", "version"]) {
  if (!manifest[key]) {
    console.error(`manifest.json missing ${key}`);
    process.exit(1);
  }
}

if (!Array.isArray(manifest.file_extensions)) {
  console.error("manifest.json file_extensions must be an array");
  process.exit(1);
}

if (manifest.sha256_wasm !== undefined) {
  const value = String(manifest.sha256_wasm).replace(/^sha256:/, "");
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    console.error("manifest.json sha256_wasm must be a 64 character hex digest");
    process.exit(1);
  }
}
NODE

echo "Verified ${PACKAGE}"
