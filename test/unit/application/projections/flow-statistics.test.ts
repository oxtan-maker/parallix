import test from 'node:test';
import assert from 'node:assert/strict';

import { flowStatistics, type FlowMissionFacts } from '../../../../src/application/projections/flow-statistics.js';
import { observedFlowMissions } from '../../../../src/application/projections/flow-mission-facts.js';
import { weeklyDecisionWindows } from '../../../../src/application/services/decision-window.js';
import { reviewStatisticsObservation } from '../../../fixtures/review-statistics.js';
import type { VerificationMeasurement } from '../../../../src/application/ports/verification-observation.js';
import { reviewStatistics } from '../../../../src/application/services/review-statistics.js';
import { repositoryId } from '../../../../src/domain/repository.js';
import { missionId } from '../../../../src/domain/mission.js';

test('rebase applicability requires the owning workflow to start after collection is proven active (TASK-2836)', () => {
  const lifecycle = [
    { repositoryId: 'repo', missionId: 'in-transit', fromStatus: 'active', toStatus: 'review', trigger: 'begin-review-preparation', agent: 'codex', occurredAt: '2026-11-04T11:00:00Z', idempotencyKey: 'old-review' },
    { repositoryId: 'repo', missionId: 'in-transit', fromStatus: 'integration', toStatus: 'done', trigger: 'integrate', agent: 'codex', occurredAt: '2026-11-04T12:00:00Z', idempotencyKey: 'old-done' },
    { repositoryId: 'repo', missionId: 'fresh-mission', fromStatus: 'active', toStatus: 'review', trigger: 'begin-review-preparation', agent: 'codex', occurredAt: '2026-11-04T11:40:00Z', idempotencyKey: 'fresh-review' },
    { repositoryId: 'repo', missionId: 'fresh-mission', fromStatus: 'integration', toStatus: 'done', trigger: 'integrate', agent: 'codex', occurredAt: '2026-11-04T12:10:00Z', idempotencyKey: 'fresh-done' },
  ] as const;
  const rebases = [{ id: 'collector-proof', repositoryId: 'repo', missionId: 'observed', operationId: 'operation', generation: 1,
    sourceId: 'source', stage: 'pre-review-rebase', attempt: 1, outcome: 'no-op', revisionBefore: 'a', revisionAfter: 'a',
    conflicts: [], occurredAt: '2026-11-04T11:36:00Z' }] as const;
  const operation = (id: string, mission: string, command: 'active:execute' | 'integrate:merge', createdAt: string, updatedAt: string) => ({
    id, repositoryId: repositoryId('repo'), missionId: missionId(mission), requestKey: id, command, generation: 1, phase: 'completed' as const,
    providerStarted: true, agent: 'codex', reviewer: 'claude', originalStatus: command === 'integrate:merge' ? 'integration' as const : 'active' as const,
    previousAssignee: 'codex', owner: null, createdAt, updatedAt, reason: null,
  });
  const operations = [
    operation('old-review', 'in-transit', 'active:execute', '2026-11-04T10:50:00Z', '2026-11-04T11:10:00Z'),
    operation('fresh-integrate', 'in-transit', 'integrate:merge', '2026-11-04T11:50:00Z', '2026-11-04T12:01:00Z'),
    operation('fresh-review', 'fresh-mission', 'active:execute', '2026-11-04T11:37:00Z', '2026-11-04T11:41:00Z'),
    operation('fresh-integrate-2', 'fresh-mission', 'integrate:merge', '2026-11-04T12:00:00Z', '2026-11-04T12:11:00Z'),
  ];
  const facts = observedFlowMissions({ repositoryId: 'repo', lifecycle, operations }, null, [], rebases);
  assert.deepEqual(facts.map(fact => [fact.missionId, fact.rebaseExpected]), [
    ['in-transit', { preReview: false, integration: true }],
    ['fresh-mission', { preReview: true, integration: true }],
  ]);
  assert.deepEqual(observedFlowMissions({ repositoryId: 'repo', lifecycle, operations }, null, [], [], rebases[0].occurredAt)
    .map(fact => [fact.missionId, fact.rebaseExpected]), facts.map(fact => [fact.missionId, fact.rebaseExpected]),
  'mission filtering cannot erase the repository collection cutover');
});

