const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const stats = require('../lib/commands/stats');
const forgejo = require('../lib/tools/forgejo');
const gitLib = require('../lib/core/git');

function writeCsv(contents) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-stats-')), 'input.csv');
  fs.writeFileSync(file, contents, 'utf8');
  return file;
}

function createRepoFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-stats-fixture-'));
  fs.mkdirSync(path.join(root, 'backlog', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'missions', '2026', 'task-2000'), { recursive: true });
  return root;
}

// visualBoard's Ways of Working use Forgejo review. Tests that exercise
// PR-comment-based fix-round derivation declare it on their fixture (the code
// default is off for config-less distribution repos).
function enableForgejoReview(root) {
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
    adapters: { review: { provider: 'forgejo', baseUrl: 'http://localhost:3300', remote: 'review', repo: 'magnus/visualboard' } },
  }), 'utf8');
  return root;
}

test('stats report preserves merged/open counts for legacy merged/created_at CSVs', () => {
  const csv = writeCsv([
    'mission,implementer,reviewer,pr_link,review_count,merged,state,created_at',
    'task-1,codex,claude,http://example/pr/1,3,yes,merged,2026-05-01T10:00:00Z',
    'task-2,codex,claude,http://example/pr/2,0,no,open,2026-05-02T10:00:00Z',
  ].join('\n'));

  const report = stats._internals.generateMarkdownReport(stats._internals.loadCsv(csv), { groupBy: 'implementer' });

  assert.match(report, /- \*\*Merged:\*\* 1/);
  assert.match(report, /- \*\*Open\/Closed:\*\* 1/);
  assert.match(report, /\| codex \| 2 \| 1 \| 1 \| 3 \| 1\.50 \| 2\.00 \|/);
  assert.match(report, /\| task-1 \| codex \| claude \| 3 \| yes \| 2026-05-01 \|/);
});

test('stats report normalizes date/has_pr CSVs across summary, implementer, and period views', () => {
  const csv = writeCsv([
    'mission,date,implementer,reviewer,pr_link,review_count,has_pr,pr_numbers',
    'task-1,2026-05-10,gemini,codex,http://example/pr/1,4,yes,PR#1',
    'task-2,2026-05-11,gemini,none,no PR,0,no,—',
  ].join('\n'));

  const report = stats._internals.generateMarkdownReport(stats._internals.loadCsv(csv), { groupBy: 'period' });

  assert.match(report, /- \*\*Merged:\*\* 1/);
  assert.match(report, /- \*\*Open\/Closed:\*\* 1/);
  assert.match(report, /\| task-1 \| gemini \| codex \| 4 \| yes \| 2026-05-10 \|/);
  assert.match(report, /\| task-2 \| gemini \| none \| 0 \| no \| 2026-05-11 \|/);
  assert.match(report, /\| 2026-05-10 → 2026-05-11 \| 2 \| 2 \| 1 \| 1 \| 4 \| 2\.00 \|/);
});

test('upsertStatsRow writes the workflow stats schema and updates existing missions idempotently', () => {
  const csvFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-stats-upsert-')), 'stats.csv');

  const first = stats.upsertStatsRow({
    date: '2026-05-18',
    repo: 'parallix',
    mission: 'task-2000',
    classification: 'ai_sdlc',
    implementer: 'codex',
    pr_fix_rounds: 2,
  }, { filePath: csvFile });

  assert.equal(first.changed, true);
  assert.equal(first.data.rows.length, 1);
  assert.equal(fs.readFileSync(csvFile, 'utf8').split('\n')[0], stats.STATS_HEADERS.join(','));

  const second = stats.upsertStatsRow({
    date: '2026-05-18',
    repo: 'parallix',
    mission: 'task-2000',
    classification: 'ai_sdlc',
    implementer: 'codex',
    pr_fix_rounds: 2,
  }, { filePath: csvFile });
  assert.equal(second.changed, false);
  assert.equal(second.data.rows.length, 1);

  const third = stats.upsertStatsRow({
    date: '2026-05-18',
    repo: 'parallix',
    mission: 'task-2000',
    classification: 'ai_sdlc',
    implementer: 'codex',
    pr_fix_rounds: 3,
  }, { filePath: csvFile });
  assert.equal(third.changed, true);
  assert.equal(third.data.rows[0].pr_fix_rounds, '3');
});

test('task-1314: upsertStatsRow keys on (repo, mission, stage) so same mission in different repos stays distinct', () => {
  const csvFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-stats-repo-stage-')), 'stats.csv');

  stats.upsertStatsRow({
    date: '2026-06-07',
    repo: 'visualboard',
    mission: 'task-3000',
    classification: 'ai_sdlc',
    implementer: 'codex',
    stage: 'draft',
    input_tokens: '100',
  }, { filePath: csvFile });
  stats.upsertStatsRow({
    date: '2026-06-07',
    repo: 'parallix',
    mission: 'task-3000',
    classification: 'ai_sdlc',
    implementer: 'codex',
    stage: 'draft',
    input_tokens: '200',
  }, { filePath: csvFile });

  let data = stats.loadStatsCsv(csvFile);
  assert.equal(data.rows.length, 2);

  stats.upsertStatsRow({
    date: '2026-06-07',
    repo: 'visualboard',
    mission: 'task-3000',
    classification: 'ai_sdlc',
    implementer: 'codex',
    stage: 'draft',
    input_tokens: '999',
  }, { filePath: csvFile });
  data = stats.loadStatsCsv(csvFile);
  assert.equal(data.rows.length, 2);
  const visualboardRow = data.rows.find(r => r.repo === 'visualboard');
  const parallixRow = data.rows.find(r => r.repo === 'parallix');
  assert.equal(visualboardRow.input_tokens, '999');
  assert.equal(parallixRow.input_tokens, '200');
});

