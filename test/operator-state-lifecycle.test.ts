import test from 'node:test';
import assert from 'node:assert/strict';

import { registerOperatorStateShutdown } from '../src/composition/operator-state-lifecycle.js';

test('composition-owned operator-state shutdown calls the synchronous close path on forced process exit', () => {
  const handlers = new Map<string, () => void>();
  const processRef = { once(event: string, listener: () => void) { handlers.set(event, listener); } };
  let asyncCloses = 0;
  let syncCloses = 0;
  registerOperatorStateShutdown(async () => { asyncCloses += 1; }, () => { syncCloses += 1; }, processRef);

  handlers.get('exit')!();

  assert.equal(syncCloses, 1);
  assert.equal(asyncCloses, 0);
});

test('composition-owned operator-state shutdown registers only one hook pair per process', () => {
  const registrations: string[] = [];
  const processRef = { once(event: string) { registrations.push(event); } };
  const first = registerOperatorStateShutdown(async () => {}, () => {}, processRef);
  const second = registerOperatorStateShutdown(async () => { throw new Error('must not replace registered closer'); }, () => { throw new Error('must not replace registered closer'); }, processRef);

  assert.strictEqual(first, second);
  assert.deepEqual(registrations, ['beforeExit', 'exit']);
});

test('composition-owned operator-state shutdown uses the asynchronous close path before normal exit', async () => {
  const handlers = new Map<string, () => void>();
  const processRef = { once(event: string, listener: () => void) { handlers.set(event, listener); } };
  let asyncCloses = 0;
  let syncCloses = 0;
  const close = registerOperatorStateShutdown(async () => { asyncCloses += 1; }, () => { syncCloses += 1; }, processRef);

  handlers.get('beforeExit')!();
  await close();
  handlers.get('exit')!();

  assert.equal(asyncCloses, 1);
  assert.equal(syncCloses, 0);
});
