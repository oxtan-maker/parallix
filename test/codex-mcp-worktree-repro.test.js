const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Reproduction test for task-2209: codex fails on mcp
//
// Before the fix: ensureCodexHome does NOT carry MCP config from the
// operator's real ~/.codex/ into the worktree codex-home, so every
// mission that relies on MCP tools (Slack, Datadog, etc.) silently fails.
//
// After the fix: ensureCodexHome merges MCP-related TOML sections from
// the operator's real ~/.codex/config.toml into the worktree config,
// so codex launched inside the worktree has the same MCP server definitions.

test('MCP config is carried into worktree codex-home (reproduction)', () => {
  const { ensureCodexHome, codexConfigPath } = require('../lib/agents/codex');

  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-mcp-repro-'));
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-mcp-wt-'));
  const origHome = process.env.HOME;

  try {
    // Simulate operator's real ~/.codex/config.toml with MCP server definitions
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

    ensureCodexHome(worktree);

    const configContent = fs.readFileSync(codexConfigPath(worktree), 'utf8');

    assert.ok(
      configContent.includes('[mcp]'),
      'worktree config should include [mcp] section from operator home'
    );
    assert.ok(
      configContent.includes('[mcp.servers.slack]'),
      'worktree config should include [mcp.servers.slack] from operator home'
    );
    assert.ok(
      configContent.includes('[mcp.servers.datadog]'),
      'worktree config should include [mcp.servers.datadog] from operator home'
    );

    // Verify base headless config is still intact
    assert.ok(
      configContent.includes('sandbox_mode = "danger-full-access"'),
      'base sandbox config must still be present'
    );
    assert.ok(
      configContent.includes('multi_agent = true'),
      'base multi_agent feature must still be present'
    );
  } finally {
    process.env.HOME = origHome;
    fs.rmSync(fakeHome, { recursive: true, force: true });
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});