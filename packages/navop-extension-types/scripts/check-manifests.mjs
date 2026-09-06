#!/usr/bin/env node
/**
 * 校验 navop-extensions 仓库内全部 extension.json 是否符合
 * extension-manifest.schema.json。
 *
 * 用法：node scripts/check-manifests.mjs [glob...]
 * 默认扫描 extensions/ 下所有 extension.json。
 */
import { readFile, glob } from 'node:fs/promises';
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

async function collect(pattern) {
  const out = [];
  for await (const entry of glob(pattern)) out.push(entry);
  return out;
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
