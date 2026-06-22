'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const opencode = require('../lib/agents/opencode');

function resetInjections() {
  opencode.__setSpawnAndTeeForTest(null);
  opencode.__setExportCaptureForTest(null);
}

test.afterEach(resetInjections);

// ---------- direct classifier coverage (F4) ----------

test('isTransientOpencodeFailure matches transient backend signatures', () => {
  for (const stderr of [
    'Error: ECONNRESET',
    'connection refused',
    'socket hang up',
    'fetch failed',
    'network timeout',
    'upstream returned 503 Service Unavailable',
    'received 502 Bad Gateway',
    'gateway timeout',
    'the model is overloaded',
    'service is temporarily unavailable',
  ]) {
    assert.equal(opencode.isTransientOpencodeFailure({ stderr }), true, `expected transient: ${stderr}`);
  }
});

test('isTransientOpencodeFailure is false for non-transient / empty output', () => {
  assert.equal(opencode.isTransientOpencodeFailure({ stdout: '', stderr: '' }), false);
  assert.equal(opencode.isTransientOpencodeFailure({ stderr: 'model not found' }), false);
  assert.equal(opencode.isTransientOpencodeFailure(null), false);
});

test('isTransientOpencodeFailure inspects stdout as well as stderr', () => {
  assert.equal(opencode.isTransientOpencodeFailure({ stdout: 'request failed: ETIMEDOUT', stderr: '' }), true);
});

test('isHardOpencodeFailure matches model-not-found / auth signatures', () => {
  for (const stderr of [
    'Error: model not found: qwen3-coder',
    'no such model',
    'unknown model "foo"',
    'invalid api key',
    '401 Unauthorized',
    'authentication failed',
  ]) {
    assert.equal(opencode.isHardOpencodeFailure({ stderr }), true, `expected hard: ${stderr}`);
  }
});

test('isHardOpencodeFailure treats ENOENT/EACCES spawn errors as hard', () => {
  assert.equal(opencode.isHardOpencodeFailure({ status: null, error: { code: 'ENOENT' } }), true);
  assert.equal(opencode.isHardOpencodeFailure({ status: null, error: { code: 'EACCES' } }), true);
});

test('isHardOpencodeFailure is false for transient / empty / null output', () => {
  assert.equal(opencode.isHardOpencodeFailure({ stderr: 'fetch failed' }), false);
  assert.equal(opencode.isHardOpencodeFailure({ stdout: '', stderr: '' }), false);
  assert.equal(opencode.isHardOpencodeFailure(null), false);
});

// ---------- plain 429 throttling (F1) ----------

test('isTransientOpencodeFailure does NOT match plain 429 (classified as limit-hit)', () => {
  assert.equal(opencode.isTransientOpencodeFailure({ status: 1, stderr: '429 Too Many Requests' }), false);
  assert.equal(opencode.isTransientOpencodeFailure({ status: 1, stderr: 'HTTP 429' }), false);
  assert.equal(opencode.isTransientOpencodeFailure({ status: 1, stderr: '429 Throttled' }), false);
});

test('shouldRetryOpencodeFailure does NOT retry plain 429 (classified as limit-hit)', () => {
  assert.equal(
    opencode.shouldRetryOpencodeFailure({ status: 1, stderr: '429 Too Many Requests' }),
    false,
    'plain 429 is a limit-hit, not a transient error',
  );
  assert.equal(
    opencode.shouldRetryOpencodeFailure({ status: 1, stderr: 'request failed: 429 Too Many Requests' }),
    false,
    '429 embedded in longer message is still a limit-hit',
  );
});

test('detectLimitHit classifies plain 429 as a limit-hit for qwen', () => {
  const { detectLimitHit } = require('../lib/agents/limit-hit');
  const result = detectLimitHit({ agent: 'qwen', status: 1, stderr: '429 Too Many Requests' });
  assert.ok(result, 'plain 429 should be detected as a limit-hit');
  assert.equal(result.source, 'fallback', 'no reset-time info in plain 429, uses fallback block');
});

