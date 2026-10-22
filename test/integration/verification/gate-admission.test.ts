// Split along execution, shell-verifier and observation contracts to bound suite time.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { build } from 'esbuild';
import { setTimeout as delay } from 'node:timers/promises';
import { resolveCanonicalMaxConcurrentGates } from '../../../src/adapters/config/product-config.js';
import { runPhaseGates } from '../../../src/adapters/config/repository-gates.js';
import { resolveConfiguration } from '../../../src/composition/config.js';

import { fileURLToPath } from 'node:url';
import { createHandoffPorts } from '../../../src/adapters/cli/commands/handoff.js';
import { clearCustomAdmissionStateCache } from '../../../src/adapters/sqlite/custom-admission-state.js';
import { DeclaredGateRunner } from '../../../src/application/handoff-declared-gates.js';
import { configureGateAdmission } from '../../../src/application/ports/gate-admission.js';
import { createGateAdmission } from '../../../src/composition/gate-admission.js';

async function untilGateFile(file: string): Promise<void> {
  const end = Date.now() + 2000;
  while (!fs.existsSync(file)) {
    assert.ok(Date.now() < end, `gate did not create ${file}`);
    await delay(5);
  }
}

async function gateProcessFixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-processes-'));
  const children: ReturnType<typeof spawn>[] = [];
  const exits: Promise<number | null>[] = [];
  const parentRuns: Promise<unknown>[] = [];
  const controller = new AbortController();
  const configuration = resolveConfiguration({ PARALLIX_CUSTOM_ADMISSION_HOME: path.join(root, 'leases') });
  const admission = createGateAdmission(configuration);
  t.after(async () => {
    fs.writeFileSync(path.join(root, 'release'), '');
    controller.abort();
    for (const child of children) { if (child.exitCode === null) { child.kill('SIGTERM'); } }
    await Promise.all(exits);
    await Promise.allSettled(parentRuns);
    await clearCustomAdmissionStateCache();
    if (fs.existsSync(path.join(root, 'started'))) { await untilGateFile(path.join(root, 'ended')); }
    fs.rmSync(root, { recursive: true, force: true });
  });
  const { spawnSync } = await import('node:child_process');
  const git = (args: string[]) => assert.equal(spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' }).status, 0);
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { gates: { maxConcurrent: 1 } } }));
  git(['init', '-q']); git(['add', '.']);
  git(['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
  const worktree = path.join(root, 'worktree');
  git(['worktree', 'add', '-qb', 'mission/fixture', worktree]);
  const worker = fileURLToPath(new URL('../../fixtures/gate-admission-worker.ts', import.meta.url));
  // Compile the immutable worker once per isolated fixture, as workflow-bundle
  // does for real workflow children. Repeated tsx loader startup otherwise
  // dominates the waited-child CPU of the cross-process admission assertion.
  const bundleRoot = path.join(root, 'worker-bundle');
  const entry = path.join(bundleRoot, 'worker.mjs');
  await build({ entryPoints: [worker], outfile: entry, bundle: true, minify: true,
    platform: 'node', format: 'esm', packages: 'external',
    banner: { js: `import { createRequire } from 'node:module'; const require = createRequire(${JSON.stringify(path.resolve('package.json'))});` },
  });
  fs.symlinkSync(path.resolve('node_modules'), path.join(bundleRoot, 'node_modules'), 'dir');
  fs.symlinkSync(path.resolve('src/adapters/sqlite/migrations'), path.join(bundleRoot, 'migrations'), 'dir');
  const launch = (cwd: string, command: string) => {
    // Match the runner's bounded compiler pool in this independently started
    // worker; host-sized pools inflate waited-child CPU without adding coverage.
    const child = spawn(process.execPath, ['--v8-pool-size=1', entry, cwd, path.join(root, 'leases'), command], { stdio: 'pipe' });
    children.push(child);
    const exit = new Promise<number | null>(resolve => child.once('exit', resolve));
    exits.push(exit);
    return { child, exit };
  };
  const runGate = (checkoutPath: string, command: string) => {
    const run = runPhaseGates('integration', { configuration, admission, signal: controller.signal,
      slug: 'fixture', checkoutPath, gates: [{ key: 'fixture', command, order: 0 }], log: () => {}, error: () => {},
    });
    parentRuns.push(run);
    return run;
  };
  return { root, worktree, launch, runGate };
}

test('enabled verification excludes processes across worktrees and retains orphan descendants (TASK-2791)', async t => {
  const { root, worktree, launch, runGate } = await gateProcessFixture(t);
  // A detached child closes output and creates a new session; its inherited lease identity retains ownership.
  const first = launch(root, `node -e 'require("node:child_process").spawn("bash", ["-c", "while [ ! -f release ]; do sleep 0.01; done; echo end >> order; touch ended"], { detached: true, stdio: "ignore" }).unref()'; echo start >> order; touch started`);
  await untilGateFile(path.join(root, 'started'));
  const second = runGate(worktree, 'echo next >> ../order; touch ../second');
  await delay(20);
  first.child.kill('SIGKILL');
  await first.exit;
  await delay(80);
  assert.equal(fs.existsSync(path.join(root, 'second')), false);
  fs.writeFileSync(path.join(root, 'release'), '');
  assert.equal((await second).ok, true);
  assert.deepEqual(fs.readFileSync(path.join(root, 'order'), 'utf8').trim().split('\n'), ['start', 'end', 'next']);
});

test('enabled gate interruption releases only after its running process settles (TASK-2791)', async t => {
  const { root, worktree, launch, runGate } = await gateProcessFixture(t);
  const interrupted = launch(root, 'touch interrupted; sleep 30');
  await untilGateFile(path.join(root, 'interrupted'));
  interrupted.child.kill('SIGTERM');
  assert.equal(await interrupted.exit, 1);
  assert.equal((await runGate(worktree, 'true')).ok, true);
});

test('enabled gates preserve parallelism, cancel waiting and running, and reject nesting (TASK-2791)', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-cancellation-'));
  const configuration = resolveConfiguration({ PARALLIX_CUSTOM_ADMISSION_HOME: path.join(root, 'leases') });
  const admission = createGateAdmission(configuration);
  const waiting = new AbortController();
  const running = new AbortController();
  const runs: Promise<unknown>[] = [];
  let release: (() => void) | undefined;
  t.after(async () => {
    release?.();
    configureGateAdmission(null);
    waiting.abort(); running.abort();
    await Promise.allSettled(runs);
    await clearCustomAdmissionStateCache();
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { gates: { maxConcurrent: 1, parallel: { preIntegration: 2 } } } }));
  const opts = { configuration, admission, slug: 'fixture', checkoutPath: root, log: () => {}, error: () => {} };
  const first = runPhaseGates('integration', { ...opts, signal: running.signal, gates: [
    { key: 'one', command: 'touch one; while [ ! -f two ]; do sleep 0.01; done; sleep 30', order: 0 },
    { key: 'two', command: 'touch two; sleep 30', order: 1 },
  ] });
  runs.push(first);
  await untilGateFile(path.join(root, 'two'));
  await untilGateFile(path.join(root, 'one'));
  const next = runPhaseGates('review', { ...opts, signal: waiting.signal, gates: [{ key: 'wait', command: 'touch forbidden', order: 0 }] });
  runs.push(next); await delay(15); waiting.abort();
  assert.equal((await next).ok, false);
  assert.equal(fs.existsSync(path.join(root, 'forbidden')), false);
  running.abort();
  assert.equal((await first).cancelled, true);
  const nested = createGateAdmission(resolveConfiguration({ PARALLIX_CUSTOM_ADMISSION_HOME: path.join(root, 'leases'), PARALLIX_GATE_OWNER: 'inherited-owner' }));
  const rejected = await runPhaseGates('handoff', { ...opts, admission: nested, gates: [{ key: 'nested', command: 'touch forbidden', order: 0 }] });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error!, /Nested/);
  assert.equal(fs.existsSync(path.join(root, 'forbidden')), false);
  const progress = await runPhaseGates('handoff', { ...opts, gates: [{ key: 'after', command: 'true', order: 0 }] });
  assert.equal(progress.ok, true);
  configureGateAdmission(admission);
  const declared = new DeclaredGateRunner(createHandoffPorts(configuration));
  let entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  const held = admission.run(root, async () => {
    entered(); await new Promise<void>(resolve => { release = resolve; });
  });
  runs.push(held);
  await ready;
  const declaredRun = declared.executeGateCommands(['touch declared', 'false'], root, { log: () => {} });
  runs.push(declaredRun);
  await delay(15);
  assert.equal(fs.existsSync(path.join(root, 'declared')), false, 'declared gates wait on the same resource');
  release!(); await held;
  const outcome = await declaredRun;
  assert.equal(outcome.ok, false);
  assert.equal(outcome.ok === false && outcome.gate, 'false');
  assert.equal(fs.existsSync(path.join(root, 'declared')), true);
});

