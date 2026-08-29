import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('task-2424: BoardShell releases live projection callbacks on unmount', () => {
  const result = spawnSync(process.execPath, [
    '--import', 'tsx', '--input-type=module', '--eval',
    "import { run } from './test/task-2424-repro-body.ts'; await run();",
  ], { cwd: process.cwd(), encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
});
