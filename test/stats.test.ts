// @ts-nocheck -- TASK-2328: partial test doubles from ESM seam migration; resolve in follow-up

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
import { createRequire } from 'node:module';
import { seedMissionDatabase } from './fixtures/review-state-db.js';
const _require = createRequire(import.meta.url);
const stats = mockModule<typeof import('../src/adapters/cli/commands/stats.js')>('../src/adapters/cli/commands/stats.js', import.meta.url);
const forgejo = mockModule<typeof import('../src/adapters/forgejo/forgejo.js')>('../src/adapters/forgejo/forgejo.js', import.meta.url);
const gitLib = mockModule<typeof import('../src/adapters/git/git.js')>('../src/adapters/git/git.js', import.meta.url);
const __mm1 = mockModule<typeof import('../src/domain/agents.js')>('../src/domain/agents.js', import.meta.url);
const __mm2 = mockModule<typeof import('../src/application/presentation/cli-format.js')>('../src/application/presentation/cli-format.js', import.meta.url);
const __mm3 = mockModule<typeof import('../src/domain/review.js')>('../src/domain/review.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const { agentFamily } = __mm1;
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
  try {
    const report = stats._internals.generateMarkdownReport(stats._internals.loadCsv(csv), { groupBy: 'implementer' });

    assert.match(report, /- \*\*Merged:\*\* 1/);
    assert.match(report, /- \*\*Open\/Closed:\*\* 1/);
    assert.match(report, /\| codex \| 2 \| 1 \| 1 \| 3 \| 1\.50 \| 2\.00 \|/);
    assert.match(report, /\| task-1 \| codex \| claude \| 3 \| yes \| 2026-05-01 \|/);
  } finally {
    fs.rmSync(path.dirname(csv), { recursive: true, force: true });
  }
});

test('stats report normalizes date/has_pr CSVs across summary, implementer, and period views', () => {
  const csv = writeCsv([
    'mission,date,implementer,reviewer,pr_link,review_count,has_pr,pr_numbers',
    'task-1,2026-05-10,gemini,codex,http://example/pr/1,4,yes,PR#1',
    'task-2,2026-05-11,gemini,none,no PR,0,no,—',
  ].join('\n'));
  try {
    const report = stats._internals.generateMarkdownReport(stats._internals.loadCsv(csv), { groupBy: 'period' });

    assert.match(report, /- \*\*Merged:\*\* 1/);
    assert.match(report, /- \*\*Open\/Closed:\*\* 1/);
    assert.match(report, /\| task-1 \| gemini \| codex \| 4 \| yes \| 2026-05-10 \|/);
    assert.match(report, /\| task-2 \| gemini \| none \| 0 \| no \| 2026-05-11 \|/);
    assert.match(report, /\| 2026-05-10 → 2026-05-11 \| 2 \| 2 \| 1 \| 1 \| 4 \| 2\.00 \|/);
  } finally {
    fs.rmSync(path.dirname(csv), { recursive: true, force: true });
  }
});

test('upsertMeasurementRow persists the workflow stats schema and updates existing missions idempotently', () => {
  const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-stats-upsert-')), 'parallix.db');
  try {
    const first = stats.upsertMeasurementRow({
    date: '2026-05-18',
    repo: 'parallix',
    mission: 'task-2000',
    classification: 'ai_sdlc',
    implementer: 'codex',
    pr_fix_rounds: 2,
  }, { dbPath: dbFile });

  assert.equal(first.changed, true);
  assert.equal(first.data.rows.length, 1);
  // The measurement database is the sink; no CSV is created next to it.
  assert.deepEqual(
    fs.readdirSync(path.dirname(dbFile)).filter(name => name.endsWith('.csv')),
    []
  );

  const second = stats.upsertMeasurementRow({
    date: '2026-05-18',
    repo: 'parallix',
    mission: 'task-2000',
    classification: 'ai_sdlc',
    implementer: 'codex',
    pr_fix_rounds: 2,
  }, { dbPath: dbFile });
  assert.equal(second.changed, false);
  assert.equal(second.data.rows.length, 1);

  const third = stats.upsertMeasurementRow({
    date: '2026-05-18',
    repo: 'parallix',
    mission: 'task-2000',
    classification: 'ai_sdlc',
    implementer: 'codex',
    pr_fix_rounds: 3,
  }, { dbPath: dbFile });
  assert.equal(third.changed, true);
  assert.equal(third.data.rows[0].pr_fix_rounds, '3');
  } finally {
    fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
  }
});

test('task-1314: upsertMeasurementRow keys on (repo, mission, stage) so same mission in different repos stays distinct', () => {
  const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-stats-repo-stage-')), 'parallix.db');
  try {
    stats.upsertMeasurementRow({
    date: '2026-06-07',
    repo: 'visualboard',
    mission: 'task-3000',
    classification: 'ai_sdlc',
    implementer: 'codex',
    stage: 'draft',
    input_tokens: '100',
  }, { dbPath: dbFile });
  stats.upsertMeasurementRow({
    date: '2026-06-07',
    repo: 'parallix',
    mission: 'task-3000',
    classification: 'ai_sdlc',
    implementer: 'codex',
    stage: 'draft',
    input_tokens: '200',
  }, { dbPath: dbFile });

  let data = stats.loadMeasurementRows({ dbPath: dbFile });
  assert.equal(data.rows.length, 2);

  stats.upsertMeasurementRow({
    date: '2026-06-07',
    repo: 'visualboard',
    mission: 'task-3000',
    classification: 'ai_sdlc',
    implementer: 'codex',
    stage: 'draft',
    input_tokens: '999',
  }, { dbPath: dbFile });
  data = stats.loadMeasurementRows({ dbPath: dbFile });
  assert.equal(data.rows.length, 2);
  const visualboardRow = data.rows.find(r => r.repo === 'visualboard');
  const parallixRow = data.rows.find(r => r.repo === 'parallix');
  assert.equal(visualboardRow.input_tokens, '999');
  assert.equal(parallixRow.input_tokens, '200');
  } finally {
    fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
  }
});

test('task-1342: upsertMeasurementRow keeps same mission/stage separate by acting agent family', () => {
  const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-stats-stage-actor-')), 'parallix.db');
  try {
    stats.upsertMeasurementRow({
    date: '2026-06-24',
    repo: 'parallix',
    mission: 'task-1342',
    classification: 'ai_sdlc',
    implementer: 'codex',
    implementer_agent: 'codex',
    stage: 'follow-up',
    input_tokens: '100',
  }, { dbPath: dbFile });
  stats.upsertMeasurementRow({
    date: '2026-06-24',
    repo: 'parallix',
    mission: 'task-1342',
    classification: 'ai_sdlc',
    implementer: 'custom',
    implementer_agent: 'custom',
    stage: 'follow-up',
    input_tokens: '200',
  }, { dbPath: dbFile });

  const data = stats.loadMeasurementRows({ dbPath: dbFile });
  assert.equal(data.rows.length, 2);
  assert.ok(data.rows.some(r => r.stage === 'follow-up' && r.implementer_agent === 'codex' && r.input_tokens === '100'));
  assert.ok(data.rows.some(r => r.stage === 'follow-up' && r.implementer_agent === 'custom' && r.input_tokens === '200'));
  } finally {
    fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
  }
});

