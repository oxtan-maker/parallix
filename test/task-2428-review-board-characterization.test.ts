import test from 'node:test';
import assert from 'node:assert/strict';
import { ReviewCommandUseCase } from '../src/application/review-command-use-case.js';

type Operation = 'submit' | 'consumeArtifacts' | 'submitReview';

function workflow(calls: Operation[]) {
  const record = (operation: Operation) => async () => { calls.push(operation); };
  return {
    preflight: async (args: string[], options: Record<string, unknown> = {}) => ({ slug: 'task-2428', args, options }),
    verify: async () => {}, submit: record('submit'), push: async () => {}, start: async () => {}, continue: async () => {}, resume: async () => {},
    comment: async () => {}, readComments: async () => {}, submitReview: record('submitReview'), consumeArtifacts: record('consumeArtifacts'),
    close: async () => {}, status: async () => {}, createEvent: async () => {}, backfillReview: async () => {},
    reconcileReview: async () => {}, importLegacy: async () => {},
  };
}

test('task-2428 characterization: review:submit CLI selects submit-for-review, not a reviewer decision', async () => {
  const calls: Operation[] = [];
  await new ReviewCommandUseCase(workflow(calls)).execute(['task-2428', '--submit']);

  assert.deepEqual(calls, ['submit']);
});

test('task-2428 characterization: review:act-on-findings CLI consumes persisted reviewer artifacts only', async () => {
  const calls: Operation[] = [];
  await new ReviewCommandUseCase(workflow(calls)).execute(['task-2428', '--consume-artifacts']);

  assert.deepEqual(calls, ['consumeArtifacts']);
});

test('task-2428 characterization: approve:review CLI selects reviewer verdict submission and remains unavailable', async () => {
  const calls: Operation[] = [];
  await new ReviewCommandUseCase(workflow(calls)).execute(['task-2428', '--submit-review', 'approve', '--message', 'approved']);

  assert.deepEqual(calls, ['submitReview']);
});
