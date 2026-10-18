


import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MACHINE_WRITTEN_PATH_INVENTORY } from '../../fixtures/durable-state-inventory.js';
import { createRequire } from 'node:module';
const _require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
const RUNTIME_LIB = path.join(ROOT, 'src');
const DIRECT_JSON_EXCEPTIONS = new Map([
  ['src/adapters/verification/temp-root-registry.ts:manifestPath', 'coverage-manifest'],
  ['src/adapters/review/setup-review-config.ts:configPath', 'workflow-config'],
  ['src/adapters/agents/qwen.ts:targetSettings', 'qwen-settings'],
  ['src/adapters/backlog/legacy-mission-import.ts:archiveFile', 'legacy-task-body-archive'],
]);

function directJsonWritesInLib(libDir: string): string[] {
  // This child only parses source text; it executes no production modules.
  // Avoid instrumenting the external TypeScript compiler. Product coverage
  // remains owned by the covered worker, including its unchanged denominator.
  const result = spawnSync(process.execPath, [path.join(ROOT, 'test/lib/direct-json-writes.mjs'), libDir], {
    encoding: 'utf8', timeout: 3000,
    env: { ...process.env, NODE_V8_COVERAGE: '' },
  });
  assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

test('durable-state inventory assigns every required path exactly one recognized class', () => {
  const classes = new Set(['durable-state', 'user-authored-content', 'generated-output', 'cache-scratch-data', 'secrets-configuration']);
  const ids = new Set(MACHINE_WRITTEN_PATH_INVENTORY.map(entry => entry.id));
  for (const required of ['session-metadata', 'nel-record', 'forgejo-token']) {
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
  assert.deepEqual([...new Set(writes)].sort(), [...DIRECT_JSON_EXCEPTIONS.keys()].sort());
  for (const inventoryId of DIRECT_JSON_EXCEPTIONS.values()) {
    const row = MACHINE_WRITTEN_PATH_INVENTORY.find(entry => entry.id === inventoryId);
    assert.ok(row != null);
    assert.match(row.persistencePolicy, /direct-write exception/);
  }
});

test('direct durable JSON write guard rejects a new non-inventoried lib writer', () => {
  const fixtureRoot = fs.mkdtempSync(path.join(_require('node:os').tmpdir(), 'durable-policy-'));
  const fixture = path.join(fixtureRoot, 'lib', 'tools', 'new-state.ts');
  try {
    fs.mkdirSync(path.dirname(fixture), { recursive: true });
    fs.writeFileSync(fixture, "fs.writeFileSync(sessionFile(root, slug), JSON.stringify({ agent: 'codex' }));\n");
    fs.writeFileSync(path.join(fixtureRoot, 'lib', 'decoy.ts'),
      '// fs.writeFileSync(path, JSON.stringify(value))\nconst example = "JSON.stringify writeFileSync";\n');
    const introduced = directJsonWritesInLib(path.join(fixtureRoot, 'lib'));
    const violations = introduced.filter((write: string) => !DIRECT_JSON_EXCEPTIONS.has(write));
    assert.deepEqual(violations, ['lib/tools/new-state.ts:sessionFile(root, slug)']);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
