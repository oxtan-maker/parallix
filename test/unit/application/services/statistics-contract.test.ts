import { reviewStatisticsObservation } from '../../../fixtures/review-statistics.js';
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
import { matchesUsageFilter } from '../../../fixtures/metrics-adapter.js';
import type { UsageFilter, UsageRecord, UsageRepository } from '../../../../src/application/ports/mission-measurements.js';
import type { BoardLaneEventEntry, BoardLaneEventRepository } from '../../../../src/application/ports/operation-history.js';
import type { MissionId, MissionStatus } from '../../../../src/domain/mission.js';
import { agentFamily } from '../../../../src/domain/agents.js';
import { repositoryId, type RepositoryId } from '../../../../src/domain/repository.js';
// `createWindow` and friends hang off the default export object, not the
// module's named exports, so this must be the default import.
import stats from '../../../../src/adapters/cli/commands/stats.js';
import { reviewStatistics, type ReviewStatistics } from '../../../../src/application/services/review-statistics.js';
import { verificationStatistics } from '../../../../src/application/projections/verification-statistics.js';
import { flowElapsedOwnership } from '../../../../src/application/projections/flow-elapsed-ownership.js';
import { flowStatistics, type FlowMissionFacts } from '../../../../src/application/projections/flow-statistics.js';
import { VERIFICATION_MEASUREMENT_EVENT, type VerificationMeasurement } from '../../../../src/application/ports/verification-observation.js';
import { renderVerificationStatistics } from '../../../../src/application/presentation/verification-statistics.js';
import { controlledVerificationComparisons } from '../../../../src/application/projections/verification-profile-comparison.js';
import type { RunRecord } from '../../../../src/application/run-history-types.js';
import type { WorkflowOperation } from '../../../../src/domain/workflow-operation.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
function workflowOperation(overrides: Partial<WorkflowOperation> = {}): WorkflowOperation {
  return { id: 'op', repositoryId: repositoryId('repo'), missionId: fixtureMissionId('px-1'), requestKey: 'request',
    command: 'active:execute', generation: 1, phase: 'completed', providerStarted: true,
    agent: agentFamily('codex'), reviewer: agentFamily('codex'), originalStatus: 'active',
    previousAssignee: agentFamily('codex'), owner: null, createdAt: instant(0), updatedAt: instant(40), reason: null,
    ...overrides };
}
test('shared FLOW projection keeps completion windows, actor rates and typed time populations (TASK-2835)', () => {
  const windows = weeklyDecisionWindows('2026-11-03', 'UTC');
  const fact = (mission: string, closedAt: string, launches: number, human = false): FlowMissionFacts => {
    const observed = reviewStatisticsObservation('codex', human ? 1 : 0);
    const reviewStatistics = human ? { ...observed,
      returns: observed.returns.map(item => ({ ...item, at: '2026-11-02T10:00:00Z' })),
      sendBacks: { agent: { numerator: 0, eligibleEpisodes: 1, coverage: 1,
        rate: { state: 'measured' as const, value: 0 } }, human: { numerator: 1, eligibleEpisodes: 1, coverage: 1,
        rate: { state: 'measured' as const, value: 1 } } } } : observed;
    return { repositoryId: 'repo', missionId: mission, closedAt, implementer: 'codex',
      diagramNodeIds: [`${mission}:implement`, `${mission}:review`], diagramEdgeIds: [`${mission}:implement->review`],
      window: { startedAt: new Date(Date.parse(closedAt) - 30).toISOString(), finishedAt: closedAt },
      gateRuns: [{ id: `${mission}:declared`, phase: 'handoff', result: human ? 'failed' : 'passed' },
        { id: `${mission}:integration`, phase: 'integration', result: 'passed' }],
      rebaseRuns: [{ id: `${mission}:pre`, operationId: `${mission}:pre-operation`, stage: 'pre-review-rebase', outcomes: human ? ['conflict', 'resolved'] : ['clean'] },
        { id: `${mission}:integration`, operationId: `${mission}:integration-operation`, stage: 'integration-rebase', outcomes: ['clean'] }],
      rebaseStages: [], diagnostics: [], lead: { queued: human ? 1 : 0, recoveries: human ? 1 : 0, escalations: 0 },
      laneDwellMs: { active: human ? 30 : 10 },
      actualAgentLaunches: launches, observedDisqualifiers: human ? ['human-return'] : [], reviewStatistics,
      agentLaunches: [{ runId: `${mission}:run`, startedAt: '2026-11-01T00:00:00Z', family: 'codex', model: 'gpt-6.1-sol' }],
      ownership: [{ step: 'implement', actor: 'codex', model: 'gpt-6.1-sol', state: 'working', durationMs: 10 },
        { step: 'human-review', actor: 'human', model: null, state: 'held', durationMs: 20 }] };
  };
  const result = flowStatistics([
    fact('task-current-a', '2026-11-03T12:00:00Z', 1),
    fact('task-current-b', '2026-11-02T12:00:00Z', 3, true),
    fact('task-previous', '2026-10-25T12:00:00Z', 2),
  ], windows);
  assert.deepEqual(result.current.diagram, { nodeCount: 4, edgeCount: 2 });
  assert.deepEqual(result.current.firstPassYield, { numerator: 1, denominator: 2, observed: 2, population: 2, coverage: 1,
    state: 'measured', value: 0.5 });
  assert.deepEqual(result.current.extraAgentLaunches, { total: 2, meanPerMission: 1, n: 2,
    lowerBound: false, reworkJobs: 1, reworkMeanPerMission: 0.5, reworkN: 2 });
  assert.deepEqual(result.current.sendBacks.human, { numerator: 1, denominator: 1, observed: 2, population: 2, coverage: 1,
    state: 'measured', value: 1 });
  assert.equal(result.current.returns[0]?.responsibleModel, 'gpt-6.1-sol');
  assert.deepEqual(result.current.time.rows.map(row => [row.step, row.state, row.totalMs, row.meanMs, row.p90Ms, row.n]), [
    ['human-review', 'held', 40, 20, 20, 2], ['implement', 'working', 20, 10, 10, 2],
  ]);
  assert.equal(result.current.time.rows.find(row => row.step === 'implement')?.model, 'gpt-6.1-sol');
  assert.deepEqual(result.current.time.largestHolder, { step: 'human-review', actor: 'human', model: null, state: 'held',
    totalMs: 40, share: 2 / 3 });
  assert.equal(result.current.graph.nodes.find(node => node.id === 'pre-review-rebase')?.count, 2);
  assert.equal(result.current.graph.edges.find(edge => edge.kind === 'rebase-conflict')?.count, 1);
  assert.deepEqual(result.current.stateDwell.find(row => row.state === 'active'), { state: 'active', medianMs: 20, p90Ms: 30, n: 2 });
  assert.deepEqual(result.families.map(cohort => [cohort.family, cohort.current.completedMissions]), [['codex', 2]]);
  assert.equal(result.previous.completedMissions, 1);
  assert.equal(result.current.defects.length, 0);
});
test('gate shares keep one run population while return arrows reconcile to rework (TASK-2836 F10)', () => {
  const windows = weeklyDecisionWindows('2026-11-03', 'UTC');
  const fact = (mission: string, observed: boolean): FlowMissionFacts => ({ repositoryId: 'repo', missionId: mission,
    closedAt: '2026-11-03T12:00:00Z', implementer: 'codex', laneDwellMs: null, diagramNodeIds: [], diagramEdgeIds: [], ownership: [], window: null,
    gateRuns: observed ? [{ id: 'passed', phase: 'handoff', result: 'passed' }, { id: 'failed', phase: 'handoff', result: 'failed' }] : [],
    rebaseRuns: [], rebaseStages: [], diagnostics: [], lead: { queued: 0, recoveries: 0, escalations: 0 }, actualAgentLaunches: null, agentLaunches: [], observedDisqualifiers: null,
    reviewStatistics: reviewStatistics(null, { equivalentSubmissions: {}, workflowReturns: [1, ...(observed ? [2] : [])].map(sequence => ({
      identity: `repair:${mission}:${sequence}`, author: 'codex', at: '2026-11-03T11:00:00Z', source: 'repair' })) }) });
  const graph = flowStatistics([fact('observed', true), fact('unobserved', false)], windows).current.graph, pass = graph.edges.find(edge => edge.id === 'declared-gates->agent-review:flow')!,
    failed = graph.edges.find(edge => edge.id === 'declared-gates->implement:gate-failed')!;
  assert.deepEqual([pass.share, failed.share, pass.share! + failed.share!], [0.5, 0.5, 1]);
  assert.deepEqual([pass.percentage, failed.percentage, failed.count], [50, 50, 3], 'gate percentages use settled runs; the arrow retains every typed return');
  assert.deepEqual([graph.nodes.find(node => node.id === 'implement')?.rework, graph.edges.find(edge => edge.id === 'unrecorded->implement:workflow-return')?.count], [3, 0]);
  assert.equal(graph.edges.filter(edge => edge.to === 'implement' && edge.kind !== 'flow').reduce((sum, edge) => sum + edge.count, 0), graph.nodes.find(node => node.id === 'implement')?.rework, 'every typed return is drawn exactly once into implementation');
  const unobserved = flowStatistics([fact('unobserved-only', false)], windows).current.graph,
    unobservedGateReturn = unobserved.edges.find(edge => edge.id === 'declared-gates->implement:gate-failed')!;
  assert.deepEqual([unobservedGateReturn.count, unobservedGateReturn.share, unobserved.edges.find(edge => edge.id === 'unrecorded->implement:workflow-return')?.count], [1, null, 0], 'typed returns remain visible without a settled-run denominator');
  const unevenRuns = [...Array.from({ length: 91 }, (_, id) => ({ id: `pass-${id}`, phase: 'handoff', result: 'passed' as const })),
    ...Array.from({ length: 4 }, (_, id) => ({ id: `fail-${id}`, phase: 'handoff', result: 'failed' as const })),
    { id: 'running', phase: 'handoff', result: 'running' as const }];
  const uneven = flowStatistics([{ ...fact('uneven', true), gateRuns: unevenRuns }], windows).current.graph.edges
    .filter(edge => edge.from === 'declared-gates');
  assert.deepEqual(uneven.map(edge => [edge.share, edge.percentage]), [[91 / 95, 96], [4 / 95, 4]], 'only terminal siblings divide the displayed 100%');
  const resolving = flowStatistics([{ ...fact('resolve', false), rebaseRuns:
    [{ id: 'repeat', operationId: 'repeat-operation', stage: 'pre-review-rebase', outcomes: ['conflict', 'conflict', 'resolved'] },
      { id: 'failed', operationId: 'failed-operation', stage: 'pre-review-rebase', outcomes: ['conflict', 'failed'] }] }], windows).current.graph.edges.filter(edge => edge.from === 'pre-review-resolve');
  assert.deepEqual(resolving.map(edge => [edge.count, edge.percentage]), [[1, 34], [1, 33], [1, 33]], 'Resolve siblings divide one displayed 100%');
});
test('live Review observations survive absent telemetry and ignore archived scalar counts (TASK-2818)', async () => {
  const { StatsCommandUseCase } = await import('../../../../src/application/stats-command-use-case.js');
  const rows = [{ repo: 'r', mission: 'task-stale', stage: 'default', date: '2026-06-23', implementer: 'codex', model: 'gpt-6.1-sol',
    classification: 'ai_sdlc'}, { repo: 'r', mission: 'task-no-telemetry', stage: 'active', date: '2026-06-23', implementer: 'custom', model: 'qwen3.8-flash-next-iq3_s',
    classification: 'ai_sdlc'}];
  const known = reviewStatisticsObservation('custom', 2);
  const result = await new StatsCommandUseCase({ loadMeasurements: async () => rows, loadMissionFlow: async () => [
    { repo: 'r', mission: 'task-stale', closedAt: '2026-06-23T12:00:00Z', labels: ['ai_sdlc'], implementer: 'codex', reviewStatistics: reviewStatistics(null) },
    { repo: 'r', mission: 'task-no-telemetry', closedAt: '2026-06-23T13:00:00Z', labels: ['ai_sdlc'], implementer: 'custom', reviewStatistics: known },
  ] }).execute({ mode: 'range', from: '2026-06-23', to: '2026-06-23' });
  const report = stats.renderRangeStatsReport(result.rows, { selection: result.selection });
  assert.match(report, /gpt-6\.1-sol\s+1\s+unavailable/);
  assert.match(report, /qwen3\.8-flash-next-iq3_s\s+1\s+2\b/);
  assert.doesNotMatch(report, /coverage/);
});
const instant = (ms: number) => new Date(Date.UTC(2026, 10, 2) + ms).toISOString();
function attempt(id: string, start: number, end: number, extra: Partial<VerificationMeasurement> = {}): VerificationMeasurement {
  return { id, repositoryId: 'repo', missionId: 'px-1', operationId: 'op', operationGeneration: 1,
    sourceId: 'op:1', revision: 'rev', batchId: 'batch',
    gate: id, command: 'check', phase: 'integration', after: [], plan: ['a', 'b', 'c'],
    requestedAt: instant(0), startedAt: instant(start), finishedAt: instant(end), result: 'passed',
    failureReason: null, exitCode: 0, wallMs: end - start,
    cpu: { userUs: 1000, systemUs: 0, boundary: id, parent: null, provenance: 'bash-time-waited-tree' },
    profile: null, ...extra };
}
function verificationReport(attempts: readonly VerificationMeasurement[], lifecycle: readonly BoardLaneEventEntry[] = []) {
  return verificationStatistics({ repositoryId: 'repo', operations: [], lifecycle,
    history: attempts.map(a => ({ eventType: VERIFICATION_MEASUREMENT_EVENT, eventData: JSON.stringify(a), createdAt: a.finishedAt ?? a.requestedAt })) });
}
test('fully observed repair chain reports a measured cross-batch dependency path (TASK-2835)', () => {
  const first = attempt('failed-gate', 0, 10, { batchId: 'pre-review-1', plan: ['check'], gate: 'check',
    result: 'failed', exitCode: 1, failureReason: { version: 1, code: 'gate-failed' },
    ...({ dependencies: [] } as object) });
  const second = attempt('successful-gate', 25, 35, { batchId: 'pre-review-2', plan: ['check'], gate: 'check',
    revision: 'fixed', ...({ dependencies: ['review-1'] } as object) });
  const history = [first, second].map(value => ({ eventType: VERIFICATION_MEASUREMENT_EVENT,
    eventData: JSON.stringify(value), createdAt: value.finishedAt ?? value.requestedAt }));
  history.push(...[
    { id: 'repair-1', dependencies: ['failed-gate'], phase: 'repair', state: 'running', at: 10 },
    { id: 'repair-1', dependencies: ['failed-gate'], phase: 'repair', state: 'ended', at: 20 },
    { id: 'review-1', dependencies: ['repair-1'], phase: 're-review', state: 'running', at: 20 },
    { id: 'review-1', dependencies: ['repair-1'], phase: 're-review', state: 'ended', at: 25 },
  ].map(value => ({ eventType: 'mission.current-work', createdAt: instant(value.at), eventData: JSON.stringify({
    repositoryId: 'repo', missionId: 'px-1', operationId: 'op', sourceId: value.id,
    operationGeneration: 1, revision: 'rev', dependencies: value.dependencies, phase: value.phase, state: value.state,
  }) })));
  const operation = workflowOperation({ updatedAt: instant(35) });

  const report = verificationStatistics({ repositoryId: 'repo', history, operations: [operation], lifecycle: [] });
  const measured = report as typeof report & { dependencyPath?: { durationMs: number; nodeIds: readonly string[] } };
  assert.equal(report.criticalPathMs, 35);
  assert.deepEqual(measured.dependencyPath, {
    durationMs: 35,
    nodeIds: ['failed-gate', 'repair-1', 'review-1', 'successful-gate'],
  });
  assert.equal(report.unknowns.some(value => value.includes('End-to-end critical path unknown')), false);
});
test('exclusive elapsed ownership reconciles overlap from observed ownership rather than row order (TASK-2835)', () => {
  const gate = attempt('gate', 25, 35, { gate: 'check', plan: ['check'], requestedAt: instant(25) });
  const history = [
    { eventType: 'mission.current-work', createdAt: instant(0), eventData: JSON.stringify({ repositoryId: 'repo',
      missionId: 'px-1', operationId: 'op', operationGeneration: 1, sourceId: 'queue', dependencies: [], revision: 'rev',
      phase: 'waiting', state: 'running', actor: 'parallix', model: null, timeState: 'waiting' }) },
    { eventType: 'mission.current-work', createdAt: instant(10), eventData: JSON.stringify({ repositoryId: 'repo',
      missionId: 'px-1', operationId: 'op', operationGeneration: 1, sourceId: 'queue', dependencies: [], revision: 'rev',
      phase: 'waiting', state: 'ended', actor: 'parallix', model: null, timeState: 'waiting' }) },
    { eventType: 'mission.current-work', createdAt: instant(10), eventData: JSON.stringify({ repositoryId: 'repo',
      missionId: 'px-1', operationId: 'op', operationGeneration: 1, sourceId: 'agent', dependencies: [], revision: 'rev',
      phase: 'execute', state: 'running', actor: 'codex', model: 'gpt-6.1-sol', timeState: 'working' }) },
    { eventType: 'mission.current-work', createdAt: instant(30), eventData: JSON.stringify({ repositoryId: 'repo',
      missionId: 'px-1', operationId: 'op', operationGeneration: 1, sourceId: 'agent', dependencies: [], revision: 'rev',
      phase: 'execute', state: 'ended', actor: 'codex', model: 'gpt-6.1-sol', timeState: 'working' }) },
    { eventType: VERIFICATION_MEASUREMENT_EVENT, createdAt: instant(35), eventData: JSON.stringify(gate) },
    { eventType: 'mission.current-work', createdAt: instant(35), eventData: JSON.stringify({ repositoryId: 'repo',
      missionId: 'px-1', operationId: 'human-review', operationGeneration: 1, sourceId: 'human-review', dependencies: ['gate'], revision: 'rev',
      phase: 'review', state: 'blocked', actor: 'human', model: null, timeState: 'held' }) },
    { eventType: 'mission.current-work', createdAt: instant(50), eventData: JSON.stringify({ repositoryId: 'repo',
      missionId: 'px-1', operationId: 'human-review', operationGeneration: 1, sourceId: 'human-review', dependencies: ['gate'], revision: 'rev',
      phase: 'review', state: 'ended', actor: 'human', model: null, timeState: 'held' }) },
  ];
  const report = verificationStatistics({ repositoryId: 'repo', history, operations: [], lifecycle: [
    { id: 1, repositoryId: 'repo', missionId: 'px-1', fromStatus: null, toStatus: 'refined', occurredAt: instant(0), trigger: 'refine', agent: 'human', idempotencyKey: 'refined' },
    { id: 2, repositoryId: 'repo', missionId: 'px-1', fromStatus: 'refined', toStatus: 'active', occurredAt: instant(0), trigger: 'activate', agent: 'codex', idempotencyKey: 'active' },
    { id: 3, repositoryId: 'repo', missionId: 'px-1', fromStatus: 'active', toStatus: 'review', occurredAt: instant(35), trigger: 'review', agent: 'codex', idempotencyKey: 'review' },
    { id: 4, repositoryId: 'repo', missionId: 'px-1', fromStatus: 'integration', toStatus: 'done', occurredAt: instant(50), trigger: 'land', agent: 'codex', idempotencyKey: 'done' },
  ] });
  assert.equal(report.elapsedOwnership?.totalMs, 50);
  assert.equal(report.elapsedOwnership?.unexplainedMs, 0);
  assert.deepEqual(report.elapsedOwnership?.rows, [
    { step: 'workflow-admission', actor: 'parallix', model: null, state: 'waiting', durationMs: 10 },
    { step: 'implement', actor: 'codex', model: 'gpt-6.1-sol', state: 'working', durationMs: 15 },
    { step: 'declared-gates', actor: 'parallix', model: null, state: 'working', durationMs: 10 },
    { step: 'human-review', actor: 'human', model: null, state: 'held', durationMs: 15 },
  ]);
  assert.deepEqual(report.elapsedOwnership?.terminalStates, { blocked: 1, interrupted: 0, cancelled: 0 });
  assert.equal(report.executionMs, 10, 'exclusive elapsed ownership does not replace true gate work');
  assert.equal(history.some(entry => entry.eventType === 'flow.elapsed-segment'), false, 'production facts drive ownership');
});

