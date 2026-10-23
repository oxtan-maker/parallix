import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp } from '../../helpers/temp-dir.js';
import { once } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';

const capacityModule = new URL('../../../src/adapters/agents/custom-capacity.ts', import.meta.url).href;
const configModule = new URL('../../../src/composition/config.ts', import.meta.url).href;

function contender(root: string, home: string, admission: string, policy: string, wait = false, childPid?: number) {
  const script = `
    import { tryAcquireCustomCapacity, waitForCustomCapacity } from ${JSON.stringify(capacityModule)};
    import { resolveConfiguration } from ${JSON.stringify(configModule)};
    const config = resolveConfiguration(process.env);
    const timer = setTimeout(() => process.exit(99), 8000);
    const acquire = root => tryAcquireCustomCapacity(root, config);
    const lease = ${wait} ? await waitForCustomCapacity(process.argv[1],
      () => process.send('waiting'), acquire, () => new Promise(r => setTimeout(r, 10)))
      : await acquire(process.argv[1]);
    if (lease && ${childPid ?? 'undefined'}) lease.bindChild(${childPid ?? 'undefined'});
    process.send(lease ? 'acquired' : 'rejected');
    process.on('disconnect', () => { lease?.release(); process.exit(0); });
    process.on('message', action => {
      if (action === 'release') lease?.release();
      process.exit(0);
    });
  `;
  return spawn(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script, root], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    env: { ...process.env, PARALLIX_HOME: home,
      PARALLIX_CUSTOM_ADMISSION_HOME: admission, PARALLIX_CUSTOM_ADMISSION_REPOSITORY: policy }
  });
}

function message(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    const onMessage = (value: unknown) => finish(undefined, String(value));
    const onExit = (code: number | null) => finish(new Error(`contender exited before admission response: ${code}`));
    const onError = (error: Error) => finish(error);
    function finish(error?: Error, value?: string) {
      child.off('message', onMessage); child.off('exit', onExit); child.off('error', onError);
      if (error) reject(error); else resolve(value!);
    }
    child.once('message', onMessage); child.once('exit', onExit); child.once('error', onError);
  });
}

async function stop(child: ChildProcess, action?: string) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  if (action && child.connected) child.send(action); else child.kill('SIGKILL');
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([exited, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('child exit deadline exceeded')); }, 2000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

function fixture(t: test.TestContext, capacity: number) {
  const temp = mkdtemp('custom-capacity-process-');
  const children: ChildProcess[] = [];
  t.after(async () => {
    try { for (const child of children) await stop(child); }
    finally { fs.rmSync(temp, { recursive: true, force: true }); }
  });
  const policy = path.join(temp, 'policy'); fs.mkdirSync(policy);
  fs.writeFileSync(path.join(policy, 'workflow.config.json'), JSON.stringify({ adapters: { agents: { maxConcurrentCustom: capacity } } }));
  const start = (name: string, wait = false, childPid?: number) => {
    const root = path.join(temp, name); fs.mkdirSync(root);
    // Disposable clients deliberately disagree; the canonical policy wins.
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({ adapters: { agents: { maxConcurrentCustom: 9 } } }));
    const child = contender(root, path.join(temp, `${name}-operator`), path.join(temp, 'admission'), policy, wait, childPid);
    children.push(child); return child;
  };
  return { start, children };
}

test('two processes contend for one custom slot: exactly one acquires', { timeout: 10000 }, async t => {
  const { start } = fixture(t, 1);
  assert.equal(await message(start('one')), 'acquired');
  assert.equal(await message(start('two')), 'rejected');
});

test('capacity two admits concurrent disposable processes and release progresses the third waiter (TASK-2727)', { timeout: 10000 }, async t => {
  const { start } = fixture(t, 2);
  const first = start('one'); assert.equal(await message(first), 'acquired');
  const second = start('two'); assert.equal(await message(second), 'acquired');
  const third = start('three', true); assert.equal(await message(third), 'waiting');
  const admitted = message(third);
  await stop(first, 'release');
  assert.equal(await admitted, 'acquired');
  await stop(second, 'release'); await stop(third, 'release');
});

test('launcher exit without a bound child reclaims admission for a waiter (TASK-2727)', { timeout: 10000 }, async t => {
  const { start } = fixture(t, 1);
  const first = start('one'); assert.equal(await message(first), 'acquired');
  const waiter = start('two', true); assert.equal(await message(waiter), 'waiting');
  const admitted = message(waiter);
  await stop(first);
  assert.equal(await admitted, 'acquired');
  await stop(waiter, 'release');
});

test('live bound child retains admission after launcher exit and child exit admits the waiter (TASK-2727)', { timeout: 10000 }, async t => {
  const { start, children } = fixture(t, 1);
  // The test owns/reaps the child even when its bound launcher is forcibly killed.
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 8000)'], { stdio: 'ignore' });
  children.push(child);
  const first = start('one', false, child.pid); assert.equal(await message(first), 'acquired');
  await stop(first);
  const waiter = start('two', true); assert.equal(await message(waiter), 'waiting');
  const admitted = message(waiter);
  await stop(child);
  assert.equal(await admitted, 'acquired');
  await stop(waiter, 'release');
});
