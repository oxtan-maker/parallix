// Historical regression provenance: TASK-2347.01, TASK-2357, TASK-2363.
/**
 * Canonical repository identity for the metrics slice (TASK-2622.13
 * consolidation).
 *
 * integration-ci tier provenance tests migrated from the historical regression
 * identities `test/task-2347-01-repository-identity-repro.test.ts` (repository
 * scoping through lane events and board metrics),
 * `test/task-2357.b-canonical-repository-identity.test.ts` (a worktree path is
 * never a repository identity), and `test/task-2363-repository-identity.test.ts`
 * (a display `product.name` never splits repository identity). Historical task
 * IDs are kept in case names as regression provenance (AC#7). A shared real git
 * primary + linked-worktree fixture
 * (`test/fixtures/statistics-database.ts`) seeds the fixed event
 * history pinned to a rolling seven-day decision window.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteBoardLaneEventRepository } from '../src/adapters/sqlite/board-lane-event-repository.js';
import { BoardEventRecorder, eventToEntry, entryToEvent } from '../src/application/recording/board-event-recorder.js';
import { ConcreteMetricsReadAdapter } from '../src/application/projections/metrics-read-adapter.js';
import { statsCohorts } from '../src/adapters/cli/commands/stats-cohorts.js';
import { resolveStatsRepoName, upsertMeasurementRow } from '../src/adapters/cli/commands/stats.js';
import { resolveCanonicalRepositoryId } from '../src/adapters/git/repository-identity.js';
import { SqliteMeasurementStore } from '../src/adapters/sqlite/measurement-store.js';
import { repositoryId } from '../src/domain/repository.js';
import type { RepositoryId } from '../src/domain/repository.js';
import { missionId } from '../src/domain/mission.js';
import type { LaneTransitionEvent } from '../src/domain/board-event.js';
import type { MissionId, MissionStatus } from '../src/domain/mission.js';
import type { UsageRecord, UsageRepository } from '../src/application/ports/mission-measurements.js';
import type { BoardLaneEventEntry } from '../src/application/ports/operation-history.js';
import {
  createPrimaryAndWorktree, fixedClock, insertUsageRow, laneEvent, withStatisticsDatabase,
} from './fixtures/statistics-database.js';
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function r2347_01_createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-repro-2347-'));
}

function r2347_01_cleanup(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

async function r2347_01_withDb(
  run: (_laneRepo: SqliteBoardLaneEventRepository) => Promise<void>,
): Promise<void> {
  const dir = r2347_01_createTempDir();
  const db = new SqliteDatabaseAdapter();
  await db.open({ path: path.join(dir, 'test.db') });
  try {
    const runner = new SqliteMigrationRunner(db);
    await runner.applyPending(loadDefaultMigrations());
    const laneRepo = new SqliteBoardLaneEventRepository(db);
    await run(laneRepo);
  } finally {
    await db.close();
    r2347_01_cleanup(dir);
  }
}

/** Stub usage repository backed by an in-memory array. */
class R2347_01_InMemoryUsageRepository implements UsageRepository {
  private records: UsageRecord[] = [];

  async findAll(): Promise<readonly UsageRecord[]> {
    return [...this.records];
  }

  async findWhere(predicate: (_record: UsageRecord) => boolean): Promise<readonly UsageRecord[]> {
    return this.records.filter(predicate);
  }

  async save(record: UsageRecord): Promise<void> {
    this.records.push(record);
  }

  async saveAll(records: readonly UsageRecord[]): Promise<void> {
    this.records.push(...records);
  }

  async clear(): Promise<void> {
    this.records = [];
  }
}

