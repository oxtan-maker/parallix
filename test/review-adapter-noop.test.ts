import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getReviewProvider,
  isEnabled,
  isProviderEnabled,
  isNoop,
  isForgejoProvider,
  resolveArtifactDir,
  getPrStatus,
  readToken,
  getLatestReviewForPr,
  postComment,
  postReview,
  createPr,
  forgejoAvailable,
  providerAvailable,
  getComments,
  closePr,
  getPrAuthor,
  resolveForgejoUser,
  resolveReviewUser,
} from '../src/adapters/review/review-adapter.js';

// Forgejo is disabled when adapters.review.provider is null (empty config), so
// every guarded review entry point returns its noop value without touching the
// network. These exercises the disabled-provider surface hermetically.
async function withDisabledReview(run: (rootDir: string) => void | Promise<void>): Promise<void> {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-noop-'));
  fs.writeFileSync(path.join(rootDir, 'workflow.config.json'), '{}\n');
  try { await run(rootDir); } finally { fs.rmSync(rootDir, { recursive: true, force: true }); }
}

test('a disabled review provider reports noop across the provider queries', () => {
  withDisabledReview(rootDir => {
    assert.equal(getReviewProvider(rootDir), null);
    assert.equal(isEnabled(rootDir), false);
    assert.equal(isProviderEnabled(rootDir), false);
    assert.equal(isNoop(rootDir), true);
    assert.equal(isForgejoProvider(rootDir), false);
  });
});

test('resolveArtifactDir falls back to the OS temp dir when no review tmpDir is configured', () => {
  withDisabledReview(rootDir => {
    assert.equal(resolveArtifactDir(rootDir), os.tmpdir());
  });
});

test('guarded review entry points return their noop values when forgejo is disabled', async () => {
  await withDisabledReview(async rootDir => {
    assert.deepEqual(getPrStatus('mission/task-1', rootDir), { exists: false, raw: 'Forgejo PR: skipped (review provider is not forgejo).' });
    assert.equal(readToken('claude', { rootDir }), null);
    assert.deepEqual(await getComments('mission/task-1', 'token', { rootDir }), []);
    assert.deepEqual(closePr('mission/task-1', 'token', 'claude', { rootDir }), { ok: true, skipped: true, reason: 'review-provider-disabled' });
    assert.deepEqual(createPr('mission/task-1', 'claude', 'token', { rootDir }), { ok: true, skipped: true, url: null });
    // token-gated entry points short-circuit before the forgejo seam.
    assert.equal(await getLatestReviewForPr(7, 'claude', '2026-01-01', '', { rootDir }), null);
    assert.deepEqual(await postComment('mission/task-1', 'token', 'body', { rootDir }), { ok: true, skipped: true, reason: 'review-provider-disabled' });
    assert.deepEqual(await postReview('mission/task-1', 'token', 'approved', 'summary', { rootDir }), { ok: true, skipped: true, reason: 'review-provider-disabled' });
    assert.equal(await getPrAuthor('mission/task-1', 'token', { rootDir }), null);
  });
});

test('forgejoAvailable and providerAvailable are false when the provider is disabled', async () => {
  await withDisabledReview(rootDir => {
    assert.equal(forgejoAvailable('http://localhost:3300', { rootDir }), false);
    assert.equal(providerAvailable('http://localhost:3300', { rootDir }), false);
  });
});

test('resolveForgejoUser and resolveReviewUser fall back to env then null', () => {
  const saved = process.env.FORGEJO_USER;
  delete process.env.FORGEJO_USER;
  try {
    assert.equal(resolveForgejoUser('reviewer'), 'reviewer');
    assert.equal(resolveReviewUser('reviewer'), 'reviewer');
    process.env.FORGEJO_USER = 'env-reviewer';
    assert.equal(resolveForgejoUser(''), 'env-reviewer');
    assert.equal(resolveReviewUser(''), 'env-reviewer');
    assert.equal(resolveForgejoUser(''), 'env-reviewer');
  } finally {
    if (saved === undefined) { delete process.env.FORGEJO_USER; } else { process.env.FORGEJO_USER = saved; }
  }
});
