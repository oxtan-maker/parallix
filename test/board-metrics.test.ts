import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildMetrics,
  bottleneckNarrative,
  cumulativeFlowByStateSeries,
  medianAgeByLaneSeries,
  medianCycleTimeByStateSeries,
  cumulativeFlowSeries,
  medianStateTimes,
  reviewLoopRateSeries,
  throughputSeries,
  wipSeries,
  type MetricsInput,
} from '../src/application/projections/metrics.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId } from '../src/domain/mission.js';

const id1 = missionId('task-0001');
const id2 = missionId('task-0002');
const id3 = missionId('task-0003');
const now = '2026-07-22T10:00:00Z';
const earlier = '2026-07-22T08:00:00Z';
const later = '2026-07-22T12:00:00Z';

// ---------------------------------------------------------------------------
// SC3: Cumulative-flow with missingHistoryFallback
// ---------------------------------------------------------------------------

test('cumulativeFlowSeries returns completed mission count with estimate fallback', () => {
  const series = cumulativeFlowSeries(
    new Map([[id1, 'backlog']]),
    [],
    [now],
  );
  assert.equal(series.missingHistoryFallback, 'estimate');
  assert.equal(series.series[0]?.value, 0);
});

test('cumulativeFlowSeries tracks completed transitions over time', () => {
  const transitions = [
    { missionId: id1, from: 'backlog' as const, to: 'done' as const, trigger: 'close' as const, actor: 'codex', occurredAt: now },
  ];
  const series = cumulativeFlowSeries(
    new Map([[id1, 'backlog']]),
    transitions,
    [earlier, now, later],
  );
  assert.equal(series.series[0]?.value, 0);
  assert.equal(series.series[1]?.value, 1);
  assert.equal(series.series[2]?.value, 1);
});

test('cumulativeFlowSeries with multiple missions and transitions', () => {
  const transitions = [
    { missionId: id1, from: 'backlog' as const, to: 'active' as const, trigger: 'activate' as const, actor: 'codex', occurredAt: now },
    { missionId: id2, from: 'refined' as const, to: 'active' as const, trigger: 'activate' as const, actor: 'codex', occurredAt: later },
  ];
  const series = cumulativeFlowSeries(
    new Map([[id1, 'backlog'], [id2, 'refined']]),
    transitions,
    [earlier, now, later],
  );
  assert.equal(series.series[0]?.value, 0);
  assert.equal(series.series[1]?.value, 0);
  assert.equal(series.series[2]?.value, 0);
});

test('cumulativeFlowByStateSeries exposes per-state counts from BoardMetrics inputs', () => {
  const series = cumulativeFlowByStateSeries(
    new Map([[id1, 'backlog'], [id2, 'review']]),
    [{ missionId: id1, from: 'backlog', to: 'active', trigger: 'activate', actor: 'codex', occurredAt: now }],
    [earlier, now],
  );
  assert.deepEqual(series.series[0]?.counts, { backlog: 1, refined: 0, active: 0, review: 1, integration: 0, done: 0 });
  assert.deepEqual(series.series[1]?.counts, { backlog: 0, refined: 0, active: 1, review: 1, integration: 0, done: 0 });
  assert.equal(series.missingHistoryFallback, 'estimate');
});

// ---------------------------------------------------------------------------
// SC3: Median state times with missingHistoryFallback
// ---------------------------------------------------------------------------

test('medianStateTimes returns null fallback when no outcomes', () => {
  const series = medianStateTimes([], [now]);
  assert.equal(series.missingHistoryFallback, 'null');
  assert.equal(series.series[0]?.value, null);
});

test('medianStateTimes computes median from outcomes', () => {
  const outcomes = [
    { missionId: id1, repositoryId: 'parallix' as never, createdAt: earlier, closedAt: earlier, cycleTimeMinutes: 10, reviewFixRounds: 1, runs: [] },
    { missionId: id2, repositoryId: 'parallix' as never, createdAt: earlier, closedAt: earlier, cycleTimeMinutes: 30, reviewFixRounds: 2, runs: [] },
    { missionId: id3, repositoryId: 'parallix' as never, createdAt: earlier, closedAt: earlier, cycleTimeMinutes: 20, reviewFixRounds: 1, runs: [] },
  ];
  const series = medianStateTimes(outcomes, [now]);
  assert.equal(series.missingHistoryFallback, 'null');
  // Sorted: 10, 20, 30 → median = 20
  assert.equal(series.series[0]?.value, 20);
});

