const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const fmt = require('../lib/core/fmt');
const mutationGate = require('../lib/commands/mutation-gate');

const REPO_ROOT = path.join(__dirname, '..');
const STRYKER_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'stryker');

const STRONG_TEST = `const test = require('node:test');
const assert = require('node:assert');
const { add } = require('../lib/core/widget.js');
test('add sums two numbers correctly', () => {
  assert.strictEqual(add(2, 3), 5);
  assert.strictEqual(add(-1, 1), 0);
});
`;

// A "shallow reproduction test" (mission Why Now: AI-generated tests that
// pass without actually validating behavior) — it exercises `add` but
// never asserts on its return value, so every mutation to the function
// body survives.
const WEAK_TEST = `const test = require('node:test');
const assert = require('node:assert');
const { add } = require('../lib/core/widget.js');
test('add is callable', () => {
  assert.strictEqual(typeof add, 'function');
});
`;

function makeFixtureRepo() {
  const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mutation-gate-ratchet-'));
  fs.mkdirSync(path.join(repoRoot, 'lib', 'core'), { recursive: true });
  fs.mkdirSync(path.join(repoRoot, 'test'), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, 'lib', 'core', 'widget.js'),
    'function add(a, b) {\n  return a + b;\n}\nmodule.exports = { add };\n'
  );
  return repoRoot;
}

function runGate(repoRoot, baselinePath, extraArgs = []) {
  const scopeFn = () => ({
    baseBranch: 'main',
    headRef: 'HEAD',
    changedFiles: ['lib/core/widget.js'],
    calleeFiles: [],
    targetFiles: ['lib/core/widget.js'],
  });

  const logs = [];
  const errors = [];
  let exitCode = null;
  const previousLogger = fmt.setLogger({
    log: message => logs.push(fmt.stripAnsi(message)),
    error: message => errors.push(fmt.stripAnsi(message)),
  });
  try {
    mutationGate(['--base', 'main', '--baseline-path', baselinePath, ...extraArgs], {
      exitFn: code => { exitCode = code; },
      scopeFn,
      spawnSyncFn: spawnSync,
      getPrimaryBranchFn: () => 'main',
      repoRoot,
      strykerBin: STRYKER_BIN,
    });
  } finally {
    fmt.setLogger(previousLogger);
  }
  return { exitCode, stdout: logs.join('\n'), stderr: errors.join('\n') };
}

test('mutation-gate ratchet rejects a surviving-mutant regression (CP-5)', { timeout: 60_000 }, () => {
  const repoRoot = makeFixtureRepo();
  const baselineDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mutation-gate-ratchet-baseline-'));
  const baselinePath = path.join(baselineDir, 'mutation-baseline.json');
  const testFile = path.join(repoRoot, 'test', 'widget.test.js');

  try {
    // 1. Establish a baseline with a strong test that kills every mutant.
    fs.writeFileSync(testFile, STRONG_TEST);
    const first = runGate(repoRoot, baselinePath);
    assert.equal(first.exitCode, 0, `expected first run to pass: ${first.stdout}\n${first.stderr}`);

    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    assert.ok(baseline.filePaths['lib/core/widget.js']);
    const baselineScore = baseline.filePaths['lib/core/widget.js'].score;
    assert.equal(baselineScore, 100, `strong test should kill all mutants: ${first.stdout}`);

    // 2. Swap in a shallow/weak test — a surviving-mutant case — and rerun.
    fs.writeFileSync(testFile, WEAK_TEST);
    const second = runGate(repoRoot, baselinePath);

    assert.equal(second.exitCode, 1, `expected ratchet to reject the regression: ${second.stdout}\n${second.stderr}`);
    assert.match(second.stderr, /ratchet FAILED/);
    assert.match(second.stderr, /lib\/core\/widget\.js/);

    // 3. The baseline must not have been overwritten with the regressed score.
    const baselineAfterFailure = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    assert.equal(baselineAfterFailure.filePaths['lib/core/widget.js'].score, baselineScore);
  } finally {
    fs.rmSync(repoRoot, { recursive: true, force: true });
    fs.rmSync(baselineDir, { recursive: true, force: true });
  }
});
