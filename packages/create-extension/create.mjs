// 生成一个 Navop 扩展：复制模板、改写 id/名称/路径、装依赖、跑一次 nsh check + build。
//
// 模板是唯一事实来源（仓库内来自 templates/extension-basic，npm 包里来自 template/）。
// 这个文件同时被仓库脚本 scripts/create-extension.mjs 与 npm CLI 复用。
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const KIT_NAME = "@navop/extension-kit";

export function slugOf(id) {
  return id.split(".").pop();
}

export function parseArgs(argv) {
  const args = { force: false, build: true, vendorLib: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--id":
        args.id = argv[++i];
        break;
      case "--name":
        args.name = argv[++i];
        break;
      case "--publisher":
        args.publisher = argv[++i];
        break;
      case "--dir":
        args.dir = argv[++i];
        break;
      case "--force":
        args.force = true;
        break;
      case "--skip-build":
        args.build = false;
        break;
      case "--vendor-lib":
        args.vendorLib = true;
        break;
      case "--no-install":
        args.noInstall = true;
        break;
      default:
        throw new Error(`未知参数：${arg}`);
    }
  }
  return args;
}

export function validate(args, templateDir) {
  if (!args.id) throw new Error("缺少 --id");
  if (!args.name) throw new Error("缺少 --name");
  if (!/^[a-z0-9_]+(\.[a-z0-9_-]+)+$/.test(args.id)) {
    throw new Error(`id 不合法：${args.id}（需要反向域名小写，如 com.example.demo）`);
  }
  if (!existsSync(templateDir)) throw new Error(`模板目录不存在：${templateDir}`);
}

async function copyTree(from, to) {
  await mkdir(path.dirname(to), { recursive: true });
  await cp(from, to, {
    recursive: true,
    filter: (source) => {
      const base = path.basename(source);
      return base !== ".nsh" && base !== "node_modules" && base !== "dist";
    },
  });
}

