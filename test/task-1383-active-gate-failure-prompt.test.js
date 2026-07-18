const test = require('node:test');
const assert = require('node:assert/strict');
const repairHandoff = require('../dist/lib/commands/repair-handoff');

// task-1383: when a verification-gate failure carries captured failing-test
// output, the relaunch prompt must be a state-aware fix prompt that cites the
// failing tests and asks for a code fix — not the generic Goal Check /
// checkpoint-repair prompt used for incomplete-evidence failures.

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

  // SC2: prompt cites the failing test identifiers / captured output and
  // instructs the agent to fix the verification/test failure.
  assert.ok(
    prompt.includes('missionStart fails if the backlog task is missing classification'),
    'Prompt should include the failing test identifier from the captured gate output'
  );
  assert.ok(
    prompt.includes('printIntegrationPreflight branch failure'),
    'Prompt should include the second failing test identifier from the captured gate output'
  );
  assert.ok(
    /fix the failing (verification\/test|verification|test)/i.test(prompt) || /fix.*failing.*test/i.test(prompt),
    'Prompt should explicitly instruct the agent to fix the failing verification/test'
  );

  // SC3: gate-failure prompt must NOT contain the Goal Check / CP-N
  // checkpoint-editing instructions used for incomplete-evidence failures.
  assert.ok(!prompt.includes('Goal Check table'), 'Gate-failure prompt must not instruct editing the Goal Check table');
  assert.ok(!prompt.includes('CP-N.md'), 'Gate-failure prompt must not reference editing CP-N.md');
  assert.ok(!prompt.includes('| Goal Check | Evidence | Status |'), 'Gate-failure prompt must not include the Goal Check example table');
});

test('task-1383: incomplete-evidence relaunch prompts remain checkpoint-focused (SC4)', () => {
  const { buildRelaunchPrompt } = repairHandoff;
  const errorMsg = 'The final checkpoint at docs/missions/2026/task-1121/CP-3.md has a "## Goal Check" section but no evidence rows. A goal-check table with real evidence is required before handoff.';
  const prompt = buildRelaunchPrompt(errorMsg, 'task-1124', '/tmp/worktree');

  assert.ok(prompt.includes('Goal Check table'), 'Incomplete-evidence prompt should still reference the Goal Check table');
  assert.ok(prompt.includes('CP-N.md'), 'Incomplete-evidence prompt should still reference CP-N.md');
});
