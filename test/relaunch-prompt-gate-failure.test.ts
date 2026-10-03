

// task-1383: when a verification-gate failure carries captured failing-test
// output, the relaunch prompt must be a state-aware fix prompt that cites the
// failing tests and asks for a code fix — not the generic Goal Check /
// checkpoint-repair prompt used for incomplete-evidence failures.

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
const repairHandoff = mockModule<typeof import('../src/adapters/cli/commands/repair-handoff.js')>('../src/adapters/cli/commands/repair-handoff.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());

const GATE_ERROR_MSG = 'Final verification gate failed. Fix errors before submitting or use --no-gate if appropriate.';
const GATE_OUTPUT = {
  stdout: '',
  stderr: [
    'test at test/mission-start.test.js:7:1',
    '✖ missionStart fails if the backlog task is missing classification (12.355159ms)',
    '  Error: Could not detect primary branch. Neither \'main\' nor \'master\' exists as a local branch.',
    'test at test/task-1039-integrate-v3.test.js:10:1',
    '✖ printIntegrationPreflight branch failure (17.570505ms)',
    '  Error: Could not detect primary branch. Neither \'main\' nor \'master\' exists as a local branch.'
  ].join('\n')
};

test('task-1383: buildRelaunchPrompt for a verification-gate failure with captured failing tests is a fix-the-tests prompt, not a Goal Check repair prompt (SC1-SC3)', () => {
  const { buildRelaunchPrompt } = repairHandoff;
  const prompt = buildRelaunchPrompt(GATE_ERROR_MSG, 'task-1383', '/tmp/worktree', GATE_OUTPUT);

  assert.ok(typeof prompt === 'string', 'Prompt should be a string');

  // The compatibility export delegates to the kernel, retaining the actual
  // gate evidence instead of recreating a separate handoff prompt authority.
  assert.ok(
    prompt.includes('missionStart fails if the backlog task is missing classification'),
    'Prompt should include the failing test identifier from the captured gate output'
  );
  assert.ok(
    prompt.includes('printIntegrationPreflight branch failure'),
    'Prompt should include the second failing test identifier from the captured gate output'
  );
  assert.ok(
    prompt.includes('Fix the specific handoff verification failure shown above'),
    'Prompt should explicitly instruct the agent to fix the captured failure'
  );

  // No competing checkpoint-repair template may be reintroduced here.
  assert.ok(!prompt.includes('Goal Check table'), 'Gate-failure prompt must not instruct editing the Goal Check table');
  assert.ok(!prompt.includes('CP-N.md'), 'Gate-failure prompt must not reference editing CP-N.md');
  assert.ok(!prompt.includes('| Goal Check | Evidence | Status |'), 'Gate-failure prompt must not include the Goal Check example table');
});

test('task-1383: incomplete-evidence compatibility prompts remain evidence-specific (SC4)', () => {
  const { buildRelaunchPrompt } = repairHandoff;
  const errorMsg = 'The final checkpoint at docs/missions/2026/task-1121/CP-3.md has a "## Goal Check" section but no evidence rows. A goal-check table with real evidence is required before handoff.';
  const prompt = buildRelaunchPrompt(errorMsg, 'task-1124', '/tmp/worktree');

  assert.ok(prompt.includes('Goal Check table'), 'Incomplete-evidence prompt should still reference the Goal Check table');
  assert.ok(prompt.includes('CP-'), 'Incomplete-evidence prompt should still reference CP-N.md');
  assert.ok(prompt.includes(errorMsg), 'Prompt should retain the failed checkpoint evidence');
  assert.ok(prompt.includes('Classification: IncompleteEvidence — AutoSendBack'));
});
