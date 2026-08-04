const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  buildCompactReviewPrompt,
  buildCompactActOnReviewPrompt,
} = require('../.test-runtime/adapters/review/review-prompts.js');
const {
  handleGateFailureAutoBounce,
} = require('../.test-runtime/adapters/review/review-loop.js');

const repoRoot = path.resolve(__dirname, '..');
const reviewLoopSource = fs.readFileSync(
  path.join(repoRoot, 'src/adapters/review/review-loop.ts'),
  'utf8'
);

test('task-2317: successful declared-gate instruction compacts only after success and retains failed-gate diagnostics', () => {
  const executePrompt = fs.readFileSync(path.join(repoRoot, 'prompts/execute.md'), 'utf8');

  assert.match(executePrompt, /Immediately after \*\*each successful mission-declared Gate\*\*, compact/i);
  assert.match(executePrompt, /Do not compact for a failed gate: retain its failure diagnostic/i);
  assert.match(executePrompt, /locked mission goal and scope plus committed checkpoint or successful-gate evidence/i);
});

test('task-2317: no-declared-gates implementation-to-act-on-review prompt compacts and reloads durable state', () => {
  const prompt = buildCompactActOnReviewPrompt({
    implementer: 'codex',
    branch: 'mission/task-2317-no-gates',
    attempt: 1,
    reviewOutcome: 'REQUEST_CHANGES',
    repoRoot,
  });

  assert.match(prompt, /Before acting on findings, compact the implementation context/i);
  assert.match(prompt, /applies even when `MISSION\.md` declares no gates/i);
  assert.match(prompt, /current review round and disposition; unresolved findings and implementer resolutions; and the exact revision under review/i);
});

test('task-2317: reviewer round-2 prompt compacts after rebase and reloads the rewritten baseline', () => {
  const prompt = buildCompactReviewPrompt({
    reviewer: 'claude',
    implementer: 'codex',
    branch: 'mission/task-2317-rebase',
    attempt: 2,
    reviewBaseline: 'post-rebase-baseline-sha',
    repoRoot,
  });

  assert.match(prompt, /When `2` is 2 or later, before beginning this review round compact/i);
  assert.match(prompt, /exact post-rebase revision and review baseline shown by `git diff post-rebase-baseline-sha\.\.HEAD`/i);
  assert.match(prompt, /independent of `MISSION\.md` gates/i);
});

test('task-2317: repairable gate-error bounce compacts before repair and retains diagnostic plus retry state', async () => {
  let repairPrompt = '';
  const result = await handleGateFailureAutoBounce('task-2317-bounce', repoRoot, {
    ok: false,
    area: 'workflow',
    command: './scripts/verify-local.sh all',
    exitCode: 1,
    stdout: 'failing test: preserves diagnostic',
    stderr: 'assertion failed',
    error: 'verification gate failed with exit code 1',
  }, 'codex', {
    readReviewStateFn: () => ({ round: 2, disposition: 'REQUEST_CHANGES', metadata: { gateFailureRetryCount: 0 } }),
    writeReviewStateFn: () => {},
    transitionTaskFn: async () => {},
    applyAgentFallbackFn: ({ original }: { original: string }) => original,
    startAgentFn: async (_step: string, options: { prompt: (agent: string) => string }) => {
      repairPrompt = options.prompt('codex');
      return { agent: 'codex' };
    },
    log: () => {}, error: () => {},
  });

  assert.deepEqual(result, { bounced: true, stranded: false });
  assert.match(repairPrompt, /Before repair work, compact the aborted working context/i);
  assert.match(repairPrompt, /failing test: preserves diagnostic/);
  assert.match(repairPrompt, /Retry attempt: 1\/2/);
  assert.match(repairPrompt, /current review round and disposition; unresolved findings and implementer resolutions/i);
});

test('task-2317: reviewer and implementer recovery relaunches compact before work with their retry state', () => {
  assert.match(reviewLoopSource, /RECOVERY: Reviewer timeout[\s\S]*?compact the failed-attempt context[\s\S]*?reviewer retry \$\{stateAny\['reviewerRetryCount'\]\}\/2/);
  assert.match(reviewLoopSource, /RECOVERY: Implementer disposition timeout[\s\S]*?compact the failed-attempt context[\s\S]*?implementer retry \$\{stateAny\['implementerRetryCount'\]\}\/2/);
});

test('task-2317: reviewer compaction follows successful rebase and baseline recapture before launch', () => {
  const rebaseIndex = reviewLoopSource.indexOf('const rebaseResult = await rebaseBeforeReviewRoundFn');
  const recaptureIndex = reviewLoopSource.indexOf('reviewBaseline = captureReviewBaseline();', rebaseIndex);
  const launchIndex = reviewLoopSource.indexOf("reviewerLaunchResult = await startAgentFn('review'", recaptureIndex);

  assert.ok(rebaseIndex >= 0, 'review loop must rebase before reviewer launch');
  assert.ok(recaptureIndex > rebaseIndex, 'review baseline must be recaptured after successful rebase');
  assert.ok(launchIndex > recaptureIndex, 'reviewer prompt must receive the post-rebase baseline');
});
