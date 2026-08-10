import test from 'node:test';
import assert from 'node:assert/strict';

import {
  medianAgeByLaneSeries,
  bottleneckNarrative,
  formatDuration,
} from '../src/application/projections/metrics.js';
import type { LaneMetricSeries, MetricSeries } from '../src/application/projections/board.js';
import { missionId, type MissionId, type MissionStatus } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';

// ---------------------------------------------------------------------------
// Repro tests for task-2347.06 — lane age clock and bottleneck selection
// ---------------------------------------------------------------------------
// These tests lock both bugs before fix and turn green after fix.
// Run: npm test -- test/task-2347-06-repro.test.ts
// ---------------------------------------------------------------------------

const id1 = missionId('task-0010');
const id2 = missionId('task-0020');
const id3 = missionId('task-0030');

// ---------------------------------------------------------------------------
// Bug A: age computed against last-event timestamp instead of injected clock
// ---------------------------------------------------------------------------

test('age: mission 3 days (4320 min) before asOf reports age >= 4300 min (SC1)', () => {
  // Last transition was 3 days before asOf — mission stalled that long
  const threeDaysAgo = '2026-07-19T10:00:00Z';
  const asOf = '2026-07-22T10:00:00Z'; // exactly 4320 minutes later

  const transitions = [
    { missionId: id1, from: 'refined' as const, to: 'active' as const, trigger: 'activate' as const, actor: 'codex', occurredAt: threeDaysAgo },
  ];

  const series = medianAgeByLaneSeries(transitions, asOf);
  const activeAge = series.series.find((entry) => entry.lane === 'active')?.value;

  // With correct asOf (injected clock), age should be ~4320 min
  assert.ok(activeAge !== null, 'active lane should have a non-null age');
  assert.ok(activeAge >= 4300, `active lane age should be >= 4300 min, got ${activeAge}`);
});

test('age: asOf parameter controls computed age, not last transition time (SC1)', () => {
  const transitionTime = '2026-07-20T08:00:00Z';

  const transitions = [
    { missionId: id1, from: 'backlog' as const, to: 'refined' as const, trigger: 'activate' as const, actor: 'codex', occurredAt: transitionTime },
  ];

  // asOf 1 day after transition → ~1440 min
  const asOf1 = '2026-07-21T08:00:00Z';
  const series1 = medianAgeByLaneSeries(transitions, asOf1);
  const age1 = series1.series.find((e) => e.lane === 'refined')?.value;
  assert.ok(age1 !== null && age1 >= 1400, `1 day age should be ~1440, got ${age1}`);

  // asOf 3 days after transition → ~4320 min
  const asOf2 = '2026-07-23T08:00:00Z';
  const series2 = medianAgeByLaneSeries(transitions, asOf2);
  const age2 = series2.series.find((e) => e.lane === 'refined')?.value;
  assert.ok(age2 !== null && age2 >= 4300, `3 day age should be ~4320, got ${age2}`);
});

// ---------------------------------------------------------------------------
// Bug B: bottleneck selects terminal lanes (done, integration)
// ---------------------------------------------------------------------------

test('bottleneck: done lane NOT selected as bottleneck when active has stall (SC4)', () => {
  // Mission in done for 30 days (43200 min) — should be excluded
  // Mission in active for 60 min — should be selected
  const doneTransition = '2026-06-22T10:00:00Z'; // 30 days ago
  const activeTransition = '2026-07-22T09:00:00Z'; // 60 min ago
  const asOf = '2026-07-22T10:00:00Z';

  const transitions = [
    { missionId: id1, from: 'review' as const, to: 'done' as const, trigger: 'integrate' as const, actor: 'codex', occurredAt: doneTransition },
    { missionId: id2, from: 'refined' as const, to: 'active' as const, trigger: 'activate' as const, actor: 'codex', occurredAt: activeTransition },
  ];

  const ageSeries = medianAgeByLaneSeries(transitions, asOf);
  const reviewLoopRate: MetricSeries = { series: [{ at: asOf, value: 1.5 }], missingHistoryFallback: 'estimate' };
  const weeklyThroughput: MetricSeries = { series: [{ at: asOf, value: 3 }], missingHistoryFallback: 'skip' };

  const narrative = bottleneckNarrative(ageSeries, reviewLoopRate, weeklyThroughput);

  // Bottleneck should name 'active', NOT 'done'
  assert.ok(
    narrative.inputs.lane === 'active',
    `bottleneck lane should be 'active' (terminal lanes excluded), got '${narrative.inputs.lane}'`,
  );
});