test('FLOW ownership indexes each historical payload once across Mission windows (TASK-2836)', () => {
  let reads = 0;
  const history = ['px-1', 'px-2'].map((mission, index) => ({
    eventType: 'mission.current-work', createdAt: instant(index * 100),
    get eventData() { reads++; return JSON.stringify({ repositoryId: 'repo', missionId: mission,
      operationId: `op-${mission}`, operationGeneration: 1, sourceId: `source-${mission}`, revision: 'rev',
      phase: 'execute', state: 'running', actor: 'codex', model: null, timeState: 'working' }); },
  }));
  const lifecycle = ['px-1', 'px-2'].flatMap((mission, index) => [
    { repositoryId: 'repo', missionId: mission, fromStatus: 'backlog', toStatus: 'refined', occurredAt: instant(index * 100), trigger: 'refine', agent: 'codex', idempotencyKey: `${mission}:refined` },
    { repositoryId: 'repo', missionId: mission, fromStatus: 'integration', toStatus: 'done', occurredAt: instant(index * 100 + 50), trigger: 'land', agent: 'codex', idempotencyKey: `${mission}:done` },
  ]);

  const result = flowElapsedOwnership({ repositoryId: 'repo', history, lifecycle }, new Set());

  assert.equal(result?.windows.length, 2);
  assert.equal(reads, history.length, 'history payloads are parsed once, not once per Mission and ownership source');
});

