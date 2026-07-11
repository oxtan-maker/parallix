const test = require('node:test');
const assert = require('node:assert/strict');
const pi = require('../lib/agents/pi');
const productConfig = require('../lib/core/product-config');
const launcherSelection = require('../lib/agents/launcher-selection');
const os = require('node:os');

test.afterEach(() => {
  // Reset Pi module test hooks
  pi.__setSpawnAndTeeForTest(null);
  pi.__setSessionsForTest(null);
});

// ---------- startPiAgent tail-buffer regression (real bug, root-caused) ----------
//
// A real production draft run's pi --mode json stream measured 18.6MB (pi
// emits a JSON event per token/delta, not per message). spawn-tee's default
// 64KB tail buffer silently truncated result.stdout to its last 64KB, which
// dropped the session-id header AND every tool_execution_end event (the
// first and last were at byte offsets 338,001 and 17,946,458 of an 18.6MB
// stream — both outside the last-64KB window), while the final assistant
// message's usage survived (it's near the true end). Net effect: real,
// non-zero token counts alongside a false toolCalls=0, which failed
// Parallix's own phantom-draft guard on a draft that was actually correct.
test('startPiAgent requests a much larger tail buffer than spawn-tee\'s 64KB default', async () => {
  let capturedOptions = null;
  pi.__setSpawnAndTeeForTest(async (command, args, options) => {
    capturedOptions = options;
    return { status: 0, stdout: '{"type":"session","id":"s1"}\n', stderr: '' };
  });
  const { resultPromise } = pi.startPiAgent({ prompt: 'hi', worktree: '/tmp/test' });
  await resultPromise;
  assert.ok(capturedOptions, 'expected spawnAndTee to be invoked');
  // 64 * 1024 is spawn-tee's DEFAULT_MAX_TAIL_BYTES; the fix must exceed it
  // by a wide margin, not just nudge it — real sessions reached 18.6MB.
  assert.ok(
    capturedOptions.maxTailBytes > 64 * 1024 * 100,
    `expected maxTailBytes to be far larger than the 64KB default, got: ${capturedOptions.maxTailBytes}`
  );
});

// ---------- resolvePiCommand ----------

