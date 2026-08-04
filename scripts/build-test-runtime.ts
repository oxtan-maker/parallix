#!/usr/bin/env node
// Emit the canonical production layers for the test harness. Unlike the product's
// ESM bundle, TypeScript's CommonJS transform exposes writable exports so
// node:test's mock.method() can replace legacy dependencies safely.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as ts from 'typescript';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Keep mutable CommonJS test modules in their own ignored tree. Integration
// tests may invoke `npm run build` concurrently, which rewrites build/px.mjs;
// the test runtime must not race with that product artifact or another test
// runtime build. Generate into a private staging tree and swap it into place
// only after every emitted module is complete.
const testRuntimeRoot = path.join(root, '.test-runtime');
const stagingRoot = fs.mkdtempSync(path.join(root, '.test-runtime.staging-'));
const sourceRoot = path.join(root, 'src');

function collectFilesWithExtension(directory: string, extension: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectFilesWithExtension(filePath, extension));
    } else if (entry.isFile() && entry.name.endsWith(extension)) {
      files.push(filePath);
    }
  }
  return files;
}

function collectTypeScriptFiles(directory: string): string[] {
  return [
    ...collectFilesWithExtension(directory, '.ts'),
    ...collectFilesWithExtension(directory, '.tsx'),
  ];
}

// The root package is ESM after TASK-2285; these emitted modules are CommonJS
// .js, so the test runtime carries its own type marker.
fs.writeFileSync(path.join(stagingRoot, 'package.json'), `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`);

for (const sourcePath of collectTypeScriptFiles(sourceRoot)) {
    const relative = path.relative(sourceRoot, sourcePath);
    const outputPath = path.join(stagingRoot, relative.replace(/\.tsx?$/, '.js'));
    const result = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2024,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
        sourceMap: false,
        jsx: ts.JsxEmit.ReactJSX,
      },
      fileName: sourcePath
    });
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const cjsSafeOutput = result.outputText
      .replace(/import\.meta\.url \? [^:;]+ : __dirname/g, '__dirname')
      .replace(/\(0, [^)]+\.fileURLToPath\)\(import\.meta\.url\)/g, '__filename')
      // Remove "const __filename = __filename;" lines that shadow the CJS global
      .replace(/^(\s*)const __filename = __filename;\s*$/gm, '$1');
    fs.writeFileSync(outputPath, cjsSafeOutput, 'utf8');
}

// SQL migrations are read from disk at runtime (loadDefaultMigrations resolves
// `migrations/` relative to the emitted module), so they must travel with the
// transpiled tree. The product bundle inlines them instead.
for (const sourcePath of collectFilesWithExtension(sourceRoot, '.sql')) {
    const outputPath = path.join(stagingRoot, path.relative(sourceRoot, sourcePath));
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.copyFileSync(sourcePath, outputPath);
}

// Keep readers on the previous complete runtime until the replacement is
// ready. The rename of the staging directory is atomic on the supported local
// filesystems, so readers cannot observe a partially emitted runtime.
const previousRoot = `${testRuntimeRoot}.previous-${process.pid}`;
try {
  fs.rmSync(previousRoot, { recursive: true, force: true });
  if (fs.existsSync(testRuntimeRoot)) {
    fs.renameSync(testRuntimeRoot, previousRoot);
  }
  fs.renameSync(stagingRoot, testRuntimeRoot);
  fs.rmSync(previousRoot, { recursive: true, force: true });
} catch (error) {
  fs.rmSync(stagingRoot, { recursive: true, force: true });
  if (!fs.existsSync(testRuntimeRoot) && fs.existsSync(previousRoot)) {
    fs.renameSync(previousRoot, testRuntimeRoot);
  }
  throw error;
}
