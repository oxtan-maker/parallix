import type { ParallixConfiguration } from "../../../src/application/ports/configuration.js";
import type { SqliteDatabaseAdapter } from "../../../src/adapters/sqlite/database-adapter.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { activeCustomCapacityCount, tryAcquireCustomCapacity, resetCustomCapacity, waitForCustomCapacity, initCustomAdmissionState } from '../../../src/adapters/agents/custom-capacity.js';
import { clearOperatorStateCache } from '../../../src/adapters/sqlite/adapter-factory.js';

test('repositories sharing PARALLIX_HOME share custom capacity', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-capacity-home-'));
  const roots = ['one', 'two'].map(name => fs.mkdtempSync(path.join(os.tmpdir(), `custom-capacity-${name}-`)));
  for (const root of roots) fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { agents: { maxConcurrentCustom: 1 } } }));
  const configuration = resolveConfiguration({ PARALLIX_HOME: home });
  let first: Awaited<ReturnType<typeof tryAcquireCustomCapacity>> = null;
  t.after(async () => {
    try {
      first?.release();
      await clearCustomAdmissionStateCache();
      await clearOperatorStateCache();
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
      for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
    }
  });
  first = await tryAcquireCustomCapacity(roots[0], configuration);
  assert.ok(first);
  assert.equal(await tryAcquireCustomCapacity(roots[1], configuration), null);
  first.release();
});

test('unrelated fixture failure and cleanup preserve a live operator lease (PX-0053)', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-capacity-cleanup-'));
  const policy = path.join(temp, 'policy');
  fs.mkdirSync(policy);
  fs.writeFileSync(path.join(policy, 'workflow.config.json'), JSON.stringify({
    adapters: { agents: { maxConcurrentCustom: 1 } }
  }));
  const operatorUserHome = path.join(temp, 'operator-user');
  const fixtureUserHome = path.join(temp, 'fixture-user');
  const fixtureOperatorHome = path.join(temp, 'fixture-operator');
  const fixtureAdmissionHome = path.join(temp, 'fixture-admission');
  for (const directory of [operatorUserHome, fixtureUserHome, fixtureOperatorHome, fixtureAdmissionHome]) {
    fs.mkdirSync(directory);
  }
  const operatorConfiguration = resolveConfiguration({
    HOME: operatorUserHome,
    PARALLIX_CUSTOM_ADMISSION_REPOSITORY: policy,
  });
  const fixtureConfiguration = resolveConfiguration({
    HOME: fixtureUserHome,
    PARALLIX_HOME: fixtureOperatorHome,
    PARALLIX_CUSTOM_ADMISSION_HOME: fixtureAdmissionHome,
    PARALLIX_CUSTOM_ADMISSION_REPOSITORY: policy,
  });
  const originalHome = process.env.HOME;
  const originalParallixHome = process.env.PARALLIX_HOME;
  const originalAdmissionHome = process.env.PARALLIX_CUSTOM_ADMISSION_HOME;
  process.env.HOME = operatorUserHome;
  process.env.PARALLIX_HOME = fixtureOperatorHome;
  process.env.PARALLIX_CUSTOM_ADMISSION_HOME = fixtureAdmissionHome;

  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const childExit = new Promise<void>(resolve => child.once('exit', () => resolve()));
  const owner = await tryAcquireCustomCapacity(policy, operatorConfiguration);
  assert.ok(owner);
  assert.ok(child.pid);
  owner.bindChild(child.pid);
  t.after(async () => {
    owner.release();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await childExit;
    }
    await clearCustomAdmissionStateCache();
    await clearOperatorStateCache();
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    if (originalParallixHome === undefined) delete process.env.PARALLIX_HOME;
    else process.env.PARALLIX_HOME = originalParallixHome;
    if (originalAdmissionHome === undefined) delete process.env.PARALLIX_CUSTOM_ADMISSION_HOME;
    else process.env.PARALLIX_CUSTOM_ADMISSION_HOME = originalAdmissionHome;
    fs.rmSync(temp, { recursive: true, force: true });
  });

  assert.equal(await tryAcquireCustomCapacity(policy, operatorConfiguration), null,
    'the live bound child owns the only operator slot');
  await assert.rejects(async () => {
    const unrelated = await tryAcquireCustomCapacity(policy, fixtureConfiguration);
    assert.ok(unrelated, 'the unrelated fixture owns separate explicit state');
    try {
      throw new Error('synthetic unrelated fixture failure');
    } finally {
      unrelated.release();
      try {
        // Deliberately omitted to retain the regression probe: cleanup without
        // explicit fixture ownership must fail before resolving any state path.
        await (resetCustomCapacity as () => Promise<void>)();
      } catch (error) {
        assert.match(String(error), /explicit fixture configuration/i);
      }
    }
  }, /synthetic unrelated fixture failure/);

  assert.equal(await activeCustomCapacityCount(operatorConfiguration), 1,
    'unrelated cleanup must preserve the live operator lease');
  await assert.rejects((activeCustomCapacityCount as () => Promise<number>)(),
    /explicit fixture configuration/i);
  assert.equal(await tryAcquireCustomCapacity(policy, operatorConfiguration), null,
    'the competitor stays blocked after unrelated setup, failure, and cleanup');
});

