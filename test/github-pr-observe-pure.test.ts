// Pure branch coverage for `observeGithubPr`. Deliberately NO mock.module:
// read()/treesMatch() are injected doubles so every classification branch runs
// under the plain node --test runner (which lacks --experimental-test-module-mocks).
import test from 'node:test';
import assert from 'node:assert/strict';
import { observeGithubPr } from '../src/adapters/github/github-pr.js';
import type { ExpectedGithubPr } from '../src/adapters/github/github-pr.js';

function expected(overrides: Partial<ExpectedGithubPr> = {}): ExpectedGithubPr {
  return {
    head: 'mission-branch',
    base: 'main',
    candidateSha: 'candidate-sha',
    ...overrides,
  };
}

test('pending: not merged, no mergedAt, open state', () => {
  const obs = observeGithubPr(expected(), () => ({
    number: 7, state: 'OPEN', merged: false, head: { ref: 'x', sha: 'h' }, base: { ref: 'main' },
  }), () => true);
  assert.deepEqual(obs, { kind: 'pending', number: 7, base: 'main' });
});

test('closed-unmerged: CLOSED without mergedAt closes as closed-unmerged', () => {
  const obs = observeGithubPr(expected(), () => ({
    number: 8, state: 'CLOSED', merged: false, head: { ref: 'x', sha: 'h' }, base: { ref: 'main' },
  }), () => true);
  assert.deepEqual(obs, { kind: 'closed-unmerged', number: 8, base: 'main' });
});

test('target-changed: base ref diverges from expected', () => {
  const obs = observeGithubPr(expected(), () => ({
    number: 9, state: 'OPEN', merged: false, head: { ref: 'x', sha: 'h' }, base: { ref: 'develop' },
  }), () => true);
  assert.deepEqual(obs, { kind: 'target-changed', expected: 'main', actual: 'develop' });
});

test('merged via merge_commit_sha when trees match', () => {
  const obs = observeGithubPr(expected({ candidateSha: 'resulting-sha' }), () => ({
    number: 10, state: 'CLOSED', merged: true, mergedAt: '2024-01-01T00:00:00Z', merge_commit_sha: 'resulting-sha',
    head: { ref: 'x', sha: 'h' }, base: { ref: 'main' },
  }), (c, r) => c === r && r === 'resulting-sha');
  assert.deepEqual(obs, { kind: 'merged', number: 10, base: 'main', resultingSha: 'resulting-sha' });
});

test('merged falls back to mergeCommit.oid when merge_commit_sha absent', () => {
  const obs = observeGithubPr(expected(), () => ({
    number: 11, state: 'CLOSED', merged: true, mergedAt: '2024-01-01T00:00:00Z', merge_commit_sha: undefined,
    mergeCommit: { oid: 'oid-sha' }, head: { ref: 'x', sha: 'h' }, base: { ref: 'main' },
  }), (c, r) => r === 'oid-sha');
  assert.deepEqual(obs, { kind: 'merged', number: 11, base: 'main', resultingSha: 'oid-sha' });
});

test('merged falls back to head.sha when no merge metadata present', () => {
  const obs = observeGithubPr(expected(), () => ({
    number: 12, state: 'CLOSED', merged: true, mergedAt: '2024-01-01T00:00:00Z',
    head: { ref: 'x', sha: 'head-sha' }, base: { ref: 'main' },
  }), (c, r) => r === 'head-sha');
  assert.deepEqual(obs, { kind: 'merged', number: 12, base: 'main', resultingSha: 'head-sha' });
});

test('unexpected-tree: resulting sha exists but trees diverge', () => {
  const obs = observeGithubPr(expected(), () => ({
    number: 13, state: 'CLOSED', merged: true, mergedAt: '2024-01-01T00:00:00Z', merge_commit_sha: 'other-sha',
    head: { ref: 'x', sha: 'h' }, base: { ref: 'main' },
  }), () => false);
  assert.deepEqual(obs, { kind: 'unexpected-tree', number: 13, base: 'main' });
});

test('unexpected-tree: resulting sha is falsy', () => {
  const obs = observeGithubPr(expected(), () => ({
    number: 14, state: 'CLOSED', merged: true, mergedAt: '2024-01-01T00:00:00Z', merge_commit_sha: '',
    head: { ref: 'x', sha: '' }, base: { ref: 'main' },
  }), () => true);
  assert.deepEqual(obs, { kind: 'unexpected-tree', number: 14, base: 'main' });
});

test('unavailable: read() throwing is caught and reported', () => {
  const obs = observeGithubPr(expected(), () => { throw new Error('gh failed'); }, () => true);
  assert.deepEqual(obs, { kind: 'unavailable', error: 'gh failed' });
});

test('unavailable: non-Error throw is stringified', () => {
  const obs = observeGithubPr(expected(), () => { throw 'plain-string-error'; }, () => true);
  assert.deepEqual(obs, { kind: 'unavailable', error: 'plain-string-error' });
});

test('mergedAt truthy alone treats the PR as merged', () => {
  const obs = observeGithubPr(expected(), () => ({
    number: 15, state: 'OPEN', merged: false, mergedAt: '2024-01-01T00:00:00Z', merge_commit_sha: 's',
    head: { ref: 'x', sha: 'h' }, base: { ref: 'main' },
  }), (c, r) => r === 's');
  assert.equal(obs.kind, 'merged');
});
