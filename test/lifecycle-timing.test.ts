import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LIFECYCLE_DEADLINE_MS,
  LifecycleDeadlineMissed,
  checkLifecycleDeadline,
  monotonicNowMs,
} from '../src/application/lifecycle-timing.js';

// The Mission lifecycle timing contract (TASK-2582): deferred destination
// persistence must complete within LIFECYCLE_DEADLINE_MS of destination-work
// start, measured end to end on a monotonic clock.

test('lifecycle deadline budget is 200 ms', () => {
  assert.equal(LIFECYCLE_DEADLINE_MS, 200);
});

test('monotonicNowMs is a monotonic clock: it never decreases across calls', () => {
  const a = monotonicNowMs();
  const b = monotonicNowMs();
  assert.ok(b >= a, `expected non-decreasing monotonic readings, got ${a} then ${b}`);
});

test('checkLifecycleDeadline passes when persistence lands within the budget', () => {
  assert.doesNotThrow(() => checkLifecycleDeadline({ startedAtMs: 1_000, nowMs: 1_100, what: 'active lifecycle boundary for task-1' }));
});

test('checkLifecycleDeadline passes at exactly the deadline boundary', () => {
  // The contract is "within 200 ms": exactly 200 ms has not exceeded it.
  assert.doesNotThrow(() => checkLifecycleDeadline({ startedAtMs: 0, nowMs: LIFECYCLE_DEADLINE_MS, what: 'boundary' }));
});

test('checkLifecycleDeadline throws LifecycleDeadlineMissed past the budget', () => {
  try {
    checkLifecycleDeadline({ startedAtMs: 0, nowMs: LIFECYCLE_DEADLINE_MS + 1, what: 'active lifecycle boundary for task-1' });
    assert.fail('expected LifecycleDeadlineMissed');
  } catch (error) {
    assert.ok(error instanceof LifecycleDeadlineMissed, `expected LifecycleDeadlineMissed, got ${String(error)}`);
    assert.match(error.message, /active lifecycle boundary for task-1 missed the 200 ms lifecycle persistence deadline/);
    assert.ok(error.elapsedMs > LIFECYCLE_DEADLINE_MS);
    assert.equal(error.deadlineMs, LIFECYCLE_DEADLINE_MS);
  }
});

test('checkLifecycleDeadline honours a caller-supplied budget', () => {
  assert.doesNotThrow(() => checkLifecycleDeadline({ startedAtMs: 0, nowMs: 150, deadlineMs: 200, what: 'boundary' }));
  assert.throws(
    () => checkLifecycleDeadline({ startedAtMs: 0, nowMs: 150, deadlineMs: 100, what: 'boundary' }),
    LifecycleDeadlineMissed,
  );
});
