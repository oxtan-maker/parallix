import type { ParallixConfiguration } from "../../../src/application/ports/configuration.js";
import type { SqliteDatabaseAdapter } from "../../../src/adapters/sqlite/database-adapter.js";
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tryAcquireCustomCapacity, resetCustomCapacity, waitForCustomCapacity, initCustomAdmissionState } from '../../../src/adapters/agents/custom-capacity.js';
import { clearOperatorStateCache } from '../../../src/adapters/sqlite/adapter-factory.js';

test('repositories sharing PARALLIX_HOME share custom capacity', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-capacity-home-'));
  const roots = ['one', 'two'].map(name => fs.mkdtempSync(path.join(os.tmpdir(), `custom-capacity-${name}-`)));
  for (const root of roots) fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { agents: { maxConcurrentCustom: 1 } } }));
  const oldHome = process.env.PARALLIX_HOME;
  process.env.PARALLIX_HOME = home;
  t.after(async () => {
    try {
      await resetCustomCapacity();
      await clearOperatorStateCache();
    } finally {
      if (oldHome === undefined) delete process.env.PARALLIX_HOME;
      else process.env.PARALLIX_HOME = oldHome;
      fs.rmSync(home, { recursive: true, force: true });
      for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
    }
  });
  const first = await tryAcquireCustomCapacity(roots[0]);
  assert.ok(first);
  assert.equal(await tryAcquireCustomCapacity(roots[1]), null);
  first.release();
});

import { resolveConfiguration } from '../../../src/composition/config.js';
import { clearCustomAdmissionStateCache } from '../../../src/adapters/sqlite/custom-admission-state.js';
import { initOperatorState } from '../../../src/adapters/sqlite/adapter-factory.js';
import { mkdtemp } from '../../helpers/temp-dir.js';
import { spawnSync } from 'node:child_process';

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
