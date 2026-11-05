#!/usr/bin/env node
// @navop/create-extension：生成一个 Navop 扩展（模板随包发布，含 --vendor-lib 离线模式）。
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createExtension } from "./create.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const action = argv[0] === "new" ? argv.slice(1) : argv;

if (action[0] === "-v" || action[0] === "--version" || action[0] === "version") {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  process.stdout.write(`${require("./package.json").version}\n`);
  process.exit(0);
}
if (action[0] === "-h" || action[0] === "--help") {
  process.stdout.write(`用法：
  navop-ext new --id <com.example.demo> --name <显示名> [选项]

选项：
  --id <id>           扩展 id（必填，反向域名小写）
  --name <name>       显示名（必填）
  --publisher <name>  发布者（默认 "Your Name"）
  --dir <path>        输出目录（默认 extensions/composite/<id 最后一段>）
  --force             目标目录已存在时覆盖
  --vendor-lib        把 @navop/extension-kit 源码复制进 ui/lib（离线可用）
  --skip-build        只生成文件，不跑 nsh check / nsh build
  --no-install        跳过 npm install
  -h, --help          显示本帮助
`);
  process.exit(0);
}

try {
  await createExtension({
    argv: action,
    repoRoot: process.cwd(),
    templateDir: path.join(HERE, "template"),
    kitDir: path.join(HERE, "kit"),
  });
} catch (error) {
  process.stderr.write(`\x1b[31m✗\x1b[0m ${error.message}\n`);
  process.exit(1);
}
