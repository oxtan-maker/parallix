// @ts-nocheck -- TASK-2328: partial test doubles from ESM seam migration; resolve in follow-up



import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runPreReviewGate, reboundPreReviewFailure, gateFailureReason } from '../src/adapters/review/review-loop.js';

/**
 * TASK-2377.03: the pre-review bounce path is the rebound kernel
 * (`src/application/rebound-kernel.ts`). The former `classifyGateFailure`
 * delegation tests were deleted with the function: gate classification is no
 * longer derived from the failure text at this call site, and the ADR 0048
 * table is covered by `test/task-2377.03-rebound-kernel.test.ts`.
 */
const passingVerify = () => ({ ok: true });
async function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-1385-'));
  try {
    return await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

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
// reboundPreReviewFailure tests (TASK-2377.03 kernel wiring)
// ============================================================================

test('reboundPreReviewFailure bounces a gate failure whose verify re-run passes', async () => {
  await withTempDir(async root => {
    const launches = [];
    const stateWrites = [];
    let verifyRuns = 0;

    const result = await reboundPreReviewFailure('task-1385', root, gateFailureReason({
      ok: false,
      area: 'docs',
      command: 'exit 1',
      exitCode: 1,
      stdout: 'stdout output',
      stderr: 'verification gate failed with exit code 1',
    }), 'codex', {
      verifyFn: () => { verifyRuns++; return { ok: true }; },
      readReviewStateFn: () => null,
      writeReviewStateFn: (slug, state) => { stateWrites.push(state); },
      transitionTaskFn: () => {},
      startAgentFn: async (mode, opts) => {
        launches.push({ mode, hasPrompt: !!opts.prompt });
        return { agent: 'codex', result: { status: 0 } };
      },
      applyAgentFallbackFn: () => 'codex',
      log: () => {}, error: () => {},
    });

    assert.equal(result.bounced, true);
    assert.equal(result.stranded, false);
    assert.equal(result.outcome, 'fixed');
    assert.equal(launches.length, 1);
    assert.equal(launches[0].hasPrompt, true);
    assert.equal(verifyRuns, 1, 'the failing check must re-run before the bounce is reported fixed');
    // TASK-2377.03 SC3: the budget is in-memory per occurrence, so the bounce
    // path writes no retry counter to review state.
    assert.deepEqual(stateWrites, []);
  });
});

test('reboundPreReviewFailure rebounces a gate failure with arbitrary test output', async () => {
  await withTempDir(async root => {
    const launches = [];
    const transitions = [];

    const result = await reboundPreReviewFailure('task-1385', root, gateFailureReason({
      ok: false,
      area: 'static-analysis',
      command: './scripts/verify-local.sh static-analysis',
      exitCode: 1,
      stdout: 'test/example.test.js:42: assertion failed',
      stderr: '',
      error: 'verification gate failed with exit code 1',
    }), 'codex', {
      verifyFn: passingVerify,
      readReviewStateFn: () => null,
      writeReviewStateFn: () => {},
      transitionTaskFn: (slug, status) => { transitions.push({ slug, status }); },
      startAgentFn: async (mode, opts) => {
        const prompt = typeof opts.prompt === 'function' ? opts.prompt('codex') : opts.prompt;
        launches.push({ mode, prompt });
        return { agent: 'codex', result: { status: 0 } };
      },
      applyAgentFallbackFn: () => 'codex',
      log: () => {}, error: () => {},
    });

    assert.equal(result.bounced, true);
    assert.equal(result.stranded, false);
    assert.deepEqual(transitions, [{ slug: 'task-1385', status: 'active' }]);
    assert.equal(launches.length, 1);
    assert.match(launches[0].prompt, /assertion failed/);
  });
});

test('reboundPreReviewFailure relaunches with the fresh diagnostic when the verify re-run still fails', async () => {
  await withTempDir(async root => {
    const prompts = [];
    const verifyDiagnostics = ['second run: 1 test still failing'];

    const result = await reboundPreReviewFailure('task-1385', root, gateFailureReason({
      ok: false,
      area: 'docs',
      command: 'exit 1',
      exitCode: 1,
      stdout: 'first run diagnostic',
      stderr: '',
    }), 'codex', {
      verifyFn: () => verifyDiagnostics.length
        ? { ok: false, diagnostic: verifyDiagnostics.shift() }
        : { ok: true },
      readReviewStateFn: () => null,
      writeReviewStateFn: () => {},
      transitionTaskFn: () => {},
      startAgentFn: async (mode, opts) => {
        prompts.push(typeof opts.prompt === 'function' ? opts.prompt('codex') : opts.prompt);
        return { agent: 'codex', result: { status: 0 } };
      },
      applyAgentFallbackFn: () => 'codex',
      log: () => {}, error: () => {},
    });

    assert.equal(result.bounced, true);
    assert.equal(prompts.length, 2);
    assert.match(prompts[0], /first run diagnostic/);
    assert.match(prompts[1], /second run: 1 test still failing/);
  });
});

test('reboundPreReviewFailure strands the mission when the per-occurrence budget is spent', async () => {
  await withTempDir(async root => {
    const errors = [];
    let launches = 0;

    const result = await reboundPreReviewFailure('task-1385', root, gateFailureReason({
      ok: false,
      area: 'docs',
      command: 'exit 1',
      exitCode: 1,
      stdout: 'output',
      stderr: '',
    }), 'codex', {
      verifyFn: () => ({ ok: false, diagnostic: 'gate still failing' }),
      readReviewStateFn: () => null,
      writeReviewStateFn: () => {},
      transitionTaskFn: () => {},
      startAgentFn: async () => { launches++; return { agent: 'codex', result: { status: 0 } }; },
      applyAgentFallbackFn: () => 'codex',
      log: () => {}, error: (msg) => errors.push(msg),
    });

    assert.equal(result.bounced, false);
    assert.equal(result.stranded, true);
    assert.equal(result.outcome, 'exhausted');
    assert.equal(result.diagnostic, 'gate still failing');
    assert.equal(launches, 2, 'the default budget is two attempts per occurrence');
    assert.ok(errors.some(e =>
      e.includes('Recovery dossier for task-1385') &&
      e.includes('implementer repair budget (2)') &&
      e.includes('gate still failing')
    ));
  });
});

test('reboundPreReviewFailure does not bounce for InfraBlocker (HumanOnly)', async () => {
  await withTempDir(async root => {
    const errors = [];
    const launches = [];

    const result = await reboundPreReviewFailure('task-1385', root, gateFailureReason({
      ok: false,
      area: 'docs',
      command: 'node parallix verify docs',
      exitCode: 1,
      stdout: '',
      stderr: 'connection refused to forgejo server',
    }), 'codex', {
      verifyFn: passingVerify,
      readReviewStateFn: () => null,
      writeReviewStateFn: () => {},
      transitionTaskFn: () => {},
      startAgentFn: async () => { launches.push('should-not-launch'); },
      applyAgentFallbackFn: () => 'codex',
      log: () => {}, error: (msg) => errors.push(msg),
    });

    assert.equal(result.bounced, false);
    assert.equal(result.stranded, true);
    assert.equal(result.outcome, 'human-only');
    assert.equal(launches.length, 0, 'should not launch agent for HumanOnly errors');
    assert.ok(errors.some(e => e.includes('InfraBlocker')));
    assert.ok(errors.some(e => e.includes('Human intervention required')));
  });
});

test('reboundPreReviewFailure does not bounce for StateMachineViolation (HumanOnly)', async () => {
  await withTempDir(async root => {
    const errors = [];
    const launches = [];

    const result = await reboundPreReviewFailure('task-1385', root, gateFailureReason({
      ok: false,
      area: 'docs',
      command: 'node parallix verify docs',
      exitCode: 1,
      stdout: '',
      stderr: 'transition not allowed for this task',
    }), 'codex', {
      verifyFn: passingVerify,
      readReviewStateFn: () => null,
      writeReviewStateFn: () => {},
      transitionTaskFn: () => {},
      startAgentFn: async () => { launches.push('should-not-launch'); },
      applyAgentFallbackFn: () => 'codex',
      log: () => {}, error: (msg) => errors.push(msg),
    });

    assert.equal(result.bounced, false);
    assert.equal(result.stranded, true);
    assert.equal(launches.length, 0);
    assert.ok(errors.some(e => e.includes('StateMachineViolation')));
  });
});

test('reboundPreReviewFailure includes gate output and the ADR 0048 gate classification in the fix prompt', async () => {
  await withTempDir(async root => {
    let capturedPrompt = '';

    await reboundPreReviewFailure('task-1385', root, gateFailureReason({
      ok: false,
      area: 'workflow',
      command: 'npm run verify:workflow',
      exitCode: 3,
      stdout: 'test failed: assertion error',
      stderr: 'verification gate failed with exit code 3',
    }), 'codex', {
      verifyFn: passingVerify,
      readReviewStateFn: () => null,
      writeReviewStateFn: () => {},
      transitionTaskFn: () => {},
      startAgentFn: async (mode, opts) => {
        capturedPrompt = typeof opts.prompt === 'function' ? opts.prompt('codex') : opts.prompt;
        return { agent: 'codex', result: { status: 0 } };
      },
      applyAgentFallbackFn: () => 'codex',
      log: () => {}, error: () => {},
    });

    assert.ok(capturedPrompt.includes('PRE-REVIEW GATE FAILURE'));
    assert.ok(capturedPrompt.includes('task-1385'));
    assert.ok(capturedPrompt.includes('workflow'));
    assert.ok(capturedPrompt.includes('test failed: assertion error'));
    assert.ok(capturedPrompt.includes('verification gate failed'));
    assert.ok(capturedPrompt.includes('Retry attempt: 1/2'));
    // TASK-2377.03 SC5: a declared gate that ran and exited non-zero is a
    // GateFailure; the former GitBlockers/AutoRepair relabel was the per-site
    // remap the kernel deleted.
    assert.ok(capturedPrompt.includes('Classification: GateFailure — AutoSendBack'));
    assert.ok(capturedPrompt.includes('The failing check re-runs automatically after your fix'));
  });
});

test('reboundPreReviewFailure refuses to bounce without a verify callback', async () => {
  await withTempDir(async root => {
    await assert.rejects(
      () => reboundPreReviewFailure('task-1385', root, gateFailureReason({
        ok: false, area: 'docs', command: 'exit 1', exitCode: 1, stdout: 'output', stderr: '',
      }), 'codex', {
        readReviewStateFn: () => null,
        writeReviewStateFn: () => {},
        transitionTaskFn: () => {},
        startAgentFn: async () => ({ agent: 'codex', result: { status: 0 } }),
        applyAgentFallbackFn: () => 'codex',
        log: () => {}, error: () => {},
      }),
      /requires a verify callback/,
    );
  });
});
