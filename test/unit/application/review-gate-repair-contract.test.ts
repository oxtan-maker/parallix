// @ts-nocheck -- Retained legacy partial request doubles (TASK-2328).
// review gate repair contract.
// Related scenarios share imports; each contract keeps its own hooks and mutable fixtures.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { runPreReviewGate, gateFailureReason } from '../../../src/adapters/review/review-gate-handling.js';
import { preReviewRebaseFacts } from '../../../src/adapters/review/review-loop.js';
import { runReviewLoop } from '../../../src/application/review-loop/review-loop.js';
import { repairPreReviewFailure } from '../../../src/application/review-loop/pre-review.js';
import { fakeLoopContext, fakeReviewLoopPorts } from '../../helpers/review-loop-ports.js';
import fs from 'node:fs';
import path from 'node:path';
import { mkdtemp as registeredMkdtemp } from '../../helpers/temp-dir.js';
import { HandoffCommandUseCase } from '../../../src/application/handoff-command-use-case.js';
import { rebound } from '../../../src/application/rebound-kernel.js';
import { submitForReview } from '../../../src/adapters/review/review-commands.js';

// Regression provenance: TASK-1268.
describe("pre review gate per round", { concurrency: false }, () => {
  const TEST_SLUG = `task-1268-gate-per-round-${process.pid}`;

  test('review loop runs the pre-review gate before every reviewer round', async () => {
    const gateCalls = [];
    const reviewOutcomes = ['REQUEST_CHANGES', 'APPROVED'];
    const dispositions = ['CHANGES_MADE'];
    let head = 0;
    const fake = fakeReviewLoopPorts({
      slug: TEST_SLUG,
      routing: { eligibleFamilies: () => ['codex', 'claude', 'gemini', 'custom'] },
      handoff: { handoff: async () => ({ ok: true }) },
      provider: { pollReview: async () => reviewOutcomes.shift(), pollDisposition: async () => dispositions.shift() },
      preReview: {
        runGate: async () => { gateCalls.push(gateCalls.length + 1); return { ok: true }; },
        // The implementer addressed the finding, so round 2 evaluates a revised
        // revision (TASK-2478/criterion 8 stops on an unchanged HEAD).
        head: () => `head-${++head}`,
      },
      agents: { launch: async () => ({ agent: null }) },
    });
    await runReviewLoop({ slug: TEST_SLUG, implementer: 'claude', reviewer: 'codex' }, fake.ports);

    const reviewerLaunches = fake.launches.filter(launch => launch.role === 'reviewer').length;
    assert.ok(reviewerLaunches >= 2, 'the simulated review loop must attempt multiple rounds');
    assert.equal(gateCalls.length, reviewerLaunches, 'each reviewer round must have exactly one pre-review gate');
  });

  test('review loop stops after a gate-failure bounce without launching a reviewer', async () => {
    let gateCalls = 0;
    const fake = fakeReviewLoopPorts({
      slug: TEST_SLUG,
      routing: { eligibleFamilies: () => ['codex', 'claude', 'gemini', 'custom'] },
      handoff: { handoff: async () => ({ ok: true }) },
      provider: {},
      preReview: {
        runGate: async () => {
          gateCalls += 1;
          return { ok: false, area: 'lib', exitCode: 1, diagnostic: 'still failing', reason: gateFailureReason({ ok: false, area: 'lib', command: 'false', exitCode: 1, stdout: '', stderr: '' }) };
        },
      },
    });
    await runReviewLoop({ slug: TEST_SLUG, implementer: 'claude', reviewer: 'codex' }, fake.ports);

    // The first gate run fails; every later run is the repair's verification.
    assert.ok(gateCalls >= 1);
    assert.equal(fake.launches.filter(launch => launch.role === 'reviewer').length, 0);
    assert.deepEqual(fake.exits, [1], 'a stranded gate repair ends the loop non-zero');
    assert.ok(fake.errors.some(line => line.includes('Pre-review gate failure stranded mission')), fake.errors.join(' | '));
  });

  test('review loop rebounces a pre-review safety-commit hook failure before gate or reviewer launch', async () => {
    let gateCalls = 0;
    const hook = preReviewRebaseFacts({ ok: false, sharedFileConflicts: false, hookFailure: true, hookOutput: 'pre-commit hook failed: lint error' } as never);
    assert.equal(hook.ok, false);
    const hookBounce = !hook.ok ? hook.hook : null;
    // TASK-2377.03: the hook path does not synthesize a `git-hook` gate result;
    // the rebase facts carry a structured hook-failure reason (SC5).
    assert.equal(hookBounce.kind, 'hook-failure');
    assert.equal(hookBounce.hook, 'pre-commit');
    assert.match(hookBounce.operation, /pre-review safety commit/);
    assert.match(hookBounce.output, /pre-commit hook failed/);

    const fake = fakeReviewLoopPorts({
      slug: TEST_SLUG,
      routing: { eligibleFamilies: () => ['codex', 'claude', 'gemini', 'custom'] },
      handoff: { handoff: async () => ({ ok: true }) },
      provider: {},
      preReview: {
        rebase: async () => hook,
        runGate: async () => { gateCalls++; return { ok: true }; },
      },
      agents: { launch: async launch => ({ agent: launch.agent, result: { status: 0 } }) },
    });
    await runReviewLoop({ slug: TEST_SLUG, implementer: 'claude', reviewer: 'codex' }, fake.ports);

    const repairs = fake.launches.filter(launch => launch.role === 'implementer' && !launch.prompt);
    assert.equal(repairs.length, 2, 'the hook failure is bounced to the implementer through the kernel budget');
    assert.match(String(repairs[0].recovery?.prompt('claude')), /pre-commit hook failed: lint error/);
    assert.equal(gateCalls, 0, 'the gate must wait until the rebounced safety commit succeeds');
    assert.equal(fake.launches.filter(launch => launch.role === 'reviewer').length, 0);
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
  // Pre-review repair (TASK-2377.03 kernel wiring): the application bounces a
  // pre-review failure through one rebound-kernel occurrence.
  // ============================================================================

  function repairFixture(verify: { rebase?: () => unknown; runGate?: () => unknown } = {}, launch?: (_launch: any) => unknown) {
    const fake = fakeReviewLoopPorts({
      slug: 'task-1385',
      preReview: {
        ...(verify.rebase ? { rebase: verify.rebase } : {}),
        ...(verify.runGate ? { runGate: verify.runGate } : {}),
      } as never,
      agents: launch ? { launch: launch as never } : {},
    });
    return { fake, context: fakeLoopContext(fake, { slug: 'task-1385' }) };
  }

  const gateFailure = (overrides: Record<string, unknown>) => gateFailureReason({ ok: false, area: 'docs', command: 'exit 1', exitCode: 1, stdout: 'output', stderr: '', ...overrides } as never);

  test('pre-review repair bounces a gate failure whose verification re-run passes', async () => {
    let verifyRuns = 0;
    const { fake, context } = repairFixture({ runGate: () => { verifyRuns++; return { ok: true }; } });

    const result = await repairPreReviewFailure(context, gateFailure({ stdout: 'stdout output', stderr: 'verification gate failed with exit code 1' }), 2);

    assert.equal(result.bounced, true);
    assert.equal(result.outcome, 'fixed');
    assert.equal(fake.launches.length, 1);
    assert.equal(typeof fake.launches[0].recovery?.prompt, 'function');
    assert.equal(verifyRuns, 1, 'the failing check must re-run before the bounce is reported fixed');
    // TASK-2377.03 SC3: the budget is in-memory per occurrence, so the bounce
    // path writes no retry counter to review state.
    assert.deepEqual(fake.writes, []);
  });

  test('pre-review repair rebounces a gate failure with arbitrary test output', async () => {
    const { fake, context } = repairFixture();

    const result = await repairPreReviewFailure(context, gateFailure({
      area: 'static-analysis', command: './scripts/verify-local.sh static-analysis',
      stdout: 'test/example.test.js:42: assertion failed', error: 'verification gate failed with exit code 1',
    }), 2);

    assert.equal(result.bounced, true);
    assert.deepEqual(fake.mirrors, ['active', 'review'], 'the task returns to active for the repair and to review once verified');
    assert.equal(fake.launches.length, 1);
    assert.match(String(fake.launches[0].recovery?.prompt('codex')), /assertion failed/);
  });

  test('pre-review repair relaunches with the fresh diagnostic when the verification re-run still fails', async () => {
    const verifyDiagnostics = ['second run: 1 test still failing'];
    const { fake, context } = repairFixture({
      runGate: () => verifyDiagnostics.length
        ? { ok: false, area: 'docs', exitCode: 1, diagnostic: verifyDiagnostics.shift(), reason: undefined }
        : { ok: true },
    });

    const result = await repairPreReviewFailure(context, gateFailure({ stdout: 'first run diagnostic' }), 2);

    assert.equal(result.bounced, true);
    const prompts = fake.launches.map(launch => String(launch.recovery?.prompt('codex')));
    assert.equal(prompts.length, 2);
    assert.match(prompts[0], /first run diagnostic/);
    assert.match(prompts[1], /second run: 1 test still failing/);
  });

  test('pre-review repair strands the mission when the per-occurrence budget is spent', async () => {
    const { fake, context } = repairFixture({ runGate: () => ({ ok: false, area: 'docs', exitCode: 1, diagnostic: 'gate still failing', reason: undefined }) });

    const result = await repairPreReviewFailure(context, gateFailure({}), 2);

    assert.equal(result.bounced, false);
    assert.equal(result.outcome, 'exhausted');
    assert.equal(result.diagnostic, 'gate still failing');
    assert.equal(fake.launches.length, 2, 'the default budget is two attempts per occurrence');
    assert.ok(fake.errors.some(e =>
      e.includes('Recovery dossier for task-1385') &&
      e.includes('implementer repair budget (2)') &&
      e.includes('gate still failing')
    ));
    assert.ok(!fake.mirrors.includes('review'), 'a stranded repair never returns the task to review');
  });

  test('pre-review repair does not bounce for InfraBlocker (HumanOnly)', async () => {
    const { fake, context } = repairFixture();

    const result = await repairPreReviewFailure(context, gateFailure({ command: 'node parallix verify docs', stdout: '', stderr: 'connection refused to forgejo server' }), 2);

    assert.equal(result.bounced, false);
    assert.equal(result.outcome, 'human-only');
    assert.equal(fake.launches.length, 0, 'should not launch agent for HumanOnly errors');
    assert.ok(fake.errors.some(e => e.includes('InfraBlocker')));
    assert.ok(fake.errors.some(e => e.includes('Human intervention required')));
  });

  test('pre-review repair does not bounce for StateMachineViolation (HumanOnly)', async () => {
    const { fake, context } = repairFixture();

    const result = await repairPreReviewFailure(context, gateFailure({ command: 'node parallix verify docs', stdout: '', stderr: 'transition not allowed for this task' }), 2);

    assert.equal(result.bounced, false);
    assert.equal(fake.launches.length, 0);
    assert.ok(fake.errors.some(e => e.includes('StateMachineViolation')));
  });

  test('pre-review repair includes gate output and the ADR 0048 gate classification in the fix prompt', async () => {
    const { fake, context } = repairFixture();

    await repairPreReviewFailure(context, gateFailure({
      area: 'workflow', command: 'npm run verify:workflow', exitCode: 3,
      stdout: 'test failed: assertion error', stderr: 'verification gate failed with exit code 3',
    }), 2);

    const capturedPrompt = String(fake.launches[0].recovery?.prompt('codex'));
    assert.ok(capturedPrompt.includes('PRE-REVIEW GATE FAILURE'));
    assert.ok(capturedPrompt.includes('task-1385'));
    assert.ok(capturedPrompt.includes('workflow'));
    assert.ok(capturedPrompt.includes('test failed: assertion error'));
    assert.ok(capturedPrompt.includes('verification gate failed'));
    assert.ok(capturedPrompt.includes('Retry attempt: 1/2'));
    // TASK-2377.03 SC5: a declared gate that ran and exited non-zero is a
    // GateFailure, never a GitBlockers/AutoRepair relabel.
    assert.ok(capturedPrompt.includes('Classification: GateFailure — AutoSendBack'));
    assert.ok(capturedPrompt.includes('The failing check re-runs automatically after your fix'));
  });

  test('pre-review repair verifies by re-running the rebase before the gate', async () => {
    const order: string[] = [];
    const { context } = repairFixture({
      rebase: () => { order.push('rebase'); return { ok: true }; },
      runGate: () => { order.push('gate'); return { ok: true }; },
    });

    const result = await repairPreReviewFailure(context, gateFailure({}), 2);

    assert.equal(result.bounced, true);
    assert.deepEqual(order, ['rebase', 'gate'], 'a repair is fixed only when the rebase and the gate both re-run and pass');
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

    const lifecycleCommands: any[] = [];
    const missionStore = {
      load: async () => ({ kind: 'found', version: 1, mission: { id: slug, status: lifecycleCommands.at(-1)?.command.type === 'rebound-to-active' ? 'active' : 'review', review: { rounds: [{ number: 1, reviewer: 'claude', implementer: 'codex' }] } } }),
    };
    const lifecycle = { transition: async (request: any) => { lifecycleCommands.push(request); return { status: 'completed' }; } };
    const gateFailure = { area: 'static-analysis', exitCode: 1, diagnostic: 'gate diagnostic', reason: gateFailureReason({ ok: false, area: 'static-analysis', command: './scripts/verify-local.sh static-analysis', exitCode: 1, stdout: 'gate diagnostic', stderr: '', error: 'gate failed' }) };
    const fake = fakeReviewLoopPorts({
      slug,
      worktree,
      routing: { eligibleFamilies: () => ['codex', 'claude'] },
      handoff: { handoff: async () => ({ ok: true }) },
      provider: { pollReview: async () => 'APPROVED', pollDisposition: async () => 'CHANGES_MADE' },
      missionStore: missionStore as never,
      lifecycle: lifecycle as never,
      stateport: {
        read: async () => persisted,
        persist: async state => { persisted = state; },
      },
      task: { mirror: async lane => { transitions.push(lane); } },
      preReview: {
        rebase: async () => {
          rebaseRuns++;
          // A gate-only failure typed by the in-process pre-review rebase.
          return rebaseRuns === 1
            ? { ok: false, gate: { area: 'static-analysis', exitCode: 1, command: './scripts/verify-local.sh static-analysis', operation: 'pre-push', reason: gateFailure.reason }, diagnostic: '' }
            : { ok: true };
        },
        runGate: async () => (++gateRuns === 1 ? { ok: false, ...gateFailure } : { ok: true }),
      },
      agents: {
        launch: async launch => {
          if (launch.role === 'implementer') { prompts.push(String(launch.recovery?.prompt('codex'))); }
          if (launch.role === 'reviewer') { reviewerLaunches++; }
          return { agent: launch.agent, result: { status: 0 } };
        },
      },
      output: { log: line => logs.push(line), error: line => logs.push(line), exit: () => { throw new Error('unexpected exit'); } },
    });
    await runReviewLoop({ slug, implementer: 'codex', reviewer: 'claude', maxAttempts: 1 }, fake.ports);

    const resumed = lifecycleCommands.find(request => request.command.type === 'submit-for-review');
    assert.deepEqual(resumed?.command.reviewerEligibility?.reviewers, ['codex', 'claude'],
      'repair resumption receives the full configured review pool');
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
    const { classifyReboundReason } = await import('../../../src/application/rebound-kernel.js');
    const classification = classifyReboundReason({
      kind: 'gate-failure', area: 'declared gate', command: './scripts/verify-local.sh all', exitCode: 1,
      stdout: '', stderr: 'test failed',
    });
    assert.deepEqual([classification.failureClass, classification.dispatchAction], ['GateFailure', 'AutoSendBack']);
  });

  test('task-2439 malformed-gate classification ignores English and Swedish Bash syntax diagnostics', async () => {
    const { classifyReboundReason } = await import('../../../src/application/rebound-kernel.js');
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
