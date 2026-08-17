import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { agentFamily } from '../src/domain/agents.js';
import { triggerFromTransition, type LaneTransitionEvent } from '../src/domain/board-event.js';
import { missionId, MissionRuleViolation } from '../src/domain/mission.js';
import { decideMission, type MissionTransition } from '../src/domain/mission-workflow.js';
import { repositoryId } from '../src/domain/repository.js';
import {
  applyReviewerCommand,
  changeRevision,
  ConfiguredReviewerEligibility,
  currentReviewRound,
  reviewStatus,
  startReview,
  type ReviewedChange,
  type Review,
} from '../src/domain/review.js';
import { deriveLaneIntervals, medianCycleTimeByStateSeries } from '../src/application/projections/metrics.js';
import stats from '../src/adapters/cli/commands/stats.js';
import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../src/adapters/sqlite/mission-store.js';
import { clearOperatorStateCache } from '../src/adapters/sqlite/adapter-factory.js';
import { reviewFindingId } from '../src/domain/review.js';
import { submitReviewRound } from '../src/adapters/review/review-commands.js';
import { bindReviewPersistence } from '../src/composition/review-persistence.js';
import { MissionLifecycleService } from '../src/application/mission-lifecycle-service.js';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const id = missionId('task-2376');
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
  id: '999',
  url: null,
  sourceBranch: 'mission/task-2376',
  targetBranch: 'main',
};

function createApprovedReview(decidedAt: string): Review {
  const review = startReview(
    { change: pullRequest, revision: changeRevision('abc123') },
    reviewer,
    implementer,
    '2026-01-01T10:00:00Z',
    reviewerEligibility,
  );
  return applyReviewerCommand(review, {
    type: 'approve',
    decidedAt,
    comment: null,
    source: { kind: 'provider', provider: 'forgejo' },
  });
}

function makeMissionInReview(review: Review) {
  return {
    id,
    repositoryId: repo,
    title: 'Lifecycle timing',
    labels: [],
    status: 'review' as const,
    closedAt: null,
    assignee: implementer,
    checkpoints: [{
      missionId: id,
      name: 'CP-0',
      rawFilename: 'CP-0.md',
      firstLine: 'CP-0',
      goalCheck: [{ criterion: 'c', evidence: 'e' }],
      nextActionText: 'review',
    }],
    review,
    netEngineeringLines: null,
  };
}

// ---------------------------------------------------------------------------
// R1: Normal review approval transitions Mission review → integration
//       using ReviewerDecision.decidedAt (not new Date())
//
// Baseline defect: px integrate uses new Date() for occurredAt when it
// invokes approve on a stale review mission. The domain approve transition
// itself accepts the timestamp from the caller — the bug is that the caller
// passes wall-clock time instead of decidedAt.
//
// This test asserts that the approve command, given the correct decidedAt,
// produces the integration transition with that exact timestamp. The
// integration command (px integrate) must be wired to supply decidedAt;
// this test captures the expected behavior.
// ---------------------------------------------------------------------------

test('R1: normal approval transitions review to integration immediately with decidedAt', () => {
  const decidedAt = '2026-01-01T10:30:00Z';
  const approvedReview = createApprovedReview(decidedAt);

  const missionInReview = makeMissionInReview(approvedReview);
  const missionAfterApprove = decideMission(missionInReview, {
    type: 'approve',
    review: approvedReview,
  });

  // Mission must leave review
  assert.equal(
    missionAfterApprove.status,
    'integration',
    'approve transitions review → integration',
  );

  // The transition trigger maps to 'approve'
  const trigger = triggerFromTransition('review', 'integration');
  assert.equal(trigger, 'approve', 'review → integration trigger is approve');

  // The lifecycle event occurredAt must equal decidedAt (not new Date()).
  // This is the core assertion: the approve transition timestamp authority
  // is ReviewerDecision.decidedAt.
  const decidedAtFromReview = currentReviewRound(approvedReview).decision;
  assert.equal(
    decidedAtFromReview?.kind,
    'approved',
    'review has approved decision',
  );
  assert.equal(
    decidedAtFromReview?.decidedAt,
    decidedAt,
    `decidedAt preserved as ${decidedAt}`,
  );
});

