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
