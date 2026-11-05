#!/usr/bin/env bash
# 离线生成一个 Navop 扩展：不跑 npm install，直接把 @navop/extension-kit 源码
# 复制进 ui/lib。只需要 bash + perl + nsh；没有 npm / 没有网络也能用。
#
# 用法：
#   bash scripts/create-extension-offline.sh --id com.example.demo --name "演示扩展"
#   bash scripts/create-extension-offline.sh --id com.example.demo --name "演示扩展" --dir /tmp/demo --skip-build
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TEMPLATE_DIR="${REPO_DIR}/templates/extension-basic"
KIT_DIR="${REPO_DIR}/packages/extension-kit/src"

ID=""
NAME=""
PUBLISHER="Your Name"
OUT_DIR=""
FORCE=0
SKIP_BUILD=0
VENDOR=1

usage() {
  cat <<'USAGE'
用法：
  bash scripts/create-extension-offline.sh --id <com.example.demo> --name <显示名> [选项]

选项：
  --id <id>           扩展 id（必填，反向域名小写，如 com.example.demo）
  --name <name>       显示名（必填，如 演示扩展）
  --publisher <name>  发布者（默认 "Your Name"）
  --dir <path>        输出目录（默认 extensions/composite/<id 最后一段>）
  --force             目标目录已存在时覆盖
  --skip-build        只生成文件，不跑 nsh check / nsh build
  --no-vendor         不复制 kit 源码，改为在 ui/package.json 声明依赖（等 npm 发布后用）
  -h, --help          显示本帮助
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --id) ID="${2:-}"; shift 2 ;;
    --name) NAME="${2:-}"; shift 2 ;;
    --publisher) PUBLISHER="${2:-}"; shift 2 ;;
    --dir) OUT_DIR="${2:-}"; shift 2 ;;
    --force) FORCE=1; shift ;;
    --skip-build) SKIP_BUILD=1; shift ;;
    --no-vendor) VENDOR=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "未知参数：$1" >&2; usage >&2; exit 2 ;;
  esac
done

[ -n "$ID" ] || { echo "缺少 --id" >&2; exit 2; }
[ -n "$NAME" ] || { echo "缺少 --name" >&2; exit 2; }
if ! printf '%s' "$ID" | grep -Eq '^[a-z0-9_]+(\.[a-z0-9_-]+)+$'; then
  echo "id 不合法：$ID（需要反向域名小写，如 com.example.demo）" >&2
  exit 2
fi
[ -d "$TEMPLATE_DIR" ] || { echo "模板目录不存在：$TEMPLATE_DIR" >&2; exit 2; }
[ -d "$KIT_DIR" ] || { echo "kit 目录不存在：$KIT_DIR" >&2; exit 2; }

SLUG="${ID##*.}"
TARGET="${OUT_DIR:-${REPO_DIR}/extensions/composite/${SLUG}}"
if [ -d "$TARGET" ] && [ "$FORCE" -ne 1 ]; then
  echo "目标目录已存在：$TARGET（加 --force 覆盖）" >&2
  exit 2
fi
[ -d "$TARGET" ] && rm -rf "$TARGET"
mkdir -p "$TARGET"

