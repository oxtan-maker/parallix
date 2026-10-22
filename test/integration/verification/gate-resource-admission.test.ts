// Resource-scoped admission: one lease partition per named gate resource, split from whole-run admission to bound suite time.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createHandoffPorts } from '../../../src/adapters/cli/commands/handoff.js';
import { configureGateAdmission } from '../../../src/application/ports/gate-admission.js';
import { runConfiguredVerification } from '../../../src/adapters/verification/configured-verification.js';
import { resolveCanonicalGateResources } from '../../../src/adapters/config/product-config.js';
import { runPhaseGates } from '../../../src/adapters/config/repository-gates.js';
import { clearCustomAdmissionStateCache } from '../../../src/adapters/sqlite/custom-admission-state.js';
import { createGateAdmission } from '../../../src/composition/gate-admission.js';
import { resolveConfiguration } from '../../../src/composition/config.js';

async function untilGateFile(file: string): Promise<void> {
  const end = Date.now() + 2000;
  while (!fs.existsSync(file)) {
    assert.ok(Date.now() < end, `gate did not create ${file}`);
    await delay(5);
  }
}

async function resourceFixture(t: TestContext, gates: object) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-resources-'));
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { gates } }));
  const configuration = resolveConfiguration({ PARALLIX_CUSTOM_ADMISSION_HOME: path.join(root, 'leases') });
  const admission = createGateAdmission(configuration);
  const controller = new AbortController();
  const runs: Promise<unknown>[] = [];
  t.after(async () => {
    fs.writeFileSync(path.join(root, 'release'), '');
    controller.abort();
    await Promise.allSettled(runs);
    await clearCustomAdmissionStateCache();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const run = (gates: { key: string; command: string; order: number; resource?: string; after?: string[] }[]) => {
    const result = runPhaseGates('integration', { configuration, admission, signal: controller.signal, slug: 'fixture',
      checkoutPath: root, gates, maxParallel: 3, log: () => {}, error: () => {} });
    runs.push(result);
    return result;
  };
  return { root, admission, configuration, controller, runs, run };
}

test('gate resources exclude holders of one resource and let independent resources overlap (px-0019)', async t => {
  const { root, admission, controller, runs } = await resourceFixture(t, { resources: { test: 1, other: 1 } });
  const entered: string[] = [];
  const release: Record<string, () => void> = {};
  const hold = (name: string, resource: string) => {
    let ready!: () => void;
    const started = new Promise<void>(resolve => { ready = resolve; });
    runs.push(admission.runOnResource(root, { name: resource, capacity: 1 }, async run => {
      entered.push(name); ready();
      // Abort-aware so an assertion failure cannot leave cleanup waiting on a release that never comes.
      await new Promise<void>(resolve => { release[name] = resolve; run.signal.addEventListener('abort', () => resolve(), { once: true }); });
    }, controller.signal));
    return started;
  };
  await hold('first', 'test');
  await hold('independent', 'other');
  const second = hold('second', 'test');
  await delay(30);
  assert.deepEqual(entered, ['first', 'independent'], 'a held resource blocks only its own waiters');
  release.first();
  await second;
  assert.deepEqual(entered, ['first', 'independent', 'second']);
  release.second(); release.independent();
});

test('a finished test gate frees its slot for another run while an unrelated gate stays active (px-0019)', async t => {
  const { root, run } = await resourceFixture(t, { resources: { test: 1 } });
  const first = run([
    { key: 'unit', command: 'touch unit-start; touch unit-end', order: 0, resource: 'test' },
    { key: 'quality', command: 'touch quality-start; while [ ! -f release ]; do sleep 0.01; done', order: 1, after: ['unit'] },
  ]);
  await untilGateFile(path.join(root, 'quality-start'));
  const second = await run([{ key: 'unit', command: 'touch second-unit', order: 0, resource: 'test' }]);
  assert.equal(second.ok, true);
  assert.equal(fs.existsSync(path.join(root, 'second-unit')), true, 'slot was released while quality-gate work remained active');
  fs.writeFileSync(path.join(root, 'release'), '');
  assert.equal((await first).ok, true);
});

test('resource gates serialize across runs and cancellation releases the slot (px-0019)', async t => {
  const { root, run, admission } = await resourceFixture(t, { resources: { test: 1 } });
  const first = run([{ key: 'a', command: 'touch a-start; while [ ! -f release ]; do sleep 0.01; done; touch a-end', order: 0, resource: 'test' }]);
  await untilGateFile(path.join(root, 'a-start'));
  const second = run([{ key: 'b', command: 'test -f a-end && touch b-ran', order: 0, resource: 'test' }]);
  await delay(30);
  assert.equal(fs.existsSync(path.join(root, 'b-ran')), false);
  fs.writeFileSync(path.join(root, 'release'), '');
  assert.equal((await first).ok, true);
  assert.equal((await second).ok, true, 'waiter starts only after the holder settled');
  const controller = new AbortController();
  const cancelled = runPhaseGates('integration', { slug: 'fixture', checkoutPath: root, signal: controller.signal, maxParallel: 1,
    gates: [{ key: 'c', command: 'touch c-start; sleep 30', order: 0, resource: 'test' }], log: () => {}, error: () => {},
    admission });
  await delay(60); controller.abort();
  assert.equal((await cancelled).ok, false);
  assert.equal((await run([{ key: 'd', command: 'touch d-ran', order: 0, resource: 'test' }])).ok, true);
  assert.equal(fs.existsSync(path.join(root, 'd-ran')), true);
});

test('undeclared or invalid resources fail before any gate child launches (px-0019)', async t => {
  const { root, run } = await resourceFixture(t, { resources: { test: 0 } });
  const launched = path.join(root, 'launched');
  const invalid = await run([{ key: 'x', command: `touch ${launched}`, order: 0, resource: 'test' }]);
  assert.equal(invalid.ok, false);
  assert.match(invalid.error!, /admission fails closed/);
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { gates: { resources: { test: 1 } } } }));
  const undeclared = await run([{ key: 'x', command: `touch ${launched}`, order: 0, resource: 'missing' }]);
  assert.equal(undeclared.ok, false);
  assert.match(undeclared.error!, /undeclared resource "missing"/);
  assert.equal(fs.existsSync(launched), false);
});