test('nested causal ownership replaces only its parent interval and reconciles exactly (TASK-2835)', () => {
  const activity = (sourceId: string, at: number, state: string, actor: string, dependencies: string[]) => ({
    eventType: 'mission.current-work', createdAt: instant(at), eventData: JSON.stringify({ repositoryId: 'repo',
      missionId: 'px-1', operationId: 'op', operationGeneration: 1, sourceId, dependencies, revision: 'rev',
      phase: 'execute', state, actor, model: actor === 'codex' ? 'gpt-6.1-sol' : null, timeState: 'working' }),
  });
  const report = verificationStatistics({ repositoryId: 'repo', operations: [], history: [
    activity('parent', 0, 'running', 'parallix', []),
    activity('child', 10, 'running', 'codex', ['parent']),
    activity('child', 20, 'ended', 'codex', ['parent']),
    activity('parent', 30, 'ended', 'parallix', []),
  ], lifecycle: [
    { repositoryId: 'repo', missionId: 'px-1', fromStatus: 'backlog', toStatus: 'refined', occurredAt: instant(0), trigger: 'refine', agent: 'human', idempotencyKey: 'refined' },
    { repositoryId: 'repo', missionId: 'px-1', fromStatus: 'refined', toStatus: 'active', occurredAt: instant(0), trigger: 'activate', agent: 'codex', idempotencyKey: 'active' },
    { repositoryId: 'repo', missionId: 'px-1', fromStatus: 'integration', toStatus: 'done', occurredAt: instant(30), trigger: 'land', agent: 'codex', idempotencyKey: 'done' },
  ] });
  assert.deepEqual(report.elapsedOwnership?.rows, [
    { step: 'preparation', actor: 'parallix', model: null, state: 'working', durationMs: 10 },
    { step: 'implement', actor: 'codex', model: 'gpt-6.1-sol', state: 'working', durationMs: 10 },
    { step: 'preparation', actor: 'parallix', model: null, state: 'working', durationMs: 10 },
  ]);
  assert.equal(report.elapsedOwnership?.unexplainedMs, 0);
  assert.equal(report.elapsedOwnership?.rows.reduce((sum, row) => sum + row.durationMs, 0), report.endToEndMs);
});

