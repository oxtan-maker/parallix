import { reviewStatisticsObservation } from '../../../../fixtures/review-statistics.js';
// helpers. Imported via the `stats.js` re-export barrel (the production entry)
// so the leaf module's circular-import TDZ is avoided; coverage still lands on
// `stats-report-rendering.ts`. Pure functions only — in-memory StatsRow doubles,
// no DB, no git, no spawn.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as sr from '../../../../../src/adapters/cli/commands/stats.js';

function row(overrides: Record<string, unknown> = {}) {
  return {
    mission: 'task-1',
    implementer: 'codex',
    reviewer: 'claude',
    review_count: '2',
    isMerged: true,
    normalizedMerged: '2024-01-02',
    normalizedDate: '2024-01-01',
    date: '2024-01-15',
    classification: 'user_value',
    model: 'gpt-4',
    stage: 'active',
    pr_fix_rounds: '2',
    openai_usage_after: '10',
    cost_usd: '1.5',
    duration_minutes: '30',
    provider: 'openai',
    repo: 'acme/app',
    ...overrides,
  };
}

const WIN = { start: new Date('2024-01-01'), end: new Date('2024-01-31') };

test('formatAgentSpendCell handles empty total and usage/cost/duration shapes', () => {
  assert.equal(sr.formatAgentSpendCell(null, null, 'usage'), '—');
  assert.equal(sr.formatAgentSpendCell(100, 200, 'usage'), '100% quota peak');
  assert.equal(sr.formatAgentSpendCell(1.234, 10, 'cost'), '$1.23 (12%)');
  assert.equal(sr.formatAgentSpendCell(5, 10, 'duration'), '5m (50%)');
});

test('colorAverageFixRounds colorizes best/worst and passes through non-finite values', () => {
  const out = sr.colorAverageFixRounds([
    { averageFixRounds: '1' },
    { averageFixRounds: '5' },
    { averageFixRounds: 'n/a' },
  ]);
  assert.equal(out.length, 3);
  assert.ok(out[0] != null);
  assert.ok(out[0].length > 0);
  assert.equal(out[2], 'n/a', 'non-finite value passes through unchanged');
});

test('colorMissionCounts colorizes and passes through non-finite counts', () => {
  const out = sr.colorMissionCounts([
    { missions: '2' },
    { missions: '8' },
    { missions: 'x' },
  ]);
  assert.equal(out[2], 'x');
  assert.ok(out[0].length > 0);
});

test('computeAgentMissionGroups deduplicates by mission key and builds display groups', () => {
  const { groups, missionKeyToDisplayKey } = sr.computeAgentMissionGroups([
    row({ mission: 'task-1' }),
    row({ mission: 'task-1' }),
    row({ mission: 'task-2' }),
  ], WIN);
  // groups are keyed by displayKey (both missions map to the 'gpt-4' family);
  // the mission-key map retains one entry per distinct mission.
  assert.ok('gpt-4' in groups);
  assert.equal(Object.keys(missionKeyToDisplayKey).length, 2);
});

test('summarizeAgentWindow returns per-agent fix-round summaries', () => {
  const out = sr.summarizeAgentWindow([row({ stage: 'default'})], WIN, { completedMissionKeys: new Set(['acme/app::task-1']), completedMissionOwners: new Map([['acme/app::task-1', 'codex']]), reviewObservations: new Map([['acme/app::task-1', reviewStatisticsObservation('codex', 2)]]) });
  assert.equal(out.length, 1);
  assert.equal(out[0].implementer, 'codex');
  assert.equal(out[0].averageFixRounds, '2.00');
});

test('summarizeAgentStageSpend keeps peak quota levels and folds unknown stages into default', () => {
  const out = sr.summarizeAgentStageSpend(
    [row({ stage: 'active', openai_usage_after: '100' }), row({ stage: 'ignored', openai_usage_after: '5' })],
    WIN,
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].implementer, 'gpt-4');
  assert.equal(out[0].family, 'usage');
  // the raw stored stage 'active' is the spend bucket (displayed as 'execute').
  assert.equal(out[0].byStage.active, 100);
  // the unknown 'ignored' stage rolls up into the default bucket.
  assert.equal(out[0].byStage.default, 5);
  assert.equal(out[0].total, 100);
});

