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
import type { BoardLaneEventRepository } from '../src/application/ports/operation-history.js';
import {
  BoardEventRecorder,
  recordLaneTransitionSafely,
  eventToEntry,
  entryToEvent,
  laneTransitionEventToMissionTransition,
} from '../src/application/recording/board-event-recorder.js';
import type { LaneTransitionEvent } from '../src/domain/board-event.js';
import { triggerFromTransition, parseMissionStatus } from '../src/domain/board-event.js';
import type { MissionId, MissionStatus } from '../src/domain/mission.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-recorder-'));
}

function cleanup(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

async function withRepo(
  run: (repo: SqliteBoardLaneEventRepository, db: SqliteDatabaseAdapter) => Promise<void>,
): Promise<void> {
  const dir = createTempDir();
  const db = new SqliteDatabaseAdapter();
  await db.open({ path: path.join(dir, 'test.db') });
  try {
    const runner = new SqliteMigrationRunner(db);
    await runner.applyPending(loadDefaultMigrations());
    const repo = new SqliteBoardLaneEventRepository(db);
    await run(repo, db);
  } finally {
    await db.close();
    cleanup(dir);
  }
}

function event(overrides: Partial<LaneTransitionEvent> = {}): LaneTransitionEvent {
  return {
    missionId: 'task-1' as MissionId,
    repositoryId: '/repo' as never,
    from: 'backlog' as MissionStatus,
    to: 'active' as MissionStatus,
    trigger: 'activate',
    agent: 'codex',
    occurredAt: '2026-07-24T00:00:00Z',
    idempotencyKey: 'op-1',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LaneTransitionEvent domain model', () => {
  it('triggerFromTransition maps all valid state machine transitions', () => {
    assert.equal(triggerFromTransition('backlog', 'active'), null);
    assert.equal(triggerFromTransition('backlog', 'refined'), 'refine');
    assert.equal(triggerFromTransition('refined', 'active'), 'activate');
    assert.equal(triggerFromTransition('active', 'active'), 'activate');
    assert.equal(triggerFromTransition(null, 'active'), 'activate');
    assert.equal(triggerFromTransition('active', 'review'), 'submit-for-review');
    assert.equal(triggerFromTransition('review', 'active'), 'request-changes');
    assert.equal(triggerFromTransition('review', 'integration'), 'approve');
    assert.equal(triggerFromTransition('integration', 'done'), 'integrate');
  });

  it('triggerFromTransition returns null for unrecognised transitions', () => {
    assert.equal(triggerFromTransition('backlog', 'review'), null);
    assert.equal(triggerFromTransition('done', 'active'), null);
    assert.equal(triggerFromTransition('active', 'done'), null);
  });

  it('parseMissionStatus validates MissionStatus values', () => {
    assert.equal(parseMissionStatus('backlog'), 'backlog');
    assert.equal(parseMissionStatus('active'), 'active');
    assert.equal(parseMissionStatus('review'), 'review');
    assert.equal(parseMissionStatus('integration'), 'integration');
    assert.equal(parseMissionStatus('done'), 'done');
    assert.equal(parseMissionStatus('refined'), 'refined');
    assert.equal(parseMissionStatus('ready'), null);
    assert.equal(parseMissionStatus('approved'), null);
    assert.equal(parseMissionStatus(''), null);
  });
});

describe('BoardEventRecorder — mapping and persistence', () => {
  it('maps a lane-transition event to a BoardLaneEventEntry with typed columns', () => {
    const entry = eventToEntry(event());
    assert.equal(entry.missionId, 'task-1');
    assert.equal(entry.fromStatus, 'backlog');
    assert.equal(entry.toStatus, 'active');
    assert.equal(entry.trigger, 'activate');
    assert.equal(entry.agent, 'codex');
    assert.equal(entry.occurredAt, '2026-07-24T00:00:00Z');
    assert.equal(entry.idempotencyKey, 'op-1');

    // Round-trip through entryToEvent
    const roundTripped = entryToEvent(entry);
    assert.ok(roundTripped);
    assert.equal(roundTripped.from, 'backlog');
    assert.equal(roundTripped.to, 'active');
    assert.equal(roundTripped.trigger, 'activate');
  });

  it('writes a lane-transition event through the BoardLaneEventRepository', async () => {
    await withRepo(async (repo) => {
      const recorder = new BoardEventRecorder(repo);
      const wrote = await recorder.append(event());
      assert.equal(wrote, true);

      const rows = await repo.findByMissionId('task-1');
      assert.equal(rows.length, 1);
      assert.equal(rows[0].toStatus, 'active');
      assert.equal(rows[0].trigger, 'activate');
    });
  });

  it('SC5: emitting the same idempotency key twice does not produce a duplicate row', async () => {
    await withRepo(async (repo) => {
      const recorder = new BoardEventRecorder(repo);
      const first = await recorder.append(event({ idempotencyKey: 'op-dup' }));
      const second = await recorder.append(event({
        idempotencyKey: 'op-dup',
        to: 'review' as MissionStatus,
        trigger: 'submit-for-review',
      }));

      assert.equal(first, true, 'first emission writes a row');
      assert.equal(second, false, 'duplicate emission is an idempotent no-op');

      const rows = await repo.findByMissionId('task-1');
      assert.equal(rows.length, 1, 'only one row persists for the idempotency key');
      // The original (not the duplicate) is preserved.
      assert.equal(rows[0].toStatus, 'active');
    });
  });

  it('records distinct idempotency keys as separate rows', async () => {
    await withRepo(async (repo) => {
      const recorder = new BoardEventRecorder(repo);
      await recorder.append(event({ idempotencyKey: 'op-a', to: 'active' as MissionStatus }));
      await recorder.append(event({
        idempotencyKey: 'op-b',
        from: 'active' as MissionStatus,
        to: 'review' as MissionStatus,
        trigger: 'submit-for-review',
      }));

      const rows = await repo.findByMissionId('task-1');
      assert.equal(rows.length, 2);
    });
  });

  it('laneTransitionEventToMissionTransition produces lossless mapping', () => {
    const ev = event({
      from: 'backlog' as MissionStatus,
      to: 'active' as MissionStatus,
      trigger: 'activate',
    });
    const mt = laneTransitionEventToMissionTransition(ev);

    assert.equal(mt.missionId, ev.missionId);
    assert.equal(mt.from, ev.from);
    assert.equal(mt.to, ev.to);
    assert.equal(mt.trigger, ev.trigger);
    assert.equal(mt.actor, ev.agent);
    assert.equal(mt.occurredAt, ev.occurredAt);
  });

  it('laneTransitionEventToMissionTransition preserves a null from as the intake marker', () => {
    const ev = event({
      from: null,
      to: 'active' as MissionStatus,
      trigger: 'activate',
    });
    const mt = laneTransitionEventToMissionTransition(ev);

    // A null `from` is the mission's intake. Substituting `to` for it would
    // make the intake indistinguishable from a self-transition, and every
    // mission would then be seeded into history before it existed (TASK-2357).
    assert.equal(mt.from, null);
    assert.equal(mt.to, 'active');
  });
});

describe('recordLaneTransitionSafely — telemetry never blocks (SC4)', () => {
  it('swallows a recorder failure and returns false instead of throwing', async () => {
    const throwingRecorder = {
      append: async (): Promise<boolean> => {
        throw new Error('storage unavailable');
      },
    };

    let result: boolean | undefined;
    await assert.doesNotReject(async () => {
      result = await recordLaneTransitionSafely(throwingRecorder, event());
    });
    assert.equal(result, false, 'a recording failure is swallowed and reported as not-written');
  });

  it('counts a failed write while preserving the non-blocking result', async () => {
    const recorder = new BoardEventRecorder({
      async append() { throw new Error('storage unavailable'); },
    } as unknown as BoardLaneEventRepository);

    const wrote = await recordLaneTransitionSafely(recorder, event());

    assert.equal(wrote, false);
    assert.equal(recorder.failureCount, 1);
  });

  it('propagates a successful write result', async () => {
    await withRepo(async (repo) => {
      const recorder = new BoardEventRecorder(repo);
      const wrote = await recordLaneTransitionSafely(recorder, event());
      assert.equal(wrote, true);
    });
  });
});

describe('SqliteBoardLaneEventRepository — typed queries', () => {
  it('findByMissionId returns events ordered by occurred_at', async () => {
    await withRepo(async (repo) => {
      const recorder = new BoardEventRecorder(repo);
      await recorder.append(event({
        idempotencyKey: 'op-1',
        occurredAt: '2026-07-24T10:00:00Z',
        to: 'review' as MissionStatus,
        trigger: 'submit-for-review',
        from: 'active' as MissionStatus,
      }));
      await recorder.append(event({
        idempotencyKey: 'op-0',
        occurredAt: '2026-07-24T08:00:00Z',
        to: 'active' as MissionStatus,
        trigger: 'activate',
      }));

      const rows = await repo.findByMissionId('task-1');
      assert.equal(rows.length, 2);
      assert.equal(rows[0].occurredAt, '2026-07-24T08:00:00Z');
      assert.equal(rows[1].occurredAt, '2026-07-24T10:00:00Z');
    });
  });

  it('findAll returns events across all missions', async () => {
    await withRepo(async (repo) => {
      const recorder = new BoardEventRecorder(repo);
      await recorder.append(event({
        idempotencyKey: 'op-a',
        missionId: 'task-a' as MissionId,
      }));
      await recorder.append(event({
        idempotencyKey: 'op-b',
        missionId: 'task-b' as MissionId,
      }));

      const rows = await repo.findAll();
      assert.equal(rows.length, 2);
    });
  });
});
