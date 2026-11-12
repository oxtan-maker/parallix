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
import { verificationStatistics } from '../../../../src/application/projections/verification-statistics.js';

function flowFact(overrides: Partial<FlowMissionFacts> & Pick<FlowMissionFacts, 'missionId' | 'reviewStatistics'>): FlowMissionFacts {
  return { repositoryId: 'repo', closedAt: '2026-11-03T12:00:00Z', implementer: 'codex',
    laneDwellMs: null, diagramNodeIds: [], diagramEdgeIds: [], ownership: [], window: null,
    gateRuns: [], rebaseRuns: [], rebaseStages: [
      { stage: 'direct-rebase', state: 'inapplicable', operationId: null, sourceId: null, reason: 'not requested', outcomes: [] },
      { stage: 'pre-review-rebase', state: 'inapplicable', operationId: null, sourceId: null, reason: 'not configured', outcomes: [] },
      { stage: 'integration-rebase', state: 'inapplicable', operationId: null, sourceId: null, reason: 'not configured', outcomes: [] },
    ], diagnostics: [], lead: { queued: 0, recoveries: 0, escalations: 0 },
    actualAgentLaunches: 1, agentLaunches: [], observedDisqualifiers: [], ...overrides };
}

test('rebase applicability starts at each stage-specific retained observation (PX-0055.03)', () => {
  const lifecycle = [
    { repositoryId: 'repo', missionId: 'in-transit', fromStatus: 'active', toStatus: 'review', trigger: 'begin-review-preparation', agent: 'codex', occurredAt: '2026-11-04T11:00:00Z', idempotencyKey: 'old-review' },
    { repositoryId: 'repo', missionId: 'in-transit', fromStatus: 'integration', toStatus: 'done', trigger: 'integrate', agent: 'codex', occurredAt: '2026-11-04T12:00:00Z', idempotencyKey: 'old-done' },
    { repositoryId: 'repo', missionId: 'fresh-mission', fromStatus: 'active', toStatus: 'review', trigger: 'begin-review-preparation', agent: 'codex', occurredAt: '2026-11-04T11:40:00Z', idempotencyKey: 'fresh-review' },
    { repositoryId: 'repo', missionId: 'fresh-mission', fromStatus: 'integration', toStatus: 'done', trigger: 'integrate', agent: 'codex', occurredAt: '2026-11-04T12:10:00Z', idempotencyKey: 'fresh-done' },
  ] as const;
  const rebases = [
    { id: 'earlier-skip', repositoryId: 'repo', missionId: 'observed', operationId: 'direct', generation: 1,
      sourceId: 'direct-source', stage: 'direct-rebase', attempt: 1, outcome: 'inapplicable', inapplicability: 'not-requested',
      revisionBefore: null, revisionAfter: null, conflicts: [], occurredAt: '2026-11-04T10:00:00Z' },
    { id: 'collector-proof', repositoryId: 'repo', missionId: 'observed', operationId: 'operation', generation: 1,
      sourceId: 'source', stage: 'pre-review-rebase', attempt: 1, outcome: 'no-op', revisionBefore: 'a', revisionAfter: 'a',
      conflicts: [], occurredAt: '2026-11-04T11:36:00Z' },
    { id: 'integration-collector-proof', repositoryId: 'repo', missionId: 'observed', operationId: 'integration-operation', generation: 1,
      sourceId: 'integration-source', stage: 'integration-rebase', attempt: 1, outcome: 'no-op', revisionBefore: 'a', revisionAfter: 'a',
      conflicts: [], occurredAt: '2026-11-04T12:05:00Z' },
  ] as const;
  const operation = (id: string, mission: string, command: 'review:submit' | 'integrate:merge', createdAt: string, updatedAt: string) => ({
    id, repositoryId: repositoryId('repo'), missionId: missionId(mission), requestKey: id, command, generation: 1, phase: 'completed' as const,
    providerStarted: command === 'review:submit', agent: 'codex', reviewer: 'claude',
    originalStatus: command === 'integrate:merge' ? 'integration' as const : 'active' as const,
    previousAssignee: 'codex', owner: null, createdAt, updatedAt, reason: null,
  });
  const operations = [
    operation('old-review', 'in-transit', 'review:submit', '2026-11-04T10:50:00Z', '2026-11-04T11:10:00Z'),
    operation('fresh-integrate', 'in-transit', 'integrate:merge', '2026-11-04T11:50:00Z', '2026-11-04T12:01:00Z'),
    operation('fresh-review', 'fresh-mission', 'review:submit', '2026-11-04T11:37:00Z', '2026-11-04T11:41:00Z'),
    operation('fresh-integrate-2', 'fresh-mission', 'integrate:merge', '2026-11-04T12:06:00Z', '2026-11-04T12:11:00Z'),
  ];
  const facts = observedFlowMissions({ repositoryId: 'repo', lifecycle, operations }, null, [], rebases);
  assert.deepEqual(facts.map(fact => [fact.missionId, fact.rebaseStages.map(stage => [stage.stage, stage.state])]), [
    ['in-transit', [['direct-rebase', 'inapplicable'], ['pre-review-rebase', 'historical-unavailable'], ['integration-rebase', 'historical-unavailable']]],
    ['fresh-mission', [['direct-rebase', 'inapplicable'], ['pre-review-rebase', 'absent'], ['integration-rebase', 'absent']]],
  ]);
  assert.deepEqual(observedFlowMissions({ repositoryId: 'repo', lifecycle, operations }, null, [], [], {
    'direct-rebase': rebases[0].occurredAt,
    'pre-review-rebase': rebases[1].occurredAt,
    'integration-rebase': rebases[2].occurredAt,
  })
    .map(fact => [fact.missionId, fact.rebaseStages]), facts.map(fact => [fact.missionId, fact.rebaseStages]),
  'mission filtering cannot erase the repository stage cutovers');
});

