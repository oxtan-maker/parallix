import test from 'node:test';
import assert from 'node:assert/strict';
import { startReviewLoop } from '../src/adapters/review/review-loop.js';

test('task-2353 repro: declared pre-review gate rebounces, replays, and resumes the review loop', async () => {
  const slug = 'task-2353-rebounce-repro';
  const worktree = '/tmp/task-2353-rebounce-repro';
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
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task-2353.md', matches: [] }),
    getTaskStatusFn: () => 'review',
    eligibleAgentsForStepFn: () => ['codex', 'claude'],
    workflowLauncherStatusFn: () => ({ supported: true, agent: 'codex', detail: null }),
    isForgejoReviewEnabledFn: () => true,
    forgejoAvailableFn: async () => true,
    getPrStatusFn: () => ({ exists: true, state: 'open', number: 2353, url: 'http://forgejo.invalid/pr/2353' }),
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
      return { ok: true, sharedFileConflicts: false, hookFailure: false };
    },
    runPreReviewGateFn: async () => {
      gateRuns++;
      return gateRuns === 1
        ? {
            ok: false, area: 'static-analysis', command: './scripts/verify-local.sh static-analysis', exitCode: 1,
            stdout: 'failing static analysis diagnostic', stderr: '', error: 'verification gate failed with exit code 1',
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

  assert.equal(prompts.length, 1, 'the same implementer receives one repair prompt');
  assert.match(prompts[0], /Gate command: \.\/scripts\/verify-local\.sh static-analysis/);
  // TASK-2377.03: a declared gate that ran and exited non-zero dispatches as a
  // GateFailure. The former GitBlockers relabel was the per-site remap the
  // rebound kernel deleted (SC5).
  assert.match(prompts[0], /Classification: GateFailure — AutoSendBack/);
  assert.match(prompts[0], /Retry attempt: 1\/2/);
  assert.match(prompts[0], /The failing check re-runs automatically after your fix/);
  // TASK-2377.03: the budget is per occurrence and in-memory (SC3), so no
  // retry counter is written to review-state metadata by the bounce path.
  assert.equal(persisted?.metadata?.gateFailureRetryCount, undefined,
    'the kernel keeps its budget in memory and writes no retry counter');
  assert.equal(rebaseRuns, 2, 'repair resumes by replaying the pre-review rebase');
  assert.equal(gateRuns, 2, 'repair resumes by replaying the declared gate');
  assert.equal(reviewerLaunches, 1, 'successful repair advances to the review round');
  assert.ok(transitions.includes('active') && transitions.filter(status => status === 'review').length >= 2,
    'the workflow returns to active for repair then to review for the resumed round');
  assert.ok(!logs.some(line => line.includes('Autonomous review stopped: gate failure auto-bounced')),
    'a successful repair must not stop autonomous review for human handoff');
});
