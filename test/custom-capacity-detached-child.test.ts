import test from 'node:test';
import assert from 'node:assert/strict';
import { processIdentity, isSameLiveProcess } from '../src/adapters/process/process-liveness.js';

test('a lease liveness identity rejects a reused PID', () => {
  const identity = processIdentity(process.pid);
  assert.ok(identity);
  assert.equal(isSameLiveProcess(process.pid, identity.startId), true);
  assert.equal(isSameLiveProcess(process.pid, `${Number(identity.startId) + 1}`), false);
});
