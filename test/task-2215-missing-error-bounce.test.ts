

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
const repairHandoff = mockModule<typeof import('../src/adapters/cli/commands/repair-handoff.js')>('../src/adapters/cli/commands/repair-handoff.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const { classifyError, FailureClass, DispatchAction } = repairHandoff;
// Reproduction tests for task-2215 (missing error bounce).
//
// When automated handoff cannot find checkpoint documents even after
// auto-remediation (handoff.ts emits "No checkpoint documents found in ...
// even after auto-remediation."), ADR 0048 prescribes MissingArtifacts →
// AutoSendBack so the implementer agent is relaunched with a repair prompt.
// Before the fix, this message fell through classifyError's patterns to the
// default InfraBlocker/HumanOnly, stranding the task on manual intervention.

const autoRemediationError =
  'No checkpoint documents found in /home/magnus/code/parallix-task-2213/missions/task-2213 ' +
  'even after auto-remediation. Implementation evidence is mandatory for review.';

test('task-2215 repro: classifyError classifies auto-remediation checkpoint failure as MissingArtifacts/AutoSendBack', () => {
  const result = classifyError(autoRemediationError);
  assert.equal(result.failureClass, FailureClass.MissingArtifacts,
    'auto-remediation failure must be MissingArtifacts per ADR 0048, not InfraBlocker');
  assert.equal(result.dispatchAction, DispatchAction.AutoSendBack,
    'auto-remediation failure must auto-send-back to the implementer, not require a human');
});

test('missing checkpoint evidence is sent back without generating placeholders', () => {
  const result = classifyError('No checkpoint documents found in missions/task-2521.06. Import historical evidence or record it with px checkpoint record; handoff never generates evidence.');
  assert.equal(result.failureClass, FailureClass.MissingArtifacts);
  assert.equal(result.dispatchAction, DispatchAction.AutoSendBack);
});
