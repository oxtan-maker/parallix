import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LOW_SAMPLE_THRESHOLD,
  UNASSIGNED_COHORT,
  compareCohorts,
  groupIntoCohorts,
  percentile75,
  type CohortMetrics,
} from '../src/application/projections/cohorts.js';
import type { MissionTransition } from '../src/domain/mission-workflow.js';
import { missionId, missionLabels, type MissionId } from '../src/domain/mission.js';
import { agentFamily } from '../src/domain/agents.js';
import type { AgentRunMeasurement, MissionOutcome } from '../src/domain/usage.js';
import { missionOutcome } from './fixtures/mission-outcome.js';

// ---------------------------------------------------------------------------
// task-2347.09 SC3 — cohort comparison over two label groups
//
// Eight completed missions: five labelled `ai_sdlc`, three labelled
// `user_value`. Every figure asserted below is hand-computed from the seed
// table in `SEEDS`, so a formula change has to restate the arithmetic rather
// than re-record whatever the code produced.
// ---------------------------------------------------------------------------

interface Seed {
  readonly slug: string;
  readonly label: string;
  readonly cycleTimeMinutes: number;
  /** Consecutive stays in `active`; more than one means the mission bounced. */
  readonly activeSegments: readonly number[];
  readonly reviewSegments: readonly number[];
  readonly reviewFixRounds: number;
  readonly tokens: number | null;
  readonly costUsd: number;
  readonly runtimeMinutes: number;
  readonly netEngineeringLines: number;
}

const SEEDS: readonly Seed[] = [
  // ai_sdlc — active dwell 10/20/30/40/50, review dwell 5/15/25/35/45
  { slug: 'task-0001', label: 'ai_sdlc', cycleTimeMinutes: 100, activeSegments: [6, 4], reviewSegments: [3, 2], reviewFixRounds: 1, tokens: 1000, costUsd: 1, runtimeMinutes: 10, netEngineeringLines: 10 },
  { slug: 'task-0002', label: 'ai_sdlc', cycleTimeMinutes: 200, activeSegments: [12, 8], reviewSegments: [10, 5], reviewFixRounds: 1, tokens: 2000, costUsd: 2, runtimeMinutes: 20, netEngineeringLines: 20 },
  { slug: 'task-0003', label: 'ai_sdlc', cycleTimeMinutes: 300, activeSegments: [30], reviewSegments: [25], reviewFixRounds: 0, tokens: 3000, costUsd: 3, runtimeMinutes: 30, netEngineeringLines: 30 },
  { slug: 'task-0004', label: 'ai_sdlc', cycleTimeMinutes: 400, activeSegments: [40], reviewSegments: [35], reviewFixRounds: 0, tokens: 4000, costUsd: 4, runtimeMinutes: 40, netEngineeringLines: 40 },
  { slug: 'task-0005', label: 'ai_sdlc', cycleTimeMinutes: 500, activeSegments: [50], reviewSegments: [45], reviewFixRounds: 0, tokens: 5000, costUsd: 5, runtimeMinutes: 50, netEngineeringLines: 50 },
  // user_value — one mission never reported its tokens
  { slug: 'task-0006', label: 'user_value', cycleTimeMinutes: 60, activeSegments: [100], reviewSegments: [60], reviewFixRounds: 2, tokens: 100, costUsd: 0.5, runtimeMinutes: 5, netEngineeringLines: 100 },
  { slug: 'task-0007', label: 'user_value', cycleTimeMinutes: 120, activeSegments: [200], reviewSegments: [70], reviewFixRounds: 2, tokens: null, costUsd: 1.5, runtimeMinutes: 10, netEngineeringLines: 200 },
  { slug: 'task-0008', label: 'user_value', cycleTimeMinutes: 900, activeSegments: [300], reviewSegments: [80], reviewFixRounds: 2, tokens: 300, costUsd: 2.5, runtimeMinutes: 15, netEngineeringLines: 300 },
];

const EPOCH = Date.parse('2026-08-01T00:00:00Z');

function at(minutes: number): string {
  return new Date(EPOCH + minutes * 60_000).toISOString();
}

/**
 * Replay one mission through the board: it enters `active`, alternates into
 * `review` once per segment pair, and closes. A second active segment is
 * reached only through a `review → active` transition, so the seed's segment
 * count is also its bounce count plus one.
 */
