const test = require('node:test');
const assert = require('node:assert/strict');

// ---------- resolveOpencodeCommand ----------

test('resolveOpencodeCommand returns bare "opencode"', () => {
  const { resolveOpencodeCommand } = require('../lib/agents/opencode');
  assert.equal(resolveOpencodeCommand(), 'opencode');
});

// ---------- extractOpencodeSessionId ----------

test('extractOpencodeSessionId matches opencode -s pattern', () => {
  const { extractOpencodeSessionId } = require('../lib/agents/opencode');
  const id = extractOpencodeSessionId('Continue  opencode -s ses_abc123\nend');
  assert.equal(id, 'ses_abc123');
});

test('extractOpencodeSessionId returns null for no match', () => {
  const { extractOpencodeSessionId } = require('../lib/agents/opencode');
  assert.equal(extractOpencodeSessionId(null), null);
  assert.equal(extractOpencodeSessionId(''), null);
});

// ---------- buildOpencodeInvocation ----------

test('buildOpencodeInvocation includes run --pure --dangerously-skip-permissions flags', () => {
  const { buildOpencodeInvocation } = require('../lib/agents/opencode');
  const inv = buildOpencodeInvocation({ prompt: 'test', worktree: '/tmp' });
  assert.equal(inv.command, 'opencode');
  assert.ok(inv.args.includes('run'));
  assert.ok(inv.args.includes('--pure'));
  assert.ok(inv.args.includes('--dangerously-skip-permissions'));
});

test('buildOpencodeInvocation includes -s sessionId when resume and sessionId provided', () => {
  const { buildOpencodeInvocation } = require('../lib/agents/opencode');
  const inv = buildOpencodeInvocation({ prompt: 'test', worktree: '/tmp', resume: true, sessionId: 'ses_abc' });
  assert.equal(inv.command, 'opencode');
  assert.ok(inv.args.includes('-s'));
  assert.ok(inv.args.includes('ses_abc'));
});

test('buildOpencodeInvocation includes --continue when resume but no sessionId', () => {
  const { buildOpencodeInvocation } = require('../lib/agents/opencode');
  const inv = buildOpencodeInvocation({ prompt: 'test', worktree: '/tmp', resume: true, sessionId: null });
  assert.equal(inv.command, 'opencode');
  assert.ok(inv.args.includes('--continue'));
  assert.ok(!inv.args.includes('-s'));
});

test('buildOpencodeInvocation omits resume flags when resume is false', () => {
  const { buildOpencodeInvocation } = require('../lib/agents/opencode');
  const inv = buildOpencodeInvocation({ prompt: 'test', worktree: '/tmp', resume: false });
  assert.equal(inv.command, 'opencode');
  assert.ok(!inv.args.includes('--continue'));
  assert.ok(!inv.args.includes('-s'));
});

test('buildOpencodeInvocation passes prompt as last arg', () => {
  const { buildOpencodeInvocation } = require('../lib/agents/opencode');
  const inv = buildOpencodeInvocation({ prompt: 'hello world', worktree: '/tmp' });
  assert.equal(inv.command, 'opencode');
  assert.ok(inv.args.includes('hello world'));
});

test('buildOpencodeInvocation sets cwd to worktree', () => {
  const { buildOpencodeInvocation } = require('../lib/agents/opencode');
  const inv = buildOpencodeInvocation({ prompt: 'test', worktree: '/custom/worktree' });
  assert.equal(inv.command, 'opencode');
  assert.equal(inv.options.cwd, '/custom/worktree');
});

// ---------- model override ----------

test('buildOpencodeInvocation adds -m flag when model is provided', () => {
  const { buildOpencodeInvocation } = require('../lib/agents/opencode');
  const inv = buildOpencodeInvocation({ prompt: 'test', worktree: '/tmp', env: {}, model: 'qwen3-coder' });
  const i = inv.args.indexOf('-m');
  assert.ok(i !== -1);
  assert.equal(inv.args[i + 1], 'qwen3-coder');
});

test('buildOpencodeInvocation omits -m flag when model is null/undefined', () => {
  const { buildOpencodeInvocation } = require('../lib/agents/opencode');
  assert.ok(!buildOpencodeInvocation({ prompt: 't', worktree: '/tmp', env: {} }).args.includes('-m'));
  assert.ok(!buildOpencodeInvocation({ prompt: 't', worktree: '/tmp', env: {}, model: null }).args.includes('-m'));
});

// ---------- startOpencodeAgent stale session detection (task-1322) ----------

