const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  migrateStats,
  migrateAgentBlocklists
} = require('../lib/core/persistent-data-migration');

function withTempRoot(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-migration-'));
  try {
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('migrateStats merges repo and shared sources, deduplicates full rows, and is byte-idempotent', () => {
  withTempRoot(root => {
    const sourcePath = path.join(root, 'workflow', 'data', 'stats.csv');
    const destinationPath = path.join(root, 'parallix', 'stats.csv');
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.writeFileSync(sourcePath,
      'date,mission,classification,implementer,pr_fix_rounds\n' +
      '2026-06-01,task-1,ai_sdlc,codex,0\n' +
      '2026-06-02,task-2,user_value,claude,1\n'
    );
    fs.writeFileSync(destinationPath,
      'date,mission,classification,implementer,pr_fix_rounds\n' +
      '2026-06-01,task-1,ai_sdlc,codex,0\n' +
      '2026-06-03,task-3,ai_sdlc,custom,2\n'
    );

    migrateStats({ sourcePaths: [sourcePath], destinationPath });
    const first = fs.readFileSync(destinationPath, 'utf8');
    migrateStats({ sourcePaths: [sourcePath], destinationPath });
    const second = fs.readFileSync(destinationPath, 'utf8');

    assert.equal(second, first);
    assert.equal(first.match(/task-1/g).length, 1);
    assert.equal(first.match(/task-2/g).length, 1);
    assert.match(first, /task-2/);
    assert.match(first, /task-3/);
    assert.ok(fs.existsSync(sourcePath));
  });
});

test('migrateStats imports source rows into fresh install (destination does not exist)', () => {
  withTempRoot(root => {
    const sourcePath = path.join(root, 'workflow', 'data', 'stats.csv');
    const destinationPath = path.join(root, 'parallix', 'stats.csv');
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.writeFileSync(sourcePath,
      'date,mission,classification,implementer,pr_fix_rounds\n' +
      '2026-06-01,task-1,ai_sdlc,codex,0\n' +
      '2026-06-02,task-2,user_value,claude,1\n'
    );

    assert.ok(!fs.existsSync(destinationPath));

    const result = migrateStats({ sourcePaths: [sourcePath], destinationPath });

    assert.equal(result.imported, 2);
    assert.equal(result.rows, 2);
    const content = fs.readFileSync(destinationPath, 'utf8');
    const statsHeaders = require('../lib/commands/stats').STATS_HEADERS.join(',');
    assert.ok(content.startsWith(`${statsHeaders}\n`));
    assert.equal(content.split('\n').filter(Boolean).length, 3);
  });
});

test('migrateStats does not write a header-only file when no source data is available', () => {
  withTempRoot(root => {
    const destinationPath = path.join(root, 'parallix', 'stats.csv');
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    const missingSource = path.join(root, 'workflow', 'data', 'stats.csv');
    const emptySource = path.join(root, 'empty.csv');
    fs.writeFileSync(emptySource, '');

    assert.ok(!fs.existsSync(missingSource));

    const result = migrateStats({ sourcePaths: [missingSource, emptySource], destinationPath });

    assert.equal(result.imported, 0);
    assert.equal(result.rows, 0);
    assert.equal(result.warn, 'no source data available');
    assert.ok(!fs.existsSync(destinationPath), 'destination must not be created when no source data exists');
  });
});

test('migrateStats merges sources into existing header-only destination', () => {
  withTempRoot(root => {
    const sourcePath = path.join(root, 'workflow', 'data', 'stats.csv');
    const destinationPath = path.join(root, 'parallix', 'stats.csv');
    fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.writeFileSync(sourcePath,
      'date,mission,classification,implementer,pr_fix_rounds\n' +
      '2026-06-01,task-1,ai_sdlc,codex,0\n' +
      '2026-06-02,task-2,user_value,claude,1\n'
    );
    // Destination exists with only a header (empty data rows)
    fs.writeFileSync(destinationPath,
      'date,mission,classification,implementer,pr_fix_rounds\n'
    );

    const result = migrateStats({ sourcePaths: [sourcePath], destinationPath });

    assert.equal(result.imported, 2);
    assert.equal(result.rows, 2);
    const content = fs.readFileSync(destinationPath, 'utf8');
    assert.ok(content.includes('task-1'));
    assert.ok(content.includes('task-2'));
    const statsHeaders = require('../lib/commands/stats').STATS_HEADERS.join(',');
    assert.match(content, new RegExp(`^${statsHeaders}\\n`));
  });
});

test('migrateAgentBlocklists covers all three legacy sources and preserves schema variants', () => {
  withTempRoot(root => {
    const workflowPath = path.join(root, 'workflow', 'config', 'agents.local.json');
    const repoPath = path.join(root, 'repo', 'agents.local.json');
    const mainPath = path.join(root, 'main', 'agents.local.json');
    const destinationPath = path.join(root, 'parallix', 'agents.local.json');
    for (const filePath of [workflowPath, repoPath, mainPath]) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }
    fs.writeFileSync(workflowPath, JSON.stringify({ blocklist: { codex: true, claude: false } }));
    fs.writeFileSync(repoPath, JSON.stringify({ blocklist: { gemini: { blocked: true } } }));
    fs.writeFileSync(mainPath, JSON.stringify({ blocklist: { custom: { until: '2026-07-01 12' } } }));

    migrateAgentBlocklists({
      sourcePaths: [workflowPath, repoPath, mainPath],
      destinationPath
    });
    const payload = JSON.parse(fs.readFileSync(destinationPath, 'utf8'));

    assert.equal(payload.blocklist.codex, true);
    assert.equal(payload.blocklist.claude, false);
    assert.deepEqual(payload.blocklist.gemini, { blocked: true });
    assert.deepEqual(payload.blocklist.custom, { until: '2026-07-01 12' });
    assert.ok([workflowPath, repoPath, mainPath].every(filePath => fs.existsSync(filePath)));
  });
});

test('migrateAgentBlocklists reports conflicts and existing destination wins idempotently', () => {
  withTempRoot(root => {
    const lowPath = path.join(root, 'low.json');
    const highPath = path.join(root, 'high.json');
    const destinationPath = path.join(root, 'parallix', 'agents.local.json');
    fs.writeFileSync(lowPath, JSON.stringify({ blocklist: { codex: true } }));
    fs.writeFileSync(highPath, JSON.stringify({ blocklist: { codex: false } }));
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.writeFileSync(destinationPath, JSON.stringify({ blocklist: { codex: { blocked: true } } }, null, 2) + '\n');
    const warnings = [];

    const firstResult = migrateAgentBlocklists({
      sourcePaths: [lowPath, highPath],
      destinationPath,
      warn: message => warnings.push(message)
    });
    const first = fs.readFileSync(destinationPath, 'utf8');
    const secondResult = migrateAgentBlocklists({
      sourcePaths: [lowPath, highPath],
      destinationPath,
      warn: () => {}
    });

    assert.deepEqual(firstResult.blocklist.codex, { blocked: true });
    assert.equal(firstResult.conflicts.length, 2);
    assert.match(warnings[0], /selected=false previous=true/);
    assert.match(warnings[1], /selected=\{"blocked":true\} previous=false/);
    assert.equal(fs.readFileSync(destinationPath, 'utf8'), first);
    assert.deepEqual(secondResult.blocklist.codex, { blocked: true });
  });
});

test('migrateAgentBlocklists skips malformed legacy source but rejects malformed destination', () => {
  withTempRoot(root => {
    const malformedSource = path.join(root, 'legacy.json');
    const destinationPath = path.join(root, 'parallix', 'agents.local.json');
    fs.writeFileSync(malformedSource, '{ invalid');
    const warnings = [];

    migrateAgentBlocklists({
      sourcePaths: [malformedSource],
      destinationPath,
      warn: message => warnings.push(message)
    });
    assert.match(warnings[0], /Skipping malformed legacy agent blocklist/);
    assert.deepEqual(JSON.parse(fs.readFileSync(destinationPath, 'utf8')), { blocklist: {} });

    fs.writeFileSync(destinationPath, '{ invalid');
    assert.throws(
      () => migrateAgentBlocklists({ sourcePaths: [], destinationPath }),
      /Unexpected token|Expected property name/
    );
    assert.equal(fs.readFileSync(destinationPath, 'utf8'), '{ invalid');
  });
});
