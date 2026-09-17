import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as rg from '../src/adapters/verification/redgreen.js';

function tempDir(prefix = 'redgreen-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function cleanup(dir) { fs.rmSync(dir, { recursive: true, force: true }); }

const noopLog = () => {};

// ---------- findReproTestPath ----------

test('findReproTestPath reads the marker from MISSION.md', () => {
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, 'MISSION.md'), '# Mission\n\nReproduction-Test: test/task-123.repro.test.ts\n');
    const found = rg.findReproTestPath('task-123', dir, {
      findMissionDirFn: () => dir,
      findCheckpointsFn: () => [],
    });
    assert.equal(found, 'test/task-123.repro.test.ts');
  } finally { cleanup(dir); }
});

test('findReproTestPath reads the marker from a checkpoint document', () => {
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, 'CP-2.md'), '# Checkpoint 2\nReproduction-Test: test/cp.repro.ts\n');
    const found = rg.findReproTestPath('task-9', dir, {
      findMissionDirFn: () => dir,
      findCheckpointsFn: () => [path.join(dir, 'CP-2.md')],
    });
    assert.equal(found, 'test/cp.repro.ts');
  } finally { cleanup(dir); }
});

test('findReproTestPath returns null when no marker exists', () => {
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, 'MISSION.md'), '# Mission\nNo marker here.\n');
    assert.equal(rg.findReproTestPath('task-1', dir, {
      findMissionDirFn: () => dir,
      findCheckpointsFn: () => [],
    }), null);
  } finally { cleanup(dir); }
});

test('findReproTestPath returns null when the mission dir is missing', () => {
  assert.equal(rg.findReproTestPath('task-nope', '/nope', {
    findMissionDirFn: () => null,
    findCheckpointsFn: () => [],
  }), null);
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
