// @ts-nocheck -- TASK-2420: reproduction for the assigned-reviewer recovery gap

// TASK-2420: integration recovery only recognized a provider APPROVED when the
// approving Forgejo login equaled the hard-coded default user ('human'). An
// active Mission whose Review is already approved by the assigned/configured
// reviewer (e.g. 'qwen') was stranded: recovery aborted with
// "stored approval without the required provider approval".
//
// These tests lock the bug red before the fix:
//  - getLatestReviewDecision must expose reviewerApproved/reviewerApprovedAt for
//    the assigned reviewer's login (reviewerUser option).
//  - recoverMissionForIntegration must route a reviewer-matched approval through
//    the same recovery path the default-user approval takes, at the reviewer
//    approval timestamp.
//
// The getLatestReviewDecision tests inject apiCall so they never touch Forgejo.
// The recovery tests drive the real MissionLifecycleService + SqliteMissionStore.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const forgejo = await import('../src/adapters/forgejo/forgejo.js');
const { getLatestReviewDecision } = forgejo;
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
const { recoverMissionForIntegration, buildIntegrationContext } = await import('../src/adapters/cli/commands/integrate.js');
const { IntegrationAbort } = await import('../src/adapters/cli/commands/integrate-post.js');

/**
 * Build an apiCall that returns a fixed review list for a branch PR.
 * @param {Array<{state: string, submitted_at: string, user: {login: string}}>} reviews
 */
function reviewsApi(reviews) {
  return function apiCall(method, apiPath) {
    if (apiPath.includes('/pulls?state=')) {
      return { ok: true, data: [{ number: 2420, head: { ref: 'mission/task-2420', label: 'magnus:mission/task-2420' } }], status: 0 };
    }
    if (apiPath === '/pulls/2420/reviews') {
      return { ok: true, data: reviews, status: 0 };
    }
    return { ok: false, data: null, status: 1 };
  };
}

test('task-2420: getLatestReviewDecision recognizes an APPROVED by the assigned reviewer', () => {
  const previousUser = process.env.FORGEJO_USER;
  process.env.FORGEJO_USER = 'human';
  try {
    const decision = getLatestReviewDecision('mission/task-2420', {
      token: 'test-token',
      reviewerUser: 'qwen',
      apiCall: reviewsApi([
        { state: 'APPROVED', submitted_at: '2026-05-01T10:00:00Z', user: { login: 'qwen' } },
      ]),
    });

    assert.equal(decision.ok, true);
    assert.equal(decision.reviewState, 'APPROVED');
    assert.equal(decision.defaultUserApproved, false, 'default-user flag stays false for a non-default reviewer');
    assert.equal(decision.reviewerApproved, true, 'assigned-reviewer approval is recognized');
    assert.equal(decision.reviewerApprovedAt, '2026-05-01T10:00:00Z', 'qualifying reviewer approval timestamp is carried');
  } finally {
    process.env.FORGEJO_USER = previousUser;
  }
});

test('task-2420: getLatestReviewDecision rejects an APPROVED by an unrelated reviewer', () => {
  const previousUser = process.env.FORGEJO_USER;
  process.env.FORGEJO_USER = 'human';
  try {
    const decision = getLatestReviewDecision('mission/task-2420', {
      token: 'test-token',
      reviewerUser: 'qwen',
      apiCall: reviewsApi([
        { state: 'APPROVED', submitted_at: '2026-05-01T10:00:00Z', user: { login: 'gemini' } },
      ]),
    });

    assert.equal(decision.reviewerApproved, false, 'an unrelated reviewer approval must not recover the Mission');
    assert.equal(decision.reviewerApprovedAt, undefined);
  } finally {
    process.env.FORGEJO_USER = previousUser;
  }
});

test('task-2420: a later REQUEST_CHANGES by the assigned reviewer supersedes the APPROVED', () => {
  const previousUser = process.env.FORGEJO_USER;
  process.env.FORGEJO_USER = 'human';
  try {
    const decision = getLatestReviewDecision('mission/task-2420', {
      token: 'test-token',
      reviewerUser: 'qwen',
      apiCall: reviewsApi([
        { state: 'APPROVED', submitted_at: '2026-05-01T10:00:00Z', user: { login: 'qwen' } },
        { state: 'REQUEST_CHANGES', submitted_at: '2026-05-01T11:00:00Z', user: { login: 'qwen' } },
      ]),
    });

    assert.equal(decision.reviewState, 'REQUEST_CHANGES');
    assert.equal(decision.reviewerApproved, false, 'a retracted approval must not be persisted as authoritative');
    assert.equal(decision.reviewerApprovedAt, undefined);
  } finally {
    process.env.FORGEJO_USER = previousUser;
  }
});

