// @ts-nocheck -- TASK-2277: preserve legacy CommonJS mock behavior while mock-shape typings are hardened separately.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fmt = require('../dist/lib/core/fmt');

const REPO_ROOT = path.join(__dirname, '..');
const coverageGate = require('../dist/lib/commands/coverage-gate');
const {
  // @ts-expect-error TS2614 Module '"../lib/commands/coverage-gate"' has no exported member 'buildCoverageAr
  buildCoverageArgs,
  // @ts-expect-error TS2614 Module '"../lib/commands/coverage-gate"' has no exported member 'cleanupNewTempD
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
} = require('../dist/lib/commands/coverage-gate');

function runGate(args = []) {
  const logs = [];
  const errors = [];
  let exitCode = null;
  const previousLogger = fmt.setLogger({
    // @ts-expect-error TS2345 Argument of type 'unknown' is not assignable to parameter of type 'string'.
    log: message => logs.push(fmt.stripAnsi(message)),
    // @ts-expect-error TS2345 Argument of type 'unknown' is not assignable to parameter of type 'string'.
    error: message => errors.push(fmt.stripAnsi(message)),
  });
  try {
    // @ts-expect-error TS2349 This expression is not callable.
    coverageGate(args, { exitFn: code => { exitCode = code; } });
    return { status: exitCode, stdout: logs.join('\n'), stderr: errors.join('\n') };
  } finally {
    fmt.setLogger(previousLogger);
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
  assert.ok(!basenames.includes('coverage-gate.test.ts'));
});

test('coverage-gate reports denominator and metric in output', () => {
  const result = runGate(['--dry-run']);
  assert.match(result.stdout, /Denominator: dist\/index\.js/);
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
  // @ts-expect-error TS2345 Argument of type '() => { error: Error; signal: any; status: any; }' is not assi
  const exitCode = runTests(['/tmp/fake.test.js'], 90, mockSpawn);
  assert.equal(exitCode, 1);
});

test('runTests returns 1 when child process is killed by signal', () => {
  const mockSpawn = () => ({ error: null, signal: 'SIGKILL', status: null });
  // @ts-expect-error TS2345 Argument of type '() => { error: any; signal: string; status: any; }' is not ass
  const exitCode = runTests(['/tmp/fake.test.js'], 90, mockSpawn);
  assert.equal(exitCode, 1);
});

test('runTests returns 1 when status is null and no error or signal', () => {
  const mockSpawn = () => ({ error: null, signal: null, status: null });
  // @ts-expect-error TS2345 Argument of type '() => { error: any; signal: any; status: any; }' is not assign
  const exitCode = runTests(['/tmp/fake.test.js'], 90, mockSpawn);
  assert.equal(exitCode, 1);
});

test('runTests returns subprocess exit code on normal exit', () => {
  const mockSpawn = () => ({ error: null, signal: null, status: 0 });
  // @ts-expect-error TS2345 Argument of type '() => { error: any; signal: any; status: number; }' is not ass
  const exitCode = runTests(['/tmp/fake.test.js'], 90, mockSpawn);
  assert.equal(exitCode, 0);
});

test('runTests returns non-zero subprocess exit code on test failure', () => {
  const mockSpawn = () => ({ error: null, signal: null, status: 1 });
  // @ts-expect-error TS2345 Argument of type '() => { error: any; signal: any; status: number; }' is not ass
  const exitCode = runTests(['/tmp/fake.test.js'], 90, mockSpawn);
  assert.equal(exitCode, 1);
});

test('buildCoverageArgs includes runtime globs and excludes test files', () => {
  const args = buildCoverageArgs(['/tmp/a.test.ts'], 90, true);
  assert.deepEqual(args.slice(0, 2), ['--import', 'tsx']);
  assert.ok(args.includes('--experimental-test-coverage'));
  assert.ok(args.includes('--test-coverage-lines=90'));
  for (const pattern of COVERAGE_INCLUDES) {
    assert.ok(args.includes(pattern));
  }
  for (const pattern of COVERAGE_EXCLUDES) {
    assert.ok(args.includes(pattern));
  }
  assert.ok(args.includes('/tmp/a.test.ts'));
  assert.ok(
    args.includes(`--test-reporter-destination=${path.join(REPO_ROOT, 'coverage', 'lcov.info')}`),
    'lcov output should be rooted under parallix/coverage'
  );
});

test('buildCoverageArgs does not load tsx for JavaScript-only test lists', () => {
  const args = buildCoverageArgs(['/tmp/a.test.js'], 90);
  assert.ok(!args.includes('tsx'));
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
  // @ts-expect-error TS2345 Argument of type '(_execPath: any, _args: any, options: any) => { error: any; si
  const exitCode = runTests(['/tmp/fake.test.js'], 90, mockSpawn);
  assert.equal(exitCode, 0);
  assert.ok(capturedOptions, 'spawnSync should have been called with options');
  // @ts-expect-error TS2339 Property 'env' does not exist on type 'never'.
  assert.ok(capturedOptions.env.NODE_V8_COVERAGE, 'NODE_V8_COVERAGE should be set in child env');
  // @ts-expect-error TS2339 Property 'env' does not exist on type 'never'.
  assert.ok(capturedOptions.env.NODE_V8_COVERAGE.startsWith(path.join(os.tmpdir(), 'node-coverage-')),
    // @ts-expect-error TS2339 Property 'env' does not exist on type 'never'.
    `NODE_V8_COVERAGE ${capturedOptions.env.NODE_V8_COVERAGE} should start with node-coverage- prefix`);
  // @ts-expect-error TS2339 Property 'env' does not exist on type 'never'.
  assert.ok(capturedOptions.env.GRAPHIFY_BIN, 'GRAPHIFY_BIN should be set to a mock in child env');
  // @ts-expect-error TS2339 Property 'env' does not exist on type 'never'.
  assert.ok(capturedOptions.env.GRAPHIFY_BIN.startsWith(path.join(os.tmpdir(), 'graphify-')),
    // @ts-expect-error TS2339 Property 'env' does not exist on type 'never'.
    `GRAPHIFY_BIN ${capturedOptions.env.GRAPHIFY_BIN} should start with graphify- prefix`);
});