test('fresh run resources preserve units and deduplicate nested waited trees on the exact dependency path (TASK-2835)', () => {
  const activity = (sourceId: string, at: number, state: string, dependencies: string[], phase = 'execute', actor = 'codex', timeState = 'working') => ({
    eventType: 'mission.current-work', createdAt: instant(at), eventData: JSON.stringify({ repositoryId: 'repo',
      missionId: 'px-1', operationId: 'op', operationGeneration: 1, sourceId, dependencies, revision: 'rev',
      phase, state, actor, model: actor === 'codex' ? 'gpt-6.1-sol' : null, timeState }),
  });
  const operation = workflowOperation();
  const run = (runId: string, role: string, start: number, end: number, boundary: string, parent: string | null): RunRecord => ({
    version: 1, runId, repositoryId: 'repo', missionId: 'px-1', captureKind: 'agent', operationId: 'op', operationGeneration: 1,
    sourceId: runId, revision: 'rev', configuredModel: 'gpt-6.1-sol', dependencies: [], execution: null,
    role, family: agentFamily('codex'), attempt: 1, terminalHost: 'pipe', hostFallbackReason: null, tmux: null, supervisorPid: 1,
    state: 'exited', startedAt: instant(start), endedAt: instant(end), exitCode: 0, signal: null, providerSessionId: null,
    redacted: false, streams: { stdout: { bytes: 0, retainedBytes: 0, omitted: [] }, stderr: { bytes: 0, retainedBytes: 0, omitted: [] } },
    sources: [], omissions: [], resources: { localProcessTreeCpu: { userUs: boundary === 'outer' ? 100 : 50,
      systemUs: boundary === 'outer' ? 20 : 10, provenance: 'bash-time-waited-tree', boundary, parent },
      provider: { provenance: 'provider-reported', provider: 'openai', model: 'gpt-6.1-sol',
        values: [{ name: 'input', value: boundary === 'outer' ? 40 : 10, unit: 'tokens' }] } },
  });
  const failed = attempt('failed-gate', 10, 15, { batchId: 'pre-review-1', gate: 'check', plan: ['check'], result: 'failed',
    requestedAt: instant(10), exitCode: 1, failureReason: { version: 1, code: 'gate-failed' }, dependencies: ['implement'] });
  const passed = attempt('passed-gate', 25, 30, { batchId: 'pre-review-2', gate: 'check', plan: ['check'],
    requestedAt: instant(25), revision: 'fixed', dependencies: ['review'] });
  const report = verificationStatistics({ repositoryId: 'repo', operations: [operation], history: [
    activity('queue', 0, 'running', [], 'waiting', 'parallix', 'waiting'), activity('queue', 5, 'ended', [], 'waiting', 'parallix', 'waiting'),
    activity('implement', 5, 'running', []), activity('repair', 15, 'running', ['implement'], 'review-response'),
    activity('repair', 20, 'ended', ['implement'], 'review-response'), activity('review', 20, 'running', ['repair'], 'review'),
    activity('review', 25, 'ended', ['repair'], 'review'), activity('implement', 30, 'ended', []),
    activity('human', 30, 'blocked', ['passed-gate'], 'review', 'human', 'held'),
    activity('human', 40, 'ended', ['passed-gate'], 'review', 'human', 'held'),
    ...[failed, passed].map(value => ({ eventType: VERIFICATION_MEASUREMENT_EVENT,
      eventData: JSON.stringify(value), createdAt: value.finishedAt! })),
  ], lifecycle: [
    { repositoryId: 'repo', missionId: 'px-1', fromStatus: 'backlog', toStatus: 'refined', occurredAt: instant(0), trigger: 'refine', agent: 'human', idempotencyKey: 'refined' },
    { repositoryId: 'repo', missionId: 'px-1', fromStatus: 'refined', toStatus: 'active', occurredAt: instant(0), trigger: 'activate', agent: 'codex', idempotencyKey: 'active' },
    { repositoryId: 'repo', missionId: 'px-1', fromStatus: 'active', toStatus: 'review', occurredAt: instant(30), trigger: 'review', agent: 'codex', idempotencyKey: 'review' },
    { repositoryId: 'repo', missionId: 'px-1', fromStatus: 'integration', toStatus: 'done', occurredAt: instant(40), trigger: 'land', agent: 'codex', idempotencyKey: 'done' },
  ], runs: [run('agent-codex-execute-1-a', 'execute', 5, 30, 'outer', null),
    run('agent-codex-repair-1-b', 'review-response', 15, 20, 'repair', 'outer'),
    run('agent-codex-review-1-c', 'review', 20, 25, 'reviewer', 'outer'),
    run('agent-codex-review-1-c', 'review', 20, 25, 'reviewer', 'outer')] });
  assert.equal(report.agentResources.cpuUs, 120, 'the outer waited tree already includes its nested descendant');
  assert.equal(report.agentResources.cpuObservations, 3);
  assert.equal(report.agentResources.runs.length, 3, 'a retained provider/local copy is counted once');
  assert.deepEqual(report.agentResources.runs.map(({ runId, model, provider }) => ({ runId, model, provider })),
    [{ runId: 'agent-codex-execute-1-a', model: 'gpt-6.1-sol', provider: { provenance: 'provider-reported', provider: 'openai', model: 'gpt-6.1-sol', values: [{ name: 'input', value: 40, unit: 'tokens' }] } }, { runId: 'agent-codex-repair-1-b', model: 'gpt-6.1-sol', provider: { provenance: 'provider-reported', provider: 'openai', model: 'gpt-6.1-sol', values: [{ name: 'input', value: 10, unit: 'tokens' }] } }, { runId: 'agent-codex-review-1-c', model: 'gpt-6.1-sol', provider: { provenance: 'provider-reported', provider: 'openai', model: 'gpt-6.1-sol', values: [{ name: 'input', value: 10, unit: 'tokens' }] } }], 'agentResources output stays unchanged while reading through ProviderResourceObservation (TASK-2846.03)');
  assert.equal(report.dependencyPath?.durationMs, 40, 'the path is exclusive elapsed time, not concurrent run time');
  assert.ok(report.dependencyPath?.nodeIds.includes('gate:failed-gate'));
  assert.ok(report.dependencyPath?.nodeIds.includes('gate:passed-gate'));
  assert.ok(report.dependencyPath?.nodeIds.includes('run:agent-codex-execute-1-a'), JSON.stringify(report.dependencyPath));
  assert.ok(report.dependencyPath?.nodeIds.includes('run:agent-codex-repair-1-b'));
  assert.ok(report.dependencyPath?.nodeIds.includes('run:agent-codex-review-1-c'));
  assert.ok(report.dependencyPath?.nodeIds.some(value => value.startsWith('activity:human')));
  assert.equal(report.unknowns.some(value => /Agent .* missing|identity incomplete/.test(value)), false);
  const incomplete = { ...run('agent-codex-execute-2-d', 'execute', 5, 10, 'missing', null), operationGeneration: null };
  const defective = verificationStatistics({ repositoryId: 'repo', operations: [operation], history: [], lifecycle: [
    { repositoryId: 'repo', missionId: 'px-1', fromStatus: 'integration', toStatus: 'done', occurredAt: instant(40),
      trigger: 'land', agent: 'codex', idempotencyKey: 'defective-done' },
  ], runs: [incomplete] });
  assert.ok(defective.flowMissions[0]?.diagnostics.some(value =>
    value.message.includes(`Agent run identity incomplete for px-1 source ${incomplete.runId}`)
    && value.recovery.includes('inspect the retained run history')));
  assert.equal(defective.unknowns.some(value => value.includes('Agent run identity incomplete')), false,
    'typed mission defects are not echoed through the legacy verification unknowns surface');
});

