import test from 'node:test';
import assert from 'node:assert/strict';
import { HandoffCommandUseCase } from '../src/application/handoff-command-use-case.js';
import { rebound } from '../src/application/rebound-kernel.js';
import { submitForReview } from '../src/adapters/review/review-commands.js';

test('task-2439 repro: review-submit declared-gate prose is a reboundable validation failure, never a Bash command', () => {
  const missionDir = '/worktree/missions/task-2439';
  const command = './scripts/verify-local.sh all (CP-4: exit 0, 0 test failures)';
  let shellRuns = 0;
  const useCase = new HandoffCommandUseCase({
    fileSystem: {
      existsSync: () => true,
      readText: () => `# Mission\n\n## Gates\n\n- [ ] ${command}\n\n## Stop Rules\n`,
    },
    verification: {
      readReusableVerificationProof: () => ({ ok: false }),
      writeReusableVerificationProof: () => ({ ok: true }),
    },
    process: {
      spawnSync: () => { shellRuns++; return { status: 2, stdout: '', stderr: 'syntax error' }; },
    },
  } as any);

  const result = useCase.runDeclaredGates(missionDir, '/worktree');

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