test('settled non-completing rebase workflow is interrupted rather than absent (PX-0055.03)', () => {
  const operation = { id: 'blocked-rebase', repositoryId: repositoryId('repo'), missionId: missionId('task-blocked'),
    requestKey: 'blocked-rebase', command: 'rebase:run' as const, generation: 1, phase: 'blocked' as const,
    providerStarted: true, agent: 'codex', reviewer: null, originalStatus: 'active' as const, previousAssignee: 'codex',
    owner: null, createdAt: '2026-11-04T11:40:00Z', updatedAt: '2026-11-04T11:41:00Z', reason: 'rebase failed' };
  const laterActive = { ...operation, id: 'later-active', requestKey: 'later-active', command: 'active:execute' as const,
    phase: 'completed' as const, createdAt: '2026-11-04T11:50:00Z', updatedAt: '2026-11-04T11:55:00Z', reason: null };
  const lifecycle = [{ repositoryId: 'repo', missionId: 'task-blocked', fromStatus: 'integration', toStatus: 'done',
    trigger: 'integrate', agent: 'codex', occurredAt: '2026-11-04T12:00:00Z', idempotencyKey: 'done' }] as const;
  const stage = observedFlowMissions({ repositoryId: 'repo', lifecycle, operations: [operation, laterActive] }, null, [], [],
    { 'direct-rebase': '2026-11-04T11:36:00Z' })[0]!.rebaseStages.find(value => value.stage === 'direct-rebase');
  assert.deepEqual(stage, { stage: 'direct-rebase', state: 'interrupted', operationId: 'blocked-rebase', sourceId: null,
    reason: 'owning workflow settled blocked without a retained terminal rebase outcome', outcomes: [] });
});

test('implementation work alone does not imply a missing direct rebase (PX-0055.03)', () => {
  const operation = { id: 'implementation', repositoryId: repositoryId('repo'), missionId: missionId('task-implemented'),
    requestKey: 'implementation', command: 'active:execute' as const, generation: 1, phase: 'completed' as const,
    providerStarted: true, agent: 'codex', reviewer: null, originalStatus: 'active' as const, previousAssignee: 'codex',
    owner: null, createdAt: '2026-11-04T11:40:00Z', updatedAt: '2026-11-04T11:50:00Z', reason: null };
  const lifecycle = [{ repositoryId: 'repo', missionId: 'task-implemented', fromStatus: 'integration', toStatus: 'done',
    trigger: 'integrate', agent: 'codex', occurredAt: '2026-11-04T12:00:00Z', idempotencyKey: 'done' }] as const;
  const stage = observedFlowMissions({ repositoryId: 'repo', lifecycle, operations: [operation] }, null, [], [],
    { 'direct-rebase': '2026-11-04T11:36:00Z' })[0]!.rebaseStages.find(value => value.stage === 'direct-rebase');
  assert.deepEqual(stage, { stage: 'direct-rebase', state: 'inapplicable', operationId: null, sourceId: null,
    reason: 'no direct rebase workflow was requested', outcomes: [] });
});

test('rejected stage evidence still establishes its collection cutover (PX-0055.03)', () => {
  const operation = { id: 'direct-owner', repositoryId: repositoryId('repo'), missionId: missionId('px-1'),
    requestKey: 'direct-owner', command: 'rebase:run' as const, generation: 1, phase: 'blocked' as const,
    providerStarted: true, agent: 'codex', reviewer: null, originalStatus: 'active' as const, previousAssignee: 'codex',
    owner: null, createdAt: '2026-11-04T11:10:00Z', updatedAt: '2026-11-04T11:20:00Z', reason: 'rebase interrupted' };
  const rejectedAt = '2026-11-04T11:05:00Z';
  const rejected = { eventType: 'flow.rebase', createdAt: rejectedAt, eventData: JSON.stringify({
    id: 'rejected-direct', repositoryId: 'repo', missionId: 'px-1', operationId: 'missing-operation', generation: 1,
    sourceId: 'rejected-source', stage: 'direct-rebase', attempt: 1, outcome: 'no-op', revisionBefore: 'a',
    revisionAfter: 'a', conflicts: [], occurredAt: rejectedAt,
  }) };
  const report = verificationStatistics({ repositoryId: 'repo', operations: [operation], history: [rejected], lifecycle: [
    { repositoryId: 'repo', missionId: 'px-1', fromStatus: 'integration', toStatus: 'done',
      occurredAt: '2026-11-04T11:30:00Z', trigger: 'land', agent: 'codex', idempotencyKey: 'done' },
  ] });
  assert.deepEqual(report.flowMissions[0]?.rebaseStages.find(stage => stage.stage === 'direct-rebase'), {
    stage: 'direct-rebase', state: 'interrupted', operationId: 'direct-owner', sourceId: null,
    reason: 'owning workflow settled blocked without a retained terminal rebase outcome', outcomes: [],
  });
  assert.ok(report.flowMissions[0]?.diagnostics.some(diagnostic => diagnostic.sourceId === 'rejected-source'));
});

