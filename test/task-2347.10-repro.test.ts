// Reproduction test for task-2347.10: Count review fix rounds from a source that records them.
//
// Bug: deriveImplementerAndFixRounds counts rounds[].decision.kind === 'changes-requested'
// but the live review loop never writes that decision. The live loop writes
// reviewEvents with eventType 'reviewer_outcome' and verdict 'request-changes'.
//
// This test seeds reviewEvents (the live source) and asserts prFixRounds > 0.
// It FAILS on the current implementation (returns 0) and PASSES after the fix.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import os from 'node:os';

// The helpers this file exercises hang off the default export object rather
// than the module's named exports, so this must be the default import.
import stats from '../src/adapters/cli/commands/stats.js';
import { agentFamily } from '../src/domain/agents.js';
import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../src/adapters/sqlite/mission-store.js';
import { clearOperatorStateCache } from '../src/adapters/sqlite/adapter-factory.js';
import { missionId } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import { changeRevision } from '../src/domain/review.js';

function createRepoFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2347.10-'));
  fs.mkdirSync(path.join(root, 'missions'), { recursive: true });
  spawnSync('git', ['init'], { cwd: root });
  spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: root });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  spawnSync('git', ['checkout', '-b', 'main'], { cwd: root });
  spawnSync('git', ['commit', '-m', 'init', '--allow-empty'], { cwd: root });
  return root;
}

