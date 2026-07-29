#!/usr/bin/env node
// Emit only runtime library modules for the test harness. Unlike the product's
// ESM bundle, TypeScript's CommonJS transform exposes writable exports so
// node:test's mock.method() can replace legacy dependencies safely.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(root, 'src', 'platform', 'runtime', 'lib');
// Keep mutable CommonJS test modules in their own ignored tree. Integration
// tests may invoke `npm run build` concurrently, which rewrites build/px.mjs;
// the test runtime must not race with that product artifact.
const testRuntimeRoot = path.join(root, '.test-runtime');
const outputRoot = path.join(testRuntimeRoot, 'lib');
const assetSourceRoot = path.join(root, 'src', 'platform', 'assets');
const assetOutputRoot = path.join(testRuntimeRoot, 'assets');
const applicationSourceRoot = path.join(root, 'src', 'application');
const applicationOutputRoot = path.join(testRuntimeRoot, 'application');
const adapterSourceRoot = path.join(root, 'src', 'adapters');
const adapterOutputRoot = path.join(testRuntimeRoot, 'adapters');
// The application and adapter layers import domain *values* (rule violations,
// factories, policy), not only erasable types, so the domain tree must be part
// of the CommonJS test runtime as well.
const domainSourceRoot = path.join(root, 'src', 'domain');
const domainOutputRoot = path.join(testRuntimeRoot, 'domain');

function collectTypeScriptFiles(directory: string): string[] {
  const files: string[] = [];
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
  [adapterSourceRoot, adapterOutputRoot],
  [domainSourceRoot, domainOutputRoot],
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
    const applicationAdjustedOutput = assetAdjustedOutput
      .replace(/\.\.\/\.\.\/\.\.\/\.\.\/application\//g, '../../application/')
      .replace(/\.\.\/\.\.\/\.\.\/\.\.\/adapters\//g, '../../adapters/')
      .replace(/\.\.\/\.\.\/\.\.\/\.\.\/domain\//g, '../../domain/');
    const adapterAdjustedOutput = applicationAdjustedOutput
      .replace(/\.\.\/\.\.\/platform\/runtime\/lib\//g, '../../lib/');
    const cjsSafeOutput = adapterAdjustedOutput
      .replace(/import\.meta\.url \? [^:;]+ : __dirname/g, '__dirname');
    const outputText = sourcePath.endsWith(`${path.sep}runtime-assets.ts`)
      ? cjsSafeOutput.replace('../runtime/lib/core/package-root.js', '../lib/core/package-root.js')
      : cjsSafeOutput;
    fs.writeFileSync(outputPath, outputText, 'utf8');
  }
}
