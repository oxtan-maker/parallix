

// CP-4 integration tests for task-1124

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
const isRelaunchableErrorModule = mockModule<typeof import('../src/adapters/cli/commands/repair-handoff.js')>('../src/adapters/cli/commands/repair-handoff.js', import.meta.url);
const buildRelaunchPromptModule = mockModule<typeof import('../src/adapters/cli/commands/repair-handoff.js')>('../src/adapters/cli/commands/repair-handoff.js', import.meta.url);
const runtimeMatrix = mockModule<typeof import('../src/adapters/agents/runtime-matrix.js')>('../src/adapters/agents/runtime-matrix.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const { isRelaunchableError } = isRelaunchableErrorModule;
const { buildRelaunchPrompt } = buildRelaunchPromptModule;

test('SC 1: isRelaunchableError returns true for goal-check missing evidence rows', () => {
  const errorMsg = 'The final checkpoint at docs/missions/2026/task-1121/CP-3.md has a "## Goal Check" section but no evidence rows. A goal-check table with real evidence is required before handoff.';
  assert.equal(isRelaunchableError(errorMsg), true);
});

test('SC 2: buildRelaunchPrompt contains Goal Check table and mission slug', () => {
  const errorMsg = 'The final checkpoint at docs/missions/2026/task-1121/CP-3.md has a "## Goal Check" section but no evidence rows. A goal-check table with real evidence is required before handoff.';
  const prompt = buildRelaunchPrompt(errorMsg, 'task-1124', '/tmp/worktree');
  assert.ok(prompt.includes('Goal Check table'));
  assert.ok(prompt.includes('task-1124'));
});

test('SC 3: active.js runHandoffAndReview bounces through the kernel when repair fails and error is relaunchable', () => {
  // TASK-2377.05: `attemptAgentRelaunch` was deleted; the relaunch is a
  // `rebound()` call whose launch port is the injected `startAgentFn`.
  const activeSource = fs.readFileSync(path.join(import.meta.dirname, '../src/adapters/cli/commands/active.ts'), 'utf8');
  assert.ok(activeSource.includes('startAgentFn'), 'runHandoffAndReview should have a startAgentFn launch seam');
  assert.ok(activeSource.includes('rebound('), 'Should bounce through the rebound kernel');
  assert.ok(activeSource.includes('repairHandoff.isRelaunchableError(handoffResult.error)'), 'Should check isRelaunchableError before bouncing');
});

test('SC 4: reviewer fallback uses the review eligibility selector', () => {
  const fallbackSource = fs.readFileSync(path.join(import.meta.dirname, '../src/adapters/review/review-agent-fallback.ts'), 'utf8');
  assert.ok(fallbackSource.includes('fallback = selectReviewer(excludeSet)'), 'Should select reviewer fallback from the review eligibility pool');
  assert.ok(!fallbackSource.includes('fallbackForFn(reviewer, implementer)'), 'Should not call fallbackFor for reviewer fallback');
  // Verify the implementer check was removed
  assert.ok(!fallbackSource.includes('if (!agents.includes(implementer))') || fallbackSource.includes('// The strict implementer eligibility check was removed'), 'Implementer eligibility check should be removed or commented');
});

test('SC 5: reviewer fallback does not update the Backlog task', () => {
  const fallbackSource = fs.readFileSync(path.join(import.meta.dirname, '../src/adapters/review/review-agent-fallback.ts'), 'utf8');
  assert.ok(!fallbackSource.includes('workflow(${slug}): fallback reviewer from'), 'Should not contain reviewer fallback commit message pattern');
  assert.ok(fallbackSource.includes("if (role === 'implementer' && taskResolution && taskResolution.ok)"), 'Backlog assignee enforcement should be guarded to implementer fallback');
  assert.ok(fallbackSource.includes('enforceTaskAssigneeFn(taskResolution.taskFile, fallback)'), 'Implementer fallback should still enforce Backlog assignee');
});

test('SC 6: resume-capable agents use session persistence via startAgent', () => {
  const agentsSource = fs.readFileSync(path.join(import.meta.dirname, '../src/adapters/agents/agents.ts'), 'utf8');
  const launcherSelectionSource = fs.readFileSync(path.join(import.meta.dirname, '../src/adapters/agents/launcher-selection.ts'), 'utf8');
  const activeSource = fs.readFileSync(path.join(import.meta.dirname, '../src/adapters/cli/commands/active.ts'), 'utf8');

  // Verify RESUME_CAPABLE matches the current resume-capable families
  assert.ok(launcherSelectionSource.includes("RESUME_CAPABLE = new Set(['claude', 'codex', 'custom', 'qwen'])"), 'RESUME_CAPABLE should include the current resume-capable agents');
  assert.ok(agentsSource.includes('await launchSessionMarkerPort.shouldResume('), 'startAgent should query the checked session-marker port');

  // Verify the kernel's launch port calls startAgent, which handles resume
  assert.ok(activeSource.includes("startAgentFn('active'"), 'Should call startAgent');
  assert.ok(activeSource.includes("role: 'implementer'"), 'Should pass role as implementer');
});

test('SC 8: manual handoff path preserved - outputs manual handoff message when relaunch fails', () => {
  const activeSource = fs.readFileSync(path.join(import.meta.dirname, '../src/adapters/cli/commands/active.ts'), 'utf8');
  assert.ok(activeSource.includes('You may need to complete the handoff manually:'), 'Manual handoff message should be preserved');
  assert.ok(activeSource.includes('px review ${slug} --submit'), 'Manual handoff command should be preserved');
});

test('runtime-matrix no longer exports hardcoded reviewer routing (reviewerFor/fallbackFor removed)', () => {

  // The biased, hardcoded implementer→reviewer routing has been removed in
  // favor of config-driven, unbiased selectAgent('review', { exclude: [implementer] }).
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
  assert.equal(runtimeMatrix.reviewerFor, undefined, 'reviewerFor must no longer be exported');
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
  assert.equal(runtimeMatrix.fallbackFor, undefined, 'fallbackFor must no longer be exported');
});