async function rewriteJson(file, mutate) {
  const value = JSON.parse(await readFile(file, "utf8"));
  mutate(value);
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

async function replaceIn(file, pairs) {
  let text = await readFile(file, "utf8");
  for (const [from, to] of pairs) text = text.split(from).join(to);
  await writeFile(file, text);
}

/** 把 kit 的源码复制进 ui/lib，并把转发改成相对导入（离线 / 内网场景）。 */
async function vendorKit(kitDir, uiDir) {
  let files;
  try {
    files = await readdir(kitDir);
  } catch {
    throw new Error(`--vendor-lib 需要 kit 源码目录：${kitDir} 不存在`);
  }
  const lib = path.join(uiDir, "lib");
  for (const file of files) {
    if (!/\.(ts|tsx)$/.test(file) || file === "index.ts") continue;
    await cp(path.join(kitDir, file), path.join(lib, file));
  }
  const rewrites = [
    [`"${KIT_NAME}"`, `"./navop"`],
    [`"${KIT_NAME}/ui"`, `"./ui"`],
    [`"${KIT_NAME}/theme"`, `"./theme"`],
    [`"${KIT_NAME}/format"`, `"./format"`],
    [`"${KIT_NAME}/testing"`, `"./testing"`],
  ];
  for (const file of ["navop.ts", "theme.ts", "format.ts", "ui.tsx", "test-host.ts"]) {
    const p = path.join(lib, file);
    if (existsSync(p)) await replaceIn(p, rewrites);
  }
  // vendor 后不再需要包依赖
  await rewriteJson(path.join(uiDir, "package.json"), (pkg) => {
    delete pkg.dependencies;
  });
}

export async function createExtension({ argv, templateDir, kitDir, repoRoot, nsh = process.env.NSH ?? "nsh" }) {
  const args = parseArgs(argv);
  validate(args, templateDir);

  const slug = slugOf(args.id);
  const root = repoRoot ?? process.cwd();
  const target = path.resolve(root, args.dir ?? path.join("extensions", "composite", slug));
  const display = (p) =>
    path.relative(root, p).startsWith("..") ? p : path.relative(root, p) || ".";
  const inRepo = path.relative(root, target).split(path.sep)[0] !== "..";

  if (existsSync(target) && !args.force) {
    throw new Error(`目标目录已存在：${target}（加 --force 覆盖）`);
  }
  if (existsSync(target)) {
    await rm(target, { recursive: true, force: true });
  }

  await copyTree(templateDir, target);

  await rewriteJson(path.join(target, "extension.json"), (manifest) => {
    manifest.id = args.id;
    manifest.name = args.name;
    manifest.publisher = args.publisher ?? "Your Name";
    manifest.description = `${args.name}：由 Navop 扩展模板生成，一个插件一个 nsh app。`;
    manifest.contributes.shellApp.title = args.name;
    manifest.contributes.shellApp.description = `${args.name} 的入口页面`;
  });

  await rewriteJson(path.join(target, "extension.build.json"), (build) => {
    build.id = slug;
    build.package = slug;
    build.path = display(target);
    build.releaseTagPrefix = `${slug}-v`;
    build.r2Prefix = `extensions/${slug}`;
  });

  await rewriteJson(path.join(target, "ui", "nsh.json"), (app) => {
    app.id = args.id;
    app.name = args.name;
  });

  await rewriteJson(path.join(target, "ui", "package.json"), (pkg) => {
    pkg.name = `@navop-ext/${slug}-ui`;
    pkg.dependencies = pkg.dependencies ?? {};
    pkg.dependencies[KIT_NAME] = inRepo && !args.vendorLib ? "*" : "^0.1.0";
  });

  await replaceIn(path.join(target, "ui", "lib", "test-host.ts"), [
    ["com.example.template", args.id],
    ["扩展模板", args.name],
  ]);
  await replaceIn(path.join(target, "README.md"), [
    ["# Navop 扩展模板（extension-basic）", `# ${args.name}`],
  ]);
  if (existsSync(path.join(target, "ui", "README.md"))) {
    await replaceIn(path.join(target, "ui", "README.md"), [["扩展模板", args.name]]);
  }

  process.stdout.write(`\n✓ 已生成 ${display(target)}（id: ${args.id}）\n`);

  if (args.vendorLib) {
    await vendorKit(kitDir, path.join(target, "ui"));
    process.stdout.write(`✓ 已把 kit 源码复制进 ${display(path.join(target, "ui", "lib"))}（离线可用）\n`);
  } else if (!args.noInstall) {
    const installDir = inRepo ? root : path.join(target, "ui");
    const result = spawnSync("npm", ["install", "--no-audit", "--no-fund"], {
      cwd: installDir,
      stdio: "inherit",
    });
    if (result.error || result.status !== 0) {
      process.stdout.write(
        `\n⚠ npm install 失败；如果 ${KIT_NAME} 还没发布，可加 --vendor-lib 重新生成（把 kit 源码复制进 ui/lib）。\n`,
      );
    }
  }

  if (args.build) {
    run(nsh, ["check", "ui"], target);
    run(nsh, ["build", ".", "--out", "dist"], path.join(target, "ui"));
  }

  process.stdout.write(`
下一步：
  cd ${display(target)}
  nsh test ui               # 外壳 + 全部页面测试（递归）
  nsh test ui/pages/home    # 只跑单页
  bash scripts/build.sh     # 重新构建 ui/dist/bundle.js

装进本地宿主（在扩展仓库根执行）：
  bash scripts/install-local-composite-extensions.sh ${slug}
`);
  return target;
}

function run(command, args, cwd) {
  process.stdout.write(`\n$ ${command} ${args.join(" ")}  \x1b[2m(${cwd})\x1b[0m\n`);
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw new Error(`无法执行 ${command}：${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} 失败（exit ${result.status}）`);
}