test('rebase evidence survives a later workflow generation and reports the superseded activation (PX-0055.03 review F2)', () => {
  const operation = { id: 'advanced-operation', repositoryId: repositoryId('repo'), missionId: missionId('task-advanced'),
    requestKey: 'advanced-operation', command: 'active:execute' as const, generation: 2, phase: 'stopped' as const,
    providerStarted: true, agent: 'codex', reviewer: null, originalStatus: 'active' as const, previousAssignee: 'codex',
    owner: null, createdAt: '2026-11-03T15:20:00Z', updatedAt: '2026-11-03T15:30:00Z', reason: 'Stopped by operator' };
  const observation = (outcome: 'running' | 'conflict', at: string) => ({ eventType: 'flow.rebase', createdAt: at,
    eventData: JSON.stringify({ id: 'generation-one-rebase', repositoryId: 'repo', missionId: 'task-advanced',
      operationId: operation.id, generation: 1, sourceId: 'generation-one-source', stage: 'direct-rebase', attempt: 1,
      outcome, revisionBefore: 'before', revisionAfter: null, conflicts: outcome === 'conflict' ? ['shared.ts'] : [], occurredAt: at }) });
  const report = verificationStatistics({ repositoryId: 'repo', operations: [operation], history: [
    observation('running', '2026-11-03T15:24:43.901Z'), observation('conflict', '2026-11-03T15:24:44.070Z'),
  ], lifecycle: [{ repositoryId: 'repo', missionId: 'task-advanced', fromStatus: 'integration', toStatus: 'done',
    occurredAt: '2026-11-03T16:00:00Z', trigger: 'land', agent: 'codex', idempotencyKey: 'done' }] });
  assert.deepEqual(report.rebases.map(row => [row.generation, row.outcome]), [[1, 'running'], [1, 'conflict']]);
  assert.deepEqual(report.flowMissions[0]?.rebaseStages.find(stage => stage.stage === 'direct-rebase'), {
    stage: 'direct-rebase', state: 'interrupted', operationId: operation.id, sourceId: 'generation-one-source',
    reason: 'retained non-terminal rebase observation belongs to a superseded workflow generation', outcomes: ['conflict'],
  });
  assert.equal(report.flowMissions[0]?.diagnostics.some(diagnostic => diagnostic.message.includes('Rebase workflow join missing')), false);
});

test('rejected direct-rebase evidence cannot claim that no workflow was requested (PX-0055.03 review F1)', () => {
  const occurredAt = '2026-11-03T15:24:43.901Z';
  const report = verificationStatistics({ repositoryId: 'repo', operations: [], history: [{ eventType: 'flow.rebase', createdAt: occurredAt,
    eventData: JSON.stringify({ id: 'orphaned-rebase', repositoryId: 'repo', missionId: 'task-orphaned',
      operationId: 'missing-operation', generation: 1, sourceId: 'orphaned-source', stage: 'direct-rebase', attempt: 1,
      outcome: 'running', revisionBefore: 'before', revisionAfter: null, conflicts: [], occurredAt }) }], lifecycle: [
    { repositoryId: 'repo', missionId: 'task-orphaned', fromStatus: 'integration', toStatus: 'done', occurredAt,
      trigger: 'land', agent: 'codex', idempotencyKey: 'done' },
  ] });
  assert.deepEqual(report.flowMissions[0]?.rebaseStages.find(stage => stage.stage === 'direct-rebase'), {
    stage: 'direct-rebase', state: 'absent', operationId: 'missing-operation', sourceId: 'orphaned-source',
    reason: 'retained rebase evidence has no matching workflow identity', outcomes: [],
  });
  assert.ok(report.flowMissions[0]?.diagnostics.some(diagnostic => diagnostic.sourceId === 'orphaned-source'));
});

test('a conflict-only rebase is interrupted and retains the conflict sequence (PX-0055.03)', () => {
  const operation = { id: 'conflicted-rebase', repositoryId: repositoryId('repo'), missionId: missionId('task-conflicted'),
    requestKey: 'conflicted-rebase', command: 'rebase:run' as const, generation: 1, phase: 'interrupted' as const,
    providerStarted: true, agent: 'codex', reviewer: null, originalStatus: 'active' as const, previousAssignee: 'codex',
    owner: null, createdAt: '2026-11-04T11:40:00Z', updatedAt: '2026-11-04T11:41:00Z', reason: 'resolution interrupted' };
  const lifecycle = [{ repositoryId: 'repo', missionId: 'task-conflicted', fromStatus: 'integration', toStatus: 'done',
    trigger: 'integrate', agent: 'codex', occurredAt: '2026-11-04T12:00:00Z', idempotencyKey: 'done' }] as const;
  const conflicts = [{ id: 'conflict-run', repositoryId: 'repo', missionId: 'task-conflicted', operationId: 'conflicted-rebase',
    generation: 1, sourceId: 'conflict-source', stage: 'direct-rebase', attempt: 1, outcome: 'conflict',
    revisionBefore: 'a', revisionAfter: null, conflicts: ['shared.ts'], occurredAt: '2026-11-04T11:40:30Z' }] as const;
  const mission = observedFlowMissions({ repositoryId: 'repo', lifecycle, operations: [operation] }, null, [], conflicts)[0]!;
  assert.deepEqual(mission.rebaseRuns, [{ id: 'conflict-run', operationId: 'conflicted-rebase',
    stage: 'direct-rebase', outcomes: ['conflict'] }]);
  assert.deepEqual(mission.rebaseStages.find(value => value.stage === 'direct-rebase'), {
    stage: 'direct-rebase', state: 'interrupted', operationId: 'conflicted-rebase', sourceId: 'conflict-source',
    reason: 'owning workflow settled interrupted without a retained terminal rebase outcome', outcomes: ['conflict'],
  });
});

