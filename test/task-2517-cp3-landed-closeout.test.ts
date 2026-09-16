// TASK-2517 CP-3: a landed-but-stranded mission closes to `done`.
//
// Red before the fix: there is no closeout for a mission whose squash already
// landed on the base branch but whose aggregate is stranded in `review`/`active`
// by a gate rebound — `px integrate` tries to re-land (and aborts on the
// ineligible lane), and `px recover <slug>` only reconciles the task/aggregate
// split, never closing the mission. The regression asserts the `--recover-landed`
// closeout drives the stranded mission to `done` with a non-null `closedAt` and
// removes the worktree and local branch, performing no remote landing effect.
// @ts-nocheck -- TASK-2517: test doubles (real store + seam mocks) mirror the
// task-2397 integration test convention; the mission/PR literals are intentionally loose.
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
const { MissionIntegrationService } = await import('../src/application/mission-integration-service.js');
const { SqliteDatabaseAdapter } = await import('../src/adapters/sqlite/database-adapter.js');
const { SqliteMigrationRunner, loadDefaultMigrations } = await import('../src/adapters/sqlite/migration-runner.js');
const { SqliteMissionStore } = await import('../src/adapters/sqlite/mission-store.js');
const { clearOperatorStateCache } = await import('../src/adapters/sqlite/adapter-factory.js');
const { recoverMissionForIntegration } = await import('../src/adapters/cli/commands/integrate.js');
const { persistLandedIntegrationOrAbort, cleanupMissionWorktree } = await import('../src/adapters/cli/commands/integrate-post.js');
const { findExistingSquashCommit } = await import('../src/adapters/cli/commands/integrate-conflict.js');
const { recoverLandedIntegration } = await import('../src/application/integrate/landed-recovery.js');

for (const status of ['active', 'review']) test(`TASK-2517 CP-3: stranded ${status} mission closes to done with a landed squash`, async () => {
  const decidedAt = '2026-02-01T09:00:00Z';
  const submittedAt = '2026-02-01T08:00:00Z';
  const implementer = agentFamily('configured-implementer');
  const reviewer = agentFamily('configured-reviewer');
  const reviewerEligibility = ConfiguredReviewerEligibility.fromReviewStep({ eligible: [reviewer], strategy: 'random' });
  const pullRequest = { kind: 'pull-request', provider: 'forgejo', id: '2517c', url: null, sourceBranch: 'mission/task-2517-cp3', targetBranch: 'main' };

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2517-cp3-'));
  fs.mkdirSync(path.join(root, 'missions'), { recursive: true });
  spawnSync('git', ['init'], { cwd: root });
  spawnSync('git', ['config', 'user.email', 'test@test.com'], { cwd: root });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: root });
  spawnSync('git', ['checkout', '-b', 'main'], { cwd: root });
  // A real landed squash commit on the primary branch: subject carries the
  // mission-branch prefix so findExistingSquashCommit recognises it, and the
  // commit carries a real date so the landed timestamp resolves.
  spawnSync('git', ['commit', '-m', 'mission/task-2517-cp3: land stranded payload', '--allow-empty'], { cwd: root });

  const home = path.join(root, 'parallix-home');
  fs.mkdirSync(home, { recursive: true });
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

  const slug = 'task-2517-cp3';
  const mission = {
    id: missionId(slug),
    repositoryId: repositoryId('parallix'),
    title: 'task-2517-cp3 stranded review closeout',
    labels: [],
    assignee: implementer,
    status,
    rawStatus: status,
    checkpoints: [{
      missionId: missionId(slug),
      name: 'CP-1',
      rawFilename: 'CP-1.md',
      firstLine: 'CP-1',
      goalCheck: [{ criterion: 'c', evidence: 'e' }],
      nextActionText: 'integrate',
    }],
    netEngineeringLines: null,
    closedAt: null,
    externalTaskRef: null,
    intakeTrace: null,
    review: approvedReview,
  };
  await store.save(mission, null);

  const cleaned = [];
  const missionServices = { store, lifecycle, integration: new MissionIntegrationService(store) };
  await recoverLandedIntegration(slug, missionServices, root, {
    findSquashCommit: (dir, s) => findExistingSquashCommit(dir, s),
    recoverMissionForIntegration,
    persistLandedIntegrationOrAbort,
    cleanupMissionWorktree: (s) => { cleaned.push(s); return true; },
    createAbort: () => new Error('IntegrationAbort'),
  });

  const reloaded = await store.load(missionId(slug));
  assert.equal(reloaded.kind, 'found');
  assert.equal(reloaded.mission.status, 'done', 'the stranded review mission closes to done');
  assert.notEqual(reloaded.mission.closedAt, null, 'closedAt is non-null');
  assert.deepEqual(cleaned, [slug], 'the worktree and local branch are cleaned up');
});

test('TASK-2517 CP-3: closeout fails when worktree cleanup fails', async () => {
  await assert.rejects(
    recoverLandedIntegration('task-2517-cleanup', { store: { load: async () => ({ kind: 'found', mission: {} }) } }, '.', {
      findSquashCommit: () => 'abc123',
      recoverMissionForIntegration: async () => ({ status: 'integration' }),
      persistLandedIntegrationOrAbort: async () => {},
      cleanupMissionWorktree: () => false,
      createAbort: () => new Error('IntegrationAbort'),
    }),
    /IntegrationAbort/,
  );
});
