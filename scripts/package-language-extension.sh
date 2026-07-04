#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 4 ]; then
  echo "Usage: $0 <language-id> <target-triple> <artifact-dir> <version>" >&2
  exit 2
fi

LANGUAGE_ID="$1"
TARGET="$2"
ARTIFACT_DIR="$3"
VERSION="$4"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [ "$TARGET" != "universal" ]; then
  echo "Tree-sitter language extensions must use the universal target, got: ${TARGET}" >&2
  exit 1
fi

SOURCE_DIR="${REPO_DIR}/extensions/language/${LANGUAGE_ID}"
BUILD_METADATA="${SOURCE_DIR}/extension.build.json"
if [ ! -f "$BUILD_METADATA" ]; then
  echo "Missing language extension build metadata: ${BUILD_METADATA}" >&2
  exit 1
fi

PACKAGE_ROOT="${REPO_DIR}/target/extension-packages/${TARGET}"
EXTENSION_DIR="${PACKAGE_ROOT}/${LANGUAGE_ID}"
ARCHIVE_NAME="${LANGUAGE_ID}-language-${TARGET}.tar.gz"

if [ ! -f "${SOURCE_DIR}/manifest.json" ]; then
  echo "Missing language manifest: ${SOURCE_DIR}/manifest.json" >&2
  exit 1
fi

if [ ! -f "${SOURCE_DIR}/parser.wasm" ]; then
  echo "Missing Tree-sitter parser wasm: ${SOURCE_DIR}/parser.wasm" >&2
  exit 1
fi

rm -rf "$EXTENSION_DIR"
mkdir -p "$EXTENSION_DIR" "$ARTIFACT_DIR"

MANIFEST_SOURCE="${SOURCE_DIR}/manifest.json"
MANIFEST_TARGET="${EXTENSION_DIR}/manifest.json"
MANIFEST_SOURCE="$MANIFEST_SOURCE" \
MANIFEST_TARGET="$MANIFEST_TARGET" \
VERSION="$VERSION" \
node <<'NODE'
const fs = require("fs");
const source = process.env.MANIFEST_SOURCE;
const target = process.env.MANIFEST_TARGET;
const version = process.env.VERSION;
const manifest = JSON.parse(fs.readFileSync(source, "utf8"));
manifest.version = version;
fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

cp "${SOURCE_DIR}/parser.wasm" "${EXTENSION_DIR}/parser.wasm"

for QUERY in highlights.scm injections.scm locals.scm; do
  if [ -f "${SOURCE_DIR}/${QUERY}" ]; then
    cp "${SOURCE_DIR}/${QUERY}" "${EXTENSION_DIR}/${QUERY}"
  fi
done

tar czf "${ARTIFACT_DIR}/${ARCHIVE_NAME}" -C "$EXTENSION_DIR" .
echo "${ARTIFACT_DIR}/${ARCHIVE_NAME}"
