// @ts-nocheck -- Retained legacy partial request doubles (TASK-2328).
// review gate repair contract.
// Related scenarios share imports; each contract keeps its own hooks and mutable fixtures.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  startReviewLoop,
  runPreReviewGate,
  reboundPreReviewFailure,
  gateFailureReason,
} from '../src/adapters/review/review-loop.js';
import fs from 'node:fs';
import path from 'node:path';
import { mkdtemp as registeredMkdtemp } from './helpers/temp-dir.js';
import { HandoffCommandUseCase } from '../src/application/handoff-command-use-case.js';
import { rebound } from '../src/application/rebound-kernel.js';
import { submitForReview } from '../src/adapters/review/review-commands.js';

// Regression provenance: TASK-1268.
describe("pre review gate per round", { concurrency: false }, () => {
  const TEST_SLUG = `task-1268-gate-per-round-${process.pid}`;

  test('startReviewLoop runs the pre-review gate before every reviewer round', async () => {
    const events = [];
    const gateCalls = [];
    const reviewOutcomes = ['REQUEST_CHANGES', 'APPROVED'];
    const dispositions = ['CHANGES_MADE'];

    await startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'custom'],
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      transitionTaskFn: async () => {},
      transitionVirtualFn: async () => {},
      implementer: 'claude', reviewer: 'codex', dryRun: false,
      // Every boundary this scenario reaches is injected, so do not resolve the
      // repository worktree or create per-test operator state.
      worktree: '/tmp',
      workflowLauncherStatusFn: () => ({ supported: true }),
      isForgejoReviewEnabledFn: () => true,
      forgejoAvailableFn: async () => true,
      getPrStatusFn: () => ({ exists: true, state: 'open', number: 41 }),
      maybeUpdateGraphifyBeforeReviewFn: () => {},
      enforceTaskAssigneeFn: () => true,
      resolveForgejoUserFn: () => 'gemini', readTokenFn: () => 'token',
      readReviewStateFn: () => null, writeReviewStateFn: () => {},
      rebaseBeforeReviewRoundFn: async () => ({ ok: true, sharedFileConflicts: false }),
      runPreReviewGateFn: async () => {
        gateCalls.push(gateCalls.length + 1);
        return { ok: true, area: 'lib', command: 'true', exitCode: 0, stdout: '', stderr: '' };
      },
      startAgentFn: async (step, options) => {
        events.push(`${step}:${options.role}`);
        return { agent: null };
      },
      pollForReviewFn: async () => reviewOutcomes.shift(),
      pollForDispositionFn: async () => dispositions.shift(),
      applyAgentFallbackFn: ({ original }) => original,
      buildCompactReviewPromptFn: () => 'review prompt',
      buildCompactActOnReviewPromptFn: () => 'act-on-review prompt',
      log: () => {}, error: () => {}, exit: () => {},
      consumeReviewerArtifactsFn: async () => ({ consumed: false }),
      consumeImplementerArtifactsFn: async () => ({ consumed: false }),
      // The implementer addressed the finding, so round 2 evaluates the revised
      // revision. A CHANGES_MADE with an unchanged HEAD now stops the loop per
      // TASK-2478/criterion 8, so a real revision (and the push it triggers) is
      // required for the gate-per-round path to reach round 2.
      hasNewCommittedChangeFn: () => true,
      pushReviewRefFn: () => ({ status: 0 }),
    });

    const reviewerLaunches = events.filter((event) => event === 'review:reviewer').length;
    assert.ok(reviewerLaunches >= 2, 'the simulated review loop must attempt multiple rounds');
    assert.equal(gateCalls.length, reviewerLaunches, 'each reviewer round must have exactly one pre-review gate');
  });

  test('startReviewLoop stops after a gate-failure bounce without launching a reviewer', async () => {
    const events = [];
    let gateCalls = 0;

    await startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'custom'],
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      transitionTaskFn: async () => {},
      transitionVirtualFn: async () => {},
      implementer: 'claude', reviewer: 'codex', dryRun: false,
      workflowLauncherStatusFn: () => ({ supported: true }),
      isForgejoReviewEnabledFn: () => true,
      forgejoAvailableFn: async () => true,
      getPrStatusFn: () => ({ exists: true, state: 'open', number: 41 }),
      maybeUpdateGraphifyBeforeReviewFn: () => {},
      enforceTaskAssigneeFn: () => true,
      resolveForgejoUserFn: () => 'gemini', readTokenFn: () => 'token',
      readReviewStateFn: () => null, writeReviewStateFn: () => {},
      rebaseBeforeReviewRoundFn: async () => ({ ok: true, sharedFileConflicts: false }),
      runPreReviewGateFn: async () => {
        gateCalls += 1;
        return { ok: false, area: 'lib', command: 'false', exitCode: 1, stdout: '', stderr: '' };
      },
      reboundPreReviewFailureFn: async () => ({ bounced: false, stranded: true, outcome: 'exhausted', diagnostic: 'still failing', implementer: 'claude' }),
      startAgentFn: async (step, options) => {
        events.push(`${step}:${options.role}`);
        return { agent: null };
      },
      applyAgentFallbackFn: ({ original }) => original,
      buildCompactReviewPromptFn: () => 'review prompt',
      buildCompactActOnReviewPromptFn: () => 'act-on-review prompt',
      log: () => {}, error: () => {}, exit: () => {},
      consumeReviewerArtifactsFn: async () => ({ consumed: false }),
      consumeImplementerArtifactsFn: async () => ({ consumed: false }),
    });

    assert.equal(gateCalls, 1);
    assert.equal(events.filter((event) => event === 'review:reviewer').length, 0);
  });

  test('startReviewLoop rebounces a pre-review safety-commit hook failure before gate or reviewer launch', async () => {
    const events = [];
    let hookBounce = null;
    let gateCalls = 0;

    await startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'custom'],
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      transitionTaskFn: async () => {},
      transitionVirtualFn: async () => {},
      implementer: 'claude', reviewer: 'codex', dryRun: false,
      workflowLauncherStatusFn: () => ({ supported: true }),
      isForgejoReviewEnabledFn: () => true,
      forgejoAvailableFn: async () => true,
      getPrStatusFn: () => ({ exists: true, state: 'open', number: 41 }),
      maybeUpdateGraphifyBeforeReviewFn: () => {},
      enforceTaskAssigneeFn: () => true,
      resolveForgejoUserFn: () => 'gemini', readTokenFn: () => 'token',
      readReviewStateFn: () => null, writeReviewStateFn: () => {},
      rebaseBeforeReviewRoundFn: async () => ({
        ok: false, sharedFileConflicts: false, hookFailure: true, hookOutput: 'pre-commit hook failed: lint error',
      }),
      runPreReviewGateFn: async () => { gateCalls++; return { ok: true, area: 'lib', command: 'true', exitCode: 0, stdout: '', stderr: '' }; },
      reboundPreReviewFailureFn: async (_slug, _worktree, reason) => {
        hookBounce = reason;
        return { bounced: false, stranded: true, outcome: 'exhausted', diagnostic: 'hook still failing', implementer: 'claude' };
      },
      startAgentFn: async (step, options) => {
        events.push(`${step}:${options.role}`);
        return { agent: null };
      },
      applyAgentFallbackFn: ({ original }) => original,
      buildCompactReviewPromptFn: () => 'review prompt',
      buildCompactActOnReviewPromptFn: () => 'act-on-review prompt',
      log: () => {}, error: () => {}, exit: () => {},
      consumeReviewerArtifactsFn: async () => ({ consumed: false }),
      consumeImplementerArtifactsFn: async () => ({ consumed: false }),
    });

    // TASK-2377.03: the hook path no longer synthesizes a `git-hook` gate result;
    // it passes the kernel a structured hook-failure reason (SC5).
    assert.equal(hookBounce.kind, 'hook-failure');
    assert.equal(hookBounce.hook, 'pre-commit');
    assert.match(hookBounce.operation, /pre-review safety commit/);
    assert.match(hookBounce.output, /pre-commit hook failed/);
    assert.equal(gateCalls, 0, 'the gate must wait until the rebounced safety commit succeeds');
    assert.equal(events.filter((event) => event === 'review:reviewer').length, 0);
  });
});