test('startOpencodeAgent does NOT retry on plain 429 (limit-hit, not transient)', async () => {
  let calls = 0;
  opencode.__setSpawnAndTeeForTest(async () => {
    calls += 1;
    return { status: 1, stdout: '', stderr: '429 Too Many Requests' };
  });

  const { resultPromise } = opencode.startOpencodeAgent({ prompt: 'p', worktree: '/tmp' });
  const result = await resultPromise;

  assert.equal(calls, 1, 'no retry on 429 limit-hit');
  assert.equal(result.status, 1, '429 status surfaces for agents.js limit-hit handling');
  assert.equal(result.transientRetries, 0, 'zero retries on limit-hit');
});

test('startOpencodeAgent: plain 429 stays in-family via limit-hit detection, not generic reroute', async () => {
  let calls = 0;
  opencode.__setSpawnAndTeeForTest(async () => {
    calls += 1;
    return { status: 1, stdout: '', stderr: '429 Too Many Requests' };
  });

  const { resultPromise } = opencode.startOpencodeAgent({ prompt: 'p', worktree: '/tmp' });
  const result = await resultPromise;

  assert.equal(result.status, 1, '429 status surfaces for agents.js launchFailed boundary');
  assert.equal(result.transientRetries, 0, 'no transient retry — limit-hit owns the classification');
  assert.equal(calls, 1, 'single invocation, no retry loop');
});

// ---------- classification (criterion 2) ----------

test('shouldRetryOpencodeFailure retries a transient backend exit-1', () => {
  for (const stderr of [
    'Error: fetch failed',
    'request failed: ECONNRESET',
    'socket hang up',
    'upstream returned 503 Service Unavailable',
    'the model is overloaded, please try again',
  ]) {
    assert.equal(
      opencode.shouldRetryOpencodeFailure({ status: 1, stdout: '', stderr }),
      true,
      `expected transient: ${stderr}`,
    );
  }
});

test('shouldRetryOpencodeFailure does NOT retry a clean exit', () => {
  assert.equal(opencode.shouldRetryOpencodeFailure({ status: 0, stdout: 'fetch failed mentioned in logs', stderr: '' }), false);
});

test('shouldRetryOpencodeFailure does NOT retry hard errors (model-not-found / ENOENT / EACCES)', () => {
  assert.equal(opencode.shouldRetryOpencodeFailure({ status: 1, stderr: 'Error: model not found' }), false);
  assert.equal(opencode.shouldRetryOpencodeFailure({ status: null, error: { code: 'ENOENT' } }), false);
  assert.equal(opencode.shouldRetryOpencodeFailure({ status: null, error: { code: 'EACCES' } }), false);
});

test('shouldRetryOpencodeFailure does NOT retry a recognized limit-hit', () => {
  // qwen limit pattern: "insufficient_quota" — owned by detectLimitHit, not the retry path.
  assert.equal(opencode.shouldRetryOpencodeFailure({ status: 1, stderr: 'insufficient_quota: usage limit reached' }), false);
  // plain 429 is also a limit-hit for qwen, not a transient error
  assert.equal(opencode.shouldRetryOpencodeFailure({ status: 1, stderr: '429 Too Many Requests' }), false);
});

test('shouldRetryOpencodeFailure does NOT retry a killing signal', () => {
  assert.equal(opencode.shouldRetryOpencodeFailure({ status: null, signal: 'SIGINT', stderr: 'fetch failed' }), false);
});

// ---------- bounded in-family retry (criterion 4) ----------

test('startOpencodeAgent retries once on a transient failure then succeeds', async () => {
  let calls = 0;
  opencode.__setSpawnAndTeeForTest(async () => {
    calls += 1;
    if (calls === 1) return { status: 1, stdout: '', stderr: 'Error: fetch failed' };
    return { status: 0, stdout: 'opencode -s ses_ok\n', stderr: '' };
  });
  opencode.__setExportCaptureForTest(async () => null);

  const { resultPromise } = opencode.startOpencodeAgent({ prompt: 'p', worktree: '/tmp' });
  const result = await resultPromise;

  assert.equal(calls, 2, 'must spawn exactly twice (one retry)');
  assert.equal(result.status, 0);
  assert.equal(result.transientRetries, 1);
});

