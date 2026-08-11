import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ConcreteMetricsReadAdapter } from '../src/application/projections/metrics-read-adapter.js';
import type { MissionId, MissionStatus } from '../src/domain/mission.js';
import { missionId } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import {
  fixedClock,
  laneEvent,
  withStatisticsDatabase,
} from './fixtures/task-2357-statistics-fixture.js';

// ---------------------------------------------------------------------------
// TASK-2357 defect F — zero completions is a measurement, not an absence.
//
// Twelve missions have lifecycle activity and none has completed. The current
// reporting week's throughput is exactly 0. A previous week of 7 must never
// stand in for a current week of 0.
// ---------------------------------------------------------------------------

const REPO = repositoryId('fixture-repo');

const INTAKE = '2026-06-01T09:00:00.000Z';
const ACTIVATED = '2026-06-02T09:00:00.000Z';
/** Monday of the reporting week; the injected clock sits inside it. */
const CURRENT_WEEK_START = '2026-06-01T00:00:00.000Z';
const NOW = '2026-06-04T12:00:00.000Z';

const ACTIVE_MISSION_COUNT = 12;

describe('TASK-2357 defect F: zero completions with lifecycle activity is measured zero', () => {
  it('renders the current week as 0 when twelve active missions have never completed', async () => {
    await withStatisticsDatabase(async ({ laneEventRepo, usageRepo }) => {
      const missions: MissionId[] = [];
      for (let index = 0; index < ACTIVE_MISSION_COUNT; index += 1) {
        const mission = missionId(`task-4${String(index).padStart(2, '0')}`);
        missions.push(mission);
        await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: mission, from: null, to: 'backlog', at: INTAKE }));
        await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: mission, from: 'backlog', to: 'active', at: ACTIVATED }));
      }

      const metrics = await new ConcreteMetricsReadAdapter({
        laneEventRepo, usageRepo, repositoryId: REPO, clock: fixedClock(NOW),
      }).buildMetrics(new Map<MissionId, MissionStatus>(
        missions.map((mission) => [mission, 'active' as MissionStatus]),
      ));

      const current = metrics.weeklyThroughput.series.find((point) => point.at === CURRENT_WEEK_START);
      assert.ok(
        current,
        `expected a current-week throughput point at ${CURRENT_WEEK_START}, got ${
          JSON.stringify(metrics.weeklyThroughput.series)}`,
      );
      assert.equal(current.value, 0, 'twelve active missions and no completion is a measured zero');
      assert.equal(
        metrics.bottleneck.inputs.weeklyThroughput,
        0,
        'the bottleneck narrative must report the measured zero, not "unavailable"',
      );
      assert.match(metrics.bottleneck.sentence, /0 completed in the current reporting week/);
    });
  });

  it('never lets a previous week of seven leak into a current week of zero', async () => {
    await withStatisticsDatabase(async ({ laneEventRepo, usageRepo }) => {
      const previousWeekIntake = '2026-05-25T09:00:00.000Z';
      const previousWeekDone = '2026-05-27T09:00:00.000Z';
      const previousWeekStart = '2026-05-25T00:00:00.000Z';
      const missions: MissionId[] = [];
      for (let index = 0; index < 7; index += 1) {
        const mission = missionId(`task-5${String(index).padStart(2, '0')}`);
        missions.push(mission);
        await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: mission, from: null, to: 'backlog', at: previousWeekIntake }));
        await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: mission, from: 'backlog', to: 'done', at: previousWeekDone }));
      }

      const metrics = await new ConcreteMetricsReadAdapter({
        laneEventRepo, usageRepo, repositoryId: REPO, clock: fixedClock(NOW),
      }).buildMetrics(new Map<MissionId, MissionStatus>(
        missions.map((mission) => [mission, 'done' as MissionStatus]),
      ));

      const previous = metrics.weeklyThroughput.series.find((point) => point.at === previousWeekStart);
      const current = metrics.weeklyThroughput.series.find((point) => point.at === CURRENT_WEEK_START);
      assert.equal(previous?.value, 7);
      assert.equal(current?.value, 0, 'the current week completed nothing and must say so');
    });
  });
});
