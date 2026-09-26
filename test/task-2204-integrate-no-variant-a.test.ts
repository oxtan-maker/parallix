import test from 'node:test';
import assert from 'node:assert/strict';
import { checkReviewProvider } from '../src/application/integrate/preflight-review.js';

test('integrate rejects merged Forgejo PRs during preflight with recovery guidance', () => {
  const output: string[] = [];
  const report = { failures: [], warnings: [], log: (line: string) => output.push(line), detail: () => {} };

  checkReviewProvider(report, {
    slug: 'task-2204',
    missionStatus: 'review',
    pr: { exists: true, state: 'merged', number: 2204 },
    approval: { ok: true, reviewState: 'APPROVED' },
    siblingPrs: [],
    forgejoUser: null,
  }, { baseWorktree: '/repo', baseBranch: 'main', readTokenFn: () => null, resolveTokenFileFn: () => null });

  assert.deepEqual(report.failures, ['pr-merged', 'forgejo-token']);
  assert.match(output.join('\n'), /Forgejo PR: PR #2204 is already marked merged/i);
  assert.match(output.join('\n'), /re-sync the local base branch/i);
  assert.match(output.join('\n'), /px integrate task-2204 --dry-run/i);
});
