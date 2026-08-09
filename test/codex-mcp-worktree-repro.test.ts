

// Reproduction test for task-2209: codex fails on mcp
//
// The launcher must retain MCP configuration through a link rather than copy
// its contents into the worktree-local Codex state directory.

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
const ensureCodexHomeModule = mockModule<typeof import('../src/adapters/agents/codex.js')>('../src/adapters/agents/codex.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const { ensureCodexHome, codexConfigPath } = ensureCodexHomeModule;

test('MCP config is linked, not copied, into worktree codex-home (reproduction)', () => {

  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-mcp-repro-'));
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-mcp-wt-'));
  const origHome = process.env.HOME;

  try {
    // Simulate an operator's config without placing it in the worktree.
    const codexDir = path.join(fakeHome, '.codex');
    fs.mkdirSync(codexDir, { recursive: true });
    fs.writeFileSync(
      path.join(codexDir, 'config.toml'),
      [
        '[mcp]',
        'enabled = true',
        '',
        '[mcp.servers.slack]',
        'command = "npx"',
        'args = ["-y", "@slack/mcp-server"]',
        '',
        '[mcp.servers.datadog]',
        'command = "npx"',
        'args = ["-y", "@datadog/mcp"]',
        '',
      ].join('\n'),
      'utf8'
    );

    process.env.HOME = fakeHome;
    ensureCodexHome(worktree, { CODEX_HOME: codexDir });

    assert.ok(fs.lstatSync(codexConfigPath(worktree)).isSymbolicLink(), 'mission setup must link, not copy, Codex config');
    assert.equal(fs.readlinkSync(codexConfigPath(worktree)), path.join(codexDir, 'config.toml'));
  } finally {
    process.env.HOME = origHome;
    fs.rmSync(fakeHome, { recursive: true, force: true });
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});
