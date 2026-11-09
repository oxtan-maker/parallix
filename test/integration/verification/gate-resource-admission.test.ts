// Resource-scoped admission: one lease partition per named gate resource, split from whole-run admission to bound suite time.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createReviewPreparationPorts } from '../../../src/adapters/cli/commands/review-preparation.js';
import { configureGateAdmission, type GateAdmissionPort, type GateAdmissionRun } from '../../../src/application/ports/gate-admission.js';
import { configureMissionWriteAuthorization } from '../../../src/application/ports/mission-write-authorization.js';
import { configureVerificationObservation, VERIFICATION_MEASUREMENT_EVENT,
  type VerificationMeasurement } from '../../../src/application/ports/verification-observation.js';
import { runConfiguredVerification } from '../../../src/adapters/verification/configured-verification.js';
import { resolveCanonicalGateResources } from '../../../src/adapters/config/product-config.js';
import { runPhaseGates } from '../../../src/adapters/config/repository-gates.js';
import { clearOperatorStateCache, initOperatorState } from '../../../src/adapters/sqlite/adapter-factory.js';
import { clearCustomAdmissionStateCache, initCustomAdmissionState } from '../../../src/adapters/sqlite/custom-admission-state.js';
import { SqliteOperationalHistoryRepository } from '../../../src/adapters/sqlite/operational-history-repository.js';
import { createGateAdmission } from '../../../src/composition/gate-admission.js';
import { resolveConfiguration } from '../../../src/composition/config.js';
import { createVerificationObservation } from '../../../src/composition/verification-observation.js';

async function untilGateFile(file: string): Promise<void> {
  while (!fs.existsSync(file)) { await delay(5); }
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
  const run = (gates: { key: string; command: string; order: number; resource?: string; after?: string[] }[], maxParallel = 3) => {
    const result = runPhaseGates('integration', { configuration, admission, signal: controller.signal, slug: 'fixture',
      checkoutPath: root, gates, maxParallel, log: () => {}, error: () => {} });
    runs.push(result);
    return result;
  };
  return { root, admission, configuration, controller, runs, run };
}

test('default admission stays independent from inherited workflow gate observations (TASK-2840)', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-default-admission-'));
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
    adapters: { gates: { resources: { test: 1 } } },
  }));
  const configuration = resolveConfiguration({ PARALLIX_HOME: path.join(root, 'operator') });
  const { db } = await initOperatorState({ configuration });
  const history = new SqliteOperationalHistoryRepository(db);
  configureMissionWriteAuthorization({
    operationId: 'inherited-operation', generation: 1, inherited: true,
    async assert(_mission, read) { await read?.('inherited-operation'); },
  });
  configureVerificationObservation(createVerificationObservation(history,
    () => ({ repositoryId: 'repository', missionId: 'fixture', revision: 'revision' })));
  t.after(async () => {
    configureVerificationObservation(null);
    configureMissionWriteAuthorization(null);
    await clearCustomAdmissionStateCache();
    await clearOperatorStateCache();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const result = await runPhaseGates('integration', {
    configuration, admission: createGateAdmission(configuration), checkoutPath: root, slug: 'fixture', maxParallel: 2,
    gates: [
      { key: 'unit', command: 'touch unit-started', order: 0, resource: 'test' },
      { key: 'integration-ci', command: 'touch integration-started', order: 1, resource: 'test' },
    ],
    log: () => {}, error: () => {},
  });
  assert.equal(result.ok, true, `default admission must not share an observation transaction: ${result.error}; ${result.failedGate?.stderr}`);
  assert.equal(fs.existsSync(path.join(root, 'unit-started')), true);
  assert.equal(fs.existsSync(path.join(root, 'integration-started')), true);

  const observations = (await history.findByType(VERIFICATION_MEASUREMENT_EVENT))
    .map(entry => JSON.parse(entry.eventData) as VerificationMeasurement);
  const terminal = observations.filter(value => value.finishedAt);
  assert.deepEqual(terminal.map(value => value.gate).sort(), ['integration-ci', 'unit']);
  assert.ok(terminal.every(value => value.startedAt && value.startedAt <= value.finishedAt!),
    'every launched child has a durable start before its terminal observation');

  const admissionState = await initCustomAdmissionState(configuration);
  const leaseCount = () => admissionState.db.query<{ count: number }>('SELECT COUNT(*) AS count FROM custom_agent_leases');
  assert.equal((await leaseCount())[0].count, 0, 'successful commands release default-home leases');

  await db.beginImmediateTransaction();
  const controller = new AbortController();
  const waiting = createGateAdmission(configuration).runOnResource(root, { name: 'test', capacity: 1 }, async () => {
    assert.fail('a cancelled contender must not enter while the operator writer is held');
  }, controller.signal);
  const cancelledAt = Date.now();
  controller.abort();
  await assert.rejects(waiting, { name: 'AbortError' });
  assert.ok(Date.now() - cancelledAt < 250, 'default-home writer contention and cancellation stay bounded');
  await db.rollbackTransaction();

  await assert.rejects(createGateAdmission(configuration).runOnResource(root, { name: 'test', capacity: 1 }, async () => {
    throw new Error('fixture gate failed');
  }), /fixture gate failed/);
  assert.equal((await leaseCount())[0].count, 0, 'cancelled and failed commands release default-home leases');
  const groups = await admissionState.db.query<{ count: number }>('SELECT COUNT(*) AS count FROM admission_process_groups');
  assert.equal(groups[0].count, 0, 'completed admission leaves no process-group residue');
});

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

