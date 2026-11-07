import { fixtureMission as typedMissionFixture } from '../../fixtures/mission-builders.js';
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
import { openMigratedMissionStore, type MigratedMissionStore } from '../../fixtures/mission-sqlite-store.js';

import { missionId, missionLabels, type Mission } from '../../../src/domain/mission.js';
import { changeRevision, type Review } from '../../../src/domain/review.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { repositoryId } from '../../../src/domain/repository.js';
import type { SqliteDatabaseAdapter } from '../../../src/adapters/sqlite/database-adapter.js';
import { SqliteMissionStore } from '../../../src/adapters/sqlite/mission-store.js';
import { approveLargeMissionRiskException, convertMissionToWave, type MissionWaveChildContract } from '../../../src/domain/mission-wave.js';

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
  return typedMissionFixture(String(MISSION_ID), {
    repositoryId: repositoryId('repo-parallix'),
    title,
    status: 'review',
    rawStatus: 'review',
    assignee: agentFamily('claude'),
    labels: [],
    checkpoints: [],
    netEngineeringLines: 0,
    closedAt: null,
    review});
}

function waveParent(slug: string): Mission {
  return typedMissionFixture(slug, {
    repositoryId: repositoryId('repo-parallix'), status: 'backlog', rawStatus: 'backlog',
    labels: missionLabels(['ai_sdlc']), checkpoints: [], review: null,
    brief: { goal: 'Split safely', why: 'Keep delivery bounded', scope: 'Wave only', outOfScope: [] },
    successCriteria: ['Wave is delivered'], declaredGates: ['npm test'], predictedNelBucket: 'Large',
  });
}

function waveChild(title: string, dependsOn: readonly number[] = []): MissionWaveChildContract {
  return {
    title, dependsOn,
    brief: { goal: `Deliver ${title}`, why: 'Independent value', scope: title, outOfScope: [] },
    criteria: [`${title} passes`], checkpoints: [{ name: 'CP-1', description: `Implement ${title}` }],
    gates: ['npm test'], predictedNelBucket: 'Medium', classification: 'ai_sdlc',
  };
}

// Only the immutable empty schema is shared; every case owns its copied file,
// connection and mutable aggregates, and disposes them even after a failure.
let schemaFixture: MigratedMissionStore;
let schemaTemplate: string;
test.before(async () => {
  schemaFixture = await openMigratedMissionStore();
  schemaTemplate = await schemaFixture.database.backup();
  await schemaFixture.database.close();
});
test.after(async () => { await schemaFixture?.close(); });

async function openStore() {
  const fixture = await openMigratedMissionStore([], schemaTemplate);
  return { db: fixture.database, store: fixture.store, close: () => fixture.close() };
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
  const { db, close } = await openStore();
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
    await close();
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
  const { db, close } = await openStore();
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
    await close();
  }
});

test('a save that drops the Review still clears the review tables', async () => {
  const { db, store, close } = await openStore();
  try {
    const version = await store.save(missionWith(reviewWith()), null);
    const withoutReview = ({ ...missionWith(reviewWith()), review: null });
    await store.save(withoutReview, version);

    const rows = await db.query('SELECT mission_id FROM mission_reviews WHERE mission_id = ?', [MISSION_ID]);
    assert.equal(rows.length, 0);
    const rounds = await db.query('SELECT mission_id FROM mission_review_rounds WHERE mission_id = ?', [MISSION_ID]);
    assert.equal(rounds.length, 0);
  } finally {
    await close();
  }
});

test('wave aggregates and Large risk exceptions round trip through real SQLite rows (PX-0030-F4)', async () => {
  const { store, close } = await openStore();
  try {
    const original = waveParent('task-9003');
    const version = await store.save(original, null);
    const wave = convertMissionToWave(original, [waveChild('foundation'), waveChild('consumer', [1])]);
    await store.saveWave(wave.parent, version, wave.children);

    const parent = await store.load(original.id);
    const first = await store.load(missionId('task-9003.01'));
    const second = await store.load(missionId('task-9003.02'));
    assert.equal(parent.kind, 'found');
    assert.deepEqual(parent.kind === 'found' && parent.mission.wave?.children, ['task-9003.01', 'task-9003.02']);
    assert.equal(first.kind, 'found');
    assert.equal(first.kind === 'found' && first.mission.waveParentId, 'task-9003');
    assert.deepEqual(second.kind === 'found' && second.mission.dependencies, ['task-9003.01']);

    const risk = approveLargeMissionRiskException(waveParent('task-9004'), {
      rationale: 'One transaction is safer', approvedBy: 'operator', approvedAt: '2026-11-04T10:00:00Z',
    });
    await store.save(risk, null);
    const loadedRisk = await store.load(risk.id);
    assert.equal(loadedRisk.kind, 'found');
    assert.deepEqual(loadedRisk.kind === 'found' && loadedRisk.mission.largeMissionRiskException, {
      rationale: 'One transaction is safer', approvedBy: 'operator', approvedAt: '2026-11-04T10:00:00.000Z',
    });
  } finally {
    await close();
  }
});

test('a failed child insert rolls back the parent and every prospective child (PX-0030-F4)', async () => {
  const { db, store, close } = await openStore();
  try {
    const original = waveParent('task-9005');
    const version = await store.save(original, null);
    const wave = convertMissionToWave(original, [waveChild('first'), waveChild('second')]);
    const failingDb = new Proxy(db, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (typeof value !== 'function') { return value; }
        if (property === 'execute') {
          return (sql: string, params?: unknown[]) => {
            if (/INSERT INTO missions\b/i.test(sql) && params?.[0] === 'task-9005.02') {
              throw new Error('forced child insert failure');
            }
            return value.call(target, sql, params);
          };
        }
        return value.bind(target);
      },
    }) as SqliteDatabaseAdapter;

    await assert.rejects(new SqliteMissionStore(failingDb).saveWave(wave.parent, version, wave.children), /forced child insert failure/);
    const parent = await store.load(original.id);
    assert.equal(parent.kind, 'found');
    assert.equal(parent.kind === 'found' && parent.mission.wave, null);
    assert.equal((await store.load(missionId('task-9005.01'))).kind, 'missing');
    assert.equal((await store.load(missionId('task-9005.02'))).kind, 'missing');
  } finally {
    await close();
  }
});
