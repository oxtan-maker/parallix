import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { run } from '../../../src/composition/create-cli.js';
import { setCommandPathProbe, setLauncherHealthProbe } from '../../../src/adapters/agents/launcher-probes.js';
import { mkdtemp } from '../../helpers/temp-dir.js';

// Owns CLI composition -> real launcher-process autodetection. The unit owner
// covers filtering with doubles; this boundary requires only Git/Bash and stubs.
function fixture(t: import('node:test').TestContext, installed: readonly string[]) {
  const root = mkdtemp('first-run-cli-authority-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  fs.symlinkSync('/bin/bash', path.join(bin, 'bash'));
  for (const family of installed) {
    fs.writeFileSync(path.join(bin, family), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  }
  const init = spawnSync('git', ['init', '--initial-branch=main', root], { encoding: 'utf8', timeout: 5000 });
  assert.equal(init.status, 0, init.stderr);
  setCommandPathProbe(null);
  setLauncherHealthProbe(null);
  t.after(() => {
    setCommandPathProbe(name => name);
    setLauncherHealthProbe(() => ({ ok: true }));
  });
  const configPath = path.join(root, 'config/agents.json');
  const invoke = (args: string[]) => run(args, {
    baseCwd: root, log: () => '', error: () => '',
    environment: { PATH: bin, HOME: root, PARALLIX_HOME: path.join(root, 'operator'), PARALLIX_NO_TUI: '1', PARALLIX_TEST_NO_FORGEJO: '1' },
  });
  return { root, configPath, invoke };
}

function assertEligible(configPath: string, expected: string[]) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  for (const step of ['draft', 'active', 'review']) {
    assert.deepEqual(config.steps[step].eligible, expected);
  }
}

test('implicit first-run CLI discovers supplied-PATH families and preserves existing config (TASK-2724)', async t => {
  const { configPath, invoke } = fixture(t, ['codex', 'claude']);
  // No mission slug: command stops at usage after its first-run hook, no agent
  // launch, Mission transition, block update or usage measurement can happen.
  assert.equal(await invoke(['active']), 1);
  assertEligible(configPath, ['codex', 'claude']);
  const authored = '{"steps":{"active":{"eligible":["qwen"]}}}\n';
  fs.writeFileSync(configPath, authored);
  await invoke(['active']);
  assert.equal(fs.readFileSync(configPath, 'utf8'), authored);
});

test('explicit px config write detects supplied-PATH families and refreshes stale eligibility (TASK-2724)', async t => {
  const { root, configPath, invoke } = fixture(t, ['claude']);
  fs.mkdirSync(path.join(root, 'config'));
  fs.writeFileSync(configPath, '{"steps":{"active":{"eligible":["codex"]}}}\n');
  assert.equal(await invoke(['config', '--write']), 0);
  assertEligible(configPath, ['claude']);
});

test('empty supplied-PATH detection never writes config through either CLI route (TASK-2724)', async t => {
  const { configPath, invoke } = fixture(t, []);
  await invoke(['active']);
  assert.equal(fs.existsSync(configPath), false);
  assert.equal(await invoke(['config', '--write']), 0);
  assert.equal(fs.existsSync(configPath), false);
});
