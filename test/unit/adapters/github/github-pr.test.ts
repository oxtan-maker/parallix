// github pr.
// Related scenarios share imports; each contract keeps its own hooks and mutable fixtures.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import * as ghpr from '../../../../src/adapters/github/github-pr.js';
import { observeGithubPr, type ExpectedGithubPr, type GithubPr } from '../../../../src/adapters/github/github-pr.js';

// Regression provenance: TASK-2622.08.
describe("github pr", { concurrency: false }, () => {
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
});

// Regression provenance: TASK-2622.08.
describe("github pr observe pure", { concurrency: false }, () => {
  // Provider classifications use request-injected read and tree-comparison doubles.

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
});

// Regression provenance: TASK-2622.08.
describe("github pr integration", { concurrency: false }, () => {
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
});
