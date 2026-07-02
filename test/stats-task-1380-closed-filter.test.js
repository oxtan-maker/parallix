const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const stats = require('../lib/commands/stats');

// Reproduction test for task-1380: stats is counting started missions
// instead of closed missions. This test verifies that:
// 1. STATS_HEADERS includes the 'closed' column
// 2. recordIntegrationStats sets closed: 'yes'
// 3. summarizeMissionWindow filters out non-closed rows
// 4. renderWeeklyStatsReport excludes in-progress missions from counts

test('task-1380: STATS_HEADERS includes the closed column', () => {
  assert.ok(stats.STATS_HEADERS.includes('closed'),
    'STATS_HEADERS should include the "closed" column');
});

test('task-1380: recordIntegrationStats sets closed: yes', () => {
  const csvFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'task-1380-integration-')),
    'stats.csv'
  );
  const root = path.dirname(csvFile);
  fs.mkdirSync(path.join(root, 'backlog', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'missions', '2026', 'task-2000'), { recursive: true });

  const taskFile = path.join(root, 'backlog', 'tasks', 'task-2000 - Example.md');
  fs.writeFileSync(taskFile, [
    '---',
    'id: TASK-2000',
    'labels: [ai_sdlc]',
    'assignee: [codex]',
    'status: review',
    '---',
    '',
  ].join('\n'));

  try {
    const result = stats.recordIntegrationStats({
      slug: 'task-2000',
      rootDir: root,
      filePath: csvFile,
      date: '2026-06-23',
    });

    assert.equal(result.row.closed, 'yes',
      'recordIntegrationStats should set closed: yes');
    assert.equal(result.data.rows.length, 1);
    assert.equal(result.data.rows[0].closed, 'yes');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('task-1380: summarizeMissionWindow excludes non-closed rows', () => {
  const rows = [
    // In-progress mission (no closed column)
    { date: '2026-06-23', mission: 'task-active', classification: 'ai_sdlc', implementer: 'codex', pr_fix_rounds: '0', stage: 'active' },
    { date: '2026-06-23', mission: 'task-review', classification: 'user_value', implementer: 'claude', pr_fix_rounds: '1', stage: 'review' },
    // Closed mission
    { date: '2026-06-22', mission: 'task-done', classification: 'ai_sdlc', implementer: 'gemini', pr_fix_rounds: '2', closed: 'yes' },
  ];

  const window = {
    start: new Date('2026-06-16'),
    end: new Date('2026-06-23'),
    label: '2026-06-16 → 2026-06-23',
  };

  const result = stats._internals.summarizeMissionWindow(rows, window);

  assert.equal(result.total, 1,
    'summarizeMissionWindow should only count closed missions (got ' + result.total + ')');
  assert.equal(result.aiSdlc, 1);
  assert.equal(result.userValue, 0);
});

test('task-1380: renderWeeklyStatsReport excludes in-progress missions', () => {
  const rows = [
    // In-progress missions (no closed column)
    { date: '2026-06-23', mission: 'task-started', classification: 'ai_sdlc', implementer: 'codex', pr_fix_rounds: '0', stage: 'active' },
    { date: '2026-06-22', mission: 'task-drafting', classification: 'user_value', implementer: 'claude', pr_fix_rounds: '0', stage: 'draft' },
    // Closed mission
    { date: '2026-06-23', mission: 'task-closed', classification: 'ai_sdlc', implementer: 'gemini', pr_fix_rounds: '1', closed: 'yes' },
  ];

  const report = stats.renderWeeklyStatsReport(rows, { today: '2026-06-23' });

  // Should report 1 mission (only the closed one), not 3
  assert.match(report, /# missions\s*[^\d]*1\s/,
    'weekly report should count only closed missions in current week');
  // Previous week should have 0 missions — split into sections and check
  const prevSection = report.split('Previous week')[1] || '';
  const prevDataLine = prevSection.split('\n').find(l => /^\d/.test(l));
  const prevValues = (prevDataLine || '').trim().split(/\s+/);
  assert.equal(Number(prevValues[0]), 0,
    'weekly report should show 0 missions in previous week');
});

test('task-1380: renderRangeStatsReport excludes in-progress missions', () => {
  const rows = [
    // In-progress
    { date: '2026-05-10', mission: 'task-wip', classification: 'ai_sdlc', implementer: 'codex', pr_fix_rounds: '0' },
    // Closed
    { date: '2026-05-15', mission: 'task-shipped', classification: 'user_value', implementer: 'gemini', pr_fix_rounds: '2', closed: 'yes' },
  ];

  const report = stats.renderRangeStatsReport(rows, { from: '2026-05-01', to: '2026-05-31' });

  // Should report 1 mission (only the closed one)
  assert.match(report, /# missions\s*[^\d]*1\s/,
    'range report should count only closed missions');
  assert.match(report, /# user value missions\s*[^\d]*1\s/,
    'range report should count 1 user value mission');
  // AI SDLC should be 0 (the closed mission is user_value)
  const rangeLines = report.split('\n');
  const dataLine = rangeLines.find(l => /^\d/.test(l));
  const rangeValues = (dataLine || '').trim().split(/\s+/);
  assert.equal(Number(rangeValues[3]), 0,
    'range report should count 0 AI SDLC missions (closed mission is user_value)');
});

test('task-1380: backward compat — CSV without closed column treats all rows as closed', () => {
  const csvFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'task-1380-backward-')),
    'stats.csv'
  );

  // Write CSV without closed column (legacy schema)
  fs.writeFileSync(csvFile, [
    'date,repo,mission,classification,implementer,pr_fix_rounds,' +
    'provider,model,implementer_agent,reviewer_agent,stage,' +
    'input_tokens,output_tokens,cached_tokens,context_tokens,' +
    'tool_calls,openai_usage_before,openai_usage_after,' +
    'openai_usage_delta,duration_minutes,cost_usd',
    '2026-06-23,parallix,task-old,ai_sdlc,codex,2,codex,codex,codex,,default,100,50,10,160,5,0,0,0,3,0.10',
  ].join('\n'), 'utf8');

  try {
    const data = stats.loadStatsCsv(csvFile);
    assert.equal(data.rows.length, 1);
    // Missing closed should default to 'yes' for backward compat
    assert.equal(data.rows[0].closed, 'yes',
      'loadStatsCsv should default missing closed to yes for backward compatibility');

    const report = stats.renderWeeklyStatsReport(data.rows, { today: '2026-06-23' });
    assert.match(report, /# missions\s*[^\d]*1\s/,
      'weekly report on legacy CSV should count the row as 1 mission');
  } finally {
    fs.rmSync(csvFile, { force: true });
  }
});

