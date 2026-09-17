import test from 'node:test';
import assert from 'node:assert/strict';
import * as ghpr from '../src/adapters/github/github-pr.js';

const baseExpected = {
  head: 'mission/demo-slug',
  base: 'main',
  candidateSha: 'candidate-tree-sha',
};

test('observeGithubPr reports target-changed when the base ref differs', () => {
  const obs = ghpr.observeGithubPr(
    baseExpected,
    () => ({ number: 7, state: 'OPEN', merged: false, mergedAt: null, head: { ref: 'h', sha: 'x' }, base: { ref: 'develop' } }),
    () => true,
  );
  assert.equal(obs.kind, 'target-changed');
  if (obs.kind === 'target-changed') {
    assert.equal(obs.expected, 'main');
    assert.equal(obs.actual, 'develop');
  }
});

test('observeGithubPr reports pending for an open, unmerged PR', () => {
  const obs = ghpr.observeGithubPr(
    baseExpected,
    () => ({ number: 7, state: 'OPEN', merged: false, mergedAt: null, head: { ref: 'h', sha: 'x' }, base: { ref: 'main' } }),
    () => true,
  );
  assert.deepEqual(obs, { kind: 'pending', number: 7, base: 'main' });
});

test('observeGithubPr reports closed-unmerged for a closed PR with no merge', () => {
  const obs = ghpr.observeGithubPr(
    baseExpected,
    () => ({ number: 8, state: 'CLOSED', merged: false, mergedAt: null, head: { ref: 'h', sha: 'x' }, base: { ref: 'main' } }),
    () => true,
  );
  assert.deepEqual(obs, { kind: 'closed-unmerged', number: 8, base: 'main' });
});

test('observeGithubPr treats a populated mergedAt as a merge attempt (not pending)', () => {
  const obs = ghpr.observeGithubPr(
    baseExpected,
    () => ({ number: 9, state: 'OPEN', merged: false, mergedAt: '2026-01-01T00:00:00Z', head: { ref: 'h', sha: 'candidate-tree-sha' }, base: { ref: 'main' } }),
    (candidate, resulting) => candidate === resulting,
  );
  assert.notEqual(obs.kind, 'pending', 'a populated mergedAt is not a pending PR');
  assert.equal(obs.kind, 'merged');
});

test('observeGithubPr reports unexpected-tree when the resulting tree does not match', () => {
  const obs = ghpr.observeGithubPr(
    baseExpected,
    () => ({ number: 10, state: 'MERGED', merged: true, mergedAt: '2026-01-01T00:00:00Z', merge_commit_sha: 'other-sha', head: { ref: 'h', sha: 'x' }, base: { ref: 'main' } }),
    (candidate, resulting) => candidate === resulting,
  );
  assert.equal(obs.kind, 'unexpected-tree');
  if (obs.kind === 'unexpected-tree') {
    assert.equal(obs.number, 10);
  }
});

test('observeGithubPr reports merged when the resulting tree matches', () => {
  const obs = ghpr.observeGithubPr(
    baseExpected,
    () => ({ number: 11, state: 'MERGED', merged: true, mergedAt: '2026-01-01T00:00:00Z', merge_commit_sha: 'candidate-tree-sha', head: { ref: 'h', sha: 'x' }, base: { ref: 'main' } }),
    (candidate, resulting) => candidate === resulting,
  );
  assert.equal(obs.kind, 'merged');
  if (obs.kind === 'merged') {
    assert.equal(obs.resultingSha, 'candidate-tree-sha');
  }
});

test('observeGithubPr falls back to mergeCommit.oid when merge_commit_sha is absent', () => {
  const obs = ghpr.observeGithubPr(
    baseExpected,
    () => ({ number: 12, state: 'MERGED', merged: true, mergedAt: '2026-01-01T00:00:00Z', merge_commit_sha: null, mergeCommit: { oid: 'candidate-tree-sha' }, head: { ref: 'h', sha: 'x' }, base: { ref: 'main' } }),
    (candidate, resulting) => candidate === resulting,
  );
  assert.equal(obs.kind, 'merged');
});

test('observeGithubPr falls back to head.sha when no merge sha fields exist', () => {
  const obs = ghpr.observeGithubPr(
    baseExpected,
    () => ({ number: 13, state: 'MERGED', merged: true, mergedAt: '2026-01-01T00:00:00Z', head: { ref: 'h', sha: 'candidate-tree-sha' }, base: { ref: 'main' } }),
    (candidate, resulting) => candidate === resulting,
  );
  assert.equal(obs.kind, 'merged');
});

test('observeGithubPr reports unavailable when the read throws', () => {
  const obs = ghpr.observeGithubPr(
    baseExpected,
    () => { throw new Error('gh failed'); },
    () => true,
  );
  assert.equal(obs.kind, 'unavailable');
  if (obs.kind === 'unavailable') {
    assert.equal(obs.error, 'gh failed');
  }
});

test('observeGithubPr normalizes an empty error into a string message', () => {
  const obs = ghpr.observeGithubPr(
    baseExpected,
    () => { throw new Error(); },
    () => true,
  );
  assert.equal(obs.kind, 'unavailable');
});
