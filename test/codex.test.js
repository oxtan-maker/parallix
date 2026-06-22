const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------- resolveCodexCommand ----------

test('resolveCodexCommand returns bare "codex"', () => {
  const { resolveCodexCommand } = require('../lib/agents/codex');
  assert.equal(resolveCodexCommand(), 'codex');
});

// ---------- extractCodexSessionId ----------

test('extractCodexSessionId matches codex resume pattern', () => {
  const { extractCodexSessionId } = require('../lib/agents/codex');
  const id = extractCodexSessionId('Some text\ncodex resume abc123-def456\nend');
  assert.equal(id, 'abc123-def456');
});

test('extractCodexSessionId matches Session ID alt pattern', () => {
  const { extractCodexSessionId } = require('../lib/agents/codex');
  const id = extractCodexSessionId('Session ID: abc123de-f456');
  assert.equal(id, 'abc123de-f456');
});

test('extractCodexSessionId alt pattern is case-insensitive', () => {
  const { extractCodexSessionId } = require('../lib/agents/codex');
  const id = extractCodexSessionId('session id: abc123');
  assert.equal(id, 'abc123');
});

test('extractCodexSessionId returns null for no match', () => {
  const { extractCodexSessionId } = require('../lib/agents/codex');
  assert.equal(extractCodexSessionId(null), null);
  assert.equal(extractCodexSessionId(''), null);
});

// ---------- buildCodexDraftInvocation ----------

test('buildCodexDraftInvocation uses exec path when interactive is false', () => {
  const { buildCodexDraftInvocation } = require('../lib/agents/codex');
  const inv = buildCodexDraftInvocation({ prompt: 'test', worktree: '/tmp', interactive: false });
  assert.equal(inv.command, 'codex');
  assert.ok(inv.args.includes('exec'));
  assert.ok(inv.args.includes('--sandbox'));
  assert.ok(inv.args.includes('danger-full-access'));
});

test('buildCodexDraftInvocation uses full-auto path when interactive is true', () => {
  const { buildCodexDraftInvocation } = require('../lib/agents/codex');
  const inv = buildCodexDraftInvocation({ prompt: 'test', worktree: '/tmp', interactive: true });
  assert.equal(inv.command, 'codex');
  assert.ok(inv.args.includes('--full-auto'));
  assert.ok(inv.args.includes('--cd'));
});

test('buildCodexDraftInvocation uses resume with sessionId', () => {
  const { buildCodexDraftInvocation } = require('../lib/agents/codex');
  const inv = buildCodexDraftInvocation({ prompt: 'test', worktree: '/tmp', resume: true, sessionId: 'abc123' });
  assert.ok(inv.args.includes('resume'));
  assert.ok(inv.args.includes('abc123'));
});

test('buildCodexDraftInvocation uses --last when resume is true but no sessionId', () => {
  const { buildCodexDraftInvocation } = require('../lib/agents/codex');
  const inv = buildCodexDraftInvocation({ prompt: 'test', worktree: '/tmp', resume: true, sessionId: null });
  assert.ok(inv.args.includes('--last'));
});

test('buildCodexDraftInvocation sets HOME for non-interactive', () => {
  const { buildCodexDraftInvocation } = require('../lib/agents/codex');
  const inv = buildCodexDraftInvocation({ prompt: 'test', worktree: '/tmp', interactive: false });
  assert.ok(inv.options.env.HOME.includes('.workflow/codex-home'));
});

// ---------- codex home helpers ----------

test('codexHomeRoot returns the expected path', () => {
  const { codexHomeRoot } = require('../lib/agents/codex');
  assert.equal(codexHomeRoot('/tmp/worktree'), '/tmp/worktree/.workflow/codex-home');
});

test('codexConfigPath returns the expected path', () => {
  const { codexConfigPath } = require('../lib/agents/codex');
  assert.ok(codexConfigPath('/tmp/worktree').includes('.codex/config.toml'));
});

test('codexAuthPath returns the expected path', () => {
  const { codexAuthPath } = require('../lib/agents/codex');
  assert.ok(codexAuthPath('/tmp/worktree').includes('.codex/auth.json'));
});

