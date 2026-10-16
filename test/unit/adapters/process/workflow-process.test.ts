import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { WorkflowProcessAdapter, workflowProcessSystem as system } from '../../../../src/adapters/process/workflow-process.js';
import { resolveConfiguration } from '../../../../src/composition/config.js';

test('stop signals descendants and reparented group members, preserves other missions and rejects recycled PID (TASK-2750 F9)', async t => {
  const live = new Map([[100, '1000'], [101, '1001'], [102, '1002'], [200, '2000']]);
  const signals: Array<[number, string | number]> = [];
  t.after(() => mock.restoreAll());
  mock.method(system, 'processStartIdentity', (pid: number) => live.get(pid) ?? null);
  mock.method(system, 'probeProcessLiveness', (pid: number, identity: string | null | undefined) => live.get(pid) === identity);
  mock.method(system, 'pause', async () => {});
  mock.method(system, 'readdir', async () => [...live.keys()].map(String));
  mock.method(system, 'readFile', async (file: string) => {
    const pid = Number(file.split('/')[2]);
    if (file.endsWith('/children')) { return pid === 100 ? '101' : ''; }
    const fields = Array<string>(20).fill('0'); fields[0] = 'S'; fields[2] = pid < 200 ? '100' : '200';
    return `${pid} (worker) ${fields.join(' ')}`;
  });
  mock.method(system, 'kill', (pid: number, signal: NodeJS.Signals | 0) => {
    signals.push([pid, signal]);
    if (signal === 'SIGTERM') { live.delete(pid); }
    if (signal === 0 && ![...live.keys()].some(p => p < 200 && pid === -100)) { throw new Error('ESRCH'); }
    return true;
  });
  const adapter = new WorkflowProcessAdapter({ command: 'unused', args: [] }, '/unused', resolveConfiguration({}));
  assert.equal(await adapter.stop({ pid: 100, identity: 'wrong' }), false);
  assert.deepEqual(signals.filter(([, signal]) => signal !== 0), []);
  assert.equal(await adapter.stop({ pid: 100, identity: '1000' }), true);
  assert.deepEqual(signals.filter(([, signal]) => signal === 'SIGTERM').map(([pid]) => pid).sort(), [100, 101, 102]);
  assert.equal(live.has(200), true);
});

test('launch surfaces spawn failure and stop delegates attributed external effects (TASK-2750 F7)', async t => {
  t.after(() => mock.restoreAll());
  const child = new EventEmitter();
  mock.method(system, 'spawn', () => { queueMicrotask(() => child.emit('error', new Error('cannot spawn'))); return child; });
  const adapter = new WorkflowProcessAdapter({ command: 'unused', args: [] }, '/unused', resolveConfiguration({}), async () => false, async () => true);
  await assert.rejects(() => adapter.launch('operation'), /cannot spawn/);
  assert.equal(await adapter.stopEffects({} as never), true);
  assert.equal(await adapter.effectsSettled({} as never), false);
});

for (const outcome of ['terminated', 'recycled', 'permission-denied'] as const) {
  test(`stop escalates a SIGTERM-resistant provider safely: ${outcome} (TASK-2750)`, async t => {
    t.after(() => mock.restoreAll());
    const live = new Map([[100, '1000'], [101, '1001'], [102, '1002'], [200, '2000']]);
    const signals: Array<[number, NodeJS.Signals | 0]> = [];
    let polls = 0;
    mock.method(system, 'processStartIdentity', (pid: number) => live.get(pid) ?? null);
    mock.method(system, 'probeProcessLiveness', (pid: number, identity: string) => live.get(pid) === identity);
    mock.method(system, 'pause', async () => {
      polls++;
      if (outcome === 'recycled' && polls === 40) { live.set(101, '9999'); }
    });
    mock.method(system, 'readdir', async () => [...live.keys()].map(String));
    mock.method(system, 'readFile', async (file: string) => {
      const pid = Number(file.split('/')[2]);
      if (file.endsWith('/children')) { return pid === 100 ? '101' : ''; }
      const fields = Array<string>(20).fill('0');
      fields[0] = 'S'; fields[2] = pid < 200 ? '100' : '200';
      return `${pid} (provider) ${fields.join(' ')}`;
    });
    mock.method(system, 'kill', (pid: number, signal: NodeJS.Signals | 0) => {
      if (signal === 0) {
        if (![...live.keys()].some(member => member < 200 && pid === -100)) { throw new Error('ESRCH'); }
        return true;
      }
      signals.push([pid, signal]);
      if (signal === 'SIGKILL') {
        if (outcome === 'permission-denied') { throw new Error('EPERM'); }
        live.delete(pid);
      }
      return true;
    });
    const adapter = new WorkflowProcessAdapter({ command: 'unused', args: [] }, '/unused', resolveConfiguration({}));
    assert.equal(await adapter.stop({ pid: 100, identity: '1000' }), outcome === 'terminated');
    assert.equal(polls, outcome === 'terminated' ? 41 : 80);
    assert.deepEqual(signals.filter(([, signal]) => signal === 'SIGKILL').map(([pid]) => pid),
      outcome === 'recycled' ? [102, 100] : [102, 101, 100]);
    assert.equal(live.has(200), true, 'another mission must survive escalation');
    if (outcome === 'recycled') { assert.equal(live.get(101), '9999'); }
  });
}

test('stop remains pending when permission prevents freezing its owner (TASK-2750)', async t => {
  t.after(() => mock.restoreAll());
  mock.method(system, 'processStartIdentity', () => '1000');
  mock.method(system, 'probeProcessLiveness', () => true);
  mock.method(system, 'readFile', async () => '100 (provider) S 0 100');
  mock.method(system, 'pause', async () => {});
  mock.method(system, 'kill', () => { throw new Error('EPERM'); });
  const adapter = new WorkflowProcessAdapter({ command: 'unused', args: [] }, '/unused', resolveConfiguration({}));
  assert.equal(await adapter.stop({ pid: 100, identity: '1000' }), false);
});
