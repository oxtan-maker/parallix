const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const stats = require('../lib/commands/stats');

function writeCsv(contents) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-stats-merge-conflict-')), 'input.csv');
  fs.writeFileSync(file, contents, 'utf8');
  return file;
}

test('loadCsv parses cleaned CSV (after merge conflict resolution) with valid data rows', () => {
  const csv = writeCsv([
    'date,mission,classification,implementer,pr_fix_rounds',
    '2026-05-06,task-1054,ai_sdlc,claude,1',
    '2026-05-06,task-1055,ai_sdlc,codex,0',
    '2026-05-06,task-1057,ai_sdlc,claude,2',
  ].join('\n'));

  const data = stats._internals.loadCsv(csv);

  assert.deepEqual(data.headers, ['date', 'mission', 'classification', 'implementer', 'pr_fix_rounds']);
  assert.equal(data.rows.length, 3);
  assert.deepEqual(data.rows[0], {
    date: '2026-05-06',
    mission: 'task-1054',
    classification: 'ai_sdlc',
    implementer: 'claude',
    pr_fix_rounds: '1',
  });
  assert.deepEqual(data.rows[1], {
    date: '2026-05-06',
    mission: 'task-1055',
    classification: 'ai_sdlc',
    implementer: 'codex',
    pr_fix_rounds: '0',
  });
  assert.deepEqual(data.rows[2], {
    date: '2026-05-06',
    mission: 'task-1057',
    classification: 'ai_sdlc',
    implementer: 'claude',
    pr_fix_rounds: '2',
  });
});

test('loadCsv handles CSV with merge conflict markers by treating them as malformed data rows', () => {
  const csv = writeCsv([
    '<<<<<<< HEAD',
    'date,mission,classification,implementer,pr_fix_rounds',
    '=======',
    '2026-05-06,task-1054,ai_sdlc,claude,1',
    '>>>>>>> mission/task-1111',
    '2026-05-06,task-1055,ai_sdlc,codex,0',
    '2026-05-06,task-1057,ai_sdlc,claude,2',
  ].join('\n'));

  const data = stats._internals.loadCsv(csv);

  // Conflict markers are treated as data rows since they appear after the header
  // The first line <<<<<<< HEAD becomes the header, which is malformed
  // This test documents the current behavior: loadCsv does not filter conflict markers
  assert.equal(data.headers.length, 1);
  assert.equal(data.headers[0], '<<<<<<< HEAD');
  assert.equal(data.rows.length, 6);
});

test('loadCsv parses CSV with merge conflict markers at the top after conflict resolution', () => {
  // After conflict resolution, the CSV should be clean with no markers
  const csv = writeCsv([
    'date,mission,classification,implementer,pr_fix_rounds',
    '2026-05-06,task-1054,ai_sdlc,claude,1',
    '2026-05-06,task-1055,ai_sdlc,codex,0',
    '2026-05-06,task-1057,ai_sdlc,claude,2',
  ].join('\n'));

  const data = stats._internals.loadCsv(csv);

  assert.deepEqual(data.headers, ['date', 'mission', 'classification', 'implementer', 'pr_fix_rounds']);
  assert.equal(data.rows.length, 3);
  assert.deepEqual(data.rows[0], {
    date: '2026-05-06',
    mission: 'task-1054',
    classification: 'ai_sdlc',
    implementer: 'claude',
    pr_fix_rounds: '1',
  });
  assert.deepEqual(data.rows[1], {
    date: '2026-05-06',
    mission: 'task-1055',
    classification: 'ai_sdlc',
    implementer: 'codex',
    pr_fix_rounds: '0',
  });
  assert.deepEqual(data.rows[2], {
    date: '2026-05-06',
    mission: 'task-1057',
    classification: 'ai_sdlc',
    implementer: 'claude',
    pr_fix_rounds: '2',
  });
});

test('loadCsv correctly skips empty lines and only parses valid data rows', () => {
  const csv = writeCsv([
    'date,mission,classification,implementer,pr_fix_rounds',
    '',
    '2026-05-06,task-1054,ai_sdlc,claude,1',
    '',
    '2026-05-06,task-1055,ai_sdlc,codex,0',
    '   ',
    '2026-05-06,task-1057,ai_sdlc,claude,2',
    '',
  ].join('\n'));

  const data = stats._internals.loadCsv(csv);

  assert.deepEqual(data.headers, ['date', 'mission', 'classification', 'implementer', 'pr_fix_rounds']);
  assert.equal(data.rows.length, 3);
  assert.deepEqual(data.rows[0].mission, 'task-1054');
  assert.deepEqual(data.rows[1].mission, 'task-1055');
  assert.deepEqual(data.rows[2].mission, 'task-1057');
});

test('loadStatsCsv returns expected schema with cleaned data', () => {
  const csv = writeCsv([
    'date,mission,classification,implementer,pr_fix_rounds',
    '2026-05-06,task-1054,ai_sdlc,claude,1',
    '2026-05-06,task-1055,ai_sdlc,codex,0',
  ].join('\n'));

  const data = stats.loadStatsCsv(csv);

  // loadStatsCsv migrates legacy 5-column rows to the full 19-column schema
  // (task-1251): legacy columns preserved, new columns defaulted.
  assert.deepEqual(data.headers, stats.STATS_HEADERS);
  assert.equal(data.rows.length, 2);
  assert.deepEqual(data.rows[0], stats.normalizeStatsRow({
    date: '2026-05-06',
    mission: 'task-1054',
    classification: 'ai_sdlc',
    implementer: 'claude',
    pr_fix_rounds: '1',
  }));
});

test('loadStatsCsv handles missing file gracefully', () => {
  const nonExistentPath = '/tmp/non-existent-stats-' + Date.now() + '.csv';
  const data = stats.loadStatsCsv(nonExistentPath);

  assert.deepEqual(data.headers, stats.STATS_HEADERS);
  assert.equal(data.rows.length, 0);
});