function transitionsFor(seed: Seed): readonly MissionTransition[] {
  const id = missionId(seed.slug);
  const transitions: MissionTransition[] = [
    { missionId: id, from: 'backlog', to: 'active', trigger: 'activate', actor: 'codex', occurredAt: at(0) },
  ];
  let clock = 0;
  seed.activeSegments.forEach((activeMinutes, index) => {
    clock += activeMinutes;
    transitions.push({ missionId: id, from: 'active', to: 'review', trigger: 'submit-for-review', actor: 'codex', occurredAt: at(clock) });
    clock += seed.reviewSegments[index]!;
    const last = index === seed.activeSegments.length - 1;
    transitions.push(last
      ? { missionId: id, from: 'review', to: 'integration', trigger: 'approve', actor: 'codex', occurredAt: at(clock) }
      : { missionId: id, from: 'review', to: 'active', trigger: 'request-changes', actor: 'codex', occurredAt: at(clock) });
  });
  return transitions;
}

function run(minutes: number): AgentRunMeasurement {
  return {
    recordedOn: '2026-08-01',
    stage: 'execute',
    role: 'implementer',
    agent: agentFamily('codex'),
    runtime: { provider: { kind: 'measured', value: 'openai' }, model: { kind: 'measured', value: 'gpt-5' } },
    durationMinutes: { kind: 'measured', value: minutes },
    tokens: {
      input: { kind: 'measured', value: 0 },
      output: { kind: 'measured', value: 0 },
      cached: { kind: 'unavailable', reason: 'not sampled' },
      context: { kind: 'unavailable', reason: 'not sampled' },
    },
    toolCalls: { kind: 'measured', value: 1 },
    providerUsage: {
      beforePercent: { kind: 'unavailable', reason: 'not sampled' },
      afterPercent: { kind: 'unavailable', reason: 'not sampled' },
      deltaPercent: { kind: 'unavailable', reason: 'not sampled' },
    },
    costUsd: { kind: 'measured', value: 0 },
  };
}

function outcomeFor(seed: Seed): MissionOutcome {
  return missionOutcome({
    missionId: missionId(seed.slug),
    closedAt: at(seed.cycleTimeMinutes),
    cycleTimeMinutes: seed.cycleTimeMinutes,
    reviewFixRounds: seed.reviewFixRounds,
    labels: missionLabels([seed.label]),
    implementer: agentFamily('codex'),
    modelsInvolved: [{ recordedOn: '2026-08-01', stage: 'execute', role: 'implementer', agent: agentFamily('codex'), provider: 'openai', model: 'gpt-5' }],
    totalInputAndOutputTokens: seed.tokens,
    totalCostUsd: seed.costUsd,
    totalToolCalls: 1,
    runs: [run(seed.runtimeMinutes)],
  });
}

const OUTCOMES = SEEDS.map(outcomeFor);
const TRANSITIONS = SEEDS.flatMap(transitionsFor);
const NEL = new Map<MissionId, number | null>(
  SEEDS.map((seed) => [missionId(seed.slug), seed.netEngineeringLines]),
);

function labelComparison() {
  return compareCohorts({
    outcomes: OUTCOMES,
    transitions: TRANSITIONS,
    dimension: 'label',
    netEngineeringLines: NEL,
  });
}

function cohort(key: string): CohortMetrics {
  const found = labelComparison().cohorts.find((entry) => entry.key === key);
  assert.ok(found, `expected a cohort for ${key}`);
  return found;
}

test('SC3: the ai_sdlc cohort reports every figure with its sample size', () => {
  const metrics = cohort('ai_sdlc');
  assert.equal(metrics.n, 5, 'five seeded ai_sdlc missions');
  // Cycle times 100/200/300/400/500 — median 300, nearest-rank p75 index 4 → 400.
  assert.equal(metrics.medianCycleTimeMinutes, 300);
  assert.equal(metrics.p75CycleTimeMinutes, 400);
  // Active dwell 10/20/30/40/50 (bounced missions sum both stays) — median 30.
  assert.equal(metrics.medianActiveDwellMinutes, 30);
  // Review dwell 5/15/25/35/45 — median 25.
  assert.equal(metrics.medianReviewDwellMinutes, 25);
  // Two of five missions bounced once each.
  assert.equal(metrics.reviewBounceRate, 2 / 5);
  // Fix rounds 1/1/0/0/0 — median 0.
  assert.equal(metrics.medianReviewFixRounds, 0);
  // Tokens 1000..5000 — mean 3000. Cost 1..5 — mean 3. Runtime 10..50 — mean 30.
  assert.equal(metrics.tokensPerMission, 3000);
  assert.equal(metrics.costUsdPerMission, 3);
  assert.equal(metrics.agentRuntimeMinutesPerMission, 30);
  // NEL 10/20/30/40/50 — mean 30.
  assert.equal(metrics.netEngineeringLinesPerMission, 30);
});

