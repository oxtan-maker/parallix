// @ts-nocheck -- TASK-2277: preserve legacy CommonJS mock behavior while mock-shape typings are hardened separately.

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

test('bootstrap pins dummy agent launchers so tests do not hit real workstation CLIs', () => {
  assert.match(process.env.PATH || '', /parallix-test-launchers-/);
  assert.match(process.env.PI_BIN || '', /parallix-test-launchers-/);

  for (const agent of ['codex', 'claude', 'opencode', 'vibe', 'pi']) {
    const helpResult = spawnSync(agent, ['--help'], { encoding: 'utf8', env: process.env });
    assert.equal(helpResult.status, 0, `${agent} dummy launcher should exit 0 for --help`);
  }

  const piHelp = spawnSync(process.env.PI_BIN, ['--help'], { encoding: 'utf8', env: process.env });
  assert.equal(piHelp.status, 0, 'PI_BIN dummy launcher should exit 0 for --help');
});

test('bootstrap provides a portable git init -b compatibility shim', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bootstrap-git-init-'));
  try {
    const result = spawnSync('git', ['init', '-b', 'main', root], { encoding: 'utf8', env: process.env });
    assert.equal(result.status, 0, result.stderr);
    const branch = spawnSync('git', ['-C', root, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8', env: process.env });
    assert.equal(branch.stdout.trim(), 'main');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
