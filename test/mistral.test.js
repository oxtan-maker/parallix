const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

function withVibeLauncher(run) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mistral-test-'));
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

// ---------- resolveMistralCommand ----------

test('resolveMistralCommand returns bare "vibe"', () => {
  const { resolveMistralCommand } = require('../lib/agents/mistral');
  assert.equal(resolveMistralCommand(), 'vibe');
});

// ---------- extractMistralSessionId ----------

test('extractMistralSessionId returns null for no match', () => {
  const { extractMistralSessionId } = require('../lib/agents/mistral');
  assert.equal(extractMistralSessionId(null), null);
  assert.equal(extractMistralSessionId(''), null);
  assert.equal(extractMistralSessionId('some random text'), null);
});

// Mistral Vibe does not emit a parseable resume hint in programmatic mode,
// so extractMistralSessionId always returns null.
test('extractMistralSessionId returns null (vibe has no stdout resume hint)', () => {
  const { extractMistralSessionId } = require('../lib/agents/mistral');
  assert.equal(extractMistralSessionId('Session completed'), null);
  assert.equal(extractMistralSessionId('vibe --resume abc123'), null);
});

// ---------- buildMistralInvocation ----------

test('buildMistralInvocation includes --prompt flag', () => {
  const { buildMistralInvocation } = require('../lib/agents/mistral');
  const inv = buildMistralInvocation({ prompt: 'test', worktree: '/tmp' });
  assert.equal(inv.command, 'vibe');
  assert.ok(inv.args.includes('--prompt'));
  assert.ok(inv.args.includes('test'));
});

test('buildMistralInvocation includes --trust flag', () => {
  const { buildMistralInvocation } = require('../lib/agents/mistral');
  const inv = buildMistralInvocation({ prompt: 'test', worktree: '/tmp' });
  assert.equal(inv.command, 'vibe');
  assert.ok(inv.args.includes('--trust'));
});

test('buildMistralInvocation includes --output text flag', () => {
  const { buildMistralInvocation } = require('../lib/agents/mistral');
  const inv = buildMistralInvocation({ prompt: 'test', worktree: '/tmp' });
  assert.equal(inv.command, 'vibe');
  assert.ok(inv.args.includes('--output'));
  assert.ok(inv.args.includes('text'));
});

test('buildMistralInvocation does not include resume flags', () => {
  const { buildMistralInvocation } = require('../lib/agents/mistral');
  const inv = buildMistralInvocation({ prompt: 'test', worktree: '/tmp', resume: true, sessionId: 'abc123' });
  assert.equal(inv.command, 'vibe');
  assert.ok(!inv.args.includes('--resume'));
  assert.ok(!inv.args.includes('--continue'));
  assert.ok(!inv.args.includes('-c'));
});

test('buildMistralInvocation sets cwd to worktree', () => {
  const { buildMistralInvocation } = require('../lib/agents/mistral');
  const inv = buildMistralInvocation({ prompt: 'test', worktree: '/custom/worktree' });
  assert.equal(inv.command, 'vibe');
  assert.equal(inv.options.cwd, '/custom/worktree');
});

test('buildMistralInvocation merges env', () => {
  const { buildMistralInvocation } = require('../lib/agents/mistral');
  const inv = buildMistralInvocation({ prompt: 'test', worktree: '/tmp', env: { CUSTOM: 'value' } });
  assert.equal(inv.command, 'vibe');
  assert.equal(inv.options.env.CUSTOM, 'value');
  assert.equal(inv.options.env.PATH, process.env.PATH);
});

// ---------- startMistralAgent ----------

test('startMistralAgent returns invocation and resultPromise with bare name', async () => {
  const { startMistralAgent, resolveMistralCommand } = require('../lib/agents/mistral');
  const result = withVibeLauncher(() => startMistralAgent({ prompt: 'test', worktree: '/tmp' }));
  assert.ok(result.invocation);
  assert.ok(result.invocation.command);
  assert.ok(result.invocation.args);
  assert.ok(result.resultPromise instanceof Promise);
  assert.equal((await result.resultPromise).status, 0);
  // Verify the resolved command is bare "vibe"
  assert.equal(result.invocation.command, 'vibe');
});

// ---------- module exports ----------

test('mistral module exports expected functions', () => {
  const mistral = require('../lib/agents/mistral');
  assert.equal(typeof mistral.buildMistralInvocation, 'function');
  assert.equal(typeof mistral.extractMistralSessionId, 'function');
  assert.equal(typeof mistral.resolveMistralCommand, 'function');
  assert.equal(typeof mistral.startMistralAgent, 'function');
});

// ---------- model override ----------

test('buildMistralInvocation sets VIBE_ACTIVE_MODEL env when model is provided', () => {
  const { buildMistralInvocation } = require('../lib/agents/mistral');
  const inv = buildMistralInvocation({ prompt: 'test', worktree: '/tmp', env: {}, model: 'mistral-large' });
  assert.equal(inv.options.env.VIBE_ACTIVE_MODEL, 'mistral-large');
  assert.ok(!inv.args.includes('-m'));
  assert.ok(!inv.args.includes('--model'));
});

test('buildMistralInvocation omits VIBE_ACTIVE_MODEL env when model is null/undefined', () => {
  const { buildMistralInvocation } = require('../lib/agents/mistral');
  assert.equal(buildMistralInvocation({ prompt: 't', worktree: '/tmp', env: {} }).options.env.VIBE_ACTIVE_MODEL, undefined);
  assert.equal(buildMistralInvocation({ prompt: 't', worktree: '/tmp', env: {}, model: null }).options.env.VIBE_ACTIVE_MODEL, undefined);
});
