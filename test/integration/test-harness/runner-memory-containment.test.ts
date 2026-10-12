// The real runner, test/run-default-tests.ts, bounds the aggregate memory of the
// test process tree and reports a breach to its live caller (TASK-2722). Each
// case drives the runner against a stand-in checkout holding a capped, growing
// fixture. The fixtures stop growing at FIXTURE_CAP_MIB, far below the host's
// headroom, so the reproduction is safe even on the parent behavior that has no
// boundary: there it fails on the missing diagnostics instead of exhausting
// memory. The real cgroup delegation is a workstation dependency (see
// INTEGRATION_LOCAL_REASONS).
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { caseRoot } from '../../fixtures/case-root.js';
import { MEMORY_SCOPE_ENV } from '../../../src/adapters/process/test-memory-policy.js';
import { forgetScope, scopeResult, watchScope, wrapInScope } from '../../../src/adapters/process/test-memory-cgroup.js';

const TEST_ROOT = path.join(import.meta.dirname, '..', '..');
const REPO_ROOT = path.dirname(TEST_ROOT);
// A real breach makes the kernel OOM-kill processes, which desktop Linux
// reports to the user (notifications, journal, crash reporters). The regular
// lane therefore never provokes one: breach cases run only when asked for with
// PARALLIX_TEST_MEMORY_BREACH=1; every other case here is breach-free.
const BREACH = { skip: process.env.PARALLIX_TEST_MEMORY_BREACH === '1' ? false : 'provokes a real kernel OOM kill; set PARALLIX_TEST_MEMORY_BREACH=1 to run' } as const;
const LIMIT_MIB = 320;
const FIXTURE_CAP_MIB = 900;
const SUITE_WALL_MS = 60_000;
// Fixtures expire on their own, so even a runner without a boundary leaks nothing.
const FIXTURE_LIFETIME_MS = 15_000;

const GROW = `
const chunks = [];
for (let used = 0; used < Number(process.env.FIXTURE_CAP_MIB || ${FIXTURE_CAP_MIB}); used += 16) {
  const chunk = Buffer.alloc(16 * 1024 * 1024);
  chunk.fill(1);
  chunks.push(chunk);
}
`;

function killRecorded(root: string): void {
  for (const pid of recordedPids(root)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
}

// Process cleanup is registered before the fixture launches and reads the
// recorded PIDs before the checkout is disposed, so it runs for every
// outcome: a failed assertion, timeout or signal still reclaims the tree.
function ownedCheckout(t: TestContext): { root: string; dispose: () => void } {
  const checkout = standInCheckout();
  t.after(() => killRecorded(checkout.root));
  t.after(() => checkout.dispose());
  return checkout;
}

function standInCheckout(): { root: string; dispose: () => void } {
  const checkout = caseRoot('runner-memory-');
  const write = (relative: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(checkout.root, relative)), { recursive: true });
    fs.writeFileSync(path.join(checkout.root, relative), content);
  };
  const head = "import test, { type TestContext } from 'node:test';\nimport assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport { spawn } from 'node:child_process';\n";
  const recordPid = "fs.writeFileSync(process.env.FIXTURE_PIDS + '.' + process.pid, String(process.pid));\n";
  write('package.json', '{}\n');
  write('test/lib/test-cpu-budgets.json', fs.readFileSync(path.join(TEST_ROOT, 'lib', 'test-cpu-budgets.json'), 'utf8'));
  write('test/unit/memory/healthy.test.ts', `${head}test('healthy fixture', () => { assert.equal(1 + 1, 2); });\n`);
  write('test/unit/memory/failing.test.ts', `${head}test('assertion fixture', () => { assert.equal('actual', 'expected'); });\n`);
  write('test/unit/memory/growing-test.test.ts',
    `${head}${recordPid}test('growing test fixture', () => {\n${GROW}\nassert.ok(chunks.length > 0);\n});\n`);
  write('test/unit/memory/growing-descendant.test.ts',
    `${head}${recordPid}test('growing descendant fixture', async () => {
const grow = ${JSON.stringify(`${GROW}\nrequire('node:fs').writeFileSync(process.env.FIXTURE_PIDS + '.' + process.pid, String(process.pid));\nsetTimeout(() => process.exit(0), ${FIXTURE_LIFETIME_MS});`)};
const child = spawn(process.execPath, ['-e', grow], { stdio: 'ignore' });
fs.writeFileSync(process.env.FIXTURE_PIDS + '.' + child.pid, String(child.pid));
await new Promise((resolve) => child.on('exit', resolve));
});\n`);
  write('test/unit/memory/sleeping.test.ts',
    `${head}${recordPid}test('sleeping fixture', async () => {
const child = spawn(process.execPath, ['-e', "require('node:fs').writeFileSync(process.env.FIXTURE_PIDS + '.' + process.pid, String(process.pid)); setTimeout(() => process.exit(0), ${FIXTURE_LIFETIME_MS});"], { stdio: 'ignore' });
await new Promise((resolve) => child.on('exit', resolve));
});\n`);
  write('test/unit/memory/placement.test.ts',
    `${head}${recordPid}test('placement fixture', () => { fs.writeFileSync(process.env.FIXTURE_PIDS + '.cgroup.' + process.pid, fs.readFileSync('/proc/self/cgroup', 'utf8')); });\n`);
  write('test/unit/memory/held-failure.test.ts',
    `${head}test('held failure fixture', () => {\nconst held = Buffer.alloc(200 * 1024 * 1024); held.fill(1);\nassert.equal(held.length, 0);\n});\n`);
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(checkout.root, 'node_modules'));
  fs.symlinkSync(path.join(TEST_ROOT, 'bootstrap-parallix-home.ts'), path.join(checkout.root, 'test', 'bootstrap-parallix-home.ts'));
  return checkout;
}