test('medianStateTimes handles even number of outcomes', () => {
  const outcomes = [
    { missionId: id1, repositoryId: 'parallix' as never, createdAt: earlier, closedAt: earlier, cycleTimeMinutes: 10, reviewFixRounds: 1, runs: [] },
    { missionId: id2, repositoryId: 'parallix' as never, createdAt: earlier, closedAt: earlier, cycleTimeMinutes: 30, reviewFixRounds: 2, runs: [] },
  ];
  const series = medianStateTimes(outcomes, [now]);
  // Sorted: 10, 30 → median = (10 + 30) / 2 = 20
  assert.equal(series.series[0]?.value, 20);
});

test('medianStateTimes handles single outcome', () => {
  const outcomes = [
    { missionId: id1, repositoryId: 'parallix' as never, createdAt: earlier, closedAt: earlier, cycleTimeMinutes: 45, reviewFixRounds: 1, runs: [] },
  ];
  const series = medianStateTimes(outcomes, [now]);
  assert.equal(series.series[0]?.value, 45);
});

// ---------------------------------------------------------------------------
// SC3: Throughput with missingHistoryFallback
// ---------------------------------------------------------------------------

test('throughputSeries returns skip fallback when no outcomes', () => {
  const series = throughputSeries([], [now]);
  assert.equal(series.missingHistoryFallback, 'skip');
  assert.equal(series.series.length, 0);
});

test('throughputSeries counts completed missions', () => {
  const outcomes = [
    { missionId: id1, repositoryId: 'parallix' as never, createdAt: earlier, closedAt: earlier, cycleTimeMinutes: 10, reviewFixRounds: 1, runs: [] },
    { missionId: id2, repositoryId: 'parallix' as never, createdAt: earlier, closedAt: earlier, cycleTimeMinutes: 30, reviewFixRounds: 2, runs: [] },
  ];
  const series = throughputSeries(outcomes, [earlier, now, later]);
  assert.equal(series.missingHistoryFallback, 'skip');
  assert.equal(series.series[0]?.value, 2);
  assert.equal(series.series[1]?.value, 2);
  assert.equal(series.series[2]?.value, 2);
});

test('throughputSeries skip fallback produces empty series', () => {
  const series = throughputSeries([], [earlier, now, later]);
  assert.equal(series.series.length, 0);
});

// ---------------------------------------------------------------------------
// SC3: Review loop rate with missingHistoryFallback
// ---------------------------------------------------------------------------

test('reviewLoopRateSeries returns estimate fallback when no outcomes', () => {
  const series = reviewLoopRateSeries([], [now]);
  assert.equal(series.missingHistoryFallback, 'estimate');
  assert.equal(series.series.length, 0);
});

test('reviewLoopRateSeries computes average review-fix rounds', () => {
  const outcomes = [
    { missionId: id1, repositoryId: 'parallix' as never, createdAt: earlier, closedAt: earlier, cycleTimeMinutes: 10, reviewFixRounds: 1, runs: [] },
    { missionId: id2, repositoryId: 'parallix' as never, createdAt: earlier, closedAt: earlier, cycleTimeMinutes: 30, reviewFixRounds: 3, runs: [] },
    { missionId: id3, repositoryId: 'parallix' as never, createdAt: earlier, closedAt: earlier, cycleTimeMinutes: 20, reviewFixRounds: 2, runs: [] },
  ];
  const series = reviewLoopRateSeries(outcomes, [now]);
  assert.equal(series.missingHistoryFallback, 'estimate');
  // Average: (1 + 3 + 2) / 3 = 2
  assert.equal(series.series[0]?.value, 2);
});

test('reviewLoopRateSeries handles zero review rounds', () => {
  const outcomes = [
    { missionId: id1, repositoryId: 'parallix' as never, createdAt: earlier, closedAt: earlier, cycleTimeMinutes: 10, reviewFixRounds: 0, runs: [] },
    { missionId: id2, repositoryId: 'parallix' as never, createdAt: earlier, closedAt: earlier, cycleTimeMinutes: 30, reviewFixRounds: 0, runs: [] },
  ];
  const series = reviewLoopRateSeries(outcomes, [now]);
  assert.equal(series.series[0]?.value, 0);
});

