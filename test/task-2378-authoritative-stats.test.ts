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

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { agentFamily } from '../src/domain/agents.js';
import { missionId } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import {
  applyReviewerCommand,
  changeRevision,
  ConfiguredReviewerEligibility,
  startReview,
  type ReviewedChange,
} from '../src/domain/review.js';
import { createStatsWorkflowAdapter } from '../src/adapters/cli/commands/stats.js';
import { submitReviewRound } from '../src/adapters/review/review-commands.js';
import { bindReviewPersistence } from '../src/composition/review-persistence.js';
import { MissionLifecycleService } from '../src/application/mission-lifecycle-service.js';
import { recoverMissionForIntegration } from '../src/adapters/cli/commands/integrate.js';
import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../src/adapters/sqlite/mission-store.js';
import { clearOperatorStateCache } from '../src/adapters/sqlite/adapter-factory.js';

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
// Case 1 — the production stats adapter must reach the Review aggregate.
//
// RED on parent: `createStatsWorkflowAdapter()` takes no MissionStore and
// calls `deriveImplementerAndFixRounds(slug, rootDir)`, which returns
// `{ implementer: 'unknown', prFixRounds: null, source: 'missing-authority' }`.
// ---------------------------------------------------------------------------

test('live stats workflow adapter derives authoritative implementer and reviewFixRounds from the Review aggregate', async () => {
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
      gateFailureRetryCount: 0,
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
    const adapter = createStatsWorkflowAdapter(fixture.store);
    const info = await adapter.deriveImplementerAndFixRounds(slug, { rootDir: fixture.root }) as {
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

test('failed approval boundary transition surfaces and blocks Backlog promotion', async () => {
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

test('R5: human px review approval persists ReviewerDecision and lands integration at decidedAt without a second approval', async () => {
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