display() {
  case "$1" in
    "$REPO_DIR"/*) printf '%s' "${1#"$REPO_DIR"/}" ;;
    *) printf '%s' "$1" ;;
  esac
}

# 复制模板（跳过构建产物与编辑器缓存）
( cd "$TEMPLATE_DIR" && tar cf - \
    --exclude=.nsh --exclude=node_modules --exclude=dist --exclude=.DS_Store . ) \
  | ( cd "$TARGET" && tar xf - )

# 逐文件替换（用环境变量传参，避免引号/中文转义问题）
replace() {
  local from="$1" to="$2"; shift 2
  for f in "$@"; do
    [ -f "$f" ] || continue
    FROM="$from" TO="$to" perl -pi -e 's/\Q$ENV{FROM}\E/$ENV{TO}/g' "$f"
  done
}

replace "com.example.template" "$ID" \
  "$TARGET/extension.json" "$TARGET/ui/nsh.json" "$TARGET/ui/lib/test-host.ts" \
  "$TARGET/README.md" "$TARGET/ui/package.json"

replace "扩展模板" "$NAME" \
  "$TARGET/extension.json" "$TARGET/ui/nsh.json" "$TARGET/ui/lib/test-host.ts" \
  "$TARGET/README.md" "$TARGET/ui/package.json"

replace "Your Name" "$PUBLISHER" "$TARGET/extension.json"

replace "\"id\": \"template\"" "\"id\": \"${SLUG}\"" "$TARGET/extension.build.json"
replace "\"package\": \"template\"" "\"package\": \"${SLUG}\"" "$TARGET/extension.build.json"
replace "\"path\": \"extensions/composite/template\"" "\"path\": \"$(display "$TARGET")\"" "$TARGET/extension.build.json"
replace "\"releaseTagPrefix\": \"template-v\"" "\"releaseTagPrefix\": \"${SLUG}-v\"" "$TARGET/extension.build.json"
replace "\"r2Prefix\": \"extensions/template\"" "\"r2Prefix\": \"extensions/${SLUG}\"" "$TARGET/extension.build.json"

if [ "$VENDOR" -eq 1 ]; then
  # 把 kit 源码复制进 ui/lib，并把转发改成相对导入
  for f in "$KIT_DIR"/*.ts "$KIT_DIR"/*.tsx; do
    base="$(basename "$f")"
    [ "$base" = "index.ts" ] && continue
    cp "$f" "$TARGET/ui/lib/$base"
  done
  replace '"@navop/extension-kit/testing"' '"./testing"' \
    "$TARGET/ui/lib/test-host.ts" "$TARGET/ui/lib/navop.ts"
  replace '"@navop/extension-kit/ui"' '"./ui"' \
    "$TARGET/ui/lib/ui.tsx" "$TARGET/ui/lib/navop.ts"
  replace '"@navop/extension-kit/theme"' '"./theme"' "$TARGET/ui/lib/theme.ts"
  replace '"@navop/extension-kit/format"' '"./format"' "$TARGET/ui/lib/format.ts"
  replace '"@navop/extension-kit"' '"./navop"' "$TARGET/ui/lib/navop.ts"
  # 离线：ui 不声明任何依赖（package.json 只留元信息）
  cat > "$TARGET/ui/package.json" <<JSON
{
  "name": "@navop-ext/${SLUG}-ui",
  "private": true,
  "type": "module",
  "description": "${NAME} 的 nsh app（构建产物见 dist/）。"
}
JSON
else
  cat > "$TARGET/ui/package.json" <<JSON
{
  "name": "@navop-ext/${SLUG}-ui",
  "private": true,
  "type": "module",
  "description": "${NAME} 的 nsh app（构建产物见 dist/）。",
  "dependencies": {
    "@navop/extension-kit": "^0.1.0"
  }
}
JSON
fi

echo ""
echo "✓ 已生成 $(display "$TARGET")（id: $ID）"
if [ "$VENDOR" -eq 1 ]; then
  echo "✓ 已把 kit 源码复制进 $(display "$TARGET")/ui/lib（离线可用，无需 npm install）"
else
  echo "· 未复制 kit 源码：需要先 npm install（公共 npm 发布后可用）"
fi

if [ "$SKIP_BUILD" -eq 1 ]; then
  echo "· 跳过 nsh check / nsh build（--skip-build）"
else
  if command -v nsh >/dev/null 2>&1; then
    ( cd "$TARGET/ui" && nsh build . --out dist )
    # check 首次需要下载 TypeScript（之后走缓存）；离线机器上失败不算致命
    if ! ( cd "$TARGET" && nsh check ui ); then
      echo "⚠ nsh check 失败（离线机器首次可能需要 TypeScript 缓存）；build/test 不受影响" >&2
    fi
  else
    echo "⚠ 没找到 nsh，跳过构建；装好 nsh 后执行："
    echo "    cd $(display "$TARGET") && nsh check ui && (cd ui && nsh build . --out dist)"
  fi
fi

cat <<EOF

下一步：
  cd $(display "$TARGET")
  nsh test ui               # 外壳 + 全部页面测试（递归）
  nsh test ui/pages/home    # 只跑单页
  bash scripts/build.sh      # 重新构建 ui/dist/bundle.js

装进本地宿主（在扩展仓库根执行）：
  bash scripts/install-local-composite-extensions.sh ${SLUG}
EOF
