#!/usr/bin/env node
'use strict';

// Emit only runtime library modules for the test harness. Unlike the product's
// ESM bundle, TypeScript's CommonJS transform exposes writable exports so
// node:test's mock.method() can replace legacy dependencies safely.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const sourceRoot = path.join(root, 'src', 'platform', 'runtime', 'lib');
// Keep mutable CommonJS test modules separate from the production rollback
// shim. Integration tests may invoke `npm run build` concurrently, which
// recreates dist/ as an ESM-compatible product artifact.
const testRuntimeRoot = path.join(root, '.test-runtime');
const outputRoot = path.join(testRuntimeRoot, 'lib');
const assetSourceRoot = path.join(root, 'src', 'platform', 'assets');
const assetOutputRoot = path.join(testRuntimeRoot, 'assets');
const applicationSourceRoot = path.join(root, 'src', 'application');
const applicationOutputRoot = path.join(testRuntimeRoot, 'application');

function collectTypeScriptFiles(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTypeScriptFiles(filePath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(filePath);
    }
  }
  return files;
}

// The root package is ESM after TASK-2285; these emitted modules are CommonJS
// .js, so the test runtime carries its own type marker.
fs.mkdirSync(testRuntimeRoot, { recursive: true });
fs.writeFileSync(path.join(testRuntimeRoot, 'package.json'), `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`);

for (const [inputRoot, outputRootForSource] of [
  [sourceRoot, outputRoot],
  [assetSourceRoot, assetOutputRoot],
  [applicationSourceRoot, applicationOutputRoot],
]) {
  fs.rmSync(outputRootForSource, { recursive: true, force: true });
  for (const sourcePath of collectTypeScriptFiles(inputRoot)) {
    const relative = path.relative(inputRoot, sourcePath);
    const outputPath = path.join(outputRootForSource, relative.replace(/\.ts$/, '.js'));
  const result = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2024,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
      sourceMap: false
    },
    fileName: sourcePath
  });
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const assetAdjustedOutput = result.outputText.replace('../../../assets/runtime-assets.js', '../../assets/runtime-assets.js');
    const outputText = sourcePath.endsWith(`${path.sep}runtime-assets.ts`)
      ? assetAdjustedOutput.replace('../runtime/lib/core/package-root.js', '../lib/core/package-root.js')
      : assetAdjustedOutput;
    fs.writeFileSync(outputPath, outputText, 'utf8');
  }
}
