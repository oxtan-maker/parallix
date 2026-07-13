const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('codex isolation repro keeps operator-home nested tool resolution while isolating Codex state', () => {
  const { buildCodexDraftInvocation, codexStateRoot } = require('../lib/agents/codex');
  const operatorHome = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2211-operator-home-'));
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2211-worktree-'));
  const originalHome = process.env.HOME;

  try {
    const nestedTool = path.join(operatorHome, '.local', 'bin', 'opencode');
    fs.mkdirSync(path.dirname(nestedTool), { recursive: true });
    fs.writeFileSync(nestedTool, '#!/bin/sh\n', { mode: 0o755 });
    process.env.HOME = operatorHome;

    const invocation = buildCodexDraftInvocation({ prompt: 'Execute.', worktree, interactive: false });
    // @ts-expect-error TS2339 Property 'HOME' does not exist on type '{ CODEX_HOME?: string; }'.
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

test('Codex config, auth, skill seed, and rollout telemetry remain under the worktree state directory', () => {
  const codex = require('../lib/agents/codex');
  const operatorHome = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2211-state-operator-home-'));
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2211-state-worktree-'));
  const originalHome = process.env.HOME;

  try {
    process.env.HOME = operatorHome;
    const operatorAuth = path.join(operatorHome, '.codex', 'auth.json');
    const operatorSkill = path.join(operatorHome, '.agents', 'skills', 'graphify', 'SKILL.md');
    fs.mkdirSync(path.dirname(operatorAuth), { recursive: true });
    fs.mkdirSync(path.dirname(operatorSkill), { recursive: true });
    fs.writeFileSync(operatorAuth, '{"token":"test"}\n');
    fs.writeFileSync(operatorSkill, '# graphify\n');

    codex.ensureCodexHome(worktree);

    assert.ok(fs.existsSync(codex.codexConfigPath(worktree)), 'config must be worktree-local');
    assert.equal(fs.readFileSync(codex.codexAuthPath(worktree), 'utf8'), '{"token":"test"}\n', 'auth copy must be worktree-local');
    assert.ok(fs.existsSync(path.join(codex.codexHomeRoot(worktree), '.agents', 'skills', 'graphify', 'SKILL.md')), 'skill seed must be worktree-local');

    const rollout = path.join(codex.codexStateRoot(worktree), 'sessions', '2026', '07', '10', 'rollout-test.jsonl');
    fs.mkdirSync(path.dirname(rollout), { recursive: true });
    fs.writeFileSync(rollout, JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: 3 } } } }) + '\n');
    assert.equal(codex.extractCodexTelemetry(codex.codexHomeRoot(worktree)).totalTokens, 3, 'telemetry must be read from worktree-local CODEX_HOME');
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    fs.rmSync(operatorHome, { recursive: true, force: true });
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});
