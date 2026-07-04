#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const hostQueryRoot = path.resolve(repoRoot, "../onetcli/crates/ui/src/highlighter/languages");
const cargoHome = process.env.CARGO_HOME || path.join(os.homedir(), ".cargo");
const cargoSrcRoot = path.join(cargoHome, "registry/src");

const languages = [
  lang("astro", "tree-sitter-astro-next", ["astro"]),
  lang("c", "tree-sitter-c", ["c", "h"]),
  lang("cmake", "tree-sitter-cmake", ["cmake"]),
  lang("cpp", "tree-sitter-cpp", ["cpp", "cc", "cxx", "hpp", "hxx"]),
  lang("csharp", "tree-sitter-c-sharp", ["cs"], { functionFrom: "c_sharp" }),
  lang("css", "tree-sitter-css", ["css", "scss"]),
  lang("diff", "tree-sitter-diff", ["diff", "patch"]),
  lang("ejs", "tree-sitter-embedded-template", ["ejs"], { functionFrom: "embedded_template" }),
  lang("elixir", "tree-sitter-elixir", ["ex", "exs"]),
  lang("erb", "tree-sitter-embedded-template", ["erb"], { functionFrom: "embedded_template" }),
  lang("go", "tree-sitter-go", ["go"]),
  lang("graphql", "tree-sitter-graphql", ["graphql", "gql"]),
  lang("html", "tree-sitter-html", ["html", "htm"]),
  lang("java", "tree-sitter-java", ["java"]),
  lang("javascript", "tree-sitter-javascript", ["js", "mjs", "cjs"]),
  lang("jsdoc", "tree-sitter-jsdoc", ["jsdoc"]),
  lang("kotlin", "tree-sitter-kotlin-sg", ["kt", "kts", "ktm"]),
  lang("lua", "tree-sitter-lua", ["lua"]),
  lang("make", "tree-sitter-make", ["mk", "mak", "makefile"]),
  lang("markdown", "tree-sitter-md", ["md", "markdown", "mdx"], { subdir: "tree-sitter-markdown" }),
  lang("markdown_inline", "tree-sitter-md", [], { subdir: "tree-sitter-markdown-inline" }),
  lang("php", "tree-sitter-php", ["php", "php3", "php4", "php5", "phtml"], { subdir: "php" }),
  lang("proto", "tree-sitter-proto", ["proto"]),
  lang("python", "tree-sitter-python", ["py", "pyw"]),
  lang("ruby", "tree-sitter-ruby", ["rb"]),
  lang("rust", "tree-sitter-rust", ["rs"]),
  lang("scala", "tree-sitter-scala", ["scala", "sc"]),
  lang("svelte", "tree-sitter-svelte-next", ["svelte"]),
  lang("swift", "tree-sitter-swift", ["swift"]),
  lang("toml", "tree-sitter-toml-ng", ["toml"]),
  lang("tsx", "tree-sitter-typescript", ["tsx"], { subdir: "tsx" }),
  lang("typescript", "tree-sitter-typescript", ["ts"], { subdir: "typescript" }),
  lang("yaml", "tree-sitter-yaml", ["yaml", "yml"]),
  lang("zig", "tree-sitter-zig", ["zig"]),
];

main();

function main() {
  const args = new Set(process.argv.slice(2));
  const buildWasm = args.has("--build-wasm");
  const metadataOnly = args.has("--metadata-only");
  if (args.has("--help") || (!buildWasm && !metadataOnly)) {
    printUsage();
    process.exit(args.has("--help") ? 0 : 2);
  }

  for (const entry of languages) {
    syncLanguage(entry, { buildWasm });
  }
  syncRootManifest();
}

function printUsage() {
  console.log(`Usage: node scripts/sync-tree-sitter-language-extensions.mjs --metadata-only|--build-wasm

Generate extensions/language/<id> metadata and optional parser.wasm files from
locally cached tree-sitter grammar crates. Use --metadata-only to refresh JSON
and query files without invoking the tree-sitter CLI.`);
}

