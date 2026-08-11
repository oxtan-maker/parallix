import test from 'node:test';
import assert from 'node:assert/strict';
import { ReviewCommandUseCase } from '../src/application/review-command-use-case.js';

function mockedPort(calls: Array<{ operation: string; args: string[] }>) {
  const record = (operation: string) => async (context: { args: string[] }) => { calls.push({ operation, args: context.args }); };
  return {
    preflight: async (args: string[], options: Record<string, unknown> = {}) => ({ slug: 'task-2332.14', args, options }),
    verify: record('verify'), submit: record('submit'), push: record('push'), start: record('start'), continue: record('continue'),
    comment: record('comment'), readComments: record('readComments'), submitReview: record('submitReview'), consumeArtifacts: record('consumeArtifacts'),
    close: record('close'), status: record('status'), createEvent: record('createEvent'), backfillReview: record('backfillReview'),
    reconcileReview: record('reconcileReview'), importLegacy: record('importLegacy'),
  };
}

test('ReviewCommandUseCase dispatches approval path to mocked port', async () => {
  const calls: Array<{ operation: string; args: string[] }> = [];
  await new ReviewCommandUseCase(mockedPort(calls)).execute(['task-2332.14', '--submit-review', 'approve']);
  assert.deepEqual(calls, [{ operation: 'submitReview', args: ['task-2332.14', '--submit-review', 'approve'] }]);
});

test('ReviewCommandUseCase dispatches requested-changes path to mocked port', async () => {
  const calls: Array<{ operation: string; args: string[] }> = [];
  await new ReviewCommandUseCase(mockedPort(calls)).execute(['task-2332.14', '--submit-review', 'request-changes']);
  assert.equal(calls[0].operation, 'submitReview');
  assert.ok(calls[0].args.includes('request-changes'));
});

test('ReviewCommandUseCase delegates Forgejo-unavailable submit handling to mocked port', async () => {
  const calls: Array<{ operation: string; args: string[] }> = [];
  const port = mockedPort(calls);
  port.submit = async context => { calls.push({ operation: 'forgejo-unavailable', args: context.args }); };
  await new ReviewCommandUseCase(port).execute(['task-2332.14', '--submit']);
  assert.equal(calls[0].operation, 'forgejo-unavailable');
});

test('ReviewCommandUseCase dispatches retry-after-failure continuation to mocked port', async () => {
  const calls: Array<{ operation: string; args: string[] }> = [];
  await new ReviewCommandUseCase(mockedPort(calls)).execute(['task-2332.14', '--continue', '--max-attempts', '2']);
  assert.deepEqual(calls.map(call => call.operation), ['continue']);
});

test('ReviewCommandUseCase preserves reviewer selection on mocked start path', async () => {
  const calls: Array<{ operation: string; args: string[] }> = [];
  await new ReviewCommandUseCase(mockedPort(calls)).execute(['task-2332.14', '--start', '--reviewer', 'codex']);
  assert.equal(calls[0].operation, 'start');
  assert.deepEqual(calls[0].args.slice(-2), ['--reviewer', 'codex']);
});
