import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForCustomCapacity } from '../../../../src/adapters/agents/custom-capacity.js';

test('capacity admission waits through saturation and returns the acquired lease', async () => {
  const reservation = { bindChild() {}, release() {} };
  let attempts = 0;
  let notifications = 0;
  let pauses = 0;
  const result = await waitForCustomCapacity('/repo', () => { notifications++; }, async root => {
    assert.equal(root, '/repo');
    return ++attempts === 4 ? reservation : null;
  }, async () => { pauses++; });
  assert.equal(result, reservation);
  assert.equal(notifications, 1);
  assert.equal(pauses, 3);
});

test('capacity admission immediately returns a free lease and propagates storage failures', async () => {
  const reservation = { bindChild() {}, release() {} };
  const unexpected = () => { throw new Error('must not wait'); };
  assert.equal(await waitForCustomCapacity(undefined, unexpected, async () => reservation, unexpected), reservation);
  await assert.rejects(waitForCustomCapacity(undefined, unexpected, async () => {
    throw new Error('storage unavailable');
  }), /storage unavailable/);
});

test('waiting admission preserves the slot until release and propagates a cancelled wait (TASK-2727)', async () => {
  let occupied = true;
  let released = 0;
  const lease = { bindChild() {}, release() { released++; } };
  const acquired = await waitForCustomCapacity('/mission', () => {}, async () => occupied ? null : lease,
    async () => { occupied = false; });
  assert.equal(released, 0, 'waiting does not release the newly admitted session');
  acquired.release();
  assert.equal(released, 1);
  await assert.rejects(waitForCustomCapacity('/mission', () => {}, async () => null,
    async () => { throw new Error('cancelled'); }), /cancelled/);
});