// Regression provenance: TASK-1385.
describe("pre review gate", { concurrency: false }, () => {
  /**
   * TASK-2377.03: the pre-review bounce path is the rebound kernel
   * (`src/application/rebound-kernel.ts`). The former `classifyGateFailure`
   * delegation tests were deleted with the function: gate classification is no
   * longer derived from the failure text at this call site, and the ADR 0048
   * table is covered by `test/task-2377.03-rebound-kernel.test.ts`.
   */
  const passingVerify = () => ({ ok: true });
  async function withTempDir(fn) {
    const dir = registeredMkdtemp('task-1385-');
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
      assert.deepEqual(transitions, [{ slug: 'task-1385', status: 'active' }, { slug: 'task-1385', status: 'review' }]);
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
});

// Regression provenance: TASK-2415.
describe("pre review gate repair continues", { concurrency: false }, () => {
  // TASK-2415 repro: a typed gate-only failure from `rebaseBeforeReviewRound`
  // bounces to the implementer, the rebound kernel verifies the repair, and the
  // loop logs `continuing this review round.` — but the `else` paired with
  // `if (rebaseResult.hookFailure)` then calls `exit(1)` and abandons the round
  // before the reviewer launches. A verified gate repair must continue the same
  // review round instead of exiting.
  test('task-2415 repro: repaired pre-review gate continues the review round instead of exiting', async () => {
    const slug = 'task-2415-gate-repair-repro';
    const worktree = '/tmp/task-2415-gate-repair-repro';
    const logs: string[] = [];
    const transitions: string[] = [];
    const prompts: string[] = [];
    let persisted: any = null;
    let gateRuns = 0;
    let rebaseRuns = 0;
    let reviewerLaunches = 0;

    await startReviewLoop(slug, {
      worktree,
      implementer: 'codex',
      reviewer: 'claude',
      maxAttempts: 1,
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task-2415.md', matches: [] }),
      getTaskStatusFn: () => 'review',
      eligibleAgentsForStepFn: () => ['codex', 'claude'],
      reboundPreReviewFailureFn: async (...args) => {
        assert.deepEqual(args[4].reviewerEligibility?.reviewers, ['codex', 'claude'],
          'repair resumption receives the full configured review pool');
        return reboundPreReviewFailure(...args);
      },
      workflowLauncherStatusFn: () => ({ supported: true, agent: 'codex', detail: null }),
      isForgejoReviewEnabledFn: () => true,
      forgejoAvailableFn: async () => true,
      getPrStatusFn: () => ({ exists: true, state: 'open', number: 2415, url: 'http://forgejo.invalid/pr/2415' }),
      resolveForgejoUserFn: () => 'reviewer',
      readTokenFn: () => 'test-token',
      maybeUpdateGraphifyBeforeReviewFn: () => {},
      readReviewStateFn: () => persisted,
      writeReviewStateFn: async (_slug, state) => {
        persisted = state;
        return { outcome: 'committed' as const };
      },
      transitionTaskFn: async (_slug, status) => { transitions.push(status); return true; },
      rebaseBeforeReviewRoundFn: async () => {
        rebaseRuns++;
        if (rebaseRuns === 1) {
          // Gate-only failure typed by the in-process pre-review rebase; the
          // `operation` value is injected evidence and cast because the port's
          // union names the git operation, not the hook, being exercised here.
          return {
            ok: false,
            sharedFileConflicts: false,
            hookFailure: false,
            failure: {
              kind: 'gate',
              operation: 'pre-push',
              gate: {
                area: 'static-analysis',
                command: './scripts/verify-local.sh static-analysis',
                exitCode: 1,
                stdout: 'gate diagnostic',
                stderr: '',
                error: 'gate failed',
              },
            },
          } as any;
        }
        return { ok: true, sharedFileConflicts: false, hookFailure: false };
      },
      runPreReviewGateFn: async () => {
        gateRuns++;
        return gateRuns === 1
          ? {
              ok: false, area: 'static-analysis', command: './scripts/verify-local.sh static-analysis', exitCode: 1,
              stdout: 'gate diagnostic', stderr: '', error: 'gate failed',
            }
          : { ok: true, area: 'static-analysis', command: './scripts/verify-local.sh static-analysis', exitCode: 0, stdout: '', stderr: '' };
      },
      startAgentFn: async (step, options: any) => {
        if (step === 'act-on-review') { prompts.push(options.prompt('codex')); }
        if (step === 'review') { reviewerLaunches++; }
        return { agent: options.agent, result: { status: 0 } } as any;
      },
      applyAgentFallbackFn: async ({ original }) => original,
      pollForReviewFn: async () => 'APPROVED',
      pollForDispositionFn: async () => 'CHANGES_MADE',
      consumeReviewerArtifactsFn: async () => ({ consumed: false }),
      consumeImplementerArtifactsFn: async () => ({ consumed: false }),
      buildCompactReviewPromptFn: () => 'review prompt',
      buildCompactActOnReviewPromptFn: () => 'implementer repair prompt',
      recordStageStatsSafeFn: () => {},
      gitFn: () => ({ stdout: 'main\n', stderr: '', status: 0 }) as any,
      log: line => logs.push(line),
      error: line => logs.push(line),
      exit: (() => { throw new Error('unexpected exit'); }) as any,
    });

    // Green contract: the verified gate-only repair never reaches exit(1) and
    // launches the reviewer exactly once in the same round.
    assert.equal(reviewerLaunches, 1, 'a verified gate-only repair launches the reviewer exactly once in the same round');
    const continuationIndex = logs.findIndex(line => line.includes('continuing this review round.'));
    assert.ok(continuationIndex >= 0, 'the loop logs the verified gate-repair continuation');
    const reviewerLaunchIndex = logs.findIndex(line => line.includes('launching reviewer'));
    assert.ok(reviewerLaunchIndex > continuationIndex,
      'the reviewer launches after the gate-repair continuation, in the same round');
    // SC3: both gate runs belong to the rebound kernel's verify (the first
    // repair still fails the gate, the second passes); the declared-gate block
    // is skipped for the repaired round, so no third gate run happens.
    assert.equal(gateRuns, 2, 'the declared pre-review gate is never re-run after the verified repair');
    assert.equal(rebaseRuns, 3, 'the kernel verify replays the pre-review rebase once per repair attempt');
    assert.equal(prompts.length, 2, 'the implementer receives one repair prompt per kernel attempt');
    assert.match(prompts[0], /Gate command: \.\/scripts\/verify-local\.sh static-analysis/);
    assert.match(prompts[0], /Classification: GateFailure — AutoSendBack/);
    assert.ok(transitions.includes('active'), 'the workflow returns to active for the repair');
    assert.ok(transitions.includes('review'), 'the workflow returns to review for the resumed round');
    assert.ok(logs.every(line => !line.includes('stranded mission')),
      'a verified repair never strands the mission');
  });
});

// Regression provenance: TASK-2439.
describe("rebounce review submit repro", { concurrency: false }, () => {
  test('task-2439 repro: review-submit declared-gate prose is a reboundable validation failure, never a Bash command', () => {
    const command = './scripts/verify-local.sh all (CP-4: exit 0, 0 test failures)';
    let shellRuns = 0;
    const useCase = new HandoffCommandUseCase({
      fileSystem: {
        existsSync: () => true,
      },
      verification: {
        readReusableVerificationProof: () => ({ ok: false }),
        writeReusableVerificationProof: () => ({ ok: true }),
      },
      process: {
        spawnSync: () => { shellRuns++; return { status: 2, stdout: '', stderr: 'syntax error' }; },
      },
    } as any);

    const result = useCase.executeGateCommands([command], '/worktree');

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'validation-failed');
    assert.match(result.error || '', /Gate declaration must contain an exact runnable command only/);
    assert.equal(shellRuns, 0, 'the review-submit handoff must rebound from structured validation, not raw Bash');
  });

  test('task-2439 validator keeps exact commands and rejects documented outcomes', () => {
    const useCase = new HandoffCommandUseCase({ fileSystem: { existsSync: () => true } } as any);

    assert.equal(useCase.validateDeclaredGates(['./scripts/verify-local.sh all'], '/worktree').ok, true);
    for (const declaration of [
      './scripts/verify-local.sh all (CP-4: exit 0, 0 test failures)',
      './scripts/verify-local.sh all (all tests pass)',
      './scripts/verify-local.sh all (exit 0)',
      './scripts/verify-local.sh all passes on the final tree',
    ]) {
      const result = useCase.validateDeclaredGates([declaration], '/worktree');
      assert.equal(result.reason, 'validation-failed');
      assert.match(result.error || '', /exact runnable command only/);
    }
  });

  test('task-2439 review-submit enables declared-gate recovery at the handoff seam', async () => {
    let handoffOptions: Record<string, unknown> | undefined;
    await submitForReview('task-2439', false, {
      resolveWorktreeFn: () => '/worktree',
      readReviewStateFn: () => null,
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/worktree/task.md', matches: [] }),
      getTaskImplementerFn: () => 'codex',
      isReviewProviderEnabledFn: () => false,
      performHandoffFn: async (_slug, options) => {
        handoffOptions = options;
        return { ok: false, recoveryAttempted: true };
      },
      exit: () => undefined as never,
    });
    assert.equal(handoffOptions?.recoverGateFailure, true);
  });

  test('task-2439 review-submit recovery uses ADR 0048 classification and the kernel retry budget', async () => {
    const prompts: string[] = [];
    const transitions: string[] = [];
    let verifies = 0;
    const outcome = await rebound({
      kind: 'declared-gate-validation',
      command: './scripts/verify-local.sh all (CP-4: exit 0, 0 test failures)',
      diagnostic: 'Gate declaration must contain an exact runnable command only',
    }, {
      slug: 'task-2439',
      worktree: '/worktree',
      implementer: 'codex',
      transitionToImplementer: async () => { transitions.push('active'); },
      startAgent: async (_step, options: any) => {
        prompts.push(options.prompt('codex'));
        return { agent: 'codex', result: { status: 0 } };
      },
      verify: () => ({ ok: ++verifies === 2, diagnostic: 'still malformed' }),
      log: () => {}, error: () => {},
    });

    assert.equal(outcome.outcome, 'fixed');
    assert.equal(outcome.classification.failureClass, 'MalformedGates');
    assert.equal(outcome.classification.dispatchAction, 'AutoRepair');
    assert.equal(prompts.length, 2);
    assert.deepEqual(transitions, ['active', 'active']);
    assert.match(prompts[0], /Gate command: \.\/scripts\/verify-local\.sh all/);
  });

  test('task-2439 real declared-gate process failure remains GateFailure', async () => {
    const { classifyReboundReason } = await import('../src/application/rebound-kernel.js');
    const classification = classifyReboundReason({
      kind: 'gate-failure', area: 'declared gate', command: './scripts/verify-local.sh all', exitCode: 1,
      stdout: '', stderr: 'test failed',
    });
    assert.deepEqual([classification.failureClass, classification.dispatchAction], ['GateFailure', 'AutoSendBack']);
  });

  test('task-2439 malformed-gate classification ignores English and Swedish Bash syntax diagnostics', async () => {
    const { classifyReboundReason } = await import('../src/application/rebound-kernel.js');
    const classifications = [
      'bash: -c: line 1: syntax error near unexpected token `(`',
      'bash: -c: rad 1: syntaxfel nära den oväntade symbolen ”(”',
    ].map(diagnostic => classifyReboundReason({
      kind: 'declared-gate-validation' as const,
      command: './scripts/verify-local.sh all (CP-4: exit 0, 0 test failures)',
      diagnostic,
    }));

    assert.deepEqual(classifications.map(result => [result.failureClass, result.dispatchAction]), [
      ['MalformedGates', 'AutoRepair'],
      ['MalformedGates', 'AutoRepair'],
    ]);
  });
});
