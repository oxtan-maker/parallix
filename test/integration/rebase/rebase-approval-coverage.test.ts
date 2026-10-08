// TASK-2555 reproduction: an approved mission whose branch is rebased onto a
// main that already landed part of its change. `px rebase` must record, at the
// moment the branch moves, that the approval no longer covers the branch; the
// approval stays in history naming the superseding revision, and no review row
// is deleted. Real Git and real SQLite, so this is an integration-ci test.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { evaluateTaskStatusForIntegration } from '../../../src/application/integrate/approval.js';
import { runRebaseWorkflow } from '../../../src/application/rebase-workflow.js';
import { MissionLifecycleService } from '../../../src/application/mission-lifecycle-service.js';
import { RevokeReviewDecisionUseCase } from '../../../src/application/revoke-review-decision-use-case.js';
import { createRebaseWorkflowPort } from '../../../src/adapters/rebase/rebase-workflow-adapter.js';
import { createGitChangeIdentity } from '../../../src/adapters/git/change-identity.js';
import { SqliteDatabaseAdapter } from '../../../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../../../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../../../src/adapters/sqlite/mission-store.js';
import { missionApprovalCoverage } from '../../../src/application/approval-coverage.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { missionId, missionLabels, type Mission } from '../../../src/domain/mission.js';
import { repositoryId } from '../../../src/domain/repository.js';
import { applyReviewerCommand, changeRevision, ConfiguredReviewerEligibility, reviewStatus, startReview } from '../../../src/domain/review.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2555-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const slug = 'task-2555';
const branch = `mission/${slug}`;

