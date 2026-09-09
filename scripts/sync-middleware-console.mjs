#!/usr/bin/env node
// 同步中间件共享控制台 JS 库到各实现扩展（标准 §5.1）。
//
// 把基础扩展 com.navop.middleware 的 ui/console/*.js 复制进各实现扩展的
// ui/console/ 目录（mqtt、rocketmq）；实现扩展的 ui/console.js 入口薄壳
// import "./console/base.js" 引用这些文件。
//
// 用法：
//   node scripts/sync-middleware-console.mjs           # 执行同步（幂等：内容一致则跳过）
//   node scripts/sync-middleware-console.mjs --check   # 只校验不写（CI 用；不一致时退出码 1）
//
// 退出码：0 成功/一致；1 源目录缺失或 --check 发现不一致。

import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 仓库根（navop-extensions/）——脚本位于 scripts/ 下。
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 共享控制台库源目录（基础扩展）。
const sourceDir = path.join(repoRoot, "extensions/composite/middleware-base/ui/console");

// 同步目标：各实现扩展的 ui/console/ 目录。
const targetDirs = [
  path.join(repoRoot, "extensions/composite/mqtt/ui/console"),
  path.join(repoRoot, "extensions/composite/rocketmq/ui/console"),
];

const checkOnly = process.argv.includes("--check");

async function main() {
  // 源目录缺失时明确报错（而不是静默跳过）。
  let sourceFiles;
  try {
    sourceFiles = await readdir(sourceDir);
  } catch (error) {
    console.error(
      `[sync-middleware-console] 源目录缺失或不可读: ${sourceDir}\n` +
        `  错误: ${error.message}\n` +
        `  请确认基础扩展 com.navop.middleware 已就位。`,
    );
    process.exit(1);
  }
  // 只同步 .js 文件，按名称排序保证输出稳定。
  const jsFiles = sourceFiles.filter((name) => name.endsWith(".js")).sort();
  if (jsFiles.length === 0) {
    console.error(`[sync-middleware-console] 源目录没有 .js 文件: ${sourceDir}`);
    process.exit(1);
  }

  let mismatches = 0;
  for (const targetDir of targetDirs) {
    const relativeTarget = path.relative(repoRoot, targetDir);
    for (const name of jsFiles) {
      const sourcePath = path.join(sourceDir, name);
      const targetPath = path.join(targetDir, name);
      const sourceContent = await readFile(sourcePath, "utf8");

      let targetContent = null;
      try {
        targetContent = await readFile(targetPath, "utf8");
      } catch {
        // 目标不存在：--check 视为不一致，写入模式则创建。
      }

      if (targetContent === sourceContent) {
        console.log(`[ok] ${relativeTarget}/${name} 已是最新`);
        continue;
      }

      if (checkOnly) {
        console.error(`[diff] ${relativeTarget}/${name} 缺失或与源不一致`);
        mismatches += 1;
        continue;
      }

      await mkdir(targetDir, { recursive: true });
      await writeFile(targetPath, sourceContent, "utf8");
      console.log(`[sync] ${relativeTarget}/${name} <- ${path.relative(repoRoot, sourcePath)}`);
    }
  }

  if (checkOnly && mismatches > 0) {
    console.error(
      `[sync-middleware-console] --check 发现 ${mismatches} 个不一致；` +
        `请运行 node scripts/sync-middleware-console.mjs 后重试。`,
    );
    process.exit(1);
  }
  console.log("[sync-middleware-console] 完成。");
}

main().catch((error) => {
  console.error(`[sync-middleware-console] 失败: ${error && error.stack ? error.stack : error}`);
  process.exit(1);
});