test('a later measured rebase outcome supersedes an earlier inapplicable publication (PX-0055.03)', () => {
  const operation = { id: 'direct-rebase', repositoryId: repositoryId('repo'), missionId: missionId('task-rebased'),
    requestKey: 'direct-rebase', command: 'rebase:run' as const, generation: 1, phase: 'completed' as const,
    providerStarted: true, agent: 'codex', reviewer: null, originalStatus: 'active' as const, previousAssignee: 'codex',
    owner: null, createdAt: '2026-11-04T11:00:00Z', updatedAt: '2026-11-04T11:02:00Z', reason: null };
  const lifecycle = [{ repositoryId: 'repo', missionId: 'task-rebased', fromStatus: 'integration', toStatus: 'done',
    trigger: 'integrate', agent: 'codex', occurredAt: '2026-11-04T12:00:00Z', idempotencyKey: 'done' }] as const;
  const rebases = [
    { id: 'skip', repositoryId: 'repo', missionId: 'task-rebased', operationId: 'direct-rebase', generation: 1,
      sourceId: 'skip', stage: 'direct-rebase', attempt: 1, outcome: 'inapplicable', inapplicability: 'not-needed',
      revisionBefore: null, revisionAfter: null, conflicts: [], occurredAt: '2026-11-04T11:00:30Z' },
    { id: 'run', repositoryId: 'repo', missionId: 'task-rebased', operationId: 'direct-rebase', generation: 1,
      sourceId: 'run', stage: 'direct-rebase', attempt: 1, outcome: 'no-op', revisionBefore: 'a', revisionAfter: 'a',
      conflicts: [], occurredAt: '2026-11-04T11:01:00Z' },
  ] as const;
  const stage = observedFlowMissions({ repositoryId: 'repo', lifecycle, operations: [operation] }, null, [], rebases)[0]!
    .rebaseStages.find(value => value.stage === 'direct-rebase');
  assert.deepEqual(stage, { stage: 'direct-rebase', state: 'measured', operationId: 'direct-rebase', sourceId: 'run',
    reason: 'retained terminal rebase outcome', outcomes: ['no-op'] });
});

test('missing applicable rebase observations are diagnostics rather than observed zeroes (TASK-2836)', () => {
  const fact = flowFact({ missionId: 'task-missing-integration-rebase',
    window: { startedAt: '2026-11-03T11:00:00Z', finishedAt: '2026-11-03T12:00:00Z' },
    gateRuns: [], rebaseRuns: [{ id: 'pre', operationId: 'pre', stage: 'pre-review-rebase', outcomes: ['no-op'] }],
    rebaseStages: [
      { stage: 'direct-rebase', state: 'inapplicable', operationId: null, sourceId: null, reason: 'not requested', outcomes: [] },
      { stage: 'pre-review-rebase', state: 'measured', operationId: 'pre', sourceId: 'pre', reason: 'terminal outcome', outcomes: ['no-op'] },
      { stage: 'integration-rebase', state: 'absent', operationId: 'integration', sourceId: null, reason: 'missing', outcomes: [] },
    ],
    lead: { queued: 0, recoveries: 0, escalations: 0 }, actualAgentLaunches: 1,
    agentLaunches: [{ runId: 'run', startedAt: '2026-11-03T11:00:00Z', family: 'codex', model: 'gpt-6.1-sol' }],
    observedDisqualifiers: [], reviewStatistics: reviewStatisticsObservation('codex', 0),
    diagnostics: [{ kind: 'identity', state: 'absent', repositoryId: 'repo', missionId: 'task-missing-integration-rebase',
      operationId: null, sourceId: null, stage: 'workflow-operation',
      message: '1 unreadable workflow operation row excluded from FLOW statistics', recovery: 'inspect retained workflow operation rows' }],
    ownership: [{ step: 'implement', actor: 'codex', model: 'gpt-6.1-sol', state: 'working', durationMs: 3_600_000 }] });
  const result = flowStatistics([fact], weeklyDecisionWindows('2026-11-03', 'UTC')).current;
  assert.deepEqual(result.graph.nodes.find(node => node.id === 'integration-rebase'),
    { id: 'integration-rebase', lane: 'parallix', count: 0, rework: null, observedMissions: 0, population: 1 });
  assert.equal(result.observation.complete, 0);
  assert.ok(result.defects.includes('1 unreadable workflow operation row excluded from FLOW statistics; inspect retained workflow operation rows'));
  assert.deepEqual(result.rebaseStages.visible.filter(stage => stage.state === 'absent')
    .map(stage => stage.stage), ['integration-rebase']);
});

