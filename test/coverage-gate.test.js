const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const GATE_SCRIPT = path.join(__dirname, '..', 'lib', 'commands', 'coverage-gate.js');
const REPO_ROOT = path.join(__dirname, '..');
const {
  buildCoverageArgs,
  cleanupNewTempDirs,
  cleanupPerRunScratch,
  COVERAGE_EXCLUDES,
  COVERAGE_INCLUDES,
  createPerRunScratchDirs,
  DEFAULT_TEST_TIMEOUT_MS,
  discoverTestFiles,
  listTempEntries,
  registerExitHandlers,
  resetPerRunScratchState,
  resolveTestTimeoutMs,
  runTests
} = require('../lib/commands/coverage-gate');

function runGate(args = []) {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-gate-run-'));
  try {
    return spawnSync(process.execPath, [GATE_SCRIPT, ...args], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      env: { ...process.env, NODE_V8_COVERAGE: '', COVERAGE_GATE_RUN: '1', TMPDIR: tmpRoot },
      timeout: 360000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

test('coverage-gate dry-run exits 0 and lists files', () => {
  const result = runGate(['--dry-run']);
  assert.equal(result.status, 0, `dry-run should exit 0, got: ${result.stderr}`);
  assert.match(result.stdout, /DRY-RUN mode/);
  assert.match(result.stdout, /Found \d+ test file/);
});

test('coverage-gate excludes its own test file from authoritative discovery', () => {
  const testFiles = discoverTestFiles();
  const basenames = testFiles.map(file => path.basename(file));
  assert.ok(!basenames.includes('coverage-gate.test.js'));
});

test('coverage-gate reports denominator and metric in output', () => {
  const result = runGate(['--dry-run']);
  assert.match(result.stdout, /Denominator: index\.js/);
  assert.match(result.stdout, /Include globs:/);
});

test('coverage-gate shows per-file breakdown', () => {
  const result = runGate(['--dry-run']);
  assert.match(result.stdout, /--test-coverage-lines=90/);
  assert.match(result.stdout, /--test-coverage-exclude test\/\*\*/);
});

test('cleanupNewTempDirs removes only newly created matching directories', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-gate-cleanup-'));
  try {
    const preexisting = 'visualBoard-task-existing';
    const newMatching = 'visualBoard-task-new';
    const newNonMatching = 'keep-me';

    fs.mkdirSync(path.join(tmpRoot, preexisting));
    const beforeEntries = listTempEntries(tmpRoot);
    fs.mkdirSync(path.join(tmpRoot, newMatching));
    fs.mkdirSync(path.join(tmpRoot, newNonMatching));

    cleanupNewTempDirs(beforeEntries, tmpRoot);

    assert.equal(fs.existsSync(path.join(tmpRoot, preexisting)), true);
    assert.equal(fs.existsSync(path.join(tmpRoot, newMatching)), false);
    assert.equal(fs.existsSync(path.join(tmpRoot, newNonMatching)), true);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('cleanupNewTempDirs does not remove active runtime-matrix launcher dirs', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-gate-runtime-cleanup-'));
  try {
    const beforeEntries = listTempEntries(tmpRoot);
    const launcherDir = 'runtime-matrix-launcher-active';
    fs.mkdirSync(path.join(tmpRoot, launcherDir));

    cleanupNewTempDirs(beforeEntries, tmpRoot);

    assert.equal(fs.existsSync(path.join(tmpRoot, launcherDir)), true);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test('runTests returns 1 when spawn fails with error', () => {
  const mockSpawn = () => ({ error: new Error('ENOENT'), signal: null, status: null });
  const exitCode = runTests(['/tmp/fake.test.js'], 90, mockSpawn);
  assert.equal(exitCode, 1);
});

test('runTests returns 1 when child process is killed by signal', () => {
  const mockSpawn = () => ({ error: null, signal: 'SIGKILL', status: null });
  const exitCode = runTests(['/tmp/fake.test.js'], 90, mockSpawn);
  assert.equal(exitCode, 1);
});

test('runTests returns 1 when status is null and no error or signal', () => {
  const mockSpawn = () => ({ error: null, signal: null, status: null });
  const exitCode = runTests(['/tmp/fake.test.js'], 90, mockSpawn);
  assert.equal(exitCode, 1);
});

test('runTests returns subprocess exit code on normal exit', () => {
  const mockSpawn = () => ({ error: null, signal: null, status: 0 });
  const exitCode = runTests(['/tmp/fake.test.js'], 90, mockSpawn);
  assert.equal(exitCode, 0);
});

test('runTests returns non-zero subprocess exit code on test failure', () => {
  const mockSpawn = () => ({ error: null, signal: null, status: 1 });
  const exitCode = runTests(['/tmp/fake.test.js'], 90, mockSpawn);
  assert.equal(exitCode, 1);
});

test('buildCoverageArgs includes runtime globs and excludes test files', () => {
  const args = buildCoverageArgs(['/tmp/a.test.js'], 90, true);
  assert.ok(args.includes('--experimental-test-coverage'));
  assert.ok(args.includes('--test-coverage-lines=90'));
  for (const pattern of COVERAGE_INCLUDES) {
    assert.ok(args.includes(pattern));
  }
  for (const pattern of COVERAGE_EXCLUDES) {
    assert.ok(args.includes(pattern));
  }
  assert.ok(args.includes('/tmp/a.test.js'));
  assert.ok(
    args.includes(`--test-reporter-destination=${path.join(REPO_ROOT, 'coverage', 'lcov.info')}`),
    'lcov output should be rooted under parallix/coverage'
  );
});

test('resolveTestTimeoutMs uses default and valid env override', () => {
  assert.equal(resolveTestTimeoutMs({}), DEFAULT_TEST_TIMEOUT_MS);
  assert.equal(resolveTestTimeoutMs({ WORKFLOW_COVERAGE_GATE_TIMEOUT_MS: '12345' }), 12345);
  assert.equal(resolveTestTimeoutMs({ WORKFLOW_COVERAGE_GATE_TIMEOUT_MS: 'not-a-number' }), DEFAULT_TEST_TIMEOUT_MS);
});

test('createPerRunScratchDirs creates a node-coverage-* dir and records it', () => {
  resetPerRunScratchState();
  const dir = createPerRunScratchDirs();
  assert.ok(dir.startsWith(path.join(os.tmpdir(), 'node-coverage-')), `dir ${dir} should start with node-coverage- prefix`);
  assert.ok(fs.existsSync(dir), `dir ${dir} should exist`);
  assert.ok(dir.match(/node-coverage-[a-zA-Z0-9]{6}/), `dir ${dir} should have mkdtemp-style suffix`);
});

test('cleanupPerRunScratch removes only tracked dirs', () => {
  resetPerRunScratchState();
  const dir = createPerRunScratchDirs();
  assert.ok(fs.existsSync(dir), 'tracked dir should exist before cleanup');
  cleanupPerRunScratch();
  assert.equal(fs.existsSync(dir), false, `tracked dir ${dir} should be removed after cleanup`);
  // Verify second call is no-op (cleanupDone flag)
  assert.doesNotThrow(() => cleanupPerRunScratch(), 'second call should not throw');
});

test('cleanupPerRunScratch is idempotent', () => {
  resetPerRunScratchState();
  const dir = createPerRunScratchDirs();
  assert.ok(fs.existsSync(dir), 'dir should exist before cleanup');
  cleanupPerRunScratch();
  assert.equal(fs.existsSync(dir), false, 'dir should be removed on first call');
  assert.doesNotThrow(() => cleanupPerRunScratch(), 'second call should not throw');
});

test('runTests sets NODE_V8_COVERAGE to the created dir', () => {
  let capturedOptions = null;
  const mockSpawn = (_execPath, _args, options) => {
    capturedOptions = options;
    return { error: null, signal: null, status: 0 };
  };
  const exitCode = runTests(['/tmp/fake.test.js'], 90, mockSpawn);
  assert.equal(exitCode, 0);
  assert.ok(capturedOptions, 'spawnSync should have been called with options');
  assert.ok(capturedOptions.env.NODE_V8_COVERAGE, 'NODE_V8_COVERAGE should be set in child env');
  assert.ok(capturedOptions.env.NODE_V8_COVERAGE.startsWith(path.join(os.tmpdir(), 'node-coverage-')),
    `NODE_V8_COVERAGE ${capturedOptions.env.NODE_V8_COVERAGE} should start with node-coverage- prefix`);
  assert.ok(capturedOptions.env.GRAPHIFY_BIN, 'GRAPHIFY_BIN should be set to a mock in child env');
  assert.ok(capturedOptions.env.GRAPHIFY_BIN.startsWith(path.join(os.tmpdir(), 'graphify-')),
    `GRAPHIFY_BIN ${capturedOptions.env.GRAPHIFY_BIN} should start with graphify- prefix`);
});
