import test from 'node:test';
import assert from 'node:assert/strict';
import { mirrorReviewOutcome, repairReviewedTask, reboundRejectedHandoff } from '../../../../src/application/review-task-mirroring.js';

test('review outcome mirrors preserve local approval and provider active-task repair (TASK-2647)', async () => {
  const transitions: string[] = [];
  const mirror = { transition: async (status: string) => { transitions.push(status); return true; } };
  await mirrorReviewOutcome('approve', false, 'active', mirror);
  await mirrorReviewOutcome('approve', true, 'active', mirror);
  await mirrorReviewOutcome('approve', true, 'review', mirror);
  await mirrorReviewOutcome('request-changes', true, 'approved', mirror);
  await mirrorReviewOutcome('comment', false, null, mirror);
  await mirrorReviewOutcome('invalid', false, null, mirror);
  assert.deepEqual(transitions, ['approved', 'review', 'approved', 'review', 'review']);
});

test('stale task repair only transitions a resolved active task and reports failure (TASK-2647)', async () => {
  const transitions: string[] = [];
  const mirror = { transition: async (status: string) => { transitions.push(status); return false; } };
  assert.deepEqual(await repairReviewedTask(false, null, '', mirror), { repaired: false, skipped: true });
  assert.deepEqual(await repairReviewedTask(true, 'review', 'review', mirror), { repaired: false, skipped: true, currentStatus: 'review' });
  assert.deepEqual(await repairReviewedTask(true, 'In Progress', 'active', mirror), { repaired: false, skipped: false, currentStatus: 'In Progress' });
  assert.deepEqual(transitions, ['review']);
});

test('handoff validation rebound repairs authority before mirroring and never repeats recovery (TASK-2647)', async () => {
  const effects: string[] = [];
  const port = {
    repairMission: async () => { effects.push('authority'); },
    transition: async (status: string) => { effects.push(status); return true; },
    reportBounce: () => { effects.push('reported'); },
  };
  await reboundRejectedHandoff({ ok: false, reason: 'validation-failed' }, port);
  assert.deepEqual(effects, ['authority', 'active', 'reported']);
  await reboundRejectedHandoff({ ok: false, reason: 'validation-failed', recoveryAttempted: true }, port);
  await reboundRejectedHandoff({ ok: false, reason: 'artifacts-missing' }, port);
  await reboundRejectedHandoff({ ok: true, reason: 'validation-failed' }, port);
  assert.equal(effects.length, 3);
  port.repairMission = async () => { throw new Error('authority unavailable'); };
  await assert.rejects(reboundRejectedHandoff({ ok: false, reason: 'validation-failed' }, port), /authority unavailable/);
  assert.equal(effects.length, 3, 'failed authority repair cannot move the mirror');
});
