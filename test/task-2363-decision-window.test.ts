import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  decisionWindowContains,
  decisionWindowEndingOn,
  weeklyDecisionWindows,
} from '../src/application/services/decision-window.js';
import { statisticsRowInWindow } from '../src/application/services/statistics-service.js';

// ---------------------------------------------------------------------------
// TASK-2363 — the one application-owned rolling-window definition.
// ---------------------------------------------------------------------------

describe('TASK-2363: weekly decision windows', () => {
  it('returns current and previous non-overlapping 7-day ranges', () => {
    const windows = weeklyDecisionWindows('2026-08-11');
    assert.equal(windows.current.startDate, '2026-08-05');
    assert.equal(windows.current.endDate, '2026-08-11');
    assert.equal(windows.previous.startDate, '2026-07-29');
    assert.equal(windows.previous.endDate, '2026-08-04');
  });

  it('labels each window with its inclusive date range', () => {
    const windows = weeklyDecisionWindows('2026-08-11');
    assert.equal(windows.current.label, '2026-08-05 → 2026-08-11');
    assert.equal(windows.previous.label, '2026-07-29 → 2026-08-04');
  });

  it('reads the day from an injected full-instant clock', () => {
    const windows = weeklyDecisionWindows('2026-08-11T23:59:59.999Z');
    assert.equal(windows.current.label, '2026-08-05 → 2026-08-11');
  });

  it('crosses a month boundary without shifting the window length', () => {
    const windows = weeklyDecisionWindows('2026-03-02');
    assert.equal(windows.current.startDate, '2026-02-24');
    assert.equal(windows.previous.startDate, '2026-02-17');
    assert.equal(windows.previous.endDate, '2026-02-23');
  });

  it('contains a completion at any time on the last day', () => {
    const windows = weeklyDecisionWindows('2026-08-11');
    assert.equal(decisionWindowContains(windows.current, '2026-08-11T23:30:00.000Z'), true);
    assert.equal(decisionWindowContains(windows.current, '2026-08-05T00:00:00.000Z'), true);
    assert.equal(decisionWindowContains(windows.current, '2026-08-04T23:59:59.999Z'), false);
    assert.equal(decisionWindowContains(windows.previous, '2026-08-04T23:59:59.999Z'), true);
  });

  it('stays compatible with the date-only telemetry comparison px stats uses', () => {
    const window = decisionWindowEndingOn('2026-06-20', 7);
    assert.equal(statisticsRowInWindow({ date: '2026-06-14' }, window), true);
    assert.equal(statisticsRowInWindow({ date: '2026-06-20' }, window), true);
    assert.equal(statisticsRowInWindow({ date: '2026-06-13' }, window), false);
    assert.equal(statisticsRowInWindow({ date: '2026-06-21' }, window), false);
  });
});
