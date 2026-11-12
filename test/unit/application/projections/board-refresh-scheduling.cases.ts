// Regression provenance: TASK-2373.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_IDLE_REFRESH_INTERVAL_MS, BOARD_REFRESH_INTERVAL_MS, subscribeToBoardProjection } from '../../../../src/application/projections/board-subscription.js';
import type { BoardProjection } from '../../../../src/application/projections/board.js';
import { agentFamily } from '../../../../src/domain/agents.js';
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

test('SC6: a recovery-only state change (confirmed provider count) repaints the board', async () => {
  let builds = 0;
  const projections: Array<() => BoardProjection> = [
    () => withProviderCount(0),
    () => withProviderCount(3),
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
  assert.equal(changes, 2, 'a change limited to the confirmed provider count triggers a repaint');
  unsubscribe();
});

function withProviderCount(count: number): BoardProjection {
  const projection = makeProjection();
  (projection as { metrics: BoardProjection['metrics'] }).metrics = {
    ...projection.metrics,
    agentAvailability: [{ family: agentFamily('codex'), available: true, blockedForMs: 0, runningSessions: count }],
  };
  return projection;
}

test('status reconciliation uses active and idle cadence, coalesces, backs off and stops (PX-0058.02)', async () => {
  type Scheduled = { callback: () => void; ms: number };
  const timers: Scheduled[] = [];
  let mode: 'idle' | 'active' | 'failure' = 'idle';
  let notifications = 0;
  const active = makeProjection({ active: [makeCard({ currentWork: {
    operationId: 'op', phase: 'execute', summary: 'working', agent: agentFamily('codex'),
    updatedAt: '2026-11-12T10:00:00.000Z', freshness: 'live',
  } })] });
  const idle = makeProjection();
  const stop = subscribeToBoardProjection(async () => {
    if (mode === 'failure') { throw new Error('temporarily unavailable'); }
    return mode === 'active' ? active : idle;
  }, () => { notifications += 1; }, {
    setTimer: (callback, ms) => { const scheduled = { callback, ms }; timers.push(scheduled); return scheduled; },
    clearTimer: handle => { const index = timers.indexOf(handle as Scheduled); if (index >= 0) { timers.splice(index, 1); } },
  });
  const fire = async () => { timers.shift()!.callback(); await new Promise(resolve => setImmediate(resolve)); };

  assert.equal(timers[0]!.ms, BOARD_REFRESH_INTERVAL_MS, 'the first consumer read does not wait for an idle classification');
  await fire();
  assert.equal(timers[0]!.ms, BOARD_IDLE_REFRESH_INTERVAL_MS);
  assert.equal(notifications, 1, 'the first status notification is published immediately after its read');
  mode = 'active';
  await fire();
  assert.equal(timers[0]!.ms, BOARD_REFRESH_INTERVAL_MS);
  assert.equal(notifications, 2);
  mode = 'failure';
  await fire();
  assert.equal(timers[0]!.ms, BOARD_REFRESH_INTERVAL_MS);
  await fire();
  assert.equal(timers[0]!.ms, 4_000);
  await fire();
  assert.equal(timers[0]!.ms, BOARD_IDLE_REFRESH_INTERVAL_MS, 'failure retry is capped at the idle cadence');
  mode = 'active';
  await fire();
  assert.equal(timers[0]!.ms, BOARD_REFRESH_INTERVAL_MS, 'a successful read clears backoff');
  assert.equal(notifications, 2, 'an unchanged recovered projection remains coalesced');
  stop();
  assert.equal(timers.length, 0, 'removing the consumer stops reconciliation');
});

test('an active cadence override preserves an independent idle floor and failure backoff (PX-0058.02)', async () => {
  type Scheduled = { callback: () => void; ms: number };
  const timers: Scheduled[] = [];
  let mode: 'active' | 'idle' | 'failure' = 'active';
  const active = makeProjection({ active: [makeCard({ currentWork: {
    operationId: 'op', phase: 'execute', summary: 'working', agent: null,
    updatedAt: '2026-11-12T10:00:00.000Z', freshness: 'live',
  } })] });
  const stop = subscribeToBoardProjection(async () => {
    if (mode === 'failure') { throw new Error('offline'); }
    return mode === 'active' ? active : makeProjection();
  }, () => {}, {
    intervalMs: 1_500,
    idleIntervalMs: 6_000,
    setTimer: (callback, ms) => { const scheduled = { callback, ms }; timers.push(scheduled); return scheduled; },
    clearTimer: () => {},
  });
  const fire = async () => { timers.shift()!.callback(); await new Promise(resolve => setImmediate(resolve)); };

  assert.equal(timers[0]!.ms, 1_500);
  mode = 'idle'; await fire();
  assert.equal(timers[0]!.ms, 6_000);
  mode = 'active'; await fire();
  assert.equal(timers[0]!.ms, 1_500);
  mode = 'failure'; await fire();
  assert.equal(timers[0]!.ms, 1_500);
  await fire();
  assert.equal(timers[0]!.ms, 3_000);
  await fire();
  assert.equal(timers[0]!.ms, 6_000);
  stop();
});

test('an idle cadence override cannot fall below the active cadence (PX-0058.02)', async () => {
  type Scheduled = { callback: () => void; ms: number };
  const timers: Scheduled[] = [];
  let fail = false;
  const stop = subscribeToBoardProjection(async () => {
    if (fail) { throw new Error('offline'); }
    return makeProjection();
  }, () => {}, {
    intervalMs: 6_000,
    idleIntervalMs: 1_500,
    setTimer: (callback, ms) => { const scheduled = { callback, ms }; timers.push(scheduled); return scheduled; },
    clearTimer: () => {},
  });
  const fire = async () => { timers.shift()!.callback(); await new Promise(resolve => setImmediate(resolve)); };

  assert.equal(timers[0]!.ms, 6_000);
  await fire();
  assert.equal(timers[0]!.ms, 6_000, 'idle reconciliation is never faster than active reconciliation');
  fail = true;
  await fire();
  assert.equal(timers[0]!.ms, 6_000, 'failure backoff never shrinks below the active cadence');
  stop();
});


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