test('rejected rebase evidence remains a named FLOW diagnostic instead of reading as missing evidence (PX-0055.03)', () => {
  const fact = flowFact({ missionId: 'rejected-integration-rebase', reviewStatistics: reviewStatisticsObservation('codex', 0),
    rebaseStages: [
      { stage: 'direct-rebase', state: 'inapplicable', operationId: null, sourceId: null, reason: 'not requested', outcomes: [] },
      { stage: 'pre-review-rebase', state: 'inapplicable', operationId: null, sourceId: null, reason: 'not configured', outcomes: [] },
      { stage: 'integration-rebase', state: 'absent', operationId: 'integrate', sourceId: null,
        reason: 'no accepted terminal observation', outcomes: [] },
    ], diagnostics: [{ kind: 'identity', state: 'absent', repositoryId: 'repo', missionId: 'rejected-integration-rebase',
      operationId: 'integrate', sourceId: 'src-rejected', stage: 'integration-rebase',
      message: 'Rebase workflow join missing for rejected-integration-rebase source src-rejected',
      recovery: 'inspect retained workflow operation identity' }] });

  const result = flowStatistics([fact], weeklyDecisionWindows('2026-11-03', 'UTC')).current;
  assert.deepEqual(result.defects.filter(defect => defect.includes('Rebase workflow join missing')), [
    'Rebase workflow join missing for rejected-integration-rebase source src-rejected (operation=integrate, source=src-rejected); inspect retained workflow operation identity',
  ]);
  assert.equal(result.defects.some(defect => defect.includes('Integration rebase observations missing')), false,
    'the stage list owns missing-state presentation; retained rejected evidence keeps its identity diagnostic');
  assert.deepEqual(result.observation, { complete: 0, partial: 1, unobserved: 0 });
});

test('FLOW completeness includes applicable rebases and unplaced return provenance (PX-0055.03)', () => {
  const unplacedReturn = reviewStatistics(null, { equivalentSubmissions: {}, workflowReturns: [{
    identity: 'judgment:unplaced', author: 'codex', at: '2026-11-03T11:30:00Z', source: 'judgment',
  }] });
  const fact = flowFact({ missionId: 'elapsed-only-complete',
    window: { startedAt: '2026-11-03T11:00:00Z', finishedAt: '2026-11-03T12:00:00Z' },
    ownership: [{ step: 'implement', actor: 'codex', model: 'gpt-6.1-sol', state: 'working', durationMs: 3_600_000 }],
    rebaseStages: [
      { stage: 'direct-rebase', state: 'inapplicable', operationId: null, sourceId: null, reason: 'not requested', outcomes: [] },
      { stage: 'pre-review-rebase', state: 'absent', operationId: 'review', sourceId: null, reason: 'missing', outcomes: [] },
      { stage: 'integration-rebase', state: 'absent', operationId: 'integrate', sourceId: null, reason: 'missing', outcomes: [] },
    ], reviewStatistics: unplacedReturn });

  const result = flowStatistics([fact], weeklyDecisionWindows('2026-11-03', 'UTC')).current;
  assert.deepEqual(result.observation, { complete: 0, partial: 1, unobserved: 0 },
    'the existing observation summary includes every applicable FLOW fact');
  assert.deepEqual(result.rebaseStages.visible.filter(stage => stage.state === 'absent')
    .map(stage => stage.stage), ['integration-rebase', 'pre-review-rebase']);
  assert.ok(result.defects.includes('Return judgment:unplaced has unplaced provenance for repo/elapsed-only-complete; inspect retained return producer context'));
  assert.equal(result.defects.filter(defect => defect.includes('unplaced provenance')).length, 1,
    'one unplaced return has one diagnostic');
});

test('placed workflow returns do not manufacture FLOW diagnostics (PX-0055.03)', () => {
  const placedReturn = reviewStatistics(null, { equivalentSubmissions: {}, workflowReturns: [{
    identity: 'repair:placed', author: 'codex', at: '2026-11-03T11:30:00Z', source: 'repair',
  }] });
  const fact = flowFact({ missionId: 'placed-return', reviewStatistics: placedReturn,
    ownership: [{ step: 'implement', actor: 'codex', model: 'gpt-6.1-sol', state: 'working', durationMs: 1 }] });
  const result = flowStatistics([fact], weeklyDecisionWindows('2026-11-03', 'UTC')).current;
  assert.deepEqual(result.observation, { complete: 1, partial: 0, unobserved: 0 });
  assert.equal(result.defects.some(defect => defect.includes('unplaced provenance')), false);
});

test('model identity has one run-diagnostic owner and is not re-derived from launches (PX-0055.03)', () => {
  const modelDefect = { kind: 'model', state: 'absent', repositoryId: 'repo', missionId: 'one-model-defect',
    operationId: null, sourceId: 'run-missing-model', stage: 'agent-run',
    message: 'Concrete model identity missing for repo/one-model-defect run run-missing-model',
    recovery: 'inspect retained run history' } as const;
  const fact = flowFact({ missionId: 'one-model-defect', reviewStatistics: reviewStatisticsObservation('codex', 0),
    ownership: [{ step: 'implement', actor: 'codex', model: null, state: 'working', durationMs: 1 }],
    agentLaunches: [{ runId: 'run-missing-model', startedAt: '2026-11-03T11:00:00Z', family: 'codex', model: null }],
    diagnostics: [modelDefect] });
  const defects = flowStatistics([fact], weeklyDecisionWindows('2026-11-03', 'UTC')).current.defects;
  assert.deepEqual(defects.filter(defect => defect.includes('Concrete model identity missing')), [
    'Concrete model identity missing for repo/one-model-defect run run-missing-model (source=run-missing-model); inspect retained run history',
  ]);
});