// ---------------------------------------------------------------------------
// SC3: WIP series with missingHistoryFallback
// ---------------------------------------------------------------------------

test('wipSeries returns null fallback', () => {
  const series = wipSeries(
    new Map([[id1, 'backlog']]),
    [],
    [now],
  );
  assert.equal(series.missingHistoryFallback, 'null');
  assert.equal(series.series[0]?.value, 1);
});

test('wipSeries tracks total WIP over transitions', () => {
  const transitions = [
    { missionId: id1, from: 'backlog' as const, to: 'active' as const, trigger: 'activate' as const, actor: 'codex', occurredAt: now },
  ];
  const series = wipSeries(
    new Map([[id1, 'backlog'], [id2, 'refined']]),
    transitions,
    [earlier, now, later],
  );
  assert.equal(series.missingHistoryFallback, 'null');
  assert.equal(series.series[0]?.value, 2); // 2 missions before transition
  assert.equal(series.series[1]?.value, 2); // 2 missions after transition
  assert.equal(series.series[2]?.value, 2); // 2 missions still
});

// ---------------------------------------------------------------------------
// buildMetrics integration
// ---------------------------------------------------------------------------

test('buildMetrics produces all four metric series with correct fallbacks', () => {
  const input: MetricsInput = {
    initialStates: new Map([[id1, 'backlog']]),
    transitions: [],
    outcomes: [],
    instants: [now],
  };
  const metrics = buildMetrics(input);

  assert.equal(metrics.cumulativeFlow.missingHistoryFallback, 'estimate');
  assert.equal(metrics.medianStateTimes.missingHistoryFallback, 'null');
  assert.equal(metrics.throughput.missingHistoryFallback, 'skip');
  assert.equal(metrics.reviewLoopRate.missingHistoryFallback, 'estimate');
});

test('buildMetrics with data populates all series', () => {
  const transitions = [
    { missionId: id1, from: 'backlog' as const, to: 'active' as const, trigger: 'activate' as const, actor: 'codex', occurredAt: now },
  ];
  const outcomes = [
    { missionId: id1, repositoryId: 'parallix' as never, createdAt: earlier, closedAt: earlier, cycleTimeMinutes: 10, reviewFixRounds: 1, runs: [] },
  ];
  const input: MetricsInput = {
    initialStates: new Map([[id1, 'backlog']]),
    transitions,
    outcomes,
    instants: [now],
  };
  const metrics = buildMetrics(input);

  assert.equal(metrics.cumulativeFlow.series.length, 1);
  assert.equal(metrics.cumulativeFlow.series[0]?.value, 0);
  assert.equal(metrics.medianStateTimes.series[0]?.value, 10);
  assert.equal(metrics.throughput.series[0]?.value, 1);
  assert.equal(metrics.reviewLoopRate.series[0]?.value, 1);
});

