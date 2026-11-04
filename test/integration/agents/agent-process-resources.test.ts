import test from 'node:test';
import assert from 'node:assert/strict';

import { spawnAndTee } from '../../../src/adapters/process/spawn-tee.js';

test('agent subprocess accounting measures the waited process tree without leaking into output (TASK-2835)', async () => {
  const burn = "const start=process.cpuUsage();while(process.cpuUsage(start).user+process.cpuUsage(start).system<30000){}";
  const script = `require('node:child_process').spawnSync(process.execPath,['-e',${JSON.stringify(burn)}]);${burn};process.stderr.write('agent-stderr')`;
  const result = await spawnAndTee(process.execPath, ['-e', script], {
    stdoutSink: { write() {} }, stderrSink: { write() {} },
    resourceBoundary: { boundary: 'agent-run', parent: null },
  });

  assert.equal(result.status, 0);
  assert.equal(result.stderr, 'agent-stderr');
  assert.equal(result.processTreeCpu?.provenance, 'bash-time-waited-tree');
  assert.equal(result.processTreeCpu?.boundary, 'agent-run');
  assert.ok((result.processTreeCpu?.userUs ?? 0) + (result.processTreeCpu?.systemUs ?? 0) >= 50_000,
    'the observation includes actual child and descendant CPU');
});
