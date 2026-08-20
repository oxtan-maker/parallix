// @ts-nocheck -- TASK-2328: partial test doubles from ESM seam migration; resolve in follow-up

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
import { createRequire } from 'node:module';
import { seedMissionDatabase } from './fixtures/review-state-db.js';
import { createStatsCommand, createStatsWorkflowAdapter } from '../src/adapters/cli/commands/stats.js';
import { StatsCommandUseCase } from '../src/application/stats-command-use-case.js';

// Render-only `px stats` command: these tests exercise measurement-row reads
// and never consult the Mission authority, so a store placeholder satisfies
// the required wiring (SC13).
const statsCommand = createStatsCommand(
  new StatsCommandUseCase(createStatsWorkflowAdapter({})),
);
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

function createRepoFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-stats-fixture-'));
  fs.mkdirSync(path.join(root, 'backlog', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'missions', '2026', 'task-2000'), { recursive: true });
  return root;
}

function completedMissionKeys(rows) {
  return new Set(rows.filter(row => row.completedForTest === 'yes')
    .map(row => `${String(row.repo || '')}::${String(row.mission).trim().toLowerCase()}`));
}

function missionFlow(rows) {
  return rows.filter(row => row.completedForTest === 'yes')
    .map(row => ({ repo: String(row.repo || ''), mission: row.mission, closedAt: `${row.date}T00:00:00Z`, labels: [] }));
}

function renderWeeklyStatsReport(rows, options = {}) {
  return stats.renderWeeklyStatsReport(rows, { ...options, missionFlow: options.missionFlow ?? missionFlow(rows) });
}

function renderRangeStatsReport(rows, options = {}) {
  return stats.renderRangeStatsReport(rows, { ...options, missionFlow: options.missionFlow ?? missionFlow(rows) });
}

