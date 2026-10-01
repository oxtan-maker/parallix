import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LIFECYCLE_DEADLINE_MS,
  LifecycleDeadlineMissed,
  checkLifecycleDeadline,
  monotonicNowMs,
} from '../src/application/lifecycle-timing.js';
import {
  deriveLaneIntervals,
  medianCycleTimeByStateSeries,
  buildMetrics,
} from '../src/application/projections/metrics.js';
import { ConcreteMetricsReadAdapter } from '../src/application/projections/metrics-read-adapter.js';
import {
  decisionWindowContains,
  decisionWindowEndingOn,
  weeklyDecisionWindows,
} from '../src/application/services/decision-window.js';
import { statisticsRowInWindow } from '../src/application/services/statistics-service.js';
import { missionId, missionLabels, requireClosedMission } from '../src/domain/mission.js';
import { completedMissionStatistics } from '../src/domain/usage.js';
import { agentFamily } from '../src/domain/agents.js';
import type { MissionTransition } from '../src/domain/mission-workflow.js';
import type { MissionId, MissionStatus } from '../src/domain/mission.js';
import type { RepositoryId } from '../src/domain/repository.js';
import type { UsageRecord, UsageRepository } from '../src/application/ports/mission-measurements.js';
import type { BoardLaneEventEntry, BoardLaneEventRepository } from '../src/application/ports/operation-history.js';
import type { BoardMetrics } from '../src/application/projections/board.js';
import 'react';
import 'ink';
import '../src/interfaces/tui/flow-panel.js';
import {
  CURRENT_WINDOW_LABEL,
  EXPECTED_CURRENT_CYCLE_MEDIAN,
  EXPECTED_CURRENT_CYCLE_N,
  EXPECTED_CURRENT_RUNTIME_MEDIAN,
  EXPECTED_CURRENT_RUNTIME_N,
  EXPECTED_PREVIOUS_CYCLE_MEDIAN,
  EXPECTED_PREVIOUS_CYCLE_N,
  NOW,
  PREVIOUS_WINDOW_LABEL,
  completedMission,
  contaminatedHistory,
} from './fixtures/task-2363-decision-window-fixture.js';

// The Mission lifecycle timing contract (TASK-2582): deferred destination
// persistence must complete within LIFECYCLE_DEADLINE_MS of destination-work
// start, measured end to end on a monotonic clock.

test('lifecycle deadline budget is 200 ms', () => {
  assert.equal(LIFECYCLE_DEADLINE_MS, 200);
});

test('monotonicNowMs is a monotonic clock: it never decreases across calls', () => {
  const a = monotonicNowMs();
  const b = monotonicNowMs();
  assert.ok(b >= a, `expected non-decreasing monotonic readings, got ${a} then ${b}`);
});

test('checkLifecycleDeadline passes when persistence lands within the budget', () => {
  assert.doesNotThrow(() => checkLifecycleDeadline({ startedAtMs: 1_000, nowMs: 1_100, what: 'active lifecycle boundary for task-1' }));
});

test('checkLifecycleDeadline passes at exactly the deadline boundary', () => {
  // The contract is "within 200 ms": exactly 200 ms has not exceeded it.
  assert.doesNotThrow(() => checkLifecycleDeadline({ startedAtMs: 0, nowMs: LIFECYCLE_DEADLINE_MS, what: 'boundary' }));
});

test('checkLifecycleDeadline throws LifecycleDeadlineMissed past the budget', () => {
  try {
    checkLifecycleDeadline({ startedAtMs: 0, nowMs: LIFECYCLE_DEADLINE_MS + 1, what: 'active lifecycle boundary for task-1' });
    assert.fail('expected LifecycleDeadlineMissed');
  } catch (error) {
    assert.ok(error instanceof LifecycleDeadlineMissed, `expected LifecycleDeadlineMissed, got ${String(error)}`);
    assert.match(error.message, /active lifecycle boundary for task-1 missed the 200 ms lifecycle persistence deadline/);
    assert.ok(error.elapsedMs > LIFECYCLE_DEADLINE_MS);
    assert.equal(error.deadlineMs, LIFECYCLE_DEADLINE_MS);
  }
});

