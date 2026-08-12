import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { SqliteMeasurementStore } from '../src/adapters/sqlite/measurement-store.js';
import { upsertMeasurementRow } from '../src/adapters/cli/commands/stats.js';
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
// TASK-2357 defect C — an unknown review-fix round count is not a zero.
//
// Four completed missions: one measured 0 rounds, one measured 2, and two never
// had a count derived at all. The cohort population is 4; the review-fix
// observation count is 2; the reported median is the median of [0, 2].
// ---------------------------------------------------------------------------

const REPO = repositoryId('fixture-repo');
const KNOWN_ZERO = missionId('task-201');
const KNOWN_TWO = missionId('task-202');
const UNKNOWN_A = missionId('task-203');
const UNKNOWN_B = missionId('task-204');

const INTAKE = '2026-06-01T09:00:00.000Z';
const DONE = '2026-06-02T09:00:00.000Z';
const NOW = '2026-06-03T09:00:00.000Z';

/** Hand-computed expectations, stated beside the fixture they describe. */
const EXPECTED_POPULATION = 4;
const EXPECTED_REVIEW_FIX_OBSERVATIONS = 2;
const EXPECTED_MEDIAN_REVIEW_FIX_ROUNDS = 1; // median of [0, 2]

describe('TASK-2357 defect C: unknown review-fix rounds survive to presentation', () => {
  it('stores an unknown count as SQL NULL and excludes it from cohort aggregates', async () => {
    await withStatisticsDatabase(async ({ db, databasePath, laneEventRepo, usageRepo }) => {
      const rounds: readonly [MissionId, number | null][] = [
        [KNOWN_ZERO, 0],
        [KNOWN_TWO, 2],
        [UNKNOWN_A, null],
        [UNKNOWN_B, null],
      ];

      for (const [mission] of rounds) {
        await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: mission, from: null, to: 'backlog', at: INTAKE }));
        await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: mission, from: 'backlog', to: 'done', at: DONE }));
      }

      // Write through the production CLI producer, which is where the count is
      // canonicalized before it reaches the measurement store.
      const store = new SqliteMeasurementStore(databasePath);
      try {
        for (const [mission, value] of rounds) {
          upsertMeasurementRow({
            date: '2026-06-02',
            repo: REPO,
            mission,
            classification: 'ai_sdlc',
            implementer: 'claude',
            pr_fix_rounds: value === null ? null : String(value),
            stage: 'default',
          } as never, { store });
        }
      } finally {
        store.close();
      }

      // 1. The unknown values really are SQL NULL in the migrated database.
      const persisted = await db.query<{ mission: string; pr_fix_rounds: unknown }>(
        'SELECT mission, pr_fix_rounds FROM usage_statistics ORDER BY mission ASC;',
      );
      const byMission = new Map(persisted.map((row) => [row.mission, row.pr_fix_rounds]));
      assert.equal(byMission.size, EXPECTED_POPULATION);
      assert.equal(byMission.get(KNOWN_ZERO), 0, 'a measured zero stays a zero');
      assert.equal(byMission.get(KNOWN_TWO), 2);
      assert.equal(byMission.get(UNKNOWN_A), null, 'an unknown count must persist as SQL NULL');
      assert.equal(byMission.get(UNKNOWN_B), null, 'an unknown count must persist as SQL NULL');

      // 2. Read it back through the normal adapters to presentation.
      const metrics = await new ConcreteMetricsReadAdapter({
        laneEventRepo, usageRepo, repositoryId: REPO, clock: fixedClock(NOW),
      }).buildMetrics(new Map<MissionId, MissionStatus>(
        rounds.map(([mission]) => [mission, 'done' as MissionStatus]),
      ));

      const cohort = metrics.cohorts?.cohorts.find((entry) => entry.key === 'ai_sdlc');
      assert.ok(cohort, `expected an ai_sdlc cohort, got ${
        JSON.stringify(metrics.cohorts?.cohorts.map((entry) => entry.key))}`);
      assert.equal(cohort.n, EXPECTED_POPULATION, 'cohort population counts every completed mission');
      assert.equal(
        cohort.observationCounts.reviewFixRounds,
        EXPECTED_REVIEW_FIX_OBSERVATIONS,
        'only the two measured counts are observations',
      );
      assert.equal(cohort.medianReviewFixRounds, EXPECTED_MEDIAN_REVIEW_FIX_ROUNDS);
    });
  });

  it('keeps a measured zero distinct from an unknown count in the outcome model', async () => {
    await withStatisticsDatabase(async ({ databasePath, laneEventRepo, usageRepo }) => {
      for (const mission of [KNOWN_ZERO, UNKNOWN_A]) {
        await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: mission, from: null, to: 'backlog', at: INTAKE }));
        await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: mission, from: 'backlog', to: 'done', at: DONE }));
      }
      const store = new SqliteMeasurementStore(databasePath);
      try {
        upsertMeasurementRow({
          date: '2026-06-02', repo: REPO, mission: KNOWN_ZERO, classification: 'ai_sdlc',
          implementer: 'claude', pr_fix_rounds: '0', stage: 'default',
        } as never, { store });
        upsertMeasurementRow({
          date: '2026-06-02', repo: REPO, mission: UNKNOWN_A, classification: 'ai_sdlc',
          implementer: 'claude', pr_fix_rounds: null, stage: 'default',
        } as never, { store });
      } finally {
        store.close();
      }

      const outcomes = await new ConcreteMetricsReadAdapter({
        laneEventRepo, usageRepo, repositoryId: REPO, clock: fixedClock(NOW),
      }).readOutcomes();

      const known = outcomes.find((outcome) => outcome.missionId === KNOWN_ZERO);
      const unknown = outcomes.find((outcome) => outcome.missionId === UNKNOWN_A);
      assert.equal(known?.reviewFixRounds, 0, 'a real zero measurement stays 0');
      assert.equal(unknown?.reviewFixRounds, null, 'an unknown count reaches the outcome as null');
    });
  });
});
