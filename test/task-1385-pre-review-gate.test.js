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

test('classifyGateFailure delegates to classifyError for GateFailure', () => {
  const result = classifyGateFailure('verification gate failed with exit code 1');
  assert.equal(result.classification, 'GateFailure');
  assert.equal(result.action, 'AutoSendBack');
  assert.equal(result.isRelaunchable, true);
});

test('classifyGateFailure delegates to classifyError for InfraBlocker', () => {
  const result = classifyGateFailure('connection refused to forgejo server');
  assert.equal(result.classification, 'InfraBlocker');
  assert.equal(result.action, 'HumanOnly');
  assert.equal(result.isRelaunchable, false);
});

test('classifyGateFailure delegates to classifyError for StateMachineViolation', () => {
  const result = classifyGateFailure('task state violation: cannot transition from review to active');
  assert.equal(result.classification, 'StateMachineViolation');
  assert.equal(result.action, 'HumanOnly');
  assert.equal(result.isRelaunchable, false);
});

test('classifyGateFailure delegates to classifyError for GitBlockers', () => {
  const result = classifyGateFailure('MISSION.md is modified but uncommitted');
  assert.equal(result.classification, 'GitBlockers');
  assert.equal(result.action, 'AutoRepair');
  assert.equal(result.isRelaunchable, true);
});

test('classifyGateFailure delegates to classifyError for MissingArtifacts', () => {
  const result = classifyGateFailure('missing mission artifact: CP-1.md not found');
  assert.equal(result.classification, 'MissingArtifacts');
  assert.equal(result.action, 'AutoSendBack');
  assert.equal(result.isRelaunchable, true);
});

test('classifyGateFailure delegates to classifyError for IncompleteEvidence', () => {
  const result = classifyGateFailure('has a "## Goal Check" section but no evidence rows. A goal-check table with real evidence is required before handoff');
  assert.equal(result.classification, 'IncompleteEvidence');
  assert.equal(result.action, 'AutoSendBack');
  assert.equal(result.isRelaunchable, true);
});

test('classifyGateFailure delegates to classifyError for UnverifiableClaims', () => {
  const result = classifyGateFailure('test passed but cannot verify proof found');
  assert.equal(result.classification, 'UnverifiableClaims');
  assert.equal(result.action, 'AutoSendBack');
  assert.equal(result.isRelaunchable, true);
});

test('classifyGateFailure delegates to classifyError for MalformedGates', () => {
  const result = classifyGateFailure('malformed gate: syntax error in command');
  assert.equal(result.classification, 'MalformedGates');
  assert.equal(result.action, 'AutoRepair');
  assert.equal(result.isRelaunchable, true);
});

test('classifyGateFailure defaults to InfraBlocker HumanOnly for unrecognized errors', () => {
  const result = classifyGateFailure('');
  assert.equal(result.classification, 'InfraBlocker');
  assert.equal(result.action, 'HumanOnly');
  assert.equal(result.isRelaunchable, false);
});

