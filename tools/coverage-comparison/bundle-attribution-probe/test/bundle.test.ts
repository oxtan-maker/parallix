import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
test('bundle', () => {
  const r = spawnSync(process.execPath, ['build/px.mjs'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
});
