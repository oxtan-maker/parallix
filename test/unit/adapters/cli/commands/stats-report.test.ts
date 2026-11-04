import test from 'node:test';
import assert from 'node:assert/strict';

import * as statsReport from '../../../../../src/adapters/cli/commands/stats-report.js';
// `createWindow` and friends hang off the default export object, not the
// module's named exports, so this must be the default import.
import stats from '../../../../../src/adapters/cli/commands/stats.js';
import { StatsRow } from '../../../../../src/application/services/statistics-row.js';
import { reviewStatisticsObservation } from '../../../../fixtures/review-statistics.js';

interface TestRow extends StatsRow { repo: string; mission: string; date: string; completedForTest?: string; }

function missionFlow(rows: readonly TestRow[]) {
  return rows.filter((row) => row.completedForTest === 'yes')
    .map(row => ({ repo: row.repo, mission: row.mission, closedAt: `${row.date}T00:00:00Z`, labels: [], implementer: row.implementer }));
}

function completedMissionKeys(rows: readonly TestRow[]) {
  return new Set(rows.filter((row) => row.completedForTest === 'yes')
    .map(row => `${row.repo}::${String(row.mission).trim().toLowerCase()}`));
}

function renderWeeklyStatsReport(rows: readonly TestRow[], options = {}) {
  return statsReport.renderWeeklyStatsReport(rows, { ...options, missionFlow: missionFlow(rows) });
}

function renderRangeStatsReport(rows: readonly TestRow[], options = {}) {
  return statsReport.renderRangeStatsReport(rows, { ...options, missionFlow: missionFlow(rows) });
}

test('px stats formats the shared typed FLOW projection without recalculating metrics (TASK-2835)', () => {
  const reviewStatistics = reviewStatisticsObservation('codex', 0);
  const report = statsReport.renderWeeklyStatsReport([], { today: '2026-11-03', missionFlow: [{
    repo: 'repo', mission: 'task-flow', closedAt: '2026-11-03T12:00:00Z', labels: ['ai_sdlc'],
    implementer: 'codex', reviewStatistics, flowObservation: {
      diagramNodeIds: ['implement', 'review'], diagramEdgeIds: ['implement->review'],
      actualAgentLaunches: 1, agentLaunches: [], observedDisqualifiers: [], ownership: [
        { step: 'implement', actor: 'codex', model: 'gpt-6.1-sol', state: 'working', durationMs: 25 },
      ],
    },
  }] });
  assert.match(report, /shared FLOW lifecycle/);
  assert.match(report, /2\/1\s+100\.0% \(1\/1, coverage 100%\)\s+0 \(mean 0\.0, n=1\)/);
  assert.match(report, /implement\/codex\/gpt-6\.1-sol\/working: total 25ms, mean 25\.0ms, p90 25ms, n=1/);
});

test('formatStatsTable returns formatted table with bold headers', () => {
  const result = statsReport.formatStatsTable(['A', 'B'], [['1', '2']]);
  assert.ok(result.includes('A') && result.includes('1'));
});

test('renderWeeklyStatsReport produces current and previous week sections', () => {
  const rows = [
    { date: '2026-06-20', repo: 'r', mission: 'm1', classification: 'user_value', implementer: 'claude', completedForTest: 'yes' },
    { date: '2026-06-13', repo: 'r', mission: 'm2', classification: 'ai_sdlc', implementer: 'codex', completedForTest: 'yes' },
  ];
  const report = renderWeeklyStatsReport(rows, { today: '2026-06-20' });
  assert.ok(report.includes('Mission flow — current week') && report.includes('Mission flow — previous week'));
  assert.doesNotMatch(report, /Agent telemetry/);
});

test('renderWeeklyStatsReport assigns performance cohorts by lifecycle completion, not telemetry date', () => {
  const rows = [
    { date: '2026-08-04', repo: 'r', mission: 'a', classification: 'user_value', implementer: 'alpha', model: 'alpha-1', stage: 'default' },
    { date: '2026-08-08', repo: 'r', mission: 'b', classification: 'ai_sdlc', implementer: 'beta', model: 'beta-1', stage: 'default' },
  ];
  const report = statsReport.renderWeeklyStatsReport(rows, {
    today: '2026-08-12',
    missionFlow: [
      { repo: 'r', mission: 'a', closedAt: '2026-08-10T00:00:00Z', labels: [], implementer: 'alpha' },
      { repo: 'r', mission: 'b', closedAt: '2026-08-04T00:00:00Z', labels: [], implementer: 'beta' },
    ],
  });
  const [current, previous] = report.split('Agent performance previous week');
  assert.match(current, /alpha-1\s+1/);
  assert.doesNotMatch(current, /beta-1\s+1/);
  assert.match(previous, /beta-1\s+1/);
  assert.doesNotMatch(previous, /alpha-1\s+1/);
});