function lang(id, crateName, fileExtensions, options = {}) {
  return {
    id,
    crateName,
    fileExtensions,
    subdir: options.subdir || "",
    functionFrom: options.functionFrom || "",
  };
}

function syncLanguage(entry, options) {
  const sourceDir = grammarDir(entry);
  const extensionDir = path.join(repoRoot, "extensions/language", entry.id);
  fs.mkdirSync(extensionDir, { recursive: true });

  writeJson(path.join(extensionDir, "extension.build.json"), {
    id: entry.id,
    kind: "language",
    language: "tree-sitter-wasm",
    path: `extensions/language/${entry.id}`,
    targets: ["universal"],
    releaseTagPrefix: `${entry.id}-v`,
    r2Prefix: `extensions/${entry.id}`,
  });

  const manifest = {
    name: entry.id,
    version: grammarVersion(sourceDir),
    file_extensions: entry.fileExtensions,
  };

  copyQueries(entry, sourceDir, extensionDir);

  if (options.buildWasm) {
    const buildDir = prepareBuildDir(entry, sourceDir);
    const output = path.join(extensionDir, "parser.wasm");
    buildParserWasm(entry, buildDir, output);
    manifest.sha256_wasm = sha256File(output);
  }

  const existingManifest = readJsonIfExists(path.join(extensionDir, "manifest.json"));
  if (existingManifest?.sha256_wasm && !manifest.sha256_wasm) {
    manifest.sha256_wasm = existingManifest.sha256_wasm;
  }
  writeJson(path.join(extensionDir, "manifest.json"), manifest);
}

function grammarDir(entry) {
  const crateDir = findLatestCrateDir(entry.crateName);
  return entry.subdir ? path.join(crateDir, entry.subdir) : crateDir;
}

function findLatestCrateDir(crateName) {
  if (!fs.existsSync(cargoSrcRoot)) {
    throw new Error(`Cargo registry source root not found: ${cargoSrcRoot}`);
  }

  const candidates = [];
  for (const registry of fs.readdirSync(cargoSrcRoot)) {
    const registryPath = path.join(cargoSrcRoot, registry);
    if (!fs.statSync(registryPath).isDirectory()) continue;
    for (const name of fs.readdirSync(registryPath)) {
      if (name === crateName || name.startsWith(`${crateName}-`)) {
        candidates.push(path.join(registryPath, name));
      }
    }
  }

  if (candidates.length === 0) {
    throw new Error(`Could not find cached grammar crate ${crateName} under ${cargoSrcRoot}`);
  }

  candidates.sort((left, right) => crateVersion(right).localeCompare(crateVersion(left), undefined, { numeric: true }));
  return candidates[0];
}

function crateVersion(crateDir) {
  const packageJson = readJsonIfExists(path.join(crateDir, "package.json"));
  if (packageJson?.version) return packageJson.version;
  const cargoToml = fs.readFileSync(path.join(crateDir, "Cargo.toml"), "utf8");
  return cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1] || "0.0.0";
}

