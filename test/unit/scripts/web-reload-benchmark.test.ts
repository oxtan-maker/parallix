import test from 'node:test';
import assert from 'node:assert/strict';
import { WEB_RELOAD_LIMIT_MS, WEB_RELOAD_SAMPLES, summarizeWebReload } from '../../../scripts/benchmark-web-reload.js';

test('web reload benchmark reports the median and p95 over its fixed sample population (TASK-2645)', () => {
  const samples = Array.from({ length: WEB_RELOAD_SAMPLES }, (_, index) => index + 1);
  const summary = summarizeWebReload(samples);
  assert.equal(summary.medianMs, 11);
  assert.equal(summary.p95Ms, 19);
  assert.equal(WEB_RELOAD_LIMIT_MS, 200);
});

test('web reload benchmark refuses an undersized population (TASK-2645)', () => {
  assert.throws(() => summarizeWebReload([1, 2, 3]), /at least/);
});
