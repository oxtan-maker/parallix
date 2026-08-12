import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { statsCohorts } from '../src/adapters/cli/commands/stats-cohorts.js';
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
// TASK-2357 defect B — a worktree path is never a repository identity.
//
// The fixture is a real Git primary checkout with a real linked worktree,
// because the canonical resolution shells out to `git worktree list`. Running
// `px stats cohorts` from the worktree with no `--repo` must reach the same
// rows as running it from the primary checkout, and must not reach a second
// repository that happens to use the same mission id.
// ---------------------------------------------------------------------------

const OTHER_REPO = repositoryId('unrelated-repo');
const COLLIDING = missionId('task-100');

const INTAKE = '2026-06-01T09:00:00.000Z';
const ACTIVE = '2026-06-01T11:00:00.000Z';
const DONE = '2026-06-02T09:00:00.000Z';
const NOW = '2026-06-03T09:00:00.000Z';

describe('TASK-2357 defect B: canonical repository identity from a worktree', () => {
  it('resolves `px stats cohorts` to the primary checkout identity, not the worktree path', async () => {
    const checkouts = createPrimaryAndWorktree('fixture-product');
    try {
      await withStatisticsDatabase(async ({ db, laneEventRepo, usageRepo }) => {
        const canonical = repositoryId(path.basename(checkouts.primary));

        // This repository's mission: completed, labelled `user_value`.
        await laneEventRepo.append(laneEvent({ repositoryId: canonical, missionId: COLLIDING, from: null, to: 'backlog', at: INTAKE }));
        await laneEventRepo.append(laneEvent({ repositoryId: canonical, missionId: COLLIDING, from: 'backlog', to: 'active', at: ACTIVE }));
        await laneEventRepo.append(laneEvent({ repositoryId: canonical, missionId: COLLIDING, from: 'active', to: 'done', at: DONE }));
        await insertUsageRow(db, {
          repo: canonical, mission: COLLIDING, date: '2026-06-02',
          classification: 'user_value', prFixRounds: 1,
        });

        // A second, unrelated repository reusing the same mission id.
        await laneEventRepo.append(laneEvent({ repositoryId: OTHER_REPO, missionId: COLLIDING, from: null, to: 'backlog', at: INTAKE }));
        await laneEventRepo.append(laneEvent({ repositoryId: OTHER_REPO, missionId: COLLIDING, from: 'backlog', to: 'done', at: DONE }));
        await insertUsageRow(db, {
          repo: OTHER_REPO, mission: COLLIDING, date: '2026-06-02',
          classification: 'ai_sdlc', prFixRounds: 9,
          actorKey: 'claude|other',
        });

        const lines: string[] = [];
        await statsCohorts([], {
          rootDir: checkouts.worktree,
          laneEventRepo,
          usageRepo,
          log: (message) => { lines.push(String(message)); },
          error: (message) => { lines.push(`ERROR ${String(message)}`); },
          exit: () => undefined,
          cohortMetadata: async () => new Map(),
        });

        const report = lines.join('\n');
        assert.match(report, /user_value/, `expected the primary checkout's cohort in:\n${report}`);
        assert.doesNotMatch(report, /ai_sdlc/, `the unrelated repository must not appear in:\n${report}`);
        assert.doesNotMatch(report, /No completed missions in this repository/, report);
      });
    } finally {
      checkouts.cleanup();
    }
  });

  it('produces identical BoardMetrics from the primary checkout and from its worktree', async () => {
    const checkouts = createPrimaryAndWorktree('fixture-product');
    try {
      await withStatisticsDatabase(async ({ db, laneEventRepo, usageRepo }) => {
        const canonical = repositoryId(path.basename(checkouts.primary));
        await laneEventRepo.append(laneEvent({ repositoryId: canonical, missionId: COLLIDING, from: null, to: 'backlog', at: INTAKE }));
        await laneEventRepo.append(laneEvent({ repositoryId: canonical, missionId: COLLIDING, from: 'backlog', to: 'done', at: DONE }));
        await insertUsageRow(db, {
          repo: canonical, mission: COLLIDING, date: '2026-06-02',
          classification: 'user_value', prFixRounds: 1,
        });

        const { resolveCanonicalRepositoryId } = await import('../src/adapters/git/repository-identity.js');
        const fromPrimary = resolveCanonicalRepositoryId(checkouts.primary);
        const fromWorktree = resolveCanonicalRepositoryId(checkouts.worktree);
        assert.equal(fromWorktree, fromPrimary, 'worktree and primary must resolve to one identity');
        assert.equal(fromPrimary, canonical);

        const initialStates = new Map<MissionId, MissionStatus>([[COLLIDING, 'done']]);
        const build = async (id: typeof fromPrimary) => new ConcreteMetricsReadAdapter({
          laneEventRepo, usageRepo, repositoryId: id, clock: fixedClock(NOW),
        }).buildMetrics(initialStates);

        const primaryMetrics = await build(fromPrimary);
        const worktreeMetrics = await build(fromWorktree);
        assert.equal(primaryMetrics.provenance.repositoryId, canonical);
        assert.equal(worktreeMetrics.provenance.repositoryId, canonical);
        // Hand-computed: exactly one completed mission is in scope.
        assert.equal(primaryMetrics.provenance.sampleSize, 1);
        assert.equal(worktreeMetrics.provenance.sampleSize, 1);
      });
    } finally {
      checkouts.cleanup();
    }
  });
});
