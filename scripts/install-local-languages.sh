#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: scripts/install-local-languages.sh [language-id]

Package, verify, and install Tree-sitter language extensions into the local
one-hub language extension directory. Passing a language id installs only that
language; omitting it installs every language under extensions/language.

Environment:
  NAVOP_LANGUAGE_DIR    Override install root. The legacy
                        ONETCLI_LANGUAGE_DIR is also supported. Defaults to
                        $XDG_CONFIG_HOME/one-hub/extensions/languages
                        or $HOME/.config/one-hub/extensions/languages.
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
INSTALL_ROOT="${NAVOP_LANGUAGE_DIR:-${ONETCLI_LANGUAGE_DIR:-${CONFIG_HOME}/one-hub/extensions/languages}}"
TARGET="universal"

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

json_value() {
  local file="$1"
  local expression="$2"
  node -e "const fs = require('fs'); const data = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); const value = ${expression}; if (Array.isArray(value)) process.stdout.write(value.join(' ')); else process.stdout.write(value == null ? '' : String(value));" "$file"
}

language_ids() {
  if [ "$#" -eq 1 ] && [ -n "$1" ]; then
    printf '%s\n' "$1"
    return 0
  fi

  find "${REPO_DIR}/extensions/language" -mindepth 2 -maxdepth 2 -name extension.build.json -print \
    | sort \
    | while IFS= read -r metadata; do
        basename "$(dirname "$metadata")"
      done
}

package_language() {
  local id="$1"
  local manifest_json="${REPO_DIR}/extensions/language/${id}/manifest.json"
  local version

  [ -f "$manifest_json" ] || fail "missing language manifest: ${manifest_json}"
  version="$(json_value "$manifest_json" 'data.version')"
  [ -n "$version" ] || fail "missing version in ${manifest_json}"

  mkdir -p "$ARTIFACT_DIR"
  printf 'Packaging %s %s\n' "$id" "$version"
  bash "${SCRIPT_DIR}/package-language-extension.sh" "$id" "$TARGET" "$ARTIFACT_DIR" "$version"
}

install_packaged_language() {
  local id="$1"
  local packaged_dir="${REPO_DIR}/target/extension-packages/${TARGET}/${id}"
  local dest_dir="${INSTALL_ROOT}/${id}"
  local backup_root="${INSTALL_ROOT}/.backups"
  local backup_dir base_backup counter

  [ -d "$packaged_dir" ] || fail "packaged language directory does not exist: ${packaged_dir}"

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
    fail "failed to install ${id}; restored previous language if a backup existed"
  fi

  printf 'Installed %s -> %s\n' "$id" "$dest_dir"
}

main() {
  local selected="${1:-}"
  local id metadata archive

  printf 'Installing local languages into %s\n' "$INSTALL_ROOT"

  while IFS= read -r id; do
    [ -n "$id" ] || continue
    metadata="${REPO_DIR}/extensions/language/${id}/extension.build.json"
    [ -f "$metadata" ] || fail "missing extension build metadata: ${metadata}"
    archive="$(package_language "$id" | tail -n 1)"
    bash "${SCRIPT_DIR}/verify-language-package.sh" "$archive"
    install_packaged_language "$id"
  done < <(language_ids "$selected")
}

main "$@"