test('missing applicable rebase observations are collection defects rather than observed zeroes (TASK-2836)', () => {
  const fact: FlowMissionFacts = { repositoryId: 'repo', missionId: 'task-missing-integration-rebase',
    closedAt: '2026-11-03T12:00:00Z', implementer: 'codex', laneDwellMs: null,
    diagramNodeIds: [], diagramEdgeIds: [], window: { startedAt: '2026-11-03T11:00:00Z', finishedAt: '2026-11-03T12:00:00Z' },
    gateRuns: [], rebaseRuns: [{ id: 'pre', stage: 'pre-review-rebase', outcomes: ['no-op'] }],
    rebaseExpected: { preReview: true, integration: true },
    lead: { queued: 0, recoveries: 0, escalations: 0 }, actualAgentLaunches: 1,
    agentLaunches: [{ runId: 'run', startedAt: '2026-11-03T11:00:00Z', family: 'codex', model: 'gpt-6.1-sol' }],
    observedDisqualifiers: [], reviewStatistics: reviewStatisticsObservation('codex', 0),
    collectionDefects: ['1 unreadable workflow operation row excluded from FLOW statistics'],
    ownership: [{ step: 'implement', actor: 'codex', model: 'gpt-6.1-sol', state: 'working', durationMs: 3_600_000 }] };
  const result = flowStatistics([fact], weeklyDecisionWindows('2026-11-03', 'UTC')).current;
  assert.deepEqual(result.graph.nodes.find(node => node.id === 'integration-rebase'),
    { id: 'integration-rebase', lane: 'parallix', count: 0, rework: null, observedMissions: 0, population: 1 });
  assert.ok(result.defects.includes('Integration rebase observations missing for repo/task-missing-integration-rebase; inspect flow.rebase workflow collection'));
  assert.ok(result.defects.includes('1 unreadable workflow operation row excluded from FLOW statistics'));
  assert.equal(result.defects.some(defect => defect.startsWith('Pre-review rebase observations missing')), false);
});

test('FLOW keeps measured subset values and excludes reused-only gate batches (TASK-2836)', () => {
  const lifecycle = [{ repositoryId: 'repo', missionId: 'px-1', fromStatus: 'backlog', toStatus: 'refined', occurredAt: '2026-11-03T10:00:00Z', trigger: 'refine', agent: 'human', idempotencyKey: 'r' },
    { repositoryId: 'repo', missionId: 'px-1', fromStatus: 'integration', toStatus: 'done', occurredAt: '2026-11-03T12:00:00Z', trigger: 'land', agent: 'codex', idempotencyKey: 'd' }];
  const reused = { id: 'reused', repositoryId: 'repo', missionId: 'px-1', operationId: null, revision: 'r', batchId: 'reuse', gate: 'unit', command: 'unit', phase: 'handoff', after: [], requestedAt: '2026-11-03T11:00:00Z', startedAt: null, finishedAt: '2026-11-03T11:00:01Z', result: 'reused', failureReason: null, exitCode: 0, wallMs: null, cpu: null, profile: null } satisfies VerificationMeasurement;
  assert.deepEqual(observedFlowMissions({ repositoryId: 'repo', lifecycle, operations: [] }, null, [reused], [])[0]?.gateRuns, []);
  const observedReview = reviewStatistics(null, { equivalentSubmissions: {}, workflowReturns: [{ identity: 'repair:1', author: 'codex', at: '2026-11-03T11:00:00Z', source: 'repair' }] });
  const measured = { repositoryId: 'repo', missionId: 'measured', closedAt: '2026-11-03T12:00:00Z', implementer: 'codex', laneDwellMs: null, diagramNodeIds: [], diagramEdgeIds: [], ownership: [], window: null, gateRuns: [], rebaseRuns: [], lead: { queued: 0, recoveries: 0, escalations: 0 }, actualAgentLaunches: 2, agentLaunchesLowerBound: true, agentLaunches: [], observedDisqualifiers: [], reviewStatistics: { ...observedReview,
    sendBacks: { ...observedReview.sendBacks, human: { numerator: 1, eligibleEpisodes: 2, coverage: 1,
      rate: { state: 'measured', value: 0.5 } } } } } satisfies FlowMissionFacts;
  const projected = flowStatistics([measured, { ...measured, missionId: 'missing', actualAgentLaunches: null, observedDisqualifiers: null, reviewStatistics: reviewStatistics(null) }], weeklyDecisionWindows('2026-11-03', 'UTC')).current;
  assert.deepEqual(projected.extraAgentLaunches, { total: 1, meanPerMission: 1, n: 1, lowerBound: true, reworkJobs: 1, reworkMeanPerMission: 1, reworkN: 1 });
  assert.deepEqual(projected.sendBacks.human, { numerator: 1, denominator: 2, observed: 1, population: 2,
    coverage: 0.5, state: 'measured', value: 0.5 });
});
