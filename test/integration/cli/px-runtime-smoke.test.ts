import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { SOURCE_PX, pxNodeArgs } from '../../lib/px-entry.js';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');

test('px runtime smoke test verifies the source entrypoint executes without module resolution errors', () => {
  // Source uses NodeNext .js specifiers; exercise the configured source loader
  // even in prebuilt lanes, where the bundle would hide source resolution errors.
  const result = spawnSync(process.execPath, pxNodeArgs(SOURCE_PX, ['--version']), {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const output = `${result.stdout || ''}${result.stderr || ''}`;

  assert.equal(result.status, 0, output);
  assert.doesNotMatch(output, /ERR_MODULE_NOT_FOUND/);
});
