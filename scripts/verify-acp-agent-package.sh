#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <acp-agent-package.tar.gz>" >&2
  exit 2
fi

PACKAGE="$1"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

tar xzf "$PACKAGE" -C "$TMP_DIR"

MANIFEST="${TMP_DIR}/acp_agent.json"
if [ ! -f "$MANIFEST" ]; then
  echo "Missing root-level acp_agent.json" >&2
  exit 1
fi

node <<'NODE' "$MANIFEST" "$TMP_DIR"
const fs = require("fs");
const path = require("path");
const manifestPath = process.argv[1];
const root = process.argv[2];
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

for (const key of ["id", "name", "version", "agents"]) {
  if (!manifest[key]) {
    console.error(`acp_agent.json missing ${key}`);
    process.exit(1);
  }
}
if (!Array.isArray(manifest.agents) || manifest.agents.length === 0) {
  console.error("acp_agent.json agents must be a non-empty array");
  process.exit(1);
}

for (const agent of manifest.agents) {
  if (!agent.id || !agent.name || !agent.transport) {
    console.error("acp_agent.json agent entries require id, name, and transport");
    process.exit(1);
  }
  if (agent.transport.type !== "stdio") {
    console.error(`unsupported ACP transport type: ${agent.transport.type}`);
    process.exit(1);
  }
  const command = agent.transport.command || "";
  if (!command) {
    console.error(`ACP agent ${agent.id} transport.command is empty`);
    process.exit(1);
  }
  if (path.isAbsolute(command) || command.includes("..")) {
    console.error(`ACP agent ${agent.id} command must stay inside package`);
    process.exit(1);
  }
  const commandPath = path.join(root, command.replace(/^\.\//, ""));
  if (!fs.existsSync(commandPath) || !fs.statSync(commandPath).isFile()) {
    console.error(`ACP agent ${agent.id} command not found: ${command}`);
    process.exit(1);
  }
  if (!commandPath.endsWith(".cmd")) {
    try {
      fs.accessSync(commandPath, fs.constants.X_OK);
    } catch {
      console.error(`ACP agent ${agent.id} command is not executable: ${command}`);
      process.exit(1);
    }
  }
  if (agent.transport.args && !Array.isArray(agent.transport.args)) {
    console.error(`ACP agent ${agent.id} transport.args must be an array`);
    process.exit(1);
  }
  if (agent.transport.env && typeof agent.transport.env !== "object") {
    console.error(`ACP agent ${agent.id} transport.env must be an object`);
    process.exit(1);
  }
}
NODE

echo "Verified ACP agent package: ${PACKAGE}"