test('bottleneck: integration lane NOT selected as bottleneck (SC4)', () => {
  const integrationTransition = '2026-07-01T10:00:00Z'; // 21 days ago
  const activeTransition = '2026-07-22T08:00:00Z'; // 120 min ago
  const asOf = '2026-07-22T10:00:00Z';

  const transitions = [
    { missionId: id1, from: 'review' as const, to: 'integration' as const, trigger: 'approve' as const, actor: 'codex', occurredAt: integrationTransition },
    { missionId: id2, from: 'refined' as const, to: 'active' as const, trigger: 'activate' as const, actor: 'codex', occurredAt: activeTransition },
  ];

  const ageSeries = medianAgeByLaneSeries(transitions, asOf);
  const reviewLoopRate: MetricSeries = { series: [{ at: asOf, value: 2.0 }], missingHistoryFallback: 'estimate' };
  const weeklyThroughput: MetricSeries = { series: [{ at: asOf, value: 1 }], missingHistoryFallback: 'skip' };

  const narrative = bottleneckNarrative(ageSeries, reviewLoopRate, weeklyThroughput);

  assert.ok(
    narrative.inputs.lane === 'active',
    `bottleneck lane should be 'active', not 'integration'. Got '${narrative.inputs.lane}'`,
  );
});

// ---------------------------------------------------------------------------
// SC5: empty lane reports null, bottleneck unavailable when all non-terminal empty
// ---------------------------------------------------------------------------

test('bottleneck: unavailable when all non-terminal lanes have no age (SC5)', () => {
  // Only done lane has missions; all active lanes empty
  const transitions = [
    { missionId: id1, from: 'review' as const, to: 'done' as const, trigger: 'integrate' as const, actor: 'codex', occurredAt: '2026-07-20T10:00:00Z' },
  ];
  const asOf = '2026-07-22T10:00:00Z';

  const ageSeries = medianAgeByLaneSeries(transitions, asOf);
  const reviewLoopRate: MetricSeries = { series: [{ at: asOf, value: 1.0 }], missingHistoryFallback: 'estimate' };
  const weeklyThroughput: MetricSeries = { series: [{ at: asOf, value: 2 }], missingHistoryFallback: 'skip' };

  const narrative = bottleneckNarrative(ageSeries, reviewLoopRate, weeklyThroughput);

  // Only 'done' has age, but it's terminal — so bottleneck unavailable
  assert.ok(
    narrative.inputs.lane === null,
    `bottleneck lane should be null (only terminal lanes have age), got '${narrative.inputs.lane}'`,
  );
  assert.ok(
    narrative.sentence.toLowerCase().includes('unavailable'),
    `bottleneck sentence should indicate unavailable, got: ${narrative.sentence}`,
  );
});

// ---------------------------------------------------------------------------
// SC6: formatDuration helper
// ---------------------------------------------------------------------------

test('formatDuration: <60 min returns integer minutes (SC6)', () => {
  assert.equal(formatDuration(45), '45 min');
  assert.equal(formatDuration(0), '0 min');
  assert.equal(formatDuration(59), '59 min');
});

test('formatDuration: 60-1439 min returns hours with 1 decimal (SC6)', () => {
  assert.equal(formatDuration(90), '1.5h');
  assert.equal(formatDuration(60), '1.0h');
  assert.equal(formatDuration(120), '2.0h');
  assert.equal(formatDuration(1439), '24.0h');
});

