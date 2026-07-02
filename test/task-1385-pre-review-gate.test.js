const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  runPreReviewGate,
  handleGateFailureAutoBounce,
  classifyGateFailure,
} = require('../lib/review/review-loop');

async function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-1385-'));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// ============================================================================
// classifyGateFailure tests
// ============================================================================

test('classifyGateFailure returns Class 6 auto-send-back for gate failures', () => {
  const result = classifyGateFailure('some gate output');
  assert.equal(result.classification, 'class-6-genuine-gate-failure');
  assert.equal(result.action, 'auto-send-back');
  assert.equal(result.isRelaunchable, true);
});

test('classifyGateFailure is relaunchable for any gate output', () => {
  const result = classifyGateFailure('');
  assert.equal(result.isRelaunchable, true);
});

// ============================================================================
// runPreReviewGate tests
// ============================================================================

test('runPreReviewGate passes when gate command succeeds', async () => {
  await withTempDir(async root => {
    fs.writeFileSync(
      path.join(root, 'workflow.config.json'),
      JSON.stringify({
        product: { name: 'Test' },
        adapters: {
          missions: { baseDir: 'docs/missions' },
          verification: { command: 'echo ok', defaultArea: 'docs' },
        },
      })
    );

    const logs = [];
    const errors = [];
    const result = await runPreReviewGate('task-1385', root, {
      log: (msg) => logs.push(msg),
      error: (msg) => errors.push(msg),
    });

    assert.equal(result.ok, true);
    assert.equal(result.area, 'docs');
    assert.equal(result.exitCode, 0);
    assert.ok(result.command.includes('echo ok'));
  });
});

test('runPreReviewGate fails when gate command fails', async () => {
  await withTempDir(async root => {
    fs.writeFileSync(
      path.join(root, 'workflow.config.json'),
      JSON.stringify({
        product: { name: 'Test' },
        adapters: {
          missions: { baseDir: 'docs/missions' },
          verification: { command: 'exit 1', defaultArea: 'docs' },
        },
      })
    );

    const logs = [];
    const errors = [];
    const result = await runPreReviewGate('task-1385', root, {
      log: (msg) => logs.push(msg),
      error: (msg) => errors.push(msg),
    });

    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 1);
    assert.equal(result.area, 'docs');
    assert.ok(result.error);
  });
});

test('runPreReviewGate passes when no verification gate is configured', async () => {
  await withTempDir(async root => {
    fs.writeFileSync(
      path.join(root, 'workflow.config.json'),
      JSON.stringify({
        product: { name: 'Test' },
        adapters: {
          missions: { baseDir: 'docs/missions' },
        },
      })
    );

    const logs = [];
    const errors = [];
    const result = await runPreReviewGate('task-1385', root, {
      log: (msg) => logs.push(msg),
      error: (msg) => errors.push(msg),
    });

    assert.equal(result.ok, true);
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, '');
  });
});

test('runPreReviewGate captures stdout and stderr on failure', async () => {
  await withTempDir(async root => {
    fs.writeFileSync(
      path.join(root, 'workflow.config.json'),
      JSON.stringify({
        product: { name: 'Test' },
        adapters: {
          missions: { baseDir: 'docs/missions' },
          verification: { command: 'echo out; echo err >&2; exit 2', defaultArea: 'docs' },
        },
      })
    );

    const logs = [];
    const errors = [];
    const result = await runPreReviewGate('task-1385', root, {
      log: (msg) => logs.push(msg),
      error: (msg) => errors.push(msg),
    });

    assert.equal(result.ok, false);
    assert.equal(result.exitCode, 2);
    assert.ok(result.stdout.includes('out'));
    assert.ok(result.stderr.includes('err'));
  });
});

test('runPreReviewGate resolves mission area from mission directory', async () => {
  await withTempDir(async root => {
    const missionDir = path.join(root, 'missions', 'task-1385');
    fs.mkdirSync(missionDir, { recursive: true });
    // Include a verification command pattern that detectMissionAreaFromContent can parse
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission\n\nVerification: ./scripts/verify-local.sh task-1385');

    fs.writeFileSync(
      path.join(root, 'workflow.config.json'),
      JSON.stringify({
        product: { name: 'Test' },
        adapters: {
          missions: { baseDir: 'missions' },
          verification: { command: 'echo area-test', defaultArea: 'docs' },
        },
      })
    );

    const logs = [];
    const errors = [];
    const result = await runPreReviewGate('task-1385', root, {
      log: (msg) => logs.push(msg),
      error: (msg) => errors.push(msg),
    });

    assert.equal(result.ok, true);
    assert.equal(result.area, 'task-1385');
  });
});

// ============================================================================
// handleGateFailureAutoBounce tests
// ============================================================================

test('handleGateFailureAutoBounce bounces on first failure', async () => {
  await withTempDir(async root => {
    const logs = [];
    const errors = [];
    const launches = [];
    let stateWritten = null;

    const gateResult = {
      ok: false,
      area: 'docs',
      command: 'exit 1',
      exitCode: 1,
      stdout: 'stdout output',
      stderr: 'stderr output',
    };

    const result = await handleGateFailureAutoBounce('task-1385', root, gateResult, 'codex', {
      readReviewStateFn: () => null,
      writeReviewStateFn: (slug, state) => { stateWritten = state; },
      transitionTaskFn: (slug, status) => { },
      startAgentFn: async (mode, opts) => {
        launches.push({ mode, hasPrompt: !!opts.prompt });
        return { agent: 'codex' };
      },
      applyAgentFallbackFn: () => 'codex',
      log: (msg) => logs.push(msg),
      error: (msg) => errors.push(msg),
      sleepFn: () => Promise.resolve(),
      exit: () => { throw new Error('exit called'); },
    });

    assert.equal(result.bounced, true);
    assert.equal(result.stranded, false);
    assert.equal(launches.length, 1);
    assert.equal(launches[0].hasPrompt, true);
    assert.ok(stateWritten);
    assert.equal(stateWritten.metadata.gateFailureRetryCount, 1);
  });
});