test('default-home custom capacity polls through operator writer contention (TASK-2840)', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-capacity-contention-'));
  const root = path.join(temp, 'repository');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { agents: { maxConcurrentCustom: 1 } } }));
  const configuration = resolveConfiguration({ PARALLIX_HOME: path.join(temp, 'operator') });
  const { db } = await initOperatorState({ configuration });
  let writerHeld = false;
  t.after(async () => {
    if (writerHeld) { await db.rollbackTransaction(); }
    await clearCustomAdmissionStateCache();
    await clearOperatorStateCache();
    fs.rmSync(temp, { recursive: true, force: true });
  });

  await db.beginImmediateTransaction();
  writerHeld = true;
  let waits = 0;
  const reservation = await waitForCustomCapacity(root, () => { waits++; },
    candidate => tryAcquireCustomCapacity(candidate, configuration), async () => {
      await db.rollbackTransaction();
      writerHeld = false;
    });
  assert.equal(waits, 1, 'SQLite writer contention enters the existing capacity wait path');
  reservation.release();
  const state = await initCustomAdmissionState(configuration);
  assert.deepEqual(await state.db.query('SELECT * FROM custom_agent_leases'), []);
});

test('default-home lease bindings and release tolerate external writer contention (TASK-2840)', async t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-capacity-bind-contention-'));
  const root = path.join(temp, 'repository');
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { agents: { maxConcurrentCustom: 1 } } }));
  const configuration = resolveConfiguration({ PARALLIX_HOME: path.join(temp, 'operator') });
  const children: ReturnType<typeof spawn>[] = [];
  t.after(async () => {
    for (const child of children) { if (child.exitCode === null) { child.kill('SIGKILL'); } }
    await clearCustomAdmissionStateCache();
    await clearOperatorStateCache();
    fs.rmSync(temp, { recursive: true, force: true });
  });

  const reservation = await tryAcquireCustomCapacity(root, configuration);
  assert.ok(reservation);
  const state = await initCustomAdmissionState(configuration);
  const { SqliteCustomAgentLeaseRepository } = await import('../../../src/adapters/sqlite/custom-agent-lease-repository.js');
  const { processIdentity } = await import('../../../src/adapters/process/process-liveness.js');
  const identity = processIdentity(process.pid)!;
  const gates = new SqliteCustomAgentLeaseRepository(state.db, 'verification:test', state.leaseDb);
  const gateLease = await gates.acquire(root, 1, identity);
  assert.ok(gateLease);

  const script = `import { DatabaseSync } from 'node:sqlite'; import fs from 'node:fs'; import path from 'node:path';
    const sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
    const db = new DatabaseSync(process.argv[1]); db.exec('PRAGMA busy_timeout=5000;');
    for (let turn = 0; turn < 2; turn++) { db.exec('BEGIN IMMEDIATE;');
      fs.writeFileSync(path.join(process.argv[2], 'ready-' + turn), 'ready'); sleep(150); db.exec('ROLLBACK;');
      while (!fs.existsSync(path.join(process.argv[2], 'continue-' + turn))) sleep(5); }
    db.close();`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, state.db.getPath()!, temp], { stdio: 'pipe' });
  children.push(child);
  const exit = new Promise<number | null>(resolve => child.once('exit', resolve));
  const actions = [
    () => gates.bindProcessGroup(gateLease, { pid: process.pid, startId: identity.startId! }),
    () => gates.release(gateLease),
  ];
  let failure: unknown;
  for (const [turn, action] of actions.entries()) {
    const ready = path.join(temp, `ready-${turn}`);
    while (!fs.existsSync(ready)) {
      assert.equal(child.exitCode, null, 'external writer must acquire each transaction');
      await delay(5);
    }
    try { action(); } catch (error) { failure ??= error; }
    fs.writeFileSync(path.join(temp, `continue-${turn}`), 'continue');
  }
  assert.equal(await exit, 0);
  if (failure) { throw failure; }
  reservation.bindChild(process.pid);
  reservation.release();
  assert.deepEqual(await state.db.query('SELECT * FROM custom_agent_leases'), []);
  assert.deepEqual(await state.db.query('SELECT * FROM admission_process_groups'), []);
});

