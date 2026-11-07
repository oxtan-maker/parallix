import assert from 'node:assert/strict';
import test from 'node:test';
import { observeMachineCpuUtilization } from '../../../../src/adapters/process/machine-cpu-utilization.js';

function cpu(idle: number, user: number) {
  return [{ model: 'fixture', speed: 1, times: { idle, user, nice: 0, sys: 0, irq: 0 } }];
}

test('machine CPU utilization is measured from two whole-machine snapshots (PX-0031)', async () => {
  const snapshots = [cpu(100, 100), cpu(170, 130)];
  assert.equal(await observeMachineCpuUtilization({ read: () => snapshots.shift()!, wait: async () => {} }), 0.3);
});

test('machine CPU utilization fails closed on unavailable or invalid samples (PX-0031)', async () => {
  assert.equal(await observeMachineCpuUtilization({ read: () => [], wait: async () => {} }), null);
  const snapshots = [cpu(100, 100), cpu(90, 110)];
  assert.equal(await observeMachineCpuUtilization({ read: () => snapshots.shift()!, wait: async () => {} }), null);
});
