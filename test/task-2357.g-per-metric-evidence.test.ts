import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { renderCohortComparison } from '../src/adapters/cli/commands/cohort-report.js';
import { ConcreteMetricsReadAdapter } from '../src/application/projections/metrics-read-adapter.js';
import type { MissionLabel, MissionId, MissionStatus } from '../src/domain/mission.js';
import { missionId } from '../src/domain/mission.js';
import type { AgentFamily } from '../src/domain/agents.js';
import { agentFamily } from '../src/domain/agents.js';
import { repositoryId } from '../src/domain/repository.js';
import {
  fixedClock,
  insertUsageRow,
  laneEvent,
  withStatisticsDatabase,
} from './fixtures/task-2357-statistics-fixture.js';

// ---------------------------------------------------------------------------
// TASK-2357 defect G — a metric's low-sample judgement is its own.
//
// Hand-computed cohort: 30 completed missions, so cycle time has 30
// observations. 18 of them passed through review, so review dwell has 18. 14
// emitted a measured run duration, so runtime has 14. Two of those also
// recorded a cost, so cost has 2 — and a cost comparison over two missions is
// low-sample even though the cohort itself is not.
// ---------------------------------------------------------------------------

const REPO = repositoryId('fixture-repo');
const LABEL = 'ai_sdlc';

const INTAKE = '2026-06-01T09:00:00.000Z';
const REVIEWED = '2026-06-01T15:00:00.000Z';
const DONE = '2026-06-02T09:00:00.000Z';
const NOW = '2026-06-03T09:00:00.000Z';

const POPULATION = 30;
const REVIEW_DWELL_OBSERVATIONS = 18;
const RUNTIME_OBSERVATIONS = 14;
const COST_OBSERVATIONS = 2;
const THRESHOLD = 5;

describe('TASK-2357 defect G: low-sample is judged per metric, not per cohort', () => {
  it('marks cost low-sample at n=2 while the 30-mission cohort is not', async () => {
    await withStatisticsDatabase(async ({ db, laneEventRepo, usageRepo }) => {
      const missions: MissionId[] = [];
      for (let index = 0; index < POPULATION; index += 1) {
        const mission = missionId(`task-6${String(index).padStart(2, '0')}`);
        missions.push(mission);
        await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: mission, from: null, to: 'backlog', at: INTAKE }));
        if (index < REVIEW_DWELL_OBSERVATIONS) {
          await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: mission, from: 'backlog', to: 'review', at: REVIEWED }));
          await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: mission, from: 'review', to: 'done', at: DONE }));
        } else {
          await laneEventRepo.append(laneEvent({ repositoryId: REPO, missionId: mission, from: 'backlog', to: 'done', at: DONE }));
        }
        if (index < RUNTIME_OBSERVATIONS) {
          await insertUsageRow(db, {
            repo: REPO, mission, date: '2026-06-02', classification: LABEL, closed: 'yes',
            prFixRounds: 1, durationMinutes: 30 + index,
            costUsd: index < COST_OBSERVATIONS ? 1.5 : null,
          });
        }
      }

      const cohortMetadata = async () => new Map<MissionId, { labels: readonly MissionLabel[]; assignee: AgentFamily | null }>(
        missions.map((mission) => [mission, { labels: [LABEL as MissionLabel], assignee: agentFamily('claude') }]),
      );
      const metrics = await new ConcreteMetricsReadAdapter({
        laneEventRepo, usageRepo, repositoryId: REPO, clock: fixedClock(NOW), cohortMetadata,
      }).buildMetrics(new Map<MissionId, MissionStatus>(
        missions.map((mission) => [mission, 'done' as MissionStatus]),
      ));

      const cohort = metrics.cohorts?.cohorts.find((entry) => entry.key === LABEL);
      assert.ok(cohort, `expected an ${LABEL} cohort, got ${
        JSON.stringify(metrics.cohorts?.cohorts.map((entry) => entry.key))}`);

      assert.equal(cohort.n, POPULATION);
      assert.equal(cohort.observationCounts.cycleTime, POPULATION);
      assert.equal(cohort.observationCounts.reviewDwell, REVIEW_DWELL_OBSERVATIONS);
      assert.equal(cohort.observationCounts.runtime, RUNTIME_OBSERVATIONS);
      assert.equal(cohort.observationCounts.cost, COST_OBSERVATIONS);

      assert.equal(metrics.cohorts?.lowSampleThreshold, THRESHOLD);
      assert.equal(cohort.lowSamplePopulation, false, 'a 30-mission cohort is not low-sample');
      assert.equal(cohort.lowSampleByMetric.cost, true, 'a cost figure over 2 missions is low-sample');
      assert.equal(cohort.lowSampleByMetric.cycleTime, false);
      assert.equal(cohort.lowSampleByMetric.reviewDwell, false);
      assert.equal(cohort.lowSampleByMetric.runtime, false);

      // The consumer uses the same threshold and the same marker.
      const report = renderCohortComparison(metrics.cohorts!);
      const cohortLine = report.split('\n').find((line) => line.startsWith(LABEL));
      assert.ok(cohortLine, report);
      assert.match(cohortLine, /\(n=2, low-sample\)/, `cost cell must carry its own marker:\n${cohortLine}`);
      assert.doesNotMatch(cohortLine, /\(n=30, low-sample\)/, cohortLine);
    });
  });
});
