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
  modelInvolvement,
  sumMeasured,
  totalInputAndOutputTokens,
  type AgentRunMeasurement,
  type Measurement,
  type MissionOutcome,
} from '../src/domain/usage.js';
import { missionOutcome } from './fixtures/mission-outcome.js';
import { laneEvent, metricsAdapter } from './fixtures/metrics-adapter.js';

const measured = <T>(value: T): Measurement<T> => ({ kind: 'measured', value });
const unavailable = <T>(reason: string): Measurement<T> => ({ kind: 'unavailable', reason });

function closedMission(overrides: Partial<Omit<ClosedMission, 'status' | 'closedAt'>> = {}) {
  return requireClosedMission({
    id: missionId('task-2294'),
    repositoryId: repositoryId('parallix'),
    title: 'Model the domain',
    labels: missionLabels(['ai_sdlc', 'bug']),
    status: 'done',
    rawStatus: 'done',
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
  return missionOutcome({
    missionId: missionId('task-2294'),
    repositoryId: repositoryId('parallix'),
    cycleTimeMinutes: 120,
    reviewFixRounds: 2,
    labels: missionLabels(['ai_sdlc']),
    implementer: agentFamily('configured-implementer'),
    modelsInvolved: modelInvolvement(runs),
    totalInputAndOutputTokens: totalInputAndOutputTokens(runs),
    totalCostUsd: sumMeasured(runs.map((entry) => entry.costUsd)),
    totalToolCalls: sumMeasured(runs.map((entry) => entry.toolCalls)),
    runs,
  });
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

// ---------------------------------------------------------------------------
// task-2347.09 SC1/SC2 — the cohort dimensions a comparison slices on
// ---------------------------------------------------------------------------

test('SC1: a constructed mission outcome carries every cohort dimension and total', () => {
  const constructed = outcome([run()]);
  for (const field of [
    'labels',
    'implementer',
    'modelsInvolved',
    'totalInputAndOutputTokens',
    'totalCostUsd',
    'totalToolCalls',
    'closedAt',
  ] as const) {
    assert.ok(field in constructed, `MissionOutcome must declare ${field}`);
    assert.notEqual(constructed[field], undefined, `MissionOutcome.${field} must be populated`);
  }
  assert.deepEqual(constructed.labels, missionLabels(['ai_sdlc']));
  assert.equal(constructed.implementer, agentFamily('configured-implementer'));
  assert.equal(constructed.totalInputAndOutputTokens, 150);
  assert.equal(constructed.totalCostUsd, 1.5);
  assert.equal(constructed.totalToolCalls, 4);
});

test('SC2: usageRecordsToOutcomes populates the cohort dimensions from usage and lane rows', async () => {
  const repo = repositoryId('parallix');
  const task = 'task-2347.09-dimensions';
  const outcomes = await metricsAdapter(
    repo,
    [
      laneEvent(repo, task, null, 'backlog', 'create', '2026-08-01T10:00:00Z'),
      laneEvent(repo, task, 'integration', 'done', 'integrate', '2026-08-02T12:00:00Z'),
    ],
    [
      {
        date: '2026-08-01',
        repo,
        mission: task,
        classification: 'user_value',
        implementer: 'codex',
        implementer_agent: 'codex',
        stage: 'execute',
        provider: 'openai',
        model: 'gpt-5',
        input_tokens: 1000,
        output_tokens: 200,
        tool_calls: 12,
        duration_minutes: 22,
        cost_usd: 0.5,
        closed: 'no',
      },
      {
        date: '2026-08-02',
        repo,
        mission: task,
        classification: 'user_value',
        implementer: 'codex',
        reviewer_agent: 'claude',
        stage: 'review',
        provider: 'anthropic',
        model: 'claude-opus-5',
        input_tokens: 800,
        output_tokens: 100,
        tool_calls: 5,
        duration_minutes: 15,
        cost_usd: 0.25,
        closed: 'yes',
      },
    ],
  ).readOutcomes();

  assert.equal(outcomes.length, 1);
  const projected = outcomes[0]!;
  assert.deepEqual(projected.labels, missionLabels(['user_value']));
  assert.equal(projected.implementer, agentFamily('codex'));
  assert.deepEqual(
    projected.modelsInvolved.map((involvement) => [involvement.role, involvement.provider, involvement.model]),
    [['implementer', 'openai', 'gpt-5'], ['reviewer', 'anthropic', 'claude-opus-5']],
  );
  // 1000 + 200 + 800 + 100 — cached and context tokens stay out of this total.
  assert.equal(projected.totalInputAndOutputTokens, 2100);
  assert.equal(projected.totalCostUsd, 0.75);
  assert.equal(projected.totalToolCalls, 17);
  assert.equal(projected.closedAt, '2026-08-02T12:00:00Z');
});

test('SC2: an unmeasured column leaves the affected total unavailable, not zero', async () => {
  const repo = repositoryId('parallix');
  const task = 'task-2347.09-partial';
  const outcomes = await metricsAdapter(
    repo,
    [laneEvent(repo, task, 'integration', 'done', 'integrate', '2026-08-02T12:00:00Z')],
    [
      { date: '2026-08-01', repo, mission: task, implementer_agent: 'codex', stage: 'execute', tool_calls: 3, cost_usd: 0.1, closed: 'no' },
      { date: '2026-08-02', repo, mission: task, implementer_agent: 'codex', stage: 'execute', input_tokens: 10, output_tokens: 5, cost_usd: 0.2, closed: 'yes' },
    ],
  ).readOutcomes();

  const projected = outcomes[0]!;
  assert.equal(projected.totalInputAndOutputTokens, null, 'a run without token columns must not report a partial total');
  assert.equal(projected.totalToolCalls, null);
  assert.ok(Math.abs((projected.totalCostUsd ?? 0) - 0.3) < 1e-9, 'cost sums across runs that do report it');
  assert.deepEqual(projected.labels, [], 'an unclassified mission carries no label rather than a guessed one');
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
