/**
 * Stats-command internals for the metrics slice (TASK-2622.13 consolidation).
 *
 * integration-ci tier provenance tests migrated from
 * `test/task-2347.10-repro.test.ts` (deriveImplementerAndFixRounds counts live
 * reviewEvents), `test/task-2378-authoritative-stats.test.ts` (the production
 * stats adapter reaches the Review aggregate; a failed approval boundary
 * surfaces instead of promoting Backlog), and `test/task-2348-implementer-
 * attribution.test.ts` (the closed rollup row is the authority for grouping and
 * fix-rounds). These exercise the real stats internals over a migrated SQLite
 * operator database, so they stay in the integration-ci lane. Historical task
 * IDs are kept in case names as regression provenance (AC#7).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { agentFamily } from '../../../src/domain/agents.js';
import { missionId } from '../../../src/domain/mission.js';
import { repositoryId } from '../../../src/domain/repository.js';
import {
  changeRevision,
  reviewFindingId,
  ConfiguredReviewerEligibility,
  startReview,
  type ReviewedChange,
} from '../../../src/domain/review.js';
import { createStatsRecordingUseCase } from '../../../src/adapters/cli/commands/stats.js';
import { submitReviewRound } from '../../../src/adapters/review/review-commands.js';
import { bindReviewPersistence } from '../../../src/composition/review-persistence.js';
import { MissionLifecycleService } from '../../../src/application/mission-lifecycle-service.js';
import { recoverMissionForIntegration } from '../../../src/adapters/cli/commands/integrate.js';
import { SqliteDatabaseAdapter } from '../../../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../../../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../../../src/adapters/sqlite/mission-store.js';
import { clearOperatorStateCache } from '../../../src/adapters/sqlite/adapter-factory.js';
import { seedMissionDatabase } from '../../fixtures/review-state-db.js';
import stats from '../../../src/adapters/cli/commands/stats.js';

// Reproduction test for task-2347.10: Count review fix rounds from a source that records them.
//
// Bug: deriveImplementerAndFixRounds counts rounds[].decision.kind === 'changes-requested'
// but the live review loop never writes that decision. The live loop writes
// reviewEvents with eventType 'reviewer_outcome' and verdict 'request-changes'.
//
// This test seeds reviewEvents (the live source) and asserts prFixRounds > 0.
// It FAILS on the current implementation (returns 0) and PASSES after the fix.


// The helpers this file exercises hang off the default export object rather
// than the module's named exports, so this must be the default import.

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
    const info = await stats._internals.deriveImplementerAndFixRounds(
      'task-2347.10-unknown',
      root,
      restoreHome.store,
    );

    // When review aggregate exists but has no fix-round signal (no events, no decisions),
    // it should report prFixRounds as null/unknown rather than confident 0.
    assert.ok(
      info.prFixRounds === null || info.prFixRounds === undefined,
      `must report unknown, got: ${info.prFixRounds}`,
    );
  } finally {
    await restoreHome();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
// TASK-2378 regression tests.
//
// R5 (this file, added by CP-5) plus the two CP-1 reproduction cases below.
//
// Two defects survive task-2376's round:
//
//   1. The production `px stats` wiring builds its workflow adapter with no
//      MissionStore, so `deriveImplementerAndFixRounds` cannot reach the
//      authoritative Review aggregate and reports `missing-authority`/`unknown`
//      for a mission whose Review is right there in the operator database.
//   2. `ReviewState.save()` swallows a failed `review → integration` transition
//      at the approval boundary, and the approval command promotes the Backlog
//      task to `approved` anyway — Backlog then claims approved while the
//      Mission is still `review`.
//
// Both cases below are RED on the parent commit.



const repo = repositoryId('parallix');
const implementer = agentFamily('configured-implementer');
const reviewer = agentFamily('configured-reviewer');
const reviewerEligibility = ConfiguredReviewerEligibility.fromReviewStep({
  eligible: [reviewer],
  strategy: 'random',
});
const pullRequest: ReviewedChange = {
  kind: 'pull-request',
  provider: 'forgejo',
  id: '2378',
  url: null,
  sourceBranch: 'mission/task-2378',
  targetBranch: 'main',
};

interface Fixture {
  root: string;
  database: SqliteDatabaseAdapter;
  store: SqliteMissionStore;
  cleanup: () => Promise<void>;
}

async function createFixture(prefix: string): Promise<Fixture> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(root, 'missions'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'tasks'), { recursive: true });
  spawnSync('git', ['init'], { cwd: root });
  spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: root });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  spawnSync('git', ['checkout', '-b', 'main'], { cwd: root });
  spawnSync('git', ['commit', '-m', 'init', '--allow-empty'], { cwd: root });

  const home = path.join(root, 'parallix-home');
  fs.mkdirSync(home, { recursive: true });
  const previousHome = process.env.PARALLIX_HOME;
  process.env.PARALLIX_HOME = home;
  await clearOperatorStateCache();

  const database = new SqliteDatabaseAdapter();
  await database.open({ path: path.join(home, 'parallix.db') });
  await new SqliteMigrationRunner(database).applyPending(loadDefaultMigrations());
  const store = new SqliteMissionStore(database);

  return {
    root,
    database,
    store,
    cleanup: async () => {
      await database.close();
      if (previousHome === undefined) { delete process.env.PARALLIX_HOME; }
      else { process.env.PARALLIX_HOME = previousHome; }
      await clearOperatorStateCache();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function reviewerOutcome(position: number, roundNumber: number, verdict: string, createdAt: string) {
  return {
    position,
    eventType: 'reviewer_outcome',
    roundNumber,
    phase: 'reviewing',
    actor: reviewer,
    content: `round ${roundNumber} ${verdict}`,
    disposition: null,
    verdict,
    itemDispositions: null,
    blockedReason: null,
    followUpReference: null,
    createdAt,
  };
}

// ---------------------------------------------------------------------------
// Case 1 — the production statistics helper must reach the Review aggregate.
//
// RED on parent: calling the helper without a MissionStore returns
// `{ implementer: 'unknown', prFixRounds: null, source: 'missing-authority' }`.
// ---------------------------------------------------------------------------

test('live stats workflow adapter derives authoritative implementer and reviewFixRounds from the Review aggregate (task-2378)', async () => {
  const fixture = await createFixture('task-2378-stats-');
  const slug = 'task-2378-stats';

  // Misleading external artifact: the backlog task names a different agent and
  // a different round count. Nothing may read it.
  fs.writeFileSync(
    path.join(fixture.root, 'backlog', 'tasks', `${slug} - Test.md`),
    '---\nid: TASK-2378-STATS\nlabels: [ai_sdlc]\nassignee: [codex]\nstatus: done\n---\nReview round 7\n',
  );

  const mission = {
    id: missionId(slug),
    repositoryId: repo,
    title: 'Stats adapter authority',
    labels: [],
    assignee: implementer,
    status: 'review' as const,
    rawStatus: 'review',
    checkpoints: [],
    netEngineeringLines: null,
    closedAt: null,
    externalTaskRef: null,
    intakeTrace: null,
    review: {
      rounds: [{
        number: 1,
        subject: { change: pullRequest, revision: changeRevision('abc123') },
        reviewer,
        implementer,
        startedAt: '2026-01-01T10:00:00Z',
        decision: null,
        response: null,
        phase: 'fixing',
        disposition: null,
        reviewerRetryCount: 0,
        implementerRetryCount: 0,
      }],
      intervention: null,
      stageLaunches: [],
      reviewEvents: [
        reviewerOutcome(0, 1, 'request-changes', '2026-01-01T10:00:00Z'),
        reviewerOutcome(1, 2, 'request-changes', '2026-01-01T11:00:00Z'),
        reviewerOutcome(2, 3, 'approve', '2026-01-01T12:00:00Z'),
      ],
    },
  };
  // @ts-expect-error -- partial mission for test seed
  await fixture.store.save(mission, null);

  try {
    const info = await stats._internals.deriveImplementerAndFixRounds(slug, fixture.root, fixture.store) as {
      implementer: string;
      prFixRounds: number | null;
      source: string;
    };

    assert.equal(info.source, 'review-aggregate', 'production stats wiring must read the Review aggregate');
    assert.equal(info.implementer, 'configured-implementer', 'implementer comes from the Review aggregate, not the backlog task');
    assert.equal(info.prFixRounds, 2, 'two request-changes rounds = known 2');
  } finally {
    await fixture.cleanup();
  }
});

// ---------------------------------------------------------------------------
// Case 2 — a failed approval-boundary transition must surface and must block
// Backlog promotion.
//
// RED on parent: `ReviewState.save()` discards the failed lifecycle transition
// ("non-fatal"), returns `committed`, and `submitReviewRound` then promotes the
// Backlog task to `approved` while the Mission is still `review`.
// ---------------------------------------------------------------------------

test('failed approval boundary transition surfaces and blocks Backlog promotion (task-2378)', async () => {
  const fixture = await createFixture('task-2378-boundary-');
  const slug = 'task-2378-boundary';

  const review = startReview(
    { change: pullRequest, revision: changeRevision('abc123') },
    reviewer,
    implementer,
    '2026-01-01T10:00:00Z',
    reviewerEligibility,
  );
  const mission = {
    id: missionId(slug),
    repositoryId: repo,
    title: 'Approval boundary failure',
    labels: [],
    assignee: implementer,
    status: 'review' as const,
    rawStatus: 'review',
    checkpoints: [],
    netEngineeringLines: null,
    closedAt: null,
    externalTaskRef: null,
    intakeTrace: null,
    review,
  };
  await fixture.store.save(mission, null);

  const failingLifecycle = {
    transition: async () => ({
      status: 'failed' as const,
      error: { kind: 'conflict' as const, message: 'simulated lifecycle write failure' },
      durableEvidence: [],
    }),
  };

  const backlogTransitions: string[] = [];
  const errors: string[] = [];
  const exitCodes: number[] = [];

  const persistence = bindReviewPersistence(fixture.store, failingLifecycle as never);

  try {
    await submitReviewRound(slug, 'approve', 'Looks good', {
      worktree: fixture.root,
      log: () => {},
      error: (message: string) => { errors.push(message); },
      exit: ((code: number) => { exitCodes.push(code); }) as never,
      isReviewProviderEnabledFn: () => false,
      readReviewStateFn: persistence.readReviewState as never,
      writeReviewStateFn: persistence.writeReviewState as never,
      transitionTaskFn: (async (_slug: string, status: string) => {
        backlogTransitions.push(status);
        return { ok: true };
      }) as never,
      missionStore: fixture.store,
    });
  } catch (error) {
    // A thrown failure is an acceptable way to surface the boundary failure;
    // record it as operator-visible rather than letting the test pass silently.
    errors.push(error instanceof Error ? error.message : String(error));
  }

  try {
    assert.ok(
      errors.length > 0 || exitCodes.some((code) => code !== 0),
      'a failed review → integration transition must be operator-visible, not swallowed',
    );
    assert.ok(
      !backlogTransitions.includes('approved'),
      `Backlog must not be promoted to approved while the Mission is still review (saw ${JSON.stringify(backlogTransitions)})`,
    );

    const reloaded = await fixture.store.load(missionId(slug));
    assert.equal(reloaded.kind, 'found');
    assert.equal(
      reloaded.kind === 'found' ? reloaded.mission.status : null,
      'review',
      'Mission stays in review so px integrate can recover it',
    );
  } finally {
    await fixture.cleanup();
  }
});

// ---------------------------------------------------------------------------
// R5 — human-override regression (SC07).
//
// A live Mission (not closed) whose Review is awaiting a decision, approved
// by a human through the existing `px review` decision path (provider=none,
// no new `px integrate` flag). The override must persist
// `ReviewerDecision(kind=approved)`, move the Mission `review → integration`
// with `occurredAt` exactly equal to `decidedAt`, and a subsequent `px
// integrate` recovery must proceed without re-running the approval.
//
// The seed sits in the `review` lane: the domain's `approve` rule requires it
// (`decideMission` — "Cannot approve while … is active"), so an awaiting
// Review on a live mission is the state a human override applies to.
// ---------------------------------------------------------------------------

test('R5: human px review approval persists ReviewerDecision and lands integration at decidedAt without a second approval (task-2378)', async () => {
  const fixture = await createFixture('task-2378-r5-');
  const slug = 'task-2378-r5';
  const decidedAt = '2026-01-01T10:30:00Z';

  const review = startReview(
    { change: pullRequest, revision: changeRevision('abc123') },
    reviewer,
    implementer,
    decidedAt,
    reviewerEligibility,
  );
  const mission = {
    id: missionId(slug),
    repositoryId: repo,
    title: 'R5 human override',
    labels: [],
    assignee: implementer,
    status: 'review' as const,
    rawStatus: 'review',
    checkpoints: [],
    netEngineeringLines: null,
    closedAt: null,
    externalTaskRef: null,
    intakeTrace: null,
    review,
  };
  await fixture.store.save(mission, null);

  const lifecycle = new MissionLifecycleService(fixture.store);
  const persistence = bindReviewPersistence(fixture.store, lifecycle);
  const backlogTransitions: string[] = [];
  const errors: string[] = [];
  const exitCodes: number[] = [];

  try {
    // The human override: the existing `px review --submit-review approve`
    // decision path, provider=none, persistence bound to store + lifecycle
    // exactly like the production wiring.
    await submitReviewRound(slug, 'approve', 'approved by the operator', {
      worktree: fixture.root,
      log: () => {},
      error: (message: string) => { errors.push(message); },
      exit: ((code: number) => { exitCodes.push(code); }) as never,
      isReviewProviderEnabledFn: () => false,
      readReviewStateFn: persistence.readReviewState as never,
      writeReviewStateFn: persistence.writeReviewState as never,
      transitionTaskFn: (async (_s: string, status: string) => {
        backlogTransitions.push(status);
        return { ok: true };
      }) as never,
      missionStore: fixture.store,
    });

    // The override succeeded quietly: no operator-visible failure, no exit.
    assert.equal(errors.length, 0, `human approval must not surface a failure (saw ${JSON.stringify(errors)})`);
    assert.deepEqual(exitCodes, [], 'human approval must not exit non-zero');

    // SC07: a persisted ReviewerDecision(kind=approved) with the human's
    // decision time.
    const loaded = await fixture.store.load(missionId(slug));
    assert.equal(loaded.kind, 'found');
    const round = loaded.kind === 'found' ? loaded.mission.review!.rounds[loaded.mission.review!.rounds.length - 1] : null;
    assert.equal(round?.decision?.kind, 'approved', 'persisted ReviewerDecision is approved');
    assert.equal(round?.decision?.decidedAt, decidedAt, 'decidedAt is the authoritative decision time');

    // SC07: the Mission reached integration and the lane event carries
    // occurredAt exactly equal to decidedAt (not wall clock).
    assert.equal(
      loaded.kind === 'found' ? loaded.mission.status : null,
      'integration',
      'human approval moves the Mission review → integration',
    );
    const events = await fixture.database.query<{ from_status: string; to_status: string; trigger: string; occurred_at: string }>(
      'SELECT from_status, to_status, trigger, occurred_at FROM board_lane_events WHERE mission_id = ?',
      [missionId(slug)],
    );
    const approveEvent = events.find((event) => event.from_status === 'review' && event.to_status === 'integration');
    assert.ok(approveEvent, 'review → integration lane event persisted at the approval boundary');
    assert.equal(approveEvent.trigger, 'approve');
    assert.equal(approveEvent.occurred_at, decidedAt, 'occurredAt equals ReviewerDecision.decidedAt');

    // The approval boundary succeeded, so the Backlog task is promoted.
    assert.ok(backlogTransitions.includes('approved'), `Backlog promoted after the successful transition (saw ${JSON.stringify(backlogTransitions)})`);

    // SC07: px integrate then proceeds through the existing recovery path
    // without re-running the approval — no second approval event.
    const recovery = await recoverMissionForIntegration({ slug }, { missionServices: { store: fixture.store, lifecycle } });
    assert.deepEqual(recovery, { recovered: false, status: 'integration' });
    const approveEvents = await fixture.database.query<{ trigger: string }>(
      "SELECT trigger FROM board_lane_events WHERE mission_id = ? AND trigger = 'approve'",
      [missionId(slug)],
    );
    assert.equal(approveEvents.length, 1, 'px integrate creates no second approval event');
  } finally {
    await fixture.cleanup();
  }
});
// The helpers this file exercises hang off the default export object rather
// than the module's named exports, so this must be the default import.

function summarizeAgentWindow(rows, window, options = {}) {
  const completedMissionKeys = new Set(rows.filter(row => row.completedForTest === 'yes')
    .map(row => `${String(row.repo || '')}::${String(row.mission).trim().toLowerCase()}`));
  return (stats as any)._internals.summarizeAgentWindow(rows, window, { ...options, completedMissionKeys });
}

// ---------------------------------------------------------------------------
// CP 1 (red): Reproduction tests for implementer attribution defects
// ---------------------------------------------------------------------------
// These tests must FAIL at parent commit c06b0ada6 and PASS after CP 2 + CP 3.
// No production file changes in CP 1 — test-only checkpoint.
// ---------------------------------------------------------------------------

test('task-2348: mission with two implementers credits reported implementer not earlier one', () => {
  // Scenario: mission had `claude` as earlier implementer (implementation-stage
  // rows with model), then `custom` took over. Closed rollup row carries
  // `implementer: 'custom'` (the reported implementer from
  // deriveImplementerAndFixRounds).
  //
  // Current bug: computeAgentMissionGroups picks the latest implementation-stage
  // telemetry row as the owner, which is `claude`'s row. The mission is grouped
  // under `claude-opus-5` instead of `custom`.
  //
  // Expected: the closed rollup row's `implementer` field is the authority for
  // completed missions. Display key (model) may still come from stage row, but
  // grouping must use the reported implementer.
  const window = { start: new Date('2026-06-10T00:00:00Z'), end: new Date('2026-06-16T00:00:00Z') };
  const rows = [
    // Earlier implementer: claude ran execution
    {
      date: '2026-06-11',
      repo: '',
      mission: 'task-2348-a',
      implementer: 'claude',
      stage: 'active',
      classification: 'ai_sdlc',
      pr_fix_rounds: '0',
      provider: 'anthropic',
      model: 'claude-opus-5',
      completedForTest: 'no',
    },
    // Review stage (reviewer_agent=vibe, implementer still claude on this row)
    {
      date: '2026-06-12',
      repo: '',
      mission: 'task-2348-a',
      implementer: 'claude',
      stage: 'review',
      classification: 'ai_sdlc',
      pr_fix_rounds: '0',
      provider: 'openai',
      model: 'gpt-5.6-terra',
      reviewer_agent: 'vibe',
      completedForTest: 'no',
    },
    // Closed rollup row: deriveImplementerAndFixRounds reported custom as the
    // implementer who completed the mission
    {
      date: '2026-06-13',
      repo: '',
      mission: 'task-2348-a',
      implementer: 'custom',
      stage: 'default',
      classification: 'ai_sdlc',
      pr_fix_rounds: '2',
      model: '',
      completedForTest: 'yes',
    },
  ];

  const result = summarizeAgentWindow(rows, window);
  // Mission should be grouped under 'custom' (the reported implementer),
  // not 'claude-opus-5' (the earlier implementer's model).
  const customGroup = result.find(g => g.implementer === 'custom');
  const claudeGroup = result.find(g => g.implementer === 'claude-opus-5');

  assert.ok(customGroup, 'mission should be grouped under "custom" (reported implementer)');
  assert.equal(customGroup.missions, 1, 'custom should have exactly 1 mission');
  assert.ok(
    !claudeGroup || claudeGroup.missions === 0,
    'mission should NOT be grouped under "claude-opus-5" (earlier implementer)',
  );
});

test('task-2348: review-aggregate pr_fix_rounds counts only reported implementer rounds', async () => {
  // Scenario: mission had 3 total `changes-requested` rounds across its lifecycle.
  // 1 round sent back to previous implementer `claude`, 2 rounds sent back to
  // reported implementer `custom`.
  //
  // Current bug: deriveImplementerAndFixRounds review-aggregate path counts ALL
  // changes-requested rounds (3), not filtering by the reported implementer.
  //
  // Expected: pr_fix_rounds should be 2 (only rounds belonging to `custom`).
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2348-'));
  fs.mkdirSync(path.join(root, 'backlog', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'docs', 'missions', '2026', 'task-2348-b'), { recursive: true });

  const sentBackTo = (implementer, at) => ({
    decision: {
      kind: 'changes-requested',
      decidedAt: at,
      comment: null,
      findings: [{ id: reviewFindingId('F1'), summary: 'sent back', location: null }],
    },
    disposition: 'REQUEST_CHANGES',
    phase: 'fixing',
    implementer: agentFamily(implementer),
  });

  // Round 1: sent back to claude (previous implementer)
  // Round 2: sent back to custom (reported/final implementer)
  // Round 3: sent back to custom (reported/final implementer)
  // Round 4: approved
  const restoreHome = await seedMissionDatabase(
    path.join(root, 'parallix-home'),
    'task-2348-b',
    root,
    sentBackTo('claude', '2026-06-16T01:00:00.000Z'),
    [
      sentBackTo('custom', '2026-06-16T02:00:00.000Z'),
      sentBackTo('custom', '2026-06-16T03:00:00.000Z'),
      {
        implementer: agentFamily('custom'),
        decision: {
          kind: 'approved',
          decidedAt: '2026-06-16T04:00:00.000Z',
          comment: null,
          source: { kind: 'local' },
        },
        phase: 'approved',
      },
    ],
  );

  try {
    const info = await stats._internals.deriveImplementerAndFixRounds(
      'task-2348-b',
      root,
      restoreHome.store,
    );
    assert.equal(info.source, 'review-aggregate');
    assert.equal(info.implementer, 'custom', 'reported implementer is custom (last round owner)');
    assert.equal(
      info.prFixRounds,
      2,
      'pr_fix_rounds counts only custom\'s changes-requested rounds (2), not all rounds (3)',
    );
  } finally {
    await restoreHome();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('task-2348: summarizeAgentWindow reads pr_fix_rounds from closed row not max across rows', () => {
  // Scenario: closed rollup row has pr_fix_rounds=2 (authoritative value from
  // deriveImplementerAndFixRounds). An earlier implementation-stage row has
  // pr_fix_rounds=0. A review-stage row has pr_fix_rounds=3 (includes previous
  // implementer's rounds before the fix).
  //
  // Current bug: summarizeAgentWindow takes the MAX across all rows, which
  // picks up the stale review-stage value (3) instead of the closed row's
  // authoritative value (2).
  //
  // Expected: pr_fix_rounds comes from the closed rollup row (2).
  const window = { start: new Date('2026-06-10T00:00:00Z'), end: new Date('2026-06-16T00:00:00Z') };
  const rows = [
    // Implementation stage: pr_fix_rounds=0 (recorded before review complete)
    {
      date: '2026-06-11',
      repo: '',
      mission: 'task-2348-c',
      implementer: 'custom',
      stage: 'active',
      classification: 'ai_sdlc',
      pr_fix_rounds: '0',
      provider: 'openai',
      model: 'gpt-5.6-terra',
      completedForTest: 'no',
    },
    // Review stage: pr_fix_rounds=3 (stale — includes previous implementer's rounds)
    {
      date: '2026-06-12',
      repo: '',
      mission: 'task-2348-c',
      implementer: 'custom',
      stage: 'review',
      classification: 'ai_sdlc',
      pr_fix_rounds: '3',
      provider: 'openai',
      model: 'gpt-5.6-terra',
      completedForTest: 'no',
    },
    // Closed rollup: pr_fix_rounds=2 (authoritative from deriveImplementerAndFixRounds)
    {
      date: '2026-06-13',
      repo: '',
      mission: 'task-2348-c',
      implementer: 'custom',
      stage: 'default',
      classification: 'ai_sdlc',
      pr_fix_rounds: '2',
      model: '',
      completedForTest: 'yes',
    },
  ];

  const result = summarizeAgentWindow(rows, window);
  assert.equal(result[0].implementer, 'custom');
  assert.equal(
    result[0].averageFixRounds,
    '2.00',
    'fix rounds from closed row (2), not max across rows (3)',
  );
});