test('ownership retains lead handoffs and bounded partial terminal states (TASK-2835)', () => {
  const activity = (sourceId: string, at: number, state: string, actor: string, dependencies: string[] = []) => ({
    eventType: 'mission.current-work', createdAt: instant(at), eventData: JSON.stringify({ repositoryId: 'repo',
      missionId: 'px-1', operationId: 'lead-op', operationGeneration: 1, sourceId, dependencies, revision: 'rev',
      phase: 'recovery', state, actor, model: actor === 'lead' ? 'operator-model' : null,
      timeState: state === 'blocked' ? 'held' : 'working' }),
  });
  const lifecycle = [
    { repositoryId: 'repo', missionId: 'px-1', fromStatus: 'backlog', toStatus: 'refined', occurredAt: instant(0), trigger: 'refine', agent: 'human', idempotencyKey: 'refined' },
    { repositoryId: 'repo', missionId: 'px-1', fromStatus: 'refined', toStatus: 'active', occurredAt: instant(5), trigger: 'activate', agent: 'codex', idempotencyKey: 'active' },
    { repositoryId: 'repo', missionId: 'px-1', fromStatus: 'integration', toStatus: 'done', occurredAt: instant(40), trigger: 'land', agent: 'codex', idempotencyKey: 'done' },
  ];
  const report = verificationStatistics({ repositoryId: 'repo', operations: [], lifecycle, history: [
    activity('lead', 5, 'running', 'lead'), activity('lead', 20, 'interrupted', 'lead'),
    activity('human', 20, 'blocked', 'human'), activity('human', 30, 'cancelled', 'human'),
    { eventType: 'lead.operator-judgment', createdAt: instant(30), eventData: JSON.stringify({
      repositoryId: 'repo', missionId: 'px-1', action: 'escalate', summary: 'operator required', evidenceRefs: ['progress:blocked'], invocations: 1,
    }) },
    { eventType: 'lead.operator-judgment', createdAt: instant(31), eventData: JSON.stringify({
      missionId: 'px-1', action: 'escalate', summary: 'operator required again', evidenceRefs: ['progress:blocked'], invocations: 2,
    }) },
  ] });
  assert.equal(report.elapsedOwnership?.unexplainedMs, 5, 'lane state alone does not fabricate a human-held owner');
  assert.deepEqual(report.elapsedOwnership?.terminalStates, { blocked: 1, interrupted: 1, cancelled: 1 });
  assert.deepEqual(report.elapsedOwnership?.rows, [
    { step: 'recovery', actor: 'lead', model: 'operator-model', state: 'working', durationMs: 15 },
    { step: 'recovery', actor: 'human', model: null, state: 'held', durationMs: 10 },
    { step: 'lead-escalation', actor: 'human', model: null, state: 'held', durationMs: 10 },
  ]);
  assert.equal(report.flowMissions[0]?.lead.escalations, 1, 'legacy repeats for one evidence incident count once');
});

test('dependency path scopes mission ownership and never sums concurrent cohort windows (TASK-2835 review F2/F3)', () => {
  const lifecycle = ['m1', 'm2'].flatMap(missionId => [
    { repositoryId: 'repo', missionId, fromStatus: 'backlog', toStatus: 'refined', occurredAt: instant(0), trigger: 'refine', agent: 'human', idempotencyKey: `${missionId}:refined` },
    { repositoryId: 'repo', missionId, fromStatus: 'integration', toStatus: 'done', occurredAt: instant(10), trigger: 'land', agent: 'codex', idempotencyKey: `${missionId}:done` },
  ]);
  const history = ['m1', 'm2'].flatMap(missionId => ['running', 'ended'].map((state, index) => ({
    eventType: 'mission.current-work', createdAt: instant(index * 10), eventData: JSON.stringify({ repositoryId: 'repo', missionId,
      operationId: `${missionId}:op`, operationGeneration: 1, sourceId: `${missionId}:run`, dependencies: [], revision: 'rev',
      phase: 'execute', state, actor: 'codex', model: 'gpt-6.1-sol', timeState: 'working' }),
  })));
  const all = verificationStatistics({ repositoryId: 'repo', operations: [], lifecycle, history });
  assert.equal(all.elapsedOwnership?.totalMs, 20, 'cohort work totals remain additive');
  assert.equal(all.dependencyPath?.durationMs, 10, 'concurrent mission windows are alternative paths');
  const one = verificationStatistics({ repositoryId: 'repo', operations: [], lifecycle, history }, new Set(['m1']));
  assert.equal(one.elapsedOwnership?.totalMs, 10);
  assert.equal(one.dependencyPath?.durationMs, 10);
  assert.ok(one.dependencyPath?.nodeIds.every(id => id.includes('m1')));
  assert.equal(one.unknowns.some(value => value.includes('m2')), false, 'out-of-cohort missions emit no observation diagnostics');
  assert.equal(one.unknowns.some(value => value.includes('Activity identity incomplete')), false,
    'durable generation identity remains valid after the live operation advances or is cleaned up');
});

