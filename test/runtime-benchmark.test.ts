import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SAMPLES,
  LARGE_FIXTURE_MISSIONS,
  SMALL_FIXTURE_MISSIONS,
  fixtureScale,
  summarize,
  unavailableCounters,
} from '../scripts/benchmark-runtime.js';

test('runtime benchmark summary reports median and maximum below twenty samples', () => {
  assert.deepEqual(summarize([9, 1, 5, 3, 7]), { samplesMs: [9, 1, 5, 3, 7], medianMs: 5, tailMs: 9 });
});

test('runtime benchmark fixture scale is exactly ten to one', () => {
  assert.deepEqual(fixtureScale(), { small: SMALL_FIXTURE_MISSIONS, large: LARGE_FIXTURE_MISSIONS });
  assert.equal(LARGE_FIXTURE_MISSIONS / SMALL_FIXTURE_MISSIONS, 10);
  assert.ok(DEFAULT_SAMPLES >= 5);
});

test('runtime benchmark explicitly reports unavailable child-process counters', () => {
  assert.deepEqual(unavailableCounters(), {
    gitSubprocesses: 'unavailable', gitWorktreeList: 'unavailable', sqliteQueries: 'unavailable', taskDocumentReads: 'unavailable',
  });
});
