
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function withVibeLauncher(run) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-test-'));
  const launcher = path.join(tmpRoot, 'vibe');
  fs.writeFileSync(launcher, `#!${process.execPath}\nprocess.exit(0);\n`);
  fs.chmodSync(launcher, 0o755);
  const previousPath = process.env.PATH;
  process.env.PATH = `${tmpRoot}${path.delimiter}${previousPath}`;
  const cleanup = () => {
    process.env.PATH = previousPath;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  };
  try {
    const result = run();
    if (result && result.resultPromise && typeof result.resultPromise.then === 'function') {
      result.resultPromise = result.resultPromise.finally(cleanup);
      return result;
    }
    cleanup();
    return result;
  } catch (err) {
    cleanup();
    throw err;
  }
}

// ---------- resolveVibeCommand ----------

test('resolveVibeCommand returns bare "vibe"', () => {
  const { resolveVibeCommand } = require('../dist/lib/agents/vibe');
  assert.equal(resolveVibeCommand(), 'vibe');
});

// ---------- extractVibeSessionId ----------

test('extractVibeSessionId returns null for no match', () => {
  const { extractVibeSessionId } = require('../dist/lib/agents/vibe');
  assert.equal(extractVibeSessionId(null), null);
  assert.equal(extractVibeSessionId(''), null);
  assert.equal(extractVibeSessionId('some random text'), null);
});

// Mistral Vibe does not emit a parseable resume hint in programmatic mode,
// so extractVibeSessionId always returns null.
test('extractVibeSessionId returns null (vibe has no stdout resume hint)', () => {
  const { extractVibeSessionId } = require('../dist/lib/agents/vibe');
  assert.equal(extractVibeSessionId('Session completed'), null);
  assert.equal(extractVibeSessionId('vibe --resume abc123'), null);
});

// ---------- buildVibeInvocation ----------

test('buildVibeInvocation includes --prompt flag', () => {
  const { buildVibeInvocation } = require('../dist/lib/agents/vibe');
  const inv = buildVibeInvocation({ prompt: 'test', worktree: '/tmp' });
  assert.equal(inv.command, 'vibe');
  assert.ok(inv.args.includes('--prompt'));
  assert.ok(inv.args.includes('test'));
});

test('buildVibeInvocation includes --trust flag', () => {
  const { buildVibeInvocation } = require('../dist/lib/agents/vibe');
  const inv = buildVibeInvocation({ prompt: 'test', worktree: '/tmp' });
  assert.equal(inv.command, 'vibe');
  assert.ok(inv.args.includes('--trust'));
});

test('buildVibeInvocation includes --yolo flag for non-interactive tool-call approval', () => {
  const { buildVibeInvocation } = require('../dist/lib/agents/vibe');
  const inv = buildVibeInvocation({ prompt: 'test', worktree: '/tmp' });
  assert.equal(inv.command, 'vibe');
  assert.ok(inv.args.includes('--yolo'), `expected --yolo in args: ${inv.args.join(' ')}`);
});

test('buildVibeInvocation includes --output text flag', () => {
  const { buildVibeInvocation } = require('../dist/lib/agents/vibe');
  const inv = buildVibeInvocation({ prompt: 'test', worktree: '/tmp' });
  assert.equal(inv.command, 'vibe');
  assert.ok(inv.args.includes('--output'));
  assert.ok(inv.args.includes('text'));
});

test('buildVibeInvocation includes explicit workdir and temp-dir access', () => {
  const { buildVibeInvocation } = require('../dist/lib/agents/vibe');
  const inv = buildVibeInvocation({ prompt: 'test', worktree: '/tmp/worktree' });
  assert.ok(inv.args.includes('--workdir'));
  assert.ok(inv.args.includes('/tmp/worktree'));
  assert.ok(inv.args.includes('--add-dir'));
  assert.ok(inv.args.includes('/tmp'));
});

test('buildVibeInvocation does not include resume flags', () => {
  const { buildVibeInvocation } = require('../dist/lib/agents/vibe');
  const inv = buildVibeInvocation({ prompt: 'test', worktree: '/tmp', resume: true, sessionId: 'abc123' });
  assert.equal(inv.command, 'vibe');
  assert.ok(!inv.args.includes('--resume'));
  assert.ok(!inv.args.includes('--continue'));
  assert.ok(!inv.args.includes('-c'));
});