test('renderRangeStatsReport filters by date range', () => {
  const rows = [
    { date: '2026-05-10', repo: 'r', mission: 'm1', classification: 'user_value', implementer: 'a', completedForTest: 'yes' },
    { date: '2026-05-25', repo: 'r', mission: 'm3', classification: 'user_value', implementer: 'a', completedForTest: 'yes' },
  ];
  const report = renderRangeStatsReport(rows, { from: '2026-05-10', to: '2026-05-20' });
  assert.ok(report.includes('Agent performance'));
  assert.doesNotMatch(report, /Agent telemetry/);
});

test('renderRangeStatsReport rejects invalid ranges', () => {
  assert.throws(() => renderRangeStatsReport([], { to: '2026-05-31' }), /from/);
  assert.throws(() => renderRangeStatsReport([], { from: '2026-06-01', to: '2026-05-31' }), /after/);
});

test('range and weekly reports show actor-specific resource units without completion history (TASK-2818)', () => {
  const rows = [
    { date: '2026-06-20', repo: 'r', mission: 'mixed', classification: 'ai_sdlc', stage: 'active', implementer: 'custom', provider: 'openai', model: 'local-model', duration_minutes: '12', openai_usage_after: '99', cost_usd: '99' },
    { date: '2026-06-20', repo: 'r', mission: 'mixed', classification: 'ai_sdlc', stage: 'review', implementer: 'custom', reviewer_agent: 'claude', provider: 'anthropic', model: 'claude-opus-5-5', cost_usd: '2.5' },
    { date: '2026-06-20', repo: 'r', mission: 'mixed', classification: 'ai_sdlc', stage: 'follow-up', implementer: 'codex', provider: 'openai', model: 'gpt-6.1-sol', openai_usage_after: '7' },
    { date: '2026-05-01', repo: 'r', mission: 'old', classification: 'ai_sdlc', implementer: 'old-agent', duration_minutes: '999' },
  ];
  for (const report of [
    statsReport.renderRangeStatsReport(rows, { from: '2026-06-20', to: '2026-06-20', missionFlow: null }),
    statsReport.renderWeeklyStatsReport(rows, { today: '2026-06-20', missionFlow: null }),
  ]) {
    assert.match(report, /local-model[^\n]*12m/);
    assert.match(report, /claude-opus-5-5[^\n]*\$2\.5/);
    assert.match(report, /gpt-6\.1-sol[^\n]*7%/);
    assert.doesNotMatch(report, /old-agent|99/);
  }
});

test('renderMissionPhaseReport renders phase table', () => {
  const rows = [
    { date: '2026-06-01', repo: 'r', mission: 't1', stage: 'draft', implementer: 'claude', provider: 'anthropic', model: 'sonnet', input_tokens: '100', output_tokens: '50', cached_tokens: '10', tool_calls: '3', duration_minutes: '5', cost_usd: '0.50', completedForTest: 'no' },
    { date: '2026-06-02', repo: 'r', mission: 't1', stage: 'active', implementer: 'claude', provider: 'anthropic', model: 'sonnet', input_tokens: '200', output_tokens: '100', cached_tokens: '20', tool_calls: '5', duration_minutes: '10', cost_usd: '1.00', completedForTest: 'no' },
  ];
  const report = statsReport.renderMissionPhaseReport(rows, 't1', { repo: 'r' });
  assert.ok(report.includes('Mission telemetry by phase') && report.includes('total'));
});

test('renderMissionPhaseReport shows zeros for unknown mission', () => {
  assert.ok(statsReport.renderMissionPhaseReport([], 'unknown', { repo: 'r' }).includes('No telemetry rows'));
});

test('buildWeeklyWindows returns two week windows', () => {
  const w = stats.buildWeeklyWindows(new Date('2026-06-20'));
  assert.ok(w.current && w.previous && w.current.start instanceof Date);
});

test('formatAgentSpendCell formats metric families', () => {
  assert.equal(stats.formatAgentSpendCell(50, 100, 'usage'), '50%');
  assert.equal(stats.formatAgentSpendCell(0, 0, 'duration'), '\u2014');
});

test('weekly and range reports show Codex stage levels without a peak label and total them across stages (TASK-2832)', () => {
  const rows = [
    { date: '2026-06-20', repo: 'r', mission: 'quota', classification: 'ai_sdlc', stage: 'active', implementer: 'codex', model: 'gpt-6.1-sol', openai_usage_after: '20' },
    { date: '2026-06-20', repo: 'r', mission: 'quota', classification: 'ai_sdlc', stage: 'follow-up', implementer: 'codex', model: 'gpt-6.1-sol', openai_usage_after: '25' },
    { date: '2026-05-01', repo: 'r', mission: 'old', classification: 'ai_sdlc', stage: 'active', implementer: 'codex', openai_usage_after: '90' },
  ];
  for (const report of [renderWeeklyStatsReport(rows, { today: '2026-06-20' }),
    renderRangeStatsReport(rows, { from: '2026-06-20', to: '2026-06-20' })]) {
    const quotaRow = report.split('\n').find(line => line.startsWith('gpt-6.1-sol') && line.includes('%'));
    assert.ok(quotaRow);
    assert.match(quotaRow, /20%\s+—\s+25%/);
    assert.match(quotaRow, /45%\s*$/, 'the total adds the stage columns; 90% from outside the window is excluded');
    assert.doesNotMatch(report, /quota peak|total \/ peak|\(\d+%\)\s*$/m);
  }
});

