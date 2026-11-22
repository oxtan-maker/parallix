import test from 'node:test';
import assert from 'node:assert/strict';

import { verificationStatistics } from '../../../../src/application/projections/verification-statistics.js';
import { flowStatistics, type FlowMissionFacts } from '../../../../src/application/projections/flow-statistics.js';
import { VERIFICATION_MEASUREMENT_EVENT, type VerificationMeasurement } from '../../../../src/application/ports/verification-observation.js';
import { weeklyDecisionWindows } from '../../../../src/application/services/decision-window.js';
import { reviewStatisticsObservation } from '../../../fixtures/review-statistics.js';
import { repositoryId } from '../../../../src/domain/repository.js';
import { missionId } from '../../../../src/domain/mission.js';
import { agentFamily } from '../../../../src/domain/agents.js';
import type { WorkflowOperation } from '../../../../src/domain/workflow-operation.js';
import type { BoardLaneEventEntry } from '../../../../src/application/ports/operation-history.js';
import type { OperationalHistoryEntry } from '../../../../src/application/ports/operation-history.js';
import { collectLocalStatsRecovery } from '../../../../src/adapters/review/stats-recovery-collector.js';
import { REVIEW_START_DECISION_EVENT } from '../../../../src/application/verification-policy/review-start-decision.js';

const instant = (ms: number) => new Date(Date.UTC(2026, 10, 2) + ms).toISOString();
const operation = (): WorkflowOperation => ({ id: 'op', repositoryId: repositoryId('repo'), missionId: missionId('px-1'),
  requestKey: 'request', command: 'active:execute', generation: 1, phase: 'completed', providerStarted: true,
  agent: agentFamily('codex'), reviewer: agentFamily('codex'), originalStatus: 'active', previousAssignee: agentFamily('codex'),
  owner: null, createdAt: instant(0), updatedAt: instant(40), reason: null });
function attempt(id: string, extra: Partial<VerificationMeasurement> = {}): VerificationMeasurement {
  return { id, repositoryId: 'repo', missionId: 'px-1', operationId: 'op', operationGeneration: 1,
    sourceId: 'op:1', revision: 'rev', batchId: 'batch', gate: id, command: 'check', phase: 'integration',
    after: [], plan: ['a'], requestedAt: instant(0), startedAt: instant(1), finishedAt: instant(2), result: 'passed',
    failureReason: null, exitCode: 0, wallMs: 1, cpu: null, profile: null, ...extra };
}
function verificationReport(attempts: readonly VerificationMeasurement[], lifecycle: readonly BoardLaneEventEntry[] = []) {
  return verificationStatistics({ repositoryId: 'repo', operations: [], lifecycle,
    history: attempts.map(value => ({ eventType: VERIFICATION_MEASUREMENT_EVENT, eventData: JSON.stringify(value),
      createdAt: value.finishedAt ?? value.requestedAt })) });
}

test('verification action decisions leave existing statistics and projections unchanged (TASK-2859.09, TASK-2859.10)', () => {
  const decision = (actualAction: 'agent' | 'tests'): OperationalHistoryEntry => ({
    id: 1, eventType: REVIEW_START_DECISION_EVENT, createdAt: '2026-11-18T10:00:00.000Z',
    eventData: JSON.stringify({ idempotencyKey: `start-${actualAction}`, repositoryId: 'repo', missionId: 'task-2859.10', actualAction,
      actionSequence: 1, predictedPassProbability: { agent: 0.8, human: 0.7, tests: 0.9 } }),
  });
  const statistics = (history: readonly OperationalHistoryEntry[]) => verificationStatistics({
    repositoryId: 'repo', history, operations: [], lifecycle: [],
  });
  const { model, ...measured } = statistics([decision('agent'), decision('tests')]);
  const { model: _empty, ...baseline } = statistics([]);
  assert.deepEqual(measured, baseline, 'decisions change no existing measurement; only the model statistics see them (TASK-2867.07)');
  assert.deepEqual(model.calibration.map(entry => [entry.check, entry.starts, entry.matched]), [['tests', 1, 0], ['agent', 1, 0], ['human', 0, 0]]);
  const recovery = (operationalHistory: readonly OperationalHistoryEntry[]) => collectLocalStatsRecovery({
    missions: [], laneMoves: [], operationalHistory,
  }, 'repo');
  assert.deepEqual(recovery([decision('agent'), decision('tests')]), recovery([]));
});