// Helper: seed a mission with reviewEvents (live source) but rounds[].decision = null.
// This matches the actual live loop: events written, decision never set to 'changes-requested'.
async function seedMissionWithEvents(home, slug, rootDir, reviewEvents, roundOverrides = {}) {
  fs.mkdirSync(home, { recursive: true });
  const previousHome = process.env.PARALLIX_HOME;
  process.env.PARALLIX_HOME = home;
  await clearOperatorStateCache();

  const database = new SqliteDatabaseAdapter();
  await database.open({ path: path.join(home, 'parallix.db') });
  await new SqliteMigrationRunner(database).applyPending(loadDefaultMigrations());

  const store = new SqliteMissionStore(database);

  const mission = {
    id: missionId(slug),
    repositoryId: repositoryId(rootDir),
    title: `Mission ${slug}`,
    labels: [],
    assignee: agentFamily('claude'),
    status: 'review',
    rawStatus: 'review',
    checkpoints: [],
    netEngineeringLines: null,
    closedAt: null,
    externalTaskRef: null,
    intakeTrace: null,
    review: {
      rounds: [{
        number: 1,
        subject: {
          change: { kind: 'local-branch', sourceBranch: `mission/${slug}`, targetBranch: 'main' },
          revision: changeRevision('rev-1'),
        },
        reviewer: agentFamily('codex'),
        implementer: agentFamily('claude'),
        startedAt: '2026-08-02T10:00:00.000Z',
        decision: null, // LIVE LOOP: decision never set to 'changes-requested'
        response: null,
        phase: 'fixing',
        disposition: null,
        reviewerRetryCount: 0,
        implementerRetryCount: 0,
        ...roundOverrides,
      }],
      intervention: null,
      stageLaunches: [],
      reviewEvents, // LIVE SOURCE: events written by persistEventInStore
    },
  };

  // @ts-expect-error -- TASK-2328: runtime-only property/partial test double absent from the inferred type.
  await store.save(mission, null);

  // Seed import history to avoid re-import conflicts
  await database.execute(
    `INSERT INTO import_history (source_path, digest, imported_count, skipped_count, imported_at, backup_path)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [rootDir, `seeded-${slug}`, 1, 0, new Date().toISOString(), null],
  );

  const restore = async () => {
    await database.close();
    if (previousHome === undefined) { delete process.env.PARALLIX_HOME; }
    else { process.env.PARALLIX_HOME = previousHome; }
    clearOperatorStateCache();
  };
  restore.store = store;
  return restore;
}

// -- Red-to-green reproduction test --

test('deriveImplementerAndFixRounds counts fix rounds from reviewEvents (task-2347.10 repro)', async () => {
  const root = createRepoFixture();

  // One reviewer_outcome with verdict 'request-changes' = 1 fix round.
  // This is what the live loop writes via persistEventInStore.
  const reviewEvents = [
    {
      position: 0,
      eventType: 'reviewer_findings',
      roundNumber: 1,
      phase: 'reviewing',
      actor: 'codex',
      content: 'Reviewer found issues',
      disposition: null,
      verdict: null,
      itemDispositions: null,
      blockedReason: null,
      followUpReference: null,
      createdAt: '2026-08-02T10:00:00.000Z',
    },
    {
      position: 1,
      eventType: 'reviewer_outcome',
      roundNumber: 1,
      phase: 'reviewing',
      actor: 'codex',
      content: 'Changes requested',
      disposition: null,
      verdict: 'request-changes', // LIVE LOOP: this is the fix-round signal
      itemDispositions: null,
      blockedReason: null,
      followUpReference: null,
      createdAt: '2026-08-02T10:05:00.000Z',
    },
  ];

  const restoreHome = await seedMissionWithEvents(
    path.join(root, 'parallix-home'),
    'task-2347.10-repro',
    root,
    reviewEvents,
  );

  try {
    // @ts-expect-error -- TASK-2328: runtime-only property/partial test double absent from the inferred type.
    const info = await stats._internals.deriveImplementerAndFixRounds(
      'task-2347.10-repro',
      root,
      restoreHome.store,
    );

    assert.equal(info.source, 'review-aggregate', 'should use review-aggregate source');
    assert.equal(info.implementer, 'claude', 'should derive implementer');
    assert.equal(
      info.prFixRounds,
      1,
      'MUST be 1: one reviewer_outcome with verdict=request-changes = one fix round. ' +
      'Current implementation returns 0 because it counts rounds[].decision.kind which is never set.',
    );
  } finally {
    await restoreHome();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('deriveImplementerAndFixRounds counts two fix rounds from reviewEvents (task-2347.10)', async () => {
  const root = createRepoFixture();

  // Two reviewer_outcome events with verdict 'request-changes' = 2 fix rounds.
  const reviewEvents = [
    {
      position: 0,
      eventType: 'reviewer_outcome',
      roundNumber: 1,
      phase: 'reviewing',
      actor: 'codex',
      content: 'Round 1 changes requested',
      disposition: null,
      verdict: 'request-changes',
      itemDispositions: null,
      blockedReason: null,
      followUpReference: null,
      createdAt: '2026-08-02T10:00:00.000Z',
    },
    {
      position: 1,
      eventType: 'reviewer_outcome',
      roundNumber: 2,
      phase: 'reviewing',
      actor: 'codex',
      content: 'Round 2 changes requested',
      disposition: null,
      verdict: 'request-changes',
      itemDispositions: null,
      blockedReason: null,
      followUpReference: null,
      createdAt: '2026-08-02T12:00:00.000Z',
    },
    {
      position: 2,
      eventType: 'reviewer_outcome',
      roundNumber: 3,
      phase: 'reviewing',
      actor: 'codex',
      content: 'Approved',
      disposition: null,
      verdict: 'approve',
      itemDispositions: null,
      blockedReason: null,
      followUpReference: null,
      createdAt: '2026-08-02T14:00:00.000Z',
    },
  ];

  const restoreHome = await seedMissionWithEvents(
    path.join(root, 'parallix-home'),
    'task-2347.10-two-rounds',
    root,
    reviewEvents,
  );

  try {
    // @ts-expect-error -- TASK-2328: runtime-only property/partial test double absent from the inferred type.
    const info = await stats._internals.deriveImplementerAndFixRounds(
      'task-2347.10-two-rounds',
      root,
      restoreHome.store,
    );

    assert.equal(info.source, 'review-aggregate');
    assert.equal(info.prFixRounds, 2, 'two reviewer_outcome events with verdict=request-changes = 2 fix rounds');
  } finally {
    await restoreHome();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('deriveImplementerAndFixRounds returns 0 for approved-first-time mission (task-2347.10)', async () => {
  const root = createRepoFixture();

  // One reviewer_outcome with verdict 'approve' = 0 fix rounds.
  const reviewEvents = [
    {
      position: 0,
      eventType: 'reviewer_outcome',
      roundNumber: 1,
      phase: 'reviewing',
      actor: 'codex',
      content: 'Approved on first review',
      disposition: null,
      verdict: 'approve',
      itemDispositions: null,
      blockedReason: null,
      followUpReference: null,
      createdAt: '2026-08-02T10:00:00.000Z',
    },
  ];

  const restoreHome = await seedMissionWithEvents(
    path.join(root, 'parallix-home'),
    'task-2347.10-approved-first',
    root,
    reviewEvents,
  );

  try {
    // @ts-expect-error -- TASK-2328: runtime-only property/partial test double absent from the inferred type.
    const info = await stats._internals.deriveImplementerAndFixRounds(
      'task-2347.10-approved-first',
      root,
      restoreHome.store,
    );

    assert.equal(info.source, 'review-aggregate');
    assert.equal(info.prFixRounds, 0, 'approved first time = 0 fix rounds');
  } finally {
    await restoreHome();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('deriveImplementerAndFixRounds returns unknown when no reviewEvents and no decision (task-2347.10)', async () => {
  const root = createRepoFixture();

  // No reviewEvents, no decision on rounds — count cannot be determined.
  const reviewEvents = [];

  const restoreHome = await seedMissionWithEvents(
    path.join(root, 'parallix-home'),
    'task-2347.10-unknown',
    root,
    reviewEvents,
  );

  try {
    // @ts-expect-error -- TASK-2328: runtime-only property/partial test double absent from the inferred type.
    const info = await stats._internals.deriveImplementerAndFixRounds(
      'task-2347.10-unknown',
      root,
      restoreHome.store,
    );

    // When review aggregate exists but has no fix-round signal (no events, no decisions),
    // it should report prFixRounds as null/unknown rather than confident 0.
    assert.ok(
      info.prFixRounds === null || info.prFixRounds === undefined || info.prFixRounds === 'unknown',
      `must report unknown, got: ${info.prFixRounds}`,
    );
  } finally {
    await restoreHome();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