import { resolveConfiguration } from '../../../src/composition/config.js';
import { clearCustomAdmissionStateCache } from '../../../src/adapters/sqlite/custom-admission-state.js';
import { initOperatorState } from '../../../src/adapters/sqlite/adapter-factory.js';
import { mkdtemp } from '../../helpers/temp-dir.js';
test('disposable repositories and mission worktrees share canonical capacity two without sharing operator state (TASK-2727)', async (t) => {
  const temp = mkdtemp('smoke-admission-');
  const reservations: { release(): void }[] = [];
  t.after(async () => {
    for (const reservation of reservations) reservation.release();
    await clearCustomAdmissionStateCache();
    await clearOperatorStateCache();
    fs.rmSync(temp, { recursive: true, force: true });
  });
  const policy = path.join(temp, 'policy');
  fs.mkdirSync(policy);
  fs.writeFileSync(path.join(policy, 'workflow.config.json'), JSON.stringify({ adapters: { agents: { maxConcurrentCustom: 2 } } }));
  const clients: { worktree: string; home: string; configuration: ParallixConfiguration; db: SqliteDatabaseAdapter; }[] = [];
  for (const name of ['one', 'two', 'three']) {
    const root = path.join(temp, name);
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { agents: { maxConcurrentCustom: 1 } } }));
    const git = (args: string[]) => assert.equal(spawnSync('git', ['-C', root, ...args]).status, 0);
    git(['init']);
    git(['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'add', '.']);
    git(['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture']);
    const worktree = path.join(temp, `${name}-mission`);
    git(['worktree', 'add', '-b', 'mission', worktree]);
    const home = path.join(temp, `${name}-home`);
    fs.mkdirSync(home);
    fs.writeFileSync(path.join(home, 'agents.local.json'), name);
    fs.writeFileSync(path.join(home, 'credentials.json'), name);
    const configuration = resolveConfiguration({ PARALLIX_HOME: home,
      PARALLIX_CUSTOM_ADMISSION_HOME: path.join(temp, 'admission'), PARALLIX_CUSTOM_ADMISSION_REPOSITORY: policy });
    const { db } = await initOperatorState({ configuration });
    clients.push({ worktree, home, configuration, db });
  }
  const first = await tryAcquireCustomCapacity(clients[0].worktree, clients[0].configuration);
  const second = await tryAcquireCustomCapacity(clients[1].worktree, clients[1].configuration);
  assert.ok(first); assert.ok(second);
  reservations.push(first, second);
  assert.equal(await tryAcquireCustomCapacity(clients[2].worktree, clients[2].configuration), null);
  let waits = 0;
  const waiter = await waitForCustomCapacity(clients[2].worktree, () => { waits++; },
    root => tryAcquireCustomCapacity(root, clients[2].configuration), async () => { first.release(); });
  reservations.push(waiter);
  assert.equal(waits, 1);
  const shared = await initCustomAdmissionState(clients[0].configuration);
  const tables = await shared.db.query<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'");
  assert.ok(tables.some(table => table.name === 'custom_agent_leases'));
  assert.ok(!tables.some(table => ['missions', 'session_markers', 'agent_blocks', 'measurements'].includes(table.name)));
  for (const client of clients) {
    assert.notEqual(client.db, shared.db);
    assert.deepEqual(await client.db.query('SELECT * FROM custom_agent_leases'), []);
    assert.equal(fs.readFileSync(path.join(client.home, 'agents.local.json'), 'utf8'), path.basename(client.home).replace('-home', ''));
    assert.equal(fs.readFileSync(path.join(client.home, 'credentials.json'), 'utf8'), path.basename(client.home).replace('-home', ''));
  }
});


test('verification leases exclude independently of agent capacity and recover stale owners (TASK-2791)', async t => {
  const temp = mkdtemp('gate-admission-');
  fs.writeFileSync(path.join(temp, 'workflow.config.json'), JSON.stringify({ adapters: { gates: { maxConcurrent: 1 } } }));
  const configuration = resolveConfiguration({ PARALLIX_CUSTOM_ADMISSION_HOME: temp });
  t.after(async () => { await clearCustomAdmissionStateCache(); fs.rmSync(temp, { recursive: true, force: true }); });
  const { SqliteCustomAgentLeaseRepository } = await import('../../../src/adapters/sqlite/custom-agent-lease-repository.js');
  const { processIdentity } = await import('../../../src/adapters/process/process-liveness.js');
  const { createGateAdmission } = await import('../../../src/composition/gate-admission.js');
  const { db } = await initCustomAdmissionState(configuration);
  const gates = new SqliteCustomAgentLeaseRepository(db, 'verification');
  const agents = new SqliteCustomAgentLeaseRepository(db);
  const owner = processIdentity(process.pid)!;
  const first = await gates.acquire('/one', 1, owner);
  assert.ok(first);
  assert.equal(await gates.acquire('/two', 1, owner), null);
  const agent = await agents.acquire('/two', 1, owner);
  assert.ok(agent, 'gate exclusion consumes no agent capacity');
  const admission = createGateAdmission(configuration);
  const controller = new AbortController();
  let started = false;
  const waiting = admission.run(temp, async () => { started = true; }, controller.signal);
  controller.abort();
  await assert.rejects(waiting, /abort/i);
  assert.equal(started, false);
  const progress = admission.run(temp, async () => { started = true; });
  gates.release(first);
  await progress;
  assert.equal(started, true);
  const stale = await gates.acquire('/one', 1, { pid: 2147483647, startId: 'missing' });
  assert.ok(stale);
  const recovered = await gates.acquire('/two', 1, owner);
  assert.ok(recovered);
  gates.release(recovered); agents.release(agent);
  assert.equal((await db.query('SELECT * FROM custom_agent_leases')).length, 0);
});
