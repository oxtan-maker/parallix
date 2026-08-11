import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { resolveStatsRepoName, upsertMeasurementRow } from '../src/adapters/cli/commands/stats.js';
import { resolveCanonicalRepositoryId } from '../src/adapters/git/repository-identity.js';
import { SqliteMeasurementStore } from '../src/adapters/sqlite/measurement-store.js';
import { ConcreteMetricsReadAdapter } from '../src/application/projections/metrics-read-adapter.js';
import type { MissionId, MissionStatus } from '../src/domain/mission.js';
import { missionId } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import {
  createPrimaryAndWorktree,
  fixedClock,
  insertUsageRow,
  laneEvent,
  withStatisticsDatabase,
} from './fixtures/task-2357-statistics-fixture.js';

// ---------------------------------------------------------------------------
// TASK-2363 integrity defect B — one repository identity for new statistics.
//
// A configured `product.name` is a display alias. When new measurement rows are
// written under it while lifecycle lane events are written under the canonical
// git-derived id, the two never join and the mission disappears from every
// completed-mission statistic.
//
// Former behavior that makes these fail: `resolveStatsRepoName` preferring
// `config.product.name` over `resolveCanonicalRepositoryId`.
// ---------------------------------------------------------------------------

const DISPLAY_ALIAS = 'deliberately-different-display-name';
const OTHER_REPO = repositoryId('unrelated-repo');
const MISSION_FROM_PRIMARY = missionId('task-400');
const MISSION_FROM_WORKTREE = missionId('task-401');
const COLLIDING = missionId('task-402');

const INTAKE = '2026-06-01T09:00:00.000Z';
const DONE = '2026-06-02T09:00:00.000Z';
const NOW = '2026-06-03T09:00:00.000Z';

function writeProductName(rootDir: string, name: string): void {
  fs.writeFileSync(
    path.join(rootDir, 'workflow.config.json'),
    JSON.stringify({ product: { name } }, null, 2),
  );
}

describe('TASK-2363 defect B: a display product name never splits repository identity', () => {
  it('writes new measurement rows under the canonical repository id, not product.name', () => {
    const checkouts = createPrimaryAndWorktree('actual-repository-name');
    try {
      writeProductName(checkouts.primary, DISPLAY_ALIAS);
      const canonical = resolveCanonicalRepositoryId(checkouts.primary);
      assert.equal(resolveStatsRepoName(checkouts.primary), canonical);
      assert.notEqual(resolveStatsRepoName(checkouts.primary), DISPLAY_ALIAS);
    } finally {
      checkouts.cleanup();
    }
  });

  it('joins new lifecycle and measurement data written from either checkout', async () => {
    const checkouts = createPrimaryAndWorktree('actual-repository-name');
    try {
      writeProductName(checkouts.primary, DISPLAY_ALIAS);
      writeProductName(checkouts.worktree, DISPLAY_ALIAS);
      const canonical = repositoryId(resolveStatsRepoName(checkouts.primary));

      await withStatisticsDatabase(async ({ databasePath, laneEventRepo, usageRepo }) => {
        // Lifecycle written under the canonical id, as the board records it.
        for (const [mission, root] of [
          [MISSION_FROM_PRIMARY, checkouts.primary],
          [MISSION_FROM_WORKTREE, checkouts.worktree],
        ] as const) {
          await laneEventRepo.append(laneEvent({
            repositoryId: canonical, missionId: mission, from: null, to: 'backlog', at: INTAKE,
          }));
          await laneEventRepo.append(laneEvent({
            repositoryId: canonical, missionId: mission, from: 'backlog', to: 'done', at: DONE,
          }));
          // Measurement written by the production CLI producer from that checkout.
          const store = new SqliteMeasurementStore(databasePath);
          try {
            upsertMeasurementRow({
              date: '2026-06-02', mission, classification: 'ai_sdlc',
              implementer: 'claude', pr_fix_rounds: '1', stage: 'default', closed: 'yes',
            } as never, { rootDir: root, store });
          } finally {
            store.close();
          }
        }

        const metrics = await new ConcreteMetricsReadAdapter({
          laneEventRepo, usageRepo, repositoryId: canonical, clock: fixedClock(NOW),
        }).buildMetrics(new Map<MissionId, MissionStatus>([
          [MISSION_FROM_PRIMARY, 'done'],
          [MISSION_FROM_WORKTREE, 'done'],
        ]));

        const cohort = metrics.cohorts?.cohorts.find((entry) => entry.key === 'ai_sdlc');
        assert.equal(cohort?.n, 2, 'both missions join the same repository population');
        assert.equal(cohort?.observationCounts.reviewFixRounds, 2);
        assert.equal(metrics.decisionWindow?.current.completedMissions, 2);
      });
    } finally {
      checkouts.cleanup();
    }
  });

  it('keeps repository B with an overlapping mission id out of repository A', async () => {
    const checkouts = createPrimaryAndWorktree('actual-repository-name');
    try {
      writeProductName(checkouts.primary, DISPLAY_ALIAS);
      const canonical = repositoryId(resolveStatsRepoName(checkouts.primary));

      await withStatisticsDatabase(async ({ db, laneEventRepo, usageRepo }) => {
        for (const repo of [canonical, OTHER_REPO]) {
          await laneEventRepo.append(laneEvent({
            repositoryId: repo, missionId: COLLIDING, from: null, to: 'backlog', at: INTAKE,
          }));
          await laneEventRepo.append(laneEvent({
            repositoryId: repo, missionId: COLLIDING, from: 'backlog', to: 'done', at: DONE,
          }));
        }
        await insertUsageRow(db, {
          repo: canonical, mission: COLLIDING, date: '2026-06-02',
          classification: 'ai_sdlc', closed: 'yes', prFixRounds: 1, durationMinutes: 10,
        });
        await insertUsageRow(db, {
          repo: OTHER_REPO, mission: COLLIDING, date: '2026-06-02',
          classification: 'user_value', closed: 'yes', prFixRounds: 9, durationMinutes: 900,
          actorKey: 'claude|other',
        });

        const metrics = await new ConcreteMetricsReadAdapter({
          laneEventRepo, usageRepo, repositoryId: canonical, clock: fixedClock(NOW),
        }).buildMetrics(new Map<MissionId, MissionStatus>([[COLLIDING, 'done']]));

        assert.equal(metrics.decisionWindow?.current.completedMissions, 1);
        assert.equal(metrics.decisionWindow?.current.agentRuntime.value, 10);
        assert.deepEqual(
          metrics.cohorts?.cohorts.map((entry) => entry.key),
          ['ai_sdlc'],
          'repository B\'s label must not appear in repository A\'s cohorts',
        );
      });
    } finally {
      checkouts.cleanup();
    }
  });

  it('resolves the same identity from a worktree carrying the same display alias', () => {
    const checkouts = createPrimaryAndWorktree('actual-repository-name');
    try {
      writeProductName(checkouts.primary, DISPLAY_ALIAS);
      writeProductName(checkouts.worktree, DISPLAY_ALIAS);
      assert.equal(
        resolveStatsRepoName(checkouts.worktree),
        resolveStatsRepoName(checkouts.primary),
      );
      assert.equal(resolveStatsRepoName(checkouts.worktree), 'actual-repository-name');
    } finally {
      checkouts.cleanup();
    }
  });
});
