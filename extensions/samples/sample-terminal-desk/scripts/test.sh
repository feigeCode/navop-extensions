#!/usr/bin/env bash
# 跑外壳测试与全部页面测试（`nsh test` 会递归到 ui/pages/*/）。
set -euo pipefail
cd "$(dirname "$0")/../ui"
nsh test .
