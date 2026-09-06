/**
 * Reproduction test for task-2459.
 *
 * FLOW presents one rolling seven-day reporting window, but the board
 * projection published `cumulativeFlowByState` as an all-history state stock:
 * the first point of the displayed week already carried every mission
 * completed before that week in `done`. This test pins the weekly semantics
 * from the server side, with an injected clock and a mission whose whole
 * lifecycle closed seven weeks before the window.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMetrics } from '../src/application/projections/metrics.js';
import { weeklyDecisionWindows } from '../src/application/services/decision-window.js';
import type { MissionTransition } from '../src/domain/mission-workflow.js';
import type { MissionId, MissionStatus } from '../src/domain/mission.js';

const asOf = '2026-08-31T12:00:00Z';
const oldMission = 'task-0001' as MissionId;

const transitions: readonly MissionTransition[] = [
  { missionId: oldMission, from: null, to: 'backlog', trigger: 'refine', actor: 'codex', occurredAt: '2026-07-01T09:00:00Z' },
  { missionId: oldMission, from: 'backlog', to: 'active', trigger: 'activate', actor: 'codex', occurredAt: '2026-07-02T09:00:00Z' },
  { missionId: oldMission, from: 'active', to: 'done', trigger: 'integrate', actor: 'codex', occurredAt: '2026-07-10T09:00:00Z' },
];

const initialStates: ReadonlyMap<MissionId, MissionStatus> = new Map([[oldMission, 'done' as MissionStatus]]);

test('the weekly cumulative flow series starts without a mission completed before the reporting window', () => {
  const windows = weeklyDecisionWindows(asOf);
  const metrics = buildMetrics({
    initialStates,
    transitions,
    outcomes: [],
    instants: transitions.map((transition) => transition.occurredAt),
    asOf,
    decisionWindows: windows,
  });

  const weekly = metrics.weeklyCumulativeFlow;
  assert.ok(weekly, 'the projection must publish a weekly cumulative-flow series');
  assert.equal(weekly.window.label, windows.current.label);
  assert.equal(weekly.window.startDate, '2026-08-25');
  assert.equal(weekly.window.endDate, '2026-08-31');
  assert.equal(weekly.series.length, 7);
  assert.equal(weekly.series[0]!.counts.done, 0, 'the first weekly point must carry no pre-window completion');
  assert.equal(weekly.series.at(-1)!.counts.done, 0, 'a pre-window completion never enters the week at all');
});
