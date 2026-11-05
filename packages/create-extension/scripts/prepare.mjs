// prepack：把仓库里的模板与 kit 源码复制进本包，保证 npm 包自包含。
import { cp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.resolve(HERE, "..");
const REPO = path.resolve(PKG, "..", "..");
const TEMPLATE = path.join(REPO, "templates", "extension-basic");
const KIT = path.join(REPO, "packages", "extension-kit", "src");

for (const [from, to] of [
  [TEMPLATE, path.join(PKG, "template")],
  [KIT, path.join(PKG, "kit")],
]) {
  if (!existsSync(from)) throw new Error(`缺少源目录：${from}`);
  await rm(to, { recursive: true, force: true });
  await cp(from, to, {
    recursive: true,
    filter: (source) => {
      const base = path.basename(source);
      return base !== ".nsh" && base !== "node_modules" && base !== "dist";
    },
  });
}
process.stdout.write("✓ 已打包模板与 kit 源码\n");
