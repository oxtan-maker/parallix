import test from 'node:test';
import assert from 'node:assert/strict';
import { observeGithubPr, type GithubPr } from '../src/adapters/github/github-pr.js';

const expected = { number: 7, head: 'mission/task-2500.03', base: 'main', candidateSha: 'candidate' };
const open = { number: 7, state: 'OPEN', merged: false, head: { ref: expected.head, sha: 'candidate' }, base: { ref: 'main' } };

function observe(pr: GithubPr, treeMatches = true) {
  return observeGithubPr(expected, () => pr, () => treeMatches);
}

test('direct-to-main GitHub PR is accepted as the expected target', () => {
  assert.equal(observe(open).kind, 'pending');
});

test('developer feature branch is accepted as the GitHub PR target', () => {
  const result = observeGithubPr({ ...expected, base: 'feature/payment-rewrite' }, () => ({ ...open, base: { ref: 'feature/payment-rewrite' } }), () => true);
  assert.equal(result.kind, 'pending');
});

test('pending GitHub PR remains incomplete after local review and gates', () => {
  assert.deepEqual(observe(open), { kind: 'pending', number: 7, base: 'main' });
});

test('successful externally owned GitHub merge supplies completion evidence', () => {
  assert.deepEqual(observe({ ...open, state: 'CLOSED', merged: true, merge_commit_sha: 'github-merge' }), { kind: 'merged', number: 7, base: 'main', resultingSha: 'github-merge' });
});

test('closed unmerged GitHub PR reports recoverable state', () => {
  assert.deepEqual(observe({ ...open, state: 'CLOSED', merged: false }), { kind: 'closed-unmerged', number: 7, base: 'main' });
});

test('GitHub squash or rebase merge accepts a different SHA only with matching tree evidence', () => {
  const squash = { ...open, state: 'CLOSED', merged: true, head: { ...open.head, sha: 'squashed' } };
  assert.deepEqual(observe(squash, true), { kind: 'merged', number: 7, base: 'main', resultingSha: 'squashed' });
  assert.equal(observe(squash, false).kind, 'unexpected-tree');
});

test('GitHub target branch changes report recoverable state', () => {
  assert.deepEqual(observe({ ...open, base: { ref: 'other-target' } }), { kind: 'target-changed', expected: 'main', actual: 'other-target' });
});

test('unavailable GitHub and local refs cannot produce merge evidence', () => {
  assert.deepEqual(observeGithubPr(expected, () => { throw new Error('network unavailable'); }, () => true), { kind: 'unavailable', error: 'network unavailable' });
});