interface RunnerOutcome { status: number | null; signal: NodeJS.Signals | null; stdout: string; stderr: string; maxLoopGapMs: number }

async function runRunner(root: string, args: string[], extraEnv: NodeJS.ProcessEnv = {}, afterSpawn?: (pid: number) => void): Promise<RunnerOutcome> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PARALLIX_EXECUTION_ROOT: root,
    // Hosted-runner policy skips the native CPU meter, so the stand-in needs no
    // C compiler; the memory boundary is then requested explicitly.
    GITHUB_ACTIONS: 'true',
    PARALLIX_TEST_MEMORY_BOUNDARY: 'cgroup',
    PARALLIX_TEST_MEMORY_LIMIT_MIB: String(LIMIT_MIB),
    FIXTURE_PIDS: path.join(root, 'pids'),
    FORCE_COLOR: '0',
    ...extraEnv,
  };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_V8_COVERAGE;
  delete env.PARALLIX_TEST_COVERAGE;
  delete env.PARALLIX_FAST_UNIT;
  // These cases exercise an outermost runner; nesting has its own cases below.
  delete env[MEMORY_SCOPE_ENV];
  const child = spawn(process.execPath, ['--import', 'tsx', path.join(TEST_ROOT, 'run-default-tests.ts'), ...args], {
    cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  // The caller must keep servicing its own event loop while the child breaches.
  let last = Date.now();
  let maxLoopGapMs = 0;
  const heartbeat = setInterval(() => { const now = Date.now(); maxLoopGapMs = Math.max(maxLoopGapMs, now - last); last = now; }, 50);
  const wall = setTimeout(() => child.kill('SIGKILL'), SUITE_WALL_MS);
  if (child.pid !== undefined) { afterSpawn?.(child.pid); }
  try {
    return await new Promise((resolve) => child.on('close', (status, signal) => resolve({ status, signal, stdout, stderr, maxLoopGapMs })));
  } finally {
    clearInterval(heartbeat);
    clearTimeout(wall);
  }
}

function recordedPids(root: string): number[] {
  return fs.readdirSync(root).filter((name) => /^pids\.\d+$/.test(name)).map((name) => Number(fs.readFileSync(path.join(root, name), 'utf8')));
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

async function assertAllGone(pids: number[]): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (pids.some(alive) && Date.now() < deadline) { await new Promise((resolve) => setTimeout(resolve, 50)); }
  assert.deepEqual(pids.filter(alive), [], 'every owned test process must be gone');
}

for (const [fixture, name] of [
  ['growing-test.test.ts', 'a growing test'],
  ['growing-descendant.test.ts', 'a growing descendant'],
] as const) {
  test(`a memory breach by ${name} fails with memory-limit diagnostics and no survivors (TASK-2722)`, BREACH, async (t) => {
    const checkout = ownedCheckout(t);
    const selector = `test/unit/memory/${fixture}`;
    const result = await runRunner(checkout.root, [selector]);
    assert.notEqual(result.status, 0, 'a breach must never pass');
    assert.match(result.stderr, /\[test-memory-boundary\] MEMORY LIMIT EXCEEDED/);
    assert.match(result.stderr, new RegExp(`limit=${LIMIT_MIB} MiB`));
    assert.match(result.stderr, new RegExp(`suite=${selector.replace(/\./g, '\\.')}`));
    assert.match(result.stderr, /peak=(\d+(\.\d+)? MiB|unavailable)/);
    assert.match(result.stderr, /cause: aggregate test-process-tree memory limit/);
    assert.ok(result.maxLoopGapMs < 2_000, `the calling process stayed responsive (max gap ${result.maxLoopGapMs}ms)`);
    const pids = recordedPids(checkout.root);
    assert.ok(pids.length >= (fixture === 'growing-descendant.test.ts' ? 2 : 1), `worker and descendant pids recorded: ${pids}`);
    await assertAllGone(pids);
  });
}

test('a healthy focused suite passes inside the boundary without a breach report (TASK-2722)', async (t) => {
  const checkout = ownedCheckout(t);
  const result = await runRunner(checkout.root, ['test/unit/memory/healthy.test.ts']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /✔ healthy fixture/);
  assert.doesNotMatch(result.stderr, /MEMORY LIMIT EXCEEDED/);
});

test('an assertion failure is not reported as a memory breach (TASK-2722)', async (t) => {
  const checkout = ownedCheckout(t);
  const result = await runRunner(checkout.root, ['test/unit/memory/failing.test.ts']);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /✖ assertion fixture/);
  assert.doesNotMatch(result.stderr, /MEMORY LIMIT EXCEEDED/);
});

