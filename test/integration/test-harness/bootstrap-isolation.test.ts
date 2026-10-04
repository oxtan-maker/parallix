


import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { setCommandPathProbe, setLauncherHealthProbe } from '../../../src/adapters/agents/launcher-probes.js';

test('bootstrap probe doubles reach launcher selection loaded afterwards (TASK-2622.18)', async () => {
  const observed: { command: string; args: string[] }[] = [];
  setCommandPathProbe(name => name === 'bootstrap-probe-fixture' ? name : null);
  setLauncherHealthProbe((command, args) => {
    observed.push({ command, args });
    return { ok: false, reason: 'fixture rejection' };
  });
  try {
    const { workflowLauncherStatus } = await import('../../../src/adapters/agents/launcher-selection.js');
    const status = workflowLauncherStatus('bootstrap-probe-fixture');
    assert.equal(status.supported, false);
    assert.equal(status.health, 'probe-failed');
    assert.equal(status.reason, 'fixture rejection');
    assert.deepEqual(observed, [{ command: 'bootstrap-probe-fixture', args: ['--help'] }]);
  } finally {
    setCommandPathProbe(name => name);
    setLauncherHealthProbe(() => ({ ok: true }));
  }
});

test('bootstrap forces a temp PARALLIX_HOME with an isolated agents.local.json', () => {
  assert.match(process.env.PARALLIX_HOME || '', new RegExp(`^${os.tmpdir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.match(process.env.NPM_CONFIG_CACHE || '', /parallix-test-npm-cache-/);
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
