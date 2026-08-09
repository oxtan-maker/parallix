import test from 'node:test';
import assert from 'node:assert/strict';

import { deriveLaneIntervals, medianCycleTimeByStateSeries } from '../src/application/projections/metrics.js';
import type { MissionTransition } from '../src/domain/mission-workflow.js';
import { missionId } from '../src/domain/mission.js';

// ---------------------------------------------------------------------------
// Reproduction test for task-2347.03 — inverted dwell attribution
//
// SC1: Time between backlog→active and active→review must be attributed
// to "active" (the state occupied during that interval), not "review"
// (the state entered by the second transition).
// ---------------------------------------------------------------------------

const transitions: MissionTransition[] = [
  {
    missionId: missionId('task-0001'),
    from: 'backlog',
    to: 'active',
    trigger: 'activate',
    actor: 'codex',
    occurredAt: '2026-07-22T08:00:00Z',
  },
  {
    missionId: missionId('task-0001'),
    from: 'active',
    to: 'review',
    trigger: 'submit-for-review',
    actor: 'codex',
    occurredAt: '2026-07-22T09:00:00Z',
  },
];

test('dwell time between backlog->active and active->review is attributed to active (not review)', () => {
  const result = medianCycleTimeByStateSeries(transitions);

  // 60 minutes spent in "active" (08:00 → 09:00)
  const activeValue = result.series.find((entry) => entry.lane === 'active')?.value;
  const reviewValue = result.series.find((entry) => entry.lane === 'review')?.value;

  assert.equal(
    activeValue,
    60,
    '60 min dwell (08:00→09:00) must be attributed to "active", the state occupied during interval',
  );

  // "review" has no closed interval yet (only one transition into review, no exit)
  assert.equal(
    reviewValue,
    null,
    '"review" lane must have no closed interval — mission entered review but did not exit',
  );
});

test('medianCycleTimeByStateSeries returns LaneMetricSeries shape with all board lanes', () => {
  const result = medianCycleTimeByStateSeries(transitions);

  assert.equal(result.series.length, 6, 'must return all 6 board lanes');
  assert.equal(result.missingHistoryFallback, 'null');
});

test('multi-mission dwell attribution: each mission intervals attributed to state occupied', () => {
  const multiTransitions: MissionTransition[] = [
    // Mission 1: backlog→active (08:00), active→review (09:00), review→active (11:00)
    { missionId: missionId('task-0001'), from: 'backlog', to: 'active', trigger: 'activate', actor: 'codex', occurredAt: '2026-07-22T08:00:00Z' },
    { missionId: missionId('task-0001'), from: 'active', to: 'review', trigger: 'submit-for-review', actor: 'codex', occurredAt: '2026-07-22T09:00:00Z' },
    { missionId: missionId('task-0001'), from: 'review', to: 'active', trigger: 'request-changes', actor: 'codex', occurredAt: '2026-07-22T11:00:00Z' },
    // Mission 2: backlog→active (08:00), active→review (10:00)
    { missionId: missionId('task-0002'), from: 'backlog', to: 'active', trigger: 'activate', actor: 'codex', occurredAt: '2026-07-22T08:00:00Z' },
    { missionId: missionId('task-0002'), from: 'active', to: 'review', trigger: 'submit-for-review', actor: 'codex', occurredAt: '2026-07-22T10:00:00Z' },
  ];

  const result = medianCycleTimeByStateSeries(multiTransitions);

  // "active" intervals: task-0001 60min (08:00→09:00), task-0002 120min (08:00→10:00)
  // median of [60, 120] = 90
  const activeValue = result.series.find((entry) => entry.lane === 'active')?.value;
  assert.equal(
    activeValue,
    90,
    'median of active dwell [60, 120] = 90, attributed to state occupied (active)',
  );

  // "review" intervals: task-0001 120min (09:00→11:00)
  // median of [120] = 120
  const reviewValue = result.series.find((entry) => entry.lane === 'review')?.value;
  assert.equal(
    reviewValue,
    120,
    'median of review dwell [120] = 120, attributed to state occupied (review)',
  );
});

// ---------------------------------------------------------------------------
// SC6: Out-of-order and duplicate transitions produce deterministic intervals
// ---------------------------------------------------------------------------

test('out-of-order transitions produce deterministic interval sequence (sorted by occurredAt)', () => {
  // Transitions provided in reverse chronological order
  const outOfOrder: MissionTransition[] = [
    { missionId: missionId('task-0001'), from: 'active', to: 'review', trigger: 'submit-for-review', actor: 'codex', occurredAt: '2026-07-22T09:00:00Z' },
    { missionId: missionId('task-0001'), from: 'backlog', to: 'active', trigger: 'activate', actor: 'codex', occurredAt: '2026-07-22T08:00:00Z' },
  ];

  const intervals = deriveLaneIntervals(outOfOrder);
  const closed = intervals.filter((i) => i.exitedAt !== null);

  // After sorting, intervals should be: active (08:00→09:00), review (open)
  assert.equal(closed.length, 1, 'one closed interval (active)');
  assert.equal(closed[0]?.state, 'active', 'closed interval is for active lane');
  assert.equal(closed[0]?.enteredAt, '2026-07-22T08:00:00Z');
  assert.equal(closed[0]?.exitedAt, '2026-07-22T09:00:00Z');

  // Open interval for current lane
  const open = intervals.filter((i) => i.exitedAt === null);
  assert.equal(open.length, 1, 'one open interval (review = current lane)');
  assert.equal(open[0]?.state, 'review');
});

test('duplicate transitions collapsed — same missionId+from+to+occurredAt yields one interval', () => {
  const withDuplicates: MissionTransition[] = [
    { missionId: missionId('task-0001'), from: 'backlog', to: 'active', trigger: 'activate', actor: 'codex', occurredAt: '2026-07-22T08:00:00Z' },
    { missionId: missionId('task-0001'), from: 'backlog', to: 'active', trigger: 'activate', actor: 'codex', occurredAt: '2026-07-22T08:00:00Z' },
    { missionId: missionId('task-0001'), from: 'active', to: 'review', trigger: 'submit-for-review', actor: 'codex', occurredAt: '2026-07-22T09:00:00Z' },
  ];

  const intervals = deriveLaneIntervals(withDuplicates);
  const closed = intervals.filter((i) => i.exitedAt !== null);

  // Duplicate backlog->active collapsed: only one active interval
  assert.equal(closed.length, 1, 'duplicate transitions collapsed — one closed interval');
  assert.equal(closed[0]?.state, 'active');
  assert.equal(closed[0]?.enteredAt, '2026-07-22T08:00:00Z');
  assert.equal(closed[0]?.exitedAt, '2026-07-22T09:00:00Z');

  // Verify medianCycleTimeByStateSeries also handles duplicates correctly
  const result = medianCycleTimeByStateSeries(withDuplicates);
  const activeValue = result.series.find((entry) => entry.lane === 'active')?.value;
  assert.equal(activeValue, 60, 'dwell computed from deduplicated intervals');
});