const recorded = (key: string, body: string) => `echo "start ${key}" >> events; ${body}; echo "end ${key}" >> events`;
const detached = (body: string) => `(${body}) >/dev/null 2>&1 3>&- 4>&- 5>&- &`;

test('same-phase test gates run one command tree at a time at capacity one (TASK-2840)', async t => {
  const { root, run } = await resourceFixture(t, { resources: { test: 1, other: 1 } });
  const testActive = 'for i in $(seq 100); do s=$(grep -c start events 2>/dev/null); e=$(grep -c end events 2>/dev/null); '
    + '[ "${s:-0}" -gt "${e:-0}" ] && { touch independent-overlap; exit 0; }; sleep 0.01; done; exit 1';
  const finishAfterOverlap = 'for i in $(seq 100); do test -f independent-overlap '
    + '&& { echo "end unit" >> events; exit 0; }; sleep 0.01; done; exit 1';
  const result = await run([
    { key: 'unit', command: `echo "start unit" >> events; ${detached(finishAfterOverlap)}`, order: 0, resource: 'test' },
    { key: 'integration-ci', command: recorded('integration-ci', 'sleep 0.02'), order: 1, resource: 'test' },
    { key: 'independent', command: testActive, order: 2, resource: 'other' },
  ], 3);
  const events = fs.readFileSync(path.join(root, 'events'), 'utf8').trim().split('\n');
  for (let index = 0; index < events.length; index += 2) {
    assert.equal(events[index + 1], events[index].replace('start', 'end'),
      `a command and its descendants settle before the next same-resource gate starts: ${events.join(', ')}`);
  }
  assert.equal(events.length, 4);
  assert.equal(result.ok, true, `an independent resource overlaps test gates: ${String(result.error)}`);
});

test('resource waiters leave phase capacity to producers and reserve nothing across dependencies (TASK-2840)', async t => {
  const { root, run } = await resourceFixture(t, { resources: { test: 1 } });
  const awaitFile = (file: string) => `for i in $(seq 100); do test -f ${file} && exit 0; sleep 0.01; done; exit 1`;
  const parallel = await run([
    { key: 'unit', command: awaitFile('build-done'), order: 0, resource: 'test' },
    { key: 'integration-ci', command: 'true', order: 1, resource: 'test' },
    { key: 'build', command: 'touch build-done', order: 2 },
  ], 2);
  assert.equal(parallel.ok, true, `ready producer progresses while a gate waits: ${String(parallel.error)}`);
  const serial = await run([
    { key: 'unit', command: 'touch serial-unit', order: 0, resource: 'test' },
    { key: 'build', command: 'test -f serial-unit', order: 1 },
  ], 1);
  assert.equal(serial.ok, true, 'serial phases retain declared order');
  const first = run([
    { key: 'build', command: awaitFile('build-go'), order: 0 },
    { key: 'unit', command: 'touch first-unit', order: 1, after: ['build'], resource: 'test' },
  ]);
  assert.equal((await run([{ key: 'unit', command: 'touch second-unit', order: 0, resource: 'test' }])).ok, true);
  assert.equal(fs.existsSync(path.join(root, 'first-unit')), false, 'unmet dependencies reserve no resource');
  fs.writeFileSync(path.join(root, 'build-go'), '');
  assert.equal((await first).ok, true);
});

