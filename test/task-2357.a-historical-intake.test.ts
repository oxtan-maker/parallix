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
// TASK-2357 defect A — historical cumulative flow must not contain a mission
// before its authoritative intake.
//
// The fixture persists real lane events and reads them back through
// `ConcreteMetricsReadAdapter`, so the assertion covers the production
// conversion in `entryToMissionTransition` as well as the historical-seeding
// filter in `buildMetrics`. Constructing a transition with `from: null` by hand
// would skip exactly the conversion that loses the intake marker.
// ---------------------------------------------------------------------------

const REPO = repositoryId('fixture-repo');
const TASK_A = missionId('task-a');
const TASK_B = missionId('task-b');

/** Hand-computed instants: one per persisted lane event. */
const MONDAY = '2026-06-01T09:00:00.000Z';
const TUESDAY = '2026-06-02T09:00:00.000Z';
const WEDNESDAY = '2026-06-03T09:00:00.000Z';
const THURSDAY = '2026-06-04T09:00:00.000Z';
const FRIDAY = '2026-06-05T09:00:00.000Z';

describe('TASK-2357 defect A: historical flow excludes missions before intake', () => {
  it('leaves a Thursday-intaked mission absent from Monday, Tuesday and Wednesday', async () => {
    await withStatisticsDatabase(async ({ laneEventRepo, usageRepo }) => {
      // Task A is intaked Monday and walks the board.
      await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: TASK_A, from: null, to: 'backlog', at: MONDAY }));
      await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: TASK_A, from: 'backlog', to: 'refined', at: TUESDAY }));
      await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: TASK_A, from: 'refined', to: 'active', at: WEDNESDAY }));
      // Task B does not exist until Thursday, and reaches done on Friday.
      await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: TASK_B, from: null, to: 'backlog', at: THURSDAY }));
      await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: TASK_B, from: 'backlog', to: 'done', at: FRIDAY }));

      const adapter = new ConcreteMetricsReadAdapter({
        laneEventRepo,
        usageRepo,
        repositoryId: REPO,
        clock: fixedClock(FRIDAY),
      });

      // Current board state, exactly as `BoardProjectionBuilder` supplies it.
      const initialStates = new Map<MissionId, MissionStatus>([
        [TASK_A, 'active'],
        [TASK_B, 'done'],
      ]);
      const metrics = await adapter.buildMetrics(initialStates);

      const at = (instant: string) => {
        const point = metrics.cumulativeFlowByState.series.find((entry) => entry.at === instant);
        assert.ok(point, `no cumulative-flow point at ${instant}; series had ${
          metrics.cumulativeFlowByState.series.map((entry) => entry.at).join(', ')}`);
        return point;
      };
      const total = (instant: string) =>
        Object.values(at(instant).counts).reduce((sum, count) => sum + count, 0);

      // Monday–Wednesday: task-a only. Hand-computed: one mission exists.
      assert.equal(total(MONDAY), 1, 'Monday must contain only task-a');
      assert.deepEqual(at(MONDAY).counts, { backlog: 1, refined: 0, active: 0, review: 0, integration: 0, done: 0 });
      assert.equal(total(TUESDAY), 1, 'Tuesday must contain only task-a');
      assert.deepEqual(at(TUESDAY).counts, { backlog: 0, refined: 1, active: 0, review: 0, integration: 0, done: 0 });
      assert.equal(total(WEDNESDAY), 1, 'Wednesday must contain only task-a');
      assert.deepEqual(at(WEDNESDAY).counts, { backlog: 0, refined: 0, active: 1, review: 0, integration: 0, done: 0 });

      // Thursday: task-b appears in backlog, the lane its intake event names.
      assert.equal(total(THURSDAY), 2, 'Thursday must contain task-a and task-b');
      assert.deepEqual(at(THURSDAY).counts, { backlog: 1, refined: 0, active: 1, review: 0, integration: 0, done: 0 });

      // Friday: task-b is done.
      assert.deepEqual(at(FRIDAY).counts, { backlog: 0, refined: 0, active: 1, review: 0, integration: 0, done: 1 });
    });
  });

  it('never reports a completed mission before the week it was intaked', async () => {
    await withStatisticsDatabase(async ({ laneEventRepo, usageRepo }) => {
      await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: TASK_A, from: null, to: 'backlog', at: MONDAY }));
      await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: TASK_B, from: null, to: 'backlog', at: THURSDAY }));
      await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: TASK_B, from: 'backlog', to: 'done', at: FRIDAY }));

      const adapter = new ConcreteMetricsReadAdapter({
        laneEventRepo,
        usageRepo,
        repositoryId: REPO,
        clock: fixedClock(FRIDAY),
      });
      const metrics = await adapter.buildMetrics(new Map<MissionId, MissionStatus>([
        [TASK_A, 'backlog'],
        [TASK_B, 'done'],
      ]));

      const monday = metrics.cumulativeFlow.series.find((entry) => entry.at === MONDAY);
      assert.ok(monday, 'expected a cumulative-flow point on Monday');
      // Hand-computed: nothing had completed on Monday.
      assert.equal(monday.value, 0);
      const friday = metrics.cumulativeFlow.series.find((entry) => entry.at === FRIDAY);
      assert.equal(friday?.value, 1);
    });
  });
});
