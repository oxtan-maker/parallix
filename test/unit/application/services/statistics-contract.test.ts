import { repositoryId as fixtureRepositoryId } from '../../../../src/domain/repository.js';
import { missionId as fixtureMissionId } from '../../../../src/domain/mission.js';
import { weeklyDecisionWindows } from '../../../../src/application/services/decision-window.js';
/**
 * Statistics contract for the metrics slice (TASK-2622.13 consolidation).
 *
 * Unit-tier provenance tests that migrated from the historical regression
 * identities `test/task-2347.08-own-statistics-semantics-repro.test.ts`
 * (CLI and board agree on identity, completions, and cycle time) and
 * `test/task-2347.08-statistics-boundaries.test.ts` (the stats command
 * delegates identity/completion/window rules to the statistics service and the
 * board metrics accept the contracted `BoardMetricsInput`). Historical task IDs
 * are kept in case names as regression provenance (AC#7).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { summarizeCompletedMissionWindow } from '../../../../src/application/services/statistics-service.js';
import { ConcreteMetricsReadAdapter } from '../../../../src/application/projections/metrics-read-adapter.js';
import type { MetricsReadAdapter } from '../../../../src/application/projections/metrics-read-adapter.js';
import {
  BoardProjectionBuilder,
  type AgentReadAdapter,
  type GateReadAdapter,
  type GitReadAdapter,
  type MissionReadAdapter,
  type OperationLogReadAdapter,
  type ReviewReadAdapter,
} from '../../../../src/application/projections/board-readers.js';
import type { UsageRecord, UsageRepository } from '../../../../src/application/ports/mission-measurements.js';
import type { BoardLaneEventEntry, BoardLaneEventRepository } from '../../../../src/application/ports/operation-history.js';
import type { MissionId, MissionStatus } from '../../../../src/domain/mission.js';
import { agentFamily } from '../../../../src/domain/agents.js';
import { repositoryId, type RepositoryId } from '../../../../src/domain/repository.js';
// `createWindow` and friends hang off the default export object, not the
// module's named exports, so this must be the default import.
import stats from '../../../../src/adapters/cli/commands/stats.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

// task-2347.07 repro uses a distinct repository identity from the task-2347.08
// suite above.
const repository = repositoryId('statistics-repro');

// ---------------------------------------------------------------------------
// task-2347.08-own: CLI and board agree on identity, completions, cycle time
// ---------------------------------------------------------------------------

const REPOSITORY = fixtureRepositoryId('acme/widgets') as RepositoryId;
const WINDOW = stats.createWindow('2026-08-03', 1);

class MemoryUsageRepository implements UsageRepository {
  constructor(private readonly records: readonly UsageRecord[]) {}
  async findAll(): Promise<readonly UsageRecord[]> { return this.records; }
  async findWhere(predicate: (_record: UsageRecord) => boolean): Promise<readonly UsageRecord[]> { return this.records.filter(predicate); }
  async save(): Promise<void> {}
  async saveAll(): Promise<void> {}
  async clear(): Promise<void> {}
}

class DoneLaneEventRepository implements BoardLaneEventRepository {
  async append(): Promise<boolean> { return true; }
  async findByMissionId(): Promise<readonly BoardLaneEventEntry[]> { return []; }
  async findAll(): Promise<readonly BoardLaneEventEntry[]> { return []; }
  async findByRepositoryId(repositoryId: string): Promise<readonly BoardLaneEventEntry[]> {
    return [{ repositoryId, missionId: fixtureMissionId('task-2347.08') as MissionId, fromStatus: 'integration', toStatus: 'done', trigger: 'integrate', agent: 'codex', occurredAt: '2026-08-03T00:00:00Z', idempotencyKey: 'task-2347.08-done' }];
  }
  async clear(): Promise<void> {}
}

const ROWS: readonly UsageRecord[] = [
  { repo: REPOSITORY, mission: 'Task-2347.08', date: '2026-08-03', classification: 'ai_sdlc', duration_minutes: 30, pr_fix_rounds: 1 },
  { repo: REPOSITORY, mission: 'task-2347.08', date: '2026-08-03', classification: 'ai_sdlc', duration_minutes: 30, pr_fix_rounds: 1 },
];

test('task-2347.08 repro: CLI and board agree on identity, completions, and cycle time', async () => {
  const cli = summarizeCompletedMissionWindow(ROWS, WINDOW, new Set([`${REPOSITORY}::task-2347.08`]));
  const board = new ConcreteMetricsReadAdapter({
    laneEventRepo: new DoneLaneEventRepository(),
    usageRepo: new MemoryUsageRepository(ROWS),
    repositoryId: REPOSITORY,
    // Both sides report the same decision window. The CLI window above ends on
    // 2026-08-03, so the board's rolling window is evaluated on that day too;
    // otherwise the comparison is between two different weeks.
    clock: () => '2026-08-03T12:00:00.000Z',
  });
  const outcomes = await board.readOutcomes();
  const metrics = await board.buildMetrics(new Map<MissionId, MissionStatus>());

  assert.equal(cli.missions.length, outcomes.length, 'mission count must agree');
  assert.deepEqual([...new Set(outcomes.map((outcome) => outcome.missionId.toLowerCase()))], ['task-2347.08']);
  assert.equal(metrics.medianStateTimes.series.at(-1)?.value, 0, 'cycle-time figure must agree for the same completed mission');
});

// ---------------------------------------------------------------------------
// task-2347.08-statistics-boundaries: source-inspection provenance checks
// ---------------------------------------------------------------------------

test('task-2347.08: CLI delegates identity, completion, and window rules to statistics service', () => {
  // The stats command's report rendering lives in stats-report-rendering.ts
  // (task-2369.02); the delegation rule covers both halves of the command.
  const source = [
    'src/adapters/cli/commands/stats.ts',
    'src/adapters/cli/commands/stats-report-rendering.ts',
    'src/application/services/statistics-row.ts',
  ].map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  assert.match(source, /statisticsMissionKey\(row\)/);
  assert.match(source, /statisticsRowInWindow\(row, window\)/);
  assert.doesNotMatch(source, /return `\$\{String\(row\.repo/);
});

test('task-2347.08: board metrics accept named input without positional overload casts', () => {
  const source = fs.readFileSync(path.join(root, 'src/application/projections/board.ts'), 'utf8');
  assert.match(source, /export interface BoardMetricsInput/);
  assert.match(source, /buildBoardMetrics\(input: BoardMetricsInput\)/);
  assert.doesNotMatch(source, /as MetricSeries|as LaneMetricSeries|\.\.\.extensions/);
});

test('task-2347.08: cumulative flow evaluates ordered transitions once', () => {
  const source = fs.readFileSync(path.join(root, 'src/application/projections/metrics-flow.ts'), 'utf8');
  const body = source.slice(source.indexOf('export function cumulativeFlowSeries'), source.indexOf('export function cumulativeFlowByStateSeries'));
  assert.match(body, /let index = 0/);
  assert.match(body, /while \(index < ordered\.length/);
  assert.doesNotMatch(body, /instants\.map\([\s\S]*for \(const transition of ordered\)/);
});

// ---------------------------------------------------------------------------
// task-2347.07-statistics-provenance: projection provenance under adapter
// failure and empty history. Relocated from the excepted test/integration/stats/stats.test.ts
// (AC#2: unit-tier provenance, not the integration-ci stats suite).
// ---------------------------------------------------------------------------

test('metrics-read adapter failure projects explicit unavailable statistics instead of default zero values (task-2347.07 repro)', async () => {
  const failingMetricsAdapter: MetricsReadAdapter = {
    async buildMetrics() {
      throw new Error('telemetry database unavailable');
    },
  };

  const projection = await new BoardProjectionBuilder(
    missionAdapter(), reviewAdapter(), gateAdapter(), agentAdapter(), gitAdapter(), operationLogAdapter(),
    { metricsAdapter: failingMetricsAdapter },
  ).build();

  assert.equal(projection.metrics.health.state, 'unavailable');
  assert.equal(projection.metrics.provenance.repositoryId, repository);
  assert.equal(projection.metrics.provenance.adapterSucceeded, false);
  assert.equal(projection.metrics.medianStateTimes.series.length, 0);
  assert.equal(projection.metrics.throughput.series.length, 0);
});

test('metrics projection reports controlled provenance and distinguishes no-completions from no-telemetry (task-2347.07 repro)', async () => {
  const noCompletions = new ConcreteMetricsReadAdapter({
    repositoryId: repository,
    laneEventRepo: laneRepo([laneEntry()]),
    usageRepo: usageRepo([]),
  });
  const noTelemetry = new ConcreteMetricsReadAdapter({
    repositoryId: repository,
    laneEventRepo: laneRepo([]),
    usageRepo: usageRepo([]),
  });

  const noCompletionMetrics = await noCompletions.buildMetrics(new Map([[fixtureMissionId("task-open") as MissionId, 'active' as MissionStatus]]));
  const noTelemetryMetrics = await noTelemetry.buildMetrics(new Map());

  assert.deepEqual(noCompletionMetrics.provenance, {
    repositoryId: repository,
    evaluatedWindow: { startedAt: '2026-08-01T10:00:00Z', endedAt: '2026-08-01T10:00:00Z' },
    sampleSize: 0,
    newestEventTimestamp: '2026-08-01T10:00:00Z',
    rejectedOrMissingIdentityRowCount: 0,
    adapterSucceeded: true,
  });
  assert.equal(noCompletionMetrics.health.state, 'no-completions');
  assert.equal(noTelemetryMetrics.health.state, 'no-telemetry');

  const preLifecycleMetrics = await noTelemetry.buildMetrics(new Map([
    [fixtureMissionId('task-completed') as MissionId, 'done' as MissionStatus],
  ]));
  assert.equal(preLifecycleMetrics.health.state, 'pre-lifecycle');

  const partialMetrics = await new ConcreteMetricsReadAdapter({
    repositoryId: repository,
    laneEventRepo: laneRepo([{ ...laneEntry(), missionId: '' }]),
    usageRepo: usageRepo([]),
  }).buildMetrics(new Map());
  assert.equal(partialMetrics.health.state, 'partial');
  assert.equal(partialMetrics.provenance.rejectedOrMissingIdentityRowCount, 1);
});

function laneEntry(): BoardLaneEventEntry {
  return {
    repositoryId: repository, missionId: 'task-open', fromStatus: 'backlog', toStatus: 'active', trigger: 'activate', agent: 'codex',
    occurredAt: '2026-08-01T10:00:00Z', idempotencyKey: 'task-open-activate',
  };
}

function laneRepo(entries: readonly BoardLaneEventEntry[]): BoardLaneEventRepository {
  return {
    async append() { return true; }, async findByMissionId() { return entries; }, async findAll() { return entries; },
    async findByRepositoryId() { return entries; }, async clear() {},
  };
}

function usageRepo(records: readonly UsageRecord[]): UsageRepository {
  return {
    async findAll() { return records; }, async findWhere() { return records; },
  };
}

function missionAdapter(): MissionReadAdapter {
  return {
    async loadAllMissions() { return []; },
    async loadMission() { return null; },
    getSourceFacts() { return []; },
  };
}

function reviewAdapter(): ReviewReadAdapter {
  return { async loadReviews(ids) { return new Map(ids.map((id) => [id, { review: null, approval: null }])); } };
}

function gateAdapter(): GateReadAdapter {
  return { async loadGateStatus() { return 'unknown' as const; } };
}

function agentAdapter(): AgentReadAdapter {
  return {
    async loadAgentAvailability() { return [{ family: agentFamily('codex'), launcherAvailable: true, block: { kind: 'none' as const } }]; },
    async loadAssignedAgent() { return null; },
  };
}

function gitAdapter(): GitReadAdapter {
  return { async loadRepositoryId() { return repository; }, async loadHeadCommit() { return 'test-head'; } };
}

function operationLogAdapter(): OperationLogReadAdapter {
  return { async loadOperationLog() { return []; } };
}

test('stats CLI renders the application-selected population without selecting completion again (TASK-2637.04)', async () => {
  const { StatsCommandUseCase } = await import('../../../../src/application/stats-command-use-case.js');
  const { createStatsCommand } = await import('../../../../src/interfaces/cli/stats.js');
  const { selectStatsReport } = await import('../../../../src/application/services/statistics-report-selection.js');
  const rows = [
    { repo: 'r', mission: 'task-done', date: '2026-06-01', implementer: 'codex', stage: 'default', classification: 'user_value', pr_fix_rounds: '2' },
    { repo: 'r', mission: 'task-active', date: '2026-06-23', implementer: 'claude', stage: 'active', classification: 'ai_sdlc', pr_fix_rounds: '9' },
  ];
  const flow = [
    { repo: 'r', mission: 'task-done', closedAt: '2026-06-23T12:00:00Z', labels: ['user_value'], implementer: 'codex' },
    { repo: 'r', mission: 'task-no-telemetry', closedAt: '2026-06-23T13:00:00Z', labels: ['ai_sdlc'], implementer: 'custom' },
  ];
  for (const mode of ['weekly', 'range'] as const) {
    const request = { mode, today: '2026-06-23', from: '2026-06-23', to: '2026-06-23' };
    const selection = selectStatsReport(rows, flow, request);
    const reportRows = [...selection.current.completedMissions];
    assert.deepEqual(reportRows.map(row => row.mission), ['task-done'], 'closure date selects old telemetry for completed performance');
    assert.deepEqual(selection.current.windowedRows.map(row => row.mission), ['task-active'], 'spend still uses measurement dates');
    const lines: string[] = [];
    const command = createStatsCommand({
      // Deliberately supply no raw lifecycle population: the contracted
      // selection is sufficient, so accidentally recomputing from raw data fails.
      execute: async () => ({ mode, rows, missionFlow: [], selection }),
    }, {
      renderWeekly: (data, options) => stats.renderWeeklyStatsReport(data, options),
      renderRange: (data, options) => stats.renderRangeStatsReport(data, options),
      renderMission: () => { throw new Error('unexpected mission route'); },
      writeReport: () => { throw new Error('unexpected file write'); },
      cohorts: async () => { throw new Error('unexpected cohort route'); },
    });
    await command(mode === 'weekly' ? ['--today', '2026-06-23'] : ['--from', '2026-06-23', '--to', '2026-06-23'], {
      log: message => { lines.push(message); }, error: message => { throw new Error(message); },
      exit: () => { throw new Error('unexpected exit'); },
    });
    const report = lines.join('\n').replace(/\u001b\[[0-9;]*m/g, '');
    assert.match(report, /codex\s+1\s+2\.00/);
    const performance = report.split(mode === 'weekly' ? 'Agent performance this week' : 'Agent performance')[1]!.split('Agent spend')[0]!;
    assert.doesNotMatch(performance, /claude|custom/, 'active and telemetry-free missions receive no fabricated performance credit');
    assert.equal(selection.current.flow?.total, 2, 'flow counts lifecycle completions without telemetry');
    assert.match(report.split('Agent performance')[0]!, /2\s+1\s+1\s+0/);
    // Also exercise the real use case rather than just the presentation seam.
    const result = await new StatsCommandUseCase({
      loadMeasurements: async () => rows, loadMissionFlow: async () => flow,
    }).execute(request);
    assert.deepEqual(result.selection, selection);
  }
});

test('px stats fallback-reasons table renders each distinguishable classifier failure cause (TASK-2704)', async () => {
  const { renderClassifierStatistics } = await import('../../../../src/application/presentation/classifier-statistics.js');
  const { weeklyDecisionWindows } = await import('../../../../src/application/services/decision-window.js');
  const { classificationAttempt } = await import('../../../fixtures/repeat-review.js');
  const windows = weeklyDecisionWindows('2026-10-06', 'UTC');
  const row = (round: number, reason: string, unreached = false) => classificationAttempt({ round, decisionId: `d${round}`, fingerprint: `f${round}`,
    observedAt: '2026-10-05T00:00:00Z', route: 'reviewer', reason, classificationMs: null,
    ...(unreached ? { provider: null, model: null, packetHash: null } : {}) });
  const attempts = [row(2, 'evidence-over-budget'), row(3, 'evidence-read-failed'), row(4, 'classifier-exception'),
    row(5, 'provider-key-missing', true), row(6, 'provider-unavailable', true), row(7, 'consecutive-classifier-returns', true)];
  const report = renderClassifierStatistics({ decisions: [], attempts, coverage: 'complete' }, [windows.current, windows.previous]);
  for (const reason of ['evidence-over-budget', 'evidence-read-failed', 'classifier-exception', 'provider-key-missing', 'provider-unavailable', 'consecutive-classifier-returns']) {
    assert.match(report, new RegExp(`\\| ${reason}\\s+\\|\\s+1 \\(partial\\) \\|`), reason);
  }
});

test('classifier clear statistics separate omissions and historical unknowns (TASK-2751)', async () => {
  const { reviewRounds } = await import('../../../../src/application/review-classification/statistics.js');
  const { renderClassifierStatistics } = await import('../../../../src/application/presentation/classifier-statistics.js');
  const { classificationAttempt } = await import('../../../fixtures/repeat-review.js');
  const windows = weeklyDecisionWindows('2026-10-06', 'UTC');
  const attempts = [0, 2, undefined].map((omittedDiffCount, index) => classificationAttempt({ round: index + 2,
    decisionId: `omission-${index}`, observedAt: '2026-10-05T00:00:00Z', route: 'clear', omittedDiffCount, omittedTokens: omittedDiffCount ? 500 : 0 }));
  attempts.push(classificationAttempt({ round: 5, decisionId: 'context-only', observedAt: '2026-10-05T00:00:00Z', route: 'clear', omittedDiffCount: 0, omittedTokens: 500 }));
  const input = { decisions: [], attempts, coverage: 'complete' as const };
  const result = reviewRounds(input, windows.current);
  assert.equal(result.clearsWithOmissions, 2);
  assert.equal(result.clearsWithoutOmissions, 1);
  assert.equal(result.clearsOmissionsUnknown, 1);
  const rendered = renderClassifierStatistics(input, [windows.current, windows.previous]);
  assert.match(rendered, /With omissions\s+\|\s+2/);
  assert.match(rendered, /Without omissions\s+\|\s+1/);
  assert.match(rendered, /Historical unknown\s+\|\s+1/);
});

test('decided rounds ignore missing and undecided samples and use decision weeks (TASK-2758)', async () => {
  const { reviewRounds } = await import('../../../../src/application/review-classification/statistics.js');
  const { classificationAttempt } = await import('../../../fixtures/repeat-review.js');
  const windows = weeklyDecisionWindows('2026-10-09', 'UTC');
  for (const round of [1, 2]) {
    const kind = round === 1 ? 'first review' : 're-review';
    const decisions = [
      { id: 'no-sample', round, decidedAt: '2026-10-08T12:00:00Z', source: 'reviewer' as const, outcome: 'clear' as const },
      { id: 'cross-week', round, decidedAt: '2026-10-08T13:00:00Z', source: 'classifier' as const, outcome: 'clear' as const },
      { id: 'before-telemetry', round, decidedAt: '2026-10-01T12:00:00Z', source: 'classifier' as const, outcome: 'implementer' as const },
    ];
    const attempts = [classificationAttempt({ round, decisionId: 'cross-week', observedAt: '2026-10-01T13:00:00Z' }),
      classificationAttempt({ round, mission: 'undecided', decisionId: 'undecided', observedAt: '2026-10-08T13:00:00Z' })];
    const input = { decisions, attempts, coverage: 'partial' as const };
    const current = reviewRounds(input, windows.current, kind);
    assert.equal(current.rounds, 2, 'decided round without a sample is counted; undecided sample is excluded');
    assert.equal(current.jevDecisions, 1, 'attribution uses the stored decider in its decision week');
    assert.equal(reviewRounds(input, windows.previous, kind).rounds, 1);
    assert.equal(reviewRounds({ ...input, attempts: [] }, windows.previous, kind).jevDecisions, 1, 'pre-telemetry share remains available');
  }
});

test('deciders are exclusive and partial telemetry leaves decided share available (TASK-2758)', async () => {
  const { reviewRounds } = await import('../../../../src/application/review-classification/statistics.js');
  const { renderClassifierStatistics } = await import('../../../../src/application/presentation/classifier-statistics.js');
  const { classificationAttempt } = await import('../../../fixtures/repeat-review.js');
  const windows = weeklyDecisionWindows('2026-10-09', 'UTC');
  const at = '2026-10-08T12:00:00Z';
  const decisions = (['classifier', 'mechanical', 'reviewer'] as const).map(source => ({
    id: source, round: 2, source, decidedAt: at, outcome: 'clear' as const,
  }));
  const sample = classificationAttempt({ observedAt: at, route: 'clear', decisionId: 'classifier' });
  const input = { decisions: [...decisions, decisions[0]], attempts: [sample, sample], coverage: 'complete' as const };
  const result = reviewRounds(input, windows.current, 're-review');
  assert.deepEqual([result.rounds, result.jevDecisions, result.mechanical, result.reviewer, result.called], [3, 1, 1, 1, 1]);
  assert.equal(result.coverage, 'partial');
  const report = renderClassifierStatistics(input, [windows.current, windows.previous]);
  const current = report.split('\n').find(line => line.startsWith('| This week'))!;
  assert.match(current, /\|\s+3 \|\s+1 \|\s+1 \|\s+1 \|\s+33% \|/);
  assert.match(current, /1 \(partial\)/);
  assert.match(report, /Sample coverage starts: 2026-10-08T12:00:00Z/);
  assert.match(report.split('\n').find(line => line.startsWith('| Last week'))!, /\|\s+0 \|\s+0 \|\s+0 \|\s+0 \|\s+n\/a \|/);
  assert.doesNotMatch(report, /Observed wrong|unobserved|Integration.repair|V5|preserves probability/);
  const complete = { decisions: [decisions[0]], attempts: [sample,
    classificationAttempt({ observedAt: '2026-09-01T00:00:00Z', mission: 'early', round: 1 })], coverage: 'complete' as const };
  assert.equal(reviewRounds(complete, windows.current).coverage, 'complete');
});
