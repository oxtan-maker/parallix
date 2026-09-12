


import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
const startReviewLoopModule = mockModule<typeof import('../src/adapters/review/review-loop.js')>('../src/adapters/review/review-loop.js', import.meta.url);
await installModuleMocks();
const { startReviewLoop } = startReviewLoopModule;
test.afterEach(() => mock.restoreAll());
test('startReviewLoop skips reviewer and implementer launches for autonomous fallback in provider=none mode', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-1209-review-loop-'));
  const logs = [];
  const errors = [];
  const launches = [];

  try {
    fs.writeFileSync(
      path.join(root, 'workflow.config.json'),
      JSON.stringify({ product: {}, adapters: { review: { provider: 'none' } } })
    );

    await startReviewLoop('task-999', {
      worktree: root,
      maxAttempts: 1,
      maybeUpdateGraphifyBeforeReviewFn: () => {},
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task-999.md' }),
      getTaskImplementerFn: () => null,
      readReviewStateFn: () => null,
      // SC1: a provider-disabled --start now performs the handoff transition.
      performHandoffFn: async () => ({ ok: true }),
      eligibleAgentsForStepFn: () => ['codex'],
      selectAgentFn: () => { throw new Error('No agents available'); },
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
      rebaseBeforeReviewRoundFn: async () => ({ ok: true }),
      startAgentFn: async (mode) => {
        launches.push(mode);
        throw new Error(`unexpected ${mode} launch`);
      },
      consumeReviewerArtifactsFn: async () => ({ consumed: true, ok: true, reviewState: 'REQUEST_CHANGES' }),
      consumeImplementerArtifactsFn: async () => ({ consumed: true, ok: true, disposition: 'CHANGES_MADE' }),
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
      transitionTaskFn: () => true,
      transitionVirtualFn: () => true,
// @ts-expect-error -- TASK-2328: partial test double after ESM seam migration
      writeReviewStateFn: () => {},
      log: (msg) => logs.push(msg),
      error: (msg) => errors.push(msg),
      exit: (code) => {
        throw new Error(`exit(${code})`);
      }
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  assert.deepEqual(launches, [], 'autonomous fallback should not launch any agents');
  assert.equal(errors.length, 0, `expected no errors, got: ${errors.join(' | ')}`);
  assert.ok(logs.some(msg => msg.includes('skipping reviewer launch')), 'should log reviewer launch bypass');
  assert.ok(logs.some(msg => msg.includes('skipping implementer launch')), 'should log implementer launch bypass');
  assert.equal(logs.filter(msg => msg.includes('Selected reviewer:')).length, 1, 'reviewer selection is announced once');
  assert.ok(logs.some(msg => msg.includes('REVIEW — task-999')), 'operator header identifies the mission');
  assert.ok(logs.some(msg => msg.includes('Independence: same-family fallback / self-review')), 'operator header states the fallback relationship');
  assert.equal(logs.some(msg => /Poll interval|Poll timeout|Max attempts|Persisted reviewer artifacts/.test(msg)), false, 'default output hides review plumbing');
});
