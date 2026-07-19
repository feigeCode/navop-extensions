#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: scripts/install-local-acp-agents.sh [agent-id]

Package, verify, and install ACP agent extensions into the local one-hub ACP
agent directory. Passing an agent id installs only that agent; omitting it
installs every agent under extensions/acp-agent.

Environment:
  NAVOP_ACP_AGENT_DIR    Override install root. The legacy
                         ONETCLI_ACP_AGENT_DIR is also supported. Defaults to
                         $XDG_CONFIG_HOME/one-hub/extensions/acp_agents
                         or $HOME/.config/one-hub/extensions/acp_agents.
EOF
}

if [ "$#" -gt 1 ]; then
  usage
  exit 2
fi

case "${1:-}" in
  -h|--help)
    usage
    exit 0
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ARTIFACT_DIR="${REPO_DIR}/target/local-extension-artifacts"
CONFIG_HOME="${XDG_CONFIG_HOME:-${HOME}/.config}"
INSTALL_ROOT="${NAVOP_ACP_AGENT_DIR:-${ONETCLI_ACP_AGENT_DIR:-${CONFIG_HOME}/one-hub/extensions/acp_agents}}"

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

json_value() {
  local file="$1"
  local expression="$2"
  node -e "const fs = require('fs'); const data = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); const value = ${expression}; if (Array.isArray(value)) process.stdout.write(value.join(' ')); else process.stdout.write(value == null ? '' : String(value));" "$file"
}

host_triple() {
  rustc -vV | sed -n 's/^host: //p'
}

agent_ids() {
  if [ "$#" -eq 1 ] && [ -n "$1" ]; then
    printf '%s\n' "$1"
    return 0
  fi

  find "${REPO_DIR}/extensions/acp-agent" -mindepth 2 -maxdepth 2 -name extension.build.json -print \
    | sort \
    | while IFS= read -r metadata; do
        basename "$(dirname "$metadata")"
      done
}

target_for_agent() {
  local metadata="$1"
  local targets host
  targets="$(json_value "$metadata" 'data.targets || []')"
  host="$(host_triple)"
  for target in $targets; do
    if [ "$target" = "$host" ]; then
      printf '%s\n' "$host"
      return 0
    fi
  done
  for target in $targets; do
    if [ "$target" = "universal" ]; then
      printf '%s\n' "$target"
      return 0
    fi
  done
  fail "$(json_value "$metadata" 'data.id') does not declare target ${host} or universal"
}

package_agent() {
  local id="$1"
  local target="$2"
  local manifest_json="${REPO_DIR}/extensions/acp-agent/${id}/acp_agent.json"
  local version

  [ -f "$manifest_json" ] || fail "missing ACP agent manifest: ${manifest_json}"
  version="$(json_value "$manifest_json" 'data.version')"
  [ -n "$version" ] || fail "missing version in ${manifest_json}"

  mkdir -p "$ARTIFACT_DIR"
  printf 'Packaging %s %s\n' "$id" "$version"
  bash "${SCRIPT_DIR}/package-acp-agent.sh" "$id" "$target" "$ARTIFACT_DIR" "$version"
}

install_packaged_agent() {
  local id="$1"
  local target="$2"
  local packaged_dir="${REPO_DIR}/target/extension-packages/${target}/${id}"
  local dest_dir="${INSTALL_ROOT}/${id}"
  local backup_root="${INSTALL_ROOT}.backups"
  local backup_dir base_backup counter

  [ -d "$packaged_dir" ] || fail "packaged ACP agent directory does not exist: ${packaged_dir}"

  mkdir -p "$INSTALL_ROOT"
  if [ -e "$dest_dir" ]; then
    mkdir -p "$backup_root"
    base_backup="${backup_root}/${id}.backup.$(date +%Y%m%d%H%M%S)"
    backup_dir="$base_backup"
    counter=1
    while [ -e "$backup_dir" ]; do
      counter=$((counter + 1))
      backup_dir="${base_backup}.${counter}"
    done
    mv "$dest_dir" "$backup_dir"
  else
    backup_dir=""
  fi

  mkdir -p "$dest_dir"
  if ! cp -R "${packaged_dir}/." "${dest_dir}/"; then
    rm -rf "$dest_dir"
    if [ -n "$backup_dir" ]; then
      mv "$backup_dir" "$dest_dir"
    fi
    fail "failed to install ${id}; restored previous ACP agent if a backup existed"
  fi

  printf 'Installed %s -> %s\n' "$id" "$dest_dir"
}

main() {
  local selected="${1:-}"
  local target id metadata archive

  printf 'Installing local ACP agents into %s\n' "$INSTALL_ROOT"

  while IFS= read -r id; do
    [ -n "$id" ] || continue
    metadata="${REPO_DIR}/extensions/acp-agent/${id}/extension.build.json"
    [ -f "$metadata" ] || fail "missing extension build metadata: ${metadata}"
    target="$(target_for_agent "$metadata")"
    archive="$(package_agent "$id" "$target" | tail -n 1)"
    bash "${SCRIPT_DIR}/verify-acp-agent-package.sh" "$archive"
    install_packaged_agent "$id" "$target"
  done < <(agent_ids "$selected")
}

main "$@"
