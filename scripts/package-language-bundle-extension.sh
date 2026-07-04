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
