const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const redgreen = require('../lib/tools/redgreen');

function withTempRoot(run) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'redgreen-test-'));
  try {
    run(tmpRoot);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

// ---------- findReproTestPath ----------

test('findReproTestPath reads Reproduction-Test marker from MISSION.md', () => {
  withTempRoot(rootDir => {
    const missionDir = path.join(rootDir, 'missions', 'task-rg-001');
    fs.mkdirSync(missionDir, { recursive: true });
    fs.writeFileSync(
      path.join(missionDir, 'MISSION.md'),
      '# Mission\n\nReproduction-Test: test/task-rg-001-repro.test.js\n'
    );

    const result = redgreen.findReproTestPath('task-rg-001', rootDir, {
      findMissionDirFn: () => missionDir,
      findCheckpointsFn: () => []
    });
    assert.strictEqual(result, 'test/task-rg-001-repro.test.js');
  });
});

test('findReproTestPath falls back to checkpoint documents', () => {
  withTempRoot(rootDir => {
    const missionDir = path.join(rootDir, 'missions', 'task-rg-002');
    fs.mkdirSync(missionDir, { recursive: true });
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission\n\nNo marker here.\n');
    const cp = path.join(missionDir, 'CP-1.md');
    fs.writeFileSync(cp, '# CP-1\n\nReproduction-Test:   test/cp-declared.test.js  \n');

    const result = redgreen.findReproTestPath('task-rg-002', rootDir, {
      findMissionDirFn: () => missionDir,
      findCheckpointsFn: () => [cp]
    });
    assert.strictEqual(result, 'test/cp-declared.test.js');
  });
});

test('findReproTestPath returns null when no marker is declared', () => {
  withTempRoot(rootDir => {
    const missionDir = path.join(rootDir, 'missions', 'task-rg-003');
    fs.mkdirSync(missionDir, { recursive: true });
    fs.writeFileSync(path.join(missionDir, 'MISSION.md'), '# Mission\n\nNothing.\n');

    const result = redgreen.findReproTestPath('task-rg-003', rootDir, {
      findMissionDirFn: () => missionDir,
      findCheckpointsFn: () => []
    });
    assert.strictEqual(result, null);
  });
});

// ---------- verifyRedGreenProof ----------

const RG_SILENT = { log: () => {} };

test('verifyRedGreenProof fails when repro is not declared', () => {
  const result = redgreen.verifyRedGreenProof('task-rg-100', {
    ...RG_SILENT,
    findReproTestPathFn: () => null
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.skipped, false);
  assert.strictEqual(result.reason, 'repro-not-declared');
  assert.ok(/Reproduction-Test/.test(result.error));
});

test('verifyRedGreenProof passes when repro is red at parent and green at HEAD', () => {
  const result = redgreen.verifyRedGreenProof('task-rg-101', {
    ...RG_SILENT,
    findReproTestPathFn: () => 'test/repro.test.js',
    resolveMissionParentCommitFn: () => 'parentsha0001',
    runReproAtRefFn: (ref) => ({ status: ref === 'parentsha0001' ? 1 : 0 })
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.skipped, false);
  assert.strictEqual(result.reason, 'red-green-verified');
  assert.strictEqual(result.testPath, 'test/repro.test.js');
});

test('verifyRedGreenProof blocks when repro PASSES at the parent commit (not red)', () => {
  const result = redgreen.verifyRedGreenProof('task-rg-103', {
    ...RG_SILENT,
    findReproTestPathFn: () => 'test/repro.test.js',
    resolveMissionParentCommitFn: () => 'parentsha0001',
    runReproAtRefFn: () => ({ status: 0 })
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'not-red');
});

test('verifyRedGreenProof blocks when repro FAILS at HEAD (not green)', () => {
  const result = redgreen.verifyRedGreenProof('task-rg-104', {
    ...RG_SILENT,
    findReproTestPathFn: () => 'test/repro.test.js',
    resolveMissionParentCommitFn: () => 'parentsha0001',
    runReproAtRefFn: () => ({ status: 1 })
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'not-green');
});

test('verifyRedGreenProof skips when no usable test runner is available', () => {
  const result = redgreen.verifyRedGreenProof('task-rg-105', {
    ...RG_SILENT,
    findReproTestPathFn: () => 'test/repro.test.js',
    resolveMissionParentCommitFn: () => 'parentsha0001',
    runReproAtRefFn: () => ({ status: null, skipped: true, reason: 'worktree-add-failed' })
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.reason, 'worktree-add-failed');
});

test('verifyRedGreenProof blocks when the parent commit cannot be resolved', () => {
  const result = redgreen.verifyRedGreenProof('task-rg-106', {
    ...RG_SILENT,
    findReproTestPathFn: () => 'test/repro.test.js',
    resolveMissionParentCommitFn: () => null,
    runReproAtRefFn: () => { throw new Error('should not be called'); }
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, 'parent-unresolved');
});
