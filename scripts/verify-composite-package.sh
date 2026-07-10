#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <composite-package.tar.gz>" >&2
  exit 2
fi

PACKAGE="$1"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

tar xzf "$PACKAGE" -C "$TMP_DIR"

MANIFEST="${TMP_DIR}/extension.json"
if [ ! -f "$MANIFEST" ]; then
  echo "Missing root-level extension.json" >&2
  exit 1
fi

node <<'NODE' "$MANIFEST" "$TMP_DIR"
const fs = require("fs");
const path = require("path");

const manifestPath = process.argv[2];
const packageRoot = process.argv[3];
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

for (const key of ["id", "name", "version", "contributes"]) {
  if (!manifest[key]) {
    console.error(`extension.json missing ${key}`);
    process.exit(1);
  }
}

if (Object.keys(manifest.contributes).length === 0) {
  console.error("extension.json contributes must not be empty");
  process.exit(1);
}

const wasmRuntimes = manifest.runtime?.wasm || [];
for (const runtime of wasmRuntimes) {
  if (!runtime.id || !runtime.module || runtime.kind !== "component") {
    console.error("runtime.wasm entries must declare id, module, and kind=component");
    process.exit(1);
  }
  if (path.isAbsolute(runtime.module) || runtime.module.includes("..")) {
    console.error(`runtime.wasm.module must stay inside package: ${runtime.module}`);
    process.exit(1);
  }
  const modulePath = path.join(packageRoot, runtime.module);
  if (!fs.existsSync(modulePath)) {
    console.error(`runtime.wasm.module not found: ${runtime.module}`);
    process.exit(1);
  }
}

const importers = manifest.contributes?.connectionImporters || [];

for (const importer of importers) {
  for (const key of ["id", "runtimeId", "displayName"]) {
    if (!importer[key]) {
      console.error(`connection importer missing ${key}`);
      process.exit(1);
    }
  }
  if (!Array.isArray(importer.outputKinds) || importer.outputKinds.length === 0) {
    console.error(`connection importer ${importer.id} missing outputKinds`);
    process.exit(1);
  }
}

const editors = manifest.contributes?.remoteFileEditors || [];
for (const editor of editors) {
  for (const key of ["id", "displayName", "command"]) {
    if (!editor[key]) {
      console.error(`remote file editor missing ${key}`);
      process.exit(1);
    }
  }
  if (!Array.isArray(editor.command.programCandidates)
      || editor.command.programCandidates.length === 0) {
    console.error(`remote file editor ${editor.id} missing programCandidates`);
    process.exit(1);
  }
  if (editor.command.args && !Array.isArray(editor.command.args)) {
    console.error(`remote file editor ${editor.id} args must be an array`);
    process.exit(1);
  }
}

if (importers.length === 0 && editors.length === 0 && wasmRuntimes.length === 0) {
  console.error("extension.json has no supported composite contributions");
  process.exit(1);
}
NODE

echo "Verified ${PACKAGE}"