test('activity identity without a mission remains a repository diagnostic (PX-0055.03)', () => {
  const createdAt = '2026-11-02T00:00:00.001Z';
  const report = verificationStatistics({ repositoryId: 'repo', operations: [], lifecycle: [], history: [
    { eventType: 'mission.current-work', createdAt, eventData: JSON.stringify({ repositoryId: 'repo',
      missionId: '', operationId: null, operationGeneration: null, sourceId: null, revision: null,
      dependencies: [], phase: 'execute', state: 'running', actor: 'codex', model: null, timeState: 'working' }) },
  ] });
  assert.ok(report.unknowns.some(value => value.includes(
    'Activity identity incomplete for unknown mission operation unknown source unknown')));
  assert.deepEqual(report.flowMissions, []);
});

test('one running operation has one terminal defect and no legacy unknown echo (PX-0055.03)', () => {
  const running = attempt('unit', { result: 'running', finishedAt: null, wallMs: null,
    sourceId: 'source-op', requestedAt: instant(1), startedAt: instant(1) });
  const report = verificationStatistics({ repositoryId: 'repo', operations: [operation()], history: [
    { eventType: 'mission.current-work', createdAt: instant(1), eventData: JSON.stringify({ repositoryId: 'repo',
      missionId: 'px-1', operationId: 'op', operationGeneration: 1, sourceId: 'source-op', revision: 'rev',
      dependencies: [], phase: 'execute', state: 'running', actor: 'codex', model: 'gpt-6.1-sol', timeState: 'working' }) },
    { eventType: VERIFICATION_MEASUREMENT_EVENT, createdAt: instant(1), eventData: JSON.stringify(running) },
  ], lifecycle: [{ repositoryId: 'repo', missionId: 'px-1', fromStatus: 'integration', toStatus: 'done',
    occurredAt: instant(3), trigger: 'land', agent: 'codex', idempotencyKey: 'done' }] });
  const terminal = report.flowMissions[0]!.diagnostics.filter(diagnostic => diagnostic.kind === 'terminal');
  assert.deepEqual(terminal.map(({ state, stage, operationId, sourceId }) => ({ state, stage, operationId, sourceId })), [
    { state: 'running', stage: 'gate', operationId: 'op', sourceId: 'source-op' },
  ]);
  assert.equal(report.unknowns.some(value => value.includes('Gate unit running')
    || value.includes('Activity remains running')), false);
  const activityOnly = verificationStatistics({ repositoryId: 'repo', operations: [operation()], history: [
    { eventType: 'mission.current-work', createdAt: instant(1), eventData: JSON.stringify({ repositoryId: 'repo',
      missionId: 'px-1', operationId: 'op', operationGeneration: 1, sourceId: 'activity-only', revision: 'rev',
      dependencies: [], phase: 'execute', state: 'running', actor: 'codex', model: 'gpt-6.1-sol', timeState: 'working' }) },
  ], lifecycle: [{ repositoryId: 'repo', missionId: 'px-1', fromStatus: 'integration', toStatus: 'done',
    occurredAt: instant(3), trigger: 'land', agent: 'codex', idempotencyKey: 'activity-only-done' }] });
  assert.deepEqual(activityOnly.flowMissions[0]!.diagnostics.filter(diagnostic => diagnostic.kind === 'terminal')
    .map(({ stage, sourceId }) => ({ stage, sourceId })), [{ stage: 'execute', sourceId: 'activity-only' }],
  'an open non-gate activity remains a typed observation diagnostic');
});

