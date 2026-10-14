// Regression provenance: TASK-2373.
import test from 'node:test';
import assert from 'node:assert/strict';
import { subscribeToBoardProjection } from '../../../../src/application/projections/board-subscription.js';
import type { BoardProjection } from '../../../../src/application/projections/board.js';
import { makeCard, makeProjection } from '../../../fixtures/board-projection.js';

test('SC35: a slow board refresh never overlaps or accumulates a timer backlog', async () => {
  const timers: Array<() => void> = [];
  let active = 0;
  let peak = 0;
  let release: (() => void) | undefined;
  const unsubscribe = subscribeToBoardProjection(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => { release = resolve; });
    active -= 1;
    return makeProjection();
  }, () => {}, { setTimer: callback => { timers.push(callback); return callback; }, clearTimer: () => {} });

  timers.shift()!();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(active, 1);
  assert.equal(timers.length, 0, 'a next tick is not scheduled while the current rebuild is pending');
  release!();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(timers.length, 1, 'exactly one follow-up refresh is scheduled after completion');
  assert.equal(peak, 1);
  unsubscribe();
});

test('SC33 and SC34: each completed timer tick rebuilds the authority projection', async () => {
  const timers: Array<() => void> = [];
  let builds = 0;
  const unsubscribe = subscribeToBoardProjection(async () => {
    builds += 1;
    return makeProjection();
  }, () => {}, { setTimer: callback => { timers.push(callback); return callback; }, clearTimer: () => {} });
  timers.shift()!();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(builds, 1);
  unsubscribe();
});

test('SC6: a recovery-only state change (unattributed running sessions) repaints the board', async () => {
  let builds = 0;
  const projections: Array<() => BoardProjection> = [
    () => withUnattributed(0),
    () => withUnattributed(3),
  ];
  let changes = 0;
  const timers: Array<() => void> = [];
  const unsubscribe = subscribeToBoardProjection(
    async () => { builds += 1; return projections[Math.min(builds - 1, projections.length - 1)](); },
    () => { changes += 1; },
    { setTimer: callback => { timers.push(callback); return callback; }, clearTimer: () => {} },
  );
  timers.shift()!();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(changes, 1, 'the first rebuild publishes');
  timers.shift()!();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(changes, 2, 'a change limited to unattributed running sessions triggers a repaint');
  unsubscribe();
});

function withUnattributed(count: number): BoardProjection {
  const projection = makeProjection();
  (projection as { metrics: BoardProjection['metrics'] }).metrics = {
    ...projection.metrics,
    unattributedRunningSessions: count,
  };
  return projection;
}


test('checkpoint-only plan and evidence changes repaint the subscribed board (TASK-2745)', async () => {
  const plan = [1, 2].map(number => ({ name: `CP-${number}`, description: `Step ${number}`, goalCheck: [], state: 'future' as const }));
  const projections = [
    makeProjection({ active: [makeCard()] }),
    makeProjection({ active: [makeCard({ checkpointEvidence: plan })] }),
    makeProjection({ active: [makeCard({ checkpointEvidence: [
      { ...plan[0], state: 'completed', goalCheck: [{ criterion: 'done', evidence: 'npm test' }] },
      { ...plan[1], state: 'current' },
    ] })] }),
  ];
  const timers: Array<() => void> = [];
  let index = 0;
  const seen: BoardProjection[] = [];
  const stop = subscribeToBoardProjection(async () => projections[index], projection => seen.push(projection), {
    setTimer: callback => { timers.push(callback); return callback; }, clearTimer: () => { timers.length = 0; },
  });
  try {
    for (index = 0; index < projections.length; index++) {
      timers.shift()!();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(seen.length, index + 1);
    }
    index = projections.length - 1;
    timers.shift()!();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(seen.length, 3, 'unchanged checkpoint state does not repaint');
  } finally { stop(); }
});
