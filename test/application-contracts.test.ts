const test = require('node:test');
const assert = require('node:assert/strict');

const { failure, rejected } = require('../.test-runtime/application/contracts');

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