// TASK-2832: default output is Model / # missions as implementer / # reimplementation rounds.
test('performance tables show concrete models and average reimplementation rounds per mission only (TASK-2832)', () => {
  const rows = [
    { date: '2026-06-20', repo: 'r', mission: 'a', classification: 'ai_sdlc', stage: 'active', implementer: 'codex', model: 'gpt-6.1-sol' },
    { date: '2026-06-20', repo: 'r', mission: 'a', classification: 'ai_sdlc', stage: 'review', implementer: 'codex', reviewer_agent: 'claude', model: 'claude-opus-5-5', cost_usd: '1.5' },
    { date: '2026-06-20', repo: 'r', mission: 'a', classification: 'ai_sdlc', stage: 'default', implementer: 'codex' },
  ];
  const flow = [{ repo: 'r', mission: 'a', closedAt: '2026-06-20T00:00:00Z', labels: [], implementer: 'codex',
    reviewStatistics: { implementer: 'codex', total: 3, byImplementer: { codex: 3 }, returns: [1, 2, 3].map(() => ({ author: 'codex', at: null })), source: 'review-aggregate' as const } }];
  for (const report of [statsReport.renderWeeklyStatsReport(rows, { today: '2026-06-20', missionFlow: flow as never }),
    statsReport.renderRangeStatsReport(rows, { from: '2026-06-20', to: '2026-06-20', missionFlow: flow as never })]) {
    assert.match(report, /Model\s+# missions as implementer\s+Avg reimplementation rounds \/ mission/);
    assert.match(report, /gpt-6\.1-sol\s+1\s+3\.0\b/);
    assert.doesNotMatch(report, /Average authored|PR fix n|coverage|Repair\/re-review|Obligations|Agent family/);
    assert.doesNotMatch(report.split('Agent performance')[1] ?? '', /^\s*codex\s+1/m);
  }
});

test('mixed, generic and missing models conserve resources outside named rows once (TASK-2832)', () => {
  const rows = [
    { date: '2026-06-20', repo: 'r', mission: 'm', classification: 'ai_sdlc', stage: 'review', implementer: 'codex', reviewer_agent: 'claude', model: 'mixed', cost_usd: '2.47' },
    { date: '2026-06-20', repo: 'r', mission: 'n', classification: 'ai_sdlc', stage: 'review', implementer: 'codex', reviewer_agent: 'claude', cost_usd: '1' },
    { date: '2026-06-20', repo: 'r', mission: 'm', classification: 'ai_sdlc', stage: 'active', implementer: 'custom', model: 'custom', duration_minutes: '170' },
    { date: '2026-06-20', repo: 'r', mission: 'm', classification: 'ai_sdlc', stage: 'review', implementer: 'codex', reviewer_agent: 'claude', model: 'claude-opus-5-5', cost_usd: '3' },
  ];
  const spend = stats.summarizeAgentStageSpend(rows, stats.createRangeWindow({ from: '2026-06-20', to: '2026-06-20' }));
  assert.deepEqual(spend.map(row => [row.model, row.actor, row.total]), [['claude-opus-5-5', 'claude', 3], [null, 'claude', 3.47], [null, 'custom', 170]]);
  const report = statsReport.renderRangeStatsReport(rows, { from: '2026-06-20', to: '2026-06-20', missionFlow: null });
  assert.equal(report.match(/Unavailable model attribution/g)?.length, 1);
  assert.match(report, /\$3\.47 claude, 170m custom/);
  assert.doesNotMatch(report, /^(mixed|custom|claude|codex)\s/m);
});

test('weekly and range averages name partially measured missions instead of a false lower bound (TASK-2832)', () => {
  const rows = ['a', 'b'].map(mission => ({ date: '2026-06-20', repo: 'r', mission, classification: 'ai_sdlc', stage: 'active', implementer: 'codex', model: 'gpt-6.1-sol' }));
  const flow = [{ repo: 'r', mission: 'a', closedAt: '2026-06-20T00:00:00Z', labels: [], implementer: 'codex',
      reviewStatistics: { implementer: 'codex', total: 10, byImplementer: { codex: 10 }, returns: Array.from({ length: 10 }, (_, index) => ({ identity: `r${index}`, author: 'codex', at: null })), source: 'review-aggregate' as const } },
    { repo: 'r', mission: 'b', closedAt: '2026-06-20T00:00:00Z', labels: [], implementer: 'codex' }];
  for (const report of [statsReport.renderWeeklyStatsReport(rows, { today: '2026-06-20', missionFlow: flow as never }),
    statsReport.renderRangeStatsReport(rows, { from: '2026-06-20', to: '2026-06-20', missionFlow: flow as never })]) {
    assert.match(report, /gpt-6\.1-sol\s+2\s+10\.0 \(1\/2 measured\)/);
    assert.doesNotMatch(report, /10\.0\+/);
  }
});
