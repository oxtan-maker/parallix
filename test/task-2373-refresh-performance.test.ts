import test from 'node:test';
import assert from 'node:assert/strict';
import { subscribeToBoardProjection } from '../src/application/projections/board-subscription.js';
import { makeProjection } from './fixtures/board-projection.js';

test('SC35: a slow board refresh never overlaps or accumulates a timer backlog', async () => {
  const timers: Array<() => void> = [];
  let active = 0;
  let peak = 0;
  let release: (() => void) | undefined;
  const unsubscribe = subscribeToBoardProjection(async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => { release = resolve; });
    active -= 1;
    return makeProjection();
  }, () => {}, { setTimer: callback => { timers.push(callback); return callback; }, clearTimer: () => {} });

  timers.shift()!();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(active, 1);
  assert.equal(timers.length, 0, 'a next tick is not scheduled while the current rebuild is pending');
  release!();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(timers.length, 1, 'exactly one follow-up refresh is scheduled after completion');
  assert.equal(peak, 1);
  unsubscribe();
});

test('SC33 and SC34: each completed timer tick rebuilds the authority projection', async () => {
  const timers: Array<() => void> = [];
  let builds = 0;
  const unsubscribe = subscribeToBoardProjection(async () => {
    builds += 1;
    return makeProjection();
  }, () => {}, { setTimer: callback => { timers.push(callback); return callback; }, clearTimer: () => {} });
  timers.shift()!();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(builds, 1);
  unsubscribe();
});
