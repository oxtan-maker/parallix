import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildMetrics,
  bottleneckNarrative,
  cumulativeFlowByStateSeries,
  weeklyCumulativeFlowByStateSeries,
  medianAgeByLaneSeries,
  medianCycleTimeByStateSeries,
  cumulativeFlowSeries,
  medianStateTimes,
  reviewBounceRateSeries,
  throughputSeries,
  wipSeries,
  formatDuration,
  type MetricsInput,
} from '../src/application/projections/metrics.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId, type MissionId, type MissionStatus } from '../src/domain/mission.js';
import { missionOutcome } from './fixtures/mission-outcome.js';
import { weeklyDecisionWindows } from '../src/application/services/decision-window.js';
import { ConcreteMetricsReadAdapter } from '../src/application/projections/metrics-read-adapter.js';
import { repositoryId } from '../src/domain/repository.js';
import type { UsageRecord, UsageRepository } from '../src/application/ports/mission-measurements.js';
import type { BoardLaneEventRepository } from '../src/application/ports/operation-history.js';
import type { MissionOutcome } from '../src/domain/usage.js';
import type { MetricSeries } from '../src/application/projections/board.js';

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
    { missionId: id1, from: 'backlog' as const, to: 'done' as const, trigger: 'integrate' as const, actor: 'codex', occurredAt: now },
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
    missionOutcome({ missionId: id1, createdAt: earlier, closedAt: earlier, cycleTimeMinutes: 10, reviewFixRounds: 1 }),
    missionOutcome({ missionId: id2, createdAt: earlier, closedAt: earlier, cycleTimeMinutes: 30, reviewFixRounds: 2 }),
    missionOutcome({ missionId: id3, createdAt: earlier, closedAt: earlier, cycleTimeMinutes: 20, reviewFixRounds: 1 }),
  ];
  const series = medianStateTimes(outcomes, [now]);
  assert.equal(series.missingHistoryFallback, 'null');
  // Sorted: 10, 20, 30 → median = 20
  assert.equal(series.series[0]?.value, 20);
});

test('medianStateTimes handles even number of outcomes', () => {
  const outcomes = [
    missionOutcome({ missionId: id1, createdAt: earlier, closedAt: earlier, cycleTimeMinutes: 10, reviewFixRounds: 1 }),
    missionOutcome({ missionId: id2, createdAt: earlier, closedAt: earlier, cycleTimeMinutes: 30, reviewFixRounds: 2 }),
  ];
  const series = medianStateTimes(outcomes, [now]);
  // Sorted: 10, 30 → median = (10 + 30) / 2 = 20
  assert.equal(series.series[0]?.value, 20);
});

