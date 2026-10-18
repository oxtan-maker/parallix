import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowFailureSummary, type WorkflowFailureFacts } from '../../../../src/application/presentation/workflow-failure.js';

const facts: WorkflowFailureFacts = { mission: 'task-example', stage: 'review:submit / checking', command: 'npm run verify', exitCode: 7,
  diagnostics: ['gate npm run verify failed with exit 7'], output: [{ runId: 'workflow-example', stream: 'stderr', offset: 21, length: 90 }] };

test('workflow failure renders recorded fields and unknown cause without classifying diagnostics (TASK-2772)', () => {
  const summary = workflowFailureSummary(facts);
  for (const expected of ['review:submit / checking', 'npm run verify (exit 7)', 'Cause: unknown', 'Diagnostic: gate npm run verify failed with exit 7',
    'px history task-example show run:workflow-example:stderr@21+90', 'Recovery: not attempted', 'Next: Inspect px history task-example']) {
    assert.ok(summary.includes(expected), expected);
  }
  assert.doesNotMatch(summary, /budget exhausted/);
});

test('workflow failure renders signal termination and missing evidence honestly (TASK-2772)', () => {
  const summary = workflowFailureSummary({ ...facts, exitCode: null, signal: 'SIGTERM', diagnostics: [], output: [] });
  assert.match(summary, /signal SIGTERM/);
  assert.match(summary, /no output was retained/);
  assert.match(workflowFailureSummary({ ...facts, exitCode: null }), /exit unknown/);
});

test('workflow failure distinguishes recorded recovery outcomes and bounds terminal text (TASK-2772)', () => {
  for (const [outcome, expected] of [['resolved', 'attempted and resolved'], ['exhausted', 'budget exhausted'], ['attempted', 'outcome unresolved']] as const) {
    assert.match(workflowFailureSummary({ ...facts, recovery: { outcome, attempts: 2 } }), new RegExp(`${expected}.*2 attempts`));
  }
  const summary = workflowFailureSummary({ ...facts, cause: 'recorded cause', diagnostics: Array(20).fill('\x1b[31mone\n' + 'x'.repeat(10000)), next: 'Inspect the failed gate' });
  assert.match(summary, /Cause: recorded cause/);
  assert.match(summary, /Next: Inspect the failed gate/);
  assert.equal(summary.split('\n').length, 16);
  assert.ok(summary.length < 5000);
  assert.doesNotMatch(summary, /\x1b/);
});