test('a suite timeout is reported as a timeout and still reclaims every descendant (TASK-2722)', async (t) => {
  const checkout = ownedCheckout(t);
  const result = await runRunner(checkout.root, ['test/unit/memory/sleeping.test.ts'], { PARALLIX_SUITE_HANG_TIMEOUT_MS: '4000' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\[suite-watchdog\]/);
  assert.doesNotMatch(result.stderr, /MEMORY LIMIT EXCEEDED/);
  await assertAllGone(recordedPids(checkout.root));
});

test('a forwarded signal reclaims every descendant without a memory report (TASK-2722)', async (t) => {
  const checkout = ownedCheckout(t);
  const result = await runRunner(checkout.root, ['test/unit/memory/sleeping.test.ts'], {}, (pid) => {
    const poll = setInterval(() => {
      if (recordedPids(checkout.root).length >= 2) { clearInterval(poll); process.kill(pid, 'SIGTERM'); }
    }, 100);
    setTimeout(() => clearInterval(poll), SUITE_WALL_MS).unref();
  });
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stderr, /MEMORY LIMIT EXCEEDED/);
  await assertAllGone(recordedPids(checkout.root));
});

test('a failure after heavy allocation keeps its own cause and is not reported as a memory breach (TASK-2722)', async (t) => {
  const checkout = ownedCheckout(t);
  const result = await runRunner(checkout.root, ['test/unit/memory/held-failure.test.ts'], { PARALLIX_TEST_MEMORY_LIMIT_MIB: '1024' });
  assert.notEqual(result.status, 0);
  assert.notEqual(result.status, 137);
  assert.match(result.stdout, /✖ held failure fixture/);
  assert.doesNotMatch(result.stderr, /MEMORY LIMIT EXCEEDED/);
});

