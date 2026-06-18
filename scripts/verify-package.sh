#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <extension-package.tar.gz>" >&2
  exit 2
fi

ARCHIVE="$1"
TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

tar xzf "$ARCHIVE" -C "$TMP_DIR"

DRIVER_DIR_COUNT="$(find "$TMP_DIR" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
if [ "$DRIVER_DIR_COUNT" -ne 1 ]; then
  echo "Expected exactly one top-level driver directory in package" >&2
  exit 1
fi

DRIVER_DIR="$(find "$TMP_DIR" -mindepth 1 -maxdepth 1 -type d | sort | head -n 1)"
DRIVER_JSON="${DRIVER_DIR}/driver.json"
if [ ! -f "$DRIVER_JSON" ]; then
  echo "Missing driver.json" >&2
  exit 1
fi

COMMAND="$(node -e 'const fs = require("fs"); const p = process.argv[1]; const data = JSON.parse(fs.readFileSync(p, "utf8")); process.stdout.write(data.entry && data.entry.command || "");' "$DRIVER_JSON")"
if [ -z "$COMMAND" ]; then
  echo "driver.json entry.command is empty" >&2
  exit 1
fi

BIN_PATH="${DRIVER_DIR}/${COMMAND#./}"
if [ ! -f "$BIN_PATH" ]; then
  echo "driver binary referenced by entry.command does not exist: ${COMMAND}" >&2
  exit 1
fi

if [ ! -d "${DRIVER_DIR}/locales" ]; then
  echo "Missing locales directory" >&2
  exit 1
fi

echo "Package verification ok: ${ARCHIVE}"