test('startOpencodeAgent retries without -s when spawn returns "Session not found" in stderr', async () => {
  const opencode = require('../lib/agents/opencode');
  const mockSessions = {
    clearSessionCalledWith: null,
    clearSession(worktree, slug, role) {
      this.clearSessionCalledWith = { worktree, slug, role };
      return true;
    }
  };
  let spawnCount = 0;
  const mockSpawn = (cmd, args, opts) => {
    spawnCount++;
    if (spawnCount === 1) {
      // First call: stale session error
      return Promise.resolve({ status: 1, signal: null, stdout: '', stderr: 'Error: Session not found', error: null });
    }
    // Second call: fresh session succeeds
    return Promise.resolve({ status: 0, signal: null, stdout: 'done opencode -s ses_fresh123\n', stderr: '', sessionId: 'ses_fresh123', error: null });
  };
  const mockExport = () => Promise.resolve(null);

  opencode.__setSpawnAndTeeForTest(mockSpawn);
  opencode.__setExportCaptureForTest(mockExport);
  opencode.__setSessionsForTest(mockSessions);

  const { invocation, resultPromise } = opencode.startOpencodeAgent({
    prompt: 'review task',
    worktree: '/tmp/wt',
    env: {},
    resume: true,
    sessionId: 'ses_stale',
    slug: 'task-1322',
    role: 'reviewer'
  });

  const result = await resultPromise;

  assert.equal(spawnCount, 2, 'must spawn twice: stale session then fresh');
  assert.equal(invocation.args.includes('-s'), true, 'original invocation must include -s');
  assert.equal(mockSessions.clearSessionCalledWith.worktree, '/tmp/wt', 'clearSession must be called with worktree');
  assert.equal(mockSessions.clearSessionCalledWith.slug, 'task-1322', 'clearSession must be called with slug');
  assert.equal(mockSessions.clearSessionCalledWith.role, 'reviewer', 'clearSession must be called with role');
  assert.equal(result.status, 0, 'final result must show success');

  // Restore originals
  opencode.__setSpawnAndTeeForTest(null);
  opencode.__setExportCaptureForTest(null);
  opencode.__setSessionsForTest(null);
});

test('startOpencodeAgent retries without -s when "Session not found" appears in stdout', async () => {
  const opencode = require('../lib/agents/opencode');
  const mockSessions = { clearSessionCalledWith: null, clearSession(worktree, slug, role) { this.clearSessionCalledWith = { worktree, slug, role }; return true; } };
  let spawnCount = 0;
  const mockSpawn = (cmd, args, opts) => {
    spawnCount++;
    if (spawnCount === 1) {
      return Promise.resolve({ status: 1, signal: null, stdout: 'Session not found: ses_expired', stderr: '', error: null });
    }
    return Promise.resolve({ status: 0, signal: null, stdout: 'done opencode -s ses_ok\n', stderr: '', error: null });
  };
  const mockExport = () => Promise.resolve(null);

  opencode.__setSpawnAndTeeForTest(mockSpawn);
  opencode.__setExportCaptureForTest(mockExport);
  opencode.__setSessionsForTest(mockSessions);

  const { resultPromise } = opencode.startOpencodeAgent({
    prompt: 'test', worktree: '/tmp/wt', env: {}, resume: true, sessionId: 'ses_expired', slug: 's', role: 'r'
  });
  const result = await resultPromise;

  assert.equal(spawnCount, 2, 'must retry on stdout stale session');
  assert.equal(result.status, 0, 'final result must succeed');

  opencode.__setSpawnAndTeeForTest(null);
  opencode.__setExportCaptureForTest(null);
  opencode.__setSessionsForTest(null);
});

test('startOpencodeAgent does NOT retry when resume is false', async () => {
  const opencode = require('../lib/agents/opencode');
  let spawnCount = 0;
  const mockSpawn = (cmd, args, opts) => {
    spawnCount++;
    return Promise.resolve({ status: 1, signal: null, stdout: '', stderr: 'Session not found', error: null });
  };
  const mockExport = () => Promise.resolve(null);

  opencode.__setSpawnAndTeeForTest(mockSpawn);
  opencode.__setExportCaptureForTest(mockExport);

  const { resultPromise } = opencode.startOpencodeAgent({
    prompt: 'test', worktree: '/tmp/wt', env: {}, resume: false, sessionId: null
  });
  const result = await resultPromise;

  assert.equal(spawnCount, 1, 'must NOT retry when resume=false');
  assert.equal(result.status, 1, 'must return the original failure');

  opencode.__setSpawnAndTeeForTest(null);
  opencode.__setExportCaptureForTest(null);
});

test('startOpencodeAgent healthy resume still uses -s flag', async () => {
  const opencode = require('../lib/agents/opencode');
  let spawnCount = 0;
  const mockSpawn = (cmd, args, opts) => {
    spawnCount++;
    assert.ok(args.includes('-s'), 'must include -s flag for healthy resume');
    assert.ok(args.includes('ses_valid'), 'must include the session ID');
    return Promise.resolve({ status: 0, signal: null, stdout: 'done opencode -s ses_valid\n', stderr: '', error: null });
  };
  const mockExport = () => Promise.resolve(null);

  opencode.__setSpawnAndTeeForTest(mockSpawn);
  opencode.__setExportCaptureForTest(mockExport);

  const { invocation, resultPromise } = opencode.startOpencodeAgent({
    prompt: 'test', worktree: '/tmp/wt', env: {}, resume: true, sessionId: 'ses_valid'
  });
  const result = await resultPromise;

  assert.equal(spawnCount, 1, 'must only spawn once for healthy resume');
  assert.equal(result.status, 0, 'must succeed');

  opencode.__setSpawnAndTeeForTest(null);
  opencode.__setExportCaptureForTest(null);
});
