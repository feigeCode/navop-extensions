#!/usr/bin/env node
/**
 * 校验 navop-extensions 仓库内全部 extension.json 是否符合
 * extension-manifest.schema.json。
 *
 * 用法：node scripts/check-manifests.mjs [glob...]
 * 默认扫描 extensions/ 下所有 extension.json。
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(pkgRoot, '../..');

const defaultTargets = [
  path.join(repoRoot, 'extensions/**/extension.json'),
];

const patterns = process.argv.length > 2 ? process.argv.slice(2) : defaultTargets;

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(
  JSON.parse(await readFile(path.join(pkgRoot, 'schema/extension-manifest.schema.json'), 'utf8')),
);

// Node 20 的 fs/promises 没有 glob（Node 22 才加入），而且 CI 的
// repo-checks job 固定在 Node 20，所以这里自带一个最小实现：
// 支持 `*`、`?` 和跨目录的 `**`，够覆盖仓库里 extensions 的扫描模式。
function globToRegExp(pattern) {
  let re = '';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        // `**/` 匹配零到多级目录
        re += '(?:[^/]+/)*';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (ch === '*') {
      re += '[^/]*';
    } else if (ch === '?') {
      re += '[^/]';
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

async function walk(dir, out) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
}

async function collect(pattern) {
  const resolved = path.resolve(pattern);
  const normalized = resolved.split(path.sep).join('/');
  const segments = normalized.split('/');
  const magicIndex = segments.findIndex((segment) => /[*?]/.test(segment));

  if (magicIndex === -1) {
    try {
      if ((await stat(resolved)).isFile()) return [resolved];
    } catch {
      // 不存在的字面量路径交给调用方报 “no extension.json found”
    }
    return [];
  }

  // 通配符之前的部分就是遍历根，避免从盘符/根目录全量遍历
  const base = segments.slice(0, magicIndex).join('/') || '/';
  const baseNative =
    process.platform === 'win32' ? base.split('/').join(path.sep) : base;
  const matcher = globToRegExp(normalized);
  const candidates = [];
  await walk(baseNative, candidates);
  return candidates.filter((file) => matcher.test(file.split(path.sep).join('/')));
}

const files = (
  await Promise.all(patterns.map(collect))
).flat();

if (files.length === 0) {
  console.error(`no extension.json found for patterns: ${patterns.join(', ')}`);
  process.exit(1);
}

let failed = 0;
for (const file of files) {
  const manifest = JSON.parse(await readFile(file, 'utf8'));
  if (!validate(manifest)) {
    failed++;
    console.error(`✗ ${path.relative(repoRoot, file)}`);
    for (const error of validate.errors ?? []) {
      console.error(
        `  ${error.instancePath || '(root)'} ${error.message}${
          error.params && Object.keys(error.params).length
            ? ` ${JSON.stringify(error.params)}`
            : ''
        }`,
      );
    }
  }
}

console.log(
  failed === 0
    ? `✓ ${files.length} manifests valid`
    : `${failed}/${files.length} manifests invalid`,
);
process.exit(failed === 0 ? 0 : 1);
