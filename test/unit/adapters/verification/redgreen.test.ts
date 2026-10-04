import test from 'node:test';
import assert from 'node:assert/strict';
import * as rg from '../../../../src/adapters/verification/redgreen.js';

const noopLog = () => {};

// ---------- findReproTestPath ----------

test('findReproTestPath uses the recorded Mission test path', () => {
  assert.equal(rg.findReproTestPath('task-123', '/repo', { testPath: 'test/task-123.repro.test.ts' }), 'test/task-123.repro.test.ts');
});

test('findReproTestPath ignores legacy document lookup hooks', () => {
  assert.equal(rg.findReproTestPath('task-9', '/repo', {
    testPath: 'test/recorded.repro.ts',
    findMissionDirFn: () => { throw new Error('legacy lookup'); },
  } as any), 'test/recorded.repro.ts');
});

test('findReproTestPath returns null when no path is recorded', () => {
  assert.equal(rg.findReproTestPath('task-1', '/repo'), null);
});

test('findReproTestPath does not require a mission directory', () => {
  assert.equal(rg.findReproTestPath('task-nope', '/nope', { testPath: 'test/repro.ts' }), 'test/repro.ts');
});

// ---------- resolveMissionParentCommit ----------

test('resolveMissionParentCommit returns the merge-base sha', () => {
  const sha = rg.resolveMissionParentCommit('task-1', '/repo', {
    branch: 'mission/task-1',
    gitFn: (args) => {
      const joined = (args || []).join(' ');
      if (joined.includes('merge-base')) {return { status: 0, stdout: 'abc123def\n' };}
      // getPrimaryBranch needs 'main' present as a detectable primary branch.
      if (joined.includes('branch')) {return { status: 0, stdout: 'main\n' };}
      return { status: 0, stdout: '' };
    },
  });
  assert.equal(sha, 'abc123def');
});

test('resolveMissionParentCommit returns null on a non-zero merge-base', () => {
  assert.equal(rg.resolveMissionParentCommit('task-1', '/repo', {
    gitFn: () => ({ status: 1, stdout: '' }),
  }), null);
});

test('resolveMissionParentCommit returns null when the base branch cannot be resolved', () => {
  assert.equal(rg.resolveMissionParentCommit('task-1', '/repo', {
    gitFn: () => { throw new Error('no base'); },
  }), null);
});

// ---------- verifyRedGreenProof branch coverage ----------

test('verifyRedGreenProof fails when no repro test is declared', () => {
  const res = rg.verifyRedGreenProof('task-1', { rootDir: '/repo', 
    log: noopLog,
    findReproTestPathFn: () => null,
    resolveMissionParentCommitFn: () => 'parent-sha',
    runReproAtRefFn: () => ({ status: 1 }),
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'repro-not-declared');
});

test('verifyRedGreenProof fails when the parent commit cannot be resolved', () => {
  const res = rg.verifyRedGreenProof('task-1', { rootDir: '/repo', 
    log: noopLog,
    findReproTestPathFn: () => 'test/x.repro.ts',
    resolveMissionParentCommitFn: () => null,
    runReproAtRefFn: () => ({ status: 1 }),
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'parent-unresolved');
});

test('verifyRedGreenProof reports not-red when the repro passes at the parent commit', () => {
  const res = rg.verifyRedGreenProof('task-1', { rootDir: '/repo', 
    log: noopLog,
    findReproTestPathFn: () => 'test/x.repro.ts',
    resolveMissionParentCommitFn: () => 'parent-sha',
    runReproAtRefFn: (ref) => ({ status: ref === 'parent-sha' ? 0 : 1 }),
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'not-red');
});

test('verifyRedGreenProof reports not-green when the repro fails at HEAD', () => {
  const res = rg.verifyRedGreenProof('task-1', { rootDir: '/repo', 
    log: noopLog,
    findReproTestPathFn: () => 'test/x.repro.ts',
    resolveMissionParentCommitFn: () => 'parent-sha',
    runReproAtRefFn: () => ({ status: 1 }),
  });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'not-green');
});

test('verifyRedGreenProof skips when no test runner is available for the red step', () => {
  const res = rg.verifyRedGreenProof('task-1', { rootDir: '/repo', 
    log: noopLog,
    findReproTestPathFn: () => 'test/x.repro.ts',
    resolveMissionParentCommitFn: () => 'parent-sha',
    runReproAtRefFn: () => ({ status: null, skipped: true, reason: 'no-test-runner' }),
  });
  assert.equal(res.ok, true);
  assert.equal(res.skipped, true);
});

test('verifyRedGreenProof verifies red-then-green', () => {
  const seen = [];
  const res = rg.verifyRedGreenProof('task-1', { rootDir: '/repo', 
    log: noopLog,
    findReproTestPathFn: () => 'test/x.repro.ts',
    resolveMissionParentCommitFn: () => 'parent-sha',
    runReproAtRefFn: (ref) => { seen.push(ref); return { status: ref === 'parent-sha' ? 1 : 0 }; },
  });
  assert.equal(res.ok, true);
  assert.equal(res.skipped, false);
  assert.equal(res.reason, 'red-green-verified');
  assert.deepEqual(seen, ['parent-sha', 'HEAD']);
});
