import test from 'node:test';
import assert from 'node:assert/strict';
import { reportRecovery } from '../src/interfaces/cli/recover.js';

test('reportRecovery preserves landed-cleanup and integrated-refusal outcomes', () => {
  const logs: string[] = [];
  const errors: string[] = [];
  const deps = { cleanup: () => false, log: (message: string) => logs.push(message), error: (message: string) => errors.push(message) };

  assert.equal(reportRecovery('recovered-landed', 'task-1', deps), false);
  assert.match(errors[0], /cleanup failed/);

  errors.length = 0;
  assert.equal(reportRecovery('refused-integrated', 'task-1', { ...deps, cleanup: () => true }), false);
  assert.match(errors[0], /durable integration history/);
  assert.equal(reportRecovery('recover-to-active', 'task-1', deps), true);
  assert.ok(logs.some(message => message.includes('resumed active')));
});