test('buildVibeInvocation sets cwd to worktree', () => {
  const { buildVibeInvocation } = require('../dist/lib/agents/vibe');
  const inv = buildVibeInvocation({ prompt: 'test', worktree: '/custom/worktree' });
  assert.equal(inv.command, 'vibe');
  assert.equal(inv.options.cwd, '/custom/worktree');
});

test('buildVibeInvocation merges env', () => {
  const { buildVibeInvocation } = require('../dist/lib/agents/vibe');
  const inv = buildVibeInvocation({ prompt: 'test', worktree: '/tmp', env: { CUSTOM: 'value' } });
  assert.equal(inv.command, 'vibe');
  assert.equal(inv.options.env.CUSTOM, 'value');
  assert.equal(inv.options.env.VIBE_HOME, '/tmp/.workflow/vibe-home');
  assert.equal(inv.options.env.PATH, process.env.PATH);
});

// ---------- startVibeAgent ----------

test('startVibeAgent returns invocation and resultPromise with bare name', async () => {
  const { startVibeAgent, resolveVibeCommand } = require('../dist/lib/agents/vibe');
  const result = withVibeLauncher(() => startVibeAgent({ prompt: 'test', worktree: '/tmp' }));
  assert.ok(result.invocation);
  assert.ok(result.invocation.command);
  assert.ok(result.invocation.args);
  assert.ok(result.resultPromise instanceof Promise);
  assert.equal((await result.resultPromise).status, 0);
  // Verify the resolved command is bare "vibe"
  assert.equal(result.invocation.command, 'vibe');
});

