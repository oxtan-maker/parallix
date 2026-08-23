// @ts-nocheck -- TASK-2328: partial test doubles from ESM seam migration; resolve in follow-up

// Reproduction test for TASK-2397: an `active` Mission whose latest review round
// is already `approved` (approval landed on the provider before the local status
// advanced to `review`) must recover to `integration` under `px integrate`
// instead of aborting with "A submitted review must be awaiting a reviewer
// decision". The recovery must skip the submit-for-review handoff replay (the
// round is already decided) and drive the `approve` transition at the stored
// decidedAt, leaving the recorded decision, its decidedAt, and the reviewed
// change/PR untouched.
//
// This drives the real MissionLifecycleService + SqliteMissionStore, so the
// workflow guard (decideMission) is exercised end to end. Red before the fix:
// Branch A calls submitForReviewFn, whose handoff path returns the already
// approved round unchanged and the workflow guard rejects it with
// "A submitted review must be awaiting a reviewer decision". The submitForReviewFn
// spy below throws on call to stand in for that guard throw, so the recovery
// aborts before the fix and passes after it.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const { agentFamily } = await import('../src/domain/agents.js');
const { missionId } = await import('../src/domain/mission.js');
const { repositoryId } = await import('../src/domain/repository.js');
const {
  ConfiguredReviewerEligibility,
  changeRevision,
  startReview,
  applyReviewerCommand,
} = await import('../src/domain/review.js');
const { MissionLifecycleService } = await import('../src/application/mission-lifecycle-service.js');
const { SqliteDatabaseAdapter } = await import('../src/adapters/sqlite/database-adapter.js');
const { SqliteMigrationRunner, loadDefaultMigrations } = await import('../src/adapters/sqlite/migration-runner.js');
const { SqliteMissionStore } = await import('../src/adapters/sqlite/mission-store.js');
const { clearOperatorStateCache } = await import('../src/adapters/sqlite/adapter-factory.js');
const { recoverMissionForIntegration } = await import('../src/adapters/cli/commands/integrate.js');