test('formatDuration: >=1440 min returns days with 1 decimal (SC6)', () => {
  assert.equal(formatDuration(4320), '3.0d');
  assert.equal(formatDuration(1440), '1.0d');
  assert.equal(formatDuration(2520), '1.8d');
});

// ---------------------------------------------------------------------------
// SC2: Clock injection — adapter uses injected clock for asOf
// ---------------------------------------------------------------------------

test('ConcreteMetricsReadAdapter: asOf from injected clock not instants.at(-1) (SC2)', async () => {
  const { ConcreteMetricsReadAdapter } = await import('../src/application/projections/metrics-read-adapter.js');

  // Fixed clock — always returns this timestamp
  const fixedClock = () => '2026-07-22T10:00:00Z';

  // Transition happened much earlier
  const earlyTransition = '2026-07-20T08:00:00Z';

  // Mock repos
  const laneEventRepo = {
    findByRepositoryId: async () => [
      {
        id: 1,
        repositoryId: 'parallix',
        missionId: id1,
        fromStatus: 'refined',
        toStatus: 'active',
        trigger: 'activate',
        agent: 'codex',
        occurredAt: earlyTransition,
        idempotencyKey: `${id1}:activate:${earlyTransition}`,
      },
    ],
    findByMissionId: async () => [],
    findAll: async () => [],
    append: async () => true,
    clear: async () => {},
  };

  const usageRepo = {
    findAll: async () => [],
    findWhere: async () => [],
    save: async () => {},
    saveAll: async () => {},
    clear: async () => {},
  };

  const adapter = new ConcreteMetricsReadAdapter({
    laneEventRepo,
    usageRepo,
    repositoryId: repositoryId('parallix'),
    clock: fixedClock,
  });

  const metrics = await adapter.buildMetrics(new Map([[id1, 'active']]));

  // Age should be computed against clock (2026-07-22T10:00:00Z), not transition time
  const activeAge = metrics.medianAgeByLane.series.find((e) => e.lane === 'active')?.value;
  assert.ok(activeAge !== null, 'active lane should have age');
  // Clock is 3000 min after transition (2 days + 2 hours)
  assert.ok(activeAge >= 2990, `age should be ~3000 min (from clock), got ${activeAge}`);
});

// ---------------------------------------------------------------------------
// SC3: Mission with no transition contributes lane age from lifecycle entry
// ---------------------------------------------------------------------------

test('medianAgeByLaneSeries: mission with no transition uses lifecycle entry timestamp (SC3)', () => {
  const asOf = '2026-07-22T10:00:00Z';

  // Only id1 has a transition; id2 has none
  const transitions = [
    { missionId: id1, from: 'backlog' as const, to: 'active' as const, trigger: 'activate' as const, actor: 'codex', occurredAt: '2026-07-22T09:00:00Z' },
  ];

  // Lifecycle entry timestamps for missions without transitions
  const lifecycleEntries = new Map([
    [id2, '2026-07-21T10:00:00Z'], // id2 entered refined 1 day ago
  ]) as Map<MissionId, string>;

  // Initial states include id2 (in refined, no transition)
  const initialStates = new Map([
    [id1, 'active'],
    [id2, 'refined'],
  ]) as Map<MissionId, MissionStatus>;

  const series = medianAgeByLaneSeries(transitions, asOf, initialStates as ReadonlyMap<MissionId, MissionStatus>, lifecycleEntries as ReadonlyMap<MissionId, string>);

  // id1 in active: 60 min (from transition)
  const activeAge = series.series.find((e) => e.lane === 'active')?.value;
  assert.ok(activeAge !== null && activeAge >= 59, `active age should be ~60, got ${activeAge}`);

  // id2 in refined: 1440 min (from lifecycle entry)
  const refinedAge = series.series.find((e) => e.lane === 'refined')?.value;
  assert.ok(refinedAge !== null, 'refined lane should have non-null age from lifecycle entry');
  assert.ok(refinedAge >= 1400, `refined age should be ~1440, got ${refinedAge}`);
});
