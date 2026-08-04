
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const persistentDataMigration = require('../.test-runtime/adapters/storage/persistent-data-migration.js');
const { migrateAgentBlocklists } = persistentDataMigration;

function withTempRoot(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-migration-'));
  try {
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

// TASK-2322.08 deleted `migrateStats` and its CSV reader/writer helpers:
// `<PARALLIX_HOME>/stats.csv` is no longer a runtime authority or migration
// destination, so this module must expose no stats CSV migration at all.
test('no stats CSV migration survives the measurement cut-over', () => {
  assert.equal(persistentDataMigration.migrateStats, undefined);
  assert.equal(persistentDataMigration._internals, undefined);
  assert.equal(typeof persistentDataMigration.migrateAgentBlocklists, 'function');
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
