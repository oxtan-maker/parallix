
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const repairHandoff = require('../.test-runtime/lib/commands/repair-handoff');
const { classifyError, FailureClass, DispatchAction } = repairHandoff;
const handoff = require('../.test-runtime/lib/commands/handoff');

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

test('task-2215 repro: buildAutoCheckpointContent evidence rows pass findUnverifiableGoalCheckRow validation', () => {
  const rootDir = path.join(__dirname, '..');
  const content = handoff._buildAutoCheckpointContent('task-2215');

  const goalCheckMatch = content.match(/^## Goal Check(?: Table)?\s*$/m);
  assert.ok(goalCheckMatch, 'auto-generated checkpoint must contain a "## Goal Check" section');

  const afterHeader = content.slice((goalCheckMatch.index ?? 0) + goalCheckMatch[0].length);
  const evidenceRows = handoff._collectGoalCheckEvidenceRows(afterHeader);
  assert.ok(evidenceRows.length > 0, 'auto-generated Goal Check table must contain evidence rows');

  const offendingRow = handoff._findUnverifiableGoalCheckRow(evidenceRows, rootDir);
  assert.equal(offendingRow, null,
    `auto-generated evidence rows must cite verifiable references; offending row: ${offendingRow}`);
});
