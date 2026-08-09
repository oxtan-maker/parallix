


import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { mockModule, installModuleMocks } from './lib/module-mock.js';
const failureModule = mockModule<typeof import('../src/application/contracts.js')>('../src/application/contracts.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const { failure, rejected } = failureModule;
test('application outcomes have one terminal status and typed error variants', () => {
  const validation = rejected('validation', 'bad request');
  const capability = rejected('capability', 'not allowed');
  const unavailable = failure('unavailable', 'offline');
  const cancelled = failure('cancelled', 'stopped');
  assert.deepEqual([validation.status, capability.status, unavailable.status, cancelled.status], ['rejected', 'rejected', 'failed', 'cancelled']);
  assert.equal(validation.error.kind, 'validation');
  assert.equal(capability.error.kind, 'capability');
  assert.equal(unavailable.error.kind, 'unavailable');
  assert.equal(cancelled.error.kind, 'cancelled');
});

test('stats projections preserve source and staleness labels as view data', () => {
  const projection = { rows: [], sources: [{ source: 'stats', status: 'stale', value: '2026-07-20' }] };
  assert.equal(projection.sources[0].source, 'stats');
  assert.equal(projection.sources[0].status, 'stale');
});
