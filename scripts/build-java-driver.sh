#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "Usage: $0 <extension-id> <target-triple>" >&2
  exit 2
fi

EXTENSION_ID="$1"
TARGET="$2"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SOURCE_DIR="${REPO_DIR}/extensions/ipc/${EXTENSION_ID}"
BUILD_METADATA="${SOURCE_DIR}/extension.build.json"

if [ ! -f "$BUILD_METADATA" ]; then
  echo "Missing extension build metadata: ${BUILD_METADATA}" >&2
  exit 1
fi

read_metadata() {
  node -e "const fs = require('fs'); const data = JSON.parse(fs.readFileSync(process.argv[1], 'utf8')); const value = ${1}; if (Array.isArray(value)) process.stdout.write(value.join(' ')); else process.stdout.write(value || '');" "$BUILD_METADATA"
}

LANGUAGE="$(read_metadata 'data.language')"
if [ "$LANGUAGE" != "java" ]; then
  echo "Extension ${EXTENSION_ID} is not a Java driver" >&2
  exit 1
fi

PROJECT_REL="$(read_metadata 'data.package')"
BIN_STEM="$(read_metadata 'data.binary || `${data.id}-ipc-driver`')"
JAR_NAME="$(read_metadata 'data.jar || `${data.id}-ipc-driver.jar`')"
if [ -z "$PROJECT_REL" ]; then
  echo "Missing Java project path in ${BUILD_METADATA}" >&2
  exit 1
fi

PROJECT_DIR="${REPO_DIR}/${PROJECT_REL}"
if [ ! -d "$PROJECT_DIR" ]; then
  echo "Java project directory does not exist: ${PROJECT_DIR}" >&2
  exit 1
fi

shopt -s nullglob
if [ -f "${PROJECT_DIR}/pom.xml" ]; then
  rm -f "${PROJECT_DIR}"/target/*-all.jar
  mvn -f "${PROJECT_DIR}/pom.xml" -DskipTests package
fi
existing_jars=("${PROJECT_DIR}"/target/*-all.jar)
if [ "${#existing_jars[@]}" -eq 0 ]; then
  echo "Missing shaded Java driver jar under ${PROJECT_DIR}/target and no pom.xml was available to build it" >&2
  exit 1
fi

OUT_DIR="${REPO_DIR}/target/${TARGET}/release"
mkdir -p "${OUT_DIR}/lib"
cp "${existing_jars[0]}" "${OUT_DIR}/lib/${JAR_NAME}"
if [ -d "${PROJECT_DIR}/bin/lib" ]; then
  for extra_jar in "${PROJECT_DIR}"/bin/lib/*.jar; do
    extra_name="$(basename "$extra_jar")"
    if [ "$extra_name" != "$JAR_NAME" ]; then
      cp "$extra_jar" "${OUT_DIR}/lib/${extra_name}"
    fi
  done
fi

copy_launcher() {
  local bin_name="$1"
  local launcher="${PROJECT_DIR}/bin/${bin_name}"
  if [ ! -f "$launcher" ]; then
    echo "Missing Java driver launcher: ${launcher}" >&2
    exit 1
  fi
  cp "$launcher" "${OUT_DIR}/${bin_name}"
  if [[ "$bin_name" != *.cmd ]]; then
    chmod +x "${OUT_DIR}/${bin_name}"
  fi
}

if [ "$TARGET" = "universal" ]; then
  copy_launcher "$BIN_STEM"
  copy_launcher "${BIN_STEM}.cmd"
elif [[ "$TARGET" == *windows* ]]; then
  copy_launcher "${BIN_STEM}.cmd"
else
  copy_launcher "$BIN_STEM"
fi
