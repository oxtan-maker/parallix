import { resolveConfiguration } from '../../../../src/composition/config.js';
const environment: NodeJS.ProcessEnv = { ...process.env };
// Custom capacity contract: cross-repo capacity leases and lease liveness identity.
//
// Behavior-owned suite (TASK-2622.11). Legacy case names are unchanged.

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tryAcquireCustomCapacity, resetCustomCapacity } from '../../../../src/adapters/agents/custom-capacity.js';
import { mkdtemp as registeredMkdtemp } from '../../../helpers/temp-dir.js';
import { processIdentity, isSameLiveProcess } from '../../../../src/adapters/process/process-liveness.js';

describe('Custom capacity across repositories', () => {
  test('repositories sharing PARALLIX_HOME share custom capacity', async (t) => {
    const home = registeredMkdtemp('custom-capacity-home-');
    const roots = ['one', 'two'].map(name => registeredMkdtemp(`custom-capacity-${name}-`));
    for (const root of roots) fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { agents: { maxConcurrentCustom: 1 } } }));
    const oldHome = environment.PARALLIX_HOME;
    environment.PARALLIX_HOME = home;
    t.after(async () => { await resetCustomCapacity(resolveConfiguration(environment)); environment.PARALLIX_HOME = oldHome; fs.rmSync(home, { recursive: true, force: true }); for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); });
    const first = await tryAcquireCustomCapacity(roots[0], resolveConfiguration(environment));
    assert.ok(first);
    assert.equal(await tryAcquireCustomCapacity(roots[1], resolveConfiguration(environment)), null);
    first.release();
  });
});

describe('Custom capacity lease liveness identity', () => {
  test('a lease liveness identity rejects a reused PID', () => {
    const identity = processIdentity(process.pid);
    assert.ok(identity);
    assert.equal(isSameLiveProcess(process.pid, identity.startId), true);
    assert.equal(isSameLiveProcess(process.pid, `${Number(identity.startId) + 1}`), false);
  });
});