// A nested runner must stay inside the enclosing scope so the enclosing limit
// counts and kills the whole nested tree instead of a sibling scope.
function runNestedInScope(root: string, outerLimitMiB: number, runs: string[][], extraEnv: NodeJS.ProcessEnv, unit = `parallix-test-nested-${process.pid}-${Date.now()}.scope`): Promise<number | null> {
  const runner = ['--import', 'tsx', path.join(TEST_ROOT, 'run-default-tests.ts')];
  // One enclosing scope runs every nested runner concurrently.
  const script = runs.map((args) => `"$NODE" ${[...runner, ...args].map((arg) => `'${arg}'`).join(' ')} & `).join('') + 'wait';
  const scope = wrapInScope(outerLimitMiB, 'sh', ['-c', script], unit);
  const env: NodeJS.ProcessEnv = {
    ...process.env, PARALLIX_EXECUTION_ROOT: root, GITHUB_ACTIONS: 'true', PARALLIX_TEST_MEMORY_BOUNDARY: 'cgroup',
    PARALLIX_TEST_MEMORY_LIMIT_MIB: '4096', FIXTURE_PIDS: path.join(root, 'pids'), FORCE_COLOR: '0',
    [MEMORY_SCOPE_ENV]: scope.unit, NODE: process.execPath, ...extraEnv,
  };
  delete env.NODE_TEST_CONTEXT;
  delete env.NODE_V8_COVERAGE;
  delete env.PARALLIX_TEST_COVERAGE;
  delete env.PARALLIX_FAST_UNIT;
  const child = spawn(scope.command, scope.args, { cwd: root, env, stdio: 'ignore' });
  const wall = setTimeout(() => child.kill('SIGKILL'), SUITE_WALL_MS);
  return new Promise((resolve) => child.on('close', (status) => { clearTimeout(wall); resolve(status); }));
}

test('a nested runner stays inside the enclosing scope instead of a sibling scope (TASK-2722)', async (t) => {
  const checkout = ownedCheckout(t);
  const unit = `parallix-test-nested-${process.pid}-placement.scope`;
  const status = await runNestedInScope(checkout.root, 2048, [['test/unit/memory/placement.test.ts']], {}, unit);
  assert.equal(status, 0);
  const placements = fs.readdirSync(checkout.root).filter((name) => name.startsWith('pids.cgroup.'))
    .map((name) => fs.readFileSync(path.join(checkout.root, name), 'utf8').split('\n').find((line) => line.startsWith('0::')));
  assert.equal(placements.length, 1);
  assert.ok(placements[0]?.endsWith(`/${unit}`), `the fixture runs in the enclosing scope ${unit}, not a sibling: ${placements[0]}`);
});

test('concurrent nested runners share one enclosing limit and are killed together (TASK-2722)', BREACH, async (t) => {
  const checkout = ownedCheckout(t);
  // Each runner alone stays well below the enclosing limit; together they exceed it.
  const grow = { FIXTURE_CAP_MIB: '260', PARALLIX_SUITE_HANG_TIMEOUT_MS: '30000' };
  const status = await runNestedInScope(checkout.root, 480, [['test/unit/memory/growing-descendant.test.ts'], ['test/unit/memory/growing-descendant.test.ts']], grow);
  const pids = recordedPids(checkout.root);
    await assertAllGone(pids);
  assert.ok(pids.length >= 4, 'both nested runners reached their workers and descendants');
  assert.notEqual(status, 0, 'the enclosing kill ends the nested tree');
});

test('a breach is still attributed when the reporter was stalled past the scope teardown (TASK-2722)', BREACH, async () => {
  // The external reporter's event loop is blocked while the scope breaches and
  // is removed, so no sample sees the OOM kill; systemd's retained terminal
  // Result is the durable evidence. A near-cap failure must not produce it.
  const grow = `const c=[];for(let u=0;u<400;u+=16){const b=Buffer.alloc(16<<20);b.fill(1);c.push(b);}`;
  const launch = wrapInScope(256, process.execPath, ['-e', grow], undefined, true);
  const child = spawn(launch.command, launch.args, { stdio: 'ignore' });
  const watch = watchScope(child.pid ?? 0, launch.unit, () => undefined);
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_500);
    const sample = watch.stop();
    await new Promise((resolve) => child.on('close', resolve));
    assert.equal(sample.breached, false, 'the stalled reporter saw no OOM kill');
    assert.equal(scopeResult(launch.unit), 'oom-kill');
  } finally {
    forgetScope(launch.unit);
  }
  const healthy = wrapInScope(256, process.execPath, ['-e', '0'], undefined, true);
  await new Promise((resolve) => spawn(healthy.command, healthy.args, { stdio: 'ignore' }).on('close', resolve));
  assert.notEqual(scopeResult(healthy.unit), 'oom-kill');
  forgetScope(healthy.unit);
});