test('FLOW projection derives lane rows, agent availability, and a deterministic bottleneck sentence', () => {
  const transitions = [
    { missionId: id1, from: 'backlog' as const, to: 'active' as const, trigger: 'activate' as const, actor: 'codex', occurredAt: '2026-07-22T08:00:00Z' },
    { missionId: id1, from: 'active' as const, to: 'review' as const, trigger: 'submit-for-review' as const, actor: 'codex', occurredAt: '2026-07-22T09:00:00Z' },
    { missionId: id1, from: 'review' as const, to: 'active' as const, trigger: 'request-changes' as const, actor: 'codex', occurredAt: '2026-07-22T11:00:00Z' },
    { missionId: id2, from: 'backlog' as const, to: 'active' as const, trigger: 'activate' as const, actor: 'codex', occurredAt: '2026-07-22T08:00:00Z' },
    { missionId: id2, from: 'active' as const, to: 'review' as const, trigger: 'submit-for-review' as const, actor: 'codex', occurredAt: '2026-07-22T10:00:00Z' },
  ];
  const outcomes = [
    { missionId: id1, repositoryId: 'parallix' as never, createdAt: earlier, closedAt: earlier, cycleTimeMinutes: 10, reviewFixRounds: 1, runs: [] },
    { missionId: id2, repositoryId: 'parallix' as never, createdAt: earlier, closedAt: earlier, cycleTimeMinutes: 20, reviewFixRounds: 3, runs: [] },
  ];
  const metrics = buildMetrics({
    initialStates: new Map([[id1, 'active'], [id2, 'review']]),
    transitions,
    outcomes,
    instants: ['2026-07-22T12:00:00Z'],
    asOf: '2026-07-22T12:00:00Z',
    agentAvailability: [
      { family: agentFamily('codex'), available: true, blockedForMs: 0 },
      { family: agentFamily('claude'), available: false, blockedForMs: Infinity },
    ],
  });

  // SC4: dwell attributed to state occupied (not state entered)
  // active: median([60, 120]) = 90 (id1: 08:00->09:00, id2: 08:00->10:00)
  // review: median([120]) = 120 (id1: 09:00->11:00)
  assert.equal(metrics.medianCycleTimeByState.series.find((entry) => entry.lane === 'active')?.value, 90);
  assert.equal(metrics.medianCycleTimeByState.series.find((entry) => entry.lane === 'review')?.value, 120);
  assert.equal(metrics.medianAgeByLane.series.find((entry) => entry.lane === 'review')?.value, 120);
  assert.equal(metrics.weeklyThroughput.series[0]?.value, 2);
  assert.deepEqual(metrics.agentAvailability.map((agent) => [agent.family, agent.available]), [['codex', true], ['claude', false]]);
  assert.equal(metrics.bottleneck.sentence, 'review is the oldest lane at 120 min median age; review loop 2.0; 2 completed in the latest recorded week.');
});

test('FLOW projection reports explicit missing history without fabricated values', () => {
  const metrics = buildMetrics({ initialStates: new Map(), transitions: [], outcomes: [], instants: [now], asOf: now });
  assert.equal(metrics.medianCycleTimeByState.missingHistoryFallback, 'null');
  assert.ok(metrics.medianCycleTimeByState.series.every((entry) => entry.value === null));
  assert.equal(metrics.weeklyThroughput.missingHistoryFallback, 'skip');
  assert.deepEqual(metrics.weeklyThroughput.series, []);
  assert.equal(metrics.bottleneck.sentence, 'Bottleneck unavailable: history is missing.');
  assert.deepEqual(medianAgeByLaneSeries([], now).series.map((entry) => entry.value), [null, null, null, null, null, null]);
  assert.equal(medianCycleTimeByStateSeries([]).missingHistoryFallback, 'null');
  assert.equal(bottleneckNarrative(metrics.medianAgeByLane, metrics.reviewLoopRate, metrics.weeklyThroughput).sentence, 'Bottleneck unavailable: history is missing.');
});

// ---------------------------------------------------------------------------
// Every fallback path has a targeted test
// ---------------------------------------------------------------------------

test('cumulativeFlow fallback: estimate when transitions are empty', () => {
  const series = cumulativeFlowSeries(new Map(), [], [now]);
  assert.equal(series.missingHistoryFallback, 'estimate');
  assert.equal(series.series[0]?.value, 0);
});

test('medianStateTimes fallback: null when outcomes are empty', () => {
  const series = medianStateTimes([], [now]);
  assert.equal(series.missingHistoryFallback, 'null');
  assert.equal(series.series[0]?.value, null);
});

test('throughput fallback: skip produces empty series when outcomes are empty', () => {
  const series = throughputSeries([], [now, later]);
  assert.equal(series.missingHistoryFallback, 'skip');
  assert.equal(series.series.length, 0);
});

test('reviewLoopRate fallback: estimate produces empty series when outcomes are empty', () => {
  const series = reviewLoopRateSeries([], [now, later]);
  assert.equal(series.missingHistoryFallback, 'estimate');
  assert.equal(series.series.length, 0);
});

test('wip fallback: null returns initial state counts when transitions are empty', () => {
  const series = wipSeries(new Map([[id1, 'backlog'], [id2, 'active']]), [], [now]);
  assert.equal(series.missingHistoryFallback, 'null');
  assert.equal(series.series[0]?.value, 2);
});
