#!/usr/bin/env bash
# 打一个离线开发包：脚本 + 模板 + kit 源码，拷进没有 npm / 没有网络的内网机器即可
# 生成扩展（ui/lib 直接内联 kit 源码，nsh build 不需要 node_modules）。
#
# 用法：bash scripts/pack-offline.sh [输出目录]   # 默认 artifacts/
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
OUT_DIR="${1:-${REPO_DIR}/artifacts}"
VERSION="$(node -p "require('${REPO_DIR}/packages/extension-kit/package.json').version" 2>/dev/null || echo "0.1.0")"
NAME="navop-extensions-offline-${VERSION}"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "${STAGE}/${NAME}"
cp -R "${SCRIPT_DIR}" "${STAGE}/${NAME}/scripts"
rm -f "${STAGE}/${NAME}/scripts/pack-offline.sh"
cp -R "${REPO_DIR}/templates" "${STAGE}/${NAME}/templates"
mkdir -p "${STAGE}/${NAME}/packages/extension-kit"
cp -R "${REPO_DIR}/packages/extension-kit/src" "${STAGE}/${NAME}/packages/extension-kit/src"
cp -R "${REPO_DIR}/packages/extension-kit/package.json" "${STAGE}/${NAME}/packages/extension-kit/package.json"

cat > "${STAGE}/${NAME}/README.md" <<'EOF'
# Navop 扩展离线开发包

一个插件 = 一个 nsh app = 一个包。本包自带模板与 `@navop/extension-kit` 源码，
**不需要 npm / 不需要网络**：生成的扩展把 kit 内联在 `ui/lib`，`nsh build` 直接可跑。

```bash
# 生成到当前目录下的 extensions/composite/<id 最后一段>
bash scripts/create-extension-offline.sh --id com.example.demo --name "演示扩展"

# 指定输出目录
bash scripts/create-extension-offline.sh --id com.example.demo --name "演示扩展" --dir /path/to/demo
```

生成后：

```bash
cd <dir>
nsh test ui           # 外壳 + 全部页面测试
bash scripts/build.sh # 重新构建 ui/dist/bundle.js
```

把扩展目录放进宿主扩展仓库，用 `scripts/install-local-composite-extensions.sh <slug>` 装进本地宿主。

> `nsh check` 首次运行需要下载 TypeScript 7（之后走缓存）。完全离线的机器上
> 跳过 check 即可：`nsh build` 与 `nsh test` 不依赖它。
EOF

mkdir -p "$OUT_DIR"
OUT="${OUT_DIR}/${NAME}.tar.gz"
tar czf "$OUT" -C "$STAGE" "$NAME"
echo "✓ ${OUT}"
