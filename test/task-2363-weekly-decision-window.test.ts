import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildMetrics } from '../src/application/projections/metrics.js';
import type { BoardMetrics } from '../src/application/projections/board.js';
import { weeklyDecisionWindows } from '../src/application/services/decision-window.js';
import {
  CURRENT_WINDOW_LABEL,
  EXPECTED_CURRENT_CYCLE_MEDIAN,
  EXPECTED_CURRENT_CYCLE_N,
  EXPECTED_CURRENT_RUNTIME_MEDIAN,
  EXPECTED_CURRENT_RUNTIME_N,
  EXPECTED_PREVIOUS_CYCLE_MEDIAN,
  EXPECTED_PREVIOUS_CYCLE_N,
  NOW,
  PREVIOUS_WINDOW_LABEL,
  completedMission,
  contaminatedHistory,
} from './fixtures/task-2363-decision-window-fixture.js';

// ---------------------------------------------------------------------------
// TASK-2363 — FLOW is a weekly decision surface.
//
// The fixture holds 240 old completed missions with extreme cycle times beside
// 28 previous-window and 31 current-window missions. Cumulative statistics over
// it report n = 299; the weekly decision statistics must report n = 31 with a
// hand-computed median of 40 minutes.
//
// Former behavior that makes each assertion below fail: aggregating every
// completed outcome regardless of `closedAt` (the pre-TASK-2363 behavior of
// `medianStateTimes`, `medianAgentRuntime`, `medianCycleTimeByStateSeries` and
// `reviewBounceRateSeries`).
// ---------------------------------------------------------------------------

function metricsOverContaminatedHistory(): BoardMetrics {
  const history = contaminatedHistory();
  return buildMetrics({
    initialStates: history.initialStates,
    transitions: history.transitions,
    outcomes: history.outcomes,
    instants: [NOW],
    asOf: NOW,
    decisionWindows: weeklyDecisionWindows(NOW),
  }) as BoardMetrics;
}

describe('TASK-2363: completed-mission decision metrics use the rolling 7-day window', () => {
  it('reports the current-window cycle-time population, not all history', () => {
    const metrics = metricsOverContaminatedHistory();
    const point = metrics.medianStateTimes.series.at(-1);
    assert.equal(point?.observationCount, EXPECTED_CURRENT_CYCLE_N);
  });

  it('keeps extreme historical cycle times out of the current median', () => {
    const metrics = metricsOverContaminatedHistory();
    assert.equal(metrics.medianStateTimes.series.at(-1)?.value, EXPECTED_CURRENT_CYCLE_MEDIAN);
  });

  it('reports agent runtime only from missions completed in the current window', () => {
    const metrics = metricsOverContaminatedHistory();
    const point = metrics.medianAgentRuntime.series.at(-1);
    assert.equal(point?.observationCount, EXPECTED_CURRENT_RUNTIME_N);
    assert.equal(point?.value, EXPECTED_CURRENT_RUNTIME_MEDIAN);
  });

  it('reports active lane dwell from the full lifecycle of current-window missions', () => {
    const metrics = metricsOverContaminatedHistory();
    const active = metrics.medianCycleTimeByState.series.find((entry) => entry.lane === 'active');
    // 31 missions each with one active interval, plus one extra interval for
    // each of the 5 that bounced back from review: 36 intervals of 9 minutes.
    assert.equal(active?.observationCount, 36);
    assert.equal(active?.value, 9);
  });

  it('reports review bounce rate from current-window missions only', () => {
    const metrics = metricsOverContaminatedHistory();
    const point = metrics.reviewBounceRate.series.at(-1);
    // 31 missions entered review; 5 of them bounced once.
    assert.equal(point?.observationCount, 31);
    assert.equal(point?.value, 5 / 31);
  });

  it('exposes the current and previous decision windows with their dates', () => {
    const metrics = metricsOverContaminatedHistory();
    assert.ok(metrics.decisionWindow, 'BoardMetrics must carry the decision-window comparison');
    assert.equal(metrics.decisionWindow.current.label, CURRENT_WINDOW_LABEL);
    assert.equal(metrics.decisionWindow.previous.label, PREVIOUS_WINDOW_LABEL);
  });

  it('states the previous window as an independent hand-computed population', () => {
    const metrics = metricsOverContaminatedHistory();
    const previous = metrics.decisionWindow?.previous;
    assert.equal(previous?.completedMissions, EXPECTED_PREVIOUS_CYCLE_N);
    assert.equal(previous?.cycleTime.value, EXPECTED_PREVIOUS_CYCLE_MEDIAN);
    assert.equal(previous?.cycleTime.observationCount, EXPECTED_PREVIOUS_CYCLE_N);
  });

  it('counts the full lifecycle of a mission that started before the window opened', () => {
    // Active from 2026-08-01T00:00Z to 2026-08-06T00:00Z — 7200 minutes, four
    // of those five days before the window opens on 2026-08-05. Truncating the
    // interval at the window edge would report 1440.
    const spanning = completedMission({
      id: 'task-0600',
      createdAt: '2026-08-01T00:00:00.000Z',
      closedAt: '2026-08-06T12:00:00.000Z',
      cycleTimeMinutes: 7920,
      activeDwellMinutes: 7199,
      reviewDwellMinutes: 30,
    });
    const metrics = buildMetrics({
      initialStates: new Map([[spanning.outcome.missionId, 'done' as const]]),
      transitions: spanning.transitions,
      outcomes: [spanning.outcome],
      instants: [NOW],
      asOf: NOW,
      decisionWindows: weeklyDecisionWindows(NOW),
    }) as BoardMetrics;

    assert.equal(metrics.decisionWindow?.current.completedMissions, 1);
    assert.equal(metrics.decisionWindow?.current.cycleTime.value, 7920);
    assert.equal(metrics.decisionWindow?.current.activeDwell.value, 7199);
  });

  it('excludes a mission that started inside the window but has not completed', () => {
    const open = completedMission({
      id: 'task-0601',
      createdAt: '2026-08-07T00:00:00.000Z',
      closedAt: '2026-08-08T00:00:00.000Z',
      cycleTimeMinutes: 1440,
    });
    // Keep the lifecycle up to `review` and drop the closing transition and the
    // outcome: the mission is still in flight.
    const inFlight = open.transitions.filter((transition) => transition.to !== 'done');
    const metrics = buildMetrics({
      initialStates: new Map([[open.outcome.missionId, 'review' as const]]),
      transitions: inFlight,
      outcomes: [],
      instants: [NOW],
      asOf: NOW,
      decisionWindows: weeklyDecisionWindows(NOW),
    }) as BoardMetrics;

    assert.equal(metrics.decisionWindow?.current.completedMissions, 0);
    assert.equal(metrics.decisionWindow?.current.cycleTime.value, null);
    assert.equal(metrics.decisionWindow?.current.cycleTime.observationCount, 0);
    assert.equal(metrics.decisionWindow?.current.activeDwell.observationCount, 0);
    // It is still in the lane, so the current-state metric does see it.
    assert.equal(
      metrics.medianAgeByLane.series.find((entry) => entry.lane === 'review')?.observationCount,
      1,
    );
  });

  it('keeps current-state lane age unwindowed', () => {
    const metrics = metricsOverContaminatedHistory();
    // Every fixture mission is in `done`, so the operational lane-age metric
    // still observes all 299 of them rather than only the 31 recent ones.
    const done = metrics.medianAgeByLane.series.find((entry) => entry.lane === 'done');
    assert.equal(done?.observationCount, 299);
  });
});
