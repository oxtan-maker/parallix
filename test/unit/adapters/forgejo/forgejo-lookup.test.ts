import { getLatestReviewForPr, getLatestDispositionEvidenceForPr, getLatestDispositionForPr } from '../../../../src/adapters/forgejo/forgejo-pr.js';
import { providerReviewChanges, providerResolution } from '../../../../src/adapters/review/review-provider-observations.js';
import { forgejoApiFixture, forgejoAsyncApiFixture } from '../../../fixtures/forgejo-api.js';



import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { mockModule, installModuleMocks } from '../../../lib/module-mock.js';
const getPrNumberModule = mockModule<typeof import('../../../../src/adapters/forgejo/forgejo.js')>('../../../../src/adapters/forgejo/forgejo.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const { getPrNumber } = getPrNumberModule;
test('getPrNumber robust matching', (t) => {
  const apiCall = forgejoApiFixture((method, apiPath) => {
    if (apiPath.includes('state=open')) return { ok: true as const, data: [] };
    return {
      ok: true as const,
      data: [
        { number: 101, head: { ref: 'other', label: 'user:mission/task-101' } },
        { number: 102, head: { ref: 'mission/task-102', label: 'mission/task-102' } }
      ]
    };
  });

  assert.strictEqual(getPrNumber('mission/task-101', 'token', { apiCall }), 101, 'Should match by label suffix');
  assert.strictEqual(getPrNumber('mission/task-102', 'token', { apiCall }), 102, 'Should match by ref');
});

test('getPrNumber pagination and sorting', (t) => {
  const calls: string[] = [];
  const apiCall = forgejoApiFixture((method, apiPath) => {
    calls.push(apiPath);
    return { ok: true as const, data: [] };
  });

  getPrNumber('any', 'token', { apiCall });

  // TASK-2561: the direct base/head lookup comes first; this one answers with
  // no PR number, so the page scans still run in their original order.
  const scans = calls.filter(call => call.startsWith('/pulls?'));
  assert.ok(!calls[0].startsWith('/pulls?'), 'Should ask for the branch by base and head first');
  assert.ok(scans[0].includes('state=open'), 'Should check open PRs first');
  assert.ok(scans[0].includes('sort=recentupdate'), 'Should use sorting');
  assert.ok(scans[1].includes('state=all'), 'Should check all PRs if open check fails');
});

test('provider observations retain findings, revision, and resolution evidence (TASK-2821)', async () => {
  const since = '2026-10-25T10:00:00Z';
  const decidedAt = '2026-10-25T10:01:00Z';
  const respondedAt = '2026-10-25T10:02:00Z';
  const reviewBody = '## F1: Keep the evidence';
  const resolutionBody = 'Autonomous review disposition: CHANGES_MADE\nFix committed and verified';
  const apiCall = forgejoAsyncApiFixture(async (_method, route) => ({ ok: true as const, data: route.includes('/reviews')
    ? [{ user: { login: 'codex' }, state: 'CHANGES_REQUESTED', submitted_at: decidedAt, body: reviewBody, commit_id: 'reviewed-head' }]
    : [{ user: { login: 'custom' }, created_at: respondedAt, body: resolutionBody }] }));
  const review = providerReviewChanges(await getLatestReviewForPr(7, 'codex', since, 'fixture-token', { apiCall }));
  assert.equal(review?.disposition, 'REQUEST_CHANGES');
  assert.equal(review?.decidedAt, decidedAt);
  assert.equal(review?.revision, 'reviewed-head');
  assert.equal(review?.findings[0].summary, 'Keep the evidence');
  assert.equal(review?.comment, reviewBody);
  const response = providerResolution(await getLatestDispositionEvidenceForPr(7, 'custom', since, 'fixture-token', { apiCall }));
  assert.equal(response?.respondedAt, respondedAt);
  assert.equal(response?.evidence, resolutionBody);
  assert.equal(await getLatestDispositionForPr(7, 'custom', since, 'fixture-token', { apiCall }), 'CHANGES_MADE');
});