test('classifyGateFailure defaults to InfraBlocker HumanOnly for non-string input', () => {
  const result = classifyGateFailure(null);
  assert.equal(result.classification, 'InfraBlocker');
  assert.equal(result.action, 'HumanOnly');
  assert.equal(result.isRelaunchable, false);
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
      // @ts-expect-error TS2741 Property 'signal' is missing in type '{ status: number; stdout: string; stderr:
      runFn: () => ({ status: 0, stdout: 'ok\n', stderr: '' }),
      findMissionAreaFn: () => 'docs',
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
      // @ts-expect-error TS2741 Property 'signal' is missing in type '{ status: number; stdout: string; stderr:
      runFn: () => ({ status: 1, stdout: '', stderr: '' }),
      findMissionAreaFn: () => 'docs',
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
      // @ts-expect-error TS2741 Property 'signal' is missing in type '{ status: number; stdout: string; stderr:
      runFn: () => ({ status: 99, stdout: '', stderr: '' }),
      findMissionAreaFn: () => 'docs',
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
      // @ts-expect-error TS2741 Property 'signal' is missing in type '{ status: number; stdout: string; stderr:
      runFn: () => ({ status: 2, stdout: 'out\n', stderr: 'err\n' }),
      findMissionAreaFn: () => 'docs',
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
      // @ts-expect-error TS2741 Property 'signal' is missing in type '{ status: number; stdout: string; stderr:
      runFn: () => ({ status: 0, stdout: 'area-test\n', stderr: '' }),
      findMissionAreaFn: () => 'task-1385',
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
      stderr: 'verification gate failed with exit code 1',
    };

    const result = await handleGateFailureAutoBounce('task-1385', root, gateResult, 'codex', {
      readReviewStateFn: () => null,
      // @ts-expect-error TS2322 Type '(slug: string, state: Record<string, unknown> | ReviewState) => void' is n
      writeReviewStateFn: (slug, state) => { stateWritten = state; },
      // @ts-expect-error TS2322 Type '(slug: string, status: string) => void' is not assignable to type '(slug:
      transitionTaskFn: (slug, status) => { },
      // @ts-expect-error TS2322 Type '(mode: string, opts: StartAgentOptions) => Promise<{ agent: string; }>' is
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
    // @ts-expect-error TS2339 Property 'metadata' does not exist on type 'never'.
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
      stderr: 'verification gate failed with exit code 1',
    };

    // Simulate persisted state with retry count = 1
    const persistedState = { metadata: { gateFailureRetryCount: 1 } };

    const result = await handleGateFailureAutoBounce('task-1385', root, gateResult, 'codex', {
      // @ts-expect-error TS2740 Type '{ metadata: { gateFailureRetryCount: number; }; }' is missing the followin
      readReviewStateFn: () => persistedState,
      // @ts-expect-error TS2322 Type '(slug: string, state: Record<string, unknown> | ReviewState) => void' is n
      writeReviewStateFn: (slug, state) => { stateWritten.push(state); },
      // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(slug: string, newStatus: string, {
      transitionTaskFn: () => { },
      // @ts-expect-error TS2322 Type '(mode: string) => Promise<{ agent: string; }>' is not assignable to type '
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
      // @ts-expect-error TS2740 Type '{ metadata: { gateFailureRetryCount: number; }; }' is missing the followin
      readReviewStateFn: () => persistedState,
      // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(slug: string, state: Record<string
      writeReviewStateFn: () => {},
      // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(slug: string, newStatus: string, {
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

test('handleGateFailureAutoBounce does not bounce for InfraBlocker (HumanOnly)', async () => {
  await withTempDir(async root => {
    const errors = [];
    const launches = [];

    const gateResult = {
      ok: false,
      area: 'docs',
      command: 'node parallix verify docs',
      exitCode: 1,
      stdout: '',
      stderr: 'connection refused to forgejo server',
    };

    const result = await handleGateFailureAutoBounce('task-1385', root, gateResult, 'codex', {
      readReviewStateFn: () => null,
      // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(slug: string, state: Record<string
      writeReviewStateFn: () => {},
      // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(slug: string, newStatus: string, {
      transitionTaskFn: () => {},
      // @ts-expect-error TS2322 Type '() => Promise<void>' is not assignable to type '(step: string, opts?: Star
      startAgentFn: async () => { launches.push('should-not-launch'); },
      applyAgentFallbackFn: () => 'codex',
      log: () => {},
      error: (msg) => errors.push(msg),
      sleepFn: () => Promise.resolve(),
      exit: () => { throw new Error('exit called'); },
    });

    assert.equal(result.bounced, false);
    assert.equal(result.stranded, true);
    assert.equal(launches.length, 0, 'should not launch agent for HumanOnly errors');
    assert.ok(errors.some(e => e.includes('InfraBlocker')));
    assert.ok(errors.some(e => e.includes('Human intervention required')));
  });
});

test('handleGateFailureAutoBounce does not bounce for StateMachineViolation (HumanOnly)', async () => {
  await withTempDir(async root => {
    const errors = [];
    const launches = [];

    const gateResult = {
      ok: false,
      area: 'docs',
      command: 'node parallix verify docs',
      exitCode: 1,
      stdout: '',
      stderr: 'task state violation: invalid transition',
    };

    const result = await handleGateFailureAutoBounce('task-1385', root, gateResult, 'codex', {
      readReviewStateFn: () => null,
      // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(slug: string, state: Record<string
      writeReviewStateFn: () => {},
      // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(slug: string, newStatus: string, {
      transitionTaskFn: () => {},
      // @ts-expect-error TS2322 Type '() => Promise<void>' is not assignable to type '(step: string, opts?: Star
      startAgentFn: async () => { launches.push('should-not-launch'); },
      applyAgentFallbackFn: () => 'codex',
      log: () => {},
      error: (msg) => errors.push(msg),
      sleepFn: () => Promise.resolve(),
      exit: () => { throw new Error('exit called'); },
    });

    assert.equal(result.bounced, false);
    assert.equal(result.stranded, true);
    assert.equal(launches.length, 0, 'should not launch agent for HumanOnly errors');
    assert.ok(errors.some(e => e.includes('StateMachineViolation')));
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
      stderr: 'verification gate failed with exit code 3',
    };

    await handleGateFailureAutoBounce('task-1385', root, gateResult, 'codex', {
      readReviewStateFn: () => null,
      // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(slug: string, state: Record<string
      writeReviewStateFn: () => {},
      // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(slug: string, newStatus: string, {
      transitionTaskFn: () => {},
      // @ts-expect-error TS2322 Type '(mode: string, opts: StartAgentOptions) => Promise<{ agent: string; }>' is
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
    assert.ok(capturedPrompt.includes('verification gate failed'));
    assert.ok(capturedPrompt.includes('Retry attempt: 1/2'));
    assert.ok(capturedPrompt.includes('Classification:'));
    assert.ok(capturedPrompt.includes('GateFailure'));
    assert.ok(capturedPrompt.includes('AutoSendBack'));
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
      stderr: 'verification gate failed with exit code 1',
    };

    const persisted = { metadata: { gateFailureRetryCount: 0, existing: 'data' } };

    await handleGateFailureAutoBounce('task-1385', root, gateResult, 'codex', {
      // @ts-expect-error TS2740 Type '{ metadata: { gateFailureRetryCount: number; existing: string; }; }' is mi
      readReviewStateFn: () => persisted,
      // @ts-expect-error TS2322 Type '(slug: string, state: Record<string, unknown> | ReviewState) => void' is n
      writeReviewStateFn: (slug, state) => { capturedState = state; },
      // @ts-expect-error TS2322 Type '() => void' is not assignable to type '(slug: string, newStatus: string, {
      transitionTaskFn: () => {},
      // @ts-expect-error TS2322 Type 'Promise<{ agent: string; }>' is not assignable to type 'Promise<{ agent: s
      startAgentFn: async () => ({ agent: 'codex' }),
      applyAgentFallbackFn: () => 'codex',
      log: () => {},
      error: () => {},
      sleepFn: () => Promise.resolve(),
      exit: () => { throw new Error('exit called'); },
    });

    assert.ok(capturedState);
    // @ts-expect-error TS2339 Property 'metadata' does not exist on type 'never'.
    assert.equal(capturedState.metadata.gateFailureRetryCount, 1);
    // @ts-expect-error TS2339 Property 'metadata' does not exist on type 'never'.
    assert.equal(capturedState.metadata.existing, 'data');
  });
});
