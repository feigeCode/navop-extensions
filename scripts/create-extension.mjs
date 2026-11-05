#!/usr/bin/env node
// 仓库内的脚手架入口（模板来自 templates/extension-basic）。
// 真正的实现与 npm 包 @navop/create-extension 共用 packages/create-extension/create.mjs。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createExtension } from "../packages/create-extension/create.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");

const argv = process.argv.slice(2);
if (argv[0] === "-h" || argv[0] === "--help") {
  process.stdout.write(`用法：
  node scripts/create-extension.mjs --id <com.example.demo> --name <显示名> [选项]

选项：
  --id <id>           扩展 id（必填，反向域名小写）
  --name <name>       显示名（必填）
  --publisher <name>  发布者（默认 "Your Name"）
  --dir <path>        输出目录（默认 extensions/composite/<id 最后一段>）
  --force             目标目录已存在时覆盖
  --vendor-lib        把 @navop/extension-kit 源码复制进 ui/lib（离线可用）
  --skip-build        只生成文件，不跑 nsh check / nsh build
  -h, --help          显示本帮助
`);
  process.exit(0);
}

try {
  await createExtension({
    argv,
    repoRoot: REPO,
    templateDir: path.join(REPO, "templates", "extension-basic"),
    kitDir: path.join(REPO, "packages", "extension-kit", "src"),
  });
} catch (error) {
  process.stderr.write(`\x1b[31m✗\x1b[0m ${error.message}\n`);
  process.exit(1);
}
