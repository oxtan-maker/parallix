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
// TASK-2357 defect E — the legacy lifecycle-entry fallback is repository-scoped.
//
// Repository A and repository B both contain TASK-123. Only A's own history row
// may answer "when did TASK-123 enter its lane here"; B's row is a different
// mission that happens to share an id.
// ---------------------------------------------------------------------------

const REPO_A = repositoryId('repo-a');
const REPO_B = repositoryId('repo-b');
const COLLIDING = missionId('task-123');
const ANCHOR = missionId('task-900');

const NOW = '2026-06-05T12:00:00.000Z';
const A_ENTERED = '2026-06-05T11:00:00.000Z'; // 60 minutes before NOW
const B_ENTERED = '2026-06-05T02:00:00.000Z'; // 600 minutes before NOW
const ANCHOR_EVENT = '2026-06-05T11:30:00.000Z';

/** Hand-computed: A's own row is 60 minutes old; B's is 600 and must not win. */
const EXPECTED_REVIEW_AGE_MINUTES = 60;

describe('TASK-2357 defect E: legacy lifecycle-entry fallback stays inside its repository', () => {
  it('reads only its own repository history for a colliding mission id', async () => {
    await withStatisticsDatabase(async ({ laneEventRepo, usageRepo, historyRepo }) => {
      // An anchor mission with real lane events in repository A.
      await laneEventRepo.append(laneEvent({ repositoryId: REPO_A, missionId: ANCHOR, from: null, to: 'backlog', at: ANCHOR_EVENT }));

      // TASK-123 has no lane events in either repository, only history rows.
      await historyRepo.append({
        eventType: 'mission.review',
        eventData: JSON.stringify({ missionId: COLLIDING, repositoryId: REPO_B, message: `${COLLIDING} → review`, agent: 'codex' }),
        createdAt: B_ENTERED,
      });
      await historyRepo.append({
        eventType: 'mission.review',
        eventData: JSON.stringify({ missionId: COLLIDING, repositoryId: REPO_A, message: `${COLLIDING} → review`, agent: 'claude' }),
        createdAt: A_ENTERED,
      });

      const metrics = await new ConcreteMetricsReadAdapter({
        laneEventRepo, usageRepo, historyRepo, repositoryId: REPO_A, clock: fixedClock(NOW),
      }).buildMetrics(new Map<MissionId, MissionStatus>([
        [ANCHOR, 'backlog'],
        [COLLIDING, 'review'],
      ]));

      const review = metrics.medianAgeByLane.series.find((entry) => entry.lane === 'review');
      assert.ok(review, 'expected a review lane entry');
      assert.equal(
        review.value,
        EXPECTED_REVIEW_AGE_MINUTES,
        'the other repository\'s older row must not become this mission\'s lane entry',
      );
      assert.equal(review.observationCount, 1);
    });
  });

  it('reports the lane age as unavailable when no row can be attributed to this repository', async () => {
    await withStatisticsDatabase(async ({ laneEventRepo, usageRepo, historyRepo }) => {
      await laneEventRepo.append(laneEvent({ repositoryId: REPO_A, missionId: ANCHOR, from: null, to: 'backlog', at: ANCHOR_EVENT }));
      // Only the other repository's row exists.
      await historyRepo.append({
        eventType: 'mission.review',
        eventData: JSON.stringify({ missionId: COLLIDING, repositoryId: REPO_B, message: `${COLLIDING} → review`, agent: 'codex' }),
        createdAt: B_ENTERED,
      });

      const metrics = await new ConcreteMetricsReadAdapter({
        laneEventRepo, usageRepo, historyRepo, repositoryId: REPO_A, clock: fixedClock(NOW),
      }).buildMetrics(new Map<MissionId, MissionStatus>([
        [ANCHOR, 'backlog'],
        [COLLIDING, 'review'],
      ]));

      const review = metrics.medianAgeByLane.series.find((entry) => entry.lane === 'review');
      assert.equal(review?.value, null, 'an unattributable legacy row is unavailable, not a guess');
      assert.equal(review?.observationCount, 0);
    });
  });
});
