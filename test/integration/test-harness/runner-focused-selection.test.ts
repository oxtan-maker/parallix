// The real runner, test/run-default-tests.ts, executes exactly the focused
// nested suite and propagates its outcome (TASK-2638). Each case drives the
// runner against a stand-in checkout: nested unit suites, the real bootstrap
// preload, and the CPU policy file, but no lane registry, so the selection
// under test is the path-declared unit level alone.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { caseRoot } from '../../fixtures/case-root.js';
import { cleanupFixtureProcesses, registerFixtureCleanup } from '../../helpers/fixture-cleanup.js';
import { mkdtempAt } from '../../helpers/temp-dir.js';
import { recoverRecordedTempRoots } from '../../../src/adapters/verification/temp-root-registry.js';
import { probeProcessLiveness } from '../../../src/adapters/process/process-liveness.js';

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

function runRunner(root: string, args: string[], coverage = false) {
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
  if (coverage) { env.PARALLIX_TEST_COVERAGE = '1'; } else { delete env.PARALLIX_TEST_COVERAGE; }
  delete env.PARALLIX_FAST_UNIT;
  return spawnSync(process.execPath, ['--import', 'tsx', path.join(TEST_ROOT, 'run-default-tests.ts'), ...args], {
    cwd: root, env, encoding: 'utf8', timeout: 60_000,
  });
}

test('the runner executes only the focused nested suite and reports it green', (t) => {
  const checkout = standInCheckout();
  t.after(() => checkout.dispose());
  fs.appendFileSync(path.join(checkout.root, 'test/unit/domain/missions/deep/passing.test.ts'), `
import fs from 'node:fs'; import os from 'node:os';
test('runner preserves fixture TMPDIR and disk-backed transcript isolation (TASK-2816)', () => {
  assert.equal(os.tmpdir(), process.env.PARALLIX_TEST_FIXTURE_TMPDIR);
  const raw = process.env.NODE_V8_COVERAGE;
  if (process.env.PARALLIX_TEST_COVERAGE === '1') {
    assert.ok(raw && raw !== os.tmpdir() && !os.tmpdir().startsWith(raw + '/'));
    assert.notEqual(fs.statfsSync(raw).type, 0x01021994);
  }
  assert.notEqual(fs.statfsSync(process.env.PARALLIX_TERMINAL_TRANSCRIPT_DIR).type, 0x01021994);
});
`);
  const result = runRunner(checkout.root, ['test/unit/domain/missions/deep/passing.test.ts'], process.env.PARALLIX_TEST_COVERAGE === '1');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /✔ nested passing fixture/);
  assert.doesNotMatch(result.stdout, /nested failing fixture/);
  assert.match(result.stdout, /ℹ tests 2\n/);
});

test('a hard-killed covered runner leaves recoverable scratch instead of untracked payloads', { timeout: 30_000 }, async t => {
  const checkout = standInCheckout();
  const temporary = mkdtempAt(process.env.PARALLIX_TEST_TRANSCRIPT_TMPDIR!, 'runner-coverage-recovery-');
  let child: ReturnType<typeof spawn> | undefined;
  registerFixtureCleanup(t, () => {
    child?.kill('SIGKILL');
    cleanupFixtureProcesses(checkout.root);
    checkout.dispose(); fs.rmSync(temporary, { recursive: true, force: true });
  });
  const marker = path.join(checkout.root, 'scratch.json');
  // Execution is a stand-in boundary, as is the checkout. This checks the
  // real supervisor's scratch ownership without requiring another Node version.
  const executor = path.join(checkout.root, 'coverage-executor.mjs');
  fs.writeFileSync(executor, `#!${process.execPath}
    import fs from 'node:fs';
    import path from 'node:path';
    if (process.argv.includes('--version')) { console.log('v26.7.0'); }
    else if (!process.argv.includes('--help')) {
      fs.mkdirSync(path.join(process.env.TMPDIR, 'node-coverage-fixture'));
      fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify(process.env.TMPDIR));
      setTimeout(() => {}, 1500);
    }`, { mode: 0o755 });
  const env: NodeJS.ProcessEnv = { ...process.env, GITHUB_ACTIONS: 'true', PARALLIX_EXECUTION_ROOT: checkout.root,
    PARALLIX_TEST_COVERAGE: '1', PARALLIX_TEST_NODE: executor, TMPDIR: temporary, PARALLIX_TEST_MEMORY_BOUNDARY: 'off' };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_V8_COVERAGE;
  delete env.PARALLIX_FAST_UNIT;
  child = spawn(process.execPath, ['--import', 'tsx', path.join(TEST_ROOT, 'run-default-tests.ts'),
    'test/unit/domain/missions/deep/passing.test.ts'], { cwd: checkout.root, env, stdio: ['ignore', 'ignore', 'pipe'] });
  let diagnostic = '';
  child.stderr?.on('data', chunk => { diagnostic += String(chunk); });
  const closed = once(child, 'close');
  const deadline = Date.now() + 30_000;
  while (!fs.existsSync(marker) && Date.now() < deadline && child.exitCode === null) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.ok(fs.existsSync(marker), diagnostic);
  const scratch: string = JSON.parse(fs.readFileSync(marker, 'utf8'));
  child.kill('SIGKILL');
  cleanupFixtureProcesses(checkout.root);
  await closed;
  assert.ok(fs.existsSync(scratch), 'SIGKILL bypasses ordinary runner cleanup');
  const owner = JSON.parse(fs.readFileSync(path.join(scratch, '.parallix-scratch-owner.json'), 'utf8')) as {
    children?: { pid: number; startId: string | null }[];
  };
  const descendants = owner.children ?? [];
  const descendantDeadline = Date.now() + 5_000;
  while (descendants.some(({ pid, startId }) => probeProcessLiveness(pid, startId) !== false)
    && Date.now() < descendantDeadline) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(descendants.some(({ pid, startId }) => probeProcessLiveness(pid, startId) !== false), false,
    'fixture suite descendants settle before the next-run recovery pass');
  recoverRecordedTempRoots({ legacyCoverageBases: [temporary], ownerLiveness: probeProcessLiveness });
  assert.equal(fs.existsSync(scratch), false, 'next-run recovery reclaims runner-owned coverage scratch');
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