test('medianStateTimes handles single outcome', () => {
  const outcomes = [
    missionOutcome({ missionId: id1, createdAt: earlier, closedAt: earlier, cycleTimeMinutes: 45, reviewFixRounds: 1 }),
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
    missionOutcome({ missionId: id1, createdAt: earlier, closedAt: earlier, cycleTimeMinutes: 10, reviewFixRounds: 1 }),
    missionOutcome({ missionId: id2, createdAt: earlier, closedAt: earlier, cycleTimeMinutes: 30, reviewFixRounds: 2 }),
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
// SC3: Lifecycle review-bounce rate with missingHistoryFallback
// ---------------------------------------------------------------------------

test('reviewBounceRateSeries returns estimate fallback when no lifecycle history exists', () => {
  const series = reviewBounceRateSeries([], [now]);
  assert.equal(series.missingHistoryFallback, 'estimate');
  assert.equal(series.series.length, 0);
});

test('reviewBounceRateSeries derives bounces from lifecycle events, not review-fix telemetry', () => {
  const transitions = [
    { missionId: id1, from: 'active' as const, to: 'review' as const, trigger: 'submit-for-review' as const, actor: 'codex', occurredAt: earlier },
    { missionId: id1, from: 'review' as const, to: 'active' as const, trigger: 'request-changes' as const, actor: 'codex', occurredAt: now },
    { missionId: id2, from: 'active' as const, to: 'review' as const, trigger: 'submit-for-review' as const, actor: 'codex', occurredAt: earlier },
  ];
  const series = reviewBounceRateSeries(transitions, [now]);
  assert.equal(series.missingHistoryFallback, 'estimate');
  assert.equal(series.series[0]?.value, 0.5);
  assert.equal(series.series[0]?.observationCount, 2);
});

test('reviewBounceRateSeries reports no value when no mission has entered review', () => {
  const series = reviewBounceRateSeries([
    { missionId: id1, from: 'backlog' as const, to: 'active' as const, trigger: 'activate' as const, actor: 'codex', occurredAt: earlier },
  ], [now]);
  assert.equal(series.series[0]?.value, null);
  assert.equal(series.series[0]?.observationCount, 0);
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
  assert.equal(metrics.reviewBounceRate.missingHistoryFallback, 'estimate');
});

test('buildMetrics with data populates all series', () => {
  const transitions = [
    { missionId: id1, from: 'backlog' as const, to: 'active' as const, trigger: 'activate' as const, actor: 'codex', occurredAt: now },
  ];
  const outcomes = [
    missionOutcome({ missionId: id1, createdAt: earlier, closedAt: earlier, cycleTimeMinutes: 10, reviewFixRounds: 1 }),
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
  assert.equal(metrics.reviewBounceRate.series[0]?.value, null);
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
    missionOutcome({ missionId: id1, createdAt: earlier, closedAt: earlier, cycleTimeMinutes: 10, reviewFixRounds: 1 }),
    missionOutcome({ missionId: id2, createdAt: earlier, closedAt: earlier, cycleTimeMinutes: 20, reviewFixRounds: 3 }),
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
  assert.deepEqual(metrics.agentAvailability.map((agent) => [agent.family, agent.available]), [['codex', true], ['claude', false]]);
  assert.equal(metrics.bottleneck.sentence, 'review is the oldest lane at 2.0h median age; review bounce 0.5.');
});

test('FLOW projection reports explicit missing history without fabricated values', () => {
  const metrics = buildMetrics({ initialStates: new Map(), transitions: [], outcomes: [], instants: [now], asOf: now });
  assert.equal(metrics.medianCycleTimeByState.missingHistoryFallback, 'null');
  assert.ok(metrics.medianCycleTimeByState.series.every((entry) => entry.value === null));
  assert.equal(metrics.bottleneck.sentence, 'Bottleneck unavailable: history is missing.');
  assert.deepEqual(medianAgeByLaneSeries([], now).series.map((entry) => entry.value), [null, null, null, null, null, null]);
  assert.equal(medianCycleTimeByStateSeries([]).missingHistoryFallback, 'null');
  assert.equal(bottleneckNarrative(metrics.medianAgeByLane, metrics.reviewBounceRate).sentence, 'Bottleneck unavailable: history is missing.');
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

test('reviewBounceRate fallback: estimate produces empty series when lifecycle history is empty', () => {
  const series = reviewBounceRateSeries([], [now, later]);
  assert.equal(series.missingHistoryFallback, 'estimate');
  assert.equal(series.series.length, 0);
});

test('wip fallback: null returns initial state counts when transitions are empty', () => {
  const series = wipSeries(new Map([[id1, 'backlog'], [id2, 'active']]), [], [now]);
  assert.equal(series.missingHistoryFallback, 'null');
  assert.equal(series.series[0]?.value, 2);
});

// ---------------------------------------------------------------------------
// TASK-2459: the weekly cumulative-flow series
//
// One rolling seven-day UTC window, owned by the projection. The week starts
// from the open work the boundary held, never from the completions of earlier
// weeks, and only recorded transitions move a mission inside it.
// ---------------------------------------------------------------------------

const weekly = weeklyDecisionWindows('2026-08-31T12:00:00Z').current;

/** `mission` transitioned to `to` on `day` at 09:00 UTC. */
const move = (mission: typeof id1, from: 'backlog' | 'refined' | 'active' | 'review' | 'integration' | null, to: 'backlog' | 'refined' | 'active' | 'review' | 'integration' | 'done', day: string) => (
  { missionId: mission, from, to, trigger: 'activate' as const, actor: 'codex', occurredAt: `${day}T09:00:00Z` }
);

test('weeklyCumulativeFlowByStateSeries scopes the series to the window days and label', () => {
  const series = weeklyCumulativeFlowByStateSeries(new Map([[id1, 'active']]), [], weekly);
  assert.deepEqual(series.window, { startDate: '2026-08-25', endDate: '2026-08-31', label: '2026-08-25 → 2026-08-31' });
  assert.equal(series.series.length, 7);
  assert.equal(series.series[0]?.at, '2026-08-25T23:59:59.999Z');
  assert.equal(series.series.at(-1)?.at, '2026-08-31T23:59:59.999Z');
});

test('weeklyCumulativeFlowByStateSeries leaves a mission completed before the window out of every point', () => {
  const transitions = [move(id1, null, 'backlog', '2026-07-01'), move(id1, 'backlog', 'done', '2026-07-10')];
  const series = weeklyCumulativeFlowByStateSeries(new Map([[id1, 'done']]), transitions, weekly);
  assert.deepEqual(series.series.map((point) => point.counts.done), [0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(series.series.map((point) => point.observationCount), [0, 0, 0, 0, 0, 0, 0]);
});

test('weeklyCumulativeFlowByStateSeries counts a completion recorded inside the window from that day on', () => {
  const transitions = [move(id1, null, 'backlog', '2026-08-20'), move(id1, 'active', 'done', '2026-08-28')];
  const series = weeklyCumulativeFlowByStateSeries(new Map([[id1, 'done']]), transitions, weekly);
  assert.deepEqual(series.series.map((point) => point.counts.done), [0, 0, 0, 1, 1, 1, 1]);
  assert.deepEqual(series.series.map((point) => point.counts.backlog), [1, 1, 1, 0, 0, 0, 0]);
});

test('weeklyCumulativeFlowByStateSeries moves a mission between lanes inside the window', () => {
  const transitions = [
    move(id1, null, 'backlog', '2026-08-20'),
    move(id1, 'backlog', 'active', '2026-08-26'),
    move(id1, 'active', 'review', '2026-08-30'),
  ];
  const series = weeklyCumulativeFlowByStateSeries(new Map([[id1, 'review']]), transitions, weekly);
  assert.deepEqual(series.series.map((point) => point.counts.backlog), [1, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(series.series.map((point) => point.counts.active), [0, 1, 1, 1, 1, 0, 0]);
  assert.deepEqual(series.series.map((point) => point.counts.review), [0, 0, 0, 0, 0, 1, 1]);
});

test('weeklyCumulativeFlowByStateSeries reports missing lifecycle history as estimate or skip, never as zeroes', () => {
  const noTransitions = weeklyCumulativeFlowByStateSeries(new Map([[id1, 'active']]), [], weekly);
  assert.equal(noTransitions.missingHistoryFallback, 'estimate');
  assert.deepEqual(noTransitions.series.map((point) => point.counts.active), [1, 1, 1, 1, 1, 1, 1]);

  const noHistoryAtAll = weeklyCumulativeFlowByStateSeries(new Map(), [], weekly);
  assert.equal(noHistoryAtAll.missingHistoryFallback, 'skip');
  assert.deepEqual(noHistoryAtAll.series, []);
});

test('buildMetrics publishes the weekly series on the same window as the decision metrics', () => {
  const windows = weeklyDecisionWindows('2026-08-31T12:00:00Z');
  const metrics = buildMetrics({
    initialStates: new Map([[id1, 'active']]),
    transitions: [move(id1, null, 'backlog', '2026-08-26'), move(id1, 'backlog', 'active', '2026-08-27')],
    outcomes: [],
    instants: ['2026-08-27T09:00:00Z'],
    asOf: '2026-08-31T12:00:00Z',
    decisionWindows: windows,
  });
  assert.equal(metrics.weeklyCumulativeFlow?.window.label, metrics.decisionWindow?.current.label);
  assert.equal(metrics.weeklyCumulativeFlow?.window.startDate, windows.current.startDate);
  assert.equal(metrics.weeklyCumulativeFlow?.window.endDate, windows.current.endDate);
});

test('buildMetrics omits the weekly series when no decision window was injected', () => {
  const input: MetricsInput = {
    initialStates: new Map([[id1, 'active']]),
    transitions: [],
    outcomes: [],
    instants: [now],
  };
  assert.equal(buildMetrics(input).weeklyCumulativeFlow, undefined);
});

test('px stats and the weekly FLOW series read the same injected-clock window authority', () => {
  const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const statsSource = fs.readFileSync(path.join(repoRoot, 'src', 'application', 'stats-command-use-case.ts'), 'utf8');
  assert.match(statsSource, /weeklyDecisionWindows\(request\.today \?\? new Date\(\)\)\.current/);

  const today = '2026-08-31T12:00:00Z';
  const statsWindow = weeklyDecisionWindows(today).current;
  const metrics = buildMetrics({
    initialStates: new Map([[id1, 'active']]),
    transitions: [move(id1, null, 'active', '2026-08-26')],
    outcomes: [],
    instants: ['2026-08-26T09:00:00Z'],
    asOf: today,
    decisionWindows: weeklyDecisionWindows(today),
  });
  assert.deepEqual(metrics.weeklyCumulativeFlow?.window, {
    startDate: statsWindow.startDate,
    endDate: statsWindow.endDate,
    label: statsWindow.label,
  });
});

// ===== TASK-2622.13 consolidation: task-2347-06 lane age & bottleneck (unit) =====
// ---------------------------------------------------------------------------
// Repro tests for task-2347.06 — lane age clock and bottleneck selection
// ---------------------------------------------------------------------------
// These tests lock both bugs before fix and turn green after fix.
// Run: npm test -- test/task-2347-06-repro.test.ts
// ---------------------------------------------------------------------------

const b1 = missionId('task-0010');
const b2 = missionId('task-0020');
const _b3 = missionId('task-0030'); // task-2347.06: declared in source, unused (dead code preserved as provenance)

// ---------------------------------------------------------------------------
// Bug A: age computed against last-event timestamp instead of injected clock
// ---------------------------------------------------------------------------

test('age: mission 3 days (4320 min) before asOf reports age >= 4300 min (SC1, task-2347.06)', () => {
  // Last transition was 3 days before asOf — mission stalled that long
  const threeDaysAgo = '2026-07-19T10:00:00Z';
  const asOf = '2026-07-22T10:00:00Z'; // exactly 4320 minutes later

  const transitions = [
    { missionId: b1, from: 'refined' as const, to: 'active' as const, trigger: 'activate' as const, actor: 'codex', occurredAt: threeDaysAgo },
  ];

  const series = medianAgeByLaneSeries(transitions, asOf);
  const activeAge = series.series.find((entry) => entry.lane === 'active')?.value;

  // With correct asOf (injected clock), age should be ~4320 min
  assert.ok(activeAge !== null, 'active lane should have a non-null age');
  assert.ok(activeAge >= 4300, `active lane age should be >= 4300 min, got ${activeAge}`);
});

test('age: asOf parameter controls computed age, not last transition time (SC1, task-2347.06)', () => {
  const transitionTime = '2026-07-20T08:00:00Z';

  const transitions = [
    { missionId: b1, from: 'backlog' as const, to: 'refined' as const, trigger: 'activate' as const, actor: 'codex', occurredAt: transitionTime },
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

test('bottleneck: done lane NOT selected as bottleneck when active has stall (SC4, task-2347.06)', () => {
  // Mission in done for 30 days (43200 min) — should be excluded
  // Mission in active for 60 min — should be selected
  const doneTransition = '2026-06-22T10:00:00Z'; // 30 days ago
  const activeTransition = '2026-07-22T09:00:00Z'; // 60 min ago
  const asOf = '2026-07-22T10:00:00Z';

  const transitions = [
    { missionId: b1, from: 'review' as const, to: 'done' as const, trigger: 'integrate' as const, actor: 'codex', occurredAt: doneTransition },
    { missionId: b2, from: 'refined' as const, to: 'active' as const, trigger: 'activate' as const, actor: 'codex', occurredAt: activeTransition },
  ];

  const ageSeries = medianAgeByLaneSeries(transitions, asOf);
  const reviewBounceRate: MetricSeries = { series: [{ at: asOf, value: 1.5 }], missingHistoryFallback: 'estimate' };
  const narrative = bottleneckNarrative(ageSeries, reviewBounceRate);

  // Bottleneck should name 'active', NOT 'done'
  assert.ok(
    narrative.inputs.lane === 'active',
    `bottleneck lane should be 'active' (terminal lanes excluded), got '${narrative.inputs.lane}'`,
  );
});

test('bottleneck: integration lane is selected when it is the oldest unfinished mission (SC4, task-2347.06)', () => {
  const integrationTransition = '2026-07-01T10:00:00Z'; // 21 days ago
  const activeTransition = '2026-07-22T08:00:00Z'; // 120 min ago
  const asOf = '2026-07-22T10:00:00Z';

  const transitions = [
    { missionId: b1, from: 'review' as const, to: 'integration' as const, trigger: 'approve' as const, actor: 'codex', occurredAt: integrationTransition },
    { missionId: b2, from: 'refined' as const, to: 'active' as const, trigger: 'activate' as const, actor: 'codex', occurredAt: activeTransition },
  ];

  const ageSeries = medianAgeByLaneSeries(transitions, asOf);
  const reviewBounceRate: MetricSeries = { series: [{ at: asOf, value: 2.0 }], missingHistoryFallback: 'estimate' };
  const narrative = bottleneckNarrative(ageSeries, reviewBounceRate);

  assert.ok(
    narrative.inputs.lane === 'integration',
    `bottleneck lane should be 'integration'. Got '${narrative.inputs.lane}'`,
  );
});

// ---------------------------------------------------------------------------
// SC5: empty lane reports null, bottleneck unavailable when all non-terminal empty
// ---------------------------------------------------------------------------

test('bottleneck: unavailable when all non-terminal lanes have no age (SC5, task-2347.06)', () => {
  // Only done lane has missions; all active lanes empty
  const transitions = [
    { missionId: b1, from: 'review' as const, to: 'done' as const, trigger: 'integrate' as const, actor: 'codex', occurredAt: '2026-07-20T10:00:00Z' },
  ];
  const asOf = '2026-07-22T10:00:00Z';

  const ageSeries = medianAgeByLaneSeries(transitions, asOf);
  const reviewBounceRate: MetricSeries = { series: [{ at: asOf, value: 1.0 }], missingHistoryFallback: 'estimate' };
  const narrative = bottleneckNarrative(ageSeries, reviewBounceRate);

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

test('formatDuration: <60 min returns integer minutes (SC6, task-2347.06)', () => {
  assert.equal(formatDuration(45), '45 min');
  assert.equal(formatDuration(0), '0 min');
  assert.equal(formatDuration(59), '59 min');
});

test('formatDuration: 60-1439 min returns hours with 1 decimal (SC6, task-2347.06)', () => {
  assert.equal(formatDuration(90), '1.5h');
  assert.equal(formatDuration(60), '1.0h');
  assert.equal(formatDuration(120), '2.0h');
  assert.equal(formatDuration(1439), '24.0h');
});

test('formatDuration: >=1440 min returns days with 1 decimal (SC6, task-2347.06)', () => {
  assert.equal(formatDuration(4320), '3.0d');
  assert.equal(formatDuration(1440), '1.0d');
  assert.equal(formatDuration(2520), '1.8d');
});

// ---------------------------------------------------------------------------
// SC2: Clock injection — adapter uses injected clock for asOf
// ---------------------------------------------------------------------------

test('ConcreteMetricsReadAdapter: asOf from injected clock not instants.at(-1) (SC2, task-2347.06)', async () => {
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
        missionId: b1,
        fromStatus: 'refined',
        toStatus: 'active',
        trigger: 'activate',
        agent: 'codex',
        occurredAt: earlyTransition,
        idempotencyKey: `${b1}:activate:${earlyTransition}`,
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

  const metrics = await adapter.buildMetrics(new Map([[b1, 'active']]));

  // Age should be computed against clock (2026-07-22T10:00:00Z), not transition time
  const activeAge = metrics.medianAgeByLane.series.find((e) => e.lane === 'active')?.value;
  assert.ok(activeAge !== null, 'active lane should have age');
  // Clock is 3000 min after transition (2 days + 2 hours)
  assert.ok(activeAge >= 2990, `age should be ~3000 min (from clock), got ${activeAge}`);
});

// ---------------------------------------------------------------------------
// SC3: Mission with no transition contributes lane age from lifecycle entry
// ---------------------------------------------------------------------------

test('medianAgeByLaneSeries: mission with no transition uses lifecycle entry timestamp (SC3, task-2347.06)', () => {
  const asOf = '2026-07-22T10:00:00Z';

  // Only b1 has a transition; b2 has none
  const transitions = [
    { missionId: b1, from: 'backlog' as const, to: 'active' as const, trigger: 'activate' as const, actor: 'codex', occurredAt: '2026-07-22T09:00:00Z' },
  ];

  // Lifecycle entry timestamps for missions without transitions
  const lifecycleEntries = new Map([
    [b2, '2026-07-21T10:00:00Z'], // b2 entered refined 1 day ago
  ]) as Map<MissionId, string>;

  // Initial states include b2 (in refined, no transition)
  const initialStates = new Map([
    [b1, 'active'],
    [b2, 'refined'],
  ]) as Map<MissionId, MissionStatus>;

  const series = medianAgeByLaneSeries(transitions, asOf, initialStates as ReadonlyMap<MissionId, MissionStatus>, lifecycleEntries as ReadonlyMap<MissionId, string>);

  // b1 in active: 60 min (from transition)
  const activeAge = series.series.find((e) => e.lane === 'active')?.value;
  assert.ok(activeAge !== null && activeAge >= 59, `active age should be ~60, got ${activeAge}`);

  // b2 in refined: 1440 min (from lifecycle entry)
  const refinedAge = series.series.find((e) => e.lane === 'refined')?.value;
  assert.ok(refinedAge !== null, 'refined lane should have non-null age from lifecycle entry');
  assert.ok(refinedAge >= 1400, `refined age should be ~1440, got ${refinedAge}`);
});

// ===== TASK-2622.13 consolidation: task-2347.04 throughput (unit) =====
class ThroughputInMemoryUsageRepository implements UsageRepository {
  private readonly records: readonly UsageRecord[];
  constructor(records: readonly UsageRecord[]) { this.records = records; }

  async findAll(): Promise<readonly UsageRecord[]> { return this.records; }
  async findWhere(predicate: (_record: UsageRecord) => boolean): Promise<readonly UsageRecord[]> {
    return this.records.filter(predicate);
  }
  async save(): Promise<void> {}
  async saveAll(): Promise<void> {}
  async clear(): Promise<void> {}
}

test('throughput excludes active and review telemetry (task-2347.04)', async () => {
  const adapter = new ConcreteMetricsReadAdapter({
    // Partial double: this test only reads lane events, so the writing half of
    // the port is deliberately absent and the cast goes through `unknown`.
    laneEventRepo: {
      findByRepositoryId: async () => [
        { repositoryId: 'parallix', missionId: 'task-closed', fromStatus: 'integration', toStatus: 'done', trigger: 'integrate', agent: 'codex', occurredAt: '2026-06-01T00:00:00Z', idempotencyKey: 'task-closed-done' },
      ],
    } as unknown as BoardLaneEventRepository,
    usageRepo: new ThroughputInMemoryUsageRepository([
      { repo: 'parallix', mission: 'task-closed', date: '2026-06-01', duration_minutes: 10 },
      { repo: 'parallix', mission: 'task-active', date: '2026-07-27', stage: 'active', duration_minutes: 20 },
      { repo: 'parallix', mission: 'task-review', date: '2026-07-28', stage: 'review', duration_minutes: 30 },
    ]),
    repositoryId: 'parallix' as never,
  });

  const metrics = await adapter.buildMetrics(new Map());
  assert.equal(metrics.throughput.series.at(-1)?.value, 1);

});

test('historical metrics exclude outcomes closed after each instant (task-2347.04)', () => {
  const outcomes = [
    { missionId: 'task-early' as never, repositoryId: 'parallix' as never, createdAt: '2026-07-01T00:00:00Z', closedAt: '2026-07-10T00:00:00Z', cycleTimeMinutes: 10, reviewFixRounds: 1, runs: [] },
    { missionId: 'task-late' as never, repositoryId: 'parallix' as never, createdAt: '2026-07-11T00:00:00Z', closedAt: '2026-07-20T00:00:00Z', cycleTimeMinutes: 30, reviewFixRounds: 3, runs: [] },
  ] as unknown as readonly MissionOutcome[];
  const instants = ['2026-07-15T00:00:00Z', '2026-07-21T00:00:00Z'];

  assert.deepEqual(throughputSeries(outcomes, instants).series.map((point) => point.value), [1, 2]);
  assert.deepEqual(medianStateTimes(outcomes, instants).series.map((point) => point.value), [10, 20]);
  const transitions = [
    { missionId: 'task-early' as never, from: 'active' as const, to: 'review' as const, trigger: 'submit-for-review' as const, actor: 'codex', occurredAt: '2026-07-10T00:00:00Z' },
    { missionId: 'task-early' as never, from: 'review' as const, to: 'active' as const, trigger: 'request-changes' as const, actor: 'codex', occurredAt: '2026-07-11T00:00:00Z' },
    { missionId: 'task-late' as never, from: 'active' as const, to: 'review' as const, trigger: 'submit-for-review' as const, actor: 'codex', occurredAt: '2026-07-20T00:00:00Z' },
  ];
  assert.deepEqual(reviewBounceRateSeries(transitions, instants).series.map((point) => point.value), [1, 0.5]);
});

test('lifecycle completion survives absent telemetry and ignores later close (task-2347.04)', async () => {
  const laneEventRepo = {
    async findByRepositoryId() {
      return [
        { repositoryId: 'parallix', missionId: 'task-lifecycle-only', fromStatus: null, toStatus: 'backlog', trigger: 'intake', agent: 'codex', occurredAt: '2026-07-01T08:00:00Z', idempotencyKey: 'intake' },
        { repositoryId: 'parallix', missionId: 'task-lifecycle-only', fromStatus: 'integration', toStatus: 'done', trigger: 'integrate', agent: 'codex', occurredAt: '2026-07-06T23:30:00-02:00', idempotencyKey: 'done' },
        { repositoryId: 'parallix', missionId: 'task-lifecycle-only', fromStatus: 'done', toStatus: 'done', trigger: 'close', agent: 'codex', occurredAt: '2026-07-20T00:00:00Z', idempotencyKey: 'close' },
      ];
    },
  } as unknown as BoardLaneEventRepository;
  const adapter = new ConcreteMetricsReadAdapter({
    laneEventRepo,
    usageRepo: new ThroughputInMemoryUsageRepository([]),
    repositoryId: 'parallix' as never,
    clock: () => '2026-07-27T12:00:00Z',
  });

  const outcomes = await adapter.readOutcomes();
  assert.deepEqual(outcomes.map((outcome) => ({ closedAt: outcome.closedAt, cycleTimeMinutes: outcome.cycleTimeMinutes })), [
    { closedAt: '2026-07-06T23:30:00-02:00', cycleTimeMinutes: 8250 },
  ]);
  const metrics = await adapter.buildMetrics(new Map([['task-lifecycle-only' as never, 'done' as never]]));
  assert.equal(metrics.decisionWindow?.current.completedMissions, 0);
});

test('cohort labels and implementer come from canonical Mission metadata, not telemetry (task-2347.04)', async () => {
  const laneEventRepo = {
    async findByRepositoryId() {
      return [
        { repositoryId: 'parallix', missionId: 'task-canonical', fromStatus: null, toStatus: 'backlog', trigger: 'intake', agent: 'codex', occurredAt: '2026-07-01T08:00:00Z', idempotencyKey: 'intake' },
        { repositoryId: 'parallix', missionId: 'task-canonical', fromStatus: 'integration', toStatus: 'done', trigger: 'integrate', agent: 'codex', occurredAt: '2026-07-02T08:00:00Z', idempotencyKey: 'done' },
      ];
    },
  } as unknown as BoardLaneEventRepository;
  const adapter = new ConcreteMetricsReadAdapter({
    laneEventRepo,
    usageRepo: new ThroughputInMemoryUsageRepository([{ repo: 'parallix', mission: 'task-canonical', date: '2026-07-02', classification: 'wrong-label', implementer: 'claude' }]),
    repositoryId: 'parallix' as never,
    cohortMetadata: async () => new Map([['task-canonical' as never, { labels: ['ai_sdlc' as never], assignee: 'codex' as never }]]),
  });
  const [outcome] = await adapter.readOutcomes();
  assert.deepEqual(outcome?.labels, ['ai_sdlc']);
  assert.equal(outcome?.implementer, 'codex');
});

