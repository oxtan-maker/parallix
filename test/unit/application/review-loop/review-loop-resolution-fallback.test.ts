import test from 'node:test';
import assert from 'node:assert';
import { runReviewLoop } from '../../../../src/application/review-loop/review-loop.js';
import { fakeReviewLoopPorts } from '../../../helpers/review-loop-ports.js';

test('TASK-1048: review loop adopts an implementer launcher fallback for the poll, state, and assignee', async () => {
  const dispositionPolls: string[] = [];
  // The implementer's act-on-review launch hits capacity and the launcher runs
  // another family. The loop must poll the disposition for the family that
  // actually ran, persist it as the implementer, and record it as assignee.
  const fake = fakeReviewLoopPorts({
    slug: 'task-1048-regress',
    routing: { eligibleFamilies: () => ['codex', 'claude', 'gemini', 'custom'] },
    provider: {
      pollReview: async () => 'CHANGES_REQUESTED',
      pollDisposition: async implementer => { dispositionPolls.push(implementer); return 'CHANGES_MADE'; },
    },
    agents: {
      launch: async launch => {
        if (launch.role === 'reviewer') { return { agent: 'codex', result: { status: 0 } }; }
        assert.equal(launch.agent, 'gemini');
        assert.deepEqual(launch.exclude, ['codex']);
        // A still-running fallback whose provider disposition is polled below.
        return { agent: 'custom', result: {} };
      },
    },
    preReview: { head: () => null },
    output: { error: message => { throw new Error(message); }, exit: code => { throw new Error(`exit(${code})`); } },
  });

  await runReviewLoop({ slug: 'task-1048-regress', implementer: 'gemini', reviewer: 'codex', maxAttempts: 1 }, fake.ports);

  assert.deepEqual(dispositionPolls, ['custom'], 'disposition should have been polled for the fallback agent');
  assert.ok(fake.writes.some(state => state.implementer === 'custom'), 'review state should have been rewritten to the fallback agent');
  assert.ok(fake.mirrors.includes('assign:custom'), 'backlog assignee should have been enforced to the fallback agent');
});
