const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

test('bootstrap forces a temp PARALLIX_HOME with an isolated agents.local.json', () => {
  assert.match(process.env.PARALLIX_HOME || '', new RegExp(`^${os.tmpdir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.ok(fs.existsSync(path.join(process.env.PARALLIX_HOME, 'agents.local.json')));
});

test('bootstrap prepends dummy agent launchers so tests do not hit real workstation CLIs', () => {
  assert.match(process.env.PATH || '', /parallix-test-launchers-/);

  for (const agent of ['codex', 'claude', 'opencode', 'vibe']) {
    const helpResult = spawnSync(agent, ['--help'], { encoding: 'utf8', env: process.env });
    assert.equal(helpResult.status, 0, `${agent} dummy launcher should exit 0 for --help`);
  }
});
