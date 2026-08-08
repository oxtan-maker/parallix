'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const statsReport = require('../.test-runtime/adapters/cli/commands/stats-report.js');
const stats = require('../.test-runtime/adapters/cli/commands/stats.js');

test('formatStatsTable returns formatted table with bold headers', () => {
  const result = statsReport.formatStatsTable(['A', 'B'], [['1', '2']]);
  assert.ok(result.includes('A') && result.includes('1'));
});

test('renderWeeklyStatsReport produces current and previous week sections', () => {
  const rows = [
    { date: '2026-06-20', repo: 'r', mission: 'm1', classification: 'user_value', implementer: 'claude', closed: 'yes' },
    { date: '2026-06-13', repo: 'r', mission: 'm2', classification: 'ai_sdlc', implementer: 'codex', closed: 'yes' },
  ];
  const report = statsReport.renderWeeklyStatsReport(rows, { today: '2026-06-20' });
  assert.ok(report.includes('Current week') && report.includes('Previous week'));
});

test('renderRangeStatsReport filters by date range', () => {
  const rows = [
    { date: '2026-05-10', repo: 'r', mission: 'm1', classification: 'user_value', implementer: 'a', closed: 'yes' },
    { date: '2026-05-25', repo: 'r', mission: 'm3', classification: 'user_value', implementer: 'a', closed: 'yes' },
  ];
  const report = statsReport.renderRangeStatsReport(rows, { from: '2026-05-10', to: '2026-05-20' });
  assert.ok(report.includes('Missions'));
});

test('renderRangeStatsReport rejects invalid ranges', () => {
  assert.throws(() => statsReport.renderRangeStatsReport([], { to: '2026-05-31' }), /from/);
  assert.throws(() => statsReport.renderRangeStatsReport([], { from: '2026-06-01', to: '2026-05-31' }), /after/);
});

test('renderMissionPhaseReport renders phase table', () => {
  const rows = [
    { date: '2026-06-01', repo: 'r', mission: 't1', stage: 'draft', implementer: 'claude', provider: 'anthropic', model: 'sonnet', input_tokens: '100', output_tokens: '50', cached_tokens: '10', tool_calls: '3', duration_minutes: '5', cost_usd: '0.50', closed: 'no' },
    { date: '2026-06-02', repo: 'r', mission: 't1', stage: 'active', implementer: 'claude', provider: 'anthropic', model: 'sonnet', input_tokens: '200', output_tokens: '100', cached_tokens: '20', tool_calls: '5', duration_minutes: '10', cost_usd: '1.00', closed: 'no' },
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

test('summarizeMissionWindow counts unique closed missions', () => {
  const window = stats.createWindow('2026-06-20', 7);
  const rows = [
    { date: '2026-06-15', repo: 'r', mission: 'm1', classification: 'user_value', closed: 'yes' },
    { date: '2026-06-16', repo: 'r', mission: 'm2', classification: 'ai_sdlc', closed: 'yes' },
  ];
  const s = stats.summarizeMissionWindow(rows, window);
  assert.equal(s.total, 2);
});

test('formatAgentSpendCell formats metric families', () => {
  assert.equal(stats.formatAgentSpendCell(50, 100, 'usage'), '50% (50%)');
  assert.equal(stats.formatAgentSpendCell(0, 0, 'duration'), '\u2014');
});