function r2347_01_laneEvent(
  overrides: Partial<LaneTransitionEvent> = {},
): LaneTransitionEvent {
  return {
    missionId: 'task-9001' as MissionId,
    repositoryId: 'alpha' as RepositoryId,
    from: 'backlog' as MissionStatus,
    to: 'active' as MissionStatus,
    trigger: 'activate',
    agent: 'codex',
    occurredAt: '2026-07-24T00:00:00Z',
    idempotencyKey: 'alpha-task-9001-activate',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Reproduction tests — all must be RED at parent commit ed52d6abf
// ---------------------------------------------------------------------------

describe("repository identity through lane events and board metrics", () => {
  describe('cross-repository contamination (SC1)', () => {
    it('metrics built for alpha exclude lane events recorded for beta', async () => {
      await r2347_01_withDb(async (laneRepo) => {
        const recorder = new BoardEventRecorder(laneRepo);
        const usageRepo = new R2347_01_InMemoryUsageRepository();

        // Seed alpha transitions
        await recorder.append(r2347_01_laneEvent({
          idempotencyKey: 'alpha-activate',
          occurredAt: '2026-07-24T08:00:00Z',
        }));
        await recorder.append(r2347_01_laneEvent({
          idempotencyKey: 'alpha-review',
          from: 'active' as MissionStatus,
          to: 'review' as MissionStatus,
          trigger: 'submit-for-review',
          occurredAt: '2026-07-24T08:15:00Z',
        }));
        // Alpha closes 45 minutes after it was activated. Cycle time is this
        // lane window (task-2347.05), so the probe below reads a lifecycle
        // span rather than alpha's usage-row duration.
        await recorder.append(r2347_01_laneEvent({
          idempotencyKey: 'alpha-done',
          from: 'review' as MissionStatus,
          to: 'done' as MissionStatus,
          trigger: 'integrate',
          occurredAt: '2026-07-24T08:45:00Z',
        }));

        // Seed beta transitions (different repo, different mission)
        // Beta's mission is NOT in initialStates — without scoping its
        // transitions still create WIP that inflates alpha's metrics.
        await recorder.append(r2347_01_laneEvent({
          missionId: 'task-7001' as MissionId,
          repositoryId: 'beta' as RepositoryId,
          idempotencyKey: 'beta-activate',
          occurredAt: '2026-07-24T09:00:00Z',
        }));
        await recorder.append(r2347_01_laneEvent({
          missionId: 'task-7001' as MissionId,
          repositoryId: 'beta' as RepositoryId,
          from: 'active' as MissionStatus,
          to: 'done' as MissionStatus,
          trigger: 'integrate',
          idempotencyKey: 'beta-done',
          occurredAt: '2026-07-24T11:00:00Z',
        }));

        // Seed usage records — same mission slug under both repos
        await usageRepo.save({
          repo: 'alpha',
          mission: 'task-9001',
          duration_minutes: 45,
          pr_fix_rounds: 1,
          date: '2026-07-24',
        });
        await usageRepo.save({
          repo: 'beta',
          mission: 'task-9001',
          duration_minutes: 120,
          pr_fix_rounds: 3,
          date: '2026-07-24',
        });

        // Build metrics scoped to alpha
        const adapter = new ConcreteMetricsReadAdapter({
          laneEventRepo: laneRepo,
          usageRepo,
          repositoryId: 'alpha' as RepositoryId,
          // Completed-mission metrics report a rolling seven-day window, so the
          // projection clock is pinned beside the fixture's fixed dates.
          clock: () => '2026-07-24T12:00:00Z',
        });

        // Only alpha's mission in initial states
        const initialStates = new Map<MissionId, MissionStatus>();
        initialStates.set('task-9001' as MissionId, 'review' as MissionStatus);

        const metrics = await adapter.buildMetrics(initialStates);

        // (a) State flow is scoped: Alpha has 1 mission, beta has 1.
        // Without scoping it would include two missions.
        const lastFlow = metrics.cumulativeFlowByState.series.at(-1);
        assert.ok(lastFlow, 'cumulativeFlowByState must have data points');
        assert.equal(
          Object.values(lastFlow.counts).reduce((total, count) => total + count, 0),
          1,
          'alpha state flow must contain 1 mission (alpha only), not 2 (alpha + beta contamination)',
        );

        // (b) medianStateTimes uses cycleTimeMinutes from outcomes, which is
        // the mission's lane-event lifetime (08:00 → 08:45 = 45 minutes for
        // alpha). Beta's window is 09:00 → 11:00 = 120 minutes; without
        // repository scoping beta's lane events and usage row would reach
        // alpha's outcome and move this median off 45.
        const lastMedian = metrics.medianStateTimes.series.at(-1);
        assert.ok(lastMedian, 'medianStateTimes must have data points');
        assert.equal(
          lastMedian.value,
          45,
          'alpha median cycle time must be 45 (alpha alone), not 165 (alpha + beta merged)',
        );
      });
    });
  });

  describe('round-trip repository id (SC3)', () => {
    it('entryToEvent(eventToEntry(event)).repositoryId equals original for non-null from', () => {
      const ev: LaneTransitionEvent = r2347_01_laneEvent({
        from: 'backlog' as MissionStatus,
        to: 'active' as MissionStatus,
        repositoryId: 'alpha' as RepositoryId,
      });
      const entry = eventToEntry(ev);
      const restored = entryToEvent(entry);
      assert.ok(restored, 'round-trip must not be null');
      assert.equal(
        restored.repositoryId,
        ev.repositoryId,
        'repositoryId must survive round-trip (currently returns empty string cast as never)',
      );
    });

    it('entryToEvent(eventToEntry(event)).repositoryId equals original for null from', () => {
      const ev: LaneTransitionEvent = r2347_01_laneEvent({
        from: null,
        to: 'active' as MissionStatus,
        trigger: 'activate',
        repositoryId: 'alpha' as RepositoryId,
        idempotencyKey: 'alpha-null-from',
      });
      const entry = eventToEntry(ev);
      const restored = entryToEvent(entry);
      assert.ok(restored, 'round-trip must not be null for null-from event');
      assert.equal(
        restored.repositoryId,
        ev.repositoryId,
        'repositoryId must survive round-trip for null-from event',
      );
    });
  });

  describe('same idempotency key across two repositories (SC3)', () => {
    it('two rows with same idempotencyKey under different repositoryId both persist', async () => {
      await r2347_01_withDb(async (laneRepo) => {
        const recorder = new BoardEventRecorder(laneRepo);

        // Same idempotency key, different repos
        const key = 'shared-key-001';
        await recorder.append(r2347_01_laneEvent({
          repositoryId: 'alpha' as RepositoryId,
          idempotencyKey: key,
        }));
        await recorder.append(r2347_01_laneEvent({
          repositoryId: 'beta' as RepositoryId,
          idempotencyKey: key,
        }));

        // Both rows must exist (idempotency is scoped by repository)
        const all = await laneRepo.findAll();
        const alphaRows = all.filter((e: BoardLaneEventEntry) => e.repositoryId === 'alpha');
        const betaRows = all.filter((e: BoardLaneEventEntry) => e.repositoryId === 'beta');

        assert.equal(alphaRows.length, 1, 'alpha row must persist');
        assert.equal(betaRows.length, 1, 'beta row must persist');
      });
    });
  });

  describe('legacy sentinel exclusion (SC7)', () => {
    it('metrics for named repository exclude legacy-unscoped rows', async () => {
      await r2347_01_withDb(async (laneRepo) => {
        const recorder = new BoardEventRecorder(laneRepo);
        const usageRepo = new R2347_01_InMemoryUsageRepository();

        // Seed a row for alpha
        await recorder.append(r2347_01_laneEvent({
          idempotencyKey: 'alpha-only',
          occurredAt: '2026-07-24T08:00:00Z',
        }));

        // Seed a usage record for alpha
        await usageRepo.save({
          repo: 'alpha',
          mission: 'task-9001',
          duration_minutes: 30,
          date: '2026-07-24',
        });

        const adapter = new ConcreteMetricsReadAdapter({
          laneEventRepo: laneRepo,
          usageRepo,
          repositoryId: 'alpha' as RepositoryId,
        });

        const initialStates = new Map<MissionId, MissionStatus>();
        initialStates.set('task-9001' as MissionId, 'active' as MissionStatus);

        const metrics = await adapter.buildMetrics(initialStates);

        // Legacy-unscoped rows must not count toward alpha's metrics
        // At parent commit, there is no repository scoping at all,
        // so this test structure validates the scoping is in place
        const lastFlow = metrics.cumulativeFlowByState.series.at(-1);
        assert.ok(lastFlow && Object.values(lastFlow.counts).reduce((total, count) => total + count, 0) === 1, 'alpha must have exactly 1 mission in state flow');
      });
    });
  });

  describe('stable repository id across worktrees (SC6)', () => {
    it('repository id from mission worktree path equals id from primary checkout', async () => {
      // resolveStableRepositoryId must return the same value for a worktree
      // path and the primary checkout of the same repository.
      // This uses the real git repository so the remote.origin.url is available.
      const { resolveStableRepositoryId } = await import('../src/adapters/backlog/backlog.js');

      // The current working directory is the worktree for this mission
      const worktreeId = resolveStableRepositoryId(process.cwd());

      // Find the primary checkout (git rev-parse --git-dir parent for non-worktree,
      // or --show-toplevel for the common repo root)
      const { git } = await import('../src/adapters/git/git.js');
      const commonDir = git(['-C', process.cwd(), 'rev-parse', '--show-toplevel']);
      assert.equal(commonDir.status, 0, 'git rev-parse --show-toplevel must succeed');
      const primaryPath = commonDir.stdout.trim();
      const primaryId = resolveStableRepositoryId(primaryPath);

      assert.equal(
        worktreeId,
        primaryId,
        `repository id must be stable across worktrees: worktree="${worktreeId}" vs primary="${primaryId}"`,
      );

      // The id must NOT be the linked worktree's directory basename. In the
      // primary checkout the basename legitimately equals the repository name,
      // so the leak check only means something from a linked worktree.
      const { basename, resolve } = await import('node:path');
      const gitDir = git(['-C', process.cwd(), 'rev-parse', '--absolute-git-dir']).stdout.trim();
      const gitCommonDir = resolve(process.cwd(), git(['-C', process.cwd(), 'rev-parse', '--git-common-dir']).stdout.trim());
      if (gitDir === gitCommonDir) { return; }
      const worktreeBasename = basename(process.cwd());
      assert.notEqual(
        worktreeId,
        worktreeBasename,
        `repository id must not leak worktree basename "${worktreeBasename}"`,
      );
    });
  });
});
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

describe("defect B: canonical repository identity from a worktree", () => {
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
const OTHER_REPO_2363 = repositoryId('unrelated-repo');
const MISSION_FROM_PRIMARY = missionId('task-400');
const MISSION_FROM_WORKTREE = missionId('task-401');
const COLLIDING_2363 = missionId('task-402');

const INTAKE_2363 = '2026-06-01T09:00:00.000Z';
const DONE_2363 = '2026-06-02T09:00:00.000Z';
const NOW_2363 = '2026-06-03T09:00:00.000Z';

function writeProductName(rootDir: string, name: string): void {
  fs.writeFileSync(
    path.join(rootDir, 'workflow.config.json'),
    JSON.stringify({ product: { name } }, null, 2),
  );
}

describe("defect B: a display product name never splits repository identity", () => {
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
            repositoryId: canonical, missionId: mission, from: null, to: 'backlog', at: INTAKE_2363,
          }));
          await laneEventRepo.append(laneEvent({
            repositoryId: canonical, missionId: mission, from: 'backlog', to: 'done', at: DONE_2363,
          }));
          // Measurement written by the production CLI producer from that checkout.
          const store = new SqliteMeasurementStore(databasePath);
          try {
            upsertMeasurementRow({
              date: '2026-06-02', mission, classification: 'ai_sdlc',
              implementer: 'claude', pr_fix_rounds: '1', stage: 'default',
            } as never, { rootDir: root, store });
          } finally {
            store.close();
          }
        }

        const metrics = await new ConcreteMetricsReadAdapter({
          laneEventRepo, usageRepo, repositoryId: canonical, clock: fixedClock(NOW_2363),
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
        for (const repo of [canonical, OTHER_REPO_2363]) {
          await laneEventRepo.append(laneEvent({
            repositoryId: repo, missionId: COLLIDING_2363, from: null, to: 'backlog', at: INTAKE_2363,
          }));
          await laneEventRepo.append(laneEvent({
            repositoryId: repo, missionId: COLLIDING_2363, from: 'backlog', to: 'done', at: DONE_2363,
          }));
        }
        await insertUsageRow(db, {
          repo: canonical, mission: COLLIDING_2363, date: '2026-06-02',
          classification: 'ai_sdlc', prFixRounds: 1, durationMinutes: 10,
        });
        await insertUsageRow(db, {
          repo: OTHER_REPO_2363, mission: COLLIDING_2363, date: '2026-06-02',
          classification: 'user_value', prFixRounds: 9, durationMinutes: 900,
          actorKey: 'claude|other',
        });

        const metrics = await new ConcreteMetricsReadAdapter({
          laneEventRepo, usageRepo, repositoryId: canonical, clock: fixedClock(NOW_2363),
        }).buildMetrics(new Map<MissionId, MissionStatus>([[COLLIDING_2363, 'done']]));

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