test('startOpencodeAgent retry is bounded — a persistently transient failure still surfaces', async () => {
  let calls = 0;
  opencode.__setSpawnAndTeeForTest(async () => {
    calls += 1;
    return { status: 1, stdout: '', stderr: 'Error: ECONNRESET' };
  });

  const { resultPromise } = opencode.startOpencodeAgent({ prompt: 'p', worktree: '/tmp' });
  const result = await resultPromise;

  assert.equal(calls, 2, 'one initial + one bounded retry, no infinite loop');
  assert.equal(result.status, 1, 'genuine persistent failure must still surface');
  assert.equal(result.transientRetries, 1);
});

test('startOpencodeAgent does NOT retry a hard model-not-found failure', async () => {
  let calls = 0;
  opencode.__setSpawnAndTeeForTest(async () => {
    calls += 1;
    return { status: 1, stdout: '', stderr: 'Error: model not found: qwen3-coder' };
  });

  const { resultPromise } = opencode.startOpencodeAgent({ prompt: 'p', worktree: '/tmp' });
  const result = await resultPromise;

  assert.equal(calls, 1, 'hard failure must not be retried');
  assert.equal(result.status, 1);
  assert.equal(result.transientRetries, 0);
});

// ---------- telemetry isolation (criterion 3) ----------

test('startOpencodeAgent: a throwing export capture leaves result.status unchanged', async () => {
  opencode.__setSpawnAndTeeForTest(async () => ({ status: 0, stdout: 'opencode -s ses_x\n', stderr: '' }));
  opencode.__setExportCaptureForTest(() => { throw new Error('export blew up'); });

  const { resultPromise } = opencode.startOpencodeAgent({ prompt: 'p', worktree: '/tmp' });
  const result = await resultPromise;

  assert.equal(result.status, 0, 'export throwing must not change launch status');
  assert.equal(result.telemetry, undefined);
});

test('startOpencodeAgent: a rejecting export capture leaves result.status unchanged', async () => {
  opencode.__setSpawnAndTeeForTest(async () => ({ status: 0, stdout: 'opencode -s ses_y\n', stderr: '' }));
  opencode.__setExportCaptureForTest(async () => { throw new Error('export rejected'); });

  const { resultPromise } = opencode.startOpencodeAgent({ prompt: 'p', worktree: '/tmp' });
  const result = await resultPromise;

  assert.equal(result.status, 0, 'export rejection must not change launch status');
  assert.equal(result.telemetry, undefined);
});

// ---------- in-family regression (criterion 2 boundary) ----------

test('startOpencodeAgent: plain 429 throttling stays in-family via limit-hit detection', async () => {
  let calls = 0;
  opencode.__setSpawnAndTeeForTest(async () => {
    calls += 1;
    return { status: 1, stdout: '', stderr: '429 Too Many Requests' };
  });

  const { resultPromise } = opencode.startOpencodeAgent({ prompt: 'p', worktree: '/tmp' });
  const result = await resultPromise;

  assert.equal(result.status, 1, '429 status surfaces for agents.js launchFailed boundary');
  assert.equal(result.transientRetries, 0, 'no transient retry — limit-hit owns the classification');
  assert.equal(calls, 1, 'single invocation, no agents.js reroute needed');
});

test('startOpencodeAgent: persistent 429 surfaces after limit-hit detection for agents.js launchFailed', async () => {
  let calls = 0;
  opencode.__setSpawnAndTeeForTest(async () => {
    calls += 1;
    return { status: 1, stdout: '', stderr: '429 Too Many Requests' };
  });

  const { resultPromise } = opencode.startOpencodeAgent({ prompt: 'p', worktree: '/tmp' });
  const result = await resultPromise;

  assert.equal(result.status, 1, 'persistent 429 must surface for agents.js launchFailed');
  assert.equal(result.transientRetries, 0, 'no transient retry — classified as limit-hit');
  assert.equal(calls, 1, 'single invocation, then agents.js can apply local cooldown');
});