test('task-2397: active + approved review recovers to integration without resubmitting', async () => {
  const decidedAt = '2026-01-01T10:30:00Z';
  const submittedAt = '2026-01-01T10:00:00Z';
  const implementer = agentFamily('configured-implementer');
  const reviewer = agentFamily('configured-reviewer');
  const reviewerEligibility = ConfiguredReviewerEligibility.fromReviewStep({ eligible: [reviewer], strategy: 'random' });
  const pullRequest = { kind: 'pull-request', provider: 'forgejo', id: '2397', url: null, sourceBranch: 'mission/task-2397', targetBranch: 'main' };

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2397-'));
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
  const lifecycle = new MissionLifecycleService(store);

  // Seed an active Mission whose single round is already approved on the
  // provider (the stranded state this mission removes).
  const baseReview = startReview(
    { change: pullRequest, revision: changeRevision('abc123') },
    reviewer,
    implementer,
    submittedAt,
    reviewerEligibility,
  );
  const approvedReview = applyReviewerCommand(baseReview, {
    type: 'approve',
    decidedAt,
    comment: null,
    source: { kind: 'provider', provider: 'forgejo' },
  });

  const slug = 'task-2397';
  const mission = {
    id: missionId(slug),
    repositoryId: repositoryId('parallix'),
    title: 'task-2397 active approved recovery',
    labels: [],
    assignee: implementer,
    status: 'active',
    rawStatus: 'active',
    checkpoints: [
      {
        missionId: missionId(slug),
        name: 'CP-1',
        rawFilename: 'CP-1.md',
        firstLine: 'CP-1',
        goalCheck: [{ criterion: 'c', evidence: 'e' }],
        nextActionText: 'integrate',
      },
    ],
    netEngineeringLines: null,
    closedAt: null,
    externalTaskRef: null,
    intakeTrace: null,
    review: approvedReview,
  };
  await store.save(mission, null);

  try {
    let submitForReviewCalled = false;
    const submitForReviewFn = async () => {
      submitForReviewCalled = true;
      // Stands in for the workflow guard rejection the real handoff path throws.
      throw new Error('A submitted review must be awaiting a reviewer decision');
    };

    const result = await recoverMissionForIntegration(
      {
        slug,
        approval: {
          ok: true,
          reviewState: 'APPROVED',
          defaultUserApproved: true,
          defaultUserApprovedAt: decidedAt,
        },
      },
      { missionServices: { store, lifecycle }, submitForReviewFn },
    );

    assert.equal(submitForReviewCalled, false, 'recovery skips the submit-for-review handoff replay for an already-approved round');
    assert.deepEqual(
      result,
      { recovered: true, status: 'integration', occurredAt: decidedAt },
      'recovery drives the active + approved review to integration at the stored decidedAt',
    );

    const reloaded = await store.load(missionId(slug));
    assert.equal(reloaded.kind, 'found');
    assert.equal(reloaded.mission.status, 'integration', 'mission reaches integration');
    const round = reloaded.mission.review.rounds[reloaded.mission.review.rounds.length - 1];
    assert.equal(round.decision.kind, 'approved', 'the recorded decision is preserved');
    assert.equal(round.decision.decidedAt, decidedAt, 'the recorded decidedAt is preserved');
    assert.equal(round.subject.change.sourceBranch, pullRequest.sourceBranch, 'the reviewed change/PR is preserved');
    assert.equal(round.subject.change.id, pullRequest.id, 'the reviewed PR id is preserved');

    const events = await database.query(
      'SELECT from_status, to_status, trigger, occurred_at FROM board_lane_events WHERE mission_id = ?',
      [missionId(slug)],
    );
    const reviewEnter = events.find((e) => e.from_status === 'active' && e.to_status === 'review');
    const integrateEvent = events.find((e) => e.from_status === 'review' && e.to_status === 'integration');
    assert.ok(reviewEnter, 'an active → review lane move exists');
    assert.equal(reviewEnter.occurred_at, submittedAt, 'active → review rides the authoritative review-entry time');
    assert.ok(integrateEvent, 'a review → integration lane move exists');
    assert.equal(integrateEvent.occurred_at, decidedAt, 'approve runs at the stored decidedAt');
  } finally {
    await database.close();
    if (previousHome === undefined) { delete process.env.PARALLIX_HOME; }
    else { process.env.PARALLIX_HOME = previousHome; }
    clearOperatorStateCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('task-2397: active + approved review preserves the round across recovery', async () => {
  const decidedAt = '2026-01-01T10:30:00Z';
  const submittedAt = '2026-01-01T10:00:00Z';
  const implementer = agentFamily('configured-implementer');
  const reviewer = agentFamily('configured-reviewer');
  const reviewerEligibility = ConfiguredReviewerEligibility.fromReviewStep({ eligible: [reviewer], strategy: 'random' });
  const pullRequest = { kind: 'pull-request', provider: 'forgejo', id: '2397-b', url: null, sourceBranch: 'mission/task-2397', targetBranch: 'main' };

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2397-b-'));
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

  const baseReview = startReview(
    { change: pullRequest, revision: changeRevision('abc123') },
    reviewer,
    implementer,
    submittedAt,
    reviewerEligibility,
  );
  const approvedReview = applyReviewerCommand(baseReview, {
    type: 'approve',
    decidedAt,
    comment: null,
    source: { kind: 'provider', provider: 'forgejo' },
  });

  const slug = 'task-2397-b';
  const mission = {
    id: missionId(slug),
    repositoryId: repositoryId('parallix'),
    title: 'task-2397-b round preservation',
    labels: [],
    assignee: implementer,
    status: 'active',
    rawStatus: 'active',
    checkpoints: [
      {
        missionId: missionId(slug),
        name: 'CP-1',
        rawFilename: 'CP-1.md',
        firstLine: 'CP-1',
        goalCheck: [{ criterion: 'c', evidence: 'e' }],
        nextActionText: 'integrate',
      },
    ],
    netEngineeringLines: null,
    closedAt: null,
    externalTaskRef: null,
    intakeTrace: null,
    review: approvedReview,
  };
  await store.save(mission, null);

  const roundBefore = approvedReview.rounds[approvedReview.rounds.length - 1];

  try {
    const submitForReviewFn = async () => {
      throw new Error('A submitted review must be awaiting a reviewer decision');
    };

    await recoverMissionForIntegration(
      {
        slug,
        approval: {
          ok: true,
          reviewState: 'APPROVED',
          defaultUserApproved: true,
          defaultUserApprovedAt: decidedAt,
        },
      },
      { missionServices: { store, lifecycle: new MissionLifecycleService(store) }, submitForReviewFn },
    );

    const reloaded = await store.load(missionId(slug));
    const roundAfter = reloaded.mission.review.rounds[reloaded.mission.review.rounds.length - 1];
    assert.equal(roundAfter.decision.kind, roundBefore.decision.kind, 'round keeps its approved decision');
    assert.equal(roundAfter.decision.decidedAt, roundBefore.decision.decidedAt, 'round keeps its original decidedAt');
    assert.equal(roundAfter.subject.change.sourceBranch, roundBefore.subject.change.sourceBranch, 'round keeps its reviewed source branch');
    assert.equal(roundAfter.subject.revision, roundBefore.subject.revision, 'round keeps its exact reviewed revision');
  } finally {
    await database.close();
    if (previousHome === undefined) { delete process.env.PARALLIX_HOME; }
    else { process.env.PARALLIX_HOME = previousHome; }
    clearOperatorStateCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