test('rebase completeness distinguishes observed zero, running, interrupted and inapplicable stages (PX-0055.03)', () => {
  const fact = flowFact({ missionId: 'typed-rebase-states', reviewStatistics: reviewStatisticsObservation('codex', 0),
    rebaseStages: [
      { stage: 'direct-rebase', state: 'measured', operationId: 'direct', sourceId: 'direct-source',
        reason: 'retained terminal rebase outcome', outcomes: ['no-op'] },
      { stage: 'pre-review-rebase', state: 'running', operationId: 'review', sourceId: 'review-source',
        reason: 'owning workflow is still running', outcomes: [] },
      { stage: 'integration-rebase', state: 'interrupted', operationId: 'integrate', sourceId: 'integrate-source',
        reason: 'running observation has no retained terminal outcome', outcomes: [] },
    ] });
  const result = flowStatistics([fact], weeklyDecisionWindows('2026-11-03', 'UTC')).current;
  assert.deepEqual(result.rebaseStages.visible.map(({ stage, state, outcomes }) => ({ stage, state, outcomes })), [
    { stage: 'integration-rebase', state: 'interrupted', outcomes: [] },
    { stage: 'pre-review-rebase', state: 'running', outcomes: [] },
    { stage: 'direct-rebase', state: 'measured', outcomes: ['no-op'] },
  ]);
  assert.deepEqual(result.observation, { complete: 0, partial: 1, unobserved: 0 });
});

test('all eligible stage owners retain per-operation rebase coverage (PX-0055.03 review F10)', () => {
  const operation = (id: string, createdAt: string, updatedAt: string) => ({
    id, repositoryId: repositoryId('repo'), missionId: missionId('task-returned'), requestKey: id,
    command: 'review:submit' as const, generation: 1, phase: 'completed' as const, providerStarted: true,
    agent: 'codex', reviewer: 'claude', originalStatus: 'active' as const, previousAssignee: 'codex', owner: null,
    createdAt, updatedAt, reason: null,
  });
  const operations = [
    operation('first-review', '2026-11-04T11:00:00Z', '2026-11-04T11:10:00Z'),
    operation('second-review', '2026-11-04T11:20:00Z', '2026-11-04T11:30:00Z'),
    operation('third-review', '2026-11-04T11:40:00Z', '2026-11-04T11:50:00Z'),
  ];
  const lifecycle = [
    { repositoryId: 'repo', missionId: 'task-returned', fromStatus: 'active', toStatus: 'review',
      trigger: 'begin-review-preparation', agent: 'codex', occurredAt: '2026-11-04T11:05:00Z', idempotencyKey: 'first' },
    { repositoryId: 'repo', missionId: 'task-returned', fromStatus: 'active', toStatus: 'review',
      trigger: 'begin-review-preparation', agent: 'codex', occurredAt: '2026-11-04T11:25:00Z', idempotencyKey: 'second' },
    { repositoryId: 'repo', missionId: 'task-returned', fromStatus: 'integration', toStatus: 'done',
      trigger: 'integrate', agent: 'codex', occurredAt: '2026-11-04T12:00:00Z', idempotencyKey: 'done' },
  ] as const;
  const rebases = [{ id: 'third-rebase', repositoryId: 'repo', missionId: 'task-returned',
    operationId: 'third-review', generation: 1, sourceId: 'third-source', stage: 'pre-review-rebase', attempt: 1,
    outcome: 'no-op', revisionBefore: 'a', revisionAfter: 'a', conflicts: [], occurredAt: '2026-11-04T11:44:00Z' }] as const;
  const mission = observedFlowMissions({ repositoryId: 'repo', lifecycle, operations }, null, [], rebases,
    { 'pre-review-rebase': '2026-11-04T10:00:00Z' })[0]!;
  assert.deepEqual(mission.rebaseStages.filter(stage => stage.stage === 'pre-review-rebase')
    .map(({ operationId, state }) => ({ operationId, state })), [
    { operationId: 'first-review', state: 'absent' },
    { operationId: 'second-review', state: 'absent' },
    { operationId: 'third-review', state: 'measured' },
  ]);
  assert.deepEqual(flowStatistics([flowFact({ missionId: mission.missionId,
    reviewStatistics: reviewStatisticsObservation('codex', 0), rebaseStages: mission.rebaseStages })],
  weeklyDecisionWindows('2026-11-03', 'UTC')).current.observation, { complete: 0, partial: 1, unobserved: 0 });
});

test('short-circuited stage owners do not manufacture missing rebase evidence (PX-0055.03 review F9)', () => {
  const operations = ['active', 'review'].map((originalStatus, index) => ({
    id: `short-circuit-${originalStatus}`, repositoryId: repositoryId('repo'), missionId: missionId('task-short-circuit'),
    requestKey: `short-circuit-${originalStatus}`, command: 'review:submit' as const, generation: 1,
    phase: 'completed' as const, providerStarted: false, agent: null, reviewer: null,
    originalStatus: originalStatus as 'active' | 'review', previousAssignee: 'codex', owner: null,
    createdAt: `2026-11-04T11:${index}0:00Z`, updatedAt: `2026-11-04T11:${index}1:00Z`, reason: null,
  }));
  const lifecycle = [{ repositoryId: 'repo', missionId: 'task-short-circuit', fromStatus: 'integration', toStatus: 'done',
    trigger: 'integrate', agent: 'codex', occurredAt: '2026-11-04T12:00:00Z', idempotencyKey: 'done' }] as const;
  const mission = observedFlowMissions({ repositoryId: 'repo', lifecycle, operations }, null, [], [],
    { 'pre-review-rebase': '2026-11-04T10:00:00Z' })[0]!;
  assert.deepEqual(mission.rebaseStages.filter(stage => stage.stage === 'pre-review-rebase'), [{
    stage: 'pre-review-rebase', state: 'historical-unavailable', operationId: null, sourceId: null,
    reason: 'owning workflow identity is not retained', outcomes: [],
  }]);
});