test('configured gate capacity admits two independent runs and queues a third (H2)', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-capacity-'));
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { gates: { maxConcurrent: 2 } } }));
  const admission = createGateAdmission(resolveConfiguration({ PARALLIX_CUSTOM_ADMISSION_HOME: path.join(root, 'leases') }));
  const controller = new AbortController();
  const release: (() => void)[] = [];
  const runs: Promise<unknown>[] = [];
  t.after(async () => {
    controller.abort(); for (const done of release) { done(); }
    await Promise.allSettled(runs); await clearCustomAdmissionStateCache();
    fs.rmSync(root, { recursive: true, force: true });
  });
  let active = 0;
  let maximum = 0;
  const entered: number[] = [];
  for (const index of [0, 1]) {
    let ready!: () => void;
    const started = new Promise<void>(resolve => { ready = resolve; });
    runs.push(admission.run(root, async () => {
      entered.push(index); active++; maximum = Math.max(maximum, active); ready();
      await new Promise<void>(resolve => { release[index] = resolve; }); active--;
    }, controller.signal));
    await started;
  }
  const third = admission.run(root, async () => { entered.push(2); active++; maximum = Math.max(maximum, active); active--; }, controller.signal);
  runs.push(third);
  await delay(30);
  assert.deepEqual(entered, [0, 1]);
  release[0](); await runs[0]; await third;
  assert.deepEqual(entered, [0, 1, 2]);
  assert.equal(maximum, 2);
  assert.equal(active, 1, 'the second run remains admitted while the third progresses');
  release[1](); await runs[1];
});