// Regression test for reviewer Finding 1: verify that recordActiveStats (the
// actual write path) does NOT set closed: 'yes' on in-progress rows, and that
// the weekly report correctly excludes them. This exercises the full write path
// (recordActiveStats → upsertStatsRow → canonicalizeStatsRow → normalizeStatsRow)
// rather than bypassing it with hand-built row objects.
test('task-1380: recordActiveStats does not set closed on in-progress rows (regression for Finding 1)', () => {
  const csvFile = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'task-1380-regression-')),
    'stats.csv'
  );
  const root = path.dirname(csvFile);
  fs.mkdirSync(path.join(root, 'backlog', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'missions', '2026', 'task-5001'), { recursive: true });

  const taskFile = path.join(root, 'backlog', 'tasks', 'task-5001 - WIP Mission.md');
  fs.writeFileSync(taskFile, [
    '---',
    'id: TASK-5001',
    'labels: [user_value]',
    'assignee: [codex]',
    'status: active',
    '---',
    '',
  ].join('\n'));

  try {
    // Call recordActiveStats — the real write path for in-progress missions
    const result = stats.recordActiveStats({
      slug: 'task-5001',
      rootDir: root,
      filePath: csvFile,
      model: 'codex',
      date: '2026-07-01',
    });

    // The written row must NOT have closed: 'yes' — that's what the bug was
    assert.notEqual(result.row.closed, 'yes',
      'recordActiveStats should NOT set closed: yes on in-progress rows');

    // Load the CSV back and verify the row was written without closed: 'yes'
    const data = stats.loadStatsCsv(csvFile);
    assert.equal(data.rows.length, 1);
    assert.notEqual(data.rows[0].closed, 'yes',
      'loaded row should not have closed: yes');

    // The weekly report should count 0 missions (the only row is in-progress)
    const report = stats.renderWeeklyStatsReport(data.rows, { today: '2026-07-01' });
    const currentSection = report.split('Current week')[1] || '';
    const currentDataLine = currentSection.split('\n').find(l => /^\d/.test(l));
    const currentValues = (currentDataLine || '').trim().split(/\s+/);
    assert.equal(Number(currentValues[0]), 0,
      'weekly report should count 0 missions when only in-progress rows exist');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
