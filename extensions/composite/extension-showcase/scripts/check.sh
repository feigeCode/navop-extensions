#!/usr/bin/env bash
# 类型检查 + 全部测试（外壳 + 每个页面）。
set -euo pipefail
cd "$(dirname "$0")/.."
nsh check ui
bash scripts/test.sh
