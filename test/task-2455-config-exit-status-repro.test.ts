import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pxNodeArgs, resolvePxEntryLoader } from './lib/px-entry.js';

const PX = resolvePxEntryLoader();

function runConfig(contents: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2455-config-'));
  try {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), contents);
    return childProcess.spawnSync(process.execPath, pxNodeArgs(PX, ['config']), { cwd: root, encoding: 'utf8' });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('px config keeps a non-zero exit status for malformed JSON while printing fallback output', () => {
  const result = runConfig('{ invalid');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /invalid JSON/);
  assert.match(result.stdout, /"product"/);
});

test('px config keeps a non-zero exit status for structurally invalid JSON while printing fallback output', () => {
  const result = runConfig(JSON.stringify({ adapters: [] }));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /structurally invalid/);
  assert.match(result.stdout, /"product"/);
});
