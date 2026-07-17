#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 4 ]; then
  echo "Usage: $0 <helper-id> <target-triple> <artifact-dir> <version>" >&2
  exit 2
fi

HELPER_ID="$1"
TARGET="$2"
ARTIFACT_DIR="$3"
VERSION="$4"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

SOURCE_DIR="${REPO_DIR}/extensions/mcp-helper/${HELPER_ID}"
BUILD_METADATA="${SOURCE_DIR}/extension.build.json"
if [ ! -f "$BUILD_METADATA" ]; then
  echo "Missing MCP helper build metadata: ${BUILD_METADATA}" >&2
  exit 1
fi

LANGUAGE="$(node -e 'const fs = require("fs"); const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(data.language || "rust");' "$BUILD_METADATA")"
if [ "$LANGUAGE" = "node" ]; then
  if [ "$TARGET" != "universal" ]; then
    echo "Node MCP helpers only support the universal target" >&2
    exit 1
  fi
  PACKAGE_ROOT="${REPO_DIR}/target/extension-packages/${TARGET}"
  HELPER_DIR="${PACKAGE_ROOT}/${HELPER_ID}"
  ARCHIVE_NAME="${HELPER_ID}-mcp-helper-${TARGET}.tar.gz"
  rm -rf "$HELPER_DIR"
  mkdir -p "$HELPER_DIR" "$ARTIFACT_DIR"
  cp "${SOURCE_DIR}/mcp_helper.json" "${HELPER_DIR}/mcp_helper.json"
  cp "${SOURCE_DIR}/README.md" "${HELPER_DIR}/README.md"
  cp -R "${SOURCE_DIR}/skills" "${HELPER_DIR}/skills"
  SOURCE_DIR="$SOURCE_DIR" HELPER_DIR="$HELPER_DIR" VERSION="$VERSION" node <<'NODE'
const fs = require("fs");
const path = require("path");
const manifestPath = path.join(process.env.HELPER_DIR, "mcp_helper.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
manifest.version = process.env.VERSION;
manifest.distribution.version = process.env.VERSION;
manifest.entry.command = "npx";
manifest.entry.args = ["-y", `${manifest.distribution.package}@${process.env.VERSION}`, "mcp"];
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
NODE
  npm pack "$SOURCE_DIR" --pack-destination "$HELPER_DIR" >/dev/null
  tar czf "${ARTIFACT_DIR}/${ARCHIVE_NAME}" -C "$HELPER_DIR" .
  echo "${ARTIFACT_DIR}/${ARCHIVE_NAME}"
  exit 0
fi

BIN_STEM="$(node -e 'const fs = require("fs"); const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(data.binary || data.id);' "$BUILD_METADATA")"
MANIFEST_PATH="$(node -e 'const fs = require("fs"); const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(data.manifest_path || "");' "$BUILD_METADATA")"
BIN_NAME="$BIN_STEM"
if [[ "$TARGET" == *windows* ]]; then
  BIN_NAME="${BIN_STEM}.exe"
fi

PACKAGE_ROOT="${REPO_DIR}/target/extension-packages/${TARGET}"
HELPER_DIR="${PACKAGE_ROOT}/${HELPER_ID}"
ARCHIVE_NAME="${HELPER_ID}-mcp-helper-${TARGET}.tar.gz"

SOURCE_BIN=""
SOURCE_CANDIDATES=()
if [ -n "${CARGO_TARGET_DIR:-}" ]; then
  SOURCE_CANDIDATES+=("${CARGO_TARGET_DIR}/${TARGET}/release/${BIN_NAME}")
fi
SOURCE_CANDIDATES+=("${REPO_DIR}/target/${TARGET}/release/${BIN_NAME}")
if [ -n "$MANIFEST_PATH" ]; then
  MANIFEST_DIR="${REPO_DIR}/$(dirname "$MANIFEST_PATH")"
  if [ -d "$MANIFEST_DIR" ]; then
    SOURCE_CANDIDATES+=("${MANIFEST_DIR}/target/${TARGET}/release/${BIN_NAME}")
  fi
fi
for CANDIDATE in "${SOURCE_CANDIDATES[@]}"; do
  if [ -f "$CANDIDATE" ]; then
    SOURCE_BIN="$CANDIDATE"
    break
  fi
done

if [ ! -f "$SOURCE_BIN" ]; then
  echo "Missing MCP helper binary. Checked:" >&2
  printf '  %s\n' "${SOURCE_CANDIDATES[@]}" >&2
  if [ -n "$MANIFEST_PATH" ]; then
    echo "Run: cargo build --release --manifest-path ${MANIFEST_PATH} --target ${TARGET}" >&2
  else
    echo "Run: cargo build --release -p ${BIN_STEM} --target ${TARGET}" >&2
  fi
  exit 1
fi

rm -rf "$HELPER_DIR"
mkdir -p "$HELPER_DIR" "$ARTIFACT_DIR"
cp "$SOURCE_BIN" "${HELPER_DIR}/${BIN_NAME}"

MANIFEST_SOURCE="${SOURCE_DIR}/mcp_helper.json"
MANIFEST_TARGET="${HELPER_DIR}/mcp_helper.json"
MANIFEST_SOURCE="$MANIFEST_SOURCE" \
MANIFEST_TARGET="$MANIFEST_TARGET" \
VERSION="$VERSION" \
BIN_NAME="$BIN_NAME" \
node <<'NODE'
const fs = require("fs");
const source = process.env.MANIFEST_SOURCE;
const target = process.env.MANIFEST_TARGET;
const version = process.env.VERSION;
const binName = process.env.BIN_NAME;
const manifest = JSON.parse(fs.readFileSync(source, "utf8"));
manifest.version = version;
manifest.entry = manifest.entry || {};
manifest.entry.command = `./${binName}`;
fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

if [[ "$TARGET" != *windows* ]]; then
  chmod +x "${HELPER_DIR}/${BIN_NAME}"
fi

tar czf "${ARTIFACT_DIR}/${ARCHIVE_NAME}" -C "$HELPER_DIR" .
echo "${ARTIFACT_DIR}/${ARCHIVE_NAME}"