test('mission-scoped gate identity gaps make FLOW observation incomplete (PX-0055.03)', () => {
  const incomplete = attempt('missing-gate-identity', { operationId: null, operationGeneration: null, sourceId: null });
  const lifecycle: BoardLaneEventEntry[] = [{ repositoryId: 'repo', missionId: 'px-1', fromStatus: 'integration',
    toStatus: 'done', occurredAt: instant(2), trigger: 'done', agent: 'codex', idempotencyKey: 'done' }];
  const diagnostics = verificationReport([incomplete], lifecycle).flowMissions[0]?.diagnostics ?? [];
  assert.equal(diagnostics.filter(diagnostic => diagnostic.kind === 'identity' && diagnostic.stage === 'gate').length, 1);
  const fact: FlowMissionFacts = { repositoryId: 'repo', missionId: 'px-1', closedAt: instant(2), implementer: 'codex',
    diagramNodeIds: [], diagramEdgeIds: [], ownership: [], window: null, gateRuns: [], rebaseRuns: [], rebaseStages: [],
    diagnostics, lead: { queued: 0, recoveries: 0, escalations: 0 }, laneDwellMs: null, actualAgentLaunches: 1,
    agentLaunches: [], observedDisqualifiers: [], reviewStatistics: reviewStatisticsObservation('codex', 0) };
  const flow = flowStatistics([fact], weeklyDecisionWindows('2026-11-02', 'UTC')).current;
  assert.deepEqual(flow.observation, { complete: 0, partial: 1, unobserved: 0 });
  assert.equal(flow.defects.filter(diagnostic => diagnostic.includes('Gate identity incomplete')).length, 1);
});

test('repository diagnostics remain visible without becoming mission defects (PX-0055.03)', () => {
  const diagnostic = '1 unreadable workflow operation row excluded from FLOW statistics';
  const report = verificationStatistics({ repositoryId: 'repo', history: [], operations: [], lifecycle: [],
    repositoryDiagnostics: [diagnostic] });
  assert.ok(report.unknowns.includes(diagnostic));
  assert.deepEqual(report.flowMissions.flatMap(mission => mission.diagnostics), []);
});

test('a running event for a lower activity frame ends the frames above it, so they are not reported as still running (TASK-2867.07)', () => {
  const event = (sourceId: string, state: string, at: number, phase = 'draft') => ({ eventType: 'mission.current-work', createdAt: instant(at),
    eventData: JSON.stringify({ repositoryId: 'repo', missionId: 'px-1', operationId: 'op', operationGeneration: 1, sourceId, revision: 'rev',
      dependencies: [], phase, state, actor: 'parallix', model: null, timeState: 'working' }) });
  const stopped = verificationStatistics({ repositoryId: 'repo', operations: [operation()], lifecycle: [], history: [
    event('op', 'running', 1, 'waiting'), event('draft:px-1:a', 'running', 2), event('op', 'running', 3, 'waiting'), event('op', 'cancelled', 4, 'waiting'),
  ] });
  assert.equal(stopped.unknowns.some(value => value.includes('Open activity intervals excluded')), false, 'nothing is left open');
  const lingering = verificationStatistics({ repositoryId: 'repo', operations: [operation()], lifecycle: [], history: [
    event('op', 'running', 1, 'waiting'), event('draft:px-1:a', 'running', 2), event('op', 'cancelled', 4, 'waiting'),
  ] });
  assert.equal(lingering.unknowns.some(value => value.includes('Open activity intervals excluded')), true, 'a frame above a closed frame stays open until something lower runs');
});

test('only an activity may carry the admission generation; a gate attempt needs the claimed generation (TASK-2867.07 F11)', () => {
  const measurement = (extra: Partial<VerificationMeasurement>) => ({ eventType: VERIFICATION_MEASUREMENT_EVENT, createdAt: instant(2),
    eventData: JSON.stringify(attempt('unit', extra)) });
  const gate = (generation: number) => verificationStatistics({ repositoryId: 'repo', operations: [operation()], lifecycle: [],
    history: [measurement({ operationGeneration: generation })] });
  assert.equal(gate(1).attemptCount, 1, 'the claimed generation is measured');
  assert.equal(gate(0).attemptCount, 0, 'generation 0 is not a gate generation');
  assert.ok(gate(0).unknowns.some(value => value.includes('Gate')), 'the rejected attempt is reported, not dropped');
  const activity = (generation: number) => verificationStatistics({ repositoryId: 'repo', operations: [operation()], lifecycle: [], history: [
    { eventType: 'mission.current-work', createdAt: instant(1), eventData: JSON.stringify({ repositoryId: 'repo', missionId: 'px-1',
      operationId: 'op', operationGeneration: generation, sourceId: 'op', revision: 'rev', dependencies: [], phase: 'waiting', state: 'running',
      actor: 'parallix', model: null, timeState: 'waiting' }) }] });
  assert.equal(activity(0).unknowns.some(value => value.includes('Activity workflow identity rejected')), false, 'the admission activity joins its operation');
  assert.equal(activity(5).unknowns.some(value => value.includes('Activity workflow identity rejected')), true, 'other generations still need the exact one');
});