test('completed active and review integrations retain missing rebase provenance (PX-0055.03 review F11)', () => {
  const operations = ['active', 'review'].map((originalStatus, index) => ({
    id: `integrate-from-${originalStatus}`, repositoryId: repositoryId('repo'), missionId: missionId('task-integrate'),
    requestKey: `integrate-from-${originalStatus}`, command: 'integrate:merge' as const, generation: 1,
    phase: 'completed' as const, providerStarted: false, agent: 'codex', reviewer: null,
    originalStatus: originalStatus as 'active' | 'review', previousAssignee: 'codex', owner: null,
    createdAt: `2026-11-04T11:${index}0:00Z`, updatedAt: `2026-11-04T11:${index}5:00Z`, reason: null,
  }));
  const lifecycle = [{ repositoryId: 'repo', missionId: 'task-integrate', fromStatus: 'integration', toStatus: 'done',
    trigger: 'integrate', agent: 'codex', occurredAt: '2026-11-04T12:00:00Z', idempotencyKey: 'done' }] as const;
  const mission = observedFlowMissions({ repositoryId: 'repo', lifecycle, operations }, null, [], [],
    { 'integration-rebase': '2026-11-04T10:00:00Z' })[0]!;
  assert.deepEqual(mission.rebaseStages.filter(stage => stage.stage === 'integration-rebase')
    .map(({ operationId, state }) => ({ operationId, state })), [
    { operationId: 'integrate-from-active', state: 'absent' },
    { operationId: 'integrate-from-review', state: 'absent' },
  ]);
});

test('a later stage-owning workflow retains its missing rebase evidence (PX-0055.03 review F7)', () => {
  const operation = (id: string, createdAt: string, updatedAt: string) => ({
    id, repositoryId: repositoryId('repo'), missionId: missionId('task-returned-again'), requestKey: id,
    command: 'review:submit' as const, generation: 1, phase: 'completed' as const, providerStarted: true,
    agent: 'codex', reviewer: 'claude', originalStatus: 'active' as const, previousAssignee: 'codex', owner: null,
    createdAt, updatedAt, reason: null,
  });
  const operations = [
    operation('first-review', '2026-11-04T11:00:00Z', '2026-11-04T11:10:00Z'),
    operation('second-review', '2026-11-04T11:20:00Z', '2026-11-04T11:30:00Z'),
  ];
  const lifecycle = [{ repositoryId: 'repo', missionId: 'task-returned-again', fromStatus: 'integration', toStatus: 'done',
    trigger: 'integrate', agent: 'codex', occurredAt: '2026-11-04T12:00:00Z', idempotencyKey: 'done' }] as const;
  const rebases = [{ id: 'first-rebase', repositoryId: 'repo', missionId: 'task-returned-again',
    operationId: 'first-review', generation: 1, sourceId: 'first-source', stage: 'pre-review-rebase', attempt: 1,
    outcome: 'no-op', revisionBefore: 'a', revisionAfter: 'a', conflicts: [], occurredAt: '2026-11-04T11:04:00Z' }] as const;
  const mission = observedFlowMissions({ repositoryId: 'repo', lifecycle, operations }, null, [], rebases,
    { 'pre-review-rebase': '2026-11-04T10:00:00Z' })[0]!;
  assert.deepEqual(mission.rebaseStages.filter(stage => stage.stage === 'pre-review-rebase')
    .map(({ operationId, state }) => ({ operationId, state })), [
    { operationId: 'first-review', state: 'measured' },
    { operationId: 'second-review', state: 'absent' },
  ]);
});

test('an observed rebase stage retains its authoritative workflow operation identity (PX-0055.03)', () => {
  const operation = { id: 'integration-repair-review', repositoryId: repositoryId('repo'), missionId: missionId('task-repair'),
    requestKey: 'integration-repair-review', command: 'review:submit' as const, generation: 1, phase: 'blocked' as const,
    providerStarted: true, agent: 'codex', reviewer: 'claude', originalStatus: 'review' as const,
    previousAssignee: 'codex', owner: null, createdAt: '2026-11-04T11:00:00Z', updatedAt: '2026-11-04T11:10:00Z', reason: null };
  const lifecycle = [{ repositoryId: 'repo', missionId: 'task-repair', fromStatus: 'integration', toStatus: 'done',
    trigger: 'integrate', agent: 'codex', occurredAt: '2026-11-04T12:00:00Z', idempotencyKey: 'done' }] as const;
  const rebases = [{ id: 'failed-integration', repositoryId: 'repo', missionId: 'task-repair',
    operationId: operation.id, generation: 1, sourceId: 'failed-source', stage: 'integration-rebase', attempt: 1,
    outcome: 'failed', revisionBefore: 'a', revisionAfter: null, conflicts: [], occurredAt: '2026-11-04T11:05:00Z' }] as const;
  const stage = observedFlowMissions({ repositoryId: 'repo', lifecycle, operations: [operation] }, null, [], rebases)[0]!
    .rebaseStages.find(value => value.stage === 'integration-rebase');
  assert.deepEqual(stage, { stage: 'integration-rebase', state: 'measured', operationId: operation.id,
    sourceId: 'failed-source', reason: 'retained terminal rebase outcome', outcomes: ['failed'] });
});