test('AGENT_SPEND_STAGE_COLUMNS and MISSION_PHASE_ORDER expose their stage buckets', () => {
  assert.equal(sr.AGENT_SPEND_STAGE_COLUMNS.length, 5);
  assert.equal(sr.MISSION_PHASE_ORDER.length, 4);
  assert.equal(sr.AGENT_SPEND_STAGE_COLUMNS[1].stage, 'active');
});

test('stage spend follows each stage actor and its resource unit (TASK-2818)', () => {
  const out = sr.summarizeAgentStageSpend([
    row({ implementer: 'custom', implementer_agent: 'custom', model: 'local-model', duration_minutes: '12' }),
    row({ stage: 'review', implementer: 'custom', implementer_agent: 'custom', reviewer_agent: 'claude', model: 'claude-sonnet', provider: 'anthropic', cost_usd: '2.5' }),
    row({ stage: 'follow-up', implementer: 'codex', implementer_agent: 'codex', model: 'gpt-5', openai_usage_after: '7' }),
  ], WIN);
  assert.deepEqual(out.map(({ implementer, family, total }) => ({ implementer, family, total })), [
    { implementer: 'claude-sonnet', family: 'cost', total: 2.5 },
    { implementer: 'gpt-5', family: 'usage', total: 7 },
    { implementer: 'local-model', family: 'duration', total: 12 },
  ]);
  assert.equal(out[0].byStage.review, 2.5);
  assert.equal(out[1].byStage['follow-up'], 7);
  assert.equal(out[2].byStage.active, 12);
});

test('custom stage actor keeps time units when its model or provider is OpenAI (TASK-2818)', () => {
  const out = sr.summarizeAgentStageSpend([
    row({ implementer: 'custom', implementer_agent: 'custom', model: 'gpt-local', duration_minutes: '9' }),
  ], WIN);
  assert.equal(out[0].family, 'duration');
  assert.equal(out[0].total, 9);
  const mistral = sr.summarizeAgentStageSpend([
    row({ implementer: 'vibe', provider: 'mistral', model: 'devstral', cost_usd: '1.25' }),
  ], WIN);
  assert.equal(mistral[0].family, 'cost', 'the existing Mistral dollar unit is preserved');
  assert.equal(mistral[0].total, 1.25);
});

// End-of-run quota levels do not measure attributable consumption.
test('Codex snapshots 20 and 25 remain a 25 percent quota peak without shares (TASK-2818 F1)', () => {
  const snapshots = [
    row({ stage: 'active', openai_usage_before: '0', openai_usage_after: '20' }),
    row({ stage: 'follow-up', openai_usage_before: '0', openai_usage_after: '25' }),
    row({ stage: 'follow-up', openai_usage_after: '22' }),
  ];
  for (const input of [snapshots, [...snapshots].reverse()]) {
    const [result] = sr.summarizeAgentStageSpend(input, WIN);
    assert.equal(result.byStage.active, 20);
    assert.equal(result.byStage['follow-up'], 25);
    assert.equal(result.byStage.review, null);
    assert.equal(result.total, 25);
    assert.equal(sr.formatAgentSpendCell(result.total, result.total, result.family), '25% quota peak');
  }
});

test('quota peaks preserve zero and reject missing or invalid snapshots (TASK-2818 F1)', () => {
  for (const snapshot of [undefined, '', 'garbage', '25junk', '-1', '101', 'Infinity']) {
    const [result] = sr.summarizeAgentStageSpend([row({ openai_usage_after: snapshot })], WIN);
    assert.equal(result.total, null, String(snapshot));
    assert.equal(sr.formatAgentSpendCell(result.total, result.total, result.family), '—');
  }
  const [zero] = sr.summarizeAgentStageSpend([row({ openai_usage_after: '0' })], WIN);
  assert.equal(zero.total, 0);
  assert.equal(sr.formatAgentSpendCell(zero.total, zero.total, zero.family), '0% quota peak');
});
