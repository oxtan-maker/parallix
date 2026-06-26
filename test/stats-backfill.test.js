const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const {
  collectHistoricalStatsBackfill,
  inferHistoricalClassificationFromMissionDoc,
} = require('../lib/commands/stats-backfill');
const statsBackfill = require('../lib/commands/stats-backfill');
const stats = require('../lib/commands/stats');

test('stats-backfill module loads without a parse-time SyntaxError', () => {
  assert.doesNotThrow(() => {
    delete require.cache[require.resolve('../lib/commands/stats-backfill')];
    require('../lib/commands/stats-backfill');
  });
});

function withFixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-stats-backfill-'));
  fs.mkdirSync(path.join(root, 'workflow', 'config'), { recursive: true });
  fs.mkdirSync(path.join(root, 'workflow', 'data'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'completed'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'missions', '2026'), { recursive: true });

  fs.writeFileSync(path.join(root, 'workflow', 'config', 'agents.json'), JSON.stringify({
    agents: {
      codex: { families: ['codex'] },
      claude: { families: ['claude'] },
      gemini: { families: ['gemini'] },
      custom: { families: ['custom'] },
    },
    steps: {
      active: { agents: ['codex', 'claude', 'gemini', 'custom'] },
      review: { agents: ['codex', 'claude', 'gemini', 'custom'] },
    },
  }));
  fs.writeFileSync(path.join(root, 'workflow', 'data', 'stats.csv'), 'date,repo,mission,classification,implementer,pr_fix_rounds\n', 'utf8');

  try {
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function initGitRepo(root) {
  childProcess.spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
  childProcess.spawnSync('git', ['config', 'user.name', 'Magnus Ekdahl'], { cwd: root, encoding: 'utf8' });
  childProcess.spawnSync('git', ['config', 'user.email', 'magnus.ekdahl@gmail.com'], { cwd: root, encoding: 'utf8' });
}

function commitAll(root, message) {
  childProcess.spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
  childProcess.spawnSync('git', ['commit', '-m', message], { cwd: root, encoding: 'utf8' });
}

function writeMission(root, slug, missionText, checkpoint = 'CP-1.md') {
  const missionDir = path.join(root, 'docs', 'missions', '2026', slug);
  fs.mkdirSync(missionDir, { recursive: true });
  fs.writeFileSync(path.join(missionDir, 'MISSION.md'), missionText, 'utf8');
  fs.writeFileSync(path.join(missionDir, checkpoint), '# checkpoint\n', 'utf8');
}

test('inferHistoricalClassificationFromMissionDoc distinguishes workflow from product missions', () => {
  withFixture(root => {
    writeMission(root, 'task-2000', [
      '# Mission: Fix workflow crash in review loop',
      '',
      'Update `workflow/lib/review/review.js` and `node parallix review` handling.',
    ].join('\n'));
    writeMission(root, 'task-2001', [
      '# Mission: Fix iOS add flow',
      '',
      'Update `ios/` and improve grocery add UX in the client.',
    ].join('\n'));

    assert.equal(inferHistoricalClassificationFromMissionDoc('task-2000', root), 'ai_sdlc');
    assert.equal(inferHistoricalClassificationFromMissionDoc('task-2001', root), 'user_value');
  });
});

test('inferHistoricalClassificationFromMissionDoc uses title fallback and returns null when no signal exists', () => {
  withFixture(root => {
    writeMission(root, 'task-2004', [
      '# Mission: Workflow bookkeeping cleanup',
      '',
      'Minimal note.',
    ].join('\n'));
    writeMission(root, 'task-2005', [
      '# Mission: Mystery task',
      '',
      'Minimal note with no known signals.',
    ].join('\n'));

    assert.equal(inferHistoricalClassificationFromMissionDoc('task-2004', root), 'ai_sdlc');
    assert.equal(inferHistoricalClassificationFromMissionDoc('task-2005', root), null);
    assert.equal(inferHistoricalClassificationFromMissionDoc('task-missing', root), null);
  });
});

test('collectHistoricalStatsBackfill resolves done missions, skips non-done missions, and reports unresolved items', () => {
  withFixture(root => {
    initGitRepo(root);

    fs.writeFileSync(path.join(root, 'backlog', 'completed', 'task-2000 - Workflow fix.md'), [
      '---',
      'id: TASK-2000',
      'assignee: [codex]',
      "updated_date: '2026-05-01 12:00'",
      'status: done',
      'labels: []',
      '---',
    ].join('\n'));
    writeMission(root, 'task-2000', [
      '# Mission: Fix workflow crash in review loop',
      '',
      'Update `workflow/lib/review/review.js` and `node parallix review` handling.',
    ].join('\n'));

    fs.writeFileSync(path.join(root, 'backlog', 'completed', 'task-2001 - App fix.md'), [
      '---',
      'id: TASK-2001',
      'assignee: [gemini]',
      "updated_date: '2026-05-02 08:00'",
      'status: active',
      'labels: []',
      '---',
    ].join('\n'));
    writeMission(root, 'task-2001', [
      '# Mission: Fix iOS add flow',
      '',
      'Update `ios/` and improve grocery add UX in the client.',
    ].join('\n'));

    fs.writeFileSync(path.join(root, 'backlog', 'completed', 'task-2002 - Missing implementer.md'), [
      '---',
      'id: TASK-2002',
      'assignee: []',
      "updated_date: '2026-05-03 09:00'",
      'status: done',
      'labels: []',
      '---',
    ].join('\n'));
    writeMission(root, 'task-2002', [
      '# Mission: Review automation cleanup',
      '',
      'Update workflow prompts and checkpoint handling.',
    ].join('\n'));

    commitAll(root, 'fixture');

    const report = collectHistoricalStatsBackfill(root, path.join(root, 'workflow', 'data', 'stats.csv'));
    const repoName = stats.resolveStatsRepoName(root);

    assert.equal(report.rows.length, 2);
    assert.deepEqual(report.rows[0], {
      date: '2026-05-01',
      repo: repoName,
      mission: 'task-2000',
      classification: 'ai_sdlc',
      implementer: 'codex',
      pr_fix_rounds: '0',
      sources: {
        date: 'backlog-updated_date',
        classification: 'mission-doc-heuristic',
        implementer: 'backlog-fallback',
      },
    });
    assert.deepEqual(report.rows[1], {
      date: '2026-05-03',
      repo: repoName,
      mission: 'task-2002',
      classification: 'ai_sdlc',
      implementer: 'magnus',
      pr_fix_rounds: '0',
      sources: {
        date: 'backlog-updated_date',
        classification: 'mission-doc-heuristic',
        implementer: 'git-history-author',
      },
    });

    assert.deepEqual(report.skipped, [{ slug: 'task-2001', reason: 'status=active' }]);
    assert.equal(report.unresolved.length, 0);
  });
});

test('collectHistoricalStatsBackfill falls back to git history for date and human implementer', () => {
  withFixture(root => {
    initGitRepo(root);

    fs.writeFileSync(path.join(root, 'backlog', 'completed', 'task-2003 - Human workflow cleanup.md'), [
      '---',
      'id: TASK-2003',
      'assignee: []',
      'status: done',
      'labels: []',
      '---',
    ].join('\n'));
    writeMission(root, 'task-2003', [
      '# Mission: Workflow cleanup',
      '',
      'Update `workflow/` command behavior and prompts.',
    ].join('\n'));

    commitAll(root, 'task-2003 fixture');

    const report = collectHistoricalStatsBackfill(root, path.join(root, 'workflow', 'data', 'stats.csv'));
    const row = report.rows.find(item => item.mission === 'task-2003');

    assert.ok(row);
    assert.equal(row.date, /\d{4}-\d{2}-\d{2}/.exec(row.date)[0]);
    assert.equal(row.classification, 'ai_sdlc');
    assert.equal(row.implementer, 'magnus');
    assert.equal(row.repo, stats.resolveStatsRepoName(root));
    assert.equal(row.sources.implementer, 'git-history-author');
  });
});

test('collectHistoricalStatsBackfill reports unresolved task resolution and legacy classification fallback', () => {
  withFixture(root => {
    initGitRepo(root);

    writeMission(root, 'task-2006', [
      '# Mission: Missing backlog task',
      '',
      'Update workflow docs.',
    ].join('\n'));

    fs.writeFileSync(path.join(root, 'backlog', 'completed', 'task-2007 - Legacy classification.md'), [
      '---',
      'id: TASK-2007',
      'assignee: [custom]',
      "updated_date: '2026-05-04 08:00'",
      'status: done',
      'labels: []',
      'classification: user_value',
      '---',
    ].join('\n'));
    writeMission(root, 'task-2007', [
      '# Mission: Legacy classification task',
      '',
      'Sparse mission text.',
    ].join('\n'));

    commitAll(root, 'task-2006 task-2007 fixture');

    const report = collectHistoricalStatsBackfill(root, path.join(root, 'workflow', 'data', 'stats.csv'));
    const resolved = report.rows.find(item => item.mission === 'task-2007');

    assert.ok(resolved);
    assert.equal(resolved.classification, 'user_value');
    assert.equal(resolved.sources.classification, 'backlog-classification');

    assert.equal(report.unresolved.length, 1);
    assert.deepEqual(report.unresolved[0], {
      slug: 'task-2006',
      reason: 'task-resolution',
      detail: 'missing',
    });
  });
});

test('statsBackfill supports help, json output, summary output, and apply mode', () => {
  withFixture(root => {
    initGitRepo(root);

    fs.writeFileSync(path.join(root, 'backlog', 'completed', 'task-2008 - Workflow cleanup.md'), [
      '---',
      'id: TASK-2008',
      'assignee: [codex]',
      "updated_date: '2026-05-05 07:00'",
      'status: done',
      'labels: []',
      '---',
    ].join('\n'));
    writeMission(root, 'task-2008', [
      '# Mission: Workflow cleanup',
      '',
      'Update `workflow/` prompts and command behavior.',
    ].join('\n'));

    fs.writeFileSync(path.join(root, 'backlog', 'completed', 'task-2009 - Active task.md'), [
      '---',
      'id: TASK-2009',
      'assignee: [gemini]',
      "updated_date: '2026-05-06 07:00'",
      'status: active',
      'labels: []',
      '---',
    ].join('\n'));
    writeMission(root, 'task-2009', [
      '# Mission: Workflow active task',
      '',
      'Update `workflow/` prompts and command behavior.',
    ].join('\n'));

    commitAll(root, 'task-2008 task-2009 fixture');

    const logs = [];
    statsBackfill(['--help'], {
      rootDir: root,
      log: line => logs.push(line),
      error: line => logs.push(`ERR:${line}`),
      exit: code => {
        throw new Error(`unexpected exit ${code}`);
      },
    });
    assert.match(logs.join('\n'), /Usage: px stats-backfill/);

    const jsonLogs = [];
    const isolatedHome = path.join(root, 'unused-parallix-home');
    const previousExplicitHome = process.env.PARALLIX_HOME;
    try {
      process.env.PARALLIX_HOME = isolatedHome;
      statsBackfill(['--json', '--csv-file', path.join(root, 'workflow', 'data', 'stats.csv')], {
        rootDir: root,
        log: line => jsonLogs.push(line),
        error: line => jsonLogs.push(`ERR:${line}`),
        exit: code => {
          throw new Error(`unexpected exit ${code}`);
        },
      });
      assert.equal(fs.existsSync(isolatedHome), false);
    } finally {
      if (previousExplicitHome === undefined) delete process.env.PARALLIX_HOME;
      else process.env.PARALLIX_HOME = previousExplicitHome;
    }
    const payload = JSON.parse(jsonLogs.join('\n'));
    assert.equal(payload.resolved, 1);
    assert.equal(payload.skipped, 1);

    const summaryLogs = [];
    statsBackfill(['--csv-file', path.join(root, 'workflow', 'data', 'stats.csv')], {
      rootDir: root,
      log: line => summaryLogs.push(line),
      error: line => summaryLogs.push(`ERR:${line}`),
      exit: code => {
        throw new Error(`unexpected exit ${code}`);
      },
    });
    assert.match(summaryLogs.join('\n'), /Resolved rows: 1/);
    assert.match(summaryLogs.join('\n'), /Skipped:\n- task-2009 status=active/);

    const applyLogs = [];
    statsBackfill(['--apply', '--csv-file', path.join(root, 'workflow', 'data', 'stats.csv')], {
      rootDir: root,
      log: line => applyLogs.push(line),
      error: line => applyLogs.push(`ERR:${line}`),
      exit: code => {
        throw new Error(`unexpected exit ${code}`);
      },
    });
    assert.match(applyLogs.join('\n'), /Applied 1 stats rows/);

    const csv = fs.readFileSync(path.join(root, 'workflow', 'data', 'stats.csv'), 'utf8');
    assert.match(csv, new RegExp(`2026-05-05,${stats.resolveStatsRepoName(root)},task-2008,ai_sdlc,codex,0`));

    const previousHome = process.env.PARALLIX_HOME;
    const parallixHome = path.join(root, 'parallix-home');
    try {
      process.env.PARALLIX_HOME = parallixHome;
      const defaultLogs = [];
      statsBackfill(['--apply'], {
        rootDir: root,
        log: line => defaultLogs.push(line),
        error: line => defaultLogs.push(`ERR:${line}`),
        exit: code => {
          throw new Error(`unexpected exit ${code}`);
        },
      });
      assert.match(defaultLogs.join('\n'), new RegExp(path.join(parallixHome, 'stats.csv')));
      assert.match(fs.readFileSync(path.join(parallixHome, 'stats.csv'), 'utf8'), /task-2008/);
    } finally {
      if (previousHome === undefined) delete process.env.PARALLIX_HOME;
      else process.env.PARALLIX_HOME = previousHome;
    }
  });
});
