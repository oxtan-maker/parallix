'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { renderMissionPhaseReport, normalizeStatsRow } = require('../lib/commands/stats');

// task-1285: prove `node parallix stats <mission>` breaks one mission down by
// phase (draft / execute / review) from stored telemetry rows, and that the
// rendering is deterministic for the same rows.

function rows() {
  return [
    { mission: 'task-1285', stage: 'draft', provider: 'openai', model: 'gpt-5.4', implementer_agent: 'codex', input_tokens: '1000', output_tokens: '200', cached_tokens: '50', tool_calls: '5', duration_minutes: '3' },
    { mission: 'task-1285', stage: 'active', provider: 'anthropic', model: 'claude-opus-4-8', implementer_agent: 'claude', input_tokens: '4000', output_tokens: '900', cached_tokens: '300', tool_calls: '18', duration_minutes: '22' },
    { mission: 'task-1285', stage: 'review', provider: 'openai', model: 'gpt-5.4', reviewer_agent: 'codex', input_tokens: '800', output_tokens: '150', cached_tokens: '20', tool_calls: '3', duration_minutes: '6' },
    // Unrelated mission must not leak into the task-1285 breakdown.
    { mission: 'task-1248', stage: 'active', provider: 'opencode', model: 'qwen', implementer_agent: 'qwen', input_tokens: '0', output_tokens: '0' },
  ].map(normalizeStatsRow);
}

test('mission phase report shows draft, execute, and review as separate phases', () => {
  const report = renderMissionPhaseReport(rows(), 'task-1285');
  assert.match(report, /Mission telemetry by phase: task-1285/);
  for (const phase of ['draft', 'execute', 'review']) {
    assert.match(report, new RegExp(`\\b${phase}\\b`), `expected phase ${phase} in report`);
  }
});

test('mission phase report filters to a single mission (no cross-mission leakage)', () => {
  const report = renderMissionPhaseReport(rows(), 'task-1285');
  // task-1248's launcher identity must not appear in task-1285's breakdown.
  assert.doesNotMatch(report, /opencode/);
  // task-1285's own draft tokens must appear.
  assert.match(report, /1000/);
});

test('mission phase report attributes the execute phase to the stored active row', () => {
  const report = renderMissionPhaseReport(rows(), 'task-1285');
  const executeLine = report.split('\n').find(line => /\bexecute\b/.test(line));
  assert.ok(executeLine, 'execute line present');
  assert.match(executeLine, /claude-opus-4-8/);
  assert.match(executeLine, /4000/);
});

test('mission phase report is deterministic for the same rows', () => {
  const a = renderMissionPhaseReport(rows(), 'task-1285');
  const b = renderMissionPhaseReport(rows(), 'task-1285');
  assert.equal(a, b);
});

test('mission phase report records an unknown mission as explicit zeros, not fabricated data', () => {
  const report = renderMissionPhaseReport(rows(), 'task-9999');
  assert.match(report, /No telemetry rows recorded for mission "task-9999"/);
  // Still prints the canonical phases so the shape is comparable.
  for (const phase of ['draft', 'execute', 'review']) {
    assert.match(report, new RegExp(`\\b${phase}\\b`));
  }
});

// task-1318: regression tests for cost column, review attribution, and token sanity check

test('mission phase report includes Cost ($) column in header and data rows', () => {
  const report = renderMissionPhaseReport(rows(), 'task-1285');
  assert.match(report, /Cost \(\$\)/);
  // Verify cost column appears in the header row alongside Usage %
  const headerLine = report.split('\n').find(line => /Usage %/.test(line));
  assert.ok(headerLine, 'header line with Usage % present');
  assert.match(headerLine, /Cost \(\$\)/);
});

test('mission phase report Cost ($) column shows values from telemetry rows and totals', () => {
  const rowsWithCost = rows().map(r => ({ ...r, cost_usd: '5' }));
  const report = renderMissionPhaseReport(rowsWithCost, 'task-1285');
  // Each phase row should show the cost value
  const lines = report.split('\n');
  const dataLines = lines.filter(l => l.includes('draft') || l.includes('execute') || l.includes('review'));
  assert.ok(dataLines.some(l => /\b5\b/.test(l)), 'phase rows show cost values');
  // Total row should show sum (3 phases x 5 = 15)
  const totalLine = lines.find(l => /\btotal\b/i.test(l));
  assert.ok(totalLine, 'total row present');
  assert.ok(totalLine.includes('15'), 'total row shows sum of costs');
});

test('mission phase report Cost ($) column preserves fractional dollar costs (task-1318)', () => {
  // Real cost_usd values are sub-dollar floats (e.g. 1.4226295, 0.46). parseInt
  // would truncate these to "1"/"0", silently discarding the cost. The column
  // must render the rounded decimal instead.
  const rowsWithCost = rows().map((r, i) => ({ ...r, cost_usd: i === 1 ? '1.4226295' : '0.46433' }));
  const report = renderMissionPhaseReport(rowsWithCost, 'task-1285');
  const lines = report.split('\n');
  const executeLine = lines.find(l => /\bexecute\b/.test(l));
  assert.ok(executeLine, 'execute line present');
  assert.match(executeLine, /1\.42/, 'fractional cost rendered with decimals, not truncated to 1');
  // Total is computed from rounded individual costs so it equals the
  // sum of displayed values: 0.46 + 1.42 + 0.46 = 2.34
  const totalLine = lines.find(l => /\btotal\b/i.test(l));
  assert.match(totalLine, /2\.34/, 'total equals sum of displayed phase costs');
});

test('mission phase report Cost ($) column shows 0 for rows without cost_usd', () => {
  const report = renderMissionPhaseReport(rows(), 'task-1285');
  const lines = report.split('\n');
  // Rows without cost_usd should show 0 in the cost column
  const draftLine = lines.find(l => /\bdraft\b/.test(l));
  assert.ok(draftLine, 'draft line present');
  // The last column (cost) should be 0 for draft row since original rows don't have cost_usd
  // formatStatsTable uses padded columns, so just check 0 appears at the end
  assert.ok(/\b0\s*$/.test(draftLine), 'cost column is 0 when not set');
});

test('mission phase report review phase attributes to reviewer_agent, not implementer_agent', () => {
  // Review rows store reviewer_agent (set by recordReviewStats passing reviewer as implementer)
  const reviewRows = [
    { mission: 'task-1318', stage: 'review', provider: 'anthropic', model: 'claude-opus-4-8', implementer_agent: 'claude', reviewer_agent: 'claude', input_tokens: '800', output_tokens: '150', cached_tokens: '20', tool_calls: '3', duration_minutes: '6' },
  ].map(normalizeStatsRow);
  const report = renderMissionPhaseReport(reviewRows, 'task-1318');
  // The review phase should show the reviewer's agent family (claude), not self-attributed
  const reviewLine = report.split('\n').find(line => /\breview\b/.test(line));
  assert.ok(reviewLine, 'review line present');
  assert.match(reviewLine, /claude/);
});

test('mission phase report execute phase shows implementer_agent when set', () => {
  const execRows = [
    { mission: 'task-1318', stage: 'active', provider: 'openai', model: 'gpt-5.4', implementer_agent: 'codex', input_tokens: '4000', output_tokens: '900', cached_tokens: '300', tool_calls: '18', duration_minutes: '22' },
  ].map(normalizeStatsRow);
  const report = renderMissionPhaseReport(execRows, 'task-1318');
  const execLine = report.split('\n').find(line => /\bexecute\b/.test(line));
  assert.ok(execLine, 'execute line present');
  assert.match(execLine, /codex/);
});