function grammarVersion(sourceDir) {
  let dir = sourceDir;
  while (dir.startsWith(cargoSrcRoot)) {
    if (fs.existsSync(path.join(dir, "Cargo.toml"))) {
      return crateVersion(dir);
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return "0.1.0";
}

function copyQueries(entry, sourceDir, extensionDir) {
  for (const query of ["highlights.scm", "injections.scm", "locals.scm"]) {
    const source = querySource(entry, sourceDir, query);
    const target = path.join(extensionDir, query);
    if (source) {
      fs.copyFileSync(source, target);
    } else if (fs.existsSync(target)) {
      fs.rmSync(target);
    }
  }
}

function querySource(entry, sourceDir, query) {
  const hostSource = path.join(hostQueryRoot, entry.id, query);
  if (fs.existsSync(hostSource)) return hostSource;

  const grammarSource = path.join(sourceDir, "queries", query);
  if (fs.existsSync(grammarSource)) return grammarSource;

  return "";
}

function prepareBuildDir(entry, sourceDir) {
  if (!entry.functionFrom || entry.functionFrom === entry.id) {
    return sourceDir;
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `onetcli-${entry.id}-grammar-`));
  copyDir(sourceDir, tempDir);
  replaceParserSymbol(tempDir, entry.functionFrom, entry.id);
  return tempDir;
}

function buildParserWasm(entry, buildDir, output) {
  if (!entry.functionFrom && hasGrammarSource(buildDir)) {
    run("tree-sitter", ["build", "--wasm", "-o", output, buildDir]);
    return;
  }

  compileGeneratedParser(entry.id, buildDir, output);
}

function hasGrammarSource(buildDir) {
  return (
    fs.existsSync(path.join(buildDir, "grammar.js")) ||
    fs.existsSync(path.join(buildDir, "src/grammar.json"))
  );
}

function compileGeneratedParser(languageId, buildDir, output) {
  const srcDir = path.join(buildDir, "src");
  if (!fs.existsSync(path.join(srcDir, "parser.c"))) {
    throw new Error(`Missing generated parser.c for ${languageId}: ${srcDir}`);
  }

  const clang = path.join(wasiSdkPath(), "bin/clang");
  if (!fs.existsSync(clang)) {
    throw new Error(`Missing wasi-sdk clang: ${clang}`);
  }

  const args = [
    "--target=wasm32-unknown-wasi",
    "-o",
    output,
    "-fPIC",
    "-shared",
    "-Os",
    `-Wl,--export=tree_sitter_${languageId}`,
    "-Wl,--allow-undefined",
    "-Wl,--no-entry",
    "-nostdlib",
    "-fno-exceptions",
    "-fvisibility=hidden",
    "-I",
    ".",
    "parser.c",
  ];

  const scanner = ["scanner.c", "scanner.cc"].find((name) => fs.existsSync(path.join(srcDir, name)));
  if (scanner) {
    args.push(scanner);
  }

  run(clang, args, { cwd: srcDir });
}

function wasiSdkPath() {
  return process.env.TREE_SITTER_WASI_SDK_PATH || path.join(os.homedir(), ".cache/tree-sitter/wasi-sdk");
}

function replaceParserSymbol(root, from, to) {
  for (const relative of ["src/parser.c", "src/scanner.c", "src/scanner.cc"]) {
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, text.replaceAll(`tree_sitter_${from}`, `tree_sitter_${to}`));
  }
}

function copyDir(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === "target" || entry.name === "node_modules") continue;
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to);
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      fs.copyFileSync(from, to);
    }
  }
}

function sha256File(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function syncRootManifest() {
  const manifestPath = path.join(repoRoot, "manifest.json");
  const manifest = readJsonIfExists(manifestPath);
  if (!manifest || !Array.isArray(manifest.extensions)) {
    throw new Error(`Invalid root manifest: ${manifestPath}`);
  }

  const languageIds = new Set(languages.map((entry) => entry.id));
  const nonLanguageEntries = manifest.extensions.filter((entry) => !languageIds.has(entry.id));
  const languageEntries = languages.map((entry) => {
    const sourceManifest = readJsonIfExists(
      path.join(repoRoot, "extensions/language", entry.id, "manifest.json"),
    );
    if (!sourceManifest) {
      throw new Error(`Missing generated language manifest for ${entry.id}`);
    }
    return {
      id: entry.id,
      kind: "language",
      name: sourceManifest.name || entry.id,
      version: sourceManifest.version,
      release_tag: `${entry.id}-v${sourceManifest.version}`,
      description: `Tree-sitter ${entry.id} syntax highlighter`,
      file_extensions: sourceManifest.file_extensions || [],
      manifest: `${entry.id}/manifest.json`,
    };
  });

  manifest.extensions = [...nonLanguageEntries, ...languageEntries];
  writeJson(manifestPath, manifest);
}
