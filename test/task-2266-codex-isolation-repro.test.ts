import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mockModule, installModuleMocks } from './lib/module-mock.js';

const codexModule = mockModule<typeof import('../src/adapters/agents/codex.js')>('../src/adapters/agents/codex.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());

test('codex launch keeps the operator HOME when caller env supplies a worktree HOME', () => {
  const operatorHome = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2266-operator-home-'));
  const callerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2266-caller-home-'));
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2266-worktree-'));
  const originalHome = process.env.HOME;

  try {
    const nestedTool = path.join(operatorHome, '.local', 'bin', 'opencode');
    fs.mkdirSync(path.dirname(nestedTool), { recursive: true });
    fs.writeFileSync(nestedTool, '#!/bin/sh\n', { mode: 0o755 });
    process.env.HOME = operatorHome;

    for (const resume of [false, true]) {
      const invocation = codexModule.buildCodexDraftInvocation({
        prompt: 'Execute.',
        worktree,
        interactive: false,
        env: { HOME: callerHome },
        resume
      });

      const launchEnv = invocation.options.env as NodeJS.ProcessEnv;
      assert.equal(launchEnv.HOME, operatorHome, 'caller env.HOME must not replace the operator HOME');
      assert.ok(
        fs.existsSync(path.join(launchEnv.HOME!, '.local', 'bin', 'opencode')),
        'the launched process must resolve an operator-installed nested tool'
      );
      assert.equal(invocation.options.env.CODEX_HOME, codexModule.codexStateRoot(worktree));
    }
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    fs.rmSync(operatorHome, { recursive: true, force: true });
    fs.rmSync(callerHome, { recursive: true, force: true });
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test('Codex bootstrap reads operator state from process HOME when caller env supplies HOME', () => {
  const operatorHome = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2266-bootstrap-operator-home-'));
  const callerHome = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2266-bootstrap-caller-home-'));
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2266-bootstrap-worktree-'));
  const originalHome = process.env.HOME;
  const originalCodexHome = process.env.CODEX_HOME;

  try {
    const operatorConfig = path.join(operatorHome, '.codex', 'config.toml');
    fs.mkdirSync(path.dirname(operatorConfig), { recursive: true });
    fs.writeFileSync(operatorConfig, '[features]\nmulti_agent = true\n', 'utf8');
    process.env.HOME = operatorHome;
    delete process.env.CODEX_HOME;

    codexModule.ensureCodexHome(worktree, { HOME: callerHome });

    assert.equal(fs.readlinkSync(codexModule.codexConfigPath(worktree)), operatorConfig);
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
    fs.rmSync(operatorHome, { recursive: true, force: true });
    fs.rmSync(callerHome, { recursive: true, force: true });
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});
