/**
 * The Mission aggregate is rewritten as DELETE-then-INSERT and composition
 * shares one SQLite handle process-wide, so a transaction gives a concurrent
 * read on that handle no isolation. These tests pin the two properties that
 * kept the review loop from persisting a verdict: an interleaved read must
 * never see a mission whose Review has vanished, and an unrelated save must
 * not cascade the review-event audit trail away.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { missionId, type Mission } from '../src/domain/mission.js';
import { changeRevision, type Review } from '../src/domain/review.js';
import { agentFamily } from '../src/domain/agents.js';
import { repositoryId } from '../src/domain/repository.js';
import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { loadDefaultMigrations, SqliteMigrationRunner } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../src/adapters/sqlite/mission-store.js';

const MISSION_ID = missionId('task-9002');

function reviewWith(overrides: Partial<Review> = {}): Review {
  return {
    rounds: [{
      number: 1,
      subject: {
        change: { kind: 'local-branch', sourceBranch: 'mission/task-9002', targetBranch: 'main' },
        revision: changeRevision('rev-1'),
      },
      reviewer: agentFamily('codex'),
      implementer: agentFamily('claude'),
      startedAt: '2026-08-04T09:00:00.000Z',
      decision: null,
      response: null,
      phase: 'reviewing',
      disposition: null,
      reviewerRetryCount: 0,
      implementerRetryCount: 0,
    }],
    intervention: null,
    stageLaunches: [],
    reviewEvents: [],
    ...overrides,
  } as Review;
}

function missionWith(review: Review, title = 'aggregate read during write'): Mission {
  return {
    id: MISSION_ID,
    repositoryId: repositoryId('repo-parallix'),
    title,
    status: 'review',
    rawStatus: 'review',
    assignee: agentFamily('claude'),
    labels: [],
    checkpoints: [],
    netEngineeringLines: 0,
    closedAt: null,
    review,
  } as unknown as Mission;
}

async function openStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2339-aggregate-'));
  const db = new SqliteDatabaseAdapter();
  await db.open({ path: path.join(dir, 'parallix.db') });
  await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
  return { db, store: new SqliteMissionStore(db), dir };
}

/**
 * Wrap the adapter so the reader's first statement is held until the writer has
 * cleared the review rows. Without that hold the interleaving is at the mercy
 * of microtask ordering; with it, the window the shared connection opens is
 * deterministic.
 */
function holdReaderUntilReviewCleared(db: SqliteDatabaseAdapter) {
  let releaseReader: () => void = () => {};
  const reviewCleared = new Promise<void>((resolve) => { releaseReader = resolve; });
  let held = false;

  return new Proxy(db, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') { return value; }
      if (property === 'execute') {
        return async (sql: string, params?: unknown[]) => {
          const result = await value.call(target, sql, params);
          if (/DELETE FROM mission_review/i.test(sql)) { releaseReader(); }
          return result;
        };
      }
      if (property === 'query') {
        return async (sql: string, params?: unknown[]) => {
          if (!held && /SELECT id, repository_id/i.test(sql)) {
            held = true;
            await Promise.race([
              reviewCleared,
              new Promise<void>((resolve) => setTimeout(resolve, 2000).unref?.()),
            ]);
          }
          return value.call(target, sql, params);
        };
      }
      return value.bind(target);
    },
  }) as SqliteDatabaseAdapter;
}

test('a load that races an aggregate write never observes the mission without its Review', async () => {
  const { db } = await openStore();
  try {
    const store = new SqliteMissionStore(holdReaderUntilReviewCleared(db));
    const version = await store.save(missionWith(reviewWith()), null);

    // The review loop's real shape: a stage launch is recorded while the
    // artifact consumer reads the same mission on the same connection.
    const writing = store.save(
      missionWith(reviewWith({
        stageLaunches: [{ stageKey: 'review:codex', fingerprints: ['codex||a|b|0'] }],
      } as Partial<Review>)),
      version,
    );
    const reading = store.load(MISSION_ID);

    const [, observed] = await Promise.all([writing, reading]);

    assert.equal(observed.kind, 'found');
    assert.ok(
      observed.kind === 'found' && observed.mission.review,
      'the interleaved read saw a mission whose Review had vanished',
    );
    assert.equal(observed.kind === 'found' && observed.mission.review?.rounds.length, 1);
  } finally {
    await db.close();
  }
});

/** Record every statement a store operation issues. */
function recordStatements(db: SqliteDatabaseAdapter, statements: string[]) {
  return new Proxy(db, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') { return value; }
      if (property === 'execute') {
        return (sql: string, params?: unknown[]) => {
          statements.push(sql);
          return value.call(target, sql, params);
        };
      }
      return value.bind(target);
    },
  }) as SqliteDatabaseAdapter;
}

test('a save that keeps the Review never deletes the row its children cascade from', async () => {
  const { db } = await openStore();
  try {
    const statements: string[] = [];
    const store = new SqliteMissionStore(recordStatements(db, statements));
    const review = reviewWith({
      reviewEvents: [{
        position: 0,
        eventType: 'reviewer_findings',
        roundNumber: 1,
        phase: 'reviewing',
        actor: 'codex',
        content: '# Findings',
        disposition: null,
        verdict: null,
        itemDispositions: null,
        blockedReason: null,
        followUpReference: null,
        createdAt: '2026-08-04T09:10:00.000Z',
      }],
    } as Partial<Review>);
    const version = await store.save(missionWith(review), null);

    statements.length = 0;
    await store.save(missionWith(review, 'renamed'), version);

    assert.equal(
      statements.filter((sql) => /DELETE FROM mission_reviews\b/i.test(sql)).length,
      0,
      'a save that keeps the Review must not delete mission_reviews',
    );
    assert.ok(
      statements.some((sql) => /INSERT INTO mission_reviews[\s\S]*ON CONFLICT/i.test(sql)),
      'the review row must be upserted in place',
    );

    const reloaded = await store.load(MISSION_ID);
    assert.equal(reloaded.kind, 'found');
    assert.equal(reloaded.kind === 'found' && reloaded.mission.review?.reviewEvents.length, 1);
  } finally {
    await db.close();
  }
});

test('a save that drops the Review still clears the review tables', async () => {
  const { db, store } = await openStore();
  try {
    const version = await store.save(missionWith(reviewWith()), null);
    const withoutReview = { ...missionWith(reviewWith()), review: null } as unknown as Mission;
    await store.save(withoutReview, version);

    const rows = await db.query('SELECT mission_id FROM mission_reviews WHERE mission_id = ?', [MISSION_ID]);
    assert.equal(rows.length, 0);
    const rounds = await db.query('SELECT mission_id FROM mission_review_rounds WHERE mission_id = ?', [MISSION_ID]);
    assert.equal(rounds.length, 0);
  } finally {
    await db.close();
  }
});