test('checkLifecycleDeadline honours a caller-supplied budget', () => {
  assert.doesNotThrow(() => checkLifecycleDeadline({ startedAtMs: 0, nowMs: 150, deadlineMs: 200, what: 'boundary' }));
  assert.throws(
    () => checkLifecycleDeadline({ startedAtMs: 0, nowMs: 150, deadlineMs: 100, what: 'boundary' }),
    LifecycleDeadlineMissed,
  );
});

// ===== TASK-2622.13 consolidation: task-2347.03 (unit) =====
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

test('dwell time between backlog->active and active->review is attributed to active (not review) (task-2347.03)', () => {
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

test('medianCycleTimeByStateSeries returns LaneMetricSeries shape with all board lanes (task-2347.03)', () => {
  const result = medianCycleTimeByStateSeries(transitions);

  assert.equal(result.series.length, 6, 'must return all 6 board lanes');
  assert.equal(result.missingHistoryFallback, 'null');
});

test('multi-mission dwell attribution: each mission intervals attributed to state occupied (task-2347.03)', () => {
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

test('out-of-order transitions produce deterministic interval sequence (sorted by occurredAt) (task-2347.03)', () => {
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

test('duplicate transitions collapsed — same missionId+from+to+occurredAt yields one interval (task-2347.03)', () => {
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


// ===== TASK-2622.13 consolidation: task-2347.05 (unit) =====
// ---------------------------------------------------------------------------
// task-2347.05 — agent runtime and lifecycle cycle time are separate quantities
//
// Scenario under test (the one named in the mission brief): a mission that
// enters the backlog on 2026-08-01T10:00:00Z and closes on 2026-08-02T12:00:00Z
// has a 26-hour (1560 minute) lifecycle, while its agents ran for 22 + 15 = 37
// minutes. The two numbers differ by far more than the 1-minute floor SC1 asks
// for, so a projection that reports 37 as "cycle time" is detectably wrong.
// ---------------------------------------------------------------------------

const REPO = '/repo' as RepositoryId;
const TASK = 'task-2347.05-fixture';
const ID: MissionId = missionId(TASK);

const LIFECYCLE_MINUTES = 26 * 60;
const RUNTIME_MINUTES = 37;

function entry(
  fromStatus: string | null,
  toStatus: string,
  trigger: string,
  occurredAt: string,
): BoardLaneEventEntry {
  return {
    repositoryId: REPO,
    missionId: TASK,
    fromStatus,
    toStatus,
    trigger,
    agent: 'codex',
    occurredAt,
    idempotencyKey: `${TASK}-${toStatus}-${occurredAt}`,
  };
}

const LANE_EVENTS: readonly BoardLaneEventEntry[] = [
  entry(null, 'backlog', 'create', '2026-08-01T10:00:00Z'),
  entry('backlog', 'active', 'activate', '2026-08-01T10:30:00Z'),
  entry('active', 'review', 'submit-for-review', '2026-08-01T11:00:00Z'),
  entry('review', 'integration', 'approve', '2026-08-02T11:30:00Z'),
  entry('integration', 'done', 'integrate', '2026-08-02T12:00:00Z'),
];

const USAGE_RECORDS: readonly UsageRecord[] = [
  {
    date: '2026-08-01',
    repo: REPO,
    mission: TASK,
    implementer: 'codex',
    implementer_agent: 'codex',
    stage: 'execute',
    provider: 'openai',
    model: 'gpt-5',
    input_tokens: 1000,
    output_tokens: 200,
    cached_tokens: 50,
    context_tokens: 1250,
    tool_calls: 12,
    duration_minutes: 22,
    cost_usd: 0.5,
    pr_fix_rounds: 1,
  },
  {
    date: '2026-08-02',
    repo: REPO,
    mission: TASK,
    implementer: 'codex',
    reviewer_agent: 'claude',
    stage: 'review',
    provider: 'anthropic',
    model: 'claude-opus-5',
    input_tokens: 800,
    output_tokens: 100,
    cached_tokens: 20,
    context_tokens: 900,
    tool_calls: 5,
    duration_minutes: 15,
    cost_usd: 0.25,
    pr_fix_rounds: 2,
  },
];

class FakeLaneEventRepository implements BoardLaneEventRepository {
  private readonly entries: readonly BoardLaneEventEntry[];
  constructor(entries: readonly BoardLaneEventEntry[]) { this.entries = entries; }
  async append(): Promise<boolean> { return true; }
  async findByMissionId(id: string): Promise<readonly BoardLaneEventEntry[]> {
    return this.entries.filter((e) => e.missionId === id);
  }
  async findAll(): Promise<readonly BoardLaneEventEntry[]> { return this.entries; }
  async findByRepositoryId(repositoryId: string): Promise<readonly BoardLaneEventEntry[]> {
    return this.entries.filter((e) => e.repositoryId === repositoryId);
  }
  async clear(): Promise<void> { /* fixture is immutable */ }
}

class FakeUsageRepository implements UsageRepository {
  private readonly records: readonly UsageRecord[];
  constructor(records: readonly UsageRecord[]) { this.records = records; }
  async findAll(): Promise<readonly UsageRecord[]> { return this.records; }
  async findWhere(predicate: (_record: UsageRecord) => boolean): Promise<readonly UsageRecord[]> {
    return this.records.filter((record) => predicate(record));
  }
  async save(): Promise<void> { /* fixture is immutable */ }
  async saveAll(): Promise<void> { /* fixture is immutable */ }
  async clear(): Promise<void> { /* fixture is immutable */ }
}

function adapter(
  entries: readonly BoardLaneEventEntry[] = LANE_EVENTS,
  records: readonly UsageRecord[] = USAGE_RECORDS,
): ConcreteMetricsReadAdapter {
  return new ConcreteMetricsReadAdapter({
    laneEventRepo: new FakeLaneEventRepository(entries),
    usageRepo: new FakeUsageRepository(records),
    repositoryId: REPO,
    // Completed-mission metrics report a rolling seven-day window (TASK-2363);
    // the clock is pinned beside the fixture's fixed closure date.
    clock: () => '2026-08-02T18:00:00Z',
  });
}

const INITIAL_STATES = new Map<MissionId, MissionStatus>([[ID, 'done']]);

/** Build the metrics projection the board consumes. */
async function metricsFromAdapter(
  entries: readonly BoardLaneEventEntry[] = LANE_EVENTS,
  records: readonly UsageRecord[] = USAGE_RECORDS,
) {
  return adapter(entries, records).buildMetrics(INITIAL_STATES);
}

test('SC1: cycle time reflects the lifecycle wall clock, not the summed agent runtime (task-2347.05)', async () => {
  const outcomes = await adapter().readOutcomes();
  assert.equal(outcomes.length, 1, `expected one completed outcome, got ${outcomes.length}`);
  const outcome = outcomes[0]!;
  assert.equal(
    outcome.cycleTimeMinutes,
    LIFECYCLE_MINUTES,
    `cycle time must be the ${LIFECYCLE_MINUTES}-minute lifecycle, not the ${RUNTIME_MINUTES}-minute agent runtime`,
  );
  assert.notEqual(outcome.cycleTimeMinutes, RUNTIME_MINUTES);
  assert.equal(outcome.createdAt, '2026-08-01T10:00:00Z');
  assert.equal(outcome.closedAt, '2026-08-02T12:00:00Z');
});

test('SC2/SC3: every outcome carries one AgentRunMeasurement per usage record (task-2347.05)', async () => {
  const outcomes = await adapter().readOutcomes();
  const outcome = outcomes[0]!;
  assert.equal(outcome.runs.length, USAGE_RECORDS.length);
  assert.ok(outcomes.every((o) => o.runs.length > 0), 'no outcome may be returned with runs: []');

  const execute = outcome.runs.find((run) => run.stage === 'execute')!;
  assert.equal(execute.role, 'implementer');
  assert.deepEqual(execute.durationMinutes, { kind: 'measured', value: 22 });
  assert.deepEqual(execute.tokens.input, { kind: 'measured', value: 1000 });
  assert.deepEqual(execute.tokens.output, { kind: 'measured', value: 200 });
  assert.deepEqual(execute.tokens.cached, { kind: 'measured', value: 50 });
  assert.deepEqual(execute.tokens.context, { kind: 'measured', value: 1250 });
  assert.deepEqual(execute.toolCalls, { kind: 'measured', value: 12 });
  assert.deepEqual(execute.costUsd, { kind: 'measured', value: 0.5 });
  assert.deepEqual(execute.runtime.provider, { kind: 'measured', value: 'openai' });
  assert.deepEqual(execute.runtime.model, { kind: 'measured', value: 'gpt-5' });
  assert.equal(execute.recordedOn, '2026-08-01');

  const review = outcome.runs.find((run) => run.stage === 'review')!;
  assert.equal(review.role, 'reviewer');
  assert.equal(review.agent, agentFamily('claude'));
  assert.deepEqual(review.durationMinutes, { kind: 'measured', value: 15 });
});

test('SC2: lifecycle cycle time survives usage rows whose durations are absent (task-2347.05)', async () => {
  const withoutDurations = USAGE_RECORDS.map(({ duration_minutes: _ignored, ...rest }) => rest);
  const outcomes = await adapter(LANE_EVENTS, withoutDurations).readOutcomes();
  assert.equal(outcomes[0]!.cycleTimeMinutes, LIFECYCLE_MINUTES);
  assert.deepEqual(outcomes[0]!.runs[0]!.durationMinutes, {
    kind: 'unavailable',
    reason: 'duration_minutes missing on usage record',
  });
});

test('SC2: telemetry without lifecycle completion produces no outcome (task-2347.05)', async () => {
  const outcomes = await adapter([], USAGE_RECORDS).readOutcomes();
  assert.equal(outcomes.length, 0);
});

test('SC2: a lane history with no completion event excludes telemetry-only completion (task-2347.05)', async () => {
  // A telemetry closure cannot complete a mission whose lifecycle is known but
  // has not entered done.
  const openLaneHistory = LANE_EVENTS.filter((event) => event.toStatus !== 'done');
  const outcomes = await adapter(openLaneHistory, USAGE_RECORDS).readOutcomes();
  assert.equal(outcomes.length, 0);
});

test('SC4: medianStateTimes reports the lifecycle cycle time (task-2347.05)', async () => {
  const metrics = await metricsFromAdapter();
  const median = metrics.medianStateTimes.series.at(-1)?.value;
  assert.equal(median, LIFECYCLE_MINUTES, 'median state time must be lifecycle-derived');
});

test('SC5: the board exposes agent runtime separately from cycle time (task-2347.05)', async () => {
  const metrics = await metricsFromAdapter();
  const runtime = metrics.medianAgentRuntime.series.at(-1)?.value;
  assert.equal(runtime, RUNTIME_MINUTES, 'median agent runtime must sum the run durations');
  assert.notEqual(runtime, metrics.medianStateTimes.series.at(-1)?.value);
});

test('SC5: FLOW panel labels lifecycle cycle time and agent runtime distinctly (task-2347.05)', async () => {
  const ink = await import('ink');
  const React = await import('react');
  const { FlowPanel } = await import('../src/interfaces/tui/flow-panel.js');
  const metrics = await metricsFromAdapter();
  const ESC = String.fromCharCode(27);
  const output = ink
    .renderToString(React.createElement(FlowPanel, { metrics, columns: 200 }), { columns: 200 })
    .replace(new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g'), '');

  assert.ok(output.includes('Lifecycle cycle median'), `FLOW must label lifecycle cycle time. Got: ${output}`);
  assert.ok(output.includes('Agent runtime median'), `FLOW must label agent runtime. Got: ${output}`);
  assert.match(
    output,
    new RegExp(`Agent runtime median\\s+${RUNTIME_MINUTES} min`),
    `agent runtime must render ${RUNTIME_MINUTES} min. Got: ${output}`,
  );
  assert.match(
    output,
    new RegExp(`Lifecycle cycle median\\s+${LIFECYCLE_MINUTES} min`),
    `lifecycle cycle time must render ${LIFECYCLE_MINUTES} min. Got: ${output}`,
  );
  // No label may present the agent's execution minutes under a "cycle time" name.
  const runtimeLine = output.split('\n').find((line) => line.includes('Agent runtime median'))!;
  assert.ok(!/cycle time/i.test(runtimeLine), `runtime line must not say "cycle time": ${runtimeLine}`);
});

test('SC6: CompletedMissionStatistics still sums runtime from outcome.runs (task-2347.05)', async () => {
  const outcomes = await adapter().readOutcomes();
  const mission = requireClosedMission({
    id: ID,
    repositoryId: REPO,
    title: 'Separate agent runtime from lifecycle cycle time',
    labels: missionLabels(['ai_sdlc', 'bug']),
    status: 'done',
    rawStatus: 'done',
    closedAt: '2026-08-02T12:00:00Z',
    assignee: agentFamily('codex'),
    checkpoints: [],
    review: null,
    netEngineeringLines: 120,
  });
  const statistics = completedMissionStatistics(mission, outcomes[0]!);
  assert.equal(statistics.totalDurationMinutes, RUNTIME_MINUTES);
  assert.equal(statistics.totalCostUsd, 0.75);
  assert.equal(statistics.totalInputAndOutputTokens, 2100);
  assert.equal(statistics.totalToolCalls, 17);
  assert.equal(statistics.modelsInvolved.length, 2);
});


// ===== TASK-2622.13 consolidation: task-2363-decision-window (unit) =====
// ---------------------------------------------------------------------------
// TASK-2363 — the one application-owned rolling-window definition.
// ---------------------------------------------------------------------------

describe('TASK-2363: weekly decision windows', () => {
  it('returns current and previous non-overlapping 7-day ranges', () => {
    const windows = weeklyDecisionWindows('2026-08-11');
    assert.equal(windows.current.startDate, '2026-08-05');
    assert.equal(windows.current.endDate, '2026-08-11');
    assert.equal(windows.previous.startDate, '2026-07-29');
    assert.equal(windows.previous.endDate, '2026-08-04');
  });

  it('labels each window with its inclusive date range', () => {
    const windows = weeklyDecisionWindows('2026-08-11');
    assert.equal(windows.current.label, '2026-08-05 → 2026-08-11');
    assert.equal(windows.previous.label, '2026-07-29 → 2026-08-04');
  });

  it('reads the day from an injected full-instant clock', () => {
    const windows = weeklyDecisionWindows('2026-08-11T23:59:59.999Z');
    assert.equal(windows.current.label, '2026-08-05 → 2026-08-11');
  });

  it('crosses a month boundary without shifting the window length', () => {
    const windows = weeklyDecisionWindows('2026-03-02');
    assert.equal(windows.current.startDate, '2026-02-24');
    assert.equal(windows.previous.startDate, '2026-02-17');
    assert.equal(windows.previous.endDate, '2026-02-23');
  });

  it('contains a completion at any time on the last day', () => {
    const windows = weeklyDecisionWindows('2026-08-11');
    assert.equal(decisionWindowContains(windows.current, '2026-08-11T23:30:00.000Z'), true);
    assert.equal(decisionWindowContains(windows.current, '2026-08-05T00:00:00.000Z'), true);
    assert.equal(decisionWindowContains(windows.current, '2026-08-04T23:59:59.999Z'), false);
    assert.equal(decisionWindowContains(windows.previous, '2026-08-04T23:59:59.999Z'), true);
  });

  it('stays compatible with the date-only telemetry comparison px stats uses', () => {
    const window = decisionWindowEndingOn('2026-06-20', 7);
    assert.equal(statisticsRowInWindow({ date: '2026-06-14' }, window), true);
    assert.equal(statisticsRowInWindow({ date: '2026-06-20' }, window), true);
    assert.equal(statisticsRowInWindow({ date: '2026-06-13' }, window), false);
    assert.equal(statisticsRowInWindow({ date: '2026-06-21' }, window), false);
  });
});


// ===== TASK-2622.13 consolidation: task-2363-weekly (unit) =====
// ---------------------------------------------------------------------------
// TASK-2363 — FLOW is a weekly decision surface.
//
// The fixture holds 240 old completed missions with extreme cycle times beside
// 28 previous-window and 31 current-window missions. Cumulative statistics over
// it report n = 299; the weekly decision statistics must report n = 31 with a
// hand-computed median of 40 minutes.
//
// Former behavior that makes each assertion below fail: aggregating every
// completed outcome regardless of `closedAt` (the pre-TASK-2363 behavior of
// `medianStateTimes`, `medianAgentRuntime`, `medianCycleTimeByStateSeries` and
// `reviewBounceRateSeries`).
// ---------------------------------------------------------------------------

function metricsOverContaminatedHistory(): BoardMetrics {
  const history = contaminatedHistory();
  return buildMetrics({
    initialStates: history.initialStates,
    transitions: history.transitions,
    outcomes: history.outcomes,
    instants: [NOW],
    asOf: NOW,
    decisionWindows: weeklyDecisionWindows(NOW),
  }) as BoardMetrics;
}

describe('TASK-2363: completed-mission decision metrics use the rolling 7-day window', () => {
  it('reports the current-window cycle-time population, not all history', () => {
    const metrics = metricsOverContaminatedHistory();
    const point = metrics.medianStateTimes.series.at(-1);
    assert.equal(point?.observationCount, EXPECTED_CURRENT_CYCLE_N);
  });

  it('keeps extreme historical cycle times out of the current median', () => {
    const metrics = metricsOverContaminatedHistory();
    assert.equal(metrics.medianStateTimes.series.at(-1)?.value, EXPECTED_CURRENT_CYCLE_MEDIAN);
  });

  it('reports agent runtime only from missions completed in the current window', () => {
    const metrics = metricsOverContaminatedHistory();
    const point = metrics.medianAgentRuntime.series.at(-1);
    assert.equal(point?.observationCount, EXPECTED_CURRENT_RUNTIME_N);
    assert.equal(point?.value, EXPECTED_CURRENT_RUNTIME_MEDIAN);
  });

  it('reports active lane dwell from the full lifecycle of current-window missions', () => {
    const metrics = metricsOverContaminatedHistory();
    const active = metrics.medianCycleTimeByState.series.find((entry) => entry.lane === 'active');
    // 31 missions each with one active interval, plus one extra interval for
    // each of the 5 that bounced back from review: 36 intervals of 9 minutes.
    assert.equal(active?.observationCount, 36);
    assert.equal(active?.value, 9);
  });

  it('reports review bounce rate from current-window missions only', () => {
    const metrics = metricsOverContaminatedHistory();
    const point = metrics.reviewBounceRate.series.at(-1);
    // 31 missions entered review; 5 of them bounced once.
    assert.equal(point?.observationCount, 31);
    assert.equal(point?.value, 5 / 31);
  });

  it('exposes the current and previous decision windows with their dates', () => {
    const metrics = metricsOverContaminatedHistory();
    assert.ok(metrics.decisionWindow, 'BoardMetrics must carry the decision-window comparison');
    assert.equal(metrics.decisionWindow.current.label, CURRENT_WINDOW_LABEL);
    assert.equal(metrics.decisionWindow.previous.label, PREVIOUS_WINDOW_LABEL);
  });

  it('states the previous window as an independent hand-computed population', () => {
    const metrics = metricsOverContaminatedHistory();
    const previous = metrics.decisionWindow?.previous;
    assert.equal(previous?.completedMissions, EXPECTED_PREVIOUS_CYCLE_N);
    assert.equal(previous?.cycleTime.value, EXPECTED_PREVIOUS_CYCLE_MEDIAN);
    assert.equal(previous?.cycleTime.observationCount, EXPECTED_PREVIOUS_CYCLE_N);
  });

  it('counts the full lifecycle of a mission that started before the window opened', () => {
    // Active from 2026-08-01T00:00Z to 2026-08-06T00:00Z — 7200 minutes, four
    // of those five days before the window opens on 2026-08-05. Truncating the
    // interval at the window edge would report 1440.
    const spanning = completedMission({
      id: 'task-0600',
      createdAt: '2026-08-01T00:00:00.000Z',
      closedAt: '2026-08-06T12:00:00.000Z',
      cycleTimeMinutes: 7920,
      activeDwellMinutes: 7199,
      reviewDwellMinutes: 30,
    });
    const metrics = buildMetrics({
      initialStates: new Map([[spanning.outcome.missionId, 'done' as const]]),
      transitions: spanning.transitions,
      outcomes: [spanning.outcome],
      instants: [NOW],
      asOf: NOW,
      decisionWindows: weeklyDecisionWindows(NOW),
    }) as BoardMetrics;

    assert.equal(metrics.decisionWindow?.current.completedMissions, 1);
    assert.equal(metrics.decisionWindow?.current.cycleTime.value, 7920);
    assert.equal(metrics.decisionWindow?.current.activeDwell.value, 7199);
  });

  it('excludes a mission that started inside the window but has not completed', () => {
    const open = completedMission({
      id: 'task-0601',
      createdAt: '2026-08-07T00:00:00.000Z',
      closedAt: '2026-08-08T00:00:00.000Z',
      cycleTimeMinutes: 1440,
    });
    // Keep the lifecycle up to `review` and drop the closing transition and the
    // outcome: the mission is still in flight.
    const inFlight = open.transitions.filter((transition) => transition.to !== 'done');
    const metrics = buildMetrics({
      initialStates: new Map([[open.outcome.missionId, 'review' as const]]),
      transitions: inFlight,
      outcomes: [],
      instants: [NOW],
      asOf: NOW,
      decisionWindows: weeklyDecisionWindows(NOW),
    }) as BoardMetrics;

    assert.equal(metrics.decisionWindow?.current.completedMissions, 0);
    assert.equal(metrics.decisionWindow?.current.cycleTime.value, null);
    assert.equal(metrics.decisionWindow?.current.cycleTime.observationCount, 0);
    assert.equal(metrics.decisionWindow?.current.activeDwell.observationCount, 0);
    // It is still in the lane, so the current-state metric does see it.
    assert.equal(
      metrics.medianAgeByLane.series.find((entry) => entry.lane === 'review')?.observationCount,
      1,
    );
  });

  it('keeps current-state lane age unwindowed', () => {
    const metrics = metricsOverContaminatedHistory();
    // Every fixture mission is in `done`, so the operational lane-age metric
    // still observes all 299 of them rather than only the 31 recent ones.
    const done = metrics.medianAgeByLane.series.find((entry) => entry.lane === 'done');
    assert.equal(done?.observationCount, 299);
  });
});

