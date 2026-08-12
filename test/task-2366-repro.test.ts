import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mockModule, installModuleMocks } from './lib/module-mock.js';

const repairHandoff = mockModule<typeof import('../src/adapters/cli/commands/repair-handoff.js')>(
  '../src/adapters/cli/commands/repair-handoff.js',
  import.meta.url,
);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());

const { classifyError, FailureClass, DispatchAction } = repairHandoff;

test('task-2366 repro: classifyError maps rebase failure to GateFailure/AutoSendBack', () => {
  const result = classifyError(
    'Rebase failed before handoff. Ensure the mission branch can be rebased onto the latest primary branch.',
  );

  assert.equal(result.failureClass, FailureClass.GateFailure,
    'rebase failure must be classified as a relaunchable gate failure, not an infrastructure blocker');
  assert.equal(result.dispatchAction, DispatchAction.AutoSendBack,
    'rebase failure must auto-send-back to the implementer');
});