test('resolvePiCommand prefers PI_BIN when it points to an executable', () => {
  const { resolvePiCommand } = pi;
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-bin-'));
  const customBin = path.join(tmpDir, 'pi');
  fs.writeFileSync(customBin, '#!/usr/bin/env bash\nexit 0\n', 'utf8');
  fs.chmodSync(customBin, 0o755);
  const original = process.env.PI_BIN;
  process.env.PI_BIN = customBin;
  try {
    assert.equal(resolvePiCommand(), customBin);
  } finally {
    if (original === undefined) {
      delete process.env.PI_BIN;
    } else {
      process.env.PI_BIN = original;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resolvePiCommand falls back to bare "pi" when no candidate exists', () => {
  const { resolvePiCommand } = pi;
  const os = require('node:os');
  const path = require('node:path');
  const fs = require('node:fs');
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-home-'));
  const originalHome = process.env.HOME;
  const originalPath = process.env.PATH;
  const originalBin = process.env.PI_BIN;
  delete process.env.PI_BIN;
  process.env.HOME = tmpHome;
  process.env.PATH = '';
  try {
    assert.equal(resolvePiCommand(), 'pi');
  } finally {
    if (originalBin === undefined) {
      delete process.env.PI_BIN;
    } else {
      process.env.PI_BIN = originalBin;
    }
    process.env.HOME = originalHome;
    process.env.PATH = originalPath;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

// ---------- buildPiInvocation ----------

test('buildPiInvocation constructs basic pi non-interactive command', () => {
  const { buildPiInvocation } = pi;
  const result = buildPiInvocation({
    prompt: 'Hello world',
    worktree: '/tmp/test',
    env: {}
  });
  assert.equal(result.command, 'pi');
  assert.deepEqual(result.args, ['--print', '--mode', 'json', '--approve', 'Hello world']);
  assert.equal(result.options.cwd, '/tmp/test');
});

test('buildPiInvocation includes model when specified', () => {
  const { buildPiInvocation } = pi;
  const result = buildPiInvocation({
    prompt: 'Hello world',
    worktree: '/tmp/test',
    model: 'test-model'
  });
  assert.equal(result.command, 'pi');
  assert.deepEqual(result.args, ['--print', '--mode', 'json', '--approve', '--model', 'test-model', 'Hello world']);
});

test('buildPiInvocation includes session-id flag when resuming with sessionId', () => {
  const { buildPiInvocation } = pi;
  const result = buildPiInvocation({
    prompt: 'Hello world',
    worktree: '/tmp/test',
    resume: true,
    sessionId: 'conv-123'
  });
  assert.equal(result.command, 'pi');
  assert.deepEqual(result.args, ['--print', '--mode', 'json', '--approve', '--session-id', 'conv-123', 'Hello world']);
});

test('buildPiInvocation includes --continue when resuming without a sessionId', () => {
  const { buildPiInvocation } = pi;
  const result = buildPiInvocation({
    prompt: 'Hello world',
    worktree: '/tmp/test',
    resume: true
  });
  assert.deepEqual(result.args, ['--print', '--mode', 'json', '--approve', '--continue', 'Hello world']);
});

// ---------- extractPiSessionId ----------

test('extractPiSessionId returns null for empty input', () => {
  const { extractPiSessionId } = pi;
  assert.equal(extractPiSessionId(''), null);
  assert.equal(extractPiSessionId(null), null);
  assert.equal(extractPiSessionId(undefined), null);
});

test('extractPiSessionId parses the --mode json session header line', () => {
  const { extractPiSessionId } = pi;
  const stdout = '{"type":"session","version":3,"id":"abc-123-def","timestamp":"2026-07-10T00:00:00Z","cwd":"/tmp"}\n' +
    '{"type":"agent_start"}\n';
  assert.equal(extractPiSessionId(stdout), 'abc-123-def');
});

test('extractPiSessionId ignores non-JSON and unrelated JSON lines', () => {
  const { extractPiSessionId } = pi;
  const stdout = 'plain text before json\n{"type":"agent_start"}\n';
  assert.equal(extractPiSessionId(stdout), null);
});

// ---------- extractPiTelemetry ----------

test('extractPiTelemetry reads real token usage, provider/model, and tool call count', () => {
  const { extractPiTelemetry } = pi;
  const usage = { input: 100, output: 20, cacheRead: 5, totalTokens: 125 };
  const assistantMessage = { role: 'assistant', provider: 'vllm', model: 'QuantTrio/Qwen3.6-27B-AWQ-6Bit', usage };
  const stdout = '{"type":"session","id":"s1"}\n' +
    '{"type":"tool_execution_end","toolCallId":"t1","toolName":"bash","result":{},"isError":false}\n' +
    `{"type":"message_end","message":${JSON.stringify(assistantMessage)}}\n` +
    `{"type":"agent_end","messages":[{"role":"user"},${JSON.stringify(assistantMessage)}]}\n`;
  assert.deepEqual(extractPiTelemetry(stdout), {
    provider: 'pi',
    model: 'QuantTrio/Qwen3.6-27B-AWQ-6Bit',
    inputTokens: 100,
    outputTokens: 20,
    cachedTokens: 5,
    totalTokens: 125,
    toolCalls: 1,
    usagePercent: null
  });
});

test('extractPiTelemetry returns null when no usage data is present', () => {
  const { extractPiTelemetry } = pi;
  assert.equal(extractPiTelemetry(''), null);
  assert.equal(extractPiTelemetry('{"type":"agent_start"}\n'), null);
});

// ---------- resolveCustomRunner ----------

test('resolveCustomRunner defaults to opencode when no config', () => {
  const { resolveCustomRunner } = productConfig;
  const fs = require('node:fs');
  const path = require('node:path');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-config-'));
  assert.equal(resolveCustomRunner(tmpDir), 'opencode');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('resolveCustomRunner reads custom runner from workflow config', () => {
  const { resolveCustomRunner } = productConfig;
  const fs = require('node:fs');
  const path = require('node:path');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'with-config-'));

  // Write a workflow config with custom runner set to pi
  const configPath = path.join(tmpDir, 'workflow.config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    adapters: {
      agents: {
        runners: { custom: 'pi' }
      }
    }
  }, null, 2));

  assert.equal(resolveCustomRunner(tmpDir), 'pi');

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('resolveCustomRunner defaults to opencode for invalid runner value', () => {
  const { resolveCustomRunner } = productConfig;
  const fs = require('node:fs');
  const path = require('node:path');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invalid-config-'));

  // Write a workflow config with invalid custom runner
  const configPath = path.join(tmpDir, 'workflow.config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    adapters: {
      agents: {
        runners: { custom: 'invalid-runner' }
      }
    }
  }, null, 2));

  // Should fall back to opencode
  assert.equal(resolveCustomRunner(tmpDir), 'opencode');

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------- resolveCustomLauncher ----------

test('resolveCustomLauncher returns opencode launcher for default config', () => {
  const { resolveCustomLauncher } = launcherSelection;
  const launcher = resolveCustomLauncher('/home/magnus/code/parallix-task-2208');
  assert.equal(typeof launcher, 'function');
  assert.equal(launcher.name, 'startOpencodeAgent');
});

// ---------- WORKFLOW_AGENT_NAMES ----------

test('WORKFLOW_AGENT_NAMES includes custom as public agent family', () => {
  const { WORKFLOW_AGENT_NAMES } = launcherSelection;
  assert.deepEqual(WORKFLOW_AGENT_NAMES, ['codex', 'claude', 'vibe', 'custom']);
  assert(WORKFLOW_AGENT_NAMES.includes('custom'));
});

// ---------- Pi failure classification ----------

test('isHardPiFailure identifies hard failures', () => {
  const { isHardPiFailure } = pi;

  // Model not found
  assert.equal(isHardPiFailure({ stderr: 'Model not found: test-model' }), true);

  // No such model
  assert.equal(isHardPiFailure({ stderr: 'No such model: test-model' }), true);

  // Invalid API key
  assert.equal(isHardPiFailure({ stderr: 'Invalid API key' }), true);

  // ENOENT
  assert.equal(isHardPiFailure({ error: { code: 'ENOENT' } }), true);

  // EACCES
  assert.equal(isHardPiFailure({ error: { code: 'EACCES' } }), true);

  // Non-hard failure
  assert.equal(isHardPiFailure({ stderr: 'Connection timeout' }), false);

  // Null/undefined
  assert.equal(isHardPiFailure(null), false);
  assert.equal(isHardPiFailure(undefined), false);
});

test('isTransientPiFailure identifies transient failures', () => {
  const { isTransientPiFailure } = pi;

  // Connection errors
  assert.equal(isTransientPiFailure({ stderr: 'ECONNREFUSED' }), true);
  assert.equal(isTransientPiFailure({ stderr: 'Connection reset' }), true);
  assert.equal(isTransientPiFailure({ stderr: 'Service unavailable' }), true);

  // Non-transient failure
  assert.equal(isTransientPiFailure({ stderr: 'Model not found' }), false);

  // Null/undefined
  assert.equal(isTransientPiFailure(null), false);
  assert.equal(isTransientPiFailure(undefined), false);
});

test('shouldRetryPiFailure identifies retryable failures', () => {
  const { shouldRetryPiFailure } = pi;

  // Transient failure with non-zero exit
  assert.equal(shouldRetryPiFailure({
    stderr: 'ECONNREFUSED',
    status: 1
  }), true);

  // Hard failure should not retry
  assert.equal(shouldRetryPiFailure({
    stderr: 'Model not found',
    status: 1
  }), false);

  // ENOENT should not retry
  assert.equal(shouldRetryPiFailure({
    error: { code: 'ENOENT' },
    status: 1
  }), false);

  // Success should not retry
  assert.equal(shouldRetryPiFailure({
    status: 0
  }), false);

  // Null/undefined
  assert.equal(shouldRetryPiFailure(null), false);
  assert.equal(shouldRetryPiFailure(undefined), false);
});