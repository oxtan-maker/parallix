import { reviewStatisticsObservation } from '../../../../fixtures/review-statistics.js';
// helpers. Imported via the `stats.js` re-export barrel (the production entry)
// so the leaf module's circular-import TDZ is avoided; coverage still lands on
// `stats-report-rendering.ts`. Pure functions only — in-memory StatsRow doubles,
// no DB, no git, no spawn.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as sr from '../../../../../src/adapters/cli/commands/stats.js';
import type { ReviewReturnOrigin } from '../../../../../src/application/services/review-statistics.js';

const fixtureOrigin: ReviewReturnOrigin = {
  actor: null, stage: 'workflow', decisionIdentity: null, revision: null, sender: null,
};
function observedReturn(identity: string, author: string | null, at: string | null) {
  return { identity, author, at, origin: fixtureOrigin };
}

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
  assert.equal(sr.formatAgentSpendCell(100, 200, 'usage'), '100%');
  assert.equal(sr.formatAgentSpendCell(1.234, 10, 'cost'), '$1.23 (12%)');
  assert.equal(sr.formatAgentSpendCell(5, 10, 'duration'), '5m (50%)');
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

test('summarizeAgentWindow groups deliveries and returns by concrete model (TASK-2832)', () => {
  const out = sr.summarizeAgentWindow([row({ stage: 'default'})], WIN, { completedMissionKeys: new Set(['acme/app::task-1']), completedMissionOwners: new Map([['acme/app::task-1', 'codex']]), reviewObservations: new Map([['acme/app::task-1', reviewStatisticsObservation('codex', 2)]]) });
  assert.deepEqual(out, [{ model: 'gpt-4', missions: 1, measuredMissions: 1, reimplementationRounds: 2, incomplete: false }]);
});

