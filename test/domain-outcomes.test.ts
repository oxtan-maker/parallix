import test from 'node:test';
import assert from 'node:assert/strict';

import { agentFamily } from '../src/domain/agents.js';
import { missionId, missionLabels, requireClosedMission, type ClosedMission } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import {
  AGENT_WORK_STAGE_BY_ACTIVITY,
  AGENT_WORK_STAGES,
  ATTRIBUTED_AGENT_WORK_STAGES,
  completedMissionStatistics,
  type AgentRunMeasurement,
  type Measurement,
  type MissionOutcome,
} from '../src/domain/usage.js';

const measured = <T>(value: T): Measurement<T> => ({ kind: 'measured', value });
const unavailable = <T>(reason: string): Measurement<T> => ({ kind: 'unavailable', reason });

function closedMission(overrides: Partial<Omit<ClosedMission, 'status' | 'closedAt'>> = {}) {
  return requireClosedMission({
    id: missionId('task-2294'),
    repositoryId: repositoryId('parallix'),
    title: 'Model the domain',
    labels: missionLabels(['ai_sdlc', 'bug']),
    status: 'done',
    closedAt: '2026-07-22T10:00:00Z',
    assignee: agentFamily('configured-implementer'),
    checkpoints: [],
    review: null,
    netEngineeringLines: 90,
    ...overrides,
  });
}

function run(overrides: Partial<AgentRunMeasurement> = {}): AgentRunMeasurement {
  return {
    recordedOn: '2026-07-22',
    stage: 'execute',
    role: 'implementer',
    agent: agentFamily('configured-implementer'),
    runtime: { provider: measured('configured-provider'), model: measured('configured-model') },
    durationMinutes: measured(10),
    tokens: { input: measured(100), output: measured(50), cached: measured(25), context: measured(150) },
    toolCalls: measured(4),
    providerUsage: {
      beforePercent: unavailable('not sampled'),
      afterPercent: measured(9),
      deltaPercent: unavailable('not sampled'),
    },
    costUsd: measured(1.5),
    ...overrides,
  };
}

function outcome(runs: readonly AgentRunMeasurement[]): MissionOutcome {
  return {
    missionId: missionId('task-2294'),
    repositoryId: repositoryId('parallix'),
    cycleTimeMinutes: 120,
    reviewFixRounds: 2,
    runs,
  };
}

test('completed mission statistics retain model involvement across stage and role', () => {
  const result = completedMissionStatistics(closedMission(), outcome([
    run(),
    run({
      stage: 'review',
      role: 'reviewer',
      agent: agentFamily('configured-reviewer'),
      runtime: { provider: measured('review-provider'), model: measured('review-model') },
      durationMinutes: measured(5),
      tokens: { input: measured(20), output: measured(10), cached: measured(5), context: measured(30) },
      costUsd: measured(0.5),
    }),
  ]));
  assert.equal(result.totalDurationMinutes, 15);
  assert.equal(result.totalInputAndOutputTokens, 180);
  assert.equal(result.totalCachedTokens, 30);
  assert.equal(result.totalContextTokens, 180);
  assert.equal(result.totalToolCalls, 8);
  assert.equal(result.totalCostUsd, 2);
  assert.equal(result.reviewFixRounds, 2);
  assert.equal(result.netEngineeringLines, 90);
  assert.equal(result.closedAt, '2026-07-22T10:00:00Z');
  assert.equal(result.implementer, 'configured-implementer');
  assert.deepEqual(result.labels, ['ai_sdlc', 'bug']);
  assert.deepEqual(result.modelsInvolved, [
    { recordedOn: '2026-07-22', stage: 'execute', role: 'implementer', agent: 'configured-implementer', provider: 'configured-provider', model: 'configured-model' },
    { recordedOn: '2026-07-22', stage: 'review', role: 'reviewer', agent: 'configured-reviewer', provider: 'review-provider', model: 'review-model' },
  ]);
});

test('missing provider telemetry stays unknown instead of becoming a dishonest zero', () => {
  const result = completedMissionStatistics(closedMission(), outcome([run({
    runtime: { provider: unavailable('provider not reported'), model: unavailable('model not reported') },
    tokens: { input: unavailable('provider does not report tokens'), output: measured(50), cached: measured(0), context: unavailable('not reported') },
  })]));
  assert.equal(result.totalInputAndOutputTokens, null);
  assert.equal(result.totalDurationMinutes, 10);
  assert.equal(result.modelsInvolved[0]?.provider, null);
  assert.equal(result.modelsInvolved[0]?.model, null);
});

test('a mission with no recorded runs reports unknown totals, not zero work', () => {
  const result = completedMissionStatistics(closedMission(), outcome([]));
  assert.equal(result.totalInputAndOutputTokens, null);
  assert.equal(result.totalDurationMinutes, null);
  assert.equal(result.totalCostUsd, null);
});

test('completed statistics reject mismatched identity and missing mission NEL', () => {
  assert.throws(
    () => completedMissionStatistics(closedMission(), { ...outcome([]), missionId: missionId('task-other') }),
    /identity does not match/,
  );
  assert.throws(() => completedMissionStatistics(closedMission({ netEngineeringLines: null }), outcome([])), /no NEL measurement/);
});

test('known token-using activities map to explicit work stages instead of default', () => {
  assert.deepEqual(AGENT_WORK_STAGES, [
    'draft',
    'execute',
    'review-preparation',
    'review',
    'review-response',
    'conflict-resolution',
    'integration-verification',
    'default',
  ]);
  const mappedStages = Object.values(AGENT_WORK_STAGE_BY_ACTIVITY);
  assert.equal((mappedStages as readonly string[]).includes('default'), false);
  assert.deepEqual(new Set(mappedStages), new Set(ATTRIBUTED_AGENT_WORK_STAGES));
  assert.equal(AGENT_WORK_STAGE_BY_ACTIVITY['handoff-repair'], 'review-preparation');
  assert.equal(AGENT_WORK_STAGE_BY_ACTIVITY['pre-review-gate-repair'], 'review-preparation');
  assert.equal(AGENT_WORK_STAGE_BY_ACTIVITY['static-review-repair'], 'review-preparation');
  assert.equal(AGENT_WORK_STAGE_BY_ACTIVITY['review-response'], 'review-response');
  assert.equal(AGENT_WORK_STAGE_BY_ACTIVITY['conflict-resolution'], 'conflict-resolution');
  assert.equal(AGENT_WORK_STAGE_BY_ACTIVITY['integration-verification'], 'integration-verification');
});
