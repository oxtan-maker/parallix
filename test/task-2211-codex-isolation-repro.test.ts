
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('codex launcher keeps operator-home nested tool resolution while isolating Codex state', () => {
  const { buildCodexDraftInvocation, codexStateRoot } = require('../.test-runtime/lib/agents/codex');
  const operatorHome = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2211-operator-home-'));
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2211-worktree-'));
  const originalHome = process.env.HOME;

  try {
    const nestedTool = path.join(operatorHome, '.local', 'bin', 'opencode');
    fs.mkdirSync(path.dirname(nestedTool), { recursive: true });
    fs.writeFileSync(nestedTool, '#!/bin/sh\n', { mode: 0o755 });
    process.env.HOME = operatorHome;

    const invocation = buildCodexDraftInvocation({ prompt: 'Execute.', worktree, interactive: false });
    const resolvedNestedTool = path.join(invocation.options.env.HOME, '.local', 'bin', 'opencode');

    assert.ok(fs.existsSync(resolvedNestedTool), 'a nested command must retain the operator HOME used to resolve its installation');
    assert.equal(invocation.options.env.CODEX_HOME, codexStateRoot(worktree), 'Codex-owned state must use the worktree-local Codex state directory');
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    fs.rmSync(operatorHome, { recursive: true, force: true });
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test('Codex setup links operator config and auth without copying their contents', () => {
  const codex = require('../.test-runtime/lib/agents/codex');
  const operatorHome = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2211-state-operator-home-'));
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2211-state-worktree-'));
  const originalHome = process.env.HOME;
  const originalCodexHome = process.env.CODEX_HOME;

  try {
    process.env.HOME = operatorHome;
    const operatorCodexHome = path.join(operatorHome, '.codex');
    fs.mkdirSync(operatorCodexHome, { recursive: true });
    fs.writeFileSync(path.join(operatorCodexHome, 'config.toml'), '[mcp_servers.slack]\n');
    fs.writeFileSync(path.join(operatorCodexHome, 'auth.json'), '{"token":"test"}\n');
    process.env.CODEX_HOME = operatorCodexHome;

    codex.ensureCodexHome(worktree);

    assert.ok(fs.lstatSync(codex.codexConfigPath(worktree)).isSymbolicLink(), 'config must be linked, not copied into the worktree');
    assert.ok(fs.lstatSync(codex.codexAuthPath(worktree)).isSymbolicLink(), 'auth must be linked, not copied into the worktree');
    assert.equal(fs.readlinkSync(codex.codexConfigPath(worktree)), path.join(operatorCodexHome, 'config.toml'));
    assert.equal(fs.readlinkSync(codex.codexAuthPath(worktree)), path.join(operatorCodexHome, 'auth.json'));
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
    fs.rmSync(operatorHome, { recursive: true, force: true });
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});
