

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

test('SC 3: active.js runHandoffAndReview calls attemptAgentRelaunch when repair fails and error is relaunchable', () => {
  const activeSource = fs.readFileSync(path.join(import.meta.dirname, '../src/adapters/cli/commands/active.ts'), 'utf8');
  assert.ok(activeSource.includes('attemptAgentRelaunchFn'), 'runHandoffAndReview should have attemptAgentRelaunchFn parameter');
  assert.ok(activeSource.includes('repairHandoff.isRelaunchableError(handoffResult.error)'), 'Should check isRelaunchableError before calling attemptAgentRelaunch');
});

test('SC 4: review.js startReviewLoop uses selectAgent for reviewer fallback', () => {
  // Check review-loop.js since startReviewLoop is now extracted there
  const reviewLoopSource = fs.readFileSync(path.join(import.meta.dirname, '../src/adapters/review/review-loop.ts'), 'utf8');
  assert.ok(reviewLoopSource.includes("selectAgentFn('review', { exclude: excludeSet })"), 'Should select reviewer fallback from the review eligibility pool');
  assert.ok(!reviewLoopSource.includes('fallbackForFn(reviewer, implementer)'), 'Should not call fallbackFor for reviewer fallback');
  // Verify the implementer check was removed
  assert.ok(!reviewLoopSource.includes('if (!agents.includes(implementer))') || reviewLoopSource.includes('// The strict implementer eligibility check was removed'), 'Implementer eligibility check should be removed or commented');
});

test('SC 5: review.js does not update Backlog task on reviewer fallback', () => {
  // Check review-loop.js since applyAgentFallback is now extracted there
  const reviewLoopSource = fs.readFileSync(path.join(import.meta.dirname, '../src/adapters/review/review-loop.ts'), 'utf8');
  assert.ok(!reviewLoopSource.includes('workflow(${slug}): fallback reviewer from'), 'Should not contain reviewer fallback commit message pattern');
  assert.ok(reviewLoopSource.includes("if (role === 'implementer' && taskResolution && taskResolution.ok)"), 'Backlog assignee enforcement should be guarded to implementer fallback');
  assert.ok(reviewLoopSource.includes('enforceTaskAssigneeFn(taskResolution.taskFile, fallback)'), 'Implementer fallback should still enforce Backlog assignee');
});

test('SC 6: resume-capable agents use session persistence via startAgent', () => {
  const agentsSource = fs.readFileSync(path.join(import.meta.dirname, '../src/adapters/agents/agents.ts'), 'utf8');
  const launcherSelectionSource = fs.readFileSync(path.join(import.meta.dirname, '../src/adapters/agents/launcher-selection.ts'), 'utf8');
  const activeSource = fs.readFileSync(path.join(import.meta.dirname, '../src/adapters/cli/commands/active.ts'), 'utf8');

  // Verify RESUME_CAPABLE matches the current resume-capable families
  assert.ok(launcherSelectionSource.includes("RESUME_CAPABLE = new Set(['claude', 'codex', 'custom'])"), 'RESUME_CAPABLE should include the current resume-capable agents');
  assert.ok(agentsSource.includes('await launchSessionMarkerPort.shouldResume('), 'startAgent should query the checked session-marker port');

  // Verify attemptAgentRelaunch calls startAgent which handles resume
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