/**
 * Seed an active Mission whose single round is already approved on the
 * provider by the assigned reviewer, then recover it to integration.
 */
async function seedActiveApprovedByReviewer(slug: string, reviewerLogin: string, decidedAt: string, submittedAt: string) {
  const reviewer = agentFamily('configured-reviewer');
  const implementer = agentFamily('configured-implementer');
  const reviewerEligibility = ConfiguredReviewerEligibility.fromReviewStep({ eligible: [reviewer], strategy: 'random' });
  const pullRequest = { kind: 'pull-request', provider: 'forgejo', id: slug, url: null, sourceBranch: `mission/${slug}`, targetBranch: 'main' };

  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${slug}-`));
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

  const mission = {
    id: missionId(slug),
    repositoryId: repositoryId('parallix'),
    title: `${slug} approved by ${reviewerLogin}`,
    labels: [],
    assignee: implementer,
    status: 'active',
    rawStatus: 'active',
    checkpoints: [],
    netEngineeringLines: null,
    closedAt: null,
    externalTaskRef: null,
    intakeTrace: null,
    review: approvedReview,
  };
  await store.save(mission, null);

  return {
    store,
    lifecycle,
    database,
    home,
    previousHome,
    slug,
    cleanup: async () => {
      await database.close();
      if (previousHome === undefined) { delete process.env.PARALLIX_HOME; }
      else { process.env.PARALLIX_HOME = previousHome; }
      clearOperatorStateCache();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test('task-2420: active approved review by assigned reviewer recovers to integration', async () => {
  const decidedAt = '2026-05-01T10:30:00Z';
  const submittedAt = '2026-05-01T10:00:00Z';
  const ctx = await seedActiveApprovedByReviewer('task-2420', 'qwen', decidedAt, submittedAt);
  try {
    let submitForReviewCalled = false;
    const submitForReviewFn = async () => {
      submitForReviewCalled = true;
      throw new Error('A submitted review must be awaiting a reviewer decision');
    };

    const result = await recoverMissionForIntegration(
      {
        slug: ctx.slug,
        approval: {
          ok: true,
          reviewState: 'APPROVED',
          defaultUserApproved: false,
          reviewerApproved: true,
          reviewerApprovedAt: decidedAt,
        },
      },
      { missionServices: { store: ctx.store, lifecycle: ctx.lifecycle }, submitForReviewFn },
    );

    assert.equal(submitForReviewCalled, false, 'recovery skips the submit-for-review handoff replay for an already-approved round');
    assert.deepEqual(
      result,
      { recovered: true, status: 'integration', occurredAt: decidedAt },
      'recovery drives the active + approved review to integration at the reviewer approval timestamp',
    );

    const reloaded = await ctx.store.load(missionId(ctx.slug));
    assert.equal(reloaded.kind, 'found');
    assert.equal(reloaded.mission.status, 'integration', 'mission reaches integration');
    const round = reloaded.mission.review.rounds[reloaded.mission.review.rounds.length - 1];
    assert.equal(round.decision.kind, 'approved', 'the recorded reviewer decision is preserved');
    assert.equal(round.decision.decidedAt, decidedAt, 'the recorded decidedAt is preserved');
  } finally {
    await ctx.cleanup();
  }
});

test('task-2420: active approved review aborts when no current provider approval exists', async () => {
  const decidedAt = '2026-05-01T10:30:00Z';
  const submittedAt = '2026-05-01T10:00:00Z';
  const ctx = await seedActiveApprovedByReviewer('task-2420-nostore', 'qwen', decidedAt, submittedAt);
  try {
    let threw = false;
    try {
      await recoverMissionForIntegration(
        {
          slug: ctx.slug,
          approval: {
            ok: true,
            reviewState: null,
            defaultUserApproved: false,
            reviewerApproved: false,
          },
        },
        { missionServices: { store: ctx.store, lifecycle: ctx.lifecycle }, submitForReviewFn: async () => { throw new Error('should not call'); } },
      );
    } catch (error) {
      threw = true;
      assert.ok(error instanceof IntegrationAbort, 'aborts with an IntegrationAbort');
    }
    assert.ok(threw, 'recovery aborts a stored approval without a current provider approval');
    const reloaded = await ctx.store.load(missionId(ctx.slug));
    assert.equal(reloaded.mission.status, 'active', 'mission stays active after the abort');
  } finally {
    await ctx.cleanup();
  }
});

test('task-2420: active approved review aborts when the current approval is by an unrelated user', async () => {
  const decidedAt = '2026-05-01T10:30:00Z';
  const submittedAt = '2026-05-01T10:00:00Z';
  const ctx = await seedActiveApprovedByReviewer('task-2420-wrong', 'qwen', decidedAt, submittedAt);
  try {
    let threw = false;
    try {
      await recoverMissionForIntegration(
        {
          slug: ctx.slug,
          approval: {
            ok: true,
            reviewState: 'APPROVED',
            defaultUserApproved: false,
            // Provider shows gemini's approval, not the assigned reviewer qwen's.
            reviewerApproved: false,
          },
        },
        { missionServices: { store: ctx.store, lifecycle: ctx.lifecycle }, submitForReviewFn: async () => { throw new Error('should not call'); } },
      );
    } catch (error) {
      threw = true;
      assert.ok(error instanceof IntegrationAbort, 'aborts with an IntegrationAbort');
    }
    assert.ok(threw, 'recovery aborts a stored approval when the current provider approval is by an unrelated user');
  } finally {
    await ctx.cleanup();
  }
});

// TASK-2420 (review round 1, F1): buildIntegrationContext must derive the
// recovery-authority reviewer login from the Mission's recorded current review
// round, not from the task assignee (the implementer). An implementation by
// `codex` reviewed by `qwen` must query `qwen` as reviewerUser so qwen's
// legitimate APPROVED is recognized. readTokenFn returns no token so the
// listOpenPrsForSlug seam is skipped and the test never touches Forgejo.
test('task-2420: buildIntegrationContext derives reviewerUser from the recorded review round, not the implementer', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2420-buildctx-'));
  const taskFile = path.join(root, 'backlog', 'tasks', 'task-2420 - buildctx.md');
  try {
    fs.mkdirSync(path.dirname(taskFile), { recursive: true });
    // Implementer is `codex`; the recorded reviewer (below) is `qwen`.
    fs.writeFileSync(taskFile, [
      '---',
      'id: TASK-2420',
      'title: build ctx reviewer derivation',
      'status: active',
      'assignee: [codex]',
      '---',
      '',
      'Status: ○ active',
      '',
    ].join('\n'));
    spawnSync('git', ['init'], { cwd: root });
    spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: root });
    spawnSync('git', ['config', 'user.name', 'Test'], { cwd: root });
    spawnSync('git', ['add', '.'], { cwd: root });
    spawnSync('git', ['commit', '-m', 'fixture', '--allow-empty'], { cwd: root });

    let capturedReviewerUser: string | undefined;
    const context = await buildIntegrationContext('task-2420', {
      baseBranch: 'main',
      baseWorktree: root,
      isForgejoReviewEnabledFn: () => true,
      readTokenFn: () => null,
      getPrStatusFn: () => ({ exists: true, merged: false }),
      readReviewStateFn: async () => ({ reviewer: 'qwen', implementer: 'codex', round: 1, phase: 'approved' } as any),
      getLatestReviewDecisionFn: (_branch: string, options: any) => {
        capturedReviewerUser = options?.reviewerUser;
        return { ok: true, reviewState: 'APPROVED', defaultUserApproved: false, reviewerApproved: true, reviewerApprovedAt: '2026-05-01T10:30:00Z' };
      },
    });

    assert.equal(context.taskAssignee, 'codex', 'the task assignee (implementer) is codex');
    assert.equal(capturedReviewerUser, 'qwen', 'reviewerUser must be the recorded reviewer, not the implementer codex');
    assert.notEqual(capturedReviewerUser, 'codex', 'the implementer login must never be used as the recovery-authority reviewer');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// TASK-2420 (review round 2, F1): the production default `readReviewState`
// returns null unless its third `missionStore` argument is supplied. This test
// drives the DEFAULT reader (not a stub) with the real authoritative store and
// verifies buildIntegrationContext still derives reviewerUser from the recorded
// round. Without the store argument, reviewerUser would fall back to the
// default user and qwen's approval would be rejected.
test('task-2420: buildIntegrationContext passes the authoritative store to the default readReviewState reader', async () => {
  const { readReviewState } = await import('../src/adapters/review/review-state.js');
  // The round's reviewer AgentFamily resolves (via resolveForgejoUser) to the
  // Forgejo login 'qwen' that posts the provider APPROVED.
  const reviewer = agentFamily('qwen');
  const implementer = agentFamily('codex');
  const reviewerEligibility = ConfiguredReviewerEligibility.fromReviewStep({ eligible: [reviewer], strategy: 'random' });
  const pullRequest = { kind: 'pull-request', provider: 'forgejo', id: 'task-2420', url: null, sourceBranch: 'mission/task-2420', targetBranch: 'main' };

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2420-buildctx-store-'));
  fs.mkdirSync(path.join(root, 'missions'), { recursive: true });
  spawnSync('git', ['init'], { cwd: root });
  spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: root });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  spawnSync('git', ['checkout', '-b', 'main'], { cwd: root });
  spawnSync('git', ['commit', '-m', 'init', '--allow-empty'], { cwd: root });

  // A task file in the base worktree so buildIntegrationContext resolves an
  // implementer (codex) distinct from the recorded reviewer (qwen).
  const taskFile = path.join(root, 'backlog', 'tasks', 'task-2420 - build ctx store.md');
  fs.mkdirSync(path.dirname(taskFile), { recursive: true });
  fs.writeFileSync(taskFile, [
    '---',
    'id: TASK-2420',
    'title: build ctx store derivation',
    'status: active',
    'assignee: [codex]',
    '---',
    '',
    'Status: ○ active',
    '',
  ].join('\n'));

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
    '2026-05-01T10:00:00Z',
    reviewerEligibility,
  );
  const approvedReview = applyReviewerCommand(baseReview, {
    type: 'approve',
    decidedAt: '2026-05-01T10:30:00Z',
    comment: null,
    source: { kind: 'provider', provider: 'forgejo' },
  });
  const mission = {
    id: missionId('task-2420'),
    repositoryId: repositoryId('parallix'),
    title: 'task-2420 build ctx store',
    labels: [],
    assignee: implementer,
    status: 'active',
    rawStatus: 'active',
    checkpoints: [],
    netEngineeringLines: null,
    closedAt: null,
    externalTaskRef: null,
    intakeTrace: null,
    review: approvedReview,
  };
  await store.save(mission, null);

  try {
    let capturedReviewerUser: string | undefined;
    const context = await buildIntegrationContext('task-2420', {
      baseBranch: 'main',
      baseWorktree: root,
      isForgejoReviewEnabledFn: () => true,
      readTokenFn: () => null,
      getPrStatusFn: () => ({ exists: true, merged: false }),
      // DEFAULT reader: no stub. The store argument is what makes it resolve.
      readReviewStateFn: readReviewState,
      missionStore: store,
      getLatestReviewDecisionFn: (_branch: string, options: any) => {
        capturedReviewerUser = options?.reviewerUser;
        return { ok: true, reviewState: 'APPROVED', defaultUserApproved: false, reviewerApproved: true, reviewerApprovedAt: '2026-05-01T10:30:00Z' };
      },
    });

    assert.equal(context.taskAssignee, 'codex', 'the task assignee (implementer) is codex');
    assert.equal(capturedReviewerUser, 'qwen', 'reviewerUser must be derived from the store via the default reader');
    assert.notEqual(capturedReviewerUser, 'codex', 'the implementer login must never be used as the recovery-authority reviewer');
  } finally {
    await database.close();
    if (previousHome === undefined) { delete process.env.PARALLIX_HOME; }
    else { process.env.PARALLIX_HOME = previousHome; }
    clearOperatorStateCache();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// TASK-2420 (review round 2, F1): negative control. The production default
// `readReviewState` returns null when the third `missionStore` argument is
// omitted, so buildIntegrationContext without the store must NOT derive the
// reviewer from the round (reviewerUser stays null → falls back to the default
// user). This proves the store argument is what makes the lookup resolve.
test('task-2420: buildIntegrationContext without the authoritative store does not derive the reviewer from the round', async () => {
  const { readReviewState } = await import('../src/adapters/review/review-state.js');
  const ctx = await seedActiveApprovedByReviewer('task-2420-neg', 'qwen', '2026-05-01T10:30:00Z', '2026-05-01T10:00:00Z');
  try {
    let capturedReviewerUser: string | undefined;
    await buildIntegrationContext('task-2420-neg', {
      isForgejoReviewEnabledFn: () => true,
      readTokenFn: () => null,
      getPrStatusFn: () => ({ exists: true, merged: false }),
      // DEFAULT reader, but NO missionStore: the production default returns null.
      readReviewStateFn: readReviewState,
      getLatestReviewDecisionFn: (_branch: string, options: any) => {
        capturedReviewerUser = options?.reviewerUser;
        return { ok: true, reviewState: 'APPROVED', defaultUserApproved: false, reviewerApproved: true, reviewerApprovedAt: '2026-05-01T10:30:00Z' };
      },
    });
    assert.equal(capturedReviewerUser, null, 'without the store the default reader yields no reviewer');
  } finally {
    await ctx.cleanup();
  }
});