test('canonical checkout owns gate capacity and invalid policy fails closed (H2)', async t => {
  const { root, worktree } = await gateProcessFixture(t);
  fs.writeFileSync(path.join(worktree, 'workflow.config.json'), JSON.stringify({ adapters: { gates: { maxConcurrent: 2 } } }));
  assert.equal(resolveCanonicalMaxConcurrentGates(worktree), 1);
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { gates: {} } }));
  assert.equal(resolveCanonicalMaxConcurrentGates(worktree), Infinity);
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { gates: { maxConcurrent: true } } }));
  assert.throws(() => resolveCanonicalMaxConcurrentGates(worktree), /maxConcurrent admission fails closed/);
  let spawned = 0;
  const result = await runPhaseGates('handoff', { slug: 'fixture', checkoutPath: worktree,
    gates: [{ key: 'held', command: 'true', order: 0 }], commandRunner: () => { spawned++; return { status: 0, stdout: '', stderr: '' }; },
    log: () => {}, error: () => {},
  });
  assert.equal(result.ok, false); assert.equal(spawned, 0);
  fs.writeFileSync(path.join(root, 'workflow.config.json'), '{');
  assert.throws(() => resolveCanonicalMaxConcurrentGates(worktree), /maxConcurrent admission fails closed/);
});

test('admission retains and cancels surviving descendants before releasing capacity (TASK-2791)', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-settlement-'));
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { gates: { maxConcurrent: 1 } } }));
  const admission = createGateAdmission(resolveConfiguration({ PARALLIX_CUSTOM_ADMISSION_HOME: path.join(root, 'leases') }));
  const controller = new AbortController();
  const children: ReturnType<typeof spawn>[] = [];
  const exits: Promise<unknown>[] = [];
  const runs: Promise<unknown>[] = [];
  t.after(async () => {
    controller.abort();
    for (const child of children) { if (child.exitCode === null) { child.kill('SIGKILL'); } }
    await Promise.allSettled([...runs, ...exits]);
    await clearCustomAdmissionStateCache();
    fs.rmSync(root, { recursive: true, force: true });
  });
  let returned!: () => void;
  const actionReturned = new Promise<void>(resolve => { returned = resolve; });
  let settled = false;
  const first = admission.run(root, async run => {
    const child = spawn('bash', ['-c', 'touch ready; exec sleep 30'], {
      cwd: root, detached: true, stdio: 'ignore', env: { ...process.env, ...run.environment },
    });
    children.push(child);
    exits.push(new Promise(resolve => child.once('exit', resolve)));
    assert.ok(child.pid);
    run.bindProcessGroup(child.pid);
    await untilGateFile(path.join(root, 'ready'));
    returned();
  }, controller.signal).then(() => { settled = true; });
  runs.push(first);
  await actionReturned;
  let nextStarted = false;
  const next = admission.run(root, async () => { nextStarted = true; }, controller.signal);
  runs.push(next);
  const cancelledWaiter = assert.rejects(next, { name: 'AbortError' });
  // Observe settlement retaining the lease after the action has returned.
  await delay(30);
  assert.equal(settled, false);
  assert.equal(nextStarted, false);
  controller.abort();
  await first;
  await cancelledWaiter;
  await Promise.all(exits);
  assert.equal(children[0].signalCode, 'SIGKILL');
  assert.equal(nextStarted, false);
  await admission.run(root, async () => { nextStarted = true; });
  assert.equal(nextStarted, true, 'capacity is reusable after descendant settlement');
});