test('lane and unattributed blocked state remain unexplained instead of becoming human work (TASK-2835 review F3)', () => {
  const report = verificationStatistics({ repositoryId: 'repo', operations: [], lifecycle: [
    { repositoryId: 'repo', missionId: 'm1', fromStatus: 'backlog', toStatus: 'refined', occurredAt: instant(0), trigger: 'refine', agent: 'human', idempotencyKey: 'refined' },
    { repositoryId: 'repo', missionId: 'm1', fromStatus: 'integration', toStatus: 'done', occurredAt: instant(10), trigger: 'land', agent: 'codex', idempotencyKey: 'done' },
  ], history: [{ eventType: 'mission.current-work', createdAt: instant(2), eventData: JSON.stringify({ repositoryId: 'repo', missionId: 'm1',
    operationId: 'op', operationGeneration: 1, sourceId: 'blocked', dependencies: [], revision: 'rev', phase: 'review', state: 'blocked',
    actor: 'unattributed', model: null, timeState: 'waiting' }) }] });
  assert.equal(report.elapsedOwnership?.unexplainedMs, 10);
  assert.deepEqual(report.elapsedOwnership?.rows, []);
  assert.ok(report.unknowns.some(value => value.includes('Activity ownership incomplete for m1 operation op source blocked')));
});

test('observed operation handoffs and same-source actor changes reconcile without human inference (TASK-2835 review F3/F4)', () => {
  const activity = (at: number, operationId: string, sourceId: string, state: string, phase: string,
    actor: string, model: string | null, summary: string) => ({ eventType: 'mission.current-work', createdAt: instant(at),
    eventData: JSON.stringify({ repositoryId: 'repo', missionId: 'm1', operationId, operationGeneration: 1,
      sourceId, dependencies: [], revision: 'rev', phase, state, actor, model, timeState: 'working', summary }) });
  const report = verificationStatistics({ repositoryId: 'repo', operations: [], lifecycle: [
    { repositoryId: 'repo', missionId: 'm1', fromStatus: 'backlog', toStatus: 'refined', occurredAt: instant(0), trigger: 'refine', agent: 'draft', idempotencyKey: 'refined' },
    { repositoryId: 'repo', missionId: 'm1', fromStatus: 'integration', toStatus: 'done', occurredAt: instant(30), trigger: 'land', agent: 'custom', idempotencyKey: 'done' },
  ], history: [
    activity(0, 'draft-op', 'draft-op', 'running', 'draft', 'parallix', null, 'preparing workflow'),
    activity(5, 'draft-op', 'draft-op', 'ended', 'draft', 'parallix', null, 'workflow completed'),
    activity(10, 'active-op', 'active-op', 'running', 'execute', 'parallix', null, 'preparing workflow'),
    activity(12, 'active-op', 'active-op', 'running', 'execute', 'custom', 'manual/local-runner', 'running execute agent'),
    activity(20, 'active-op', 'active-op', 'running', 'review', 'custom', 'manual/local-runner', 'reviewer custom reviewing'),
    activity(24, 'active-op', 'active-op', 'ended', 'execute', 'parallix', null, 'execute run finished'),
    activity(25, 'active-op', 'active-op', 'ended', 'execute', 'parallix', null, 'workflow completed'),
  ] });
  assert.deepEqual(report.elapsedOwnership?.rows, [
    { step: 'draft', actor: 'parallix', model: null, state: 'working', durationMs: 5 },
    { step: 'responsibility-handoff', actor: 'external', model: null, state: 'waiting', durationMs: 5 },
    { step: 'preparation', actor: 'parallix', model: null, state: 'working', durationMs: 2 },
    { step: 'implement', actor: 'custom', model: 'manual/local-runner', state: 'working', durationMs: 8 },
    { step: 'agent-review', actor: 'custom', model: 'manual/local-runner', state: 'working', durationMs: 4 },
    { step: 'preparation', actor: 'parallix', model: null, state: 'working', durationMs: 1 },
  ]);
  assert.equal(report.elapsedOwnership?.unexplainedMs, 5, 'post-operation time remains unexplained without a next observed handoff');
  assert.equal(report.elapsedOwnership?.rows.some(row => row.actor === 'human'), false);
});

test('shared reader deduplicates rebase snapshots without collapsing repeated cycles (TASK-2835)', () => {
  const operation = (id: string, generation: number) => workflowOperation({ id, requestKey: id,
    command: 'review:submit', generation, originalStatus: 'review', updatedAt: instant(20) });
  const observation = (id: string, operationId: string, generation: number, outcome: string, at: number) => ({
    eventType: 'flow.rebase', createdAt: instant(at), eventData: JSON.stringify({ id, repositoryId: 'repo', missionId: 'px-1',
      operationId, generation, sourceId: id, stage: 'pre-review-rebase', attempt: 1, outcome,
      revisionBefore: 'before', revisionAfter: outcome === 'resolved' ? 'after' : 'before', conflicts: outcome === 'conflict' ? ['shared.ts'] : [],
      dependencies: [], occurredAt: instant(at) }),
  });
  const duplicate = observation('cycle-1', 'op-1', 1, 'conflict', 5);
  const report = verificationStatistics({ repositoryId: 'repo', operations: [operation('op-1', 1), operation('op-2', 2)], lifecycle: [], history: [
    observation('cycle-1', 'op-1', 1, 'running', 0), duplicate, duplicate,
    observation('cycle-1', 'op-1', 1, 'resolved', 10),
    observation('cycle-2', 'op-2', 2, 'running', 11), observation('cycle-2', 'op-2', 2, 'no-op', 12),
  ] });
  assert.deepEqual(report.rebases.map(value => [value.id, value.outcome]), [
    ['cycle-1', 'running'], ['cycle-1', 'conflict'], ['cycle-1', 'resolved'], ['cycle-2', 'running'], ['cycle-2', 'no-op'],
  ]);
  assert.equal(report.unknowns.some(value => value.includes('Rebase workflow join missing')), false);
});

test('px-0029 generation-1 gate and rebase facts survive an explicit generation-2 fence (PX-0055.01)', () => {
  const operation = workflowOperation({ id: 'px-0029-op', requestKey: 'px-0029', generation: 2, phase: 'stopped',
    updatedAt: instant(20) });
  const gate = (id: string, generation: number, missionId = 'px-1') => ({ eventType: VERIFICATION_MEASUREMENT_EVENT,
    createdAt: instant(5), eventData: JSON.stringify(attempt(id, 0, 5, { missionId, operationId: 'px-0029-op',
      operationGeneration: generation, sourceId: `gate:${id}` })) });
  const rebase = (id: string, generation: number, repositoryId = 'repo') => ({ eventType: 'flow.rebase', createdAt: instant(6),
    eventData: JSON.stringify({ id, repositoryId, missionId: 'px-1', operationId: 'px-0029-op', generation,
      sourceId: `rebase:${id}`, stage: 'pre-review-rebase', attempt: 1, outcome: 'clean', revisionBefore: 'a',
      revisionAfter: 'b', conflicts: [], occurredAt: instant(6) }) });
  const validRebase = rebase('valid', 1);
  const activity = (sourceId: string, generation: number, state: string, at: number) => ({ eventType: 'mission.current-work',
    createdAt: instant(at), eventData: JSON.stringify({ repositoryId: 'repo', missionId: 'px-1',
      operationId: 'px-0029-op', operationGeneration: generation, sourceId, revision: 'rev',
      phase: 'review-response', state }) });
  const report = verificationStatistics({ repositoryId: 'repo', operations: [operation], lifecycle: [], history: [
    gate('valid', 1), gate('forged-fence', 2), gate('foreign-mission', 1, 'foreign'),
    validRebase, validRebase, rebase('forged-fence', 2), rebase('foreign-repository', 1, 'foreign'),
    activity('valid-activity', 1, 'running', 7), activity('valid-activity', 1, 'ended', 9),
    activity('forged-activity', 2, 'running', 10), activity('forged-activity', 2, 'ended', 12),
  ] });

  assert.deepEqual(report.attempts.map(value => value.id), ['valid']);
  assert.deepEqual(report.rebases.map(value => value.id), ['valid']);
  assert.equal(report.repairMs, 2);
  assert.ok(report.unknowns.some(value => value.includes('Gate workflow generation rejected')));
  assert.ok(report.unknowns.some(value => value.includes('Attempt workflow identity mismatch excluded')));
  assert.ok(report.unknowns.some(value => value.includes('Rebase workflow join missing')));
  assert.ok(report.unknowns.some(value => value.includes('Activity workflow identity rejected')));
});

