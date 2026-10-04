// The real runner, test/run-default-tests.ts, executes exactly the focused
// nested suite and propagates its outcome (TASK-2638). Each case drives the
// runner against a stand-in checkout: nested unit suites, the real bootstrap
// preload, and the CPU policy file, but no lane registry, so the selection
// under test is the path-declared unit level alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { caseRoot } from '../../fixtures/case-root.js';

const TEST_ROOT = path.join(import.meta.dirname, '..', '..');
const REPO_ROOT = path.dirname(TEST_ROOT);

function standInCheckout(): { root: string; dispose: () => void } {
  const checkout = caseRoot('runner-selection-');
  const write = (relative: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(checkout.root, relative)), { recursive: true });
    fs.writeFileSync(path.join(checkout.root, relative), content);
  };
  write('package.json', '{}\n');
  write('test/lib/test-cpu-budgets.json', fs.readFileSync(path.join(TEST_ROOT, 'lib', 'test-cpu-budgets.json'), 'utf8'));
  write('test/unit/domain/missions/deep/passing.test.ts',
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('nested passing fixture', () => { assert.equal(1 + 1, 2); });\n");
  write('test/unit/domain/missions/deep/failing.test.ts',
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('nested failing fixture', () => { assert.equal('actual-value', 'expected-value'); });\n");
  write('test/lib/helper.ts', 'export const helper = 1;\n');
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(checkout.root, 'node_modules'));
  fs.symlinkSync(path.join(TEST_ROOT, 'bootstrap-parallix-home.ts'), path.join(checkout.root, 'test', 'bootstrap-parallix-home.ts'));
  return checkout;
}

function runRunner(root: string, args: string[]) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PARALLIX_EXECUTION_ROOT: root,
    // Hosted-runner policy skips the native CPU meter and reporters, so the
    // stand-in needs no C compiler; selection and propagation are unchanged.
    GITHUB_ACTIONS: 'true',
    FORCE_COLOR: '0',
  };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_V8_COVERAGE;
  delete env.PARALLIX_TEST_COVERAGE;
  delete env.PARALLIX_FAST_UNIT;
  return spawnSync(process.execPath, ['--import', 'tsx', path.join(TEST_ROOT, 'run-default-tests.ts'), ...args], {
    cwd: root, env, encoding: 'utf8', timeout: 60_000,
  });
}

test('the runner executes only the focused nested suite and reports it green', (t) => {
  const checkout = standInCheckout();
  t.after(() => checkout.dispose());
  const result = runRunner(checkout.root, ['test/unit/domain/missions/deep/passing.test.ts']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /✔ nested passing fixture/);
  assert.doesNotMatch(result.stdout, /nested failing fixture/);
  assert.match(result.stdout, /ℹ tests 1\n/);
});

test('the runner propagates a deliberate assertion failure from a nested suite', (t) => {
  const checkout = standInCheckout();
  t.after(() => checkout.dispose());
  const result = runRunner(checkout.root, ['test/unit/domain/missions/deep/failing.test.ts']);
  assert.notEqual(result.status, 0, 'a failing nested suite must fail the run');
  assert.match(result.stdout, /✖ nested failing fixture/);
  assert.match(result.stdout, /expected-value/);
  assert.match(result.stdout, /ℹ fail 1\n/);
});

test('a focused selector that matches no discovered suite fails without a green result', (t) => {
  const checkout = standInCheckout();
  t.after(() => checkout.dispose());
  for (const [selector, reason] of [
    ['test/unit/domain/missions/missing.test.ts', /requested test file does not exist/],
    ['test/lib/helper.ts', /matches no discovered suite/],
  ] as const) {
    const result = runRunner(checkout.root, [selector]);
    assert.notEqual(result.status, 0, `${selector} must not report success`);
    assert.match(result.stderr, reason);
    assert.doesNotMatch(result.stdout, /ℹ pass/);
  }
});