test('cancellation removes an admitted gate queued for phase capacity before child launch (TASK-2840)', async t => {
  const { root, admission, controller: fixture, runs } = await resourceFixture(t, { resources: { test: 1 } });
  const controller = new AbortController();
  const observedAdmission: GateAdmissionPort = {
    assertIndependent: admission.assertIndependent.bind(admission), run: admission.run.bind(admission),
    async runOnResource<T>(_checkout: string, _resource: { name: string; capacity: number },
      action: (run: GateAdmissionRun) => Promise<T>): Promise<T> {
      await untilGateFile(path.join(root, 'blocker-a'));
      await untilGateFile(path.join(root, 'blocker-b'));
      fs.writeFileSync(path.join(root, 'admitted'), '');
      return action({ signal: controller.signal, environment: {}, bindProcessGroup: () => {} });
    },
  };
  const cancelled = runPhaseGates('integration', {
    slug: 'fixture', checkoutPath: root, signal: AbortSignal.any([controller.signal, fixture.signal]), maxParallel: 2,
    gates: [
      { key: 'queued', command: 'touch queued-ran', order: 0, resource: 'test' },
      { key: 'blocker-a', command: 'touch blocker-a; sleep 30', order: 1 },
      { key: 'blocker-b', command: 'touch blocker-b; sleep 30', order: 2 },
    ], log: () => {}, error: () => {}, admission: observedAdmission,
  });
  runs.push(cancelled);
  await untilGateFile(path.join(root, 'admitted'));
  controller.abort();
  assert.equal((await cancelled).ok, false);
  assert.equal(fs.existsSync(path.join(root, 'queued-ran')), false);
});

test('resource gates serialize across runs; failure and cancellation retain descendants (TASK-2840)', async t => {
  const { root, run, admission, controller: fixture, runs } = await resourceFixture(t, { resources: { test: 1 } });
  const failed = run([{ key: 'f', command: `${detached('sleep 0.1')} echo $! > f-child; exit 3`, order: 0, resource: 'test' }]);
  await untilGateFile(path.join(root, 'f-child'));
  const afterFailure = run([{ key: 'g', command: '! kill -0 "$(cat f-child)" 2>/dev/null', order: 0, resource: 'test' }]);
  assert.equal((await failed).ok, false);
  assert.equal((await afterFailure).ok, true, 'failure holds its slot until descendants settle');
  const controller = new AbortController();
  const cancelled = runPhaseGates('integration', { slug: 'fixture', checkoutPath: root,
    signal: AbortSignal.any([controller.signal, fixture.signal]), maxParallel: 1,
    gates: [{ key: 'c', command: 'sleep 30 & echo $! > c-child; wait', order: 0, resource: 'test' }], log: () => {}, error: () => {},
    admission });
  runs.push(cancelled);
  await untilGateFile(path.join(root, 'c-child'));
  const waiting = run([{ key: 'd', command: '! kill -0 "$(cat c-child)" 2>/dev/null && touch d-ran', order: 0, resource: 'test' }]);
  await delay(30);
  assert.equal(fs.existsSync(path.join(root, 'd-ran')), false);
  controller.abort();
  assert.equal((await cancelled).ok, false);
  assert.equal((await waiting).ok, true, 'waiting work starts after the cancelled child settles');
});

test('an integration failure on a resource releases its slot to waiters and blocks only dependents (px-0050.01)', async t => {
  const { root, run } = await resourceFixture(t, { resources: { test: 1 } });
  const result = await run([
    { key: 'unit', command: 'touch unit-ran; printf red >&2; exit 5', order: 0, resource: 'test' },
    { key: 'integration-ci', command: 'touch second-ran', order: 1, resource: 'test' },
    { key: 'sonar', command: 'touch dependent-ran', order: 2, after: ['unit'] },
    { key: 'audit', command: 'touch audit-ran', order: 3 },
  ], 2);
  assert.equal(result.ok, false);
  assert.deepEqual(result.failures?.map(outcome => outcome.key), ['unit']);
  assert.deepEqual(result.blocked?.map(gate => gate.key), ['sonar']);
  for (const file of ['unit-ran', 'second-ran', 'audit-ran']) { assert.equal(fs.existsSync(path.join(root, file)), true, `${file}: the waiter still ran after the failure`); }
  assert.equal(fs.existsSync(path.join(root, 'dependent-ran')), false);
  assert.equal(result.cancelled, false);
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

test("declared review preparation gates and configured verification wait on the verification resource (px-0019)", async t => {
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
  const declared = createReviewPreparationPorts(configuration).declaredGateExecution!.run(['touch declared'], root, () => {})!;
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