test('shared reader retains repeated conflict attempts and their elapsed ownership (TASK-2835 review F9)', () => {
  const operation = workflowOperation({ id: 'op-1', requestKey: 'rebase', command: 'active:execute', updatedAt: instant(10) });
  const observation = (outcome: string, attempt: number, at: number) => ({ eventType: 'flow.rebase', createdAt: instant(at),
    eventData: JSON.stringify({ id: 'resumed-cycle', repositoryId: 'repo', missionId: 'px-1', operationId: 'op-1', generation: 1,
      sourceId: 'resumed-cycle', stage: 'pre-review-rebase', attempt, outcome, revisionBefore: 'before',
      revisionAfter: outcome === 'resolved' ? 'after' : 'before', conflicts: outcome === 'conflict' ? [`shared-${attempt}.ts`] : [],
      dependencies: [], occurredAt: instant(at) }) });
  const report = verificationStatistics({ repositoryId: 'repo', operations: [operation], history: [
    observation('running', 1, 0), observation('conflict', 1, 5), observation('conflict', 2, 8), observation('resolved', 2, 10),
  ], lifecycle: [
    { repositoryId: 'repo', missionId: 'px-1', fromStatus: 'backlog', toStatus: 'refined', occurredAt: instant(0),
      trigger: 'refine', agent: 'human', idempotencyKey: 'refined' },
    { repositoryId: 'repo', missionId: 'px-1', fromStatus: 'integration', toStatus: 'done', occurredAt: instant(10),
      trigger: 'land', agent: 'codex', idempotencyKey: 'done' },
  ] });

  assert.deepEqual(report.rebases.map(value => [value.attempt, value.outcome]), [
    [1, 'running'], [1, 'conflict'], [2, 'conflict'], [2, 'resolved'],
  ]);
  assert.deepEqual(report.flowMissions[0]?.rebaseStages.find(stage => stage.stage === 'pre-review-rebase'), {
    stage: 'pre-review-rebase', state: 'measured', operationId: 'op-1', sourceId: 'resumed-cycle',
    reason: 'retained terminal rebase outcome', outcomes: ['conflict', 'conflict', 'resolved'],
  }, 'typed stage provenance retains repeated conflict/resolution outcomes');
  assert.deepEqual(report.elapsedOwnership?.rows, [
    { step: 'pre-review-rebase', actor: 'parallix', model: null, state: 'working', durationMs: 10 },
  ]);
  assert.equal(report.elapsedOwnership?.unexplainedMs, 0);
});

test('partial lane return identity remains a scoped FLOW defect (PX-0055.01)', () => {
  const defect = 'Workflow return identity invalid for repo/px-1 lane event partial-return';
  const lifecycle: BoardLaneEventEntry[] = [
    { repositoryId: 'repo', missionId: 'px-1', fromStatus: 'backlog', toStatus: 'refined',
      occurredAt: instant(0), trigger: 'refine', agent: 'human', idempotencyKey: 'refined' },
    { repositoryId: 'repo', missionId: 'px-1', fromStatus: 'integration', toStatus: 'done',
      occurredAt: instant(10), trigger: 'integrate', agent: 'codex', idempotencyKey: 'partial-return',
      returnIdentityDefect: defect },
    { repositoryId: 'repo', missionId: 'foreign', fromStatus: 'review', toStatus: 'active',
      occurredAt: instant(5), trigger: 'request-changes', agent: 'codex', idempotencyKey: 'foreign-return',
      returnIdentityDefect: 'Workflow return identity invalid for repo/foreign lane event foreign-return' },
  ];

  const report = verificationStatistics({ repositoryId: 'repo', operations: [], history: [], lifecycle }, new Set(['px-1']));

  assert.equal(report.unknowns.includes(defect), false, 'mission defects are not duplicated as repository unknowns');
  assert.equal(report.unknowns.some(value => value.includes('/foreign ')), false);
  assert.deepEqual(report.flowMissions[0]?.diagnostics.filter(diagnostic => diagnostic.message === defect), [{
    kind: 'provenance', state: 'absent', repositoryId: 'repo', missionId: 'px-1', operationId: null,
    sourceId: 'partial-return', stage: 'return', message: defect, recovery: 'inspect the retained lane return identity',
  }]);
  assert.equal(report.flowMissions[0]?.diagnostics.some(diagnostic => diagnostic.message.includes('/foreign ')), false);
});

test('verification unions overlap, accounts nested CPU once and measures complete dependency paths (px-0025)', () => {
  const rows = [attempt('a', 0, 10), attempt('b', 5, 15, {
    cpu: { userUs: 300, systemUs: 0, boundary: 'b', parent: 'a', provenance: 'bash-time-waited-tree' },
  }), attempt('c', 15, 20, { after: ['a', 'b'] })];
  const report = verificationReport(rows);
  assert.equal(report.executionMs, 20);
  assert.equal(report.overlapMs, 5);
  assert.equal(report.cpuUs, 2000);
  assert.equal(report.waitingMs, 0, 'waiting covered by active execution is not counted again');
  assert.equal(report.criticalPathMs, 15);
  assert.equal(report.cpuObservations, 3);
  assert.equal(verificationReport([rows[0], rows[2]]).criticalPathMs, null, 'missing dependency is not zero');
  assert.equal(verificationReport([attempt('a', 0, 10, { after: ['c'] }), rows[2]]).criticalPathMs, null);
});

test('verification retains attempts through repairs and completion without mixing repository or mission identities (px-0025)', () => {
  const first = attempt('first', 0, 10, { gate: 'check', batchId: 'one', plan: ['check'], result: 'failed', exitCode: 1,
    failureReason: { version: 1, code: 'infrastructure' }, cpu: null });
  const next = attempt('next', 25, 35, { gate: 'check', batchId: 'two', plan: ['check'], revision: 'fixed' });
  const other = attempt('other', 0, 100, { repositoryId: 'other', missionId: 'px-1' });
  const events: BoardLaneEventEntry[] = [
    { repositoryId: 'repo', missionId: 'px-1', fromStatus: null, toStatus: 'refined', occurredAt: instant(0), trigger: 'refine', agent: 'codex', idempotencyKey: 'one' },
    { repositoryId: 'repo', missionId: 'px-1', fromStatus: 'integration', toStatus: 'done', occurredAt: instant(50), trigger: 'done', agent: 'codex', idempotencyKey: 'two' },
  ];
  const report = verificationReport([first, { ...first, result: 'running', finishedAt: null }, first, next, other], events);
  assert.equal(report.attemptCount, 2);
  assert.equal(report.infrastructureFailureCount, 1);
  assert.equal(report.failureCount, 1);
  assert.equal(report.rerunCount, 1);
  assert.equal(report.rerun.wallMs, 10);
  assert.equal(report.recovery.wallMs, 25);
  assert.equal(report.recovery.cpuUs, 1000);
  assert.equal(report.endToEndMs, 50);
  assert.equal(report.completedMissions, 1);
  assert.equal(report.criticalPathMs, null, 'inter-batch dependencies are unknown');
  assert.ok(report.unknowns.some(value => value.includes('partial')));
});

