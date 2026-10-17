import type { RepairCheckpointPort } from '../../../src/application/ports/repair-checkpoint.js';
import type { RetainedRepairPort, ReviewLoopRequest } from '../../../src/application/ports/review-round.js';
import type { ReviewLoopFakeOverrides } from '../../helpers/review-loop-ports.js';
import type { ReviewLoopState } from '../../../src/application/ports/review-round.js';
import type { MissionLifecycleService } from '../../../src/application/mission-lifecycle-service.js';
import { fixtureMission, pendingReview } from '../../fixtures/mission-builders.js';
import { missionVersion } from '../../../src/application/domain-ports.js';
import { makePorts, makeRecorder } from '../../helpers/handoff-ports.js';
// review gate repair contract.
// Related scenarios share imports; each contract keeps its own hooks and mutable fixtures.
import test, { describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { runPreReviewGate, gateFailureReason } from '../../../src/adapters/review/review-gate-handling.js';
import { preReviewRebaseFacts } from '../../../src/adapters/review/review-loop.js';
import { runReviewLoop } from '../../../src/application/review-loop/review-loop.js';
import { resumeRetainedRepair } from '../../../src/application/review-loop/retained-repair.js';
import { repairPreReviewFailure } from '../../../src/application/review-loop/pre-review.js';
import { fakeLoopContext, fakeReviewLoopPorts } from '../../helpers/review-loop-ports.js';
import fs from 'node:fs';
import path from 'node:path';
import { mkdtemp as registeredMkdtemp } from '../../helpers/temp-dir.js';
import { HandoffCommandUseCase } from '../../../src/application/handoff-command-use-case.js';
import { ReviewState } from '../../../src/adapters/review/review-state.js';
import { rebound } from '../../../src/application/rebound-kernel.js';
import { submitForReview } from '../../../src/adapters/review/review-commands.js';
import { listRecoveryEvidence } from '../../../src/application/recovery-evidence.js';

test('review repair fixtures isolate retained evidence across occurrences (TASK-2770)', async () => {
  const first = fakeReviewLoopPorts({ slug: 'task-1385' });
  await repairPreReviewFailure(fakeLoopContext(first, { slug: 'task-1385' }),
    gateFailureReason({ ok: false, area: 'docs', command: 'exit 1', exitCode: 1, stdout: 'first fixture', stderr: '' }), 2);
  assert.ok(listRecoveryEvidence({ cwd: first.ports.worktree, missionId: 'task-1385' }).length > 0);
  const second = fakeReviewLoopPorts({ slug: 'task-1385' });
  assert.notEqual(second.ports.worktree, first.ports.worktree);
  assert.deepEqual(listRecoveryEvidence({ cwd: second.ports.worktree, missionId: 'task-1385' }), []);
});

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
      handoff: { handoff: async () => ({ ok: true as const }) },
      provider: { pollReview: async () => reviewOutcomes.shift() ?? null, pollDisposition: async () => dispositions.shift() ?? null },
      preReview: {
        runGate: async () => { gateCalls.push(gateCalls.length + 1); return { ok: true as const }; },
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
      handoff: { handoff: async () => ({ ok: true as const }) },
      provider: {},
      preReview: {
        runGate: async () => {
          gateCalls += 1;
          return { ok: false as const, area: 'lib' as const, exitCode: 1, diagnostic: 'still failing', reason: gateFailureReason({ ok: false, area: 'lib', command: 'false', exitCode: 1, stdout: '', stderr: '' }) };
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
    const hook = preReviewRebaseFacts({ ok: false, sharedFileConflicts: false, hookFailure: true, hookOutput: 'pre-commit hook failed: lint error' });
    assert.equal(hook.ok, false);
    const hookBounce = !hook.ok ? hook.hook : null;
    // TASK-2377.03: the hook path does not synthesize a `git-hook` gate result;
    // the rebase facts carry a structured hook-failure reason (SC5).
    assert.ok(hookBounce != null);
    assert.equal(hookBounce.kind, 'hook-failure');
    assert.equal(hookBounce.hook, 'pre-commit');
    assert.match(hookBounce.operation ?? '', /pre-review safety commit/);
    assert.match(hookBounce.output, /pre-commit hook failed/);

    const fake = fakeReviewLoopPorts({
      slug: TEST_SLUG,
      routing: { eligibleFamilies: () => ['codex', 'claude', 'gemini', 'custom'] },
      handoff: { handoff: async () => ({ ok: true as const }) },
      provider: {},
      preReview: {
        rebase: async () => hook,
        runGate: async () => { gateCalls++; return { ok: true as const }; },
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
  const passingVerify = () => ({ ok: true as const });
  async function withTempDir(fn: (_arg0: string) => void | Promise<void>) {
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
    await withTempDir(async (root) => {
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
        runFn: () => ({ signal: null,  status: 0, stdout: 'ok\n', stderr: '' }),
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
    await withTempDir(async (root) => {
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
        runFn: () => ({ signal: null,  status: 1, stdout: '', stderr: '' }),
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
    await withTempDir(async (root) => {
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
        runFn: () => ({ signal: null,  status: 99, stdout: '', stderr: '' }),
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
    await withTempDir(async (root) => {
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
        runFn: () => ({ signal: null,  status: 2, stdout: 'out\n', stderr: 'err\n' }),
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
    await withTempDir(async (root) => {
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
        runFn: () => ({ signal: null,  status: 0, stdout: 'area-test\n', stderr: '' }),
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

  function repairFixture(verify: ReviewLoopFakeOverrides['preReview'] = {}, launch?: NonNullable<ReviewLoopFakeOverrides['agents']>['launch']) {
    const fake = fakeReviewLoopPorts({
      slug: 'task-1385',
      preReview: {
        ...(verify.rebase ? { rebase: verify.rebase } : {}),
        ...(verify.runGate ? { runGate: verify.runGate } : {}),
      },
      agents: launch ? { launch: launch } : {},
    });
    return { fake, context: fakeLoopContext(fake, { slug: 'task-1385' }) };
  }

  const gateFailure = (overrides: Record<string, unknown>) => gateFailureReason({ ok: false, area: 'docs', command: 'exit 1', exitCode: 1, stdout: 'output', stderr: '', ...overrides });

  test('pre-review repair bounces a gate failure whose verification re-run passes', async () => {
    let verifyRuns = 0;
    const { fake, context } = repairFixture({ runGate: async () => { verifyRuns++; return { ok: true as const }; } });

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
      runGate: async () => verifyDiagnostics.length
        ? { ok: false, area: 'docs', exitCode: 1, diagnostic: verifyDiagnostics.shift() ?? '', reason: gateFailure({ stdout: 'second run: 1 test still failing' }) }
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
    const { fake, context } = repairFixture({ runGate: async () => ({ ok: false as const, area: 'docs' as const, exitCode: 1, diagnostic: 'gate still failing', reason: gateFailure({ stdout: 'gate still failing' }) }) });

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
      rebase: async () => { order.push('rebase'); return { ok: true as const }; },
      runGate: async () => { order.push('gate'); return { ok: true as const }; },
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
  test('task-2415 repro: repaired pre-review gate continues the review round instead of exiting', async t => {
    const slug = 'task-2415-gate-repair-repro';
    const worktree = registeredMkdtemp('gate-repair-continues-');
    t.after(() => fs.rmSync(worktree, { recursive: true, force: true }));
    const logs: string[] = [];
    const transitions: string[] = [];
    const prompts: string[] = [];
    let persisted: { value: ReviewLoopState | null } = { value: null };
    let gateRuns = 0;
    let rebaseRuns = 0;
    let reviewerLaunches = 0;

    const lifecycleCommands: Parameters<MissionLifecycleService['transition']>[0][] = [];
    const missionStore = {
      load: async () => ({ kind: 'found' as const, version: missionVersion(1), mission: fixtureMission(slug, { status: lifecycleCommands.at(-1)?.command.type === 'rebound-to-active' ? 'active' : 'review', review: pendingReview(slug) }) }),
      save: async () => { throw new Error('Unexpected fixture save'); },
    };
    const lifecycle = { transition: async (request: Parameters<MissionLifecycleService['transition']>[0]) => { lifecycleCommands.push(request); return { durableEvidence: [],  status: 'completed' as const }; } };
    const gateFailure = { area: 'static-analysis', exitCode: 1, diagnostic: 'gate diagnostic', reason: gateFailureReason({ ok: false, area: 'static-analysis', command: './scripts/verify-local.sh static-analysis', exitCode: 1, stdout: 'gate diagnostic', stderr: '', error: 'gate failed' }) };
    const fake = fakeReviewLoopPorts({
      slug,
      worktree,
      routing: { eligibleFamilies: () => ['codex', 'claude'] },
      handoff: { handoff: async () => ({ ok: true as const }) },
      provider: { pollReview: async () => 'APPROVED', pollDisposition: async () => 'CHANGES_MADE' },
      missionStore: missionStore,
      lifecycle: lifecycle,
      stateport: {
        read: async () => persisted.value,
        persist: async state => { persisted.value = state; },
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
    assert.ok(resumed?.command.type === 'submit-for-review');
    assert.deepEqual(resumed.command.reviewerEligibility?.reviewers, ['codex', 'claude'],
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
    const base = makePorts(makeRecorder());
    const useCase = new HandoffCommandUseCase({
      ...base,
      fileSystem: { ...base.fileSystem,
        existsSync: () => true,
      },
      verification: {
        ...base.verification,
        readReusableVerificationProof: () => ({ ok: false as const }),
        writeReusableVerificationProof: () => ({ ok: true as const }),
      },
      process: {
        spawnSync: () => { shellRuns++; return { status: 2, stdout: '', stderr: 'syntax error' }; },
      },
    });

    const result = useCase.executeGateCommands([command], '/worktree');

    assert.equal(result.ok, false);
    assert.equal(result.reason, 'validation-failed');
    assert.match(result.error || '', /Gate declaration must contain an exact runnable command only/);
    assert.equal(shellRuns, 0, 'the review-submit handoff must rebound from structured validation, not raw Bash');
  });

  test('task-2439 validator keeps exact commands and rejects documented outcomes', () => {
    const useCase = new HandoffCommandUseCase(makePorts(makeRecorder()));

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
    let handoffOptions: Parameters<NonNullable<NonNullable<Parameters<typeof submitForReview>[2]>['performHandoffFn']>>[1];
    await submitForReview('task-2439', false, {
      resolveWorktreeFn: () => '/worktree',
      readReviewStateFn: () => null,
      resolveTaskFileFn: () => ({ ok: true as const, taskFile: '/worktree/task.md', matches: [] }),
      getTaskImplementerFn: () => 'codex',
      isReviewProviderEnabledFn: () => false,
      performHandoffFn: async (_slug, options) => {
        handoffOptions = options;
        return { ok: false as const, recoveryAttempted: true };
      },
      exit: () => undefined,
    });
    assert.equal(handoffOptions?.recoverGateFailure, true);
  });

  test('malformed locked gates escalate without launches or verification (TASK-2695)', async () => {
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
      startAgent: async (_step, options) => {
        prompts.push(typeof options.prompt === 'function' ? options.prompt('codex') : options.prompt ?? '');
        return { agent: 'codex', result: { status: 0 } };
      },
      verify: () => ({ ok: ++verifies === 2, diagnostic: 'still malformed' }),
      log: () => {}, error: () => {},
    });

    assert.equal(outcome.outcome, 'human-only');
    assert.equal(outcome.classification.failureClass, 'MalformedGates');
    assert.equal(outcome.classification.dispatchAction, 'HumanOnly');
    assert.equal(prompts.length, 0);
    assert.deepEqual(transitions, []);
    assert.equal(verifies, 0);
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
      ['MalformedGates', 'HumanOnly'],
      ['MalformedGates', 'HumanOnly'],
    ]);
  });
});


describe('retained verification repair continuation', { concurrency: false }, () => {
  const directories: string[] = [];
  afterEach(() => {
    for (const dir of directories.splice(0)) { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  function fixture({ passing = false, status = 0, recorded = false }: { passing?: boolean; status?: number | null; recorded?: boolean } = {}) {
    const worktree = registeredMkdtemp('retained-repair-');
    directories.push(worktree);
    const command = 'npm run original-check';
    const repair = { command, incidentId: 'incident', attempt: 1, evidenceRecorded: recorded, verified: false,
      authorizedGates: [command], authorizedCriteria: ['original criterion'] };
    const mission = { ...fixtureMission('task-2757'), declaredGates: [command], successCriteria: ['original criterion'],
      checkpoints: [{ ...fixtureMission('task-2757').checkpoints[0], name: 'CP-2', repair }] };
    const fake = fakeReviewLoopPorts({
      worktree, slug: 'task-2757',
      missionStore: { load: async () => ({ kind: 'found' as const, mission, version: missionVersion(1) }),
        save: async () => assert.fail('retained recovery writes through checkpoint ports') },
      agents: { launch: async launch => ({ agent: launch.agent, result: { status } }) },
    });
    const checks: [string, string][] = [];
    const verified: Parameters<RepairCheckpointPort['verify']>[] = [];
    const opens: Parameters<RepairCheckpointPort['open']>[0][] = [];
    const retainedRepair: RetainedRepairPort = {
      read: async () => ({ evidence: { version: 1, attempt: 1, capturedRevision: 'head-1', signal: null,
        stdoutBytes: Buffer.byteLength('original stdout'), stderrBytes: Buffer.byteLength('original stderr'),
        truncatedFrom: null, redacted: false, incidentId: 'retained-incident', capturedAt: new Date().toISOString(), command,
        cwd: fake.ports.worktree, exitCode: 1, captureComplete: true, stdoutPath: '/retained/stdout', stderrPath: '/retained/stderr' },
        stdout: 'original stdout', stderr: 'original stderr' }),
      verify: async (actual, cwd) => { checks.push([actual, cwd]); return { ok: passing, command: actual, diagnostic: 'original check still fails' }; },
      checkpoints: { open: async request => { opens.push(request); return { name: 'CP-2', version: 8 }; },
        readBlocker: async () => undefined, verify: async (...args) => { verified.push(args); } },
    };
    const ports = { ...fake.ports, retainedRepair };
    const run = (options: Partial<ReviewLoopRequest> = {}) => runReviewLoop({ slug: 'task-2757', isContinue: true, implementer: 'codex', ...options }, ports);
    return { fake: { ...fake, ports }, mission, repair, run, checks, verified, opens, command };
  }

  test('successful exact-check repair resumes handoff and reviewer decision without another resume (TASK-2766)', async () => {
    const f = fixture({ passing: true });
    f.mission.review = pendingReview('task-2757');
    let handoffs = 0;
    f.fake.ports.handoff = { handoff: async () => {
      handoffs++;
      assert.equal(f.repair.verified, true);
      await f.fake.ports.state.persist(new ReviewState('task-2757', { implementer: 'codex', reviewer: 'claude', round: 2 }));
      return { ok: true };
    } };
    f.fake.ports.retainedRepair.checkpoints.verify = async (...args) => {
      f.verified.push(args);
      f.repair.verified = true;
    };
    f.fake.ports.artifacts.consumeReviewer = async () => ({ consumed: true, ok: true, reviewState: 'APPROVED' });
    await f.run();
    assert.deepEqual(f.checks, [[f.command, f.fake.ports.worktree]]);
    assert.equal(handoffs, 1, 'verified active/pending repair must automatically reach handoff');
    assert.deepEqual(f.fake.launches.map(launch => launch.role), ['implementer', 'reviewer']);
    assert.equal(f.fake.launches[1].prompt?.attempt, 2, 'handoff round state is authoritative');
    assert.equal(f.fake.current()?.phase, 'approved');
    assert.deepEqual(f.fake.exits, []);
  });

  test('retained repair dry run shows diagnostics without certifying recovery (TASK-2766)', async () => {
    const f = fixture({ passing: true });
    const resumed = await resumeRetainedRepair({ slug: 'task-2757', isContinue: true, dryRun: true },
      f.mission, 'codex', f.fake.ports);
    assert.equal(resumed, false, 'dry run cannot advance review');
    assert.deepEqual(f.fake.launches, []);
    assert.deepEqual(f.checks, []);
    assert.deepEqual(f.verified, []);
    assert.deepEqual(f.opens, []);
    assert.equal(f.repair.verified, false);
    assert.deepEqual(f.fake.exits, []);
    for (const diagnostic of [f.command, f.fake.ports.worktree, '/retained/stdout', '/retained/stderr']) {
      assert.ok(f.fake.logs.some(line => line.includes(diagnostic)), diagnostic);
    }
  });

  test('no-op continuation reruns the retained failed check and stays failed (TASK-2757)', async () => {
    const f = fixture();
    await f.run();
    assert.deepEqual(f.checks, Array(2).fill([f.command, f.fake.ports.worktree]));
    assert.deepEqual(f.fake.exits, [1]);
    assert.deepEqual(f.verified, []);
    assert.equal(f.fake.launches.length, 2);
    assert.ok(f.fake.launches.every(launch => !launch.prompt && launch.recovery?.sessionPolicy === 'fresh-ephemeral'));
    const prompt = String(f.fake.launches[0].recovery?.prompt('codex'));
    for (const text of [f.command, f.fake.ports.worktree, '/retained/stdout', '/retained/stderr', 'original stdout', 'original stderr', 'REPAIR AUTHORITY', 'CP-2', 'Version at launch: 8']) {
      assert.ok(prompt.includes(text), text);
    }
    assert.ok(f.opens.every(request => request.incidentId === f.repair.incidentId));
    assert.ok(f.fake.errors.some(line => line.includes('repair budget (2)')));
  });

  for (const command of ['px handoff', 'hook-failure', 'artifact-incomplete', 'agent-timeout']) {
    for (const verifiedGate of [false, true]) {
      test(`non-gate ${command} resumes without retained evidence, verified gate=${verifiedGate} (TASK-2757 F1)`, async () => {
        const f = fixture();
        const orphan = { ...f.mission.checkpoints[0], name: 'CP-1', repair: { ...f.repair, command, incidentId: 'non-gate' } };
        f.repair.verified = true;
        f.mission.checkpoints = verifiedGate ? [orphan, ...f.mission.checkpoints] : [orphan];
        let reads = 0;
        f.fake.ports.retainedRepair.read = async () => { reads++; throw new Error('never captured'); };
        f.mission.review = pendingReview('task-2757');
        let handoffs = 0;
        f.fake.ports.handoff = { handoff: async () => { handoffs++; return { gatekeeperPushedBack: true }; } };
        await f.run();
        assert.equal(reads, 0);
        assert.equal(handoffs, 1, 'ordinary handoff resume remains reachable');
        assert.deepEqual(f.fake.exits, [1], 'handoff still owns its validation decision');
        assert.equal(f.fake.launches.length, 0);
        assert.equal(orphan.repair.verified, false, 'routing never fabricates repair proof');
      });
    }
  }

  test('orphan non-gate checkpoint cannot shadow an unfinished gate repair (TASK-2757 F1)', async () => {
    const f = fixture();
    f.mission.checkpoints.unshift({ ...f.mission.checkpoints[0], name: 'CP-1', repair: { ...f.repair, command: 'px handoff', incidentId: 'orphan' } });
    const read = f.fake.ports.retainedRepair.read;
    const commands: string[] = [];
    f.fake.ports.retainedRepair.read = async command => { commands.push(command); return read(command); };
    await f.run();
    assert.deepEqual(commands, [f.command]);
    assert.deepEqual(f.checks, Array(2).fill([f.command, f.fake.ports.worktree]));
    assert.deepEqual(f.fake.exits, [1]);
  });

  test('exhausted round budget launches no repair (TASK-2757)', async () => {
    const f = fixture();
    await f.run({ reboundsPerRound: 0 });
    assert.deepEqual(f.fake.launches, []);
    assert.deepEqual(f.checks, []);
    assert.deepEqual(f.fake.exits, [1]);
    assert.ok(f.fake.errors.some(line => line.includes('repair budget (0)')));
  });

  test('recorded but unverified repair completes only after the exact check passes (TASK-2757)', async () => {
    const f = fixture({ passing: true, recorded: true });
    f.fake.ports.artifacts.consumeReviewer = async () => ({ consumed: true, ok: true, reviewState: 'APPROVED' });
    await f.run();
    assert.deepEqual(f.checks, [[f.command, f.fake.ports.worktree]]);
    assert.deepEqual(f.verified, [['task-2757', 'CP-2']]);
    assert.deepEqual(f.fake.exits, []);
    assert.deepEqual(f.fake.launches.map(launch => launch.role), ['implementer', 'reviewer']);
  });

  test('unrelated passing check cannot certify retained recovery (TASK-2757)', async () => {
    const f = fixture();
    f.fake.ports.retainedRepair.verify = async () => ({ ok: true, command: 'unrelated' });
    await f.run();
    assert.deepEqual(f.verified, []);
    assert.deepEqual(f.fake.exits, [1]);
    assert.ok(f.fake.errors.some(line => line.includes('Unrelated check')));
  });

  for (const status of [null, 130]) {
    test(`interrupted repair status ${status} remains failed and bounded (TASK-2757)`, async () => {
      const f = fixture({ status });
      await f.run();
      assert.deepEqual(f.fake.exits, [1]);
      assert.deepEqual(f.verified, []);
      assert.deepEqual(f.checks, []);
      assert.equal(f.fake.launches.length, 2);
    });
  }

  for (const error of ['missing', 'access-denied']) {
    test(`unavailable retained evidence ${error} fails without ordinary launch (TASK-2757)`, async () => {
      const f = fixture();
      f.fake.ports.retainedRepair.read = async () => { throw new Error(error); };
      await f.run();
      assert.deepEqual(f.fake.exits, [1]);
      assert.equal(f.fake.launches.length, 0);
      assert.ok(f.fake.errors.some(line => line.includes(error)));
    });
  }

  test('changed locked authority stops retained repair before launch (TASK-2757)', async () => {
    const f = fixture();
    f.mission.declaredGates = ['weakened'];
    await f.run();
    assert.equal(f.fake.launches.length, 0);
    assert.deepEqual(f.fake.exits, [1]);
    assert.ok(f.fake.errors.some(line => line.includes('operator decision')));
  });

  test('changed authority during repair stops before verification (TASK-2757)', async () => {
    const f = fixture({ passing: true });
    f.fake.ports.agents.launch = async () => { f.mission.successCriteria = ['changed']; return { result: { status: 0 } }; };
    await f.run();
    assert.deepEqual(f.checks, []);
    assert.deepEqual(f.verified, []);
    assert.deepEqual(f.fake.exits, [1]);
  });

  test('checkpoint evidence rejection prevents successful recovery (TASK-2757)', async () => {
    const f = fixture({ passing: true });
    f.fake.ports.retainedRepair.checkpoints.verify = async () => { throw new Error('fresh evidence required'); };
    await f.run();
    assert.deepEqual(f.fake.exits, [1]);
    assert.ok(f.fake.errors.some(line => line.includes('fresh evidence required')));
  });
});
