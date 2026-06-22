const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { startReviewLoop } = require('../lib/review/review-loop');

test('startReviewLoop skips reviewer and implementer launches for autonomous fallback in provider=none mode', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-1209-review-loop-'));
  const logs = [];
  const errors = [];
  const launches = [];

  try {
    fs.writeFileSync(
      path.join(root, 'workflow.config.json'),
      JSON.stringify({ product: {}, adapters: { review: { provider: 'none' } } })
    );

    await startReviewLoop('task-999', {
      worktree: root,
      maxAttempts: 1,
      maybeUpdateGraphifyBeforeReviewFn: () => {},
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task-999.md' }),
      getTaskImplementerFn: () => null,
      readReviewStateFn: () => null,
      eligibleAgentsForStepFn: () => ['codex'],
      selectAgentFn: () => { throw new Error('No agents available'); },
      rebaseBeforeReviewRoundFn: async () => ({ ok: true }),
      startAgentFn: async (mode) => {
        launches.push(mode);
        throw new Error(`unexpected ${mode} launch`);
      },
      consumeReviewerArtifactsFn: async () => ({ consumed: true, ok: true, reviewState: 'REQUEST_CHANGES' }),
      consumeImplementerArtifactsFn: async () => ({ consumed: true, ok: true, disposition: 'CHANGES_MADE' }),
      transitionTaskFn: () => true,
      transitionVirtualFn: () => true,
      writeReviewStateFn: () => {},
      log: (msg) => logs.push(msg),
      error: (msg) => errors.push(msg),
      exit: (code) => {
        throw new Error(`exit(${code})`);
      }
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  assert.deepEqual(launches, [], 'autonomous fallback should not launch any agents');
  assert.equal(errors.length, 0, `expected no errors, got: ${errors.join(' | ')}`);
  assert.ok(logs.some(msg => msg.includes('skipping reviewer launch')), 'should log reviewer launch bypass');
  assert.ok(logs.some(msg => msg.includes('skipping implementer launch')), 'should log implementer launch bypass');
});