test('task-1342: accumulateStageStats sums repeated launches for the same mission/stage/family', () => {
  const root = createRepoFixture();
  try {
    const taskFile = path.join(root, 'backlog', 'tasks', 'task-2000 - Example.md');
    fs.writeFileSync(taskFile, [
      '---',
      'id: TASK-2000',
      'labels: [ai_sdlc]',
      'assignee: [custom]',
      'status: review',
      '---',
      '',
    ].join('\n'));
    const dbFile = path.join(root, 'workflow', 'data', 'parallix.db');

    stats.accumulateStageStats({
      slug: 'task-2000',
      stage: 'follow-up',
      rootDir: root,
      dbPath: dbFile,
      implementer: 'custom',
      telemetry: { provider: 'openai', model: 'gpt-5', inputTokens: 100, outputTokens: 10, cachedTokens: 5, totalTokens: 115, toolCalls: 2, usagePercent: 7, cost_usd: 0.25 },
      durationMinutes: 3,
      date: '2026-06-24',
    });
    const result = stats.accumulateStageStats({
      slug: 'task-2000',
      stage: 'follow-up',
      rootDir: root,
      dbPath: dbFile,
      implementer: 'custom',
      telemetry: { provider: 'openai', model: 'gpt-5', inputTokens: 40, outputTokens: 4, cachedTokens: 1, totalTokens: 45, toolCalls: 1, usagePercent: 9, cost_usd: 0.5 },
      durationMinutes: 2,
      date: '2026-06-24',
    });

    assert.equal(result.data.rows.length, 1);
    assert.equal(result.row.input_tokens, '140');
    assert.equal(result.row.output_tokens, '14');
    assert.equal(result.row.cached_tokens, '6');
    assert.equal(result.row.context_tokens, '160');
    assert.equal(result.row.tool_calls, '3');
    assert.equal(result.row.duration_minutes, '5');
    assert.equal(result.row.openai_usage_after, '9');
    assert.equal(result.row.cost_usd, '0.75');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('resolveMissionClassification returns null classification with error when no task file exists', () => {
  const root = createRepoFixture();
  try {
    const result = stats.resolveMissionClassification('task-missing', root);
    assert.deepEqual(result, {
      classification: null,
      taskFile: null,
      error: 'Could not resolve backlog task for task-missing.',
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('upsertMeasurementRow accepts unknown classification rows and weekly report counts them', () => {
  const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-stats-unknown-')), 'parallix.db');
  try {
    stats.upsertMeasurementRow({
      date: '2026-06-23',
      repo: 'parallix',
      mission: 'task-unknown',
      classification: 'unknown',
      implementer: 'unknown',
      pr_fix_rounds: 0,
      closed: 'yes',
    }, { dbPath: dbFile });

    const rows = stats.loadMeasurementRows({ dbPath: dbFile }).rows;
    const report = stats.renderWeeklyStatsReport(rows, { today: '2026-06-23' });
    assert.match(report, /# unknown missions/);
    assert.match(report, /\b1\b/);
  } finally {
    fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
  }
});

// TASK-2322.08 removed every stats-path resolver (`resolveStatsCsvPath`,
// `resolveStatsPath`, `resolveStatsFilePath`, `resolveRepoStatsCsvPath`) and the
// `adapters.stats.path` config knob. The measurement database is the authority,
// so no default run can resolve a CSV to read from or write to.
test('no stats CSV path resolver survives the measurement cut-over', () => {
  for (const removed of [
    'resolveStatsCsvPath',
    'resolveStatsPath',
    'resolveStatsFilePath',
    'resolveRepoStatsCsvPath',
    'saveStatsCsv',
    'loadStatsCsv',
    'upsertStatsRow',
  ]) {
    assert.equal(stats[removed], undefined, `${removed} must not be reachable from the stats module`);
  }
});

test('recording a measurement with no explicit path writes no CSV under PARALLIX_HOME (task-1246)', () => {
  const previousHome = process.env.PARALLIX_HOME;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'px-stats-home-'));
  const repoA = fs.mkdtempSync(path.join(os.tmpdir(), 'px-stats-share-a-'));
  const repoB = fs.mkdtempSync(path.join(os.tmpdir(), 'px-stats-share-b-'));
  try {
    process.env.PARALLIX_HOME = home;
    fs.writeFileSync(path.join(repoA, 'workflow.config.json'), JSON.stringify({
      product: { name: 'visualboard' },
    }), 'utf8');
    fs.writeFileSync(path.join(repoB, 'workflow.config.json'), JSON.stringify({
      product: { name: 'parallix' },
    }), 'utf8');

    // Two distinct target repos driven by one runtime accumulate ONE shared
    // statistic — now in <PARALLIX_HOME>/parallix.db rather than stats.csv.
    const dbFile = path.join(home, 'parallix.db');
    stats.upsertMeasurementRow(
      { date: '2026-05-18', mission: 'task-a', classification: 'ai_sdlc', implementer: 'codex', pr_fix_rounds: '1' },
      { dbPath: dbFile, rootDir: repoA }
    );
    stats.upsertMeasurementRow(
      { date: '2026-05-19', mission: 'task-b', classification: 'user_value', implementer: 'gemini', pr_fix_rounds: '2' },
      { dbPath: dbFile, rootDir: repoB }
    );

    const loaded = stats.loadMeasurementRows({ dbPath: dbFile });
    assert.equal(loaded.rows.length, 2);
    assert.equal(loaded.rows.find(r => r.mission === 'task-a').repo, 'visualboard');
    assert.equal(loaded.rows.find(r => r.mission === 'task-b').repo, 'parallix');

    // No CSV was created anywhere: not in PARALLIX_HOME, not in either repo.
    assert.deepEqual(fs.readdirSync(home).filter(name => name.endsWith('.csv')), []);
    assert.equal(fs.existsSync(path.join(repoA, 'stats.csv')), false);
    assert.equal(fs.existsSync(path.join(repoB, 'stats.csv')), false);
    assert.equal(fs.existsSync(path.join(repoA, 'workflow', 'data', 'stats.csv')), false);
    assert.equal(fs.existsSync(path.join(repoB, 'workflow', 'data', 'stats.csv')), false);
  } finally {
    if (previousHome === undefined) delete process.env.PARALLIX_HOME;
    else process.env.PARALLIX_HOME = previousHome;
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(repoA, { recursive: true, force: true });
    fs.rmSync(repoB, { recursive: true, force: true });
  }
});

test('stats command defaults to the shared PARALLIX_HOME database across target repos', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-stats-command-default-'));
  const repoOne = path.join(root, 'repo-one');
  const repoTwo = path.join(root, 'repo-two');
  const home = path.join(root, 'parallix-home');
  fs.mkdirSync(repoOne);
  fs.mkdirSync(repoTwo);
  fs.mkdirSync(home);
  const dbFile = path.join(home, 'parallix.db');
  stats.upsertMeasurementRow(
    { date: '2026-05-18', mission: 'task-shared', classification: 'user_value', implementer: 'codex', pr_fix_rounds: '1', closed: 'yes' },
    { dbPath: dbFile, rootDir: repoOne }
  );
  const logs = [];
  const previousHome = process.env.PARALLIX_HOME;

  try {
    process.env.PARALLIX_HOME = home;
    stats.default(['--today', '2026-05-18'], {
      rootDir: repoOne,
      log: line => logs.push(line),
      error: line => logs.push(`ERR:${line}`),
      exit: code => {
        throw new Error(`unexpected exit ${code}`);
      },
    });

    const output = logs.join('\n');
    // SC4: the default run reads the database and announces no CSV at all.
    assert.match(output, /Loaded \d+ measurements from the statistics database/);
    assert.doesNotMatch(output, /Loading CSV/);

    const secondLogs = [];
    stats.default(['--today', '2026-05-18'], {
      rootDir: repoTwo,
      log: line => secondLogs.push(line),
      error: line => secondLogs.push(`ERR:${line}`),
      exit: code => {
        throw new Error(`unexpected exit ${code}`);
      },
    });
    // The same shared statistic is visible from the second target repo.
    assert.match(secondLogs.join('\n'), /Loaded 1 measurements from the statistics database/);
    assert.deepEqual(fs.readdirSync(home).filter(name => name.endsWith('.csv')), []);
  } finally {
    if (previousHome === undefined) delete process.env.PARALLIX_HOME;
    else process.env.PARALLIX_HOME = previousHome;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

 test('renderWeeklyStatsReport calculates current and previous seven-day windows from injected today', () => {
   const report = stats.renderWeeklyStatsReport([
     { date: '2026-05-18', mission: 'task-a', classification: 'ai_sdlc', implementer: 'codex', pr_fix_rounds: '2', closed: 'yes' },
     { date: '2026-05-12', mission: 'task-b', classification: 'user_value', implementer: 'gemini', pr_fix_rounds: '1', closed: 'yes' },
     { date: '2026-05-11', mission: 'task-c', classification: 'ai_sdlc', implementer: 'claude', pr_fix_rounds: '4', closed: 'yes' },
     { date: '2026-05-05', mission: 'task-d', classification: 'user_value', implementer: 'custom', pr_fix_rounds: '0', closed: 'yes' },
   ], { today: '2026-05-18' });

  assert.match(report, /Agent telemetry — current week \(2026-05-12 → 2026-05-18\)/);
  assert.match(report, /Agent telemetry — previous week \(2026-05-05 → 2026-05-11\)/);
  assert.match(report, /# missions with telemetry\s+# user value missions\s+# AI SDLC missions/);
  assert.match(report, /2\s+1\s+1/);
  assert.match(report, /Agent performance this week \(2026-05-12 → 2026-05-18\)/);
  assert.match(report, /codex\s+1\s+2\.00/);
  assert.match(report, /gemini\s+1\s+1\.00/);
  assert.match(report, /Agent performance previous week \(2026-05-05 → 2026-05-11\)/);
  assert.match(report, /claude\s+1\s+4\.00/);
  assert.match(report, /\bcustom\s+1\s+0\.00/);
});

test('renderRangeStatsReport filters inclusive boundary dates and summarizes mission counts', () => {
  const report = stats.renderRangeStatsReport([
    { date: '2026-04-30', mission: 'task-before', classification: 'ai_sdlc', implementer: 'codex', pr_fix_rounds: '9' },
    { date: '2026-05-01', mission: 'task-start', classification: 'ai_sdlc', implementer: 'codex', pr_fix_rounds: '2', closed: 'yes' },
    { date: '2026-05-15', mission: 'task-middle', classification: 'user_value', implementer: 'gemini', pr_fix_rounds: '1', closed: 'yes' },
    { date: '2026-05-31', mission: 'task-end', classification: 'user_value', implementer: 'codex', pr_fix_rounds: '4', closed: 'yes' },
    { date: '2026-06-01', mission: 'task-after', classification: 'user_value', implementer: 'claude', pr_fix_rounds: '0' },
  ], { from: '2026-05-01', to: '2026-05-31' });

  const plain = __mm2.stripAnsi(report);
  assert.match(plain, /Mission flow \(2026-05-01 → 2026-05-31\)/);
  assert.match(plain, /# missions with telemetry\s+# user value missions\s+# AI SDLC missions/);
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
    { date: '2026-05-18', mission: 'task-a', classification: 'ai_sdlc', implementer: 'gemini', pr_fix_rounds: '2', closed: 'yes' },
    { date: '2026-05-17', mission: 'task-b', classification: 'ai_sdlc', implementer: 'claude', pr_fix_rounds: '1', closed: 'yes' },
    { date: '2026-05-16', mission: 'task-c', classification: 'ai_sdlc', implementer: 'codex', pr_fix_rounds: '3', closed: 'yes' },
  ], { today: '2026-05-18' });

  const plain = __mm2.stripAnsi(report);
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
    { date: '2026-05-18', mission: 'task-a', classification: 'ai_sdlc', implementer: 'claude', pr_fix_rounds: '4', closed: 'yes' },
    { date: '2026-05-17', mission: 'task-b', classification: 'ai_sdlc', implementer: 'codex', pr_fix_rounds: '2', closed: 'yes' },
    { date: '2026-05-16', mission: 'task-c', classification: 'ai_sdlc', implementer: 'gemini', pr_fix_rounds: '0', closed: 'yes' },
  ], { today: '2026-05-18' });

  assert.match(report, /\x1b\[31m4\.00\x1b\[39m/);
  assert.match(report, /\x1b\[33m2\.00\x1b\[39m/);
  assert.match(report, /\x1b\[32m0\.00\x1b\[39m/);
});

test('renderWeeklyStatsReport colors best and worst mission counts', () => {
  process.env.FORCE_COLOR = '1';
  const report = stats.renderWeeklyStatsReport([
    { date: '2026-05-18', mission: 'task-a', classification: 'ai_sdlc', implementer: 'claude', pr_fix_rounds: '1', closed: 'yes' },
    { date: '2026-05-17', mission: 'task-b', classification: 'ai_sdlc', implementer: 'codex', pr_fix_rounds: '1', closed: 'yes' },
    { date: '2026-05-16', mission: 'task-c', classification: 'ai_sdlc', implementer: 'codex', pr_fix_rounds: '1', closed: 'yes' },
    { date: '2026-05-15', mission: 'task-d', classification: 'ai_sdlc', implementer: 'gemini', pr_fix_rounds: '1', closed: 'yes' },
    { date: '2026-05-14', mission: 'task-e', classification: 'ai_sdlc', implementer: 'gemini', pr_fix_rounds: '1', closed: 'yes' },
    { date: '2026-05-13', mission: 'task-f', classification: 'ai_sdlc', implementer: 'gemini', pr_fix_rounds: '1', closed: 'yes' },
  ], { today: '2026-05-18' });

  assert.match(report, /\x1b\[34mclaude\x1b\[39m\s+\x1b\[31m1\x1b\[39m/);
  assert.match(report, /\x1b\[35mcodex\x1b\[39m\s+\x1b\[33m2\x1b\[39m/);
  assert.match(report, /\x1b\[36mgemini\x1b\[39m\s+\x1b\[32m3\x1b\[39m/);
});

test('task-1414: renderWeeklyStatsReport adds an agent spend-by-stage table with the contracted columns', () => {
  const report = stats.renderWeeklyStatsReport([
    { date: '2026-05-18', repo: 'r', mission: 'task-codex', classification: 'ai_sdlc', implementer: 'codex', provider: 'openai', stage: 'draft', pr_fix_rounds: '0', openai_usage_after: '0' },
  ], { today: '2026-05-18' });

  const plain = __mm2.stripAnsi(report);
  assert.match(plain, /Agent spend by stage this week/);
  assert.match(plain, /Agent family\s+draft\s+execute\s+review\s+follow-up\s+default\s+total/);
});

test('task-1414: renderWeeklyStatsReport aggregates a Codex row from openai_usage_after with stage active shown as execute', () => {
  const report = stats.renderWeeklyStatsReport([
    { date: '2026-05-16', repo: 'r', mission: 'task-codex', classification: 'ai_sdlc', implementer: 'codex', provider: 'openai', stage: 'draft', pr_fix_rounds: '0', openai_usage_after: '20', cost_usd: '0', duration_minutes: '0', closed: 'yes' },
    { date: '2026-05-17', repo: 'r', mission: 'task-codex', classification: 'ai_sdlc', implementer: 'codex', provider: 'openai', stage: 'active', pr_fix_rounds: '0', openai_usage_after: '30', cost_usd: '0', duration_minutes: '0', closed: 'yes' },
    { date: '2026-05-18', repo: 'r', mission: 'task-codex', classification: 'ai_sdlc', implementer: 'codex', provider: 'openai', stage: 'review', pr_fix_rounds: '0', openai_usage_after: '50', cost_usd: '0', duration_minutes: '0', closed: 'yes' },
  ], { today: '2026-05-18' });

  const plain = __mm2.stripAnsi(report);
  const spendSection = plain.slice(plain.indexOf('Agent spend by stage this week'));
  assert.match(spendSection, /codex\s+20% \(20%\)\s+30% \(30%\)\s+50% \(50%\)\s+0% \(0%\)\s+0% \(0%\)\s+100% \(100%\)/);
  // Not fed by cost_usd or duration_minutes for a Codex/OpenAI row.
  assert.doesNotMatch(spendSection, /\$/);
  assert.doesNotMatch(spendSection, /\dm \(/);
});

test('task-1414: renderWeeklyStatsReport aggregates a Claude row from cost_usd, not tokens/duration/usage', () => {
  const report = stats.renderWeeklyStatsReport([
    { date: '2026-05-16', repo: 'r', mission: 'task-claude', classification: 'ai_sdlc', implementer: 'claude', stage: 'draft', pr_fix_rounds: '0', openai_usage_after: '999', cost_usd: '1', duration_minutes: '999', closed: 'yes' },
    { date: '2026-05-17', repo: 'r', mission: 'task-claude', classification: 'ai_sdlc', implementer: 'claude', stage: 'active', pr_fix_rounds: '0', openai_usage_after: '999', cost_usd: '3', duration_minutes: '999', closed: 'yes' },
    { date: '2026-05-18', repo: 'r', mission: 'task-claude', classification: 'ai_sdlc', implementer: 'claude', stage: 'review', pr_fix_rounds: '0', openai_usage_after: '999', cost_usd: '6', duration_minutes: '999', closed: 'yes' },
  ], { today: '2026-05-18' });

  const plain = __mm2.stripAnsi(report);
  const spendSection = plain.slice(plain.indexOf('Agent spend by stage this week'));
  assert.match(spendSection, /claude\s+\$1 \(10%\)\s+\$3 \(30%\)\s+\$6 \(60%\)\s+\$0 \(0%\)\s+\$0 \(0%\)\s+\$10 \(100%\)/);
  assert.doesNotMatch(spendSection, /999/);
});

test('task-1414: renderWeeklyStatsReport aggregates a Custom/local row from duration_minutes, not cost or usage', () => {
  const report = stats.renderWeeklyStatsReport([
    { date: '2026-05-16', repo: 'r', mission: 'task-custom', classification: 'ai_sdlc', implementer: 'custom', stage: 'draft', pr_fix_rounds: '0', openai_usage_after: '999', cost_usd: '999', duration_minutes: '5', closed: 'yes' },
    { date: '2026-05-17', repo: 'r', mission: 'task-custom', classification: 'ai_sdlc', implementer: 'custom', stage: 'active', pr_fix_rounds: '0', openai_usage_after: '999', cost_usd: '999', duration_minutes: '15', closed: 'yes' },
    { date: '2026-05-18', repo: 'r', mission: 'task-custom', classification: 'ai_sdlc', implementer: 'custom', stage: 'review', pr_fix_rounds: '0', openai_usage_after: '999', cost_usd: '999', duration_minutes: '30', closed: 'yes' },
  ], { today: '2026-05-18' });

  const plain = __mm2.stripAnsi(report);
  const spendSection = plain.slice(plain.indexOf('Agent spend by stage this week'));
  assert.match(spendSection, /custom\s+5m \(10%\)\s+15m \(30%\)\s+30m \(60%\)\s+0m \(0%\)\s+0m \(0%\)\s+50m \(100%\)/);
  assert.doesNotMatch(spendSection, /999/);
});

test('task-2213: renderWeeklyStatsReport spend table groups a mission by its model row', () => {
  const rows = [
    { date: '2026-05-17', repo: 'r', mission: 'task-model', classification: 'ai_sdlc', implementer: 'custom', model: 'qwen3.5', stage: 'draft', pr_fix_rounds: '0', duration_minutes: '10', closed: 'yes' },
    { date: '2026-05-18', repo: 'r', mission: 'task-model', classification: 'ai_sdlc', implementer: 'custom', model: 'qwen3.5', stage: 'active', pr_fix_rounds: '0', duration_minutes: '10', closed: 'yes' },
  ];
  const report = stats.renderWeeklyStatsReport(rows, { today: '2026-05-18' });
  const plain = __mm2.stripAnsi(report);

  assert.match(plain, /Agent performance this week[\s\S]*qwen3\.5/);
  const spendSection = plain.slice(plain.indexOf('Agent spend by stage this week'));
  assert.match(spendSection, /qwen3\.5\s+10m \(50%\)\s+10m \(50%\)/);
  assert.doesNotMatch(spendSection, /custom/);
});

test('task-1414: renderWeeklyStatsReport spend table renders a stable empty state instead of misleading 0% for a row with no spend', () => {
  const report = stats.renderWeeklyStatsReport([
    { date: '2026-05-18', repo: 'r', mission: 'task-none', classification: 'ai_sdlc', implementer: 'custom', stage: 'draft', pr_fix_rounds: '0', openai_usage_after: '0', cost_usd: '0', duration_minutes: '0', closed: 'yes' },
  ], { today: '2026-05-18' });

  const plain = __mm2.stripAnsi(report);
  const spendSection = plain.slice(plain.indexOf('Agent spend by stage this week'));
  assert.match(spendSection, /custom\s+—\s+—\s+—\s+—\s+—\s+—/);
  assert.doesNotMatch(spendSection, /0%/);
});

test('stats command prints workflow weekly tables from the integration stats schema', () => {
  const csv = writeCsv([
    'date,mission,classification,implementer,pr_fix_rounds',
    '2026-05-18,task-a,ai_sdlc,codex,2',
    '2026-05-12,task-b,user_value,gemini,1',
    '2026-05-11,task-c,ai_sdlc,claude,4',
  ].join('\n'));
  try {
    const logs = [];

    stats.default(['--csv-file', csv, '--today', '2026-05-18'], {
      log: line => logs.push(line),
      error: line => logs.push(`ERR:${line}`),
      exit: code => {
        throw new Error(`unexpected exit ${code}`);
      },
    });

    const output = logs.join('\n');
    assert.match(output, /Agent telemetry — current week \(2026-05-12 → 2026-05-18\)/);
    assert.match(output, /Agent telemetry — previous week \(2026-05-05 → 2026-05-11\)/);
    assert.match(output, /Agent performance this week \(2026-05-12 → 2026-05-18\)/);
  } finally {
    fs.rmSync(path.dirname(csv), { recursive: true, force: true });
  }
});

test('stats --csv-file does not initialize PARALLIX_HOME', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-stats-explicit-'));
  const home = path.join(root, 'parallix-home');
  const csv = path.join(root, 'explicit.csv');
  fs.writeFileSync(csv, 'date,mission,classification,implementer,pr_fix_rounds\n');
  const previousHome = process.env.PARALLIX_HOME;
  try {
    process.env.PARALLIX_HOME = home;
    stats.default(['--csv-file', csv], {
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
    '2026-06-01,task-after,ai_sdlc,custom,0',
  ].join('\n'));
  try {
    const logs = [];

    stats.default(['--csv-file', csv, '--from', '2026-05-01', '--to', '2026-05-31'], {
      log: line => logs.push(line),
      error: line => logs.push(`ERR:${line}`),
      exit: code => {
        throw new Error(`unexpected exit ${code}`);
      },
    });

    const output = __mm2.stripAnsi(logs.join('\n'));
    assert.match(output, /Mission flow \(2026-05-01 → 2026-05-31\)/);
    assert.match(output, /3\s+2\s+1/);
    assert.match(output, /Agent performance \(2026-05-01 → 2026-05-31\)/);
    assert.match(output, /codex\s+2\s+3\.00/);
    assert.match(output, /gemini\s+1\s+1\.00/);
    assert.doesNotMatch(output, /task-before/);
    assert.doesNotMatch(output, /Agent telemetry — current week/);
  } finally {
    fs.rmSync(path.dirname(csv), { recursive: true, force: true });
  }
});

test('stats command does not treat --today value as a positional CSV path', () => {
  const csv = writeCsv([
    'date,mission,classification,implementer,pr_fix_rounds',
    '2026-05-18,task-a,ai_sdlc,codex,2',
  ].join('\n'));
  const outputFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-stats-output-')), 'report.txt');
  try {
    const logs = [];

    stats.default(['--csv-file', csv, '--today', '2026-05-18', '--output', outputFile], {
      log: line => logs.push(line),
      error: line => logs.push(`ERR:${line}`),
      exit: code => {
        throw new Error(`unexpected exit ${code}`);
      },
    });

    const output = logs.join('\n');
    assert.match(output, new RegExp(`Report written to ${outputFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  } finally {
    fs.rmSync(path.dirname(outputFile), { recursive: true, force: true });
    fs.rmSync(path.dirname(csv), { recursive: true, force: true });
  }
});

test('stats command writes arbitrary range report to --output without printing report body', () => {
  const csv = writeCsv([
    'date,mission,classification,implementer,pr_fix_rounds',
    '2026-05-18,task-a,ai_sdlc,codex,2',
  ].join('\n'));
  const outputFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-stats-range-output-')), 'report.txt');
  try {
    const logs = [];

    stats.default(['--csv-file', csv, '--from', '2026-05-01', '--to', '2026-05-31', '--output', outputFile], {
      log: line => logs.push(line),
      error: line => logs.push(`ERR:${line}`),
      exit: code => {
        throw new Error(`unexpected exit ${code}`);
      },
    });

    const stdout = __mm2.stripAnsi(logs.join('\n'));
    assert.match(stdout, new RegExp(`Report written to ${outputFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    assert.doesNotMatch(stdout, /Mission flow \(2026-05-01 → 2026-05-31\)/);
    assert.match(fs.readFileSync(outputFile, 'utf8'), /Mission flow \(2026-05-01 → 2026-05-31\)/);
  } finally {
    fs.rmSync(path.dirname(outputFile), { recursive: true, force: true });
    fs.rmSync(path.dirname(csv), { recursive: true, force: true });
  }
});

test('stats command exits non-zero and prints date-range diagnostics for invalid range flags', () => {
  const csv = writeCsv([
    'date,mission,classification,implementer,pr_fix_rounds',
    '2026-05-18,task-a,ai_sdlc,codex,2',
  ].join('\n'));
  try {
    const logs = [];
    const exits = [];

    stats.default(['--csv-file', csv, '--from', '2026-05-01'], {
      log: line => logs.push(line),
      error: line => logs.push(`ERR:${line}`),
      exit: code => exits.push(code),
    });

    stats.default(['--csv-file', csv, '--from', '2026-06-01', '--to', '2026-05-31'], {
      log: line => logs.push(line),
      error: line => logs.push(`ERR:${line}`),
      exit: code => exits.push(code),
    });

    const output = logs.join('\n');
    assert.deepEqual(exits, [1, 1]);
    assert.match(output, /Invalid date range argument --to/);
    assert.match(output, /Invalid date range argument --from\/--to/);
  } finally {
    fs.rmSync(path.dirname(csv), { recursive: true, force: true });
  }
});

test('stats command keeps legacy retrospective CSVs on the markdown report path when range flags are present', () => {
  const csv = writeCsv([
    'mission,implementer,reviewer,pr_link,review_count,merged,state,created_at',
    'task-1,codex,claude,http://example/pr/1,3,yes,merged,2026-05-01T10:00:00Z',
  ].join('\n'));
  try {
    const logs = [];

    stats.default(['--csv-file', csv, '--from', '2026-05-01', '--to', '2026-05-31'], {
      log: line => logs.push(line),
      error: line => logs.push(`ERR:${line}`),
      exit: code => {
        throw new Error(`unexpected exit ${code}`);
      },
    });

    const output = logs.join('\n');
    assert.match(output, /# Forgejo Stats Report/);
    assert.doesNotMatch(output, /Mission flow \(2026-05-01 → 2026-05-31\)/);
  } finally {
    fs.rmSync(path.dirname(csv), { recursive: true, force: true });
  }
});

test('stats command help documents the pre-integration preview workflow', () => {
  const logs = [];

  stats.default(['--help'], {
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
  assert.match(output, /Workflow-owned stats datasets print the current\/previous-week summary tables by default/);
  // SC4: the help text names the database as the statistics authority.
  assert.match(output, /The measurement DATABASE is the authority for statistics/);
  assert.match(output, /<PARALLIX_HOME>\/parallix\.db/);
  assert.match(output, /No default run resolves, reads, or writes stats\.csv/);
  assert.match(output, /px stats import-legacy --csv-file/);
});

test('recordIntegrationStats reads backlog classification and Review aggregate final implementer/fix rounds', async () => {

  const { reviewFindingId } = __mm3;
  const root = createRepoFixture();
  let restoreHome: (() => Promise<void>) & { store?: unknown } = Object.assign(async () => {}, { store: undefined });
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

    // Four rounds, three of which the reviewer sent back: the aggregate records
    // the fix-round count directly, so nothing has to be reconstructed.
    const sentBack = (at) => ({
      implementer: agentFamily('gemini'),
      decision: {
        kind: 'changes-requested',
        decidedAt: at,
        comment: null,
        findings: [{ id: reviewFindingId('F1'), summary: 'sent back', location: null }],
      },
      disposition: 'REQUEST_CHANGES',
      phase: 'fixing',
    });
    restoreHome = await seedMissionDatabase(
      path.join(root, 'parallix-home'),
      'task-2000',
      root,
      sentBack('2026-05-18T11:00:00.000Z'),
      [
        sentBack('2026-05-18T12:00:00.000Z'),
        sentBack('2026-05-18T13:00:00.000Z'),
        {
          implementer: agentFamily('gemini'),
          decision: { kind: 'approved', decidedAt: '2026-05-18T14:00:00.000Z', comment: null, source: { kind: 'local' } },
          phase: 'approved',
        },
      ],
    );

    const dbFile = path.join(root, 'workflow', 'data', 'parallix.db');
    const result = await stats.recordIntegrationStats({
      slug: 'task-2000',
      rootDir: root,
      dbPath: dbFile,
      date: '2026-05-18',
      missionStore: restoreHome.store,
    });
    const repoName = stats.resolveStatsRepoName(root);

    assert.equal(result.row.classification, 'ai_sdlc');
    assert.equal(result.row.implementer, 'gemini');
    assert.equal(result.row.pr_fix_rounds, '3');
    assert.equal(result.row.repo, repoName);
    assert.equal(result.metadataSource.implementer, 'review-aggregate');
    // The completed-mission row is readable from the database, not a CSV.
    const stored = stats.loadMeasurementRows({ dbPath: dbFile }).rows
      .find(candidate => candidate.mission === 'task-2000');
    assert.equal(stored.date, '2026-05-18');
    assert.equal(stored.repo, repoName);
    assert.equal(stored.classification, 'ai_sdlc');
    assert.equal(stored.implementer, 'gemini');
    assert.equal(stored.pr_fix_rounds, '3');
    assert.equal(stored.closed, 'yes');
  } finally {
    await restoreHome();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('recordIntegrationStats returns the unchanged weekly report labels for integration output', async () => {
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

    const dbFile = path.join(root, 'workflow', 'data', 'parallix.db');
    for (const seed of [
      { date: '2026-05-12', mission: 'task-1000', classification: 'user_value', implementer: 'gemini', pr_fix_rounds: '1' },
      { date: '2026-05-11', mission: 'task-0999', classification: 'ai_sdlc', implementer: 'claude', pr_fix_rounds: '2' },
    ]) {
      stats.upsertMeasurementRow(seed, { dbPath: dbFile, rootDir: root });
    }

    const result = await stats.recordIntegrationStats({
      slug: 'task-2000',
      rootDir: root,
      dbPath: dbFile,
      date: '2026-05-18',
    });

    const report = __mm2.stripAnsi(result.report);
    assert.match(report, /Agent telemetry — current week \(2026-05-12 → 2026-05-18\)/);
    assert.match(report, /Agent telemetry — previous week \(2026-05-05 → 2026-05-11\)/);
    assert.match(report, /Agent performance this week \(2026-05-12 → 2026-05-18\)/);
    assert.match(report, /Agent performance previous week \(2026-05-05 → 2026-05-11\)/);
    assert.match(report, /# missions with telemetry\s+# user value missions\s+# AI SDLC missions/);
    assert.match(report, /Agent family\s+# missions as implementer\s+Average PR fix rounds to complete mission/);
    assert.doesNotMatch(report, /Mission flow \(2026-05-12 → 2026-05-18\)/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// A mission with no Review in the operator database — imported history, or one
// whose loop ran before the TASK-2322.12 cutover and was never backfilled. The
// commit history is then the only round record there is, so the latest round is
// read from it too rather than from a review-state file.
test('recordIntegrationStats counts only final implementer rounds after handoff when the mission has no Review', async (t) => {
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

    const dbFile = path.join(root, 'workflow', 'data', 'parallix.db');
    const result = await stats.recordIntegrationStats({
      slug: 'task-2000',
      rootDir: root,
      dbPath: dbFile,
      date: '2026-05-18',
    });

    assert.equal(result.row.implementer, 'gemini');
    assert.equal(result.row.pr_fix_rounds, '1');
    assert.equal(result.metadataSource.implementer, 'branch-history');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('recordIntegrationStats prefers branch-history implementer over the last recorded review round', async (t) => {
  const root = createRepoFixture();
  const subjects = [
    'mission/task-2000: task-2000',
    'review-state(task-2000): round 1 (codex reviewing custom)',
    'backlog(task-2000): transition to review and implementer=claude',
    'backlog(task-2000): transition to active and implementer=claude',
  ];
  t.mock.method(gitLib, 'git', (args) => {
    if (args[3] === '--format=%s') {
      return { status: 0, stdout: subjects.join('\n'), stderr: '' };
    }
    if (args[3] === '--reverse') {
      return { status: 0, stdout: [...subjects].reverse().join('\n'), stderr: '' };
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

    const dbFile = path.join(root, 'workflow', 'data', 'parallix.db');
    const result = await stats.recordIntegrationStats({
      slug: 'task-2000',
      rootDir: root,
      dbPath: dbFile,
      date: '2026-05-18',
    });

    assert.equal(result.row.implementer, 'claude');
    assert.equal(result.row.pr_fix_rounds, '0');
    assert.equal(result.metadataSource.implementer, 'branch-history');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('recordIntegrationStats prefers PR round-resolution comments for final implementer handoffs', async (t) => {
  const root = createRepoFixture();
  enableForgejoReview(root);
  t.mock.method(forgejo, 'readToken', () => 'token');
  t.mock.method(forgejo, 'resolveForgejoUser', () => 'codex');
  t.mock.method(forgejo, 'getCommentsSync', (branch, token) => {
    assert.equal(branch, 'mission/task-2000');
    assert.equal(token, 'token');
    return [
      { kind: 'issue-comment', user: 'custom', body: '## Round 1 Resolution Summary' },
      { kind: 'issue-comment', user: 'custom', body: '## Round 2 Resolution Summary' },
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
      'assignee: [custom]',
      'status: review',
      '---',
      '',
    ].join('\n'));

    fs.writeFileSync(
      path.join(root, 'docs', 'missions', '2026', 'task-2000', 'review-state.json'),
      JSON.stringify({ reviewer: 'codex', implementer: 'custom', round: 3, startedAt: '2026-05-18T10:00:00Z' }, null, 2)
    );

    const dbFile = path.join(root, 'workflow', 'data', 'parallix.db');
    const result = await stats.recordIntegrationStats({
      slug: 'task-2000',
      rootDir: root,
      dbPath: dbFile,
      date: '2026-05-18',
    });

    assert.equal(result.row.implementer, 'claude');
    assert.equal(result.row.pr_fix_rounds, '1');
    assert.equal(result.metadataSource.implementer, 'pr-comments');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('recordIntegrationStats derives non-standard resolution rounds from review events and ignores stale correction reposts', async (t) => {
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

    const dbFile = path.join(root, 'workflow', 'data', 'parallix.db');
    const result = await stats.recordIntegrationStats({
      slug: 'task-2000',
      rootDir: root,
      dbPath: dbFile,
      date: '2026-05-18',
    });

    assert.equal(result.row.implementer, 'claude');
    assert.equal(result.row.pr_fix_rounds, '2');
    assert.equal(result.metadataSource.implementer, 'pr-comments');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('recordIntegrationStats ignores reviewer round headings and counts only explicit resolution comments', async (t) => {
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

    const dbFile = path.join(root, 'workflow', 'data', 'parallix.db');
    const result = await stats.recordIntegrationStats({
      slug: 'task-2000',
      rootDir: root,
      dbPath: dbFile,
      date: '2026-05-18',
    });

    assert.equal(result.row.implementer, 'codex');
    assert.equal(result.row.pr_fix_rounds, '2');
    assert.equal(result.metadataSource.implementer, 'pr-comments');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('recordIntegrationStats counts review-attempt resolution comments as fix rounds', async (t) => {
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

    const dbFile = path.join(root, 'workflow', 'data', 'parallix.db');
    const result = await stats.recordIntegrationStats({
      slug: 'task-2000',
      rootDir: root,
      dbPath: dbFile,
      date: '2026-05-18',
    });

    assert.equal(result.row.implementer, 'gemini');
    assert.equal(result.row.pr_fix_rounds, '3');
    assert.equal(result.metadataSource.implementer, 'pr-comments');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('recordIntegrationStats uses bounded backlog fallback when review-state is missing', async () => {
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

    const dbFile = path.join(root, 'workflow', 'data', 'parallix.db');
    const result = await stats.recordIntegrationStats({
      slug: 'task-2000',
      rootDir: root,
      dbPath: dbFile,
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

test('recordIntegrationStats prefers PR comments over branch history for final implementer handoffs', async (t) => {
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
          'backlog(task-2000): transition to active and implementer=custom',
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
      'assignee: [custom]',
      'status: review',
      '---',
      '',
    ].join('\n'));

    const dbFile = path.join(root, 'workflow', 'data', 'parallix.db');
    const result = await stats.recordIntegrationStats({
      slug: 'task-2000',
      rootDir: root,
      dbPath: dbFile,
      date: '2026-05-18',
    });

    // PR comments (claude) should take precedence over branch history (custom)
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
  try {
    const csvFile = path.join(root, 'stats.csv');
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      product: { name: 'visualboard' },
    }), 'utf8');

    const rows = [
      [
        '2026-06-10', 'visualboard', 'task-alpha', 'ai_sdlc', 'codex', '1',
        'openai', 'gpt-5.4-mini', 'codex', '', 'draft',
        '11', '12', '13', '14', '15', '0', '1', '0', '2', '0', 'yes'
      ],
      [
        '2026-06-10', 'parallix', 'task-alpha', 'user_value', 'gemini', '2',
        'google', 'gemini-2.5-pro', 'gemini', '', 'review',
        '21', '22', '23', '24', '25', '0', '2', '0', '3', '0', 'yes'
      ],
    ];
    fs.writeFileSync(csvFile, [
      stats.STATS_HEADERS.join(','),
      ...rows.map(values => values.join(',')),
    ].join('\n'), 'utf8');

    const logs = [];
    stats.default(['--csv-file', csvFile, '--mission', 'task-alpha'], {
      rootDir: root,
      log: line => logs.push(line),
      error: line => logs.push(`ERR:${line}`),
      exit: code => {
        throw new Error(`unexpected exit ${code}`);
      },
    });

    const output = __mm2.stripAnsi(logs.join('\n'));
    assert.match(output, /Mission telemetry by phase: task-alpha/);
    assert.match(output, /draft\s+openai\s+gpt-5\.4-mini\s+codex\s+11\s+12\s+13\s+15\s+2\s+1/);
    assert.doesNotMatch(output, /google\s+gemini-2\.5-pro\s+gemini\s+21\s+22\s+23\s+25\s+3\s+2/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('task-1251: upsertMeasurementRow keys on (mission, stage) so stages do not collide', () => {
  const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-stats-stage-')), 'parallix.db');
  try {
    stats.upsertMeasurementRow({ date: '2026-06-07', mission: 'task-3000', classification: 'ai_sdlc', implementer: 'codex', stage: 'draft', input_tokens: '100' }, { dbPath: dbFile });
    stats.upsertMeasurementRow({ date: '2026-06-07', mission: 'task-3000', classification: 'ai_sdlc', implementer: 'codex', stage: 'active', input_tokens: '200' }, { dbPath: dbFile });

    let data = stats.loadMeasurementRows({ dbPath: dbFile });
    assert.equal(data.rows.length, 2); // distinct stages -> distinct rows

    // Re-upserting the same (mission, stage) updates in place, not append.
    stats.upsertMeasurementRow({ date: '2026-06-07', mission: 'task-3000', classification: 'ai_sdlc', implementer: 'codex', stage: 'draft', input_tokens: '999' }, { dbPath: dbFile });
    data = stats.loadMeasurementRows({ dbPath: dbFile });
    assert.equal(data.rows.length, 2);
    const draftRow = data.rows.find(r => r.stage === 'draft');
    assert.equal(draftRow.input_tokens, '999');
  } finally {
    fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
  }
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
  // Only the final stage row per mission is closed (matches real data shape).
  const rows = [
    { date: '2026-06-10', mission: 'task-alpha', classification: 'ai_sdlc', implementer: 'custom', pr_fix_rounds: '0', stage: 'draft', closed: 'no' },
    { date: '2026-06-10', mission: 'task-alpha', classification: 'ai_sdlc', implementer: 'custom', pr_fix_rounds: '0', stage: 'active', closed: 'no' },
    { date: '2026-06-10', mission: 'task-alpha', classification: 'ai_sdlc', implementer: 'custom', pr_fix_rounds: '1', stage: 'review', closed: 'yes' },
    { date: '2026-06-10', mission: 'task-beta', classification: 'user_value', implementer: 'codex', pr_fix_rounds: '0', stage: 'active', closed: 'no' },
    { date: '2026-06-10', mission: 'task-beta', classification: 'user_value', implementer: 'codex', pr_fix_rounds: '2', stage: 'review', closed: 'yes' },
  ];
  const report = stats.renderRangeStatsReport(rows, { from: '2026-06-10', to: '2026-06-10' });
  const plain = __mm2.stripAnsi(report);
  assert.match(plain, /2\s+1\s+1/); // 2 missions total, 1 user_value, 1 ai_sdlc
  assert.match(plain, /codex\s+1\s+2\.00/); // 1 unique codex mission with pr_fix_rounds=2
  assert.match(plain, /\bcustom\s+1\s+1\.00/); // 1 unique custom mission with pr_fix_rounds=1
});

test('task-1314: renderRangeStatsReport counts same mission separately across repos', () => {
  // Only the final stage row per (repo, mission) is closed (matches real data shape).
  const rows = [
    { date: '2026-06-10', repo: 'visualboard', mission: 'task-alpha', classification: 'ai_sdlc', implementer: 'custom', pr_fix_rounds: '0', stage: 'draft', closed: 'no' },
    { date: '2026-06-10', repo: 'visualboard', mission: 'task-alpha', classification: 'ai_sdlc', implementer: 'custom', pr_fix_rounds: '1', stage: 'review', closed: 'yes' },
    { date: '2026-06-10', repo: 'parallix', mission: 'task-alpha', classification: 'user_value', implementer: 'codex', pr_fix_rounds: '2', stage: 'draft', closed: 'no' },
    { date: '2026-06-10', repo: 'parallix', mission: 'task-alpha', classification: 'user_value', implementer: 'codex', pr_fix_rounds: '3', stage: 'review', closed: 'yes' },
  ];
  const report = stats.renderRangeStatsReport(rows, { from: '2026-06-10', to: '2026-06-10' });
  const plain = __mm2.stripAnsi(report);
  assert.match(plain, /2\s+1\s+1/); // two repo-distinct missions with the same slug
  assert.match(plain, /codex\s+1\s+3\.00/); // repo-distinct codex mission with pr_fix_rounds=3
  assert.match(plain, /\bcustom\s+1\s+1\.00/); // repo-distinct custom mission with pr_fix_rounds=1
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

    const dbFile = path.join(root, 'workflow', 'data', 'parallix.db');
    const result = stats.recordReviewStats({
      slug: 'task-2000',
      rootDir: root,
      dbPath: dbFile,
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

    const dbFile = path.join(root, 'workflow', 'data', 'parallix.db');
    const result = stats.recordReviewStats({
      slug: 'task-2000',
      rootDir: root,
      dbPath: dbFile,
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

test('deriveImplementerAndFixRounds counts the rounds the reviewer sent back to the final implementer (task-1318)', async () => {

  const { agentFamily } = __mm1;
  const { reviewFindingId } = __mm3;
  const root = createRepoFixture();

  const sentBack = (at) => ({
    decision: {
      kind: 'changes-requested',
      decidedAt: at,
      comment: null,
      findings: [{ id: reviewFindingId('F1'), summary: 'sent back', location: null }],
    },
    disposition: 'REQUEST_CHANGES',
    phase: 'fixing',
    implementer: agentFamily('codex'),
  });

  // Two rounds the reviewer sent back, then an approval: two fix rounds, owned
  // by the implementer who finished the mission.
  const restoreHome = await seedMissionDatabase(
    path.join(root, 'parallix-home'),
    'task-3000',
    root,
    sentBack('2026-06-16T01:00:00.000Z'),
    [
      sentBack('2026-06-16T02:00:00.000Z'),
      {
        implementer: agentFamily('codex'),
        decision: { kind: 'approved', decidedAt: '2026-06-16T03:00:00.000Z', comment: null, source: { kind: 'local' } },
        phase: 'approved',
      },
    ],
  );
  try {
    const info = await stats._internals.deriveImplementerAndFixRounds('task-3000', root, restoreHome.store);
    assert.equal(info.source, 'review-aggregate');
    assert.equal(info.implementer, 'codex');
    assert.equal(info.prFixRounds, 2);
  } finally {
    await restoreHome();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('deriveImplementerAndFixRounds prefers the Review aggregate over the event files (TASK-2322.12)', async () => {

  const { agentFamily } = __mm1;
  const { reviewFindingId } = __mm3;
  const root = createRepoFixture();
  // A review-events file that disagrees with the database: the aggregate wins.
// @ts-expect-error -- Legacy fixture deliberately exercises a duplicate or partial object-literal runtime shape.
  writeReviewEvent(root, 'task-3010', { type: 'reviewer_outcome', round: 1, actor: 'custom', verdict: 'request-changes' });
  const restoreHome = await seedMissionDatabase(
    path.join(root, 'parallix-home'),
    'task-3010',
    root,
    {
      implementer: agentFamily('gemini'),
      decision: {
        kind: 'changes-requested',
        decidedAt: '2026-08-02T11:00:00.000Z',
        comment: null,
        findings: [{ id: reviewFindingId('F1'), summary: 'Reviewer sent this round back', location: null }],
      },
      disposition: 'REQUEST_CHANGES',
      phase: 'fixing',
    },
  );
  try {
    const info = await stats._internals.deriveImplementerAndFixRounds('task-3010', root, restoreHome.store);
    assert.equal(info.source, 'review-aggregate');
    assert.equal(info.implementer, 'gemini');
    assert.equal(info.prFixRounds, 1, 'one round the reviewer sent back');
  } finally {
    await restoreHome();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('summarizeAgentWindow reports the stored fix-round count, and honors an injected derivation (task-1318)', () => {
  // The stored count is what the review loop stamped from the Review
  // aggregate, so the renderer reports it rather than re-deriving it from
  // mission-local files (which no longer exist). A caller that has already
  // derived a count can still inject one.
  // Only the closed rollup row carries the authoritative pr_fix_rounds.
  const window = { start: new Date('2026-06-10T00:00:00Z'), end: new Date('2026-06-16T00:00:00Z') };
  const rows = [
    { date: '2026-06-13', repo: '', mission: 'task-3000', implementer: 'codex', stage: 'active', classification: 'ai_sdlc', pr_fix_rounds: '0', closed: 'no' },
    { date: '2026-06-13', repo: '', mission: 'task-3000', implementer: 'codex', stage: 'review', classification: 'ai_sdlc', pr_fix_rounds: '0', closed: 'no' },
    { date: '2026-06-13', repo: '', mission: 'task-3000', implementer: 'codex', stage: 'default', classification: 'ai_sdlc', pr_fix_rounds: '2', closed: 'yes' },
  ];

  const stored = stats._internals.summarizeAgentWindow(rows, window);
  assert.equal(stored[0].implementer, 'codex');
  assert.equal(stored[0].missions, 1);
  assert.equal(stored[0].averageFixRounds, '2.00', 'pr_fix_rounds from closed rollup row');

  const injected = stats._internals.summarizeAgentWindow(rows, window, {
    rootDir: '/does-not-matter',
    deriveFixRoundsFn: () => 5,
  });
  assert.equal(injected[0].averageFixRounds, '5.00', 'an injected derivation overrides the stored value');
});

// task-1342: weekly classification count reconciliation regression

test('task-1342: weekly summary total equals user_value + ai_sdlc even with unclassified missions', () => {
  // Simulate the task-1339 scenario: 35 missions in the window, but only 3 have
  // user_value and 12 have ai_sdlc. The remaining 20 have empty/null classification.
  // The total must equal user_value + ai_sdlc (15), not 35.
  const rows = [];
  for (let i = 0; i < 3; i++) {
    rows.push({
      date: `2026-06-${20 + i}`, mission: `task-u${i}`, classification: 'user_value',
      implementer: 'codex', pr_fix_rounds: '0', closed: 'yes',
    });
  }
  for (let i = 0; i < 12; i++) {
    rows.push({
      date: `2026-06-${20 + (i % 5)}`, mission: `task-a${i}`, classification: 'ai_sdlc',
      implementer: 'custom', pr_fix_rounds: '1', closed: 'yes',
    });
  }
  // 20 missions with empty/null/unrecognized classification
  for (let i = 0; i < 20; i++) {
    rows.push({
      date: `2026-06-${20 + (i % 5)}`, mission: `task-x${i}`, classification: '',
      implementer: 'claude', pr_fix_rounds: '0', closed: 'yes',
    });
  }

  const report = stats.renderWeeklyStatsReport(rows, { today: '2026-06-24' });
  const plain = __mm2.stripAnsi(report);

  // The current week (2026-06-18 to 2026-06-24) contains all 35 rows.
  // total should equal userValue + aiSdlc = 3 + 12 = 15, NOT 35.
  assert.match(plain, /# missions with telemetry\s+# user value missions\s+# AI SDLC missions/);
  assert.match(plain, /15\s+3\s+12/);
});

test('task-1342: weekly summary total equals user_value + ai_sdlc + unknown when some missions have invalid classification strings', () => {
  const rows = [
    { date: '2026-06-20', mission: 'task-good1', classification: 'user_value', implementer: 'codex', pr_fix_rounds: '0', closed: 'yes' },
    { date: '2026-06-20', mission: 'task-good2', classification: 'ai_sdlc', implementer: 'custom', pr_fix_rounds: '1', closed: 'yes' },
    { date: '2026-06-20', mission: 'task-bad1', classification: 'USER_VALUE', implementer: 'claude', pr_fix_rounds: '0', closed: 'yes' },
    { date: '2026-06-20', mission: 'task-bad2', classification: 'unknown', implementer: 'gemini', pr_fix_rounds: '0', closed: 'yes' },
    { date: '2026-06-20', mission: 'task-bad3', classification: null, implementer: 'custom', pr_fix_rounds: '0', closed: 'yes' },
  ];

  const report = stats.renderWeeklyStatsReport(rows, { today: '2026-06-24' });
  const plain = __mm2.stripAnsi(report);

  // 'USER_VALUE' is lowercased by normalizeClassification, so it counts as user_value.
  // 'unknown' is a valid classification and counts toward the total; null does not.
  // So: total=4, userValue=2, aiSdlc=1, unknown=1.
  assert.match(plain, /4\s+2\s+1\s+1/);
});

// task-1342: mixed-agent per-mission phase telemetry regression

test('task-1342: mixed-agent phase report shows — for Usage % when provider is not OpenAI', () => {
// Simulate task-1339: Claude started execution, got usage-capped, custom/opencode
    // retried with OpenAI tokens, Claude later resumed. The execute phase shows
    // Claude as implementer but the provider/model came from the OpenAI telemetry
    // that actually belongs to custom's session.
  const rows = [
    {
      mission: 'task-1339', stage: 'active', provider: 'openai', model: 'gpt-5.4',
      implementer_agent: 'claude', implementer: 'claude',
      input_tokens: '4526019', output_tokens: '21427', cached_tokens: '4072064',
      tool_calls: '76', duration_minutes: '3', cost_usd: '0',
    },
    {
      mission: 'task-1339', stage: 'review', provider: 'openai', model: 'gpt-5.4',
      reviewer_agent: 'codex', implementer: 'claude',
      input_tokens: '4526019', output_tokens: '21427', cached_tokens: '4072064',
      tool_calls: '76', duration_minutes: '2', cost_usd: '0',
    },
    {
      mission: 'task-1339', stage: 'default', provider: '', model: '',
      implementer_agent: 'claude', implementer: 'claude',
      input_tokens: '0', output_tokens: '0', cached_tokens: '0',
      tool_calls: '0', duration_minutes: '0', cost_usd: '0',
    },
  ].map(stats.normalizeStatsRow);

  const report = stats.renderMissionPhaseReport(rows, 'task-1339');

  // Claude cannot provide token usage (it tracks on $), so Usage % should show
  // — for non-OpenAI providers. Even though the provider column says "openai"
  // (from the custom telemetry that bled in), the implementer is claude.
  // The key assertion: Usage % column (9th data column) must not show 0 for
  // the execute phase when the implementer is claude.
  const lines = report.split('\n');
  const executeLine = lines.find(l => /\bexecute\b/.test(l));
  assert.ok(executeLine, 'execute line present');
  // The execute phase row shows claude as implementer. Since claude has no
  // openai_usage_after, the Usage % column should show — not 0.
  assert.doesNotMatch(executeLine, /execute\s+openai\s+gpt-5\.4\s+claude\s+4526019\s+21427\s+4072064\s+76\s+3\s+0\s+0/);
});

test('task-1342: phase report row for claude implementer does not show OpenAI Usage % as 0', () => {
  const rows = [
    {
      mission: 'task-mixed', stage: 'active', provider: 'openai', model: 'gpt-5.4',
      implementer_agent: 'claude', implementer: 'claude',
      input_tokens: '5000', output_tokens: '100', cached_tokens: '4000',
      tool_calls: '10', duration_minutes: '5', cost_usd: '0',
    },
  ].map(stats.normalizeStatsRow);

  const report = stats.renderMissionPhaseReport(rows, 'task-mixed');
  const lines = report.split('\n');
  const executeLine = lines.find(l => /\bexecute\b/.test(l));
  assert.ok(executeLine, 'execute line present');

  // The openai_usage_after value for this row is '0' (no OpenAI rate-limit data
  // from claude). The Usage % column should show — for claude (non-OpenAI agent).
  // Note: the provider IS openai in this row (from telemetry bleed), so the
  // current code would show the raw value. The fix should prevent showing 0 for
  // claude even when the provider column says openai.
  // This test documents the bug: currently the code checks provider, not implementer.
  // After the fix, claude implementer should show — regardless of provider column.
  const parts = executeLine.split(/\s+/).filter(Boolean);
  const usageCol = parts[parts.length - 2]; // second-to-last column is Usage %
  assert.equal(usageCol, '—', 'Usage % should be — for claude implementer');
});

test('task-1342: review row with OpenAI reviewer shows Usage % even when claude is implementer', () => {
  // Mixed-agent scenario: Claude started execution, got usage-capped, codex reviewed
  // with OpenAI tokens. The review row has reviewer_agent=codex, implementer=claude.
  // The Usage % for the review row should show the reviewer's OpenAI usage, not —.
  const rows = [
    {
      mission: 'task-1339', stage: 'active', provider: 'openai', model: 'gpt-5.4',
      implementer_agent: 'claude', implementer: 'claude',
      input_tokens: '4526019', output_tokens: '21427', cached_tokens: '4072064',
      tool_calls: '76', duration_minutes: '3', cost_usd: '0',
      openai_usage_after: '29', closed: 'yes',
    },
    {
      mission: 'task-1339', stage: 'review', provider: 'openai', model: 'gpt-5.4',
      reviewer_agent: 'codex', implementer: 'claude',
      input_tokens: '4526019', output_tokens: '21427', cached_tokens: '4072064',
      tool_calls: '76', duration_minutes: '2', cost_usd: '0',
      openai_usage_after: '37', closed: 'yes',
    },
  ].map(stats.normalizeStatsRow);

  const report = stats.renderMissionPhaseReport(rows, 'task-1339');
  const lines = report.split('\n');
  const reviewLine = lines.find(l => /\breview\b/.test(l));
  assert.ok(reviewLine, 'review line present');

  // The review row has reviewer_agent=codex (an OpenAI agent), so Usage % should
  // show the reviewer's actual openai_usage_after value, not —.
  const parts = reviewLine.split(/\s+/).filter(Boolean);
  const usageCol = parts[parts.length - 2]; // second-to-last column is Usage %
  assert.equal(usageCol, '37', 'Usage % should be 37 for review row with OpenAI reviewer');
});

test('task-2213: summarizeAgentWindow keeps separate model rows for local AI missions', () => {
  const window = { start: new Date('2026-06-10T00:00:00Z'), end: new Date('2026-06-20T00:00:00Z') };
  const rows = [
    { date: '2026-06-12', mission: 'task-1001', implementer: 'custom', model: 'qwen3.5', classification: 'ai_sdlc', pr_fix_rounds: '1', closed: 'yes' },
    { date: '2026-06-13', mission: 'task-1002', implementer: 'custom', model: 'qwen3.5', classification: 'ai_sdlc', pr_fix_rounds: '2', closed: 'yes' },
    { date: '2026-06-14', mission: 'task-1003', implementer: 'custom', model: 'llama3', classification: 'ai_sdlc', pr_fix_rounds: '0', closed: 'yes' },
  ];

  const result = stats._internals.summarizeAgentWindow(rows, window);

  assert.deepEqual(result, [
    { implementer: 'llama3', missions: 1, averageFixRounds: '0.00' },
    { implementer: 'qwen3.5', missions: 2, averageFixRounds: '1.50' },
  ]);
});

test('task-2213: summarizeAgentWindow falls back to the recorded implementer when the telemetry model is blank', () => {
  const window = { start: new Date('2026-06-10T00:00:00Z'), end: new Date('2026-06-20T00:00:00Z') };
  const rows = [
    { date: '2026-06-12', mission: 'task-2001', implementer: 'claude', model: '', classification: 'user_value', pr_fix_rounds: '3', closed: 'yes' },
    { date: '2026-06-13', mission: 'task-2002', implementer: 'claude', model: '', classification: 'user_value', pr_fix_rounds: '1', closed: 'yes' },
  ];

  const result = stats._internals.summarizeAgentWindow(rows, window);

  assert.equal(result.length, 1, 'should have one group when model is empty');
  const claudeEntry = result.find(r => r.implementer === 'claude');
  assert.ok(claudeEntry, 'claude group should exist as fallback');
  assert.equal(claudeEntry.missions, 2, 'claude should have 2 missions');
  assert.equal(claudeEntry.averageFixRounds, '2.00', 'claude avg fix rounds should be 2.00');
});

test('task-2213: summarizeAgentWindow keeps mixed telemetry models in their own rows', () => {
  const window = { start: new Date('2026-06-10T00:00:00Z'), end: new Date('2026-06-20T00:00:00Z') };
  const rows = [
    { date: '2026-06-12', mission: 'task-3001', implementer: 'codex', model: 'gpt-5', classification: 'ai_sdlc', pr_fix_rounds: '1', closed: 'yes' },
    { date: '2026-06-13', mission: 'task-3002', implementer: 'custom', model: 'qwen3.5', classification: 'ai_sdlc', pr_fix_rounds: '2', closed: 'yes' },
    { date: '2026-06-14', mission: 'task-3003', implementer: 'gemini', model: 'gemini-2.5-pro', classification: 'ai_sdlc', pr_fix_rounds: '0', closed: 'yes' },
    { date: '2026-06-15', mission: 'task-3004', implementer: 'custom', model: 'llama3', classification: 'ai_sdlc', pr_fix_rounds: '1', closed: 'yes' },
    { date: '2026-06-16', mission: 'task-3005', implementer: 'claude', model: '', classification: 'user_value', pr_fix_rounds: '3', closed: 'yes' },
  ];

  const result = stats._internals.summarizeAgentWindow(rows, window);

  assert.deepEqual(result, [
    { implementer: 'claude', missions: 1, averageFixRounds: '3.00' },
    { implementer: 'gemini-2.5-pro', missions: 1, averageFixRounds: '0.00' },
    { implementer: 'gpt-5', missions: 1, averageFixRounds: '1.00' },
    { implementer: 'llama3', missions: 1, averageFixRounds: '1.00' },
    { implementer: 'qwen3.5', missions: 1, averageFixRounds: '2.00' },
  ]);
});

test('task-2213: renderWeeklyStatsReport displays model rows in the Agent family column', () => {
  const report = stats.renderWeeklyStatsReport([
    { date: '2026-05-18', mission: 'task-a', classification: 'ai_sdlc', implementer: 'custom', model: 'qwen3.5', pr_fix_rounds: '2', closed: 'yes' },
    { date: '2026-05-17', mission: 'task-b', classification: 'user_value', implementer: 'codex', model: 'gpt-5', pr_fix_rounds: '1', closed: 'yes' },
  ], { today: '2026-05-18' });

  const plain = __mm2.stripAnsi(report);
  assert.match(plain, /qwen3\.5\s+1\s+2\.00/);
  assert.match(plain, /gpt-5\s+1\s+1\.00/);
});

test('task-2213: renderRangeStatsReport displays model rows in the Agent family column', () => {
  const report = stats.renderRangeStatsReport([
    { date: '2026-05-10', mission: 'task-a', classification: 'ai_sdlc', implementer: 'custom', model: 'qwen3.5', pr_fix_rounds: '2', closed: 'yes' },
    { date: '2026-05-15', mission: 'task-b', classification: 'user_value', implementer: 'custom', model: 'llama3', pr_fix_rounds: '0', closed: 'yes' },
  ], { from: '2026-05-01', to: '2026-05-31' });

  const plain = __mm2.stripAnsi(report);
  assert.match(plain, /qwen3\.5\s+1\s+2\.00/);
  assert.match(plain, /llama3\s+1\s+0\.00/);
});
