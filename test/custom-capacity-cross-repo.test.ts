import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { tryAcquireCustomCapacity, resetCustomCapacity } from '../src/adapters/agents/custom-capacity.js';

test('repositories sharing PARALLIX_HOME share custom capacity', async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'custom-capacity-home-'));
  const roots = ['one', 'two'].map(name => fs.mkdtempSync(path.join(os.tmpdir(), `custom-capacity-${name}-`)));
  for (const root of roots) fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { agents: { maxConcurrentCustom: 1 } } }));
  const oldHome = process.env.PARALLIX_HOME;
  process.env.PARALLIX_HOME = home;
  t.after(async () => { await resetCustomCapacity(); process.env.PARALLIX_HOME = oldHome; fs.rmSync(home, { recursive: true, force: true }); for (const root of roots) fs.rmSync(root, { recursive: true, force: true }); });
  const first = await tryAcquireCustomCapacity(roots[0]);
  assert.ok(first);
  assert.equal(await tryAcquireCustomCapacity(roots[1]), null);
  first.release();
});
