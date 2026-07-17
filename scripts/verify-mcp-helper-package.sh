#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <mcp-helper-package.tar.gz>" >&2
  exit 2
fi

PACKAGE="$1"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

tar xzf "$PACKAGE" -C "$TMP_DIR"

MANIFEST="${TMP_DIR}/mcp_helper.json"
if [ ! -f "$MANIFEST" ]; then
  echo "Missing root-level mcp_helper.json" >&2
  exit 1
fi

COMMAND="$(node -e 'const fs = require("fs"); const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(data.entry && data.entry.command || "");' "$MANIFEST")"
if [ -z "$COMMAND" ]; then
  echo "mcp_helper.json entry.command is empty" >&2
  exit 1
fi

DISTRIBUTION_TYPE="$(node -e 'const fs = require("fs"); const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(data.distribution && data.distribution.type || "bundled");' "$MANIFEST")"
if [ "$DISTRIBUTION_TYPE" = "npm" ]; then
  node <<'NODE' "$MANIFEST"
const fs = require("fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const distribution = manifest.distribution || {};
if (!/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(distribution.package || "")) {
  throw new Error("npm distribution package must be a scoped package name");
}
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(distribution.version || "")) {
  throw new Error("npm distribution version must be exact semver");
}
const expected = ["-y", `${distribution.package}@${distribution.version}`, "mcp"];
if (manifest.entry.command !== "npx" || JSON.stringify(manifest.entry.args) !== JSON.stringify(expected)) {
  throw new Error("npm MCP helper entry must use exact-version npx arguments");
}
NODE
  PACKAGE_COUNT="$(find "$TMP_DIR" -maxdepth 1 -name '*.tgz' | wc -l | tr -d ' ')"
  if [ "$PACKAGE_COUNT" -ne 1 ]; then
    echo "npm MCP helper package must contain exactly one npm tarball" >&2
    exit 1
  fi
  echo "Verified npm MCP helper package: ${PACKAGE}"
  exit 0
fi
if [[ "$COMMAND" = /* || "$COMMAND" == *".."* ]]; then
  echo "mcp_helper.json entry.command must stay inside package" >&2
  exit 1
fi

BIN="${TMP_DIR}/${COMMAND#./}"
if [ ! -f "$BIN" ]; then
  echo "MCP helper command not found: ${COMMAND}" >&2
  exit 1
fi
if [[ "$BIN" != *.exe && ! -x "$BIN" ]]; then
  echo "MCP helper command is not executable: ${COMMAND}" >&2
  exit 1
fi

node <<'NODE' "$MANIFEST"
const fs = require("fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
for (const key of ["id", "name", "version", "entry"]) {
  if (!manifest[key]) {
    console.error(`mcp_helper.json missing ${key}`);
    process.exit(1);
  }
}
NODE
