// Characterization tests locking the workflow.config.json contract after the
// task-1233 (parallix phase 3) decision: schema deferred, and the example +
// placeholder-sentinel model retired in favor of code-owned defaults. An absent
// config is a valid 'default' state. See docs/missions/2026/task-1233/CP-3.md.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  configCandidates,
  evaluateRepositoryReadiness,
  findWorkflowConfig,
} = require('../lib/core/product-config');

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-config-deferral-'));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// GAP from CP-2 row 2: malformed JSON reaches the parseError -> 'invalid' branch
// of evaluateRepositoryReadiness, which had no direct unit coverage.
test('evaluateRepositoryReadiness returns invalid for malformed workflow.config.json', () => {
  withTempDir(root => {
    fs.writeFileSync(path.join(root, 'workflow.config.json'), '{ not valid json');

    const result = evaluateRepositoryReadiness(root);
    assert.equal(result.mode, 'invalid');
    assert.ok(result.issues.some(i => i.startsWith('invalid JSON:')), JSON.stringify(result.issues));
  });
});

// With code-owned defaults, a repo with no workflow.config.json (e.g. the
// WrGroceries layout) resolves to 'default' readiness with no issues — an absent
// config is a valid, ready state, not a failure. WrGroceries keeps working with
// zero repo config.
test('evaluateRepositoryReadiness returns default mode without workflow.config.json', () => {
  withTempDir(root => {
    fs.mkdirSync(path.join(root, 'backlog'), { recursive: true });
    fs.mkdirSync(path.join(root, 'docs', 'missions'), { recursive: true });
    fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(root, 'scripts', 'verify-local.sh'), '#!/usr/bin/env bash\n');

    const result = evaluateRepositoryReadiness(root);
    assert.equal(result.mode, 'default');
    assert.equal(result.configPath, null);
    assert.deepEqual(result.issues, []);
  });
});

// Discovery guard: the contract consults only workflow.config.json — no example
// file and no new filename (e.g. parallix.config.json). A foreign config name is
// never consulted; the repo runs on code-owned defaults.
test('config discovery is limited to workflow.config.json (no example, no new filename)', () => {
  withTempDir(root => {
    const candidates = configCandidates(root).map(c => path.basename(c));
    assert.deepEqual(candidates, ['workflow.config.json']);

    fs.writeFileSync(path.join(root, 'parallix.config.json'), '{"product":{}}');
    assert.equal(findWorkflowConfig(root), null);

    const result = evaluateRepositoryReadiness(root);
    assert.equal(result.mode, 'default');
  });
});