test('resource slots abandoned by dead owners are reclaimed and nested invocation is rejected (px-0019)', async t => {
  const { root, configuration, admission, run } = await resourceFixture(t, { resources: { test: 1 } });
  const { SqliteCustomAgentLeaseRepository } = await import('../../../src/adapters/sqlite/custom-agent-lease-repository.js');
  const { initCustomAdmissionState } = await import('../../../src/adapters/sqlite/custom-admission-state.js');
  const { db } = await initCustomAdmissionState(configuration);
  assert.ok(await new SqliteCustomAgentLeaseRepository(db, 'verification:test').acquire(root, 1, { pid: 2 ** 22 + 7, startId: '1' }));
  assert.equal((await run([{ key: 'ok', command: 'true', order: 0, resource: 'test' }])).ok, true);
  const nested = createGateAdmission(resolveConfiguration({ PARALLIX_CUSTOM_ADMISSION_HOME: path.join(root, 'leases'), PARALLIX_GATE_OWNER: 'inherited' }));
  await assert.rejects(nested.runOnResource(root, { name: 'test', capacity: 1 }, async () => {}), /Nested/);
  assert.equal((await admission.runOnResource(root, { name: 'test', capacity: 1 }, async () => 'free')), 'free');
});

test('canonical checkout owns declared resource limits while a worktree may only add new resources (px-0019)', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-canonical-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (args: string[]) => assert.equal(spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' }).status, 0);
  git(['init', '-q']);
  fs.writeFileSync(path.join(root, 'workflow.config.json'), '{}'); git(['add', '.']);
  git(['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture']);
  const worktree = path.join(root, 'worktree');
  git(['worktree', 'add', '-qb', 'mission/fixture', worktree]);
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { gates: { resources: { test: 1 } } } }));
  fs.writeFileSync(path.join(worktree, 'workflow.config.json'), JSON.stringify({ adapters: { gates: { resources: { test: 9, fresh: 2 } } } }));
  assert.deepEqual(resolveCanonicalGateResources(worktree), { test: 1, fresh: 2 });
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { gates: { resources: { test: 0 } } } }));
  assert.throws(() => resolveCanonicalGateResources(worktree), /resources admission fails closed/);
});

test('declared handoff gates and configured verification wait on the verification resource (px-0019)', async t => {
  const { root, configuration, admission, controller, runs } = await resourceFixture(t, { resources: { test: 1 }, verificationResource: 'test' });
  configureGateAdmission(admission);
  t.after(() => configureGateAdmission(null));
  let release!: () => void;
  let ready!: () => void;
  const held = new Promise<void>(resolve => { ready = resolve; });
  runs.push(admission.runOnResource(root, { name: 'test', capacity: 1 }, async run => {
    ready();
    await new Promise<void>(resolve => { release = resolve; run.signal.addEventListener('abort', () => resolve(), { once: true }); });
  }, controller.signal));
  await held;
  const declared = createHandoffPorts(configuration).declaredGateExecution!.run(['touch declared'], root, () => {})!;
  runs.push(declared);
  const verification = runConfiguredVerification(undefined, root, configuration);
  runs.push(verification);
  await delay(40);
  assert.equal(fs.existsSync(path.join(root, 'declared')), false, 'declared gates wait for the test slot');
  release();
  assert.equal((await declared).ok, true);
  assert.equal(fs.existsSync(path.join(root, 'declared')), true);
  await verification;
});
