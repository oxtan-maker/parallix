const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('mission Codex launcher retains the originating CODEX_HOME MCP configuration without copying it', async () => {
  const codex = require('../.test-runtime/adapters/agents/codex.js');
  const parentCodexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2265-parent-codex-home-'));
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2265-worktree-'));
  const originalCodexHome = process.env.CODEX_HOME;
  let launchedInvocation;

  try {
    fs.writeFileSync(
      path.join(parentCodexHome, 'config.toml'),
      '[mcp_servers.slack]\nurl = "https://slack.example.test/mcp"\n',
      'utf8'
    );
    process.env.CODEX_HOME = parentCodexHome;
    codex.__setSpawnAndTeeForTest((_command, _args, options) => {
      launchedInvocation = options;
      return Promise.resolve({ status: 0, stdout: '', stderr: '' });
    });

    const launched = codex.startCodexDraftAgent({ prompt: 'Execute.', worktree });
    await launched.resultPromise;

    assert.equal(launchedInvocation.env.CODEX_HOME, codex.codexStateRoot(worktree), 'the launched Codex process must use isolated worktree state');
    assert.match(
      fs.readFileSync(path.join(launchedInvocation.env.CODEX_HOME, 'config.toml'), 'utf8'),
      /\[mcp_servers\.slack\]/,
      'the launched Codex configuration root must expose the configured MCP server'
    );
    assert.ok(fs.lstatSync(codex.codexConfigPath(worktree)).isSymbolicLink(), 'the mission worktree must link, not copy, Codex configuration');
    assert.equal(fs.readlinkSync(codex.codexConfigPath(worktree)), path.join(parentCodexHome, 'config.toml'));
  } finally {
    codex.__setSpawnAndTeeForTest(null);
    if (originalCodexHome === undefined) { delete process.env.CODEX_HOME; }
    else { process.env.CODEX_HOME = originalCodexHome; }
    fs.rmSync(parentCodexHome, { recursive: true, force: true });
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test('mission Codex launcher completes when optional CODEX_HOME MCP configuration is absent', async () => {
  const codex = require('../.test-runtime/adapters/agents/codex.js');
  const originatingCodexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2265-no-mcp-origin-'));
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2265-no-mcp-worktree-'));
  let launchedInvocation;

  try {
    codex.__setSpawnAndTeeForTest((_command, _args, options) => {
      launchedInvocation = options;
      return Promise.resolve({ status: 0, stdout: '', stderr: '' });
    });

    const launched = codex.startCodexDraftAgent({
      prompt: 'Execute.',
      worktree,
      env: { CODEX_HOME: originatingCodexHome }
    });
    await launched.resultPromise;

    assert.equal(launchedInvocation.env.CODEX_HOME, codex.codexStateRoot(worktree), 'worktree-local Codex state is synthesized');
    assert.ok(
      !fs.existsSync(path.join(worktree, '.workflow', 'codex-home', '.codex', 'config.toml')),
      'mission setup completes without creating a Codex configuration file'
    );
  } finally {
    codex.__setSpawnAndTeeForTest(null);
    fs.rmSync(originatingCodexHome, { recursive: true, force: true });
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test('mission bootstrap removes stale configuration links when a repeated launch has no optional input', () => {
  const codex = require('../.test-runtime/adapters/agents/codex.js');
  const configuredOrigin = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2265-configured-origin-'));
  const absentOrigin = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2265-absent-origin-'));
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2265-repeat-worktree-'));

  try {
    fs.writeFileSync(path.join(configuredOrigin, 'config.toml'), '[mcp_servers.slack]\n', 'utf8');
    fs.writeFileSync(path.join(configuredOrigin, 'auth.json'), '{"token":"test"}\n', 'utf8');

    codex.ensureCodexHome(worktree, { CODEX_HOME: configuredOrigin });
    assert.ok(fs.lstatSync(codex.codexConfigPath(worktree)).isSymbolicLink(), 'configured bootstrap must create a config link');
    assert.ok(fs.lstatSync(codex.codexAuthPath(worktree)).isSymbolicLink(), 'configured bootstrap must create an auth link');

    codex.ensureCodexHome(worktree, { CODEX_HOME: absentOrigin });

    assert.ok(!fs.existsSync(codex.codexConfigPath(worktree)), 'an absent configuration source must remove the stale config link');
    assert.ok(!fs.existsSync(codex.codexAuthPath(worktree)), 'an absent auth source must remove the stale auth link');
  } finally {
    fs.rmSync(configuredOrigin, { recursive: true, force: true });
    fs.rmSync(absentOrigin, { recursive: true, force: true });
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test('concurrent mission launches isolate Codex session state while linking one originating config', () => {
  const codex = require('../.test-runtime/adapters/agents/codex.js');
  const parentCodexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2265-shared-config-'));
  const firstWorktree = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2265-first-worktree-'));
  const secondWorktree = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2265-second-worktree-'));
  const originalCodexHome = process.env.CODEX_HOME;

  try {
    fs.writeFileSync(path.join(parentCodexHome, 'config.toml'), '[mcp_servers.datadog]\n', 'utf8');
    process.env.CODEX_HOME = parentCodexHome;
    codex.ensureCodexHome(firstWorktree);
    codex.ensureCodexHome(secondWorktree);

    const first = codex.buildCodexDraftInvocation({ prompt: 'Execute.', worktree: firstWorktree, interactive: false });
    const second = codex.buildCodexDraftInvocation({ prompt: 'Execute.', worktree: secondWorktree, interactive: false });
    assert.notEqual(first.options.env.CODEX_HOME, second.options.env.CODEX_HOME, 'each mission must have an isolated Codex session root');
    assert.equal(fs.readlinkSync(codex.codexConfigPath(firstWorktree)), path.join(parentCodexHome, 'config.toml'));
    assert.equal(fs.readlinkSync(codex.codexConfigPath(secondWorktree)), path.join(parentCodexHome, 'config.toml'));
  } finally {
    if (originalCodexHome === undefined) { delete process.env.CODEX_HOME; }
    else { process.env.CODEX_HOME = originalCodexHome; }
    fs.rmSync(parentCodexHome, { recursive: true, force: true });
    fs.rmSync(firstWorktree, { recursive: true, force: true });
    fs.rmSync(secondWorktree, { recursive: true, force: true });
  }
});

test('mission bootstrap retains the installed Graphify skill seed', () => {
  const codex = require('../.test-runtime/adapters/agents/codex.js');
  const operatorHome = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2265-graphify-home-'));
  const originatingCodexHome = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2265-graphify-codex-home-'));
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2265-graphify-worktree-'));
  const originalHome = process.env.HOME;

  try {
    process.env.HOME = operatorHome;
    const sourceSkill = path.join(operatorHome, '.agents', 'skills', 'graphify', 'SKILL.md');
    fs.mkdirSync(path.dirname(sourceSkill), { recursive: true });
    fs.writeFileSync(sourceSkill, '# Graphify\n', 'utf8');

    codex.ensureCodexHome(worktree, { CODEX_HOME: originatingCodexHome });

    const seededSkill = path.join(worktree, '.workflow', 'codex-home', '.agents', 'skills', 'graphify', 'SKILL.md');
    assert.equal(fs.readFileSync(seededSkill, 'utf8'), '# Graphify\n');
  } finally {
    if (originalHome === undefined) { delete process.env.HOME; }
    else { process.env.HOME = originalHome; }
    fs.rmSync(operatorHome, { recursive: true, force: true });
    fs.rmSync(originatingCodexHome, { recursive: true, force: true });
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});