test('verification distinguishes absent samples and interrupted work from measured zero and proof reuse (px-0025)', () => {
  const missing = verificationReport([]);
  assert.equal(missing.executionMs, null);
  assert.equal(missing.cpuUs, null);
  const zero = attempt('zero', 0, 0, { plan: ['zero'], cpu: {
    userUs: 0, systemUs: 0, boundary: 'zero', parent: null, provenance: 'bash-time-waited-tree',
  } });
  assert.equal(verificationReport([zero]).cpuUs, 0);
  assert.equal(verificationReport([zero]).executionMs, 0);
  const partial = verificationReport([attempt('partial', 0, 1, { result: 'running', finishedAt: null, cpu: null }),
    attempt('reused', 0, 0, { result: 'reused', startedAt: null, cpu: null })]);
  assert.equal(partial.incompleteCount, 1);
  assert.equal(partial.attemptCount, 1);
  assert.equal(partial.reusedProofCount, 1);
  assert.equal(partial.executionMs, null);
  assert.equal(partial.cpuUs, null);
});

test('verification scopes activity by repository and source while retaining repair and re-review intervals (px-0025)', () => {
  const history = [
    ['review', 'running', 0], ['review', 'ended', 10],
    ['review-response', 'running', 10], ['review-response', 'ended', 20],
    ['review', 'running', 20], ['review', 'ended', 35],
  ].map(([phase, state, ms]) => ({ eventType: 'mission.current-work', createdAt: instant(Number(ms)),
    eventData: JSON.stringify({ repositoryId: 'repo', missionId: 'px-1', operationId: 'op', sourceId: 'source', phase, state }) }));
  const report = verificationStatistics({ repositoryId: 'repo', history, operations: [], lifecycle: [] }, new Set(['px-1']));
  assert.equal(report.repairMs, 10);
  assert.equal(report.reReviewMs, 15);
  assert.equal(verificationStatistics({ repositoryId: 'other', history, operations: [], lifecycle: [] }).repairMs, null);
});

test('verification reporting retains controlled workloads, samples and explicit benefit bounds (TASK-2835)', () => {
  const base = { coverage: false, pair: 0, command: ['node', '--test', 'same.test.ts'], wallMs: 100, cpuUs: 1000, profiles: [] };
  const sampled = (pair: number, coverage = false) => ({ ...base, coverage, pair, profiled: true,
    command: ['node', '--cpu-prof', '--cpu-prof-interval=1000', '--test', 'same.test.ts'], wallMs: 105, cpuUs: 1040,
    profiles: [{ samples: 100, hotspots: [{ functionName: 'component', url: 'file:///repo/src/component.ts', samples: 20 }] }] });
  const control = (pair: number, coverage = false) => ({ ...base, coverage, pair, profiled: false });
  const controlledComparisons = controlledVerificationComparisons({ revision: 'abc', dirty: false, node: 'v24', platform: 'linux', arch: 'x64', tsx: '4',
    workload: ['same.test.ts'], runs: [control(0), sampled(0), control(1), sampled(1), control(0, true), sampled(0, true), control(1, true), sampled(1, true)] }, 'component');
  const report = verificationReport([
    attempt('a', 0, 10, { gate: 'check', revision: 'before', configuration: 'same' }),
    attempt('b', 20, 25, { gate: 'check', revision: 'after', configuration: 'same',
      profile: { reference: 'retained/report.json', samples: 400, controlledComparisons } }),
  ]);
  assert.equal(report.comparisons[0].beforeN, 1);
  assert.equal(report.comparisons[0].afterN, 1);
  assert.equal(report.comparisons[0].configurationEquivalent, true);
  assert.equal(report.comparisons[0].workloadEquivalent, 'unobserved');
  assert.equal(report.controlledComparisons.length, 2);
  assert.equal(report.controlledComparisons[0].workloadEquivalent, true);
  assert.equal(report.controlledComparisons[0].samples, 200);
  assert.equal(report.controlledComparisons[0].component?.contribution, 0.2);
  assert.equal(report.controlledComparisons[0].optimizationBenefitBound?.maximumSpeedupRatio, 1.25);
  const rendered = renderVerificationStatistics(report).join('\n');
  assert.match(rendered, /retained history/);
  assert.match(rendered, /OS waited-tree CPU 2000 us/);
  assert.match(rendered, /retained\/report.json/);
  assert.match(rendered, /workload equivalence unobserved \(not a controlled comparison\)/);
  assert.match(rendered, /workload\/configuration\/runtime equivalent true/);
  assert.match(rendered, /20\.0%\); hypothetical removable-CPU bound 20\.0%, maximum speedup 1\.250x/);
  assert.match(rendered, /not establish contention or an optimization speedup/);
  assert.deepEqual(renderVerificationStatistics(null), ['Verification measurements: unavailable']);
});

test('controlled workload fingerprints are stable across retained run order (TASK-2835)', () => {
  const run = (coverage: boolean, profiled: boolean, pair: number, command: string) => ({
    coverage, profiled, pair, command: ['node', '--test', command], wallMs: 10, cpuUs: 100,
    profiles: profiled ? [{ samples: 1, hotspots: [] }] : [],
  });
  const runs = [run(false, false, 0, 'z.test.ts'), run(false, false, 1, 'a.test.ts'),
    run(false, true, 0, 'z.test.ts'), run(false, true, 1, 'a.test.ts'),
    run(true, false, 0, 'z.test.ts'), run(true, false, 1, 'a.test.ts'),
    run(true, true, 0, 'z.test.ts'), run(true, true, 1, 'a.test.ts')];
  const report = { revision: 'abc', dirty: false, node: 'v24', platform: 'linux', arch: 'x64', tsx: '4',
    workload: ['a.test.ts', 'z.test.ts'], runs };

  const original = controlledVerificationComparisons(report);
  const reordered = controlledVerificationComparisons({ ...report, runs: [...runs].reverse() });

  assert.deepEqual(original.map(item => item.workloadFingerprint),
    reordered.map(item => item.workloadFingerprint));
  assert.ok(original.every(item => item.workloadEquivalent === false));
});

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
  async findWhere(filter: UsageFilter): Promise<readonly UsageRecord[]> { return this.records.filter((record) => matchesUsageFilter(record, filter)); }
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
  return { async observeGate() { return 'not-run' as const; } };
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
    { repo: 'r', mission: 'task-done', date: '2026-06-01', implementer: 'codex', model: 'gpt-6.1-sol', stage: 'default', classification: 'user_value', pr_fix_rounds: '2'},
    { repo: 'r', mission: 'task-active', date: '2026-06-23', implementer: 'claude', stage: 'active', classification: 'ai_sdlc', pr_fix_rounds: '9' },
  ];
  const flow = [
    { repo: 'r', mission: 'task-done', closedAt: '2026-06-23T12:00:00Z', labels: ['user_value'], implementer: 'codex', reviewStatistics: reviewStatisticsObservation('codex', 2) },
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
    assert.match(report, /gpt-6\.1-sol\s+1\s+2\b/);
    const performance = report.split(mode === 'weekly' ? 'Agent performance this week' : 'Agent performance')[1]!.split('Agent spend')[0]!;
    assert.doesNotMatch(performance, /claude/, 'active work receives no delivery credit');
    assert.match(performance, /Unavailable model attribution: 1 missions, unavailable reimplementation rounds/, 'telemetry-free deliveries retain population credit with no fabricated model or count');
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
