#!/usr/bin/env node

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, 'build');
const output = path.join(buildDir, 'px.mjs');
const rollbackDir = path.join(root, 'dist');

fs.rmSync(buildDir, { recursive: true, force: true });
fs.mkdirSync(buildDir, { recursive: true });

esbuild.buildSync({
  absWorkingDir: root,
  entryPoints: ['src/entry/px.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22.23',
  outfile: output,
  sourcemap: true,
  sourcesContent: true,
  legalComments: 'none',
  packages: 'bundle',
  logLevel: 'error',
  banner: {
    js: "import { fileURLToPath as __pxFileURLToPath } from 'node:url'; import { dirname as __pxDirname } from 'node:path'; import { createRequire as __pxCreateRequire } from 'node:module'; const __filename = __pxFileURLToPath(import.meta.url); const __dirname = __pxDirname(__filename); const module = { exports: {} }; const require = __pxCreateRequire(import.meta.url);",
  },
});

const assets = { version: 1, assets: [] };
assets.assets = [
  'config/agents.json',
  'config/state-map.json',
  'prompts/act-on-review.md',
  'prompts/draft.md',
  'prompts/execute.md',
  'prompts/review.md',
  'templates/mission-scaffold.md',
].map(key => ({ key, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, key))).digest('hex') }));
fs.writeFileSync(path.join(buildDir, 'asset-manifest.json'), `${JSON.stringify(assets, null, 2)}\n`);

const files = fs.readdirSync(buildDir).filter(file => file !== 'manifest.sha256').sort();
const manifest = files.map(file => {
  const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(buildDir, file))).digest('hex');
  return `${digest}  ${file}`;
});
fs.writeFileSync(path.join(buildDir, 'manifest.sha256'), `${manifest.join('\n')}\n`);

function collectTypeScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) { return collectTypeScriptFiles(filePath); }
    return entry.isFile() && entry.name.endsWith('.ts') ? [filePath] : [];
  });
}

function emitCommonJsTree(sourceRoot, outputRoot) {
  for (const sourcePath of collectTypeScriptFiles(sourceRoot)) {
    const relative = path.relative(sourceRoot, sourcePath);
    const outputPath = path.join(outputRoot, relative.replace(/\.ts$/, '.js'));
    const result = esbuild.transformSync(fs.readFileSync(sourcePath, 'utf8'), {
      loader: 'ts',
      format: 'cjs',
      platform: 'node',
      target: 'node22.23',
      sourcemap: 'external',
      sourcesContent: true,
      legalComments: 'none',
      sourcefile: path.relative(root, sourcePath),
    });
    const adjustedCode = result.code
      .replace('../../../assets/runtime-assets.js', '../../assets/runtime-assets.js')
      .replace('../runtime/lib/core/package-root.js', '../lib/core/package-root.js')
      .replace('../../../package.json', '../package.json');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, adjustedCode, 'utf8');
    fs.writeFileSync(`${outputPath}.map`, result.map, 'utf8');
  }
}

// The CommonJS outputs remain an explicit, removable rollback shim until the
// TASK-2285 npm-package compatibility gate authorizes its deletion. esbuild is
// still the only production JavaScript emitter; TypeScript remains no-emit.
fs.rmSync(rollbackDir, { recursive: true, force: true });
emitCommonJsTree(path.join(root, 'src', 'platform', 'runtime'), rollbackDir);
emitCommonJsTree(path.join(root, 'src', 'platform', 'assets'), path.join(rollbackDir, 'assets'));
