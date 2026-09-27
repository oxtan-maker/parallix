// Regression coverage for typed-mission recovery advice. Both paths use
// injected boundaries: no agent process, network service, or Mission write is
// involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runHandoffAndReview } from '../src/adapters/cli/commands/active.js';
import { buildRelaunchPrompt } from '../src/adapters/cli/commands/repair-handoff.js';

const slug = 'task-2581';
const worktree = '/tmp/worktree-task-2581';
const typedCheckpointFailure = 'Planned checkpoint evidence is missing before handoff: CP-2. Record each with `px checkpoint record --name <CP-N>` before handoff.';

function assertRecordedCheckpointRecoveryAdvice(prompt: string) {
  assert.match(prompt, /px status task-2581/, 'recovery reloads the recorded Mission contract');
  assert.match(prompt, /px checkpoint record --name CP-2/, 'recovery records the named missing checkpoint');
  assert.match(prompt, /--expected-version <n>/, 'recovery obtains and uses the current expected version');
  assert.match(prompt, /every declared gate passes/, 'typed recovery retains the mission gate completion requirement');
  assert.match(prompt, /only evidence from work and verification actually performed/, 'recording evidence requires real implementation and verification');
  assert.doesNotMatch(prompt, /(?:Create|Fix|Update) (?:a |the )?(?:final )?checkpoint document/i, 'typed recovery must not create a legacy checkpoint document');
  assert.doesNotMatch(prompt, /Create (?:a )?CP-(?:N|2)\.md/i, 'typed recovery must not create a legacy checkpoint template');
}

test('typed active checkpoint recovery uses recorded checkpoint commands through mocked boundaries', async () => {
  const prompts: string[] = [];

  const result = await runHandoffAndReview(slug, worktree, 'codex', {
    validateCheckpointsBeforeHandoffFn: () => ({
      ok: false,
      error: typedCheckpointFailure,
      nextCheckpoint: 'CP-2',
    }),
    startAgentFn: async (_stage: string, options: { prompt: string }) => {
      prompts.push(options.prompt);
      return { agent: 'codex', result: { status: 0 } };
    },
    workflowLauncherStatusFn: () => ({ supported: true }),
    performHandoff: async () => { throw new Error('handoff must not run while checkpoint evidence is missing'); },
    startReviewLoop: async () => {},
    log: () => {},
    error: () => {},
  });

  assert.equal(result, false, 'the mocked validation remains unresolved after the bounded recovery attempts');
  assert.ok(prompts.length > 0, 'the typed failure is sent to the mocked recovery launcher');
  assertRecordedCheckpointRecoveryAdvice(prompts[0]);
});

test('typed repair-handoff recovery uses recorded checkpoint commands without legacy templates', () => {
  const prompt = buildRelaunchPrompt(typedCheckpointFailure, slug, worktree);

  assertRecordedCheckpointRecoveryAdvice(prompt);
  assert.match(prompt, /historical[- ]import/i, 'legacy document import remains an explicit, separate compatibility path');
  assert.match(prompt, /px import-legacy/, 'historical documents retain their explicit import command');
});
