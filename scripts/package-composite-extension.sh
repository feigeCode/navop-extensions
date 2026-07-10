#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 4 ]; then
  echo "Usage: $0 <extension-id> <target-triple> <artifact-dir> <version>" >&2
  exit 2
fi

EXTENSION_ID="$1"
TARGET="$2"
ARTIFACT_DIR="$3"
VERSION="$4"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

if [ "$TARGET" != "universal" ]; then
  echo "Composite WASM extensions must use the universal target, got: ${TARGET}" >&2
  exit 1
fi

SOURCE_DIR="${REPO_DIR}/extensions/wasm/${EXTENSION_ID}"
BUILD_METADATA="${SOURCE_DIR}/extension.build.json"
if [ ! -f "$BUILD_METADATA" ]; then
  echo "Missing composite extension build metadata: ${BUILD_METADATA}" >&2
  exit 1
fi

BIN_NAME="$(node -e 'const fs = require("fs"); const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(data.binary || `${data.id}.wasm`);' "$BUILD_METADATA")"
PACKAGE_NAME="$(node -e 'const fs = require("fs"); const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(data.package || data.id);' "$BUILD_METADATA")"
MODULE_PATH="$(node -e 'const fs = require("fs"); const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); const runtime = data.runtime?.wasm?.[0]; process.stdout.write(runtime?.module || "");' "${SOURCE_DIR}/extension.json")"
PACKAGE_ROOT="${REPO_DIR}/target/extension-packages/${TARGET}"
EXTENSION_DIR="${PACKAGE_ROOT}/${EXTENSION_ID}"
ARCHIVE_NAME="${EXTENSION_ID}-composite-${TARGET}.tar.gz"

SOURCE_WASM=""
if [ -n "$MODULE_PATH" ]; then
  SOURCE_CANDIDATES=()
  if [ -n "${CARGO_TARGET_DIR:-}" ]; then
    SOURCE_CANDIDATES+=("${CARGO_TARGET_DIR}/wasm32-wasip2/release/${BIN_NAME}")
  fi
  SOURCE_CANDIDATES+=("${REPO_DIR}/target/wasm32-wasip2/release/${BIN_NAME}")
  SOURCE_CANDIDATES+=("${SOURCE_DIR}/${MODULE_PATH}")
  for CANDIDATE in "${SOURCE_CANDIDATES[@]}"; do
    if [ -f "$CANDIDATE" ]; then
      SOURCE_WASM="$CANDIDATE"
      break
    fi
  done
  if [ ! -f "$SOURCE_WASM" ]; then
    echo "Missing composite WASM module. Checked:" >&2
    printf '  %s\n' "${SOURCE_CANDIDATES[@]}" >&2
    echo "Run: cargo build --release -p ${PACKAGE_NAME} --target wasm32-wasip2" >&2
    exit 1
  fi
fi

case "$MODULE_PATH" in
  /*|*..*)
    echo "extension.json runtime.wasm.module must stay inside package: ${MODULE_PATH}" >&2
    exit 1
    ;;
esac

rm -rf "$EXTENSION_DIR"
mkdir -p "$EXTENSION_DIR" "$ARTIFACT_DIR"

MANIFEST_SOURCE="${SOURCE_DIR}/extension.json"
MANIFEST_TARGET="${EXTENSION_DIR}/extension.json"
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

if [ -n "$MODULE_PATH" ]; then
  mkdir -p "$(dirname "${EXTENSION_DIR}/${MODULE_PATH}")"
  cp "$SOURCE_WASM" "${EXTENSION_DIR}/${MODULE_PATH}"
fi

for RESOURCE_DIR in icons locales assets; do
  if [ -d "${SOURCE_DIR}/${RESOURCE_DIR}" ]; then
    cp -R "${SOURCE_DIR}/${RESOURCE_DIR}" "${EXTENSION_DIR}/${RESOURCE_DIR}"
  fi
done

tar czf "${ARTIFACT_DIR}/${ARCHIVE_NAME}" -C "$EXTENSION_DIR" .
echo "${ARTIFACT_DIR}/${ARCHIVE_NAME}"