test('SC3: the user_value cohort is computed from its own three missions', () => {
  const metrics = cohort('user_value');
  assert.equal(metrics.n, 3);
  // Cycle times 60/120/900 — median 120, nearest-rank p75 index 3 → 900.
  assert.equal(metrics.medianCycleTimeMinutes, 120);
  assert.equal(metrics.p75CycleTimeMinutes, 900);
  assert.equal(metrics.medianActiveDwellMinutes, 200);
  assert.equal(metrics.medianReviewDwellMinutes, 70);
  // All three entered review, none bounced: a measured zero, not "unknown".
  assert.equal(metrics.reviewBounceRate, 0);
  assert.equal(metrics.medianReviewFixRounds, 2);
  // task-0007 reported no tokens, so the mean is over the two that did: 200.
  assert.equal(metrics.tokensPerMission, 200);
  assert.equal(metrics.costUsdPerMission, 1.5);
  assert.equal(metrics.agentRuntimeMinutesPerMission, 10);
  assert.equal(metrics.netEngineeringLinesPerMission, 200);
});

test('SC3: the two label cohorts partition the eight seeded missions', () => {
  const comparison = labelComparison();
  assert.deepEqual(comparison.cohorts.map((entry) => entry.key), ['ai_sdlc', 'user_value']);
  assert.equal(comparison.cohorts.reduce((sum, entry) => sum + entry.n, 0), SEEDS.length);
  assert.equal(comparison.dimension, 'label');
  assert.equal(comparison.lowSampleThreshold, LOW_SAMPLE_THRESHOLD);
});

test('nearest-rank p75 returns an observed value, never an interpolated one', () => {
  assert.equal(percentile75([]), null);
  assert.equal(percentile75([7]), 7);
  assert.equal(percentile75([1, 2, 3, 4]), 3);
  assert.equal(percentile75([100, 200, 300, 400, 500]), 400);
});

test('a mission with two labels joins both cohorts instead of being dropped', () => {
  const both = missionOutcome({
    missionId: missionId('task-0009'),
    labels: missionLabels(['ai_sdlc', 'user_value']),
  });
  const groups = groupIntoCohorts([both], 'label');
  assert.deepEqual([...groups.keys()].sort(), ['ai_sdlc', 'user_value']);
});

test('a mission with no value for the dimension lands in the unassigned cohort', () => {
  const unlabelled = missionOutcome({ missionId: missionId('task-0010') });
  const groups = groupIntoCohorts([unlabelled], 'label');
  assert.deepEqual([...groups.keys()], [UNASSIGNED_COHORT]);
  const byImplementer = groupIntoCohorts([unlabelled], 'implementer');
  assert.deepEqual([...byImplementer.keys()], [UNASSIGNED_COHORT]);
});

test('cohorts can be grouped by model, provider, and closing date range', () => {
  const comparison = compareCohorts({ outcomes: OUTCOMES, transitions: TRANSITIONS, dimension: 'model' });
  assert.deepEqual(comparison.cohorts.map((entry) => [entry.key, entry.n]), [['gpt-5', 8]]);

  const byProvider = compareCohorts({ outcomes: OUTCOMES, transitions: TRANSITIONS, dimension: 'provider' });
  assert.deepEqual(byProvider.cohorts.map((entry) => [entry.key, entry.n]), [['openai', 8]]);

  // Missions close at their cycle-time offset from the epoch, so a window that
  // ends 150 minutes in collects the 100, 60 and 120-minute missions, and the
  // later window collects the remaining five.
  const byRange = compareCohorts({
    outcomes: OUTCOMES,
    transitions: TRANSITIONS,
    dimension: 'date-range',
    dateRanges: [
      { name: 'early', from: at(0), to: at(150) },
      { name: 'late', from: at(151), to: at(2000) },
    ],
  });
  assert.deepEqual(byRange.cohorts.map((entry) => [entry.key, entry.n]), [['late', 5], ['early', 3]]);
});
