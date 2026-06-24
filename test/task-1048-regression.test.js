const test = require('node:test');
const assert = require('node:assert');
const { execSync } = require('child_process');
const { startReviewLoop } = require('../lib/review/review');

test('TASK-1048: startReviewLoop does not crash when taskResolution is needed for fallback', async () => {
  const writes = [];
  const assigneeWrites = [];
  const dispositionPolls = [];

  // This test exercises the fallback path where `taskResolution` is passed to
  // `applyAgentFallbackFn` during the implementer act-on-review launch. The
  // original bug was a ReferenceError because `taskResolution` was not in scope
  // inside the `applyAgentFallback` call at review.js:959.
  //
  // To trigger the fallback path:
  // 1. startAgentFn returns a different agent for the implementer launch.
  // 2. pollForReviewFn returns REQUEST_CHANGES so the loop continues.
  // 3. pollForDispositionFn returns something to exit cleanly.
  await startReviewLoop('task-1048-regress', {
    implementer: 'gemini',
    reviewer: 'codex',
    maxAttempts: 1,
    eligibleAgentsForStepFn: () => ['codex', 'claude', 'gemini', 'qwen'],
    dryRun: false,
    log: () => {},
    error: (m) => { throw new Error(m); },
    exit: (c) => { throw new Error(`exit(${c})`); },
    maybeUpdateGraphifyBeforeReviewFn: () => ({ updated: false, skipped: true }),
    readReviewStateFn: () => null,
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task-1048.md' }),
    workflowLauncherStatusFn: () => ({ supported: true }),
    isForgejoReviewEnabledFn: () => true,
    forgejoAvailableFn: async () => true,
    getPrStatusFn: () => ({ exists: true, state: 'open', number: 42 }),
    resolveForgejoUserFn: () => 'gemini',
    readTokenFn: () => 'mock-token',
    writeReviewStateFn: (slug, state) => writes.push({ slug, state }),
    rebaseBeforeReviewRoundFn: async () => ({ ok: true, sharedFileConflicts: false }),
    startAgentFn: async (step, options) => {
      if (step === 'review') {
        return { agent: 'codex', result: { status: 0 } };
      }
      // Implementer fallback: gemini -> qwen
      assert.equal(step, 'act-on-review');
      assert.equal(options.agent, 'gemini');
      assert.deepEqual(options.exclude, ['codex']);
      return { agent: 'qwen', result: { status: 0 } };
    },
    pollForReviewFn: async () => 'CHANGES_REQUESTED',
    pollForDispositionFn: async (prNumber, implementerUser) => {
      dispositionPolls.push({ prNumber, implementerUser });
      return 'CHANGES_MADE';
    },
    enforceTaskAssigneeFn: (file, agent) => {
      assigneeWrites.push({ file, agent });
      return true;
    },
    transitionTaskFn: () => true,
    buildCompactReviewPromptFn: () => 'prompt',
    buildCompactActOnReviewPromptFn: () => 'prompt',
    recordStageStatsSafeFn: () => {}
  });

  // Verify the fallback was exercised: disposition was polled for the
  // fallback agent (qwen), proving taskResolution was in scope at
  // applyAgentFallbackFn(review.js:959).
  assert.deepEqual(dispositionPolls, [{ prNumber: 42, implementerUser: 'qwen' }],
    'disposition should have been polled for the fallback agent');
  assert.ok(
    writes.some(w => w.state.implementer === 'qwen'),
    'review state should have been rewritten to the fallback agent'
  );
  assert.ok(
    assigneeWrites.some(a => a.agent === 'qwen'),
    'backlog assignee should have been enforced to the fallback agent'
  );

  // Regression: verify no stray backlog(task-1048-regress) commits were created
  const strayCommits = (() => {
    try {
      return execSync('git log --oneline --grep="task-1048-regress" --not main 2>/dev/null || true', { encoding: 'utf8' }).trim();
    } catch (_) {
      return '';
    }
  })();
  assert.equal(strayCommits, '', 'No stray backlog(task-1048-regress) commits should exist after test');
});