test('headlessCodexConfig produces valid TOML', () => {
  const { headlessCodexConfig } = require('../lib/agents/codex');
  const config = headlessCodexConfig('/tmp/worktree');
  assert.ok(config.includes('sandbox_mode = "danger-full-access"'));
  assert.ok(config.includes('trust_level = "trusted"'));
  assert.ok(config.includes('approval_policy = "never"'));
});

test('headlessCodexConfig includes multi_agent = true for Graphify subagent support', () => {
  const { headlessCodexConfig } = require('../lib/agents/codex');
  const config = headlessCodexConfig('/tmp/worktree');
  assert.ok(config.includes('[features]'), 'must include [features] section');
  assert.ok(config.includes('multi_agent = true'), 'must include multi_agent = true for Graphify Codex subagent dispatch');
});

test('headlessCodexConfig escapes double quotes in worktree path', () => {
  const { headlessCodexConfig } = require('../lib/agents/codex');
  const config = headlessCodexConfig('/tmp/work"tree');
  assert.ok(config.includes('\\"'));
});

// ---------- ensureCodexHome graphify skill copy-seed ----------

test('ensureCodexHome seeds the global graphify skill into the worktree HOME', () => {
  const { ensureCodexHome, codexHomeRoot } = require('../lib/agents/codex');
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-fakehome-'));
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-wt-'));
  const origHome = process.env.HOME;
  try {
    // Seed a fake global install at $HOME/.agents/skills/graphify (os.homedir()
    // honors $HOME on POSIX), mirroring `graphify install --platform codex`.
    const globalSkill = path.join(fakeHome, '.agents', 'skills', 'graphify');
    fs.mkdirSync(globalSkill, { recursive: true });
    fs.writeFileSync(path.join(globalSkill, 'SKILL.md'), '# graphify', 'utf8');
    process.env.HOME = fakeHome;

    ensureCodexHome(worktree);

    const seeded = path.join(codexHomeRoot(worktree), '.agents', 'skills', 'graphify', 'SKILL.md');
    assert.ok(fs.existsSync(seeded), 'skill must be copied into the worktree-local HOME');

    // Idempotent: a second call leaves the same target without throwing.
    const contentBefore = fs.readFileSync(seeded, 'utf8');
    ensureCodexHome(worktree);
    const contentAfter = fs.readFileSync(seeded, 'utf8');
    assert.equal(contentBefore, contentAfter, 'skill content must be identical after re-run');
    assert.ok(fs.existsSync(seeded), 'skill must still be present after re-run');
  } finally {
    process.env.HOME = origHome;
    fs.rmSync(fakeHome, { recursive: true, force: true });
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

test('ensureCodexHome skips skill seeding when no global skill is installed', () => {
  const { ensureCodexHome, codexHomeRoot, codexConfigPath } = require('../lib/agents/codex');
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-nohome-'));
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-wt2-'));
  const origHome = process.env.HOME;
  try {
    process.env.HOME = fakeHome; // no .agents/skills/graphify present
    ensureCodexHome(worktree);
    assert.ok(fs.existsSync(codexConfigPath(worktree)), 'config must still be written');
    const seeded = path.join(codexHomeRoot(worktree), '.agents', 'skills', 'graphify');
    assert.ok(!fs.existsSync(seeded), 'no skill should be seeded when none is installed globally');
  } finally {
    process.env.HOME = origHome;
    fs.rmSync(fakeHome, { recursive: true, force: true });
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

// ---------- model override ----------

test('buildCodexDraftInvocation adds -m flag when model is provided', () => {
  const { buildCodexDraftInvocation } = require('../lib/agents/codex');
  const inv = buildCodexDraftInvocation({ prompt: 'test', worktree: '/tmp', interactive: false, model: 'gpt-5.4-mini' });
  const i = inv.args.indexOf('-m');
  assert.ok(i !== -1);
  assert.equal(inv.args[i + 1], 'gpt-5.4-mini');
});

test('buildCodexDraftInvocation omits -m flag when model is null/undefined', () => {
  const { buildCodexDraftInvocation } = require('../lib/agents/codex');
  assert.ok(!buildCodexDraftInvocation({ prompt: 't', worktree: '/tmp', interactive: false }).args.includes('-m'));
  assert.ok(!buildCodexDraftInvocation({ prompt: 't', worktree: '/tmp', interactive: false, model: null }).args.includes('-m'));
});

test('buildCodexDraftInvocation adds -m flag on the resume path too', () => {
  const { buildCodexDraftInvocation } = require('../lib/agents/codex');
  const inv = buildCodexDraftInvocation({ prompt: 't', worktree: '/tmp', resume: true, sessionId: 'abc', model: 'gpt-5.4-mini' });
  assert.ok(inv.args.includes('-m'));
  assert.ok(inv.args.includes('gpt-5.4-mini'));
});

// ---------- startCodexDraftAgent stale session detection (task-1322) ----------

test('startCodexDraftAgent retries without exec resume when spawn returns "Session not found"', async () => {
  const codex = require('../lib/agents/codex');
  const mockSessions = { clearSessionCalledWith: null, clearSession(worktree, slug, role) { this.clearSessionCalledWith = { worktree, slug, role }; return true; } };
  let spawnCount = 0;
  const mockSpawn = (cmd, args, opts) => {
    spawnCount++;
    if (spawnCount === 1) {
      return Promise.resolve({ status: 1, signal: null, stdout: '', stderr: 'Error: Session not found', error: null });
    }
    return Promise.resolve({ status: 0, signal: null, stdout: 'codex resume sess_fresh\n', stderr: '', error: null });
  };

  codex.__setSpawnAndTeeForTest(mockSpawn);
  codex.__setSessionsForTest(mockSessions);

  const { invocation, resultPromise } = codex.startCodexDraftAgent({
    prompt: 'review task', worktree: '/tmp/wt', env: {}, resume: true, sessionId: 'ses_stale', slug: 'task-1322', role: 'reviewer'
  });
  const result = await resultPromise;

  assert.equal(spawnCount, 2, 'must spawn twice: stale session then fresh');
  assert.ok(invocation.args.includes('resume'), 'original invocation must include resume');
  assert.equal(mockSessions.clearSessionCalledWith.worktree, '/tmp/wt', 'clearSession must be called with worktree');
  assert.equal(result.status, 0, 'final result must show success');

  codex.__setSpawnAndTeeForTest(null);
  codex.__setSessionsForTest(null);
});

test('startCodexDraftAgent does NOT retry when resume is false', async () => {
  const codex = require('../lib/agents/codex');
  let spawnCount = 0;
  const mockSpawn = (cmd, args, opts) => {
    spawnCount++;
    return Promise.resolve({ status: 1, signal: null, stdout: '', stderr: 'Session not found', error: null });
  };

  codex.__setSpawnAndTeeForTest(mockSpawn);

  const { resultPromise } = codex.startCodexDraftAgent({
    prompt: 'test', worktree: '/tmp/wt', env: {}, resume: false, sessionId: null
  });
  const result = await resultPromise;

  assert.equal(spawnCount, 1, 'must NOT retry when resume=false');
  assert.equal(result.status, 1, 'must return the original failure');

  codex.__setSpawnAndTeeForTest(null);
});

test('startCodexDraftAgent healthy resume still uses exec resume', async () => {
  const codex = require('../lib/agents/codex');
  let spawnCount = 0;
  const mockSpawn = (cmd, args, opts) => {
    spawnCount++;
    assert.ok(args.includes('exec'), 'must include exec for resume');
    assert.ok(args.includes('resume'), 'must include resume for resume');
    assert.ok(args.includes('ses_valid'), 'must include the session ID');
    return Promise.resolve({ status: 0, signal: null, stdout: 'codex resume ses_valid\n', stderr: '', error: null });
  };

  codex.__setSpawnAndTeeForTest(mockSpawn);

  const { invocation, resultPromise } = codex.startCodexDraftAgent({
    prompt: 'test', worktree: '/tmp/wt', env: {}, resume: true, sessionId: 'ses_valid'
  });
  const result = await resultPromise;

  assert.equal(spawnCount, 1, 'must only spawn once for healthy resume');
  assert.equal(result.status, 0, 'must succeed');

  codex.__setSpawnAndTeeForTest(null);
});