test('one unmeasured mission never hides the measured returns of the same model (TASK-2832)', () => {
  const keys = ['acme/app::task-1', 'acme/app::task-2'];
  const out = sr.summarizeAgentWindow([row({ stage: 'default' }), row({ stage: 'default', mission: 'task-2' })], WIN, {
    completedMissionKeys: new Set(keys), completedMissionOwners: new Map(keys.map(key => [key, 'codex'])),
    reviewObservations: new Map([[keys[0], reviewStatisticsObservation('codex', 4)], [keys[1], reviewStatisticsObservation('codex', null)]]) });
  assert.deepEqual(out, [{ model: 'gpt-4', missions: 2, measuredMissions: 1, reimplementationRounds: 4, incomplete: false }]);
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
  assert.equal(out[0].total, 105, 'the total adds the stage columns');
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
test('Codex stage levels keep the highest snapshot per stage and the total adds the stages (TASK-2832)', () => {
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
    assert.equal(result.total, 45);
    assert.equal(sr.formatAgentSpendCell(result.total, result.total, result.family), '45%');
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
  assert.equal(sr.formatAgentSpendCell(zero.total, zero.total, zero.family), '0%');
});

test('missing duration and cost stay unavailable in stage spend without NaN (TASK-2363 pattern)', () => {
  const output = sr.summarizeAgentStageSpend([
    row({ implementer: 'custom', implementer_agent: 'custom', model: 'local-model', duration_minutes: undefined }),
    row({ stage: 'review', implementer: 'codex', reviewer_agent: 'claude', provider: 'anthropic', model: 'claude-sonnet', cost_usd: undefined }),
  ], WIN);

  assert.deepEqual(output.map(item => [item.family, item.total]), [['cost', null], ['duration', null]]);
  assert.equal(output[0].byStage.review, null);
  assert.equal(output[1].byStage.active, null);
  assert.ok(output.every(item => Object.values(item.byStage).every(value => value === null || !Number.isNaN(value))));
});

test('a same-family model replacement keeps earlier returns with the model that wrote the work (TASK-2832)', () => {
  const rows = [row({ stage: 'active', model: 'gpt-6.1-sol', date: '2024-01-10' }), row({ stage: 'follow-up', model: 'gpt-6-astra', date: '2024-01-20' }),
    row({ stage: 'default', model: '', date: '2024-01-25' })];
  const observation = { ...reviewStatisticsObservation('codex', 3, { codex: 3 }), returns: [
    observedReturn('r1', 'codex', '2024-01-12T00:00:00Z'), observedReturn('r2', 'codex', '2024-01-13T00:00:00Z'), observedReturn('r3', 'codex', '2024-01-22T00:00:00Z')] };
  const out = sr.summarizeAgentWindow(rows, WIN, { completedMissionKeys: new Set(['acme/app::task-1']), completedMissionOwners: new Map([['acme/app::task-1', 'codex']]),
    reviewObservations: new Map([['acme/app::task-1', observation]]) });
  assert.deepEqual(out.map(item => [item.model, item.reimplementationRounds]), [['gpt-6-astra', 1], ['gpt-6.1-sol', 2]]);
});

test('same-day model switches leave a return unattributed; a single model owns all of an agent work (TASK-2832)', () => {
  const observed = (at: string) => ({ ...reviewStatisticsObservation('codex', 1, { codex: 1 }), returns: [observedReturn('r', 'codex', at)] });
  const summarize = (rows: ReturnType<typeof row>[], at: string) => sr.summarizeAgentWindow(rows, WIN, { completedMissionKeys: new Set(['acme/app::task-1']),
    completedMissionOwners: new Map([['acme/app::task-1', 'codex']]), reviewObservations: new Map([['acme/app::task-1', observed(at)]]) });
  const sameDay = summarize([row({ stage: 'active', model: 'gpt-6.1-sol', date: '2024-01-10' }), row({ stage: 'follow-up', model: 'gpt-6-astra', date: '2024-01-10' })], '2024-01-10T09:00:00Z');
  assert.deepEqual(sameDay.map(item => [item.model, item.reimplementationRounds, item.incomplete]), [['gpt-6-astra', 0, true], [null, 1, false]]);
  const futureOnly = summarize([row({ stage: 'active', model: 'gpt-6-astra', date: '2024-01-11' })], '2024-01-10T09:00:00Z');
  assert.deepEqual(futureOnly.map(item => [item.model, item.reimplementationRounds, item.incomplete]), [['gpt-6-astra', 1, false]]);
});

test('a return no author can claim makes named model cells incomplete, never a measured zero (TASK-2832)', () => {
  const observation = { ...reviewStatisticsObservation('codex', 1, { codex: 0, unknown: 1 }), returns: [observedReturn('r', null, null)] };
  const out = sr.summarizeAgentWindow([row({ stage: 'active', model: 'gpt-6.1-sol' })], WIN, { completedMissionKeys: new Set(['acme/app::task-1']),
    completedMissionOwners: new Map([['acme/app::task-1', 'codex']]), reviewObservations: new Map([['acme/app::task-1', observation]]) });
  assert.deepEqual(out.map(item => [item.model, item.reimplementationRounds, item.incomplete]), [['gpt-6.1-sol', 0, true], [null, 1, false]]);
});

test('an unattributable return only makes incomplete the models its author could have used (TASK-2832)', () => {
  const rows = [row({ stage: 'active', model: 'gpt-6.1-sol' }), row({ stage: 'default', model: '' })];
  const observation = { ...reviewStatisticsObservation('codex', 1, { codex: 0, claude: 1 }), returns: [observedReturn('r', 'claude', null)] };
  const out = sr.summarizeAgentWindow(rows, WIN, { completedMissionKeys: new Set(['acme/app::task-1']),
    completedMissionOwners: new Map([['acme/app::task-1', 'codex']]), reviewObservations: new Map([['acme/app::task-1', observation]]) });
  assert.deepEqual(out.map(item => [item.model, item.measuredMissions, item.reimplementationRounds, item.incomplete]), [['gpt-6.1-sol', 1, 0, false], [null, 1, 1, false]]);
});

test('mixed earlier telemetry voids the single-model shortcut for work returned before the replacement (TASK-2832)', () => {
  const rows = [row({ stage: 'active', model: 'mixed', date: '2024-01-10' }), row({ stage: 'follow-up', model: 'gpt-6-astra', date: '2024-01-12' })];
  const observation = { ...reviewStatisticsObservation('codex', 1, { codex: 1 }), returns: [observedReturn('r', 'codex', '2024-01-11T09:00:00Z')] };
  const out = sr.summarizeAgentWindow(rows, WIN, { completedMissionKeys: new Set(['acme/app::task-1']),
    completedMissionOwners: new Map([['acme/app::task-1', 'codex']]), reviewObservations: new Map([['acme/app::task-1', observation]]) });
  assert.deepEqual(out.map(item => [item.model, item.reimplementationRounds, item.incomplete]), [['gpt-6-astra', 0, true], [null, 1, false]]);
});

test('unknown-author uncertainty does not depend on return order (TASK-2832)', () => {
  const rows = [row({ stage: 'active', model: 'gpt-6.1-sol', date: '2024-01-10' }), row({ stage: 'follow-up', model: 'gpt-6-astra', date: '2024-01-20' })];
  const unknown = observedReturn('u', null, null), sol = observedReturn('s', 'codex', '2024-01-12T00:00:00Z');
  const run = (returns: ReturnType<typeof observedReturn>[]) => sr.summarizeAgentWindow(rows, WIN, { completedMissionKeys: new Set(['acme/app::task-1']),
    completedMissionOwners: new Map([['acme/app::task-1', 'codex']]), reviewObservations: new Map([['acme/app::task-1', { ...reviewStatisticsObservation('codex', 2, { codex: 1, unknown: 1 }), returns }]]) });
  assert.deepEqual(run([unknown, sol]), run([sol, unknown]));
  assert.equal(run([unknown, sol]).find(item => item.model === 'gpt-6.1-sol')?.incomplete, true);
});

test('a mission without return evidence is named as unmeasured, never turned into a false lower bound (TASK-2832)', () => {
  const rows = [row({ mission: 'task-1', stage: 'active', model: 'gpt-6.1-sol' }), row({ mission: 'task-2', stage: 'active', model: 'gpt-6.1-sol' })];
  const out = sr.summarizeAgentWindow(rows, WIN, { completedMissionKeys: new Set(['acme/app::task-1', 'acme/app::task-2']),
    completedMissionOwners: new Map([['acme/app::task-1', 'codex'], ['acme/app::task-2', 'codex']]),
    reviewObservations: new Map([['acme/app::task-1', reviewStatisticsObservation('codex', 10, { codex: 10 })]]) });
  assert.deepEqual(out, [{ model: 'gpt-6.1-sol', missions: 2, measuredMissions: 1, reimplementationRounds: 10, incomplete: false }]);
});

test('newer unknown telemetry between a concrete model and the return prevents a stale attribution (TASK-2832)', () => {
  const rows = [row({ stage: 'active', model: 'gpt-6.1-sol', date: '2024-01-05' }), row({ stage: 'follow-up', model: 'mixed', date: '2024-01-10' }),
    row({ stage: 'follow-up', model: 'gpt-6-astra', date: '2024-01-20' })];
  const observation = { ...reviewStatisticsObservation('codex', 1, { codex: 1 }), returns: [observedReturn('r', 'codex', '2024-01-15T09:00:00Z')] };
  const out = sr.summarizeAgentWindow(rows, WIN, { completedMissionKeys: new Set(['acme/app::task-1']),
    completedMissionOwners: new Map([['acme/app::task-1', 'codex']]), reviewObservations: new Map([['acme/app::task-1', observation]]) });
  assert.deepEqual(out.map(item => [item.model, item.reimplementationRounds, item.incomplete]), [['gpt-6-astra', 0, true], [null, 1, false]]);
});
