import test from 'node:test';
import assert from 'node:assert/strict';

import * as statsReport from '../src/adapters/cli/commands/stats-report.js';
// `createWindow` and friends hang off the default export object, not the
// module's named exports, so this must be the default import.
import stats from '../src/adapters/cli/commands/stats.js';

function missionFlow(rows) {
  return rows.filter(row => row.completedForTest === 'yes')
    .map(row => ({ repo: row.repo, mission: row.mission, closedAt: `${row.date}T00:00:00Z`, labels: [] }));
}

function completedMissionKeys(rows) {
  return new Set(rows.filter(row => row.completedForTest === 'yes')
    .map(row => `${row.repo}::${String(row.mission).trim().toLowerCase()}`));
}

function renderWeeklyStatsReport(rows, options = {}) {
  return statsReport.renderWeeklyStatsReport(rows, { ...options, missionFlow: missionFlow(rows) });
}

function renderRangeStatsReport(rows, options = {}) {
  return statsReport.renderRangeStatsReport(rows, { ...options, missionFlow: missionFlow(rows) });
}

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
  assert.ok(report.includes('Agent telemetry — current week') && report.includes('Agent telemetry — previous week'));
});

test('renderWeeklyStatsReport assigns performance cohorts by lifecycle completion, not telemetry date', () => {
  const rows = [
    { date: '2026-08-04', repo: 'r', mission: 'a', classification: 'user_value', implementer: 'alpha', stage: 'default' },
    { date: '2026-08-08', repo: 'r', mission: 'b', classification: 'ai_sdlc', implementer: 'beta', stage: 'default' },
  ];
  const report = statsReport.renderWeeklyStatsReport(rows, {
    today: '2026-08-12',
    missionFlow: [
      { repo: 'r', mission: 'a', closedAt: '2026-08-10T00:00:00Z', labels: [] },
      { repo: 'r', mission: 'b', closedAt: '2026-08-04T00:00:00Z', labels: [] },
    ],
  });
  const [current, previous] = report.split('Agent performance previous week');
  assert.match(current, /alpha\s+1/);
  assert.doesNotMatch(current, /beta\s+1/);
  assert.match(previous, /beta\s+1/);
  assert.doesNotMatch(previous, /alpha\s+1/);
});

test('renderRangeStatsReport filters by date range', () => {
  const rows = [
    { date: '2026-05-10', repo: 'r', mission: 'm1', classification: 'user_value', implementer: 'a', completedForTest: 'yes' },
    { date: '2026-05-25', repo: 'r', mission: 'm3', classification: 'user_value', implementer: 'a', completedForTest: 'yes' },
  ];
  const report = renderRangeStatsReport(rows, { from: '2026-05-10', to: '2026-05-20' });
  assert.ok(report.includes('Agent telemetry missions'));
});

test('renderRangeStatsReport rejects invalid ranges', () => {
  assert.throws(() => renderRangeStatsReport([], { to: '2026-05-31' }), /from/);
  assert.throws(() => renderRangeStatsReport([], { from: '2026-06-01', to: '2026-05-31' }), /after/);
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
  // @ts-expect-error -- TASK-2328: runtime-only property/partial test double absent from the inferred type.
  const w = stats.buildWeeklyWindows(new Date('2026-06-20'));
  assert.ok(w.current && w.previous && w.current.start instanceof Date);
});

test('summarizeMissionWindow counts unique closed missions', () => {
  // @ts-expect-error -- TASK-2328: runtime-only property/partial test double absent from the inferred type.
  const window = stats.createWindow('2026-06-20', 7);
  const rows = [
    { date: '2026-06-15', repo: 'r', mission: 'm1', classification: 'user_value', completedForTest: 'yes' },
    { date: '2026-06-16', repo: 'r', mission: 'm2', classification: 'ai_sdlc', completedForTest: 'yes' },
  ];
  // @ts-expect-error -- TASK-2328: runtime-only property/partial test double absent from the inferred type.
  const s = stats.summarizeMissionWindow(rows, window, completedMissionKeys(rows));
  assert.equal(s.total, 2);
});

test('formatAgentSpendCell formats metric families', () => {
  // @ts-expect-error -- TASK-2328: runtime-only property/partial test double absent from the inferred type.
  assert.equal(stats.formatAgentSpendCell(50, 100, 'usage'), '50% (50%)');
  // @ts-expect-error -- TASK-2328: runtime-only property/partial test double absent from the inferred type.
  assert.equal(stats.formatAgentSpendCell(0, 0, 'duration'), '\u2014');
});
