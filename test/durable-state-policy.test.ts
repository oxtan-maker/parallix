


import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
const MACHINE_WRITTEN_PATH_INVENTORYModule = mockModule<typeof import('./fixtures/durable-state-inventory.js')>('./fixtures/durable-state-inventory.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const { MACHINE_WRITTEN_PATH_INVENTORY } = MACHINE_WRITTEN_PATH_INVENTORYModule;
const ROOT = path.resolve(import.meta.dirname, '..');
const RUNTIME_LIB = path.join(ROOT, 'src');
const DIRECT_JSON_EXCEPTIONS = new Map([
  ['src/adapters/verification/coverage-gate.ts:coverageManifestPath()', 'coverage-manifest'],
  ['src/adapters/verification/mutation-gate.ts:baselinePath', 'mutation-baseline'],
  ['src/adapters/verification/mutation-gate.ts:configPath', 'mutation-run-config'],
  ['src/adapters/review/setup-review.ts:configPath', 'workflow-config'],
]);

function directJsonWrites(file, source) {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const writes = [];
  function visit(node) {
    if (ts.isCallExpression(node) && /\.writeFileSync$/.test(node.expression.getText(sourceFile))) {
      const body = node.arguments.slice(1).map(arg => arg.getText(sourceFile)).join(' ');
      if (/\bJSON\.stringify\s*\(/.test(body)) {
        writes.push(`${file}:${node.arguments[0].getText(sourceFile)}`);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return writes;
}

function typeScriptFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...typeScriptFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

function directJsonWritesInLib(libDir) {
  const repoRoot = path.dirname(libDir);
  return typeScriptFiles(libDir).flatMap(file =>
    directJsonWrites(path.relative(repoRoot, file), fs.readFileSync(file, 'utf8'))
  );
}

test('durable-state inventory assigns every required path exactly one recognized class', () => {
  const classes = new Set(['durable-state', 'user-authored-content', 'generated-output', 'cache-scratch-data', 'secrets-configuration']);
  const ids = new Set(MACHINE_WRITTEN_PATH_INVENTORY.map(entry => entry.id));
  for (const required of ['session-metadata', 'nel-record', 'mutation-run-config', 'forgejo-token']) {
    assert.ok(ids.has(required), `missing inventory row: ${required}`);
  }
  for (const entry of MACHINE_WRITTEN_PATH_INVENTORY) {
    assert.ok(classes.has(entry.classification), `${entry.id} has an invalid classification`);
  }
});

test('direct durable JSON write guard passes only inventory-documented exceptions', () => {
  // The guard intentionally covers every authored runtime TypeScript source in
  // the canonical production layers. It detects
  // inline JSON.stringify/writeFileSync pairs, not pre-serialized or async writes.
  const writes = directJsonWritesInLib(RUNTIME_LIB);
  assert.deepEqual(writes.sort(), [...DIRECT_JSON_EXCEPTIONS.keys()].sort());
  for (const inventoryId of DIRECT_JSON_EXCEPTIONS.values()) {
    const row = MACHINE_WRITTEN_PATH_INVENTORY.find(entry => entry.id === inventoryId);
    assert.match(row.persistencePolicy, /direct-write exception/);
  }
});

test('direct durable JSON write guard rejects a new non-inventoried lib writer', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(_require('node:os').tmpdir(), 'durable-policy-'));
  const fixture = path.join(fixtureRoot, 'lib', 'tools', 'new-state.ts');
  try {
    fs.mkdirSync(path.dirname(fixture), { recursive: true });
    fs.writeFileSync(fixture, "fs.writeFileSync(sessionFile(root, slug), JSON.stringify({ agent: 'codex' }));\n");
    const introduced = directJsonWritesInLib(path.join(fixtureRoot, 'lib'));
    const violations = introduced.filter(write => !DIRECT_JSON_EXCEPTIONS.has(write));
    assert.deepEqual(violations, ['lib/tools/new-state.ts:sessionFile(root, slug)']);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