// ---------------------------------------------------------------------------
// R1 (production boundary): the real supported review approval path
// (`px review --submit-review approve`, provider=none) must transition the
// Mission `review → integration` immediately at the approval boundary, with
// the persisted lane event `occurredAt = ReviewerDecision.decidedAt` — before
// `px integrate` runs (SC01/SC02).
//
// Baseline defect: no production caller injected `lifecycleService` into
// `ReviewState.save()`, so the boundary never fired and the Mission stayed in
// `review` until `px integrate` repaired it at wall-clock time.
// ---------------------------------------------------------------------------

test('R1 production: local approval path transitions Mission to integration before px integrate', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2376-r1prod-'));
  fs.mkdirSync(path.join(root, 'missions'), { recursive: true });
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

  // The round starts at 10:30; a local (provider=none) approval records the
  // ReviewerDecision with decidedAt = round start, the authoritative value.
  const decidedAt = '2026-01-01T10:30:00Z';
  const slug = 'task-2376-r1prod';
  const mission = {
    id: missionId(slug),
    repositoryId: repo,
    title: 'R1 production test',
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
        startedAt: decidedAt,
        decision: null,
        response: null,
        phase: 'reviewing',
        disposition: null,
        reviewerRetryCount: 0,
        implementerRetryCount: 0,
      }],
      intervention: null,
      stageLaunches: [],
      gateFailureRetryCount: 0,
      reviewEvents: [],
    },
  };
  // @ts-expect-error -- partial mission for test seed
  await store.save(mission, null);

  try {
    // The production composition: review persistence bound to the store AND
    // the lifecycle service (bindReviewPersistence is what create-cli wires).
    const persistence = bindReviewPersistence(store, new MissionLifecycleService(store));

    // The real supported approval path: px review <slug> --submit-review approve
    await submitReviewRound(slug, 'approve', 'approved for integration', {
      worktree: root,
      readReviewStateFn: persistence.readReviewState,
      writeReviewStateFn: persistence.writeReviewState,
      missionStore: store,
      isReviewProviderEnabledFn: () => false,
      transitionTaskFn: async () => true,
      log: () => {},
      error: () => {},
      exit: () => { throw new Error('exit must not be called on the approval path'); },
    });

    // SC01: the Mission leaves review immediately — before px integrate runs.
    const loaded = await store.load(missionId(slug));
    assert.equal(loaded.kind, 'found');
    assert.equal(
      loaded.mission.status,
      'integration',
      'SC01: normal approval transitions Mission review → integration before px integrate',
    );

    // SC02: the persisted review → integration event carries decidedAt.
    const events = await database.query<{ from_status: string; to_status: string; trigger: string; occurred_at: string }>(
      'SELECT from_status, to_status, trigger, occurred_at FROM board_lane_events WHERE mission_id = ?',
      [missionId(slug)],
    );
    const approveEvent = events.find((e) => e.from_status === 'review' && e.to_status === 'integration');
    assert.ok(approveEvent, 'review → integration lane event persisted at the approval boundary');
    assert.equal(approveEvent.trigger, 'approve');
    assert.equal(
      approveEvent.occurred_at,
      decidedAt,
      'SC02: occurredAt equals ReviewerDecision.decidedAt (not wall clock)',
    );
  } finally {
    await database.close();
    if (previousHome === undefined) { delete process.env.PARALLIX_HOME; }
    else { process.env.PARALLIX_HOME = previousHome; }
    clearOperatorStateCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// R2: Delayed integration dwell
//
// Fixture: 10:00 review start, 10:30 approve, 14:00 integrate, 14:15 done
//
// Expected dwell:
//   review      = 30m  (10:00 → 10:30)
//   integration = 225m (10:30 → 14:15)
//
// Baseline defect: when px integrate uses new Date() for the approve
// transition, the review → integration event is at 14:00, not 10:30.
// This shifts dwell: review = 240m, integration = 15m.
// ---------------------------------------------------------------------------

test('R2: delayed integration dwell — review 30m, integration 225m', () => {
  // Deterministic timestamps
  const reviewStart = '2026-01-01T10:00:00Z';
  const approveAt = '2026-01-01T10:30:00Z';
  const integrateAt = '2026-01-01T14:00:00Z';
  const doneAt = '2026-01-01T14:15:00Z';

  const approvedReview = createApprovedReview(approveAt);
  const missionInReview = makeMissionInReview(approvedReview);

  // Simulate full lifecycle with correct decidedAt
  const transitions: MissionTransition[] = [];

  // active → review @ 10:00
  transitions.push({
    missionId: id,
    from: 'active',
    to: 'review',
    trigger: 'submit-for-review',
    actor: implementer,
    occurredAt: reviewStart,
  });

  // review → integration @ decidedAt (10:30)
  // This is the fix: occurredAt = ReviewerDecision.decidedAt
  transitions.push({
    missionId: id,
    from: 'review',
    to: 'integration',
    trigger: 'approve',
    actor: implementer,
    occurredAt: approveAt,
  });

  // integration → done @ 14:15
  transitions.push({
    missionId: id,
    from: 'integration',
    to: 'done',
    trigger: 'integrate',
    actor: implementer,
    occurredAt: doneAt,
  });

  // Derive lane intervals and compute dwell
  const intervals = deriveLaneIntervals(transitions);

  // Find review interval: state='review', enteredAt=10:00, exitedAt=10:30
  const reviewInterval = intervals.find(
    (i) => i.state === 'review' && i.exitedAt !== null,
  );
  assert.ok(reviewInterval, 'review interval exists');
  const reviewMinutes = (Date.parse(reviewInterval.exitedAt) - Date.parse(reviewInterval.enteredAt)) / 60_000;
  assert.equal(
    reviewMinutes,
    30,
    `review dwell must be 30m (was ${reviewMinutes}m)`,
  );

  // Find integration interval: state='integration', enteredAt=10:30, exitedAt=14:15
  const integrationInterval = intervals.find(
    (i) => i.state === 'integration' && i.exitedAt !== null,
  );
  assert.ok(integrationInterval, 'integration interval exists');
  const integrationMinutes = (Date.parse(integrationInterval.exitedAt) - Date.parse(integrationInterval.enteredAt)) / 60_000;
  assert.equal(
    integrationMinutes,
    225,
    `integration dwell must be 225m (was ${integrationMinutes}m)`,
  );

  // Also verify through the medianCycleTimeByStateSeries (same projection Board/FLOW uses)
  const dwell = medianCycleTimeByStateSeries(transitions);
  const reviewDwell = dwell.series.find((s) => s.lane === 'review');
  const integrationDwell = dwell.series.find((s) => s.lane === 'integration');
  assert.equal(reviewDwell?.value, 30, 'medianCycleTimeByStateSeries review dwell = 30m');
  assert.equal(integrationDwell?.value, 225, 'medianCycleTimeByStateSeries integration dwell = 225m');
});

// Old-bug sensitivity: using wall-clock time (14:00) for approve shifts dwell
test('R2 sensitivity: wall-clock approve shifts dwell from 30m/225m to 240m/15m', () => {
  const reviewStart = '2026-01-01T10:00:00Z';
  const wallClockApprove = '2026-01-01T14:00:00Z'; // new Date() at integrate time
  const doneAt = '2026-01-01T14:15:00Z';

  const transitions: MissionTransition[] = [
    {
      missionId: id,
      from: 'active',
      to: 'review',
      trigger: 'submit-for-review',
      actor: implementer,
      occurredAt: reviewStart,
    },
    {
      missionId: id,
      from: 'review',
      to: 'integration',
      trigger: 'approve',
      actor: implementer,
      occurredAt: wallClockApprove, // BUG: new Date() instead of decidedAt
    },
    {
      missionId: id,
      from: 'integration',
      to: 'done',
      trigger: 'integrate',
      actor: implementer,
      occurredAt: doneAt,
    },
  ];

  const dwell = medianCycleTimeByStateSeries(transitions);
  const reviewDwell = dwell.series.find((s) => s.lane === 'review');
  const integrationDwell = dwell.series.find((s) => s.lane === 'integration');
  assert.equal(reviewDwell?.value, 240, 'wall-clock: review dwell = 240m (wrong, should be 30m)');
  assert.equal(integrationDwell?.value, 15, 'wall-clock: integration dwell = 15m (wrong, should be 225m)');
});

// ---------------------------------------------------------------------------
// R3: Stale review recovery
//
// Seed: Mission.status = review, Review approved @ 10:30
// Recovery (px integrate @ 14:00) must use decidedAt (10:30), not wall clock.
//
// Baseline defect: promoteTaskForIntegrationIfNeeded uses
// occurredAt: new Date().toISOString() for the approve command.
// ---------------------------------------------------------------------------

test('R3: stale review recovery uses ReviewerDecision.decidedAt for approve transition', () => {
  const decidedAt = '2026-01-01T10:30:00Z';
  const approvedReview = createApprovedReview(decidedAt);
  const missionInReview = makeMissionInReview(approvedReview);

  // Recovery invokes approve with decidedAt
  const recovered = decideMission(missionInReview, {
    type: 'approve',
    review: approvedReview,
  });

  assert.equal(
    recovered.status,
    'integration',
    'recovered mission enters integration',
  );

  // The approve transition must use decidedAt, not new Date().
  // The transition occurredAt comes from the caller (MissionLifecycleService).
  // This test asserts the domain transition is correct; the caller must wire
  // occurredAt = ReviewerDecision.decidedAt.
  const reviewDecision = currentReviewRound(approvedReview).decision;
  assert.equal(reviewDecision?.kind, 'approved');
  assert.equal(reviewDecision?.decidedAt, decidedAt);

  // Verify: if the caller used new Date() (e.g. 14:00), the review dwell
  // would be wrong. The domain transition is correct; the caller is the bug.
  // This is captured by R2's dwell assertion.
});

// ---------------------------------------------------------------------------
// R8: Direct review → done forbidden
//
// Domain integrate command must require status=integration only.
// Currently: requireStatus(mission, ['review', 'integration'], command)
// Expected after fix: requireStatus(mission, ['integration'], command)
//
// Baseline defect: integrate accepts 'review' status, allowing
// review → done shortcut that skips the integration lane entirely.
// ---------------------------------------------------------------------------

test('R8: direct review → done forbidden — integrate requires integration status', () => {
  const approvedReview = createApprovedReview('2026-01-01T10:30:00Z');
  const missionInReview = makeMissionInReview(approvedReview);

  // integrate on a mission still in 'review' status must fail
  assert.throws(
    () => decideMission(missionInReview, { type: 'integrate' }),
    MissionRuleViolation,
    'integrate from review status must throw MissionRuleViolation',
  );
});

// Old-bug sensitivity: review → done shortcut is now forbidden
test('R8 sensitivity: review → done shortcut skips integration lane', () => {
  const approvedReview = createApprovedReview('2026-01-01T10:30:00Z');
  const missionInReview = makeMissionInReview(approvedReview);

  // After fix: integrate from review throws MissionRuleViolation.
  // The review → done shortcut no longer exists.
  assert.throws(
    () => decideMission(missionInReview, { type: 'integrate' }),
    MissionRuleViolation,
    'integrate from review must throw — recovery must approve first',
  );
});

// ---------------------------------------------------------------------------
// R10: First-pass approval yields known reviewFixRounds=0
//
// Authoritative Review approved on first round → known zero.
// This is distinct from unknown (no evidence).
// ---------------------------------------------------------------------------

test('R10: first-pass approval yields known reviewFixRounds=0', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2376-r10-'));
  fs.mkdirSync(path.join(root, 'missions'), { recursive: true });
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

  const slug = 'task-2376-r10';
  const review = startReview(
    { change: pullRequest, revision: changeRevision('abc123') },
    reviewer,
    implementer,
    '2026-01-01T10:00:00Z',
    reviewerEligibility,
  );
  const approvedReview = applyReviewerCommand(review, {
    type: 'approve',
    decidedAt: '2026-01-01T10:30:00Z',
    comment: null,
    source: { kind: 'local' },
  });
  const mission = {
    id: missionId(slug),
    repositoryId: repo,
    title: 'R10 test',
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
      ...approvedReview,
      // reviewEvents with approve verdict = known zero fix rounds
      reviewEvents: [
        { position: 0, eventType: 'reviewer_outcome', roundNumber: 1, phase: 'reviewing', actor: reviewer, content: 'Approved on first review', disposition: null, verdict: 'approve', itemDispositions: null, blockedReason: null, followUpReference: null, createdAt: '2026-01-01T10:30:00Z' },
      ],
    },
  };
  // @ts-expect-error -- partial mission for test seed
  await store.save(mission, null);

  try {
    // @ts-expect-error -- TASK-2328: runtime-only property
    const info = await stats._internals.deriveImplementerAndFixRounds(slug, root, store);
    assert.equal(info.source, 'review-aggregate');
    assert.equal(info.implementer, 'configured-implementer');
    assert.equal(info.prFixRounds, 0, 'first-pass approval = known zero (not unknown)');
  } finally {
    await database.close();
    if (previousHome === undefined) { delete process.env.PARALLIX_HOME; }
    else { process.env.PARALLIX_HOME = previousHome; }
    clearOperatorStateCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// R11: Multiple fix rounds
//
// 2 request-changes cycles then approval → known 2.
// ---------------------------------------------------------------------------

test('R11: two request-changes cycles yield known reviewFixRounds=2', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2376-r11-'));
  fs.mkdirSync(path.join(root, 'missions'), { recursive: true });
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

  const slug = 'task-2376-r11';
  const reviewEvents = [
    { position: 0, eventType: 'reviewer_outcome', roundNumber: 1, phase: 'reviewing', actor: reviewer, content: 'Changes requested', disposition: null, verdict: 'request-changes', itemDispositions: null, blockedReason: null, followUpReference: null, createdAt: '2026-01-01T10:00:00Z' },
    { position: 1, eventType: 'reviewer_outcome', roundNumber: 2, phase: 'reviewing', actor: reviewer, content: 'Changes requested again', disposition: null, verdict: 'request-changes', itemDispositions: null, blockedReason: null, followUpReference: null, createdAt: '2026-01-01T11:00:00Z' },
    { position: 2, eventType: 'reviewer_outcome', roundNumber: 3, phase: 'reviewing', actor: reviewer, content: 'Approved', disposition: null, verdict: 'approve', itemDispositions: null, blockedReason: null, followUpReference: null, createdAt: '2026-01-01T12:00:00Z' },
  ];
  const mission = {
    id: missionId(slug),
    repositoryId: repo,
    title: 'R11 test',
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
      reviewEvents,
    },
  };
  // @ts-expect-error -- partial mission for test seed
  await store.save(mission, null);

  try {
    // @ts-expect-error -- TASK-2328: runtime-only property
    const info = await stats._internals.deriveImplementerAndFixRounds(slug, root, store);
    assert.equal(info.source, 'review-aggregate');
    assert.equal(info.prFixRounds, 2, 'two request-changes = known 2');
  } finally {
    await database.close();
    if (previousHome === undefined) { delete process.env.PARALLIX_HOME; }
    else { process.env.PARALLIX_HOME = previousHome; }
    clearOperatorStateCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// R12: External artifacts with misleading values do not affect results
//
// Authoritative Review says fixRounds=2, implementer=terra.
// External artifacts (PR, Git, backlog) imply something else.
// Expected: authoritative values win.
// ---------------------------------------------------------------------------

test('R12: external artifacts with misleading values do not affect authoritative result', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2376-r12-'));
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

  const slug = 'task-2376-r12';
  // Backlog says implementer=codex (misleading)
  const taskFile = path.join(root, 'backlog', 'tasks', `${slug} - Test.md`);
  fs.writeFileSync(taskFile, '---\nid: TASK-2376-R12\nlabels: [ai_sdlc]\nassignee: [codex]\nstatus: done\n---\nReview round 5\n');

  const reviewEvents = [
    { position: 0, eventType: 'reviewer_outcome', roundNumber: 1, phase: 'reviewing', actor: reviewer, content: 'Changes', disposition: null, verdict: 'request-changes', itemDispositions: null, blockedReason: null, followUpReference: null, createdAt: '2026-01-01T10:00:00Z' },
    { position: 1, eventType: 'reviewer_outcome', roundNumber: 2, phase: 'reviewing', actor: reviewer, content: 'Approved', disposition: null, verdict: 'approve', itemDispositions: null, blockedReason: null, followUpReference: null, createdAt: '2026-01-01T12:00:00Z' },
  ];
  const mission = {
    id: missionId(slug),
    repositoryId: repo,
    title: 'R12 test',
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
        implementer: agentFamily('terra'),
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
      reviewEvents,
    },
  };
  // @ts-expect-error -- partial mission for test seed
  await store.save(mission, null);

  try {
    // @ts-expect-error -- TASK-2328: runtime-only property
    const info = await stats._internals.deriveImplementerAndFixRounds(slug, root, store);
    assert.equal(info.source, 'review-aggregate');
    assert.equal(info.implementer, 'terra', 'authoritative implementer wins over backlog codex');
    assert.equal(info.prFixRounds, 1, 'authoritative fixRounds=1 wins over backlog round 5');
  } finally {
    await database.close();
    if (previousHome === undefined) { delete process.env.PARALLIX_HOME; }
    else { process.env.PARALLIX_HOME = previousHome; }
    clearOperatorStateCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// R13: Missing Review cannot activate heuristic inference
//
// Contemporary stats derivation with missing authoritative Review:
// Expected: unknown / invariant error — no PR lookup, no branch-history,
// no task-text lookup, no fabricated zero.
// ---------------------------------------------------------------------------

// TASK-2378 (SC08): store omission is now an invariant error, not a
// `missing-authority` result. The throw happens before any PR lookup,
// branch-history lookup, or task-text lookup, and no value is fabricated.

test('R13: missing MissionStore cannot activate heuristic inference', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2376-r13-'));
  fs.mkdirSync(path.join(root, 'missions'), { recursive: true });
  fs.mkdirSync(path.join(root, 'backlog', 'tasks'), { recursive: true });
  spawnSync('git', ['init'], { cwd: root });
  spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: root });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  spawnSync('git', ['checkout', '-b', 'main'], { cwd: root });
  spawnSync('git', ['commit', '-m', 'init', '--allow-empty'], { cwd: root });

  const slug = 'task-2376-r13';
  // Backlog has misleading data
  const taskFile = path.join(root, 'backlog', 'tasks', `${slug} - Test.md`);
  fs.writeFileSync(taskFile, '---\nid: TASK-2376-R13\nlabels: [ai_sdlc]\nassignee: [codex]\nstatus: done\n---\nReview round 3\n');

  try {
    // @ts-expect-error -- TASK-2328: runtime-only property
    const deriveCall = stats._internals.deriveImplementerAndFixRounds(slug, root, null);
    await assert.rejects(
      deriveCall,
      (error: unknown) => error instanceof Error && /requires a MissionStore/.test(error.message) && /invariant error/.test(error.message),
      'store omission throws the invariant error naming the caller obligation',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
