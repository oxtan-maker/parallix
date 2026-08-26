import test from 'node:test';
import assert from 'node:assert/strict';
import { startReviewLoop } from '../src/adapters/review/review-loop.js';

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
