import test from 'node:test';
import assert from 'node:assert/strict';
import { decisionWindowContains, decisionWindowDayEnd, decisionWindowDay, decisionRetentionBoundary, weeklyDecisionWindows } from '../../../src/domain/decision-window.js';

// Pure calendar policy boundary: UTC normalization and inclusive rolling periods.
test('reporting windows normalize offsets across calendar and year boundaries (TASK-2685)', () => {
  const windows = weeklyDecisionWindows('2026-01-01T00:30:00+01:00', 'UTC');
  assert.equal(windows.current.label, '2025-12-25 → 2025-12-31');
  assert.equal(windows.previous.label, '2025-12-18 → 2025-12-24');
  assert.equal(decisionWindowDay('2026-01-01T00:30:00+01:00', 'UTC'), '2025-12-31');
  assert.equal(decisionWindowContains(windows.current, '2026-01-01T00:30:00+01:00'), true);
  assert.equal(decisionWindowContains(windows.previous, '2025-12-25T00:00:00Z'), false);
});

test('retention boundaries count UTC days including today and support zero retention (TASK-2685)', () => {
  assert.equal(decisionRetentionBoundary('2026-10-08T23:59:59Z', 7, 'UTC'), '2026-10-02');
  assert.equal(decisionRetentionBoundary('2026-10-08T00:00:00Z', 14, 'UTC'), '2026-09-25');
  assert.equal(decisionRetentionBoundary('2026-10-08', 0), '2026-10-09');
  assert.throws(() => decisionRetentionBoundary('2026-10-08', -1));
  assert.throws(() => weeklyDecisionWindows('invalid'));
});

test('local reporting includes the Stockholm midnight delivery in either stored format (TASK-2685)', () => {
  const windows = weeklyDecisionWindows('2026-10-08T08:00:00Z', 'Europe/Stockholm');
  assert.equal(windows.current.startDate, '2026-10-02');
  for (const at of ['2026-10-02T00:28:41+02:00', '2026-10-01T22:28:41Z']) {
    assert.equal(decisionWindowContains(windows.current, at), true);
    assert.equal(decisionWindowContains(windows.previous, at), false);
  }
  assert.equal(decisionWindowContains(windows.current, '2026-10-01T21:59:59.999Z'), false);
  assert.equal(decisionWindowContains(windows.current, '2026-10-08T21:59:59.999Z'), true);
  assert.equal(decisionWindowContains(windows.current, '2026-10-08T22:00:00Z'), false);
});

test('local reporting ranges change at midnight while new completions appear immediately (TASK-2685)', () => {
  const zone = 'Europe/Stockholm';
  const morning = weeklyDecisionWindows('2026-10-08T06:00:00Z', zone);
  const evening = weeklyDecisionWindows('2026-10-08T21:59:59Z', zone);
  assert.deepEqual(morning, evening);
  assert.equal(decisionWindowContains(evening.current, '2026-10-08T21:58:00Z'), true);
  assert.equal(weeklyDecisionWindows('2026-10-08T22:00:00Z', zone).current.endDate, '2026-10-09');
  assert.equal(decisionWindowDay('2026-01-01T00:30:00+01:00', zone), '2026-01-01');
  assert.equal(decisionWindowDay('2026-10-02', 'America/Los_Angeles'), '2026-10-02');
});

test('local reporting uses calendar days across spring and autumn DST (TASK-2685)', () => {
  const zone = 'Europe/Stockholm';
  for (const [today, first, before, last, after] of [
    ['2026-03-29', '2026-03-22T23:00:00Z', '2026-03-22T22:59:59Z', '2026-03-29T21:59:59Z', '2026-03-29T22:00:00Z'],
    ['2026-10-25', '2026-10-18T22:00:00Z', '2026-10-18T21:59:59Z', '2026-10-25T22:59:59Z', '2026-10-25T23:00:00Z'],
  ]) {
    const window = weeklyDecisionWindows(today, zone).current;
    assert.equal(decisionWindowContains(window, first), true);
    assert.equal(decisionWindowContains(window, before), false);
    assert.equal(decisionWindowContains(window, last), true);
    assert.equal(decisionWindowContains(window, after), false);
  }
});


test('reporting day endpoints follow DST offsets rather than fixed 24-hour arithmetic (TASK-2685)', () => {
  assert.equal(decisionWindowDayEnd('2026-03-29', 'Europe/Stockholm'), '2026-03-29T21:59:59.999Z');
  assert.equal(decisionWindowDayEnd('2026-10-25', 'Europe/Stockholm'), '2026-10-25T22:59:59.999Z');
  assert.equal(decisionWindowDayEnd('2026-10-08', 'America/Los_Angeles'), '2026-10-09T06:59:59.999Z');
});
