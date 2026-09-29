import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { used } from '../src/mod.ts';
test('used', () => {
  assert.equal(used(1), 1);
  // grandchild process loads the module too
  const r = spawnSync(process.execPath, ['--import', 'tsx', '-e', "import('./src/mod.ts').then(m => m.used(20))"], { stdio: 'inherit' });
  assert.equal(r.status, 0);
});