test('resolveMissionClassification returns unknown when no task file exists', () => {
  const root = createRepoFixture();
  try {
    const result = stats.resolveMissionClassification('task-missing', root);
    assert.deepEqual(result, { classification: 'unknown', taskFile: null });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('upsertStatsRow accepts unknown classification rows and weekly report counts them', () => {
  const csvFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-stats-unknown-')), 'stats.csv');
  stats.upsertStatsRow({
    date: '2026-06-23',
    repo: 'parallix',
    mission: 'task-unknown',
    classification: 'unknown',
    implementer: 'unknown',
    pr_fix_rounds: 0,
  }, { filePath: csvFile });

  const rows = stats.loadStatsCsv(csvFile).rows;
  const report = stats.renderWeeklyStatsReport(rows, { today: '2026-06-23' });
  assert.match(report, /# unknown missions/);
  assert.match(report, /\b1\b/);
});

test('resolveStatsCsvPath resolves configured stats CSV from target repo root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-stats-resolve-'));
  const csv = path.join(root, 'metrics', 'missions.csv');
  fs.mkdirSync(path.dirname(csv), { recursive: true });
  fs.writeFileSync(csv, 'date,mission,classification,implementer,pr_fix_rounds\n', 'utf8');

  try {
    const resolved = stats.resolveStatsCsvPath({
      rootDir: root,
      config: { adapters: { stats: { path: 'metrics/missions.csv' } } },
    });
    assert.equal(resolved, csv);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveStatsCsvPath falls back to repo-root stats CSV when target repo file is absent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-stats-missing-'));

  try {
    const resolved = stats.resolveStatsCsvPath({
      rootDir: root,
      config: { adapters: { stats: { path: 'missing-stats.csv' } } },
    });
    assert.equal(resolved, path.join(root, 'stats.csv'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveStatsCsvPath returns target repo path for writes even before stats CSV exists', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-stats-write-path-'));

  try {
    const resolved = stats.resolveStatsCsvPath({
      rootDir: root,
      config: { adapters: { stats: { path: 'new-stats.csv' } } },
      forWrite: true,
    });
    assert.equal(resolved, path.join(root, 'new-stats.csv'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveStatsPath migrates repo-root stats rows into an existing shared stats file', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-stats-migrate-root-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-stats-migrate-home-'));
  const previousHome = process.env.PARALLIX_HOME;
  const repoStatsPath = path.join(root, 'stats.csv');
  const sharedStatsPath = path.join(home, 'stats.csv');

  fs.writeFileSync(repoStatsPath, [
    'date,mission,classification,implementer,pr_fix_rounds',
    '2026-06-14,task-root,ai_sdlc,codex,0',
  ].join('\n'), 'utf8');
  stats.saveStatsCsv(sharedStatsPath, [
    { date: '2026-06-13', mission: 'task-shared', classification: 'user_value', implementer: 'gemini', pr_fix_rounds: '1' },
  ]);

  try {
    process.env.PARALLIX_HOME = home;
    const resolved = stats.resolveStatsPath({ rootDir: root });
    assert.equal(resolved, sharedStatsPath);
    const content = fs.readFileSync(sharedStatsPath, 'utf8');
    assert.match(content, /task-root/);
    assert.match(content, /task-shared/);
  } finally {
    if (previousHome === undefined) delete process.env.PARALLIX_HOME;
    else process.env.PARALLIX_HOME = previousHome;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('stats command defaults to shared PARALLIX_HOME stats across target repos', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-stats-command-default-'));
  const repoOne = path.join(root, 'repo-one');
  const repoTwo = path.join(root, 'repo-two');
  const home = path.join(root, 'parallix-home');
  const csv = path.join(home, 'stats.csv');
  fs.mkdirSync(repoOne);
  fs.mkdirSync(repoTwo);
  fs.mkdirSync(home);
  fs.writeFileSync(csv, [
    'date,mission,classification,implementer,pr_fix_rounds',
    '2026-05-18,task-shared,user_value,codex,1',
  ].join('\n'), 'utf8');
  const logs = [];
  const previousHome = process.env.PARALLIX_HOME;

  try {
    process.env.PARALLIX_HOME = home;
    stats(['--today', '2026-05-18'], {
      rootDir: repoOne,
      log: line => logs.push(line),
      error: line => logs.push(`ERR:${line}`),
      exit: code => {
        throw new Error(`unexpected exit ${code}`);
      },
    });

    const output = logs.join('\n');
    assert.match(output, new RegExp(`Loading CSV: ${csv.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.match(output, /Loaded \d+ rows/);
    assert.match(output, /Current week \(2026-05-12 → 2026-05-18\)/);

    const secondLogs = [];
    stats(['--today', '2026-05-18'], {
      rootDir: repoTwo,
      log: line => secondLogs.push(line),
      error: line => secondLogs.push(`ERR:${line}`),
      exit: code => {
        throw new Error(`unexpected exit ${code}`);
      },
    });
    assert.match(secondLogs.join('\n'), new RegExp(`Loading CSV: ${csv.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  } finally {
    if (previousHome === undefined) delete process.env.PARALLIX_HOME;
    else process.env.PARALLIX_HOME = previousHome;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('renderWeeklyStatsReport calculates current and previous seven-day windows from injected today', () => {
  const report = stats.renderWeeklyStatsReport([
    { date: '2026-05-18', mission: 'task-a', classification: 'ai_sdlc', implementer: 'codex', pr_fix_rounds: '2' },
    { date: '2026-05-12', mission: 'task-b', classification: 'user_value', implementer: 'gemini', pr_fix_rounds: '1' },
    { date: '2026-05-11', mission: 'task-c', classification: 'ai_sdlc', implementer: 'claude', pr_fix_rounds: '4' },
    { date: '2026-05-05', mission: 'task-d', classification: 'user_value', implementer: 'qwen', pr_fix_rounds: '0' },
  ], { today: '2026-05-18' });

  assert.match(report, /Current week \(2026-05-12 → 2026-05-18\)/);
  assert.match(report, /Previous week \(2026-05-05 → 2026-05-11\)/);
  assert.match(report, /# missions\s+# user value missions\s+# AI SDLC missions/);
  assert.match(report, /2\s+1\s+1/);
  assert.match(report, /2\s+1\s+1/);
  assert.match(report, /Agent performance this week \(2026-05-12 → 2026-05-18\)/);
  assert.match(report, /codex\s+1\s+2\.00/);
  assert.match(report, /gemini\s+1\s+1\.00/);
  assert.match(report, /Agent performance previous week \(2026-05-05 → 2026-05-11\)/);
  assert.match(report, /claude\s+1\s+4\.00/);
  assert.match(report, /qwen \(opencode\)\s+1\s+0\.00/);
});

test('renderRangeStatsReport filters inclusive boundary dates and summarizes mission counts', () => {
  const report = stats.renderRangeStatsReport([
    { date: '2026-04-30', mission: 'task-before', classification: 'ai_sdlc', implementer: 'codex', pr_fix_rounds: '9' },
    { date: '2026-05-01', mission: 'task-start', classification: 'ai_sdlc', implementer: 'codex', pr_fix_rounds: '2' },
    { date: '2026-05-15', mission: 'task-middle', classification: 'user_value', implementer: 'gemini', pr_fix_rounds: '1' },
    { date: '2026-05-31', mission: 'task-end', classification: 'user_value', implementer: 'codex', pr_fix_rounds: '4' },
    { date: '2026-06-01', mission: 'task-after', classification: 'user_value', implementer: 'claude', pr_fix_rounds: '0' },
  ], { from: '2026-05-01', to: '2026-05-31' });

  const plain = require('../lib/core/fmt').stripAnsi(report);
  assert.match(plain, /Missions \(2026-05-01 → 2026-05-31\)/);
  assert.match(plain, /# missions\s+# user value missions\s+# AI SDLC missions/);
  assert.match(plain, /3\s+2\s+1/);
  assert.match(plain, /Agent performance \(2026-05-01 → 2026-05-31\)/);
  assert.match(plain, /codex\s+2\s+3\.00/);
  assert.match(plain, /gemini\s+1\s+1\.00/);
  assert.doesNotMatch(plain, /claude/);
});

test('renderRangeStatsReport rejects missing, malformed, and inverted range arguments', () => {
  assert.throws(
    () => stats.renderRangeStatsReport([], { to: '2026-05-31' }),
    /Invalid date range argument --from/
  );
  assert.throws(
    () => stats.renderRangeStatsReport([], { from: '2026-05-01' }),
    /Invalid date range argument --to/
  );
  assert.throws(
    () => stats.renderRangeStatsReport([], { from: '2026-05-32', to: '2026-06-01' }),
    /Invalid date range argument --from/
  );
  assert.throws(
    () => stats.renderRangeStatsReport([], { from: '2026-06-01', to: '2026-05-31' }),
    /Invalid date range argument --from\/--to/
  );
});

test('renderWeeklyStatsReport sorts agent tables alphabetically by family name', () => {
  const report = stats.renderWeeklyStatsReport([
    { date: '2026-05-18', mission: 'task-a', classification: 'ai_sdlc', implementer: 'gemini', pr_fix_rounds: '2' },
    { date: '2026-05-17', mission: 'task-b', classification: 'ai_sdlc', implementer: 'claude', pr_fix_rounds: '1' },
    { date: '2026-05-16', mission: 'task-c', classification: 'ai_sdlc', implementer: 'codex', pr_fix_rounds: '3' },
  ], { today: '2026-05-18' });

  const plain = require('../lib/core/fmt').stripAnsi(report);
  const claudeIndex = plain.indexOf('claude');
  const codexIndex = plain.indexOf('codex');
  const geminiIndex = plain.indexOf('gemini');

  assert.ok(claudeIndex !== -1);
  assert.ok(codexIndex !== -1);
  assert.ok(geminiIndex !== -1);
  assert.ok(claudeIndex < codexIndex);
  assert.ok(codexIndex < geminiIndex);
});

test('renderWeeklyStatsReport colors best and worst average fix rounds', () => {
  process.env.FORCE_COLOR = '1';
  const report = stats.renderWeeklyStatsReport([
    { date: '2026-05-18', mission: 'task-a', classification: 'ai_sdlc', implementer: 'claude', pr_fix_rounds: '4' },
    { date: '2026-05-17', mission: 'task-b', classification: 'ai_sdlc', implementer: 'codex', pr_fix_rounds: '2' },
    { date: '2026-05-16', mission: 'task-c', classification: 'ai_sdlc', implementer: 'gemini', pr_fix_rounds: '0' },
  ], { today: '2026-05-18' });

  assert.match(report, /\x1b\[31m4\.00\x1b\[39m/);
  assert.match(report, /\x1b\[33m2\.00\x1b\[39m/);
  assert.match(report, /\x1b\[32m0\.00\x1b\[39m/);
});

test('renderWeeklyStatsReport colors best and worst mission counts', () => {
  process.env.FORCE_COLOR = '1';
  const report = stats.renderWeeklyStatsReport([
    { date: '2026-05-18', mission: 'task-a', classification: 'ai_sdlc', implementer: 'claude', pr_fix_rounds: '1' },
    { date: '2026-05-17', mission: 'task-b', classification: 'ai_sdlc', implementer: 'codex', pr_fix_rounds: '1' },
    { date: '2026-05-16', mission: 'task-c', classification: 'ai_sdlc', implementer: 'codex', pr_fix_rounds: '1' },
    { date: '2026-05-15', mission: 'task-d', classification: 'ai_sdlc', implementer: 'gemini', pr_fix_rounds: '1' },
    { date: '2026-05-14', mission: 'task-e', classification: 'ai_sdlc', implementer: 'gemini', pr_fix_rounds: '1' },
    { date: '2026-05-13', mission: 'task-f', classification: 'ai_sdlc', implementer: 'gemini', pr_fix_rounds: '1' },
  ], { today: '2026-05-18' });

  assert.match(report, /\x1b\[34mclaude\x1b\[39m\s+\x1b\[31m1\x1b\[39m/);
  assert.match(report, /\x1b\[35mcodex\x1b\[39m\s+\x1b\[33m2\x1b\[39m/);
  assert.match(report, /\x1b\[36mgemini\x1b\[39m\s+\x1b\[32m3\x1b\[39m/);
});

test('stats command prints workflow weekly tables from the integration stats schema', () => {
  const csv = writeCsv([
    'date,mission,classification,implementer,pr_fix_rounds',
    '2026-05-18,task-a,ai_sdlc,codex,2',
    '2026-05-12,task-b,user_value,gemini,1',
    '2026-05-11,task-c,ai_sdlc,claude,4',
  ].join('\n'));
  const logs = [];

  stats(['--csv-file', csv, '--today', '2026-05-18'], {
    log: line => logs.push(line),
    error: line => logs.push(`ERR:${line}`),
    exit: code => {
      throw new Error(`unexpected exit ${code}`);
    },
  });

  const output = logs.join('\n');
  assert.match(output, /Current week \(2026-05-12 → 2026-05-18\)/);
  assert.match(output, /Previous week \(2026-05-05 → 2026-05-11\)/);
  assert.match(output, /Agent performance this week \(2026-05-12 → 2026-05-18\)/);
});

test('stats --csv-file does not initialize PARALLIX_HOME', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-stats-explicit-'));
  const home = path.join(root, 'parallix-home');
  const csv = path.join(root, 'explicit.csv');
  fs.writeFileSync(csv, 'date,mission,classification,implementer,pr_fix_rounds\n');
  const previousHome = process.env.PARALLIX_HOME;
  try {
    process.env.PARALLIX_HOME = home;
    stats(['--csv-file', csv], {
      log: () => {},
      error: message => {
        throw new Error(message);
      },
      exit: code => {
        throw new Error(`unexpected exit ${code}`);
      }
    });
    assert.equal(fs.existsSync(home), false);
  } finally {
    if (previousHome === undefined) delete process.env.PARALLIX_HOME;
    else process.env.PARALLIX_HOME = previousHome;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('stats command prints workflow arbitrary range tables from the integration stats schema', () => {
  const csv = writeCsv([
    'date,mission,classification,implementer,pr_fix_rounds',
    '2026-04-30,task-before,user_value,claude,5',
    '2026-05-01,task-start,ai_sdlc,codex,2',
    '2026-05-20,task-mid,user_value,gemini,1',
    '2026-05-31,task-end,user_value,codex,4',
    '2026-06-01,task-after,ai_sdlc,qwen,0',
  ].join('\n'));
  const logs = [];

  stats(['--csv-file', csv, '--from', '2026-05-01', '--to', '2026-05-31'], {
    log: line => logs.push(line),
    error: line => logs.push(`ERR:${line}`),
    exit: code => {
      throw new Error(`unexpected exit ${code}`);
    },
  });

  const output = require('../lib/core/fmt').stripAnsi(logs.join('\n'));
  assert.match(output, /Missions \(2026-05-01 → 2026-05-31\)/);
  assert.match(output, /3\s+2\s+1/);
  assert.match(output, /Agent performance \(2026-05-01 → 2026-05-31\)/);
  assert.match(output, /codex\s+2\s+3\.00/);
  assert.match(output, /gemini\s+1\s+1\.00/);
  assert.doesNotMatch(output, /task-before/);
  assert.doesNotMatch(output, /Current week/);
});

test('stats command does not treat --today value as a positional CSV path', () => {
  const csv = writeCsv([
    'date,mission,classification,implementer,pr_fix_rounds',
    '2026-05-18,task-a,ai_sdlc,codex,2',
  ].join('\n'));
  const outputFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-stats-output-')), 'report.txt');
  const logs = [];

  stats(['--csv-file', csv, '--today', '2026-05-18', '--output', outputFile], {
    log: line => logs.push(line),
    error: line => logs.push(`ERR:${line}`),
    exit: code => {
      throw new Error(`unexpected exit ${code}`);
    },
  });

  const output = logs.join('\n');
  assert.match(output, new RegExp(`Report written to ${outputFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  fs.rmSync(path.dirname(outputFile), { recursive: true, force: true });
});

test('stats command writes arbitrary range report to --output without printing report body', () => {
  const csv = writeCsv([
    'date,mission,classification,implementer,pr_fix_rounds',
    '2026-05-18,task-a,ai_sdlc,codex,2',
  ].join('\n'));
  const outputFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-stats-range-output-')), 'report.txt');
  const logs = [];

  stats(['--csv-file', csv, '--from', '2026-05-01', '--to', '2026-05-31', '--output', outputFile], {
    log: line => logs.push(line),
    error: line => logs.push(`ERR:${line}`),
    exit: code => {
      throw new Error(`unexpected exit ${code}`);
    },
  });

  const stdout = require('../lib/core/fmt').stripAnsi(logs.join('\n'));
  assert.match(stdout, new RegExp(`Report written to ${outputFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.doesNotMatch(stdout, /Missions \(2026-05-01 → 2026-05-31\)/);
  assert.match(fs.readFileSync(outputFile, 'utf8'), /Missions \(2026-05-01 → 2026-05-31\)/);
  fs.rmSync(path.dirname(outputFile), { recursive: true, force: true });
});

test('stats command exits non-zero and prints date-range diagnostics for invalid range flags', () => {
  const csv = writeCsv([
    'date,mission,classification,implementer,pr_fix_rounds',
    '2026-05-18,task-a,ai_sdlc,codex,2',
  ].join('\n'));
  const logs = [];
  const exits = [];

  stats(['--csv-file', csv, '--from', '2026-05-01'], {
    log: line => logs.push(line),
    error: line => logs.push(`ERR:${line}`),
    exit: code => exits.push(code),
  });

  stats(['--csv-file', csv, '--from', '2026-06-01', '--to', '2026-05-31'], {
    log: line => logs.push(line),
    error: line => logs.push(`ERR:${line}`),
    exit: code => exits.push(code),
  });

  const output = logs.join('\n');
  assert.deepEqual(exits, [1, 1]);
  assert.match(output, /Invalid date range argument --to/);
  assert.match(output, /Invalid date range argument --from\/--to/);
});

test('stats command keeps legacy retrospective CSVs on the markdown report path when range flags are present', () => {
  const csv = writeCsv([
    'mission,implementer,reviewer,pr_link,review_count,merged,state,created_at',
    'task-1,codex,claude,http://example/pr/1,3,yes,merged,2026-05-01T10:00:00Z',
  ].join('\n'));
  const logs = [];

  stats(['--csv-file', csv, '--from', '2026-05-01', '--to', '2026-05-31'], {
    log: line => logs.push(line),
    error: line => logs.push(`ERR:${line}`),
    exit: code => {
      throw new Error(`unexpected exit ${code}`);
    },
  });

  const output = logs.join('\n');
  assert.match(output, /# Forgejo Stats Report/);
  assert.doesNotMatch(output, /Missions \(2026-05-01 → 2026-05-31\)/);
});

test('stats command help documents the pre-integration preview workflow', () => {
  const logs = [];

  stats(['--help'], {
    log: line => logs.push(line),
    error: line => logs.push(`ERR:${line}`),
    exit: code => {
      throw new Error(`unexpected exit ${code}`);
    },
  });

  const output = logs.join('\n');
  assert.match(output, /Usage: px stats/);
  assert.match(output, /px stats --today 2026-05-18/);
  assert.match(output, /px stats --from 2026-05-01 --to 2026-05-31/);
  assert.match(output, /Workflow-owned stats CSVs print the current\/previous-week summary tables by default/);
});

test('recordIntegrationStats reads backlog classification and review-state final implementer/fix rounds', () => {
  const root = createRepoFixture();
  try {
    const taskFile = path.join(root, 'backlog', 'tasks', 'task-2000 - Example.md');
    fs.writeFileSync(taskFile, [
      '---',
      'id: TASK-2000',
      'labels: [ai_sdlc]',
      'assignee: [codex]',
      'status: review',
      '---',
      '',
      '## Description',
      '',
      'Example.',
      '',
    ].join('\n'));

    fs.writeFileSync(
      path.join(root, 'docs', 'missions', '2026', 'task-2000', 'review-state.json'),
      JSON.stringify({ reviewer: 'claude', implementer: 'gemini', round: 4, startedAt: '2026-05-18T10:00:00Z' }, null, 2)
    );

    const csvFile = path.join(root, 'workflow', 'data', 'stats.csv');
    const result = stats.recordIntegrationStats({
      slug: 'task-2000',
      rootDir: root,
      filePath: csvFile,
      date: '2026-05-18',
    });
    const repoName = stats.resolveStatsRepoName(root);

    assert.equal(result.row.classification, 'ai_sdlc');
    assert.equal(result.row.implementer, 'gemini');
    assert.equal(result.row.pr_fix_rounds, '3');
    assert.equal(result.row.repo, repoName);
    assert.equal(result.metadataSource.implementer, 'review-state');
    assert.match(fs.readFileSync(csvFile, 'utf8'), new RegExp(`2026-05-18,${repoName},task-2000,ai_sdlc,gemini,3`));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveStatsFilePath is the parallix-owned shared path, independent of any consuming repo (task-1246)', () => {
  const previousHome = process.env.PARALLIX_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'px-stats-home-'));
  const repoA = fs.mkdtempSync(path.join(os.tmpdir(), 'px-stats-resolve-a-'));
  const repoB = fs.mkdtempSync(path.join(os.tmpdir(), 'px-stats-resolve-b-'));
  try {
    process.env.PARALLIX_HOME = home;
    assert.equal(stats.resolveStatsFilePath(), path.join(home, 'stats.csv'));
    assert.equal(stats.resolveStatsFilePath(repoA), stats.resolveStatsFilePath(repoB));
    assert.notEqual(stats.resolveStatsFilePath(repoA), path.join(repoA, 'workflow', 'data', 'stats.csv'));
    assert.notEqual(stats.resolveStatsFilePath(repoB), path.join(repoB, 'workflow', 'data', 'stats.csv'));
  } finally {
    if (previousHome === undefined) delete process.env.PARALLIX_HOME;
    else process.env.PARALLIX_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repoA, { recursive: true, force: true });
    fs.rmSync(repoB, { recursive: true, force: true });
  }
});

test('two non-shared target repos upsert into one shared parallix-owned stats file (task-1246)', () => {
  // Two distinct target repos with separate .git directories must resolve to the
  // same parallix-owned stats source when driven by the same runtime. The path
  // is computed via resolveStatsFilePath(runtimeRoot), not derived from either
  // target repo root, proving the production resolver drives location.
  const repoA = fs.mkdtempSync(path.join(os.tmpdir(), 'px-stats-share-a-'));
  const repoB = fs.mkdtempSync(path.join(os.tmpdir(), 'px-stats-share-b-'));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'px-stats-home-'));
  const previousHome = process.env.PARALLIX_HOME;
  try {
    process.env.PARALLIX_HOME = home;
    fs.writeFileSync(path.join(repoA, 'workflow.config.json'), JSON.stringify({
      product: { name: 'visualboard' },
    }), 'utf8');
    fs.writeFileSync(path.join(repoB, 'workflow.config.json'), JSON.stringify({
      product: { name: 'parallix' },
    }), 'utf8');
    fs.writeFileSync(
      path.join(home, 'stats.csv'),
      'date,repo,mission,classification,implementer,pr_fix_rounds\n'
    );
    fs.mkdirSync(path.join(repoA, '.git'));
    fs.mkdirSync(path.join(repoB, '.git'));

    const sharedStatsFile = stats.resolveStatsFilePath(repoA);
    assert.equal(stats.resolveStatsFilePath(repoB), sharedStatsFile);

    // Each target repo records one agent-performance row through the resolver.
    stats.upsertStatsRow(
      { date: '2026-05-18', mission: 'task-a', classification: 'ai_sdlc', implementer: 'codex', pr_fix_rounds: '1' },
      { filePath: sharedStatsFile, rootDir: repoA }
    );
    stats.upsertStatsRow(
      { date: '2026-05-19', mission: 'task-b', classification: 'user_value', implementer: 'gemini', pr_fix_rounds: '2' },
      { filePath: sharedStatsFile, rootDir: repoB }
    );

    const loaded = stats.loadStatsCsv(sharedStatsFile, { rootDir: repoA });
    // Seed file is included in migration, so rows >= 2 (2 upserted + seed rows).
    assert.ok(loaded.rows.length >= 2);
    assert.ok(loaded.rows.map(r => r.mission).sort().includes('task-a'));
    assert.ok(loaded.rows.map(r => r.mission).sort().includes('task-b'));
    assert.equal(loaded.rows.find(r => r.mission === 'task-a').repo, 'visualboard');
    assert.equal(loaded.rows.find(r => r.mission === 'task-b').repo, 'parallix');

    assert.equal(sharedStatsFile, path.join(home, 'stats.csv'));

    // No per-repo stats file was created under either consuming repo.
    assert.equal(fs.existsSync(path.join(repoA, 'workflow', 'data', 'stats.csv')), false);
    assert.equal(fs.existsSync(path.join(repoB, 'workflow', 'data', 'stats.csv')), false);
  } finally {
    if (previousHome === undefined) delete process.env.PARALLIX_HOME;
    else process.env.PARALLIX_HOME = previousHome;
    fs.rmSync(repoA, { recursive: true, force: true });
    fs.rmSync(repoB, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('recordIntegrationStats returns the unchanged weekly report labels for integration output', () => {
  const root = createRepoFixture();
  try {
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

    const csvFile = path.join(root, 'workflow', 'data', 'stats.csv');
    stats.saveStatsCsv(csvFile, [
      { date: '2026-05-12', mission: 'task-1000', classification: 'user_value', implementer: 'gemini', pr_fix_rounds: '1' },
      { date: '2026-05-11', mission: 'task-0999', classification: 'ai_sdlc', implementer: 'claude', pr_fix_rounds: '2' },
    ]);

    const result = stats.recordIntegrationStats({
      slug: 'task-2000',
      rootDir: root,
      filePath: csvFile,
      date: '2026-05-18',
    });

    const report = require('../lib/core/fmt').stripAnsi(result.report);
    assert.match(report, /Current week \(2026-05-12 → 2026-05-18\)/);
    assert.match(report, /Previous week \(2026-05-05 → 2026-05-11\)/);
    assert.match(report, /Agent performance this week \(2026-05-12 → 2026-05-18\)/);
    assert.match(report, /Agent performance previous week \(2026-05-05 → 2026-05-11\)/);
    assert.match(report, /# missions\s+# user value missions\s+# AI SDLC missions/);
    assert.match(report, /Agent family\s+# missions as implementer\s+Average PR fix rounds to complete mission/);
    assert.doesNotMatch(report, /Missions \(2026-05-12 → 2026-05-18\)/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('recordIntegrationStats counts only final implementer review-state rounds after handoff', (t) => {
  const root = createRepoFixture();
  t.mock.method(gitLib, 'git', (args) => {
    if (args[3] === '--format=%s') {
      assert.deepEqual(args, ['-C', root, 'log', '--format=%s', 'mission/task-2000']);
      return {
        status: 0,
        stdout: [
          'review-state(task-2000): round 4 (claude reviewing gemini)',
          'checkpoint(task-2000): CP-2',
          'review-state(task-2000): round 3 (claude reviewing gemini)',
          'backlog(task-2000): transition to active and implementer=gemini',
          'review-state(task-2000): round 2 (claude reviewing codex)',
          'backlog(task-2000): transition to active and implementer=codex',
          'review-state(task-2000): round 1 (claude reviewing codex)',
        ].join('\n'),
        stderr: '',
      };
    }

    assert.deepEqual(args, ['-C', root, 'log', '--reverse', '--format=%s', 'mission/task-2000']);
    return {
      status: 0,
      stdout: [
        'review-state(task-2000): round 1 (claude reviewing codex)',
        'backlog(task-2000): transition to active and implementer=codex',
        'review-state(task-2000): round 2 (claude reviewing codex)',
        'backlog(task-2000): transition to active and implementer=gemini',
        'review-state(task-2000): round 3 (claude reviewing gemini)',
        'checkpoint(task-2000): CP-2',
        'review-state(task-2000): round 4 (claude reviewing gemini)',
      ].join('\n'),
      stderr: '',
    };
  });

  try {
    const taskFile = path.join(root, 'backlog', 'tasks', 'task-2000 - Example.md');
    fs.writeFileSync(taskFile, [
      '---',
      'id: TASK-2000',
      'labels: [ai_sdlc]',
      'assignee: [gemini]',
      'status: review',
      '---',
      '',
    ].join('\n'));

    fs.writeFileSync(
      path.join(root, 'docs', 'missions', '2026', 'task-2000', 'review-state.json'),
      JSON.stringify({ reviewer: 'claude', implementer: 'gemini', round: 4, startedAt: '2026-05-18T10:00:00Z' }, null, 2)
    );

    const csvFile = path.join(root, 'workflow', 'data', 'stats.csv');
    const result = stats.recordIntegrationStats({
      slug: 'task-2000',
      rootDir: root,
      filePath: csvFile,
      date: '2026-05-18',
    });

    assert.equal(result.row.implementer, 'gemini');
    assert.equal(result.row.pr_fix_rounds, '1');
    assert.equal(result.metadataSource.implementer, 'branch-history');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('recordIntegrationStats prefers branch-history implementer when review-state is stale', (t) => {
  const root = createRepoFixture();
  t.mock.method(gitLib, 'git', (args) => {
    if (args[3] === '--format=%s') {
      return {
        status: 0,
        stdout: [
          'mission/task-2000: task-2000',
          'review-state(task-2000): round 1 (codex reviewing qwen)',
          'backlog(task-2000): transition to review and implementer=claude',
          'backlog(task-2000): transition to active and implementer=claude',
        ].join('\n'),
        stderr: '',
      };
    }
    throw new Error(`unexpected git args: ${JSON.stringify(args)}`);
  });

  try {
    const taskFile = path.join(root, 'backlog', 'tasks', 'task-2000 - Example.md');
    fs.writeFileSync(taskFile, [
      '---',
      'id: TASK-2000',
      'labels: [user_value]',
      'assignee: [claude]',
      'status: review',
      '---',
      '',
    ].join('\n'));

    fs.writeFileSync(
      path.join(root, 'docs', 'missions', '2026', 'task-2000', 'review-state.json'),
      JSON.stringify({ reviewer: 'codex', implementer: 'qwen', round: 1, startedAt: '2026-05-18T10:00:00Z' }, null, 2)
    );

    const csvFile = path.join(root, 'workflow', 'data', 'stats.csv');
    const result = stats.recordIntegrationStats({
      slug: 'task-2000',
      rootDir: root,
      filePath: csvFile,
      date: '2026-05-18',
    });

    assert.equal(result.row.implementer, 'claude');
    assert.equal(result.row.pr_fix_rounds, '0');
    assert.equal(result.metadataSource.implementer, 'branch-history');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('recordIntegrationStats prefers PR round-resolution comments for final implementer handoffs', (t) => {
  const root = createRepoFixture();
  enableForgejoReview(root);
  t.mock.method(forgejo, 'readToken', () => 'token');
  t.mock.method(forgejo, 'resolveForgejoUser', () => 'codex');
  t.mock.method(forgejo, 'getCommentsSync', (branch, token) => {
    assert.equal(branch, 'mission/task-2000');
    assert.equal(token, 'token');
    return [
      { kind: 'issue-comment', user: 'qwen', body: '## Round 1 Resolution Summary' },
      { kind: 'issue-comment', user: 'qwen', body: '## Round 2 Resolution Summary' },
      { kind: 'issue-comment', user: 'claude', body: '## Round 3 Resolution Summary' },
    ];
  });
  t.mock.method(gitLib, 'git', () => ({ status: 1, stdout: '', stderr: '' }));

  try {
    const taskFile = path.join(root, 'backlog', 'tasks', 'task-2000 - Example.md');
    fs.writeFileSync(taskFile, [
      '---',
      'id: TASK-2000',
      'labels: [ai_sdlc]',
      'assignee: [qwen]',
      'status: review',
      '---',
      '',
    ].join('\n'));

    fs.writeFileSync(
      path.join(root, 'docs', 'missions', '2026', 'task-2000', 'review-state.json'),
      JSON.stringify({ reviewer: 'codex', implementer: 'qwen', round: 3, startedAt: '2026-05-18T10:00:00Z' }, null, 2)
    );

    const csvFile = path.join(root, 'workflow', 'data', 'stats.csv');
    const result = stats.recordIntegrationStats({
      slug: 'task-2000',
      rootDir: root,
      filePath: csvFile,
      date: '2026-05-18',
    });

    assert.equal(result.row.implementer, 'claude');
    assert.equal(result.row.pr_fix_rounds, '1');
    assert.equal(result.metadataSource.implementer, 'pr-comments');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('recordIntegrationStats derives non-standard resolution rounds from review events and ignores stale correction reposts', (t) => {
  const root = createRepoFixture();
  enableForgejoReview(root);
  t.mock.method(forgejo, 'readToken', () => 'token');
  t.mock.method(forgejo, 'resolveForgejoUser', () => 'codex');
  t.mock.method(forgejo, 'getCommentsSync', (branch, token) => {
    assert.equal(branch, 'mission/task-2000');
    assert.equal(token, 'token');
    return [
      { kind: 'issue-comment', user: 'codex', body: '### Finding: first blocker' },
      { kind: 'review [stale, dismissed]', state: 'REQUEST_CHANGES', user: 'codex', body: 'request changes round 1' },
      { kind: 'issue-comment', user: 'claude', body: '## Round resolution — act-on-review (claude)' },
      { kind: 'issue-comment', user: 'codex', body: '1. HIGH — second blocker' },
      { kind: 'review [stale, dismissed]', state: 'REQUEST_CHANGES', user: 'codex', body: 'request changes round 2' },
      { kind: 'issue-comment', user: 'claude', body: '## Round resolution — act-on-review (claude)' },
      { kind: 'issue-comment', user: 'claude', body: '## Round resolution — act-on-review (claude) — CORRECTION\n\nIgnore the prior comment and treat this one as authoritative.' },
      { kind: 'review', state: 'APPROVED', user: 'codex', body: 'approved' },
    ];
  });
  t.mock.method(gitLib, 'git', () => ({ status: 1, stdout: '', stderr: '' }));

  try {
    const taskFile = path.join(root, 'backlog', 'tasks', 'task-2000 - Example.md');
    fs.writeFileSync(taskFile, [
      '---',
      'id: TASK-2000',
      'labels: [ai_sdlc]',
      'assignee: [gemini]',
      'status: review',
      '---',
      '',
    ].join('\n'));

    fs.writeFileSync(
      path.join(root, 'docs', 'missions', '2026', 'task-2000', 'review-state.json'),
      JSON.stringify({ reviewer: 'codex', implementer: 'gemini', round: 2, startedAt: '2026-05-18T10:00:00Z' }, null, 2)
    );

    const csvFile = path.join(root, 'workflow', 'data', 'stats.csv');
    const result = stats.recordIntegrationStats({
      slug: 'task-2000',
      rootDir: root,
      filePath: csvFile,
      date: '2026-05-18',
    });

    assert.equal(result.row.implementer, 'claude');
    assert.equal(result.row.pr_fix_rounds, '2');
    assert.equal(result.metadataSource.implementer, 'pr-comments');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('recordIntegrationStats ignores reviewer round headings and counts only explicit resolution comments', (t) => {
  const root = createRepoFixture();
  enableForgejoReview(root);
  t.mock.method(forgejo, 'readToken', () => 'token');
  t.mock.method(forgejo, 'resolveForgejoUser', () => 'codex');
  t.mock.method(forgejo, 'getCommentsSync', (branch, token) => {
    assert.equal(branch, 'mission/task-2000');
    assert.equal(token, 'token');
    return [
      { kind: 'issue-comment', user: 'claude', body: '# Review Round 1 — task-2000' },
      { kind: 'review [stale, dismissed]', state: 'APPROVED', user: 'claude', body: 'approved' },
      { kind: 'issue-comment', user: 'claude', body: '# Review Round 2 — task-2000' },
      { kind: 'issue-comment', user: 'codex', body: '# Review round 2 resolution summary' },
      { kind: 'issue-comment', user: 'claude', body: '# Review Round 3 — task-2000' },
      { kind: 'issue-comment', user: 'codex', body: '# Review round 3 resolution summary' },
      { kind: 'review', state: 'APPROVED', user: 'claude', body: 'approved' },
    ];
  });
  t.mock.method(gitLib, 'git', () => ({ status: 1, stdout: '', stderr: '' }));

  try {
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

    const csvFile = path.join(root, 'workflow', 'data', 'stats.csv');
    const result = stats.recordIntegrationStats({
      slug: 'task-2000',
      rootDir: root,
      filePath: csvFile,
      date: '2026-05-18',
    });

    assert.equal(result.row.implementer, 'codex');
    assert.equal(result.row.pr_fix_rounds, '2');
    assert.equal(result.metadataSource.implementer, 'pr-comments');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('recordIntegrationStats counts review-attempt resolution comments as fix rounds', (t) => {
  const root = createRepoFixture();
  enableForgejoReview(root);
  t.mock.method(forgejo, 'readToken', () => 'token');
  t.mock.method(forgejo, 'resolveForgejoUser', () => 'codex');
  t.mock.method(forgejo, 'getCommentsSync', (branch, token) => {
    assert.equal(branch, 'mission/task-2000');
    assert.equal(token, 'token');
    return [
      { kind: 'issue-comment', user: 'codex', body: 'Review attempt 1 by codex.\n\nFindings:' },
      { kind: 'issue-comment', user: 'gemini', body: '# Review Attempt 1 Resolution - task-2000' },
      { kind: 'issue-comment', user: 'codex', body: 'Review attempt 2 by codex.\n\nFindings:' },
      { kind: 'issue-comment', user: 'gemini', body: '# Review Attempt 2 Resolution - task-2000' },
      { kind: 'issue-comment', user: 'codex', body: '# Review Attempt 3 Findings' },
      { kind: 'issue-comment', user: 'gemini', body: '# Review Attempt 3 Resolution - task-2000' },
      { kind: 'issue-comment', user: 'codex', body: '# Review Attempt 4 Findings\n\nFindings: none.' },
    ];
  });
  t.mock.method(gitLib, 'git', () => ({ status: 1, stdout: '', stderr: '' }));

  try {
    const taskFile = path.join(root, 'backlog', 'tasks', 'task-2000 - Example.md');
    fs.writeFileSync(taskFile, [
      '---',
      'id: TASK-2000',
      'labels: [ai_sdlc]',
      'assignee: [gemini]',
      'status: review',
      '---',
      '',
    ].join('\n'));

    const csvFile = path.join(root, 'workflow', 'data', 'stats.csv');
    const result = stats.recordIntegrationStats({
      slug: 'task-2000',
      rootDir: root,
      filePath: csvFile,
      date: '2026-05-18',
    });

    assert.equal(result.row.implementer, 'gemini');
    assert.equal(result.row.pr_fix_rounds, '3');
    assert.equal(result.metadataSource.implementer, 'pr-comments');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('recordIntegrationStats uses bounded backlog fallback when review-state is missing', () => {
  const root = createRepoFixture();
  try {
    const taskFile = path.join(root, 'backlog', 'tasks', 'task-2000 - Example.md');
    fs.writeFileSync(taskFile, [
      '---',
      'id: TASK-2000',
      'labels: [user_value]',
      'assignee: [claude]',
      'status: review',
      '---',
      '',
      '## Notes',
      '',
      'Review round 3 fix completed.',
      '',
    ].join('\n'));

    const csvFile = path.join(root, 'workflow', 'data', 'stats.csv');
    const result = stats.recordIntegrationStats({
      slug: 'task-2000',
      rootDir: root,
      filePath: csvFile,
      date: '2026-05-18',
    });

    assert.equal(result.row.classification, 'user_value');
    assert.equal(result.row.implementer, 'claude');
    assert.equal(result.row.pr_fix_rounds, '2');
    assert.equal(result.metadataSource.implementer, 'backlog-fallback');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('recordIntegrationStats prefers PR comments over branch history for final implementer handoffs', (t) => {
  const root = createRepoFixture();
  enableForgejoReview(root);
  t.mock.method(forgejo, 'readToken', () => 'token');
  t.mock.method(forgejo, 'resolveForgejoUser', () => 'codex');
  t.mock.method(forgejo, 'getCommentsSync', (branch, token) => {
    assert.equal(branch, 'mission/task-2000');
    assert.equal(token, 'token');
    return [
      { kind: 'issue-comment', user: 'claude', body: '## Round 1 Resolution Summary' },
      { kind: 'issue-comment', user: 'claude', body: '## Round 2 Resolution Summary' },
    ];
  });
  t.mock.method(gitLib, 'git', (args) => {
    if (args[3] === '--format=%s') {
      return {
        status: 0,
        stdout: [
          'mission/task-2000: task-2000',
          'backlog(task-2000): transition to active and implementer=qwen',
        ].join('\n'),
        stderr: '',
      };
    }
    throw new Error(`unexpected git args: ${JSON.stringify(args)}`);
  });

  try {
    const taskFile = path.join(root, 'backlog', 'tasks', 'task-2000 - Example.md');
    fs.writeFileSync(taskFile, [
      '---',
      'id: TASK-2000',
      'labels: [ai_sdlc]',
      'assignee: [qwen]',
      'status: review',
      '---',
      '',
    ].join('\n'));

    const csvFile = path.join(root, 'workflow', 'data', 'stats.csv');
    const result = stats.recordIntegrationStats({
      slug: 'task-2000',
      rootDir: root,
      filePath: csvFile,
      date: '2026-05-18',
    });

    // PR comments (claude) should take precedence over branch history (qwen)
    assert.equal(result.row.implementer, 'claude');
    assert.equal(result.metadataSource.implementer, 'pr-comments');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('task-1251 and task-1314: normalizeStatsRow migrates a legacy 5-column row to the 21-column schema', () => {
  const row = stats.normalizeStatsRow({
    date: '2026-05-06', mission: 'task-1054', classification: 'ai_sdlc', implementer: 'claude', pr_fix_rounds: '1',
  });
  assert.deepEqual(Object.keys(row), stats.STATS_HEADERS);
  assert.equal(row.repo, stats.resolveStatsRepoName(process.cwd()));
  assert.equal(row.stage, 'default');         // legacy rows fold into the default stage
  assert.equal(row.input_tokens, '0');
  assert.equal(row.openai_usage_after, '0');
});

test('task-1314: stats mission reports filter to the active repo', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-stats-mission-repo-'));
  const csvFile = path.join(root, 'stats.csv');
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
    product: { name: 'visualboard' },
  }), 'utf8');

  const rows = [
    [
      '2026-06-10', 'visualboard', 'task-alpha', 'ai_sdlc', 'codex', '1',
      'openai', 'gpt-5.4-mini', 'codex', '', 'draft',
      '11', '12', '13', '14', '15', '0', '1', '0', '2', '0'
    ],
    [
      '2026-06-10', 'parallix', 'task-alpha', 'user_value', 'gemini', '2',
      'google', 'gemini-2.5-pro', 'gemini', '', 'review',
      '21', '22', '23', '24', '25', '0', '2', '0', '3', '0'
    ],
  ];
  fs.writeFileSync(csvFile, [
    stats.STATS_HEADERS.join(','),
    ...rows.map(values => values.join(',')),
  ].join('\n'), 'utf8');

  const logs = [];
  stats(['--csv-file', csvFile, '--mission', 'task-alpha'], {
    rootDir: root,
    log: line => logs.push(line),
    error: line => logs.push(`ERR:${line}`),
    exit: code => {
      throw new Error(`unexpected exit ${code}`);
    },
  });

  const output = require('../lib/core/fmt').stripAnsi(logs.join('\n'));
  assert.match(output, /Mission telemetry by phase: task-alpha/);
  assert.match(output, /draft\s+openai\s+gpt-5\.4-mini\s+codex\s+11\s+12\s+13\s+15\s+2\s+1/);
  assert.doesNotMatch(output, /google\s+gemini-2\.5-pro\s+gemini\s+21\s+22\s+23\s+25\s+3\s+2/);
});

test('task-1251: upsertStatsRow keys on (mission, stage) so stages do not collide', () => {
  const csvFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-stats-stage-')), 'stats.csv');

  stats.upsertStatsRow({ date: '2026-06-07', mission: 'task-3000', classification: 'ai_sdlc', implementer: 'codex', stage: 'draft', input_tokens: '100' }, { filePath: csvFile });
  stats.upsertStatsRow({ date: '2026-06-07', mission: 'task-3000', classification: 'ai_sdlc', implementer: 'codex', stage: 'active', input_tokens: '200' }, { filePath: csvFile });

  let data = stats.loadStatsCsv(csvFile);
  assert.equal(data.rows.length, 2); // distinct stages -> distinct rows

  // Re-upserting the same (mission, stage) updates in place, not append.
  stats.upsertStatsRow({ date: '2026-06-07', mission: 'task-3000', classification: 'ai_sdlc', implementer: 'codex', stage: 'draft', input_tokens: '999' }, { filePath: csvFile });
  data = stats.loadStatsCsv(csvFile);
  assert.equal(data.rows.length, 2);
  const draftRow = data.rows.find(r => r.stage === 'draft');
  assert.equal(draftRow.input_tokens, '999');
});

test('task-1251: telemetryToStatsFields maps codex telemetry, with honest-zero fallback', () => {
  const mapped = stats.telemetryToStatsFields(
    { provider: 'openai', model: 'gpt-5.4-mini', inputTokens: 1000, outputTokens: 50, cachedTokens: 900, totalTokens: 1050, toolCalls: 7, usagePercent: 42.6 },
    { agentFamily: 'codex', durationMinutes: 3.4 }
  );
  assert.equal(mapped.provider, 'openai');
  assert.equal(mapped.model, 'gpt-5.4-mini');
  assert.equal(mapped.input_tokens, '1000');
  assert.equal(mapped.context_tokens, '1050');
  assert.equal(mapped.tool_calls, '7');
  assert.equal(mapped.openai_usage_after, '43'); // rounded snapshot
  assert.equal(mapped.openai_usage_before, '0'); // before/delta deferred to follow-up
  assert.equal(mapped.duration_minutes, '3');

  const zero = stats.telemetryToStatsFields(null, { agentFamily: 'claude' });
  assert.equal(zero.provider, 'claude');
  assert.equal(zero.model, 'claude');
  assert.equal(zero.input_tokens, '0');
  assert.equal(zero.openai_usage_after, '0');
});

test('task-1301: renderRangeStatsReport counts unique missions when a mission has multiple stage rows', () => {
  // task-alpha has 3 stage rows (draft, active, review) — should count as 1 mission
  // task-beta has 2 stage rows (active, review) — should count as 1 mission
  const rows = [
    { date: '2026-06-10', mission: 'task-alpha', classification: 'ai_sdlc', implementer: 'qwen', pr_fix_rounds: '0', stage: 'draft' },
    { date: '2026-06-10', mission: 'task-alpha', classification: 'ai_sdlc', implementer: 'qwen', pr_fix_rounds: '0', stage: 'active' },
    { date: '2026-06-10', mission: 'task-alpha', classification: 'ai_sdlc', implementer: 'qwen', pr_fix_rounds: '1', stage: 'review' },
    { date: '2026-06-10', mission: 'task-beta', classification: 'user_value', implementer: 'codex', pr_fix_rounds: '0', stage: 'active' },
    { date: '2026-06-10', mission: 'task-beta', classification: 'user_value', implementer: 'codex', pr_fix_rounds: '2', stage: 'review' },
  ];
  const report = stats.renderRangeStatsReport(rows, { from: '2026-06-10', to: '2026-06-10' });
  const plain = require('../lib/core/fmt').stripAnsi(report);
  assert.match(plain, /2\s+1\s+1/); // 2 missions total, 1 user_value, 1 ai_sdlc
  assert.match(plain, /codex\s+1\s+2\.00/); // 1 unique codex mission with pr_fix_rounds=2
  assert.match(plain, /qwen \(opencode\)\s+1\s+1\.00/); // 1 unique qwen mission with highest pr_fix_rounds=1
});

test('task-1314: renderRangeStatsReport counts same mission separately across repos', () => {
  const rows = [
    { date: '2026-06-10', repo: 'visualboard', mission: 'task-alpha', classification: 'ai_sdlc', implementer: 'qwen', pr_fix_rounds: '0', stage: 'draft' },
    { date: '2026-06-10', repo: 'visualboard', mission: 'task-alpha', classification: 'ai_sdlc', implementer: 'qwen', pr_fix_rounds: '1', stage: 'review' },
    { date: '2026-06-10', repo: 'parallix', mission: 'task-alpha', classification: 'user_value', implementer: 'codex', pr_fix_rounds: '2', stage: 'draft' },
    { date: '2026-06-10', repo: 'parallix', mission: 'task-alpha', classification: 'user_value', implementer: 'codex', pr_fix_rounds: '3', stage: 'review' },
  ];
  const report = stats.renderRangeStatsReport(rows, { from: '2026-06-10', to: '2026-06-10' });
  const plain = require('../lib/core/fmt').stripAnsi(report);
  assert.match(plain, /2\s+1\s+1/); // two repo-distinct missions with the same slug
  assert.match(plain, /codex\s+1\s+3\.00/); // repo-distinct qwen/codex rows stay separate
  assert.match(plain, /qwen \(opencode\)\s+1\s+1\.00/);
});

// task-1318: review rows keep the MISSION implementer for grouping while
// capturing the reviewer in reviewer_agent. (A review row attributed to the
// reviewer in the `implementer` column would make reviewers appear to have
// implemented missions they only reviewed in the weekly per-implementer table.)

test('recordReviewStats keeps the mission implementer for grouping and records the reviewer in reviewer_agent (task-1318)', () => {
  const root = createRepoFixture();
  try {
    const taskFile = path.join(root, 'backlog', 'tasks', 'task-2000 - Example.md');
    fs.writeFileSync(taskFile, [
      '---',
      'id: TASK-2000',
      'labels: [ai_sdlc]',
      'assignee: [gemini]',
      'status: review',
      '---',
      '',
    ].join('\n'));

    const csvFile = path.join(root, 'workflow', 'data', 'stats.csv');
    const result = stats.recordReviewStats({
      slug: 'task-2000',
      rootDir: root,
      filePath: csvFile,
      reviewer: 'claude',
      implementer: 'gemini',
      date: '2026-06-15',
    });

    // Mission implementer ('gemini') drives grouping; reviewer ('claude') is
    // captured separately so the phase report can surface it for review phases.
    assert.equal(result.row.implementer, 'gemini');
    assert.equal(result.row.implementer_agent, 'gemini');
    assert.equal(result.row.reviewer_agent, 'claude');
    assert.equal(result.row.stage, 'review');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('recordReviewStats records the reviewer-session telemetry on the review row (task-1318)', () => {
  const root = createRepoFixture();
  try {
    const taskFile = path.join(root, 'backlog', 'tasks', 'task-2000 - Example.md');
    fs.writeFileSync(taskFile, [
      '---',
      'id: TASK-2000',
      'labels: [ai_sdlc]',
      'assignee: [gemini]',
      'status: review',
      '---',
      '',
    ].join('\n'));

    const csvFile = path.join(root, 'workflow', 'data', 'stats.csv');
    const result = stats.recordReviewStats({
      slug: 'task-2000',
      rootDir: root,
      filePath: csvFile,
      reviewer: 'codex',
      implementer: 'claude',
      telemetry: { provider: 'openai', model: 'gpt-5-codex', inputTokens: 800, outputTokens: 150, cachedTokens: 20, toolCalls: 3 },
      date: '2026-06-15',
    });

    // Grouping stays with the mission implementer; the reviewer is recorded and
    // the row carries the reviewer session's real token usage.
    assert.equal(result.row.implementer, 'claude');
    assert.equal(result.row.reviewer_agent, 'codex');
    assert.equal(result.row.provider, 'openai');
    assert.equal(result.row.input_tokens, '800');
    assert.equal(result.row.output_tokens, '150');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// task-1318: fix-round derivation reads the authoritative mission-local review
// event store (ground truth), independent of integration.

function writeReviewEvent(root, slug, { type, round, actor, verdict, timestamp, seq = 0 }) {
  const dir = path.join(root, 'docs', 'missions', '2026', slug, 'review-events');
  fs.mkdirSync(dir, { recursive: true });
  const ts = timestamp || `2026-06-16T00:0${round}:0${seq}.000Z`;
  const fileTs = ts.replace(/[:.]/g, '');
  const fm = ['---', `event_type: ${type}`, `timestamp: ${ts}`, `round: ${round}`, `actor: ${actor}`];
  if (verdict) fm.push(`verdict: ${verdict}`);
  fm.push('---', '', `event body for ${type} round ${round}`, '');
  fs.writeFileSync(path.join(dir, `${fileTs}-${type}-${round}-${actor}-${seq}.md`), fm.join('\n'));
}

test('deriveFixRoundsFromReviewEvents counts request-changes rounds resolved by the final implementer (task-1318)', () => {
  const root = createRepoFixture();
  try {
    writeReviewEvent(root, 'task-3000', { type: 'reviewer_outcome', round: 1, actor: 'qwen', verdict: 'request-changes' });
    writeReviewEvent(root, 'task-3000', { type: 'implementer_disposition', round: 1, actor: 'codex' });
    writeReviewEvent(root, 'task-3000', { type: 'reviewer_outcome', round: 2, actor: 'claude', verdict: 'request-changes' });
    writeReviewEvent(root, 'task-3000', { type: 'implementer_disposition', round: 2, actor: 'codex' });
    writeReviewEvent(root, 'task-3000', { type: 'reviewer_outcome', round: 3, actor: 'qwen', verdict: 'approve' });

    const derived = stats._internals.deriveFixRoundsFromReviewEvents('task-3000', root);
    assert.ok(derived);
    assert.equal(derived.implementer, 'codex');
    assert.equal(derived.prFixRounds, 2);
    assert.equal(derived.source, 'review-events');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('deriveFixRoundsFromReviewEvents attributes a mid-round handoff to the LATEST disposition (task-1318)', () => {
  const root = createRepoFixture();
  try {
    // Round 2 has a mid-round handoff: qwen responds first, then claude takes
    // over and actually resolves the round. The round must be owned by claude
    // (latest disposition), not qwen — otherwise the fix-round count and final
    // implementer are both wrong.
    writeReviewEvent(root, 'task-3002', { type: 'reviewer_outcome', round: 1, actor: 'codex', verdict: 'request-changes' });
    writeReviewEvent(root, 'task-3002', { type: 'implementer_disposition', round: 1, actor: 'qwen', timestamp: '2026-06-16T01:00:00.000Z' });
    writeReviewEvent(root, 'task-3002', { type: 'reviewer_outcome', round: 2, actor: 'codex', verdict: 'request-changes' });
    writeReviewEvent(root, 'task-3002', { type: 'implementer_disposition', round: 2, actor: 'qwen', timestamp: '2026-06-16T02:00:00.000Z', seq: 1 });
    writeReviewEvent(root, 'task-3002', { type: 'implementer_disposition', round: 2, actor: 'claude', timestamp: '2026-06-16T02:30:00.000Z', seq: 2 });
    writeReviewEvent(root, 'task-3002', { type: 'reviewer_outcome', round: 3, actor: 'codex', verdict: 'approve' });

    const derived = stats._internals.deriveFixRoundsFromReviewEvents('task-3002', root);
    assert.equal(derived.implementer, 'claude', 'final implementer is the latest round-2 responder');
    // claude owns round 2 (its request-changes counts); round 1 was qwen's and is
    // excluded from claude's count.
    assert.equal(derived.prFixRounds, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('deriveImplementerAndFixRounds prefers the review event store over other sources (task-1318)', () => {
  const root = createRepoFixture();
  try {
    const taskFile = path.join(root, 'backlog', 'tasks', 'task-3000 - Example.md');
    fs.writeFileSync(taskFile, ['---', 'id: TASK-3000', 'labels: [ai_sdlc]', 'assignee: [codex]', 'status: review', '---', ''].join('\n'));
    writeReviewEvent(root, 'task-3000', { type: 'reviewer_outcome', round: 1, actor: 'qwen', verdict: 'request-changes' });
    writeReviewEvent(root, 'task-3000', { type: 'implementer_disposition', round: 1, actor: 'codex' });
    writeReviewEvent(root, 'task-3000', { type: 'reviewer_outcome', round: 2, actor: 'qwen', verdict: 'approve' });

    const info = stats._internals.deriveImplementerAndFixRounds('task-3000', root);
    assert.equal(info.source, 'review-events');
    assert.equal(info.implementer, 'codex');
    assert.equal(info.prFixRounds, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('summarizeAgentWindow trusts local ground truth over a stale zero in the CSV (task-1318)', () => {
  const root = createRepoFixture();
  try {
    writeReviewEvent(root, 'task-3000', { type: 'reviewer_outcome', round: 1, actor: 'qwen', verdict: 'request-changes' });
    writeReviewEvent(root, 'task-3000', { type: 'implementer_disposition', round: 1, actor: 'codex' });
    writeReviewEvent(root, 'task-3000', { type: 'reviewer_outcome', round: 2, actor: 'qwen', verdict: 'request-changes' });
    writeReviewEvent(root, 'task-3000', { type: 'implementer_disposition', round: 2, actor: 'codex' });
    writeReviewEvent(root, 'task-3000', { type: 'reviewer_outcome', round: 3, actor: 'qwen', verdict: 'approve' });

    const window = { start: new Date('2026-06-10T00:00:00Z'), end: new Date('2026-06-16T00:00:00Z') };
    const rows = [
      { date: '2026-06-13', repo: '', mission: 'task-3000', implementer: 'codex', stage: 'active', pr_fix_rounds: '0' },
      { date: '2026-06-13', repo: '', mission: 'task-3000', implementer: 'codex', stage: 'review', pr_fix_rounds: '0' },
    ];

    const stored = stats._internals.summarizeAgentWindow(rows, window);
    assert.equal(stored[0].averageFixRounds, '0.00', 'without rootDir, stored value is used');

    const authoritative = stats._internals.summarizeAgentWindow(rows, window, { rootDir: root });
    assert.equal(authoritative[0].implementer, 'codex');
    assert.equal(authoritative[0].missions, 1);
    assert.equal(authoritative[0].averageFixRounds, '2.00', 'with rootDir, ground truth overrides the stale zero');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
