// @ts-nocheck -- TASK-2535: branch coverage for the pure `stats-report-rendering`
// helpers. Imported via the `stats.js` re-export barrel (the production entry)
// so the leaf module's circular-import TDZ is avoided; coverage still lands on
// `stats-report-rendering.ts`. Pure functions only — in-memory StatsRow doubles,
// no DB, no git, no spawn.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as sr from '../src/adapters/cli/commands/stats.js';

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
  assert.equal(sr.formatAgentSpendCell(5, 0, 'usage'), '—');
  assert.equal(sr.formatAgentSpendCell(100, 200, 'usage'), '100% (50%)');
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
  const out = sr.summarizeAgentWindow([row()], WIN, { completedMissionKeys: new Set(['acme/app::task-1']) });
  assert.equal(out.length, 1);
  assert.equal(out[0].implementer, 'gpt-4');
  assert.equal(out[0].averageFixRounds, '2.00');
});

test('summarizeAgentStageSpend sums spend per stage by family and skips unknown stages', () => {
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
  assert.equal(out[0].total, 105);
});

test('summarizeMissionWindow counts unique missions by classification', () => {
  const keys = new Set(['acme/app::task-1', 'acme/app::task-2', 'acme/app::task-3']);
  const out = sr.summarizeMissionWindow(
    [row({ mission: 'task-1', classification: 'user_value' }),
      row({ mission: 'task-2', classification: 'ai_sdlc' }),
      row({ mission: 'task-3', classification: 'unknown' })],
    WIN,
    keys,
  );
  assert.equal(out.total, 3);
  assert.equal(out.userValue, 1);
  assert.equal(out.aiSdlc, 1);
  assert.equal(out.unknown, 1);
});

test('AGENT_SPEND_STAGE_COLUMNS and MISSION_PHASE_ORDER expose their stage buckets', () => {
  assert.equal(sr.AGENT_SPEND_STAGE_COLUMNS.length, 5);
  assert.equal(sr.MISSION_PHASE_ORDER.length, 4);
  assert.equal(sr.AGENT_SPEND_STAGE_COLUMNS[1].stage, 'active');
});
