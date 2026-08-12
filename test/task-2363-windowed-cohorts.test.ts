import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ConcreteMetricsReadAdapter } from '../src/application/projections/metrics-read-adapter.js';
import type { MissionId, MissionStatus } from '../src/domain/mission.js';
import { missionId } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import {
  fixedClock,
  insertUsageRow,
  laneEvent,
  withStatisticsDatabase,
} from './fixtures/task-2357-statistics-fixture.js';

// ---------------------------------------------------------------------------
// TASK-2363 — the board's default experiment cohort is this week's experiment.
//
// Two missions carry the same label. One completed inside the current rolling
// window, one six months earlier. Former behavior that makes these fail:
// `compareCohorts` grouping every completed outcome regardless of `closedAt`.
// ---------------------------------------------------------------------------

const REPO = repositoryId('fixture-repo');
const RECENT = missionId('task-300');
const SIX_MONTHS_OLD = missionId('task-301');

const NOW = '2026-08-11T12:00:00.000Z';

describe('TASK-2363: the default FLOW cohort is the current rolling week', () => {
  it('excludes a six-month-old mission carrying the same experiment label', async () => {
    await withStatisticsDatabase(async ({ db, laneEventRepo, usageRepo }) => {
      await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: RECENT, from: null, to: 'backlog', at: '2026-08-04T09:00:00.000Z' }));
      await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: RECENT, from: 'backlog', to: 'done', at: '2026-08-06T09:00:00.000Z' }));
      await insertUsageRow(db, {
        repo: REPO, mission: RECENT, date: '2026-08-06',
        classification: 'ai_sdlc', prFixRounds: 1, durationMinutes: 30,
      });

      await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: SIX_MONTHS_OLD, from: null, to: 'backlog', at: '2026-02-01T09:00:00.000Z' }));
      await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: SIX_MONTHS_OLD, from: 'backlog', to: 'done', at: '2026-02-10T09:00:00.000Z' }));
      await insertUsageRow(db, {
        repo: REPO, mission: SIX_MONTHS_OLD, date: '2026-02-10',
        classification: 'ai_sdlc', prFixRounds: 7, durationMinutes: 900,
        actorKey: 'claude|old',
      });

      const metrics = await new ConcreteMetricsReadAdapter({
        laneEventRepo, usageRepo, repositoryId: REPO, clock: fixedClock(NOW),
      }).buildMetrics(new Map<MissionId, MissionStatus>([
        [RECENT, 'done'],
        [SIX_MONTHS_OLD, 'done'],
      ]));

      const cohort = metrics.cohorts?.cohorts.find((entry) => entry.key === 'ai_sdlc');
      assert.ok(cohort, 'expected an ai_sdlc cohort');
      assert.equal(cohort.n, 1, 'only the mission completed this week is in the experiment');
      // task-300 ran 30 minutes, task-301 ran 900. A cumulative cohort would
      // report the mean of both, 465.
      assert.equal(cohort.agentRuntimeMinutesPerMission, 30);
      assert.equal(cohort.observationCounts.reviewFixRounds, 1);
      assert.equal(cohort.medianReviewFixRounds, 1);
    });
  });

  it('reports the decision windows from the adapter clock, not wall-clock time', async () => {
    await withStatisticsDatabase(async ({ db, laneEventRepo, usageRepo }) => {
      await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: RECENT, from: null, to: 'backlog', at: '2026-08-04T09:00:00.000Z' }));
      await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: RECENT, from: 'backlog', to: 'done', at: '2026-08-06T09:00:00.000Z' }));
      await insertUsageRow(db, {
        repo: REPO, mission: RECENT, date: '2026-08-06',
        classification: 'ai_sdlc', prFixRounds: 1, durationMinutes: 30,
      });

      const metrics = await new ConcreteMetricsReadAdapter({
        laneEventRepo, usageRepo, repositoryId: REPO, clock: fixedClock(NOW),
      }).buildMetrics(new Map<MissionId, MissionStatus>([[RECENT, 'done']]));

      assert.equal(metrics.decisionWindow?.current.label, '2026-08-05 → 2026-08-11');
      assert.equal(metrics.decisionWindow?.previous.label, '2026-07-29 → 2026-08-04');
      assert.equal(metrics.decisionWindow?.current.completedMissions, 1);
      // Intake 2026-08-04T09:00 → done 2026-08-06T09:00 is 2880 minutes; the
      // mission started before the window opened and its whole span counts.
      assert.equal(metrics.decisionWindow?.current.cycleTime.value, 2880);
      assert.equal(metrics.decisionWindow?.current.agentRuntime.value, 30);
      assert.equal(metrics.decisionWindow?.previous.completedMissions, 0);
      assert.equal(metrics.decisionWindow?.previous.cycleTime.value, null);
    });
  });
});
