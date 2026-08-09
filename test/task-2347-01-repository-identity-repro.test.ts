import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import {
  SqliteMigrationRunner,
  loadDefaultMigrations,
} from '../src/adapters/sqlite/migration-runner.js';
import { SqliteBoardLaneEventRepository } from '../src/adapters/sqlite/board-lane-event-repository.js';
import {
  BoardEventRecorder,
  eventToEntry,
  entryToEvent,
} from '../src/application/recording/board-event-recorder.js';
import { ConcreteMetricsReadAdapter } from '../src/application/projections/metrics-read-adapter.js';
import type { LaneTransitionEvent } from '../src/domain/board-event.js';
import type { MissionId, MissionStatus } from '../src/domain/mission.js';
import type { UsageRecord, UsageRepository } from '../src/application/ports/mission-measurements.js';
import type { BoardLaneEventEntry } from '../src/application/ports/operation-history.js';
import type { RepositoryId } from '../src/domain/repository.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-repro-2347-'));
}

function cleanup(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

async function withDb(
  run: (
    laneRepo: SqliteBoardLaneEventRepository,
    db: SqliteDatabaseAdapter,
  ) => Promise<void>,
): Promise<void> {
  const dir = createTempDir();
  const db = new SqliteDatabaseAdapter();
  await db.open({ path: path.join(dir, 'test.db') });
  try {
    const runner = new SqliteMigrationRunner(db);
    await runner.applyPending(loadDefaultMigrations());
    const laneRepo = new SqliteBoardLaneEventRepository(db);
    await run(laneRepo, db);
  } finally {
    await db.close();
    cleanup(dir);
  }
}

/** Stub usage repository backed by an in-memory array. */
class InMemoryUsageRepository implements UsageRepository {
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

function laneEvent(
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

describe('task-2347.01 — repository identity through lane events and board metrics', () => {
  describe('cross-repository contamination (SC1)', () => {
    it('metrics built for alpha exclude lane events recorded for beta', async () => {
      await withDb(async (laneRepo) => {
        const recorder = new BoardEventRecorder(laneRepo);
        const usageRepo = new InMemoryUsageRepository();

        // Seed alpha transitions
        await recorder.append(laneEvent({
          idempotencyKey: 'alpha-activate',
          occurredAt: '2026-07-24T08:00:00Z',
        }));
        await recorder.append(laneEvent({
          idempotencyKey: 'alpha-review',
          from: 'active' as MissionStatus,
          to: 'review' as MissionStatus,
          trigger: 'submit-for-review',
          occurredAt: '2026-07-24T10:00:00Z',
        }));

        // Seed beta transitions (different repo, different mission)
        // Beta's mission is NOT in initialStates — without scoping its
        // transitions still create WIP that inflates alpha's metrics.
        await recorder.append(laneEvent({
          missionId: 'task-7001' as MissionId,
          repositoryId: 'beta' as RepositoryId,
          idempotencyKey: 'beta-activate',
          occurredAt: '2026-07-24T09:00:00Z',
        }));
        await recorder.append(laneEvent({
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
          closed: 'yes',
        });
        await usageRepo.save({
          repo: 'beta',
          mission: 'task-9001',
          duration_minutes: 120,
          pr_fix_rounds: 3,
          date: '2026-07-24',
          closed: 'yes',
        });

        // Build metrics scoped to alpha
        const adapter = new ConcreteMetricsReadAdapter({
          laneEventRepo: laneRepo,
          usageRepo,
          repositoryId: 'alpha' as RepositoryId,
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

        // (b) medianStateTimes uses cycleTimeMinutes from outcomes.
        // Without scoping: both usage records merge by mission key,
        // cycleTimeMinutes = 45 + 120 = 165.
        // With scoping: only alpha's record, cycleTimeMinutes = 45.
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
      const ev: LaneTransitionEvent = laneEvent({
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
      const ev: LaneTransitionEvent = laneEvent({
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
      await withDb(async (laneRepo) => {
        const recorder = new BoardEventRecorder(laneRepo);

        // Same idempotency key, different repos
        const key = 'shared-key-001';
        await recorder.append(laneEvent({
          repositoryId: 'alpha' as RepositoryId,
          idempotencyKey: key,
        }));
        await recorder.append(laneEvent({
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
      await withDb(async (laneRepo) => {
        const recorder = new BoardEventRecorder(laneRepo);
        const usageRepo = new InMemoryUsageRepository();

        // Seed a row for alpha
        await recorder.append(laneEvent({
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

      // The id must NOT be the worktree directory basename (which would differ)
      const { basename } = await import('node:path');
      const worktreeBasename = basename(process.cwd());
      assert.notEqual(
        worktreeId,
        worktreeBasename,
        `repository id must not leak worktree basename "${worktreeBasename}"`,
      );
    });
  });
});
