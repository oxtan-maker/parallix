import test from 'node:test';
import assert from 'node:assert/strict';

import { ConcreteMetricsReadAdapter } from '../src/application/projections/metrics-read-adapter.js';
import type { BoardLaneEventEntry, BoardLaneEventRepository } from '../src/application/ports/operation-history.js';
import type { UsageRecord, UsageRepository } from '../src/application/ports/mission-measurements.js';
import type { MissionId, MissionStatus } from '../src/domain/mission.js';
import { missionId, missionLabels, requireClosedMission } from '../src/domain/mission.js';
import type { RepositoryId } from '../src/domain/repository.js';
import { completedMissionStatistics } from '../src/domain/usage.js';
import { agentFamily } from '../src/domain/agents.js';

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

test('SC1: cycle time reflects the lifecycle wall clock, not the summed agent runtime', async () => {
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

test('SC2/SC3: every outcome carries one AgentRunMeasurement per usage record', async () => {
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

test('SC2: lifecycle cycle time survives usage rows whose durations are absent', async () => {
  const withoutDurations = USAGE_RECORDS.map(({ duration_minutes: _ignored, ...rest }) => rest);
  const outcomes = await adapter(LANE_EVENTS, withoutDurations).readOutcomes();
  assert.equal(outcomes[0]!.cycleTimeMinutes, LIFECYCLE_MINUTES);
  assert.deepEqual(outcomes[0]!.runs[0]!.durationMinutes, {
    kind: 'unavailable',
    reason: 'duration_minutes missing on usage record',
  });
});

test('SC2: telemetry without lifecycle completion produces no outcome', async () => {
  const outcomes = await adapter([], USAGE_RECORDS).readOutcomes();
  assert.equal(outcomes.length, 0);
});

test('SC2: a lane history with no completion event excludes telemetry-only completion', async () => {
  // A telemetry closure cannot complete a mission whose lifecycle is known but
  // has not entered done.
  const openLaneHistory = LANE_EVENTS.filter((event) => event.toStatus !== 'done');
  const outcomes = await adapter(openLaneHistory, USAGE_RECORDS).readOutcomes();
  assert.equal(outcomes.length, 0);
});

test('SC4: medianStateTimes reports the lifecycle cycle time', async () => {
  const metrics = await metricsFromAdapter();
  const median = metrics.medianStateTimes.series.at(-1)?.value;
  assert.equal(median, LIFECYCLE_MINUTES, 'median state time must be lifecycle-derived');
});

test('SC5: the board exposes agent runtime separately from cycle time', async () => {
  const metrics = await metricsFromAdapter();
  const runtime = metrics.medianAgentRuntime.series.at(-1)?.value;
  assert.equal(runtime, RUNTIME_MINUTES, 'median agent runtime must sum the run durations');
  assert.notEqual(runtime, metrics.medianStateTimes.series.at(-1)?.value);
});

test('SC5: FLOW panel labels lifecycle cycle time and agent runtime distinctly', async () => {
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

test('SC6: CompletedMissionStatistics still sums runtime from outcome.runs', async () => {
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