test('FLOW keeps measured subset values and excludes reused-only gate batches (TASK-2836)', () => {
  const lifecycle = [{ repositoryId: 'repo', missionId: 'px-1', fromStatus: 'backlog', toStatus: 'refined', occurredAt: '2026-11-03T10:00:00Z', trigger: 'refine', agent: 'human', idempotencyKey: 'r' },
    { repositoryId: 'repo', missionId: 'px-1', fromStatus: 'integration', toStatus: 'done', occurredAt: '2026-11-03T12:00:00Z', trigger: 'land', agent: 'codex', idempotencyKey: 'd' }];
  const reused = { id: 'reused', repositoryId: 'repo', missionId: 'px-1', operationId: null, revision: 'r', batchId: 'reuse', gate: 'unit', command: 'unit', phase: 'handoff', after: [], requestedAt: '2026-11-03T11:00:00Z', startedAt: null, finishedAt: '2026-11-03T11:00:01Z', result: 'reused', failureReason: null, exitCode: 0, wallMs: null, cpu: null, profile: null } satisfies VerificationMeasurement;
  assert.deepEqual(observedFlowMissions({ repositoryId: 'repo', lifecycle, operations: [] }, null, [reused], [])[0]?.gateRuns, []);
  const observedReview = reviewStatistics(null, { equivalentSubmissions: {}, workflowReturns: [{ identity: 'repair:1', author: 'codex', at: '2026-11-03T11:00:00Z', source: 'repair' }] });
  const measured = flowFact({ missionId: 'measured', actualAgentLaunches: 2, agentLaunchesLowerBound: true, reviewStatistics: { ...observedReview,
    sendBacks: { ...observedReview.sendBacks, human: { numerator: 1, eligibleEpisodes: 2, coverage: 1,
      rate: { state: 'measured', value: 0.5 } } } } });
  const projected = flowStatistics([measured, { ...measured, missionId: 'missing', actualAgentLaunches: null, observedDisqualifiers: null, reviewStatistics: reviewStatistics(null) }], weeklyDecisionWindows('2026-11-03', 'UTC')).current;
  assert.deepEqual(projected.extraAgentLaunches, { total: 1, meanPerMission: 1, n: 1, lowerBound: true, reworkJobs: 1, reworkMeanPerMission: 1, reworkN: 1 });
  assert.deepEqual(projected.sendBacks.human, { numerator: 1, denominator: 2, observed: 1, population: 2,
    coverage: 0.5, state: 'measured', value: 0.5 });
});

test('a legacy repair return stays placed at the declared gates it left (PX-0055.01)', async () => {
  const { workflowReturnsFromHistory } = await import('../../../../src/adapters/review/review-statistics-evidence.js');
  // A repair row recorded before return provenance existed: no stored stage, no operation identity.
  const returns = workflowReturnsFromHistory([], [{ occurrenceId: 'legacy', reasonKind: 'gate-failure',
    area: 'declared gate', agent: 'codex', headBefore: null, occurredAt: '2026-11-03T11:00:00Z' }]);
  const fact = flowFact({ missionId: 'legacy-repair',
    window: { startedAt: '2026-11-03T11:00:00Z', finishedAt: '2026-11-03T12:00:00Z' }, gateRuns: [], rebaseRuns: [],
    observedDisqualifiers: [], reviewStatistics: reviewStatistics(null, { equivalentSubmissions: {}, workflowReturns: returns }) });
  const edges = flowStatistics([fact], weeklyDecisionWindows('2026-11-03', 'UTC')).current.graph.edges;
  const count = (id: string) => edges.find(edge => edge.id === id)?.count;
  assert.deepEqual([count('declared-gates->implement:gate-failed'), count('unrecorded->implement:workflow-return')], [1, 0],
    'the retained coarse cause still names the gate lane, so the return is not an unplaced workflow return');
});

test('a pre-review rebase repair return is drawn exactly once (PX-0055.01)', () => {
  const observedReview = reviewStatistics(null, { equivalentSubmissions: {}, workflowReturns: [{
    identity: 'repair:rebase', author: 'codex', at: '2026-11-03T11:00:00Z', source: 'repair',
    origin: { actor: 'workflow', stage: 'pre-review-rebase', decisionIdentity: 'repair:rebase', revision: 'before-rebase',
      sender: 'codex', cause: 'rebase-repair' },
  }] });
  const fact = flowFact({ missionId: 'rebase-repair',
    window: { startedAt: '2026-11-03T11:00:00Z', finishedAt: '2026-11-03T12:00:00Z' }, gateRuns: [], rebaseRuns: [],
    observedDisqualifiers: [], reviewStatistics: observedReview });
  const graph = flowStatistics([fact], weeklyDecisionWindows('2026-11-03', 'UTC')).current.graph;
  const returnsToImplement = graph.edges.filter(edge => edge.to === 'implement' && edge.kind !== 'flow');
  assert.equal(graph.edges.find(edge => edge.id === 'pre-review-rebase->implement:workflow-return')?.count, 1);
  assert.equal(returnsToImplement.reduce((sum, edge) => sum + edge.count, 0), 1,
    'the typed return must leave its retained source once, without also becoming an unrecorded return');
});
