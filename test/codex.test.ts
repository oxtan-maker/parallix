
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------- resolveCodexCommand ----------

test('resolveCodexCommand returns bare "codex"', () => {
  const { resolveCodexCommand } = require('../.test-runtime/adapters/agents/codex.js');
  assert.equal(resolveCodexCommand(), 'codex');
});

// ---------- extractCodexSessionId ----------

test('extractCodexSessionId matches codex resume pattern', () => {
  const { extractCodexSessionId } = require('../.test-runtime/adapters/agents/codex.js');
  const id = extractCodexSessionId('Some text\ncodex resume abc123-def456\nend');
  assert.equal(id, 'abc123-def456');
});

test('extractCodexSessionId matches Session ID alt pattern', () => {
  const { extractCodexSessionId } = require('../.test-runtime/adapters/agents/codex.js');
  const id = extractCodexSessionId('Session ID: abc123de-f456');
  assert.equal(id, 'abc123de-f456');
});

test('extractCodexSessionId alt pattern is case-insensitive', () => {
  const { extractCodexSessionId } = require('../.test-runtime/adapters/agents/codex.js');
  const id = extractCodexSessionId('session id: abc123');
  assert.equal(id, 'abc123');
});

test('extractCodexSessionId returns null for no match', () => {
  const { extractCodexSessionId } = require('../.test-runtime/adapters/agents/codex.js');
  assert.equal(extractCodexSessionId(null), null);
  assert.equal(extractCodexSessionId(''), null);
});

// ---------- buildCodexDraftInvocation ----------

test('buildCodexDraftInvocation uses exec path when interactive is false', () => {
  const { buildCodexDraftInvocation } = require('../.test-runtime/adapters/agents/codex.js');
  const inv = buildCodexDraftInvocation({ prompt: 'test', worktree: '/tmp', interactive: false });
  assert.equal(inv.command, 'codex');
  assert.ok(inv.args.includes('exec'));
  assert.ok(inv.args.includes('--sandbox'));
  assert.ok(inv.args.includes('danger-full-access'));
});

test('buildCodexDraftInvocation uses full-auto path when interactive is true', () => {
  const { buildCodexDraftInvocation } = require('../.test-runtime/adapters/agents/codex.js');
  const inv = buildCodexDraftInvocation({ prompt: 'test', worktree: '/tmp', interactive: true });
  assert.equal(inv.command, 'codex');
  assert.ok(inv.args.includes('--full-auto'));
  assert.ok(inv.args.includes('--cd'));
});

test('buildCodexDraftInvocation uses resume with sessionId', () => {
  const { buildCodexDraftInvocation } = require('../.test-runtime/adapters/agents/codex.js');
  const inv = buildCodexDraftInvocation({ prompt: 'test', worktree: '/tmp', resume: true, sessionId: 'abc123' });
  assert.ok(inv.args.includes('resume'));
  assert.ok(inv.args.includes('abc123'));
});

test('buildCodexDraftInvocation uses --last when resume is true but no sessionId', () => {
  const { buildCodexDraftInvocation } = require('../.test-runtime/adapters/agents/codex.js');
  const inv = buildCodexDraftInvocation({ prompt: 'test', worktree: '/tmp', resume: true, sessionId: null });
  assert.ok(inv.args.includes('--last'));
});

test('buildCodexDraftInvocation isolates CODEX_HOME for non-interactive launches', () => {
  const { buildCodexDraftInvocation, codexStateRoot } = require('../.test-runtime/adapters/agents/codex.js');
  const originalCodexHome = process.env.CODEX_HOME;
  try {
    process.env.CODEX_HOME = '/tmp/originating-codex-home';
    const inv = buildCodexDraftInvocation({ prompt: 'test', worktree: '/tmp', interactive: false });
    assert.equal(inv.options.env.CODEX_HOME, codexStateRoot('/tmp'));
  } finally {
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
  }
});

// ---------- codex home helpers ----------

test('codexHomeRoot returns the expected path', () => {
  const { codexHomeRoot } = require('../.test-runtime/adapters/agents/codex.js');
  assert.equal(codexHomeRoot('/tmp/worktree'), '/tmp/worktree/.workflow/codex-home');
});

test('codexConfigPath returns the expected path', () => {
  const { codexConfigPath } = require('../.test-runtime/adapters/agents/codex.js');
  assert.ok(codexConfigPath('/tmp/worktree').includes('.codex/config.toml'));
});

test('codexAuthPath returns the expected path', () => {
  const { codexAuthPath } = require('../.test-runtime/adapters/agents/codex.js');
  assert.ok(codexAuthPath('/tmp/worktree').includes('.codex/auth.json'));
});

