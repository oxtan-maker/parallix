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
  type MetricsInput,
} from '../src/application/projections/metrics.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId } from '../src/domain/mission.js';
import { missionOutcome } from './fixtures/mission-outcome.js';
import { weeklyDecisionWindows } from '../src/application/services/decision-window.js';

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
  assert.equal(metrics.weeklyThroughput.series[0]?.value, 2);
  assert.deepEqual(metrics.agentAvailability.map((agent) => [agent.family, agent.available]), [['codex', true], ['claude', false]]);
  assert.equal(metrics.bottleneck.sentence, 'review is the oldest lane at 2.0h median age; review bounce 0.5; 2 completed in the current reporting week.');
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
  assert.equal(bottleneckNarrative(metrics.medianAgeByLane, metrics.reviewBounceRate, metrics.weeklyThroughput).sentence, 'Bottleneck unavailable: history is missing.');
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
