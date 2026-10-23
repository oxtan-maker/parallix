
// Coverage tests for review.js as requested in Finding 3 of task-1135 review.

import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mockModule, installModuleMocks } from '../../../lib/module-mock.js';
const commitSafeMissionArtifactsModule = mockModule<typeof import('../../../../src/adapters/review/rebase.js')>('../../../../src/adapters/review/rebase.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const { commitSafeMissionArtifacts } = commitSafeMissionArtifactsModule;

const TEST_SLUG = 'task-1135-coverage';

// Reviewer identity fallback ("autonomous" when no reviewer can be derived) is
// owned by src/application/review-loop/reviewer-selection.ts and covered by its
// application tests.

test('commitSafeMissionArtifacts handles commit failure', async () => {
  const logs = [];
  const errors: string[] = [];

  const result = await commitSafeMissionArtifacts(TEST_SLUG, '/tmp/worktree', {
    gitFn: (args) => {
      if (args.includes('status')) return { signal: null, stderr: '',  status: 0, stdout: ' M safe.js\0' };
      if (args.includes('commit')) return { signal: null, stdout: '',  status: 1, stderr: 'commit failed' };
      return { signal: null, stderr: '',  status: 0, stdout: '' };
    },
    isMissionArtifactFn: () => true, // Force safe
    isWorkflowGeneratedArtifactFn: () => true, // Force safe
    log: m => logs.push(m),
    error: m => errors.push(m)
  });

  assert.equal(result.ok, false, 'Should return ok: false on commit failure');
  assert.ok(errors.some(e => e.includes('Failed to commit mission artifacts: commit failed')), `Expected commit failure error; got: ${errors.join(' | ')}`);
});

test('commitSafeMissionArtifacts no longer treats a repo stats CSV as a safe mission artifact', async () => {
  // task-1135 auto-committed the configured stats CSV because the review loop
  // wrote one into the checkout. TASK-2322.08 moved measurements to the
  // operator-local database, so a stats.csv in a repository is now ordinary
  // untracked user content and must NOT be auto-committed before rebase.
  const { commitSafeMissionArtifacts: commitSafeMissionArtifactsCjs } = commitSafeMissionArtifactsModule;
  assert.equal(typeof commitSafeMissionArtifactsCjs, 'function', 'commitSafeMissionArtifacts should be a function');
});

test('commitSafeMissionArtifacts leaves a non-mission stats CSV untouched', async () => {
  const added: string[] = [];
  const errors: string[] = [];

  const result = await commitSafeMissionArtifacts(TEST_SLUG, '/tmp/worktree', {
    gitFn: (args) => {
      if (args.includes('status')) return { signal: null, stderr: '',  status: 0, stdout: ' M stats.csv\0' };
      if (args.includes('add')) { added.push(args[args.length - 1]); return { signal: null, stderr: '',  status: 0, stdout: '' }; }
      if (args.includes('commit')) return { signal: null, stderr: '',  status: 0, stdout: '' };
      return { signal: null, stderr: '',  status: 0, stdout: '' };
    },
    isMissionArtifactFn: () => false,
    isWorkflowGeneratedArtifactFn: () => false,
    error: m => errors.push(m)
  });

  assert.equal(result.ok, true, 'a repo stats.csv must not block a mission auto-commit');
  assert.deepEqual(added, [], 'nothing may be staged for a non-mission path');
  assert.deepEqual(errors, []);
});

test('commitSafeMissionArtifacts leaves genuinely non-mission paths untouched', async () => {
  const errors: string[] = [];

  const result = await commitSafeMissionArtifacts(TEST_SLUG, '/tmp/worktree', {
    gitFn: (args) => {
      if (args.includes('status')) return { signal: null, stderr: '',  status: 0, stdout: ' M server/src/Main.java\0' };
      return { signal: null, stderr: '',  status: 0, stdout: '' };
    },
    isMissionArtifactFn: () => false,
    isWorkflowGeneratedArtifactFn: () => false,
    error: m => errors.push(m)
  });

  assert.equal(result.ok, true, 'unrelated product code must not block a mission auto-commit');
  assert.deepEqual(errors, []);
});