test('buildCodexDraftInvocation applies headless multi-agent and trust overrides', () => {
  const { buildCodexDraftInvocation } = require('../.test-runtime/adapters/agents/codex.js');
  const inv = buildCodexDraftInvocation({ prompt: 'test', worktree: '/tmp/work"tree', interactive: false });
  assert.ok(inv.args.includes('features.multi_agent=true'));
  assert.ok(inv.args.includes('approval_policy="never"'));
  assert.ok(inv.args.some(arg => arg.includes('trust_level="trusted"')));
  assert.ok(inv.args.some(arg => arg.includes('\\"')));
});

test('ensureCodexHome completes without optional source config', () => {
  const { ensureCodexHome, codexConfigPath } = require('../.test-runtime/adapters/agents/codex.js');
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-nohome-'));
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-wt2-'));
  const origHome = process.env.HOME;
  try {
    process.env.HOME = fakeHome;
    ensureCodexHome(worktree, { CODEX_HOME: path.join(fakeHome, '.codex') });
    assert.ok(!fs.existsSync(codexConfigPath(worktree)), 'mission setup must not write a Codex config');
  } finally {
    process.env.HOME = origHome;
    fs.rmSync(fakeHome, { recursive: true, force: true });
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

// ---------- model override ----------

test('buildCodexDraftInvocation adds -m flag when model is provided', () => {
  const { buildCodexDraftInvocation } = require('../.test-runtime/adapters/agents/codex.js');
  const inv = buildCodexDraftInvocation({ prompt: 'test', worktree: '/tmp', interactive: false, model: 'gpt-5.4-mini' });
  const i = inv.args.indexOf('-m');
  assert.ok(i !== -1);
  assert.equal(inv.args[i + 1], 'gpt-5.4-mini');
});

test('buildCodexDraftInvocation omits -m flag when model is null/undefined', () => {
  const { buildCodexDraftInvocation } = require('../.test-runtime/adapters/agents/codex.js');
  assert.ok(!buildCodexDraftInvocation({ prompt: 't', worktree: '/tmp', interactive: false }).args.includes('-m'));
  assert.ok(!buildCodexDraftInvocation({ prompt: 't', worktree: '/tmp', interactive: false, model: null }).args.includes('-m'));
});

test('buildCodexDraftInvocation adds -m flag on the resume path too', () => {
  const { buildCodexDraftInvocation } = require('../.test-runtime/adapters/agents/codex.js');
  const inv = buildCodexDraftInvocation({ prompt: 't', worktree: '/tmp', resume: true, sessionId: 'abc', model: 'gpt-5.4-mini' });
  assert.ok(inv.args.includes('-m'));
  assert.ok(inv.args.includes('gpt-5.4-mini'));
});

// ---------- startCodexDraftAgent stale session detection (task-1322) ----------

test('startCodexDraftAgent retries without exec resume when spawn returns "Session not found"', async () => {
  const codex = require('../.test-runtime/adapters/agents/codex.js');
  const mockSessionPort = { deleted: null, async delete(missionId, role) { this.deleted = { missionId, role }; } };
  let spawnCount = 0;
  const mockSpawn = (cmd, args, opts) => {
    spawnCount++;
    if (spawnCount === 1) {
      return Promise.resolve({ status: 1, signal: null, stdout: '', stderr: 'Error: Session not found', error: null });
    }
    return Promise.resolve({ status: 0, signal: null, stdout: 'codex resume sess_fresh\n', stderr: '', error: null });
  };

  codex.__setSpawnAndTeeForTest(mockSpawn);
  codex.__setSessionPortForTest(mockSessionPort);

  const { invocation, resultPromise } = codex.startCodexDraftAgent({
    prompt: 'review task', worktree: '/tmp/wt', env: {}, resume: true, sessionId: 'ses_stale', slug: 'task-1322', role: 'reviewer'
  });
  const result = await resultPromise;

  assert.equal(spawnCount, 2, 'must spawn twice: stale session then fresh');
  assert.ok(invocation.args.includes('resume'), 'original invocation must include resume');
  assert.deepEqual(mockSessionPort.deleted, { missionId: 'task-1322', role: 'reviewer' }, 'marker must be cleared through the port');
  assert.equal(result.status, 0, 'final result must show success');

  codex.__setSpawnAndTeeForTest(null);
  codex.__setSessionPortForTest(null);
});

test('startCodexDraftAgent does NOT retry when resume is false', async () => {
  const codex = require('../.test-runtime/adapters/agents/codex.js');
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
  const codex = require('../.test-runtime/adapters/agents/codex.js');
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
