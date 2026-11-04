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

node --input-type=commonjs - "$MANIFEST" "$TMP_DIR" <<'NODE'
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

const ipcRuntimes = manifest.runtime?.ipc || [];
const ipcIds = new Set();
for (const runtime of ipcRuntimes) {
  if (!runtime.id || !runtime.entry?.command) {
    console.error("runtime.ipc entries must declare id and entry.command");
    process.exit(1);
  }
  if (ipcIds.has(runtime.id)) {
    console.error(`duplicate runtime.ipc id: ${runtime.id}`);
    process.exit(1);
  }
  ipcIds.add(runtime.id);
  const command = runtime.entry.command;
  if (path.isAbsolute(command) || command.includes("..")) {
    console.error(`runtime.ipc entry.command must stay inside package: ${command}`);
    process.exit(1);
  }
  const commandPath = path.join(packageRoot, command.replace(/^\.\//, ""));
  if (!fs.existsSync(commandPath)) {
    console.error(`runtime.ipc entry.command not found: ${command}`);
    process.exit(1);
  }
  if (!(manifest.permissions || []).includes(`spawn:${command}`)) {
    console.error(`runtime.ipc entry.command is missing spawn permission: spawn:${command}`);
    process.exit(1);
  }
}

// ABI v2: 一个扩展最多一个 nsh app（contributes.shellApp），页面由 app 内的
// 路由组织。旧的 per-page shellViews 已被宿主 deny_unknown_fields 拒绝，这里
// 先给出迁移提示，再按宿主安装期校验（crates/extension-runtime/src/extension/
// manifest/shell_validation.rs）逐项检查。
const shellApp = manifest.contributes?.shellApp ?? null;
const supportedModules = new Set(["resource", "job", "event", "blob", "log", "runtime", "dev"]);
const backendModules = new Set(["resource", "job", "event", "blob"]);
const reservedBackendAliases = new Set(["host", "navop", "default"]);
// 与宿主内置 nsh 运行时（nsh-platform-gpui 的 minor）保持一致。
const hostNshVersion = "0.3.0";
const builtinDevExtensionIds = new Set(["com.navop.devtools"]);

function isSafeRelativePath(value) {
  if (typeof value !== "string" || value.trim() === "") return false;
  if (path.isAbsolute(value) || value.startsWith("\\\\") || value.startsWith("//") || value[1] === ":") {
    return false;
  }
  return !value.split(/[\\/]/).includes("..");
}

function parseSemver(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(String(value ?? "").trim());
  return match ? match.slice(1).map(Number) : null;
}

// 与宿主 validate_engine_version 相同：0.x 要求同一 minor，其余要求同一 major，
// 且宿主提供的版本不低于清单要求。
function nshEngineSupports(required) {
  const want = parseSemver(required);
  const have = parseSemver(hostNshVersion);
  if (!want) return false;
  const compatible = want[0] === 0 ? have[0] === 0 && have[1] === want[1] : have[0] === want[0];
  if (!compatible) return false;
  for (let index = 0; index < 3; index += 1) {
    if (have[index] !== want[index]) return have[index] > want[index];
  }
  return true;
}

function isValidIdentifier(value) {
  return typeof value === "string"
    && value.length > 0
    && /^[a-z0-9._-]+$/.test(value)
    && !/^[._-]/.test(value)
    && !/[._-]$/.test(value)
    && !value.includes("..");
}

if (manifest.contributes && manifest.contributes.shellViews !== undefined) {
  console.error("contributes.shellViews was removed: declare a single contributes.shellApp instead");
  process.exit(1);
}
if (!shellApp && manifest.engines?.nsh) {
  console.error("engines.nsh requires contributes.shellApp (every nsh extension has exactly one app)");
  process.exit(1);
}
if (shellApp) {
  if (!(manifest.permissions || []).includes("shell:exec")) {
    console.error("shellApp requires shell:exec permission");
    process.exit(1);
  }
  if (!nshEngineSupports(manifest.engines?.nsh)) {
    console.error(`shellApp requires a compatible engines.nsh (host provides ${hostNshVersion})`);
    process.exit(1);
  }
  if (shellApp.title != null && String(shellApp.title).trim() === "") {
    console.error("shellApp title must not be empty");
    process.exit(1);
  }
  if (!isSafeRelativePath(shellApp.entry)) {
    console.error(`shellApp entry must be a non-empty relative path inside the package: ${shellApp.entry}`);
    process.exit(1);
  }
  const entryPath = path.join(packageRoot, shellApp.entry);
  if (!fs.existsSync(entryPath) || !fs.statSync(entryPath).isFile()) {
    console.error(`shellApp entry not found: ${shellApp.entry}`);
    process.exit(1);
  }
  if (shellApp.icon != null) {
    if (!isSafeRelativePath(shellApp.icon)) {
      console.error(`shellApp icon must be a relative path inside the package: ${shellApp.icon}`);
      process.exit(1);
    }
    const iconPath = path.join(packageRoot, shellApp.icon);
    if (!fs.existsSync(iconPath) || !fs.statSync(iconPath).isFile()) {
      console.error(`shellApp icon not found: ${shellApp.icon}`);
      process.exit(1);
    }
  }
  const backends = shellApp.backends || {};
  for (const [alias, runtimeId] of Object.entries(backends)) {
    if (!isValidIdentifier(alias)) {
      console.error(`shellApp backend alias is invalid: ${alias}`);
      process.exit(1);
    }
    if (reservedBackendAliases.has(alias)) {
      console.error(`shellApp backend alias is reserved: ${alias}`);
      process.exit(1);
    }
    if (!ipcIds.has(runtimeId)) {
      console.error(`shellApp backend ${alias} references unknown IPC runtime: ${runtimeId}`);
      process.exit(1);
    }
  }
  if (!Array.isArray(shellApp.modules)) {
    console.error("shellApp modules must be an array");
    process.exit(1);
  }
  const seenModules = new Set();
  for (const module of shellApp.modules) {
    if (!supportedModules.has(module)) {
      console.error(`shellApp module is not supported by this host: ${module}`);
      process.exit(1);
    }
    if (seenModules.has(module)) {
      console.error(`duplicate shellApp module: ${module}`);
      process.exit(1);
    }
    seenModules.add(module);
    if (module === "dev" && !builtinDevExtensionIds.has(manifest.id)) {
      console.error(`shellApp module dev is reserved for builtin extensions: ${manifest.id}`);
      process.exit(1);
    }
  }
  if (Object.keys(backends).length === 0 && shellApp.modules.some((module) => backendModules.has(module))) {
    console.error("shellApp resource/job/event/blob modules require at least one backend");
    process.exit(1);
  }
  if (shellApp.category != null && !isValidIdentifier(shellApp.category)) {
    console.error(`shellApp category is invalid: ${shellApp.category}`);
    process.exit(1);
  }
}

const connections = manifest.contributes?.connections || [];
const connectionIds = new Set();
for (const connection of connections) {
  // 终端型连接(声明 terminal)由宿主直接起本地进程:没有 provider,
  // 因此不得声明 runtimeId / resourceType / route。
  const isTerminal = connection.terminal !== undefined;
  const requiredKeys = isTerminal
    ? ["id", "label", "form"]
    : ["id", "label", "runtimeId", "resourceType", "form"];
  for (const key of requiredKeys) {
    if (!connection[key]) {
      console.error(`connection contribution missing ${key}`);
      process.exit(1);
    }
  }
  if (isTerminal) {
    if (connection.runtimeId || connection.resourceType || connection.shellViewId
        || connection.route != null) {
      console.error(`terminal connection ${connection.id} must not declare runtimeId, resourceType or route`);
      process.exit(1);
    }
    const command = connection.terminal.command;
    if (typeof command !== "string" || command.trim() === "" || command.includes("{{")) {
      console.error(`terminal connection ${connection.id} command must be a fixed non-empty string`);
      process.exit(1);
    }
  }
  if (connectionIds.has(connection.id)) {
    console.error(`duplicate connection contribution id: ${connection.id}`);
    process.exit(1);
  }
  connectionIds.add(connection.id);
  if (!isTerminal && !ipcIds.has(connection.runtimeId)) {
    console.error(`connection ${connection.id} references unknown IPC runtime: ${connection.runtimeId}`);
    process.exit(1);
  }
  if (connection.shellViewId !== undefined) {
    console.error(`connection ${connection.id} still declares shellViewId: use connections[].route instead`);
    process.exit(1);
  }
  if (connection.route != null) {
    if (typeof connection.route !== "string" || connection.route.trim() === "") {
      console.error(`connection ${connection.id} route must be a non-empty string`);
      process.exit(1);
    }
    if (!shellApp) {
      console.error(`connection ${connection.id} declares route but the extension has no shellApp`);
      process.exit(1);
    }
    // route 是 app 内的初始路由：连接型 app 需要通过 resource 模块经连接
    // 访问 provider，并且 backends 要暴露该连接的 runtimeId。
    if (!shellApp.modules.includes("resource")) {
      console.error(`connection ${connection.id} shellApp requires the resource module`);
      process.exit(1);
    }
    if (!Object.values(shellApp.backends || {}).includes(connection.runtimeId)) {
      console.error(`connection ${connection.id} shellApp must expose runtime ${connection.runtimeId} as a backend`);
      process.exit(1);
    }
  }
  const tabs = connection.form.tabs || [];
  const fieldIds = new Set();
  let hasSecrets = false;
  for (const tab of tabs) {
    if (!tab.id || !tab.label || !Array.isArray(tab.fields)) {
      console.error(`connection ${connection.id} has an invalid form tab`);
      process.exit(1);
    }
    for (const field of tab.fields) {
      if (!field.id || !field.label || !field.fieldType || fieldIds.has(field.id)) {
        console.error(`connection ${connection.id} has an invalid or duplicate form field`);
        process.exit(1);
      }
      fieldIds.add(field.id);
      hasSecrets ||= field.secret === true;
      if ((field.secret === true) !== (field.fieldType === "Password")) {
        console.error(`connection secret field ${field.id} must use Password and secret=true`);
        process.exit(1);
      }
    }
  }
  if (hasSecrets && !(manifest.permissions || []).includes("secrets:read:self.*")) {
    console.error(`connection ${connection.id} secrets require secrets:read:self.* permission`);
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

if (importers.length === 0 && editors.length === 0 && wasmRuntimes.length === 0
    && ipcRuntimes.length === 0 && !shellApp && connections.length === 0) {
  console.error("extension.json has no supported composite contributions");
  process.exit(1);
}
NODE

echo "Verified ${PACKAGE}"