function summarizeAgentWindow(rows, window, options = {}) {
  return stats._internals.summarizeAgentWindow(rows, window, { ...options, completedMissionKeys: completedMissionKeys(rows) });
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
      completedForTest: 'yes',
    }, { dbPath: dbFile });

    const rows = stats.loadMeasurementRows({ dbPath: dbFile }).rows;
    const report = renderWeeklyStatsReport(rows, {
      today: '2026-06-23',
      missionFlow: [{ repo: 'parallix', mission: 'task-unknown', closedAt: '2026-06-23T00:00:00Z', labels: ['unknown'] }],
    });
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
    // TASK-2363: the configured `product.name` is a display alias, not an
    // identity. Each row is written under its checkout's canonical repository
    // id, which is what the mission lifecycle joins against.
    assert.equal(loaded.rows.find(r => r.mission === 'task-a').repo, path.basename(repoA));
    assert.equal(loaded.rows.find(r => r.mission === 'task-b').repo, path.basename(repoB));
    assert.notEqual(loaded.rows.find(r => r.mission === 'task-a').repo, 'visualboard');

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
    { date: '2026-05-18', mission: 'task-shared', classification: 'user_value', implementer: 'codex', pr_fix_rounds: '1', completedForTest: 'yes' },
    { dbPath: dbFile, rootDir: repoOne }
  );
  const logs = [];
  const previousHome = process.env.PARALLIX_HOME;

  try {
    process.env.PARALLIX_HOME = home;
    statsCommand(['--today', '2026-05-18'], {
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
    statsCommand(['--today', '2026-05-18'], {
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
   const report = renderWeeklyStatsReport([
     { date: '2026-05-18', mission: 'task-a', classification: 'ai_sdlc', implementer: 'codex', pr_fix_rounds: '2', completedForTest: 'yes' },
     { date: '2026-05-12', mission: 'task-b', classification: 'user_value', implementer: 'gemini', pr_fix_rounds: '1', completedForTest: 'yes' },
     { date: '2026-05-11', mission: 'task-c', classification: 'ai_sdlc', implementer: 'claude', pr_fix_rounds: '4', completedForTest: 'yes' },
     { date: '2026-05-05', mission: 'task-d', classification: 'user_value', implementer: 'custom', pr_fix_rounds: '0', completedForTest: 'yes' },
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
  const report = renderRangeStatsReport([
    { date: '2026-04-30', mission: 'task-before', classification: 'ai_sdlc', implementer: 'codex', pr_fix_rounds: '9' },
    { date: '2026-05-01', mission: 'task-start', classification: 'ai_sdlc', implementer: 'codex', pr_fix_rounds: '2', completedForTest: 'yes' },
    { date: '2026-05-15', mission: 'task-middle', classification: 'user_value', implementer: 'gemini', pr_fix_rounds: '1', completedForTest: 'yes' },
    { date: '2026-05-31', mission: 'task-end', classification: 'user_value', implementer: 'codex', pr_fix_rounds: '4', completedForTest: 'yes' },
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

test('renderRangeStatsReport keeps end-day lifecycle completions and independent telemetry', () => {
  const report = __mm2.stripAnsi(renderRangeStatsReport([
    { date: '2026-05-31', repo: 'r', mission: 'task-telemetry', classification: 'ai_sdlc', implementer: 'codex' },
  ], {
    from: '2026-05-01',
    to: '2026-05-31',
    missionFlow: [{ repo: 'r', mission: 'task-completed', closedAt: '2026-05-31T14:00:00Z', labels: ['user_value'] }],
  }));

  assert.match(report, /# completed missions\s+# user value missions\s+# AI SDLC missions[\s\S]*\n1\s+1\s+0/);
  assert.match(report, /# missions with telemetry\s+# user value missions\s+# AI SDLC missions[\s\S]*\n1\s+0\s+1/);
});

test('renderRangeStatsReport rejects missing, malformed, and inverted range arguments', () => {
  assert.throws(
    () => renderRangeStatsReport([], { to: '2026-05-31' }),
    /Invalid date range argument --from/
  );
  assert.throws(
    () => renderRangeStatsReport([], { from: '2026-05-01' }),
    /Invalid date range argument --to/
  );
  assert.throws(
    () => renderRangeStatsReport([], { from: '2026-05-32', to: '2026-06-01' }),
    /Invalid date range argument --from/
  );
  assert.throws(
    () => renderRangeStatsReport([], { from: '2026-06-01', to: '2026-05-31' }),
    /Invalid date range argument --from\/--to/
  );
});

test('renderWeeklyStatsReport sorts agent tables alphabetically by family name', () => {
  const report = renderWeeklyStatsReport([
    { date: '2026-05-18', mission: 'task-a', classification: 'ai_sdlc', implementer: 'gemini', pr_fix_rounds: '2', completedForTest: 'yes' },
    { date: '2026-05-17', mission: 'task-b', classification: 'ai_sdlc', implementer: 'claude', pr_fix_rounds: '1', completedForTest: 'yes' },
    { date: '2026-05-16', mission: 'task-c', classification: 'ai_sdlc', implementer: 'codex', pr_fix_rounds: '3', completedForTest: 'yes' },
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
  const report = renderWeeklyStatsReport([
    { date: '2026-05-18', mission: 'task-a', classification: 'ai_sdlc', implementer: 'claude', pr_fix_rounds: '4', completedForTest: 'yes' },
    { date: '2026-05-17', mission: 'task-b', classification: 'ai_sdlc', implementer: 'codex', pr_fix_rounds: '2', completedForTest: 'yes' },
    { date: '2026-05-16', mission: 'task-c', classification: 'ai_sdlc', implementer: 'gemini', pr_fix_rounds: '0', completedForTest: 'yes' },
  ], { today: '2026-05-18' });

  assert.match(report, /\x1b\[31m4\.00\x1b\[39m/);
  assert.match(report, /\x1b\[33m2\.00\x1b\[39m/);
  assert.match(report, /\x1b\[32m0\.00\x1b\[39m/);
});

test('renderWeeklyStatsReport colors best and worst mission counts', () => {
  process.env.FORCE_COLOR = '1';
  const report = renderWeeklyStatsReport([
    { date: '2026-05-18', mission: 'task-a', classification: 'ai_sdlc', implementer: 'claude', pr_fix_rounds: '1', completedForTest: 'yes' },
    { date: '2026-05-17', mission: 'task-b', classification: 'ai_sdlc', implementer: 'codex', pr_fix_rounds: '1', completedForTest: 'yes' },
    { date: '2026-05-16', mission: 'task-c', classification: 'ai_sdlc', implementer: 'codex', pr_fix_rounds: '1', completedForTest: 'yes' },
    { date: '2026-05-15', mission: 'task-d', classification: 'ai_sdlc', implementer: 'gemini', pr_fix_rounds: '1', completedForTest: 'yes' },
    { date: '2026-05-14', mission: 'task-e', classification: 'ai_sdlc', implementer: 'gemini', pr_fix_rounds: '1', completedForTest: 'yes' },
    { date: '2026-05-13', mission: 'task-f', classification: 'ai_sdlc', implementer: 'gemini', pr_fix_rounds: '1', completedForTest: 'yes' },
  ], { today: '2026-05-18' });

  assert.match(report, /\x1b\[34mclaude\x1b\[39m\s+\x1b\[31m1\x1b\[39m/);
  assert.match(report, /\x1b\[35mcodex\x1b\[39m\s+\x1b\[33m2\x1b\[39m/);
  assert.match(report, /\x1b\[36mgemini\x1b\[39m\s+\x1b\[32m3\x1b\[39m/);
});

test('task-1414: renderWeeklyStatsReport adds an agent spend-by-stage table with the contracted columns', () => {
  const report = renderWeeklyStatsReport([
    { date: '2026-05-18', repo: 'r', mission: 'task-codex', classification: 'ai_sdlc', implementer: 'codex', provider: 'openai', stage: 'draft', pr_fix_rounds: '0', openai_usage_after: '0' },
  ], { today: '2026-05-18' });

  const plain = __mm2.stripAnsi(report);
  assert.match(plain, /Agent spend by stage this week/);
  assert.match(plain, /Agent family\s+draft\s+execute\s+review\s+follow-up\s+default\s+total/);
});

test('task-1414: renderWeeklyStatsReport aggregates a Codex row from openai_usage_after with stage active shown as execute', () => {
  const report = renderWeeklyStatsReport([
    { date: '2026-05-16', repo: 'r', mission: 'task-codex', classification: 'ai_sdlc', implementer: 'codex', provider: 'openai', stage: 'draft', pr_fix_rounds: '0', openai_usage_after: '20', cost_usd: '0', duration_minutes: '0', completedForTest: 'yes' },
    { date: '2026-05-17', repo: 'r', mission: 'task-codex', classification: 'ai_sdlc', implementer: 'codex', provider: 'openai', stage: 'active', pr_fix_rounds: '0', openai_usage_after: '30', cost_usd: '0', duration_minutes: '0', completedForTest: 'yes' },
    { date: '2026-05-18', repo: 'r', mission: 'task-codex', classification: 'ai_sdlc', implementer: 'codex', provider: 'openai', stage: 'review', pr_fix_rounds: '0', openai_usage_after: '50', cost_usd: '0', duration_minutes: '0', completedForTest: 'yes' },
  ], { today: '2026-05-18' });

  const plain = __mm2.stripAnsi(report);
  const spendSection = plain.slice(plain.indexOf('Agent spend by stage this week'));
  assert.match(spendSection, /codex\s+20% \(20%\)\s+30% \(30%\)\s+50% \(50%\)\s+0% \(0%\)\s+0% \(0%\)\s+100% \(100%\)/);
  // Not fed by cost_usd or duration_minutes for a Codex/OpenAI row.
  assert.doesNotMatch(spendSection, /\$/);
  assert.doesNotMatch(spendSection, /\dm \(/);
});

test('task-1414: renderWeeklyStatsReport aggregates a Claude row from cost_usd, not tokens/duration/usage', () => {
  const report = renderWeeklyStatsReport([
    { date: '2026-05-16', repo: 'r', mission: 'task-claude', classification: 'ai_sdlc', implementer: 'claude', stage: 'draft', pr_fix_rounds: '0', openai_usage_after: '999', cost_usd: '1', duration_minutes: '999', completedForTest: 'yes' },
    { date: '2026-05-17', repo: 'r', mission: 'task-claude', classification: 'ai_sdlc', implementer: 'claude', stage: 'active', pr_fix_rounds: '0', openai_usage_after: '999', cost_usd: '3', duration_minutes: '999', completedForTest: 'yes' },
    { date: '2026-05-18', repo: 'r', mission: 'task-claude', classification: 'ai_sdlc', implementer: 'claude', stage: 'review', pr_fix_rounds: '0', openai_usage_after: '999', cost_usd: '6', duration_minutes: '999', completedForTest: 'yes' },
  ], { today: '2026-05-18' });

  const plain = __mm2.stripAnsi(report);
  const spendSection = plain.slice(plain.indexOf('Agent spend by stage this week'));
  assert.match(spendSection, /claude\s+\$1 \(10%\)\s+\$3 \(30%\)\s+\$6 \(60%\)\s+\$0 \(0%\)\s+\$0 \(0%\)\s+\$10 \(100%\)/);
  assert.doesNotMatch(spendSection, /999/);
});

test('task-1414: renderWeeklyStatsReport aggregates a Custom/local row from duration_minutes, not cost or usage', () => {
  const report = renderWeeklyStatsReport([
    { date: '2026-05-16', repo: 'r', mission: 'task-custom', classification: 'ai_sdlc', implementer: 'custom', stage: 'draft', pr_fix_rounds: '0', openai_usage_after: '999', cost_usd: '999', duration_minutes: '5', completedForTest: 'yes' },
    { date: '2026-05-17', repo: 'r', mission: 'task-custom', classification: 'ai_sdlc', implementer: 'custom', stage: 'active', pr_fix_rounds: '0', openai_usage_after: '999', cost_usd: '999', duration_minutes: '15', completedForTest: 'yes' },
    { date: '2026-05-18', repo: 'r', mission: 'task-custom', classification: 'ai_sdlc', implementer: 'custom', stage: 'review', pr_fix_rounds: '0', openai_usage_after: '999', cost_usd: '999', duration_minutes: '30', completedForTest: 'yes' },
  ], { today: '2026-05-18' });

  const plain = __mm2.stripAnsi(report);
  const spendSection = plain.slice(plain.indexOf('Agent spend by stage this week'));
  assert.match(spendSection, /custom\s+5m \(10%\)\s+15m \(30%\)\s+30m \(60%\)\s+0m \(0%\)\s+0m \(0%\)\s+50m \(100%\)/);
  assert.doesNotMatch(spendSection, /999/);
});

test('task-2213: renderWeeklyStatsReport spend table groups a mission by its model row', () => {
  const rows = [
    { date: '2026-05-17', repo: 'r', mission: 'task-model', classification: 'ai_sdlc', implementer: 'custom', model: 'qwen3.5', stage: 'draft', pr_fix_rounds: '0', duration_minutes: '10', completedForTest: 'yes' },
    { date: '2026-05-18', repo: 'r', mission: 'task-model', classification: 'ai_sdlc', implementer: 'custom', model: 'qwen3.5', stage: 'active', pr_fix_rounds: '0', duration_minutes: '10', completedForTest: 'yes' },
  ];
  const report = renderWeeklyStatsReport(rows, { today: '2026-05-18' });
  const plain = __mm2.stripAnsi(report);

  assert.match(plain, /Agent performance this week[\s\S]*qwen3\.5/);
  const spendSection = plain.slice(plain.indexOf('Agent spend by stage this week'));
  assert.match(spendSection, /qwen3\.5\s+10m \(50%\)\s+10m \(50%\)/);
  assert.doesNotMatch(spendSection, /custom/);
});

test('task-1414: renderWeeklyStatsReport spend table renders a stable empty state instead of misleading 0% for a row with no spend', () => {
  const report = renderWeeklyStatsReport([
    { date: '2026-05-18', repo: 'r', mission: 'task-none', classification: 'ai_sdlc', implementer: 'custom', stage: 'draft', pr_fix_rounds: '0', openai_usage_after: '0', cost_usd: '0', duration_minutes: '0', completedForTest: 'yes' },
  ], { today: '2026-05-18' });

  const plain = __mm2.stripAnsi(report);
  const spendSection = plain.slice(plain.indexOf('Agent spend by stage this week'));
  assert.match(spendSection, /custom\s+—\s+—\s+—\s+—\s+—\s+—/);
  assert.doesNotMatch(spendSection, /0%/);
});

test('stats command exits non-zero and prints date-range diagnostics for invalid range flags', () => {
  const logs = [];
  const exits = [];

  statsCommand(['--from', '2026-05-01'] , {
    log: line => logs.push(line),
    error: line => logs.push(`ERR:${line}`),
    exit: code => exits.push(code),
  });

  statsCommand(['--from', '2026-06-01', '--to', '2026-05-31'], {
    log: line => logs.push(line),
    error: line => logs.push(`ERR:${line}`),
    exit: code => exits.push(code),
  });

  const output = logs.join('\n');
  assert.deepEqual(exits, [1, 1]);
  assert.match(output, /Invalid date range argument --to/);
  assert.match(output, /Invalid date range argument --from\/--to/);
});

test('stats command help documents the pre-integration preview workflow', () => {
  const logs = [];

  statsCommand(['--help'], {
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
  assert.doesNotMatch(output, /stats\.csv|import-legacy|--csv-file/);
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
    assert.equal(stored.closed, undefined);
  } finally {
    await restoreHome();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('recordIntegrationStats returns the unchanged weekly report labels for integration output', async () => {
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
    ].join('\n'));

    // TASK-2378: recordIntegrationStats requires the operator store. This test
    // asserts only the report labels, so the seeded review content is
    // irrelevant.
    restoreHome = await seedMissionDatabase(path.join(root, 'parallix-home'), 'task-2000', root);

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
      missionStore: restoreHome.store,
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
    await restoreHome();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// A mission with no Review in the operator database — imported history, or one
// whose loop ran before the TASK-2322.12 cutover and was never backfilled. The
// commit history is then the only round record there is, so the latest round is
// read from it too rather than from a review-state file.
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
    const dbPath = path.join(root, 'parallix.db');
    const repo = stats.resolveStatsRepoName(root);
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      product: { name: 'visualboard' },
    }), 'utf8');

    stats.upsertMeasurementRow({
      date: '2026-06-10', repo, mission: 'task-alpha', classification: 'ai_sdlc',
      implementer: 'codex', pr_fix_rounds: '1', provider: 'openai', model: 'gpt-5.4-mini',
      implementer_agent: 'codex', stage: 'draft', input_tokens: '11', output_tokens: '12',
      cached_tokens: '13', context_tokens: '14', tool_calls: '15', openai_usage_after: '1', duration_minutes: '2',
    }, { dbPath });
    stats.upsertMeasurementRow({
      date: '2026-06-10', repo: 'parallix', mission: 'task-alpha', classification: 'user_value',
      implementer: 'gemini', pr_fix_rounds: '2', provider: 'google', model: 'gemini-2.5-pro',
      implementer_agent: 'gemini', stage: 'review', input_tokens: '21', output_tokens: '22',
      cached_tokens: '23', context_tokens: '24', tool_calls: '25', openai_usage_after: '2', duration_minutes: '3',
    }, { dbPath });

    const logs = [];
    statsCommand(['--mission', 'task-alpha'], {
      rootDir: root,
      dbPath,
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
  // The integration rollup carries final owner and review-fix facts.
  const rows = [
    { date: '2026-06-10', mission: 'task-alpha', classification: 'ai_sdlc', implementer: 'custom', pr_fix_rounds: '0', stage: 'draft', completedForTest: 'no' },
    { date: '2026-06-10', mission: 'task-alpha', classification: 'ai_sdlc', implementer: 'custom', pr_fix_rounds: '0', stage: 'active', completedForTest: 'no' },
    { date: '2026-06-10', mission: 'task-alpha', classification: 'ai_sdlc', implementer: 'custom', pr_fix_rounds: '1', stage: 'default', completedForTest: 'yes' },
    { date: '2026-06-10', mission: 'task-beta', classification: 'user_value', implementer: 'codex', pr_fix_rounds: '0', stage: 'active', completedForTest: 'no' },
    { date: '2026-06-10', mission: 'task-beta', classification: 'user_value', implementer: 'codex', pr_fix_rounds: '2', stage: 'default', completedForTest: 'yes' },
  ];
  const report = renderRangeStatsReport(rows, { from: '2026-06-10', to: '2026-06-10' });
  const plain = __mm2.stripAnsi(report);
  assert.match(plain, /2\s+1\s+1/); // 2 missions total, 1 user_value, 1 ai_sdlc
  assert.match(plain, /codex\s+1\s+2\.00/); // 1 unique codex mission with pr_fix_rounds=2
  assert.match(plain, /\bcustom\s+1\s+1\.00/); // 1 unique custom mission with pr_fix_rounds=1
});

test('task-1314: renderRangeStatsReport counts same mission separately across repos', () => {
  // The integration rollup is distinct for each (repo, mission).
  const rows = [
    { date: '2026-06-10', repo: 'visualboard', mission: 'task-alpha', classification: 'ai_sdlc', implementer: 'custom', pr_fix_rounds: '0', stage: 'draft', completedForTest: 'no' },
    { date: '2026-06-10', repo: 'visualboard', mission: 'task-alpha', classification: 'ai_sdlc', implementer: 'custom', pr_fix_rounds: '1', stage: 'default', completedForTest: 'yes' },
    { date: '2026-06-10', repo: 'parallix', mission: 'task-alpha', classification: 'user_value', implementer: 'codex', pr_fix_rounds: '2', stage: 'draft', completedForTest: 'no' },
    { date: '2026-06-10', repo: 'parallix', mission: 'task-alpha', classification: 'user_value', implementer: 'codex', pr_fix_rounds: '3', stage: 'default', completedForTest: 'yes' },
  ];
  const report = renderRangeStatsReport(rows, { from: '2026-06-10', to: '2026-06-10' });
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
    { date: '2026-06-13', repo: '', mission: 'task-3000', implementer: 'codex', stage: 'active', classification: 'ai_sdlc', pr_fix_rounds: '0', completedForTest: 'no' },
    { date: '2026-06-13', repo: '', mission: 'task-3000', implementer: 'codex', stage: 'review', classification: 'ai_sdlc', pr_fix_rounds: '0', completedForTest: 'no' },
    { date: '2026-06-13', repo: '', mission: 'task-3000', implementer: 'codex', stage: 'default', classification: 'ai_sdlc', pr_fix_rounds: '2', completedForTest: 'yes' },
  ];

  const stored = summarizeAgentWindow(rows, window);
  assert.equal(stored[0].implementer, 'codex');
  assert.equal(stored[0].missions, 1);
  assert.equal(stored[0].averageFixRounds, '2.00', 'pr_fix_rounds from closed rollup row');

  const injected = summarizeAgentWindow(rows, window, {
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
      implementer: 'codex', pr_fix_rounds: '0', completedForTest: 'yes',
    });
  }
  for (let i = 0; i < 12; i++) {
    rows.push({
      date: `2026-06-${20 + (i % 5)}`, mission: `task-a${i}`, classification: 'ai_sdlc',
      implementer: 'custom', pr_fix_rounds: '1', completedForTest: 'yes',
    });
  }
  // 20 missions with empty/null/unrecognized classification
  for (let i = 0; i < 20; i++) {
    rows.push({
      date: `2026-06-${20 + (i % 5)}`, mission: `task-x${i}`, classification: '',
      implementer: 'claude', pr_fix_rounds: '0', completedForTest: 'yes',
    });
  }

  const report = renderWeeklyStatsReport(rows, { today: '2026-06-24' });
  const plain = __mm2.stripAnsi(report);

  // The current week (2026-06-18 to 2026-06-24) contains all 35 rows.
  // total should equal userValue + aiSdlc = 3 + 12 = 15, NOT 35.
  assert.match(plain, /# missions with telemetry\s+# user value missions\s+# AI SDLC missions/);
  assert.match(plain, /15\s+3\s+12/);
});

test('task-1342: weekly summary total equals user_value + ai_sdlc + unknown when some missions have invalid classification strings', () => {
  const rows = [
    { date: '2026-06-20', mission: 'task-good1', classification: 'user_value', implementer: 'codex', pr_fix_rounds: '0', completedForTest: 'yes' },
    { date: '2026-06-20', mission: 'task-good2', classification: 'ai_sdlc', implementer: 'custom', pr_fix_rounds: '1', completedForTest: 'yes' },
    { date: '2026-06-20', mission: 'task-bad1', classification: 'USER_VALUE', implementer: 'claude', pr_fix_rounds: '0', completedForTest: 'yes' },
    { date: '2026-06-20', mission: 'task-bad2', classification: 'unknown', implementer: 'gemini', pr_fix_rounds: '0', completedForTest: 'yes' },
    { date: '2026-06-20', mission: 'task-bad3', classification: null, implementer: 'custom', pr_fix_rounds: '0', completedForTest: 'yes' },
  ];

  const report = renderWeeklyStatsReport(rows, { today: '2026-06-24' });
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
      openai_usage_after: '29', completedForTest: 'yes',
    },
    {
      mission: 'task-1339', stage: 'review', provider: 'openai', model: 'gpt-5.4',
      reviewer_agent: 'codex', implementer: 'claude',
      input_tokens: '4526019', output_tokens: '21427', cached_tokens: '4072064',
      tool_calls: '76', duration_minutes: '2', cost_usd: '0',
      openai_usage_after: '37', completedForTest: 'yes',
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
    { date: '2026-06-12', mission: 'task-1001', implementer: 'custom', model: 'qwen3.5', classification: 'ai_sdlc', pr_fix_rounds: '1', completedForTest: 'yes' },
    { date: '2026-06-13', mission: 'task-1002', implementer: 'custom', model: 'qwen3.5', classification: 'ai_sdlc', pr_fix_rounds: '2', completedForTest: 'yes' },
    { date: '2026-06-14', mission: 'task-1003', implementer: 'custom', model: 'llama3', classification: 'ai_sdlc', pr_fix_rounds: '0', completedForTest: 'yes' },
  ];

  const result = summarizeAgentWindow(rows, window);

  assert.deepEqual(result, [
    { implementer: 'llama3', missions: 1, averageFixRounds: '0.00' },
    { implementer: 'qwen3.5', missions: 2, averageFixRounds: '1.50' },
  ]);
});

test('task-2213: summarizeAgentWindow falls back to the recorded implementer when the telemetry model is blank', () => {
  const window = { start: new Date('2026-06-10T00:00:00Z'), end: new Date('2026-06-20T00:00:00Z') };
  const rows = [
    { date: '2026-06-12', mission: 'task-2001', implementer: 'claude', model: '', classification: 'user_value', pr_fix_rounds: '3', completedForTest: 'yes' },
    { date: '2026-06-13', mission: 'task-2002', implementer: 'claude', model: '', classification: 'user_value', pr_fix_rounds: '1', completedForTest: 'yes' },
  ];

  const result = summarizeAgentWindow(rows, window);

  assert.equal(result.length, 1, 'should have one group when model is empty');
  const claudeEntry = result.find(r => r.implementer === 'claude');
  assert.ok(claudeEntry, 'claude group should exist as fallback');
  assert.equal(claudeEntry.missions, 2, 'claude should have 2 missions');
  assert.equal(claudeEntry.averageFixRounds, '2.00', 'claude avg fix rounds should be 2.00');
});

test('task-2213: summarizeAgentWindow keeps mixed telemetry models in their own rows', () => {
  const window = { start: new Date('2026-06-10T00:00:00Z'), end: new Date('2026-06-20T00:00:00Z') };
  const rows = [
    { date: '2026-06-12', mission: 'task-3001', implementer: 'codex', model: 'gpt-5', classification: 'ai_sdlc', pr_fix_rounds: '1', completedForTest: 'yes' },
    { date: '2026-06-13', mission: 'task-3002', implementer: 'custom', model: 'qwen3.5', classification: 'ai_sdlc', pr_fix_rounds: '2', completedForTest: 'yes' },
    { date: '2026-06-14', mission: 'task-3003', implementer: 'gemini', model: 'gemini-2.5-pro', classification: 'ai_sdlc', pr_fix_rounds: '0', completedForTest: 'yes' },
    { date: '2026-06-15', mission: 'task-3004', implementer: 'custom', model: 'llama3', classification: 'ai_sdlc', pr_fix_rounds: '1', completedForTest: 'yes' },
    { date: '2026-06-16', mission: 'task-3005', implementer: 'claude', model: '', classification: 'user_value', pr_fix_rounds: '3', completedForTest: 'yes' },
  ];

  const result = summarizeAgentWindow(rows, window);

  assert.deepEqual(result, [
    { implementer: 'claude', missions: 1, averageFixRounds: '3.00' },
    { implementer: 'gemini-2.5-pro', missions: 1, averageFixRounds: '0.00' },
    { implementer: 'gpt-5', missions: 1, averageFixRounds: '1.00' },
    { implementer: 'llama3', missions: 1, averageFixRounds: '1.00' },
    { implementer: 'qwen3.5', missions: 1, averageFixRounds: '2.00' },
  ]);
});

test('task-2213: renderWeeklyStatsReport displays model rows in the Agent family column', () => {
  const report = renderWeeklyStatsReport([
    { date: '2026-05-18', mission: 'task-a', classification: 'ai_sdlc', implementer: 'custom', model: 'qwen3.5', pr_fix_rounds: '2', completedForTest: 'yes' },
    { date: '2026-05-17', mission: 'task-b', classification: 'user_value', implementer: 'codex', model: 'gpt-5', pr_fix_rounds: '1', completedForTest: 'yes' },
  ], { today: '2026-05-18' });

  const plain = __mm2.stripAnsi(report);
  assert.match(plain, /qwen3\.5\s+1\s+2\.00/);
  assert.match(plain, /gpt-5\s+1\s+1\.00/);
});

test('task-2213: renderRangeStatsReport displays model rows in the Agent family column', () => {
  const report = renderRangeStatsReport([
    { date: '2026-05-10', mission: 'task-a', classification: 'ai_sdlc', implementer: 'custom', model: 'qwen3.5', pr_fix_rounds: '2', completedForTest: 'yes' },
    { date: '2026-05-15', mission: 'task-b', classification: 'user_value', implementer: 'custom', model: 'llama3', pr_fix_rounds: '0', completedForTest: 'yes' },
  ], { from: '2026-05-01', to: '2026-05-31' });

  const plain = __mm2.stripAnsi(report);
  assert.match(plain, /qwen3\.5\s+1\s+2\.00/);
  assert.match(plain, /llama3\s+1\s+0\.00/);
});

test('task-2362: thoughts_tokens survives telemetryToStatsFields and the measurement store round-trip', () => {
  const fields = stats.telemetryToStatsFields(
    { provider: 'openai', model: 'qwen3.8-max', inputTokens: 1000, outputTokens: 200,
      cachedTokens: 900, thoughtsTokens: 150, totalTokens: 1200, toolCalls: 3 },
    { agentFamily: 'qwen' }
  );
  assert.equal(fields.thoughts_tokens, '150', 'thinking tokens mapped to their own column');
  assert.equal(fields.output_tokens, '200', 'thinking tokens not folded into output');

  const dbFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-stats-thoughts-')), 'parallix.db');
  try {
    const written = stats.upsertMeasurementRow({
      date: '2026-08-12',
      repo: 'parallix',
      mission: 'task-2362',
      classification: 'ai_sdlc',
      implementer: 'qwen',
      stage: 'active',
      ...fields,
    }, { dbPath: dbFile });
    assert.equal(written.data.rows[0].thoughts_tokens, '150', 'column persists through the sqlite store');
  } finally {
    fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
  }
});
