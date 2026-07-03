#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 4 ]; then
  echo "Usage: $0 <agent-id> <target-triple> <artifact-dir> <version>" >&2
  exit 2
fi

AGENT_ID="$1"
TARGET="$2"
ARTIFACT_DIR="$3"
VERSION="$4"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

SOURCE_DIR="${REPO_DIR}/extensions/acp-agent/${AGENT_ID}"
BUILD_METADATA="${SOURCE_DIR}/extension.build.json"
if [ ! -f "$BUILD_METADATA" ]; then
  echo "Missing ACP agent build metadata: ${BUILD_METADATA}" >&2
  exit 1
fi

BIN_STEM="$(node -e 'const fs = require("fs"); const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(data.binary || data.id);' "$BUILD_METADATA")"
BIN_NAME="$BIN_STEM"
if [[ "$TARGET" == *windows* ]]; then
  BIN_NAME="${BIN_STEM}.cmd"
fi

PACKAGE_ROOT="${REPO_DIR}/target/extension-packages/${TARGET}"
AGENT_DIR="${PACKAGE_ROOT}/${AGENT_ID}"
ARCHIVE_NAME="${AGENT_ID}-acp-agent-${TARGET}.tar.gz"

MANIFEST_SOURCE="${SOURCE_DIR}/acp_agent.json"
if [ ! -f "$MANIFEST_SOURCE" ]; then
  echo "Missing ACP agent manifest: ${MANIFEST_SOURCE}" >&2
  exit 1
fi
if [ ! -f "${SOURCE_DIR}/bin/${BIN_NAME}" ]; then
  echo "Missing ACP agent launcher: ${SOURCE_DIR}/bin/${BIN_NAME}" >&2
  exit 1
fi

rm -rf "$AGENT_DIR"
mkdir -p "${AGENT_DIR}/bin" "$ARTIFACT_DIR"
cp -R "${SOURCE_DIR}/bin/." "${AGENT_DIR}/bin/"

MANIFEST_TARGET="${AGENT_DIR}/acp_agent.json"
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
for (const agent of manifest.agents || []) {
  if (agent.transport?.type === "stdio") {
    agent.transport.command = `bin/${binName}`;
    agent.transport.args = agent.transport.args || [];
    agent.transport.env = agent.transport.env || {};
  }
}
fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

if [[ "$TARGET" != *windows* ]]; then
  chmod +x "${AGENT_DIR}/bin/${BIN_STEM}"
fi

tar czf "${ARTIFACT_DIR}/${ARCHIVE_NAME}" -C "$AGENT_DIR" .
echo "${ARTIFACT_DIR}/${ARCHIVE_NAME}"