function git(root: string, ...args: string[]): string {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

function repository(name: string): { root: string; approved: string } {
  const root = path.join(tmp, name);
  fs.mkdirSync(root);
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'test@example.invalid');
  git(root, 'config', 'user.name', 'Test');
  git(root, 'config', 'commit.gpgsign', 'false');
  fs.writeFileSync(path.join(root, 'importer.txt'), 'importer v1\n');
  fs.writeFileSync(path.join(root, 'contract.txt'), 'contract v1\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'base');
  git(root, 'checkout', '-qb', branch);
  fs.writeFileSync(path.join(root, 'importer.txt'), 'importer v2\n');
  fs.writeFileSync(path.join(root, 'contract.txt'), 'contract v2\n');
  git(root, 'commit', '-qam', 'mission change');
  const approved = git(root, 'rev-parse', 'HEAD');
  // Lifecycle bookkeeping after approval never changes what was approved.
  fs.mkdirSync(path.join(root, 'backlog'));
  fs.writeFileSync(path.join(root, 'backlog', 'task.md'), 'status: ready-for-integration\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'backlog transition');
  return { root, approved };
}

async function approvedMission(root: string, approved: string) {
  const database = new SqliteDatabaseAdapter();
  await database.open({ path: path.join(root, '..', `${path.basename(root)}.db`) });
  await new SqliteMigrationRunner(database).applyPending(loadDefaultMigrations());
  const store = new SqliteMissionStore(database);
  const review = applyReviewerCommand(startReview(
    { change: { kind: 'local-branch', sourceBranch: branch, targetBranch: 'main' }, revision: changeRevision(approved) },
    agentFamily('custom'), agentFamily('codex'), '2026-09-22T00:00:00Z',
    ConfiguredReviewerEligibility.fromReviewStep({ eligible: [agentFamily('custom')], strategy: 'random' }),
  ), { type: 'approve', decidedAt: '2026-09-22T00:01:00Z', comment: null, source: { kind: 'local' } });
  const mission = {
    id: missionId(slug), repositoryId: repositoryId('repo'), title: 'Stale approval', labels: missionLabels([]),
    status: 'integration', closedAt: null, assignee: agentFamily('codex'), checkpoints: [], review, netEngineeringLines: null,
  } as Mission;
  await store.save(mission, null);
  return { database, store };
}

async function rebase(root: string, store: SqliteMissionStore): Promise<number> {
  let code = -1;
  const port = createRebaseWorkflowPort({
    inferSlugFn: () => slug,
    resolveWorktreeFn: () => root,
    findMissionDirFn: () => null,
    resolveMissionBaseBranchFn: () => 'main',
    resolveTaskFileFn: () => ({ ok: false }),
    isForgejoReviewEnabledFn: () => false,
    exitFn: (exitCode: number) => { code = exitCode; },
    missionServicesFn: async () => ({ store, lifecycle: new MissionLifecycleService(store) }),
  });
  await runRebaseWorkflow([slug], port);
  return code;
}

test('px rebase records that the approval no longer covers the branch, keeping it in history', async () => {
  const { root, approved } = repository('stale');
  // A dependency landed half of the mission's change on main first.
  git(root, 'checkout', '-q', 'main');
  fs.writeFileSync(path.join(root, 'contract.txt'), 'contract v2\n');
  git(root, 'commit', '-qam', 'dependency landed');
  git(root, 'checkout', '-q', branch);
  const { database, store } = await approvedMission(root, approved);
  try {
    assert.equal(await rebase(root, store), 0);
    const head = git(root, 'rev-parse', 'HEAD');
    const loaded = await store.load(missionId(slug));
    assert.equal(loaded.kind, 'found');
    const review = loaded.mission.review!;
    // Recorded, not stood down: same lane, same single approved round, no finding owed.
    assert.equal(loaded.mission.status, 'integration');
    assert.equal(review.rounds.length, 1);
    assert.equal(reviewStatus(review), 'approved');
    const decision = review.rounds[0].decision;
    assert.equal(decision?.kind, 'approved');
    assert.equal(review.rounds[0].subject.revision, approved);
    assert.equal(decision?.kind === 'approved' && decision.supersession?.supersedingRevision, head);
    assert.equal(decision?.kind === 'approved' && decision.supersession?.recordedBy, 'px rebase');
    const rows = await database.query<{ n: number }>('SELECT COUNT(*) AS n FROM mission_review_rounds WHERE mission_id = ?', [slug]);
    assert.equal(rows[0].n, 1);

    // The operator stands it down through the TASK-2543 path: a new round for the new revision.
    const revoked = await new RevokeReviewDecisionUseCase(store, new MissionLifecycleService(store)).execute({
      slug, round: 1, reason: 'The rebase replaced the approved revision', operator: 'operator', occurredAt: '2026-09-22T02:00:00Z', expectedVersion: loaded.version,
    });
    assert.equal(revoked.status, 'completed', revoked.error?.message);
    const reviewed = await store.load(missionId(slug));
    assert.equal(reviewed.kind === 'found' && reviewed.mission.status, 'review');
    const rounds = reviewed.kind === 'found' ? reviewed.mission.review!.rounds : [];
    assert.equal(rounds.length, 2);
    assert.equal(rounds[0].subject.revision, approved);
    assert.equal(rounds[0].decision?.kind === 'approved' && rounds[0].decision.supersession?.supersedingRevision, head);
    assert.equal(rounds[1].subject.revision, head);
    assert.equal(rounds[1].decision, null);
  } finally {
    await database.close();
  }
});

test('a clean rebase that replays the approved change leaves the approval untouched', async () => {
  const { root, approved } = repository('covers');
  git(root, 'checkout', '-q', 'main');
  fs.writeFileSync(path.join(root, 'unrelated.txt'), 'unrelated\n');
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'unrelated main work');
  git(root, 'checkout', '-q', branch);
  const { database, store } = await approvedMission(root, approved);
  try {
    const before = await store.load(missionId(slug));
    assert.equal(await rebase(root, store), 0);
    assert.notEqual(git(root, 'rev-parse', 'HEAD'), approved);
    const loaded = await store.load(missionId(slug));
    assert.deepEqual(loaded, before);
    assert.equal(missionApprovalCoverage(loaded.kind === 'found' ? loaded.mission.review : null, createGitChangeIdentity(root))?.kind, 'covers');
  } finally {
    await database.close();
  }
});

test('a refused stand-down leaves the mission, its review rows and its Backlog status unchanged', async () => {
  const { root, approved } = repository('refused');
  git(root, 'checkout', '-q', 'main');
  fs.writeFileSync(path.join(root, 'contract.txt'), 'contract v2\n');
  git(root, 'commit', '-qam', 'dependency landed');
  git(root, 'checkout', '-q', branch);
  const { database, store } = await approvedMission(root, approved);
  try {
    assert.equal(await rebase(root, store), 0);
    const before = await store.load(missionId(slug));
    const rowsBefore = await database.query('SELECT * FROM mission_review_rounds WHERE mission_id = ? ORDER BY position', [slug]);
    const backlogBefore = fs.readFileSync(path.join(root, 'backlog', 'task.md'), 'utf8');
    const refused = await new RevokeReviewDecisionUseCase(store, new MissionLifecycleService(store), null, createGitChangeIdentity(root)).execute({
      slug, round: 1, reason: 'stale version', operator: 'operator', occurredAt: '2026-09-22T02:00:00Z',
      expectedVersion: (before.kind === 'found' ? before.version : 0) + 5,
    });
    assert.equal(refused.status, 'failed');
    assert.deepEqual(await store.load(missionId(slug)), before);
    assert.deepEqual(await database.query('SELECT * FROM mission_review_rounds WHERE mission_id = ? ORDER BY position', [slug]), rowsBefore);
    assert.equal(fs.readFileSync(path.join(root, 'backlog', 'task.md'), 'utf8'), backlogBefore);
    assert.equal(git(root, 'status', '--porcelain'), '');
  } finally {
    await database.close();
  }
});

test('isolated active conflict repair verifies its tree while integration stays approval-gated (TASK-2673)', async () => {
  const { root, approved } = repository('active-repair');
  const { database, store } = await approvedMission(root, approved);
  try {
    const loaded = await store.load(missionId(slug));
    assert.equal(loaded.kind, 'found');
    await store.save({ ...loaded.mission, status: 'active', closedAt: null, review: null }, loaded.version);
    const taskFile = path.join(root, 'backlog', 'tasks', 'task-2555 - Repair.md');
    fs.mkdirSync(path.dirname(taskFile), { recursive: true });
    fs.writeFileSync(taskFile, '---\nid: TASK-2555\ntitle: Repair\nstatus: active\nassignee: [codex]\n---\n');
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      adapters: { verification: { command: 'node --check repaired.cjs' } },
    }));
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'active fixture');
    git(root, 'checkout', '-q', 'main');
    fs.mkdirSync(path.dirname(taskFile), { recursive: true });
    fs.writeFileSync(taskFile, '---\nid: TASK-2555\ntitle: Repair\nstatus: active\nassignee: [codex]\n---\n');
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      adapters: { verification: { command: 'node --check repaired.cjs' } },
    }));
    git(root, 'add', '.');
    fs.writeFileSync(path.join(root, 'contract.txt'), 'base advanced\n');
    git(root, 'commit', '-qam', 'conflicting main');
    git(root, 'checkout', '-q', branch);
    let code = -1;
    let verified = false;
    const port = createRebaseWorkflowPort({
      inferSlugFn: () => slug, resolveWorktreeFn: () => root,
      findMissionDirFn: () => root, findMissionAreaFn: () => 'workflow',
      resolveMissionBaseBranchFn: () => 'main',
      resolveTaskFileFn: () => ({ ok: true, taskFile }), getTaskImplementerFn: () => 'codex',
      resolveConflictsFn: () => ({ ok: true, conflictFiles: ['contract.txt'], missionSpecificFiles: [], sharedFiles: ['contract.txt'] }),
      isForgejoReviewEnabledFn: () => false,
      missionServicesFn: async () => ({ store, lifecycle: new MissionLifecycleService(store) }),
      startAgentFn: async (_step: string, options: { prompt: string }) => {
        const during = await store.load(missionId(slug));
        if (during.kind !== 'found') { assert.fail('active mission must be recorded'); }
        assert.equal(during.mission.status, 'active');
        assert.equal(during.mission.review, null);
        assert.doesNotMatch(options.prompt, /px integrate .*--dry-run/);
        assert.match(options.prompt, /node --check repaired.cjs/);
        fs.writeFileSync(path.join(root, 'contract.txt'), 'base advanced with repaired mission\n');
        fs.writeFileSync(path.join(root, 'repaired.cjs'), 'module.exports = 42;\n');
        git(root, 'add', '.');
        const continued = spawnSync('git', ['-C', root, '-c', 'core.editor=true', 'rebase', '--continue'], { encoding: 'utf8' });
        assert.equal(continued.status, 0, continued.stderr);
        const check = spawnSync('node', ['--check', 'repaired.cjs'], { cwd: root, encoding: 'utf8' });
        assert.equal(check.status, 0, check.stderr);
        verified = true;
        return { agent: 'codex', result: { status: check.status } };
      },
      exitFn: (exitCode: number) => { code = exitCode; },
    });
    port.readReviewState = () => ({ implementer: 'codex' });
    await runRebaseWorkflow([slug], port);
    assert.equal(code, 0);
    assert.equal(verified, true);
    assert.equal(port.detectRebaseState(root).inProgress, false);
    const after = await store.load(missionId(slug));
    if (after.kind !== 'found') { assert.fail('repaired mission must be recorded'); }
    assert.equal(after.mission.status, 'active');
    assert.equal(after.mission.review, null);
    const eligibility = evaluateTaskStatusForIntegration({
      missionStatus: after.mission.status, missionReview: after.mission.review,
      approval: { ok: true, reviewState: null }, baseWorktree: root,
    }, { toVirtual: (status: string) => status } as any);
    assert.equal(eligibility.ok, false, 'green repair must not grant integration eligibility');
    console.log('Isolated repair: Git complete; node --check green; Mission active with no review; integration refused.');
  } finally {
    await database.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(path.join(tmp, 'active-repair.db'), { force: true });
  }
});
