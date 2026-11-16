#!/usr/bin/env bash
# 产出 ui/dist/bundle.js（入库，随扩展分发）。
set -euo pipefail
cd "$(dirname "$0")/../ui"
nsh build . --out dist