test('ensureVibeHome copies config and rewrites session logging to the worktree', () => {
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-home-'));
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'vibe-wt-'));
  const previousHome = process.env.HOME;
  try {
    process.env.HOME = fakeHome;
    fs.mkdirSync(path.join(fakeHome, '.vibe'), { recursive: true });
    fs.writeFileSync(path.join(fakeHome, '.vibe', 'config.toml'), [
      'active_model = "mistral-medium-3.5"',
      '',
      '[session_logging]',
      'save_dir = "/home/example/.vibe/logs/session"',
      'enabled = true',
      ''
    ].join('\n'));

    const { ensureVibeHome, vibeConfigPath, vibeSessionLogDir } = require('../dist/lib/agents/vibe');
    ensureVibeHome(worktree);
    const written = fs.readFileSync(vibeConfigPath(worktree), 'utf8');
    assert.match(written, new RegExp(vibeSessionLogDir(worktree).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    process.env.HOME = previousHome;
    fs.rmSync(fakeHome, { recursive: true, force: true });
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

// ---------- module exports ----------

test('mistral module exports expected functions', () => {
  const mistral = require('../dist/lib/agents/vibe');
  assert.equal(typeof mistral.buildVibeInvocation, 'function');
  assert.equal(typeof mistral.extractVibeSessionId, 'function');
  assert.equal(typeof mistral.resolveVibeCommand, 'function');
  assert.equal(typeof mistral.startVibeAgent, 'function');
});

// ---------- model override ----------

test('buildVibeInvocation sets VIBE_ACTIVE_MODEL env when model is provided', () => {
  const { buildVibeInvocation } = require('../dist/lib/agents/vibe');
  const inv = buildVibeInvocation({ prompt: 'test', worktree: '/tmp', env: {}, model: 'mistral-large' });
  assert.equal(inv.options.env.VIBE_ACTIVE_MODEL, 'mistral-large');
  assert.ok(!inv.args.includes('-m'));
  assert.ok(!inv.args.includes('--model'));
});

test('buildVibeInvocation omits VIBE_ACTIVE_MODEL env when model is null/undefined', () => {
  const { buildVibeInvocation } = require('../dist/lib/agents/vibe');
  assert.equal(buildVibeInvocation({ prompt: 't', worktree: '/tmp', env: {} }).options.env.VIBE_ACTIVE_MODEL, undefined);
  assert.equal(buildVibeInvocation({ prompt: 't', worktree: '/tmp', env: {}, model: null }).options.env.VIBE_ACTIVE_MODEL, undefined);
});

// ---------- processResult ----------

const SAMPLE_META = {
  session_id: 'fbdc221c-cd03-tm2_-x',
  start_time: '2026-07-01T17:17:11.000Z',
  end_time: '2026-07-01T17:17:13.000Z',
  stats: {
    steps: 2,
    session_prompt_tokens: 9331,
    session_completion_tokens: 62,
    tool_calls_agreed: 5,
    tool_calls_rejected: 1,
    tool_calls_hook_denied: 0,
    tool_calls_failed: 0,
    tool_calls_succeeded: 4,
    context_tokens: 9393,
    last_turn_prompt_tokens: 9331,
    last_turn_completion_tokens: 62,
    last_turn_duration: 1.7835875800810754,
    tokens_per_second: 34.76139926763882,
    input_price_per_million: 1.5,
    output_price_per_million: 7.5,
    session_total_llm_tokens: 9393,
    last_turn_total_tokens: 9393,
    session_cost: 0.014461500000000002,
  },
};

const ZERO_STATS_META = {
  session_id: 'zero-session',
  stats: {
    steps: 0,
    session_prompt_tokens: 0,
    session_completion_tokens: 0,
    tool_calls_agreed: 0,
    tool_calls_rejected: 0,
    tool_calls_failed: 0,
    tool_calls_succeeded: 0,
    context_tokens: 0,
    session_total_llm_tokens: 0,
    session_cost: 0.0,
  },
};

/**
 * Create a SAMPLE_META clone with a start_time close to the current moment.
 * Used by session-scoping tests that need a temporally-valid session.
 */
function makeRecentMeta() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const iso = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.000Z`;
  return Object.assign({}, SAMPLE_META, { start_time: iso });
}

function createTempSessionDir(tmpDir, meta, subDirName) {
  const dir = path.join(tmpDir, subDirName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
  return dir;
}

test('processResult returns telemetry null for null input', () => {
  const { processResult } = require('../dist/lib/agents/vibe');
  const result = processResult(null);
  assert.equal(result.telemetry, null);
  assert.equal(result.sessionId, null);
});

test('processResult returns telemetry null for empty object input (isolated FS)', () => {
  const { processResult } = require('../dist/lib/agents/vibe');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mistral-proc-'));
  try {
    const result = processResult({}, tmp);
    assert.equal(result.telemetry, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('processResult populates telemetry with correct field names when meta.json exists', () => {
  const { processResult } = require('../dist/lib/agents/vibe');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mistral-proc-'));
  try {
    createTempSessionDir(tmp, SAMPLE_META, 'session_20260701_171711_test0001');
    const result = processResult({ status: 0, stdout: '' }, tmp);
    assert.ok(result.telemetry);
    assert.equal(result.telemetry.provider, 'mistral');
    assert.equal(result.telemetry.model, 'mistral');
    assert.equal(result.telemetry.inputTokens, 9331);
    assert.equal(result.telemetry.outputTokens, 62);
    assert.equal(result.telemetry.cachedTokens, 9393);
    assert.equal(result.telemetry.totalTokens, 9393);
    assert.equal(result.telemetry.toolCalls, 10); // 5 + 1 + 0 + 4
    assert.equal(result.telemetry.usagePercent, null);
    assert.equal(result.telemetry.cost_usd, 0.014461500000000002);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('processResult preserves sessionId when present in input', () => {
  const { processResult } = require('../dist/lib/agents/vibe');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mistral-proc-'));
  try {
    createTempSessionDir(tmp, SAMPLE_META, 'session_20260701_171711_test0002');
    const result = processResult({ sessionId: 'abc123', status: 0 }, tmp);
    assert.equal(result.sessionId, 'abc123');
    assert.ok(result.telemetry);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('processResult returns null telemetry when session has all-zero stats', () => {
  const { processResult } = require('../dist/lib/agents/vibe');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mistral-proc-'));
  try {
    createTempSessionDir(tmp, ZERO_STATS_META, 'session_20260701_171711_test0003');
    const result = processResult({ status: 0 }, tmp);
    assert.equal(result.telemetry, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('processResult returns null telemetry when no session directories exist', () => {
  const { processResult } = require('../dist/lib/agents/vibe');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mistral-proc-'));
  try {
    const result = processResult({ status: 0 }, tmp);
    assert.equal(result.telemetry, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('processResult picks valid session when newer one has zero stats', () => {
  const { processResult } = require('../dist/lib/agents/vibe');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mistral-proc-'));
  try {
    createTempSessionDir(tmp, SAMPLE_META, 'session_20260601_100000_test0004');
    createTempSessionDir(tmp, ZERO_STATS_META, 'session_20260701_171711_test0005');
    const result = processResult({ status: 0 }, tmp);
    assert.ok(result.telemetry);
    assert.equal(result.telemetry.inputTokens, 9331);
    assert.equal(result.telemetry.cost_usd, 0.014461500000000002);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------- getVibeProviderModel ----------

test('getVibeProviderModel returns correct fallback identity', () => {
  const { getVibeProviderModel } = require('../dist/lib/agents/vibe');
  const pm = getVibeProviderModel();
  assert.equal(pm.provider, 'mistral');
  assert.equal(pm.model, 'mistral');
});

test('processResult preserves extra result fields', () => {
  const { processResult } = require('../dist/lib/agents/vibe');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mistral-proc-'));
  try {
    createTempSessionDir(tmp, SAMPLE_META, 'session_20260701_171711_test0006');
    const result = processResult({ status: 0, exitCode: 0, stderr: '' }, tmp);
    assert.equal(result.status, 0);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, '');
    assert.ok(result.telemetry);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------- session-scoping validation ----------

test('processResult accepts telemetry when session start_time is within invocation window', () => {
  const { processResult } = require('../dist/lib/agents/vibe');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mistral-proc-'));
  try {
    const recentMeta = makeRecentMeta();
    const dirName = `session_${recentMeta.start_time.replace(/[-T:.Z]/g, '').slice(0, 14)}_within0000`;
    createTempSessionDir(tmp, recentMeta, dirName);
    const invocationStart = new Date().toISOString();
    const result = processResult({ status: 0 }, tmp, invocationStart);
    assert.ok(result.telemetry);
    assert.equal(result.telemetry.inputTokens, 9331);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('processResult rejects telemetry when session is too old (outside 120-min window)', () => {
  const { processResult } = require('../dist/lib/agents/vibe');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mistral-proc-'));
  try {
    const oldMeta = Object.assign({}, SAMPLE_META, {
      start_time: '2020-01-01T00:00:00.000Z',
    });
    createTempSessionDir(tmp, oldMeta, 'session_20200101_000000_test0008');
    const invocationStart = new Date().toISOString();
    const result = processResult({ status: 0 }, tmp, invocationStart);
    assert.equal(result.telemetry, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('processResult rejects telemetry when session start_time is in the future', () => {
  const { processResult } = require('../dist/lib/agents/vibe');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mistral-proc-'));
  try {
    const futureMeta = Object.assign({}, SAMPLE_META, {
      start_time: '2099-12-31T23:59:59.000Z',
    });
    createTempSessionDir(tmp, futureMeta, 'session_20991231_235959_test0009');
    const invocationStart = new Date().toISOString();
    const result = processResult({ status: 0 }, tmp, invocationStart);
    assert.equal(result.telemetry, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('processResult rejects telemetry when meta.json has no start_time field', () => {
  const { processResult } = require('../dist/lib/agents/vibe');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mistral-proc-'));
  try {
    const noTimeMeta = {
      session_id: 'no-time-session',
      stats: {
        session_prompt_tokens: 1000,
        session_completion_tokens: 50,
        session_total_llm_tokens: 1050,
      },
    };
    createTempSessionDir(tmp, noTimeMeta, 'session_20260701_171711_test0010');
    const invocationStart = new Date().toISOString();
    const result = processResult({ status: 0 }, tmp, invocationStart);
    assert.equal(result.telemetry, null);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('processResult accepts telemetry when no invocationStart is provided (backward compat)', () => {
  const { processResult } = require('../dist/lib/agents/vibe');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mistral-proc-'));
  try {
    const recentMeta = makeRecentMeta();
    const dirName = `session_${recentMeta.start_time.replace(/[-T:.Z]/g, '').slice(0, 14)}_backward0000`;
    createTempSessionDir(tmp, recentMeta, dirName);
    const result = processResult({ status: 0 }, tmp);
    assert.ok(result.telemetry);
    assert.equal(result.telemetry.inputTokens, 9331);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