test('handleGateFailureAutoBounce bounces on second failure', async () => {
  await withTempDir(async root => {
    const launches = [];
    const stateWritten = [];

    const gateResult = {
      ok: false,
      area: 'docs',
      command: 'exit 1',
      exitCode: 1,
      stdout: 'output',
      stderr: '',
    };

    // Simulate persisted state with retry count = 1
    const persistedState = { metadata: { gateFailureRetryCount: 1 } };

    const result = await handleGateFailureAutoBounce('task-1385', root, gateResult, 'codex', {
      readReviewStateFn: () => persistedState,
      writeReviewStateFn: (slug, state) => { stateWritten.push(state); },
      transitionTaskFn: () => { },
      startAgentFn: async (mode) => {
        launches.push(mode);
        return { agent: 'codex' };
      },
      applyAgentFallbackFn: () => 'codex',
      log: () => {},
      error: () => {},
      sleepFn: () => Promise.resolve(),
      exit: () => { throw new Error('exit called'); },
    });

    assert.equal(result.bounced, true);
    assert.equal(result.stranded, false);
    assert.equal(launches.length, 1);
    assert.equal(stateWritten.length, 1);
    assert.equal(stateWritten[0].metadata.gateFailureRetryCount, 2);
  });
});

test('handleGateFailureAutoBounce strands when retry limit exceeded', async () => {
  await withTempDir(async root => {
    const errors = [];

    const gateResult = {
      ok: false,
      area: 'docs',
      command: 'exit 1',
      exitCode: 1,
      stdout: 'output',
      stderr: '',
    };

    // Persisted state with retry count = 2 (max reached)
    const persistedState = { metadata: { gateFailureRetryCount: 2 } };

    const result = await handleGateFailureAutoBounce('task-1385', root, gateResult, 'codex', {
      readReviewStateFn: () => persistedState,
      writeReviewStateFn: () => {},
      transitionTaskFn: () => {},
      startAgentFn: async () => { throw new Error('should not launch'); },
      applyAgentFallbackFn: () => 'codex',
      log: () => {},
      error: (msg) => errors.push(msg),
      sleepFn: () => Promise.resolve(),
      exit: () => { throw new Error('exit called'); },
    });

    assert.equal(result.bounced, false);
    assert.equal(result.stranded, true);
    assert.ok(errors.some(e => e.includes('max retries exceeded')));
  });
});

test('handleGateFailureAutoBounce includes gate output in fix prompt', async () => {
  await withTempDir(async root => {
    let capturedPrompt = '';

    const gateResult = {
      ok: false,
      area: 'workflow',
      command: 'npm run verify:workflow',
      exitCode: 3,
      stdout: 'test failed: assertion error',
      stderr: 'npm ERR! code ELIFECYCLE',
    };

    await handleGateFailureAutoBounce('task-1385', root, gateResult, 'codex', {
      readReviewStateFn: () => null,
      writeReviewStateFn: () => {},
      transitionTaskFn: () => {},
      startAgentFn: async (mode, opts) => {
        const prompt = typeof opts.prompt === 'function' ? opts.prompt('codex') : opts.prompt;
        capturedPrompt = prompt;
        return { agent: 'codex' };
      },
      applyAgentFallbackFn: () => 'codex',
      log: () => {},
      error: () => {},
      sleepFn: () => Promise.resolve(),
      exit: () => { throw new Error('exit called'); },
    });

    assert.ok(capturedPrompt.includes('PRE-REVIEW GATE FAILURE'));
    assert.ok(capturedPrompt.includes('task-1385'));
    assert.ok(capturedPrompt.includes('workflow'));
    assert.ok(capturedPrompt.includes('test failed: assertion error'));
    assert.ok(capturedPrompt.includes('npm ERR! code ELIFECYCLE'));
    assert.ok(capturedPrompt.includes('Retry attempt: 1/2'));
  });
});

test('handleGateFailureAutoBounce increments retry count in persisted state', async () => {
  await withTempDir(async root => {
    let capturedState = null;

    const gateResult = {
      ok: false,
      area: 'docs',
      command: 'exit 1',
      exitCode: 1,
      stdout: '',
      stderr: '',
    };

    const persisted = { metadata: { gateFailureRetryCount: 0, existing: 'data' } };

    await handleGateFailureAutoBounce('task-1385', root, gateResult, 'codex', {
      readReviewStateFn: () => persisted,
      writeReviewStateFn: (slug, state) => { capturedState = state; },
      transitionTaskFn: () => {},
      startAgentFn: async () => ({ agent: 'codex' }),
      applyAgentFallbackFn: () => 'codex',
      log: () => {},
      error: () => {},
      sleepFn: () => Promise.resolve(),
      exit: () => { throw new Error('exit called'); },
    });

    assert.ok(capturedState);
    assert.equal(capturedState.metadata.gateFailureRetryCount, 1);
    assert.equal(capturedState.metadata.existing, 'data');
  });
});
