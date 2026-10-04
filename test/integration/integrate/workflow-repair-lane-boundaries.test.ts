// TASK-2582 — red-to-green reproduction of the autonomous re-review approval
// that leaves the authoritative Mission active (the TASK-2579 shape).
//
// The TASK-2579 reproduction, driven at the real MissionLifecycleService and
// review-persistence boundaries:
//
//   1. activate                      — real MissionLifecycleService
//   2. submit-for-review (round 1)   — real MissionLifecycleService
//   3. recordRequestedChanges        — the review → active mirror boundary
//   4. recordImplementerResolution   — the round becomes ready-for-next-round
//   5. the loop opens round 2        — openReviewRound, the loop's handoff
//                                      boundary (src/adapters/review/review-round-open.ts)
//   6. recordApproval                — the approval boundary
//
// Green: the Mission ends in `integration` and a `review → integration` lane
// event exists. Red at the parent behavior: step 5 only transitions the
// Backlog mirror and persists review bookkeeping — the Mission stays
// `active`; step 6 then reports `recorded` without moving the lane, leaving
// an approved review attached to an active Mission and no lane event.
//
// The guard tests (approval replay without duplicate lane events, the
// unresolved-finding approve guard, a persisting boundary that stops the
// round) pin the behaviour the fix must not regress.

import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pinChildCli } from '../../../src/adapters/storage/child-cli.js';

import { agentFamily } from '../../../src/domain/agents.js';
import { missionId, missionLabels, type Mission } from '../../../src/domain/mission.js';
import { repositoryId } from '../../../src/domain/repository.js';
import {
  applyImplementerCommand,
  applyReviewerCommand,
  beginNextReviewRound,
  changeRevision,
  ConfiguredReviewerEligibility,
  currentReviewRound,
  reviewFindingId,
  startReview,
  type Review,
  type ReviewedChange,
} from '../../../src/domain/review.js';
import { MissionLifecycleService } from '../../../src/application/mission-lifecycle-service.js';
import type { MissionStore, MissionTransitionStore, MissionVersion } from '../../../src/application/domain-ports.js';
import { SqliteDatabaseAdapter } from '../../../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../../../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../../../src/adapters/sqlite/mission-store.js';
import {
  recordApproval,
  recordImplementerResolution,
  recordRequestedChanges,
} from '../../../src/adapters/review/review-round.js';
import { openReviewRound } from '../../../src/adapters/review/review-round-open.js';
import { ReviewState, writeReviewState } from '../../../src/adapters/review/review-state.js';
import { bindReviewPersistence } from '../../../src/composition/review-persistence.js';
import { reboundPreReviewFailure, gateFailureReason } from '../../../src/adapters/review/review-gate-handling.js';
import { transitionReviewRepair } from '../../../src/application/review-repair-lifecycle.js';
import { createIntegrationGateStep } from '../../../src/application/integrate/gates.js';
import { RevokeReviewDecisionUseCase } from '../../../src/application/revoke-review-decision-use-case.js';
import { createRebaseWorkflowPort } from '../../../src/adapters/rebase/rebase-workflow-adapter.js';
import { runRebaseWorkflow } from '../../../src/application/rebase-workflow.js';
import { SOURCE_PX } from '../../lib/px-entry.js';

const SLUG = 'task-2582-repro';
const REVIEWER = agentFamily('configured-reviewer');
const IMPLEMENTER = agentFamily('configured-implementer');
const REVIEWER_ELIGIBILITY = ConfiguredReviewerEligibility.fromReviewStep({
  eligible: [REVIEWER],
  strategy: 'random',
});
const PULL_REQUEST: ReviewedChange = {
  kind: 'pull-request',
  provider: 'forgejo',
  id: '582',
  url: null,
  sourceBranch: `mission/${SLUG}`,
  targetBranch: 'main',
};

const ACTIVATE_AT = '2026-09-20T09:00:00.000Z';
const HANDOFF_AT = '2026-09-20T10:00:00.000Z';
const CHANGES_REQUESTED_AT = '2026-09-20T11:00:00.000Z';
const RESOLVED_AT = '2026-09-20T12:00:00.000Z';
const ROUND_2_AT = '2026-09-20T13:00:00.000Z';
const APPROVED_AT = '2026-09-20T14:00:00.000Z';

test('review gate repair commits active before launch and review before resuming, without a reviewer decision', async () => {
  const review = startReview({ change: PULL_REQUEST, revision: changeRevision('rev-1') }, REVIEWER, IMPLEMENTER, HANDOFF_AT, REVIEWER_ELIGIBILITY);
  const fixture = await openFixture(seedMission('review', review));
  try {
    const mirrors: string[] = [];
    const result = await reboundPreReviewFailure(SLUG, fixture.root, gateFailureReason({
      ok: false, area: 'test', command: 'npm test', exitCode: 1, stdout: 'AssertionError: expected true', stderr: '',
    }), IMPLEMENTER, {
      missionStore: fixture.store, lifecycleService: fixture.lifecycle,
      reviewerEligibility: REVIEWER_ELIGIBILITY,
      ...bindReviewPersistence(fixture.store, fixture.lifecycle),
      readReviewStateFn: async () => null,
      startAgentFn: async () => {
        assert.equal(await missionStatus(fixture), 'active');
        assert.equal(currentReviewRound(await currentReviewOf(fixture)).decision, null);
        return { agent: IMPLEMENTER, result: { status: 0 } } as any;
      },
      transitionTaskFn: async (_slug, status) => { assert.equal(await missionStatus(fixture), status); mirrors.push(status); return true; },
      applyAgentFallbackFn: async () => IMPLEMENTER,
      verifyFn: async () => { assert.equal(await missionStatus(fixture), 'active'); return { ok: true, diagnostic: '' }; },
      log: () => undefined, error: () => undefined,
    });
    assert.equal(result.bounced, true);
    assert.equal(await missionStatus(fixture), 'review');
    assert.deepEqual(mirrors, ['active', 'review']);
    assert.deepEqual((await laneEvents(fixture)).map(event => ({ ...event })), [
      { from_status: 'review', to_status: 'active', trigger: 'rebound-to-active' },
      { from_status: 'active', to_status: 'review', trigger: 'submit-for-review' },
    ]);
    assert.equal(currentReviewRound(await currentReviewOf(fixture)).number, 1);
    assert.equal(currentReviewRound(await currentReviewOf(fixture)).decision, null);
  } finally { await closeFixture(fixture); }
});

test('a refused repair boundary stops before launch or mirror changes and preserves the review', async () => {
  const review = startReview({ change: PULL_REQUEST, revision: changeRevision('rev-1') }, REVIEWER, IMPLEMENTER, HANDOFF_AT, REVIEWER_ELIGIBILITY);
  const fixture = await openFixture(seedMission('review', review));
  try {
    await assert.rejects(reboundPreReviewFailure(SLUG, fixture.root, gateFailureReason({
      ok: false, area: 'test', command: 'npm test', exitCode: 1, stdout: 'AssertionError: expected true', stderr: '',
    }), IMPLEMENTER, {
      missionStore: fixture.store, lifecycleService: null,
      readReviewStateFn: async () => null,
      startAgentFn: async () => { assert.fail('a refused transition must not launch repair'); },
      transitionTaskFn: async () => { assert.fail('a refused transition must not change the mirror'); },
      verifyFn: () => { assert.fail('a refused transition must not begin downstream work'); },
      log: () => undefined, error: () => undefined,
    }), /no lifecycle service/);
    assert.equal(await missionStatus(fixture), 'review');
    assert.deepEqual(await laneEvents(fixture), []);
    assert.deepEqual(await currentReviewOf(fixture), review);
  } finally { await closeFixture(fixture); }
});

test('repair rebound refuses an approved review rather than fabricating a return to implementation', async () => {
  for (const status of ['review', 'active'] as const) {
    const fixture = await openFixture(seedMission(status, strandedApprovedReview()));
    try {
      await assert.rejects(transitionReviewRepair(SLUG, 'active', IMPLEMENTER, fixture.store, fixture.lifecycle), /undecided review round/);
      assert.equal(await missionStatus(fixture), status);
      assert.deepEqual(await laneEvents(fixture), []);
    } finally { await closeFixture(fixture); }
  }
});

test('integration gates stop in the integration lane on a successful re-review and abort on a refused one', async () => {
  for (const refuseReview of [false, true]) {
    const fixture = await openFixture(seedMission('active', null));
    try {
      const step = createIntegrationGateStep({
        gates: {
          resolveIntegrationVerificationWorktree: () => fixture.root,
          captureFinalIntegrationTree: () => ({ ok: true, rootDir: fixture.root, commit: 'rev-2', tree: 'tree' }),
          loadPhaseGates: () => [{ key: 'unit', command: 'npm test' }],
          loadRequirePreIntegration: () => true,
          runPhaseGates: async () => ({ ok: false, failedGate: 'unit', error: 'AssertionError' }),
        },
        verification: { formatVerificationCommand: () => 'npm test' },
        landing: { createAbort: () => new Error('integration aborted') },
      } as any);
      const run = step.runRequiredLocalGates({
        slug: SLUG, context: { baseWorktree: fixture.root, taskAssignee: IMPLEMENTER },
        missionLoad: await fixture.store.load(missionId(SLUG)),
        missionServices: { store: fixture.store, lifecycle: fixture.lifecycle },
        dryRun: false, noIntegrationGates: false, realAgent: null, realAgentModel: null,
        seams: {
          startAgentFn: async () => assert.fail('launch belongs to the injected repair boundary'),
          applyAgentFallbackFn: async () => IMPLEMENTER,
          transitionTaskFn: async () => true,
          routeIntegrationGateFailureFn: async () => ({
            route: 'revision-changed', rebounds: 1, approvedRevision: 'rev-1', repairedRevision: 'rev-2', invalidation: { ok: true, dismissed: [], errors: [] },
          }),
          // The injected live re-review route: approve (refuse) the repaired
          // revision. The gate step owns the lane decision from the result.
          reReviewFn: async () => !refuseReview,
        },
      });
      if (refuseReview) {
        // Re-review refused: the repair is not approved, so integration aborts
        // before any merge.
        await assert.rejects(run, /integration aborted/);
      } else {
        // Re-review approved: the repaired revision is re-reviewed through the
        // single live route and integration stops in the integration lane for
        // the human (no auto-restart, no merge).
        await assert.rejects(run, error => (error as Error).name === 'IntegrationStopsForHuman');
      }
    } finally { await closeFixture(fixture); }
  }
});

test('integration repair withdraws the old approval and returns through a new review without duplicate approval events', async () => {
  const fixture = await openFixture(seedMission('integration', strandedApprovedReview()));
  try {
    const rebound = await fixture.lifecycle.transition({
      operationId: 'integration-repair', missionId: missionId(SLUG), capabilities: new Set(['mission:transition']),
      command: { type: 'rebound-to-active', agent: IMPLEMENTER, cause: { kind: 'integration-gate-failure', gate: 'unit' }, occurredAt: APPROVED_AT }, actor: IMPLEMENTER, occurredAt: APPROVED_AT,
    });
    assert.equal(rebound.status, 'completed');
    const review = await currentReviewOf(fixture);
    const formerApproval = review.rounds.at(-2)?.decision;
    assert.equal(formerApproval?.kind, 'approved');
    assert.ok(formerApproval?.kind === 'approved' && formerApproval.revocation);
    assert.equal(currentReviewRound(review).decision, null);
    const rejected = await fixture.lifecycle.transition({
      operationId: 'integration-repair-return', missionId: missionId(SLUG), capabilities: new Set(['mission:transition']),
      command: { type: 'approve', review: strandedApprovedReview() }, actor: REVIEWER, occurredAt: APPROVED_AT,
    });
    assert.notEqual(rejected.status, 'completed');
    assert.equal(await missionStatus(fixture), 'active');
    await transitionReviewRepair(SLUG, 'review', IMPLEMENTER, fixture.store, fixture.lifecycle, REVIEWER_ELIGIBILITY);
    const approve = () => recordApproval(SLUG, { comment: null, decidedAt: APPROVED_AT, source: { kind: 'local' } }, {
      missionStore: fixture.store, lifecycleService: fixture.lifecycle,
    });
    assert.equal((await approve()).outcome, 'recorded');
    const events = await laneEvents(fixture);
    await approve();
    assert.equal(await missionStatus(fixture), 'integration');
    assert.deepEqual(await laneEvents(fixture), events);
    assert.deepEqual(events.map(event => [event.from_status, event.to_status, event.trigger]), [
      ['integration', 'active', 'rebound-to-active'], ['active', 'review', 'submit-for-review'], ['review', 'integration', 'approve'],
    ]);
  } finally { await closeFixture(fixture); }
});

test('composed rebase conflict repair commits active before its agent and review after verified completion', async () => {
  const slug = 'task-2582';
  const id = missionId(slug);
  const review = startReview({ change: { ...PULL_REQUEST, sourceBranch: `mission/${slug}` }, revision: changeRevision('rev-1') }, REVIEWER, IMPLEMENTER, HANDOFF_AT, REVIEWER_ELIGIBILITY);
  const seed = seedMission('review', review);
  const fixture = await openFixture({ ...seed, id, checkpoints: seed.checkpoints.map(checkpoint => ({ ...checkpoint, missionId: id })) });
  const readMission = async () => {
    const loaded = await fixture.store.load(id);
    assert.equal(loaded.kind, 'found');
    if (loaded.kind !== 'found') { assert.fail('recorded mission is required'); }
    return loaded.mission;
  };
  const taskFile = path.join(fixture.root, 'backlog', 'tasks', 'task-2582 - Conflict repair.md');
  try {
    fs.mkdirSync(path.dirname(taskFile), { recursive: true });
    fs.writeFileSync(taskFile, '---\nid: TASK-2582\ntitle: Conflict repair\nstatus: review\nassignee: [configured-implementer]\n---\n');
    // AC12: the rebase repair derives reviewer eligibility from this worktree's
    // configured review step, so register the custom reviewer as eligible here.
    fs.mkdirSync(path.join(fixture.root, 'config'), { recursive: true });
    fs.writeFileSync(path.join(fixture.root, 'config', 'agents.json'), JSON.stringify({
      steps: { review: { eligible: ['configured-reviewer'], selection: 'random' } },
    }));
    for (const args of [
      ['init', '-b', `mission/${slug}`], ['config', 'user.email', 'test@example.com'],
      ['config', 'user.name', 'test'], ['config', 'commit.gpgsign', 'false'], ['add', '.'], ['commit', '-m', 'fixture'],
    ]) { assert.equal(spawnSync('git', args, { cwd: fixture.root }).status, 0); }
    let exitCode: number | null = null;
    let launches = 0;
    const port = createRebaseWorkflowPort({
      missionServicesFn: async () => ({ store: fixture.store, lifecycle: fixture.lifecycle }),
      inferSlugFn: () => slug, resolveWorktreeFn: () => fixture.root,
      findMissionDirFn: () => fixture.root, findMissionAreaFn: () => 'docs',
      getCurrentBranchFn: () => `mission/${slug}`,
      resolveTaskFileFn: () => ({ ok: true, taskFile }), getTaskImplementerFn: () => IMPLEMENTER,
      detectRebaseStateFn: () => ({ inProgress: false, unmergedFiles: [] }),
      resolveMissionBaseBranchFn: () => 'main', isForgejoReviewEnabledFn: () => false,
      resolveConflictsFn: () => ({ ok: false, error: 'merge-failed' }),
      gitFn: (args: string[]) => {
        if (args.includes('rebase') && args.includes('main')) {
          return { status: 1, stdout: '', stderr: 'CONFLICT (content): Merge conflict in src/shared.ts' };
        }
        if (args.includes('status') && args.includes('--porcelain')) {
          return { status: 0, stdout: 'UU src/shared.ts\n', stderr: '' };
        }
        return { status: 0, stdout: '', stderr: '' };
      },
      startAgentFn: async () => {
        launches++;
        assert.equal((await readMission()).status, 'active');
        assert.match(fs.readFileSync(taskFile, 'utf8'), /status: active/);
        return { agent: IMPLEMENTER, result: { status: 0 } };
      },
      exitFn: code => { exitCode = code; },
    });
    port.readReviewState = async () => ({ implementer: IMPLEMENTER });
    await runRebaseWorkflow([slug], port);
    assert.equal(launches, 1);
    assert.equal(exitCode, 0);
    assert.equal((await readMission()).status, 'review');
    assert.match(fs.readFileSync(taskFile, 'utf8'), /status: review/);
    assert.deepEqual((await fixture.database.query<LaneEventRow>('SELECT from_status, to_status, trigger FROM board_lane_events WHERE mission_id = ? ORDER BY id', [slug])).map(event => [event.from_status, event.to_status, event.trigger]), [
      ['review', 'active', 'rebound-to-active'], ['active', 'review', 'submit-for-review'],
    ]);
    assert.deepEqual((await readMission()).review, review);
  } finally { await closeFixture(fixture); }
});

test('operator correction of a stranded active approval preserves history and opens review atomically', async () => {
  const original = strandedApprovedReview();
  const fixture = await openFixture(seedMission('active', original));
  try {
    const loaded = await fixture.store.load(missionId(SLUG));
    assert.equal(loaded.kind, 'found');
    if (loaded.kind !== 'found') { assert.fail('recorded mission is required'); }
    const useCase = new RevokeReviewDecisionUseCase(fixture.store, fixture.lifecycle);
    const request = {
      slug: SLUG, round: 2, reason: 'The operator rejected incomplete lifecycle verification',
      operator: 'human-operator', occurredAt: APPROVED_AT, expectedVersion: Number(loaded.version),
    };
    assert.equal((await useCase.execute({ ...request, expectedVersion: request.expectedVersion - 1 })).status, 'failed');
    assert.equal(await missionStatus(fixture), 'active');
    assert.deepEqual(await currentReviewOf(fixture), original);
    assert.deepEqual(await laneEvents(fixture), []);
    assert.equal((await useCase.execute(request)).status, 'completed');
    assert.equal(await missionStatus(fixture), 'review');
    const corrected = await currentReviewOf(fixture);
    const originalDecision = corrected.rounds.at(-2)?.decision;
    assert.ok(originalDecision?.kind === 'approved');
    assert.equal(originalDecision.revocation?.revokedBy, 'human-operator');
    assert.equal(originalDecision.revocation?.reason, request.reason);
    assert.equal(currentReviewRound(corrected).number, 3);
    assert.equal(currentReviewRound(corrected).decision, null);
    assert.deepEqual((await laneEvents(fixture)).map(event => ({ ...event })), [
      { from_status: 'active', to_status: 'review', trigger: 'revoke-approval' },
    ]);
    assert.equal((await useCase.execute(request)).status, 'failed', 'replay cannot revoke an undecided round');
    assert.equal((await laneEvents(fixture)).length, 1);
  } finally { await closeFixture(fixture); }
});

test('production CLI autonomous re-review and child verdict/resolve keep authoritative lanes correct', async () => {
  const slug = 'task-2582';
  const reviewer = agentFamily('codex');
  const implementer = agentFamily('custom');
  const eligibility = ConfiguredReviewerEligibility.fromReviewStep({ eligible: [reviewer], strategy: 'random' });
  const review = startReview({ change: { kind: 'local-branch', sourceBranch: `mission/${slug}`, targetBranch: 'main' }, revision: changeRevision('rev-1') }, reviewer, implementer, HANDOFF_AT, eligibility);
  const root = makeTempRoot();
  const repo = path.join(root, 'repo');
  const stateHome = path.join(root, 'state');
  fs.mkdirSync(path.join(repo, 'backlog', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'config'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'workflow.config.json'), JSON.stringify({ product: { name: 'parallix' }, adapters: {
    tasks: { provider: 'backlog-md', storage: 'backlog', stateMap: 'config/state-map.json' },
    missions: { baseDir: 'missions', branchPrefix: 'mission/' }, review: { provider: 'none' },
    verification: { command: ':' }, agents: { models: { custom: 'fixture' } },
  } }));
  fs.copyFileSync(path.resolve('config/agents.json'), path.join(repo, 'config', 'agents.json'));
  fs.writeFileSync(path.join(repo, 'config', 'state-map.json'), JSON.stringify({ ready: 'refined', approved: 'ready-for-integration' }));
  fs.writeFileSync(path.join(repo, 'backlog', 'tasks', `${slug}.md`), `---\nid: ${slug.toUpperCase()}\ntitle: Fixture\nstatus: review\nassignee: [custom]\nlabels: []\n---\n`);
  const git = (args: string[]) => {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  git(['init', '-b', 'main']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.com']);
  git(['add', '.']); git(['commit', '-m', 'fixture']); git(['checkout', '-b', `mission/${slug}`]);
  fs.mkdirSync(stateHome, { recursive: true });
  const database = new SqliteDatabaseAdapter();
  await database.open({ path: path.join(stateHome, 'parallix.db') });
  await new SqliteMigrationRunner(database).applyPending(loadDefaultMigrations());
  const store = new SqliteMissionStore(database);
  const seed = seedMission('review', review);
  await store.save({ ...seed, id: missionId(slug), checkpoints: seed.checkpoints.map(checkpoint => ({ ...checkpoint, missionId: missionId(slug) })), assignee: implementer }, null);
  // Stays on source: the preload swaps agent ports through setters on the
  // source `src/adapters/agents/agents.ts` module, which the bundle's inlined
  // copy never sees, and the trace asserts the pinned child CLI entry.
  const { entry, loader } = SOURCE_PX;
  const trace = path.join(root, 'trace.jsonl');
  try {
    const result = spawnSync(process.execPath, ['--import', loader, '--import', path.resolve('test/fixtures/review-repair-agent-preload.ts'), entry,
      'review', slug, '--continue', '--reviewer', 'codex', '--implementer', 'custom', '--max-attempts', '3'], {
      cwd: repo, encoding: 'utf8', timeout: 90_000,
      env: { ...process.env, PARALLIX_HOME: stateHome, PRIMARY_WORKTREE: repo, PARALLIX_NO_BUBBLEWRAP: '1', TASK_2582_SLUG: slug, TASK_2582_TRACE: trace, TASK_2582_REVIEWED: path.join(root, 'reviewed') },
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    const loaded = await store.load(missionId(slug));
    assert.equal(loaded.kind === 'found' && loaded.mission.status, 'integration', `${result.stdout}\n${result.stderr}`);
    const events = await database.query<LaneEventRow>('SELECT from_status, to_status, trigger FROM board_lane_events WHERE mission_id = ? ORDER BY id', [slug]);
    assert.deepEqual(events.map(e => [e.from_status, e.to_status]), [['review', 'active'], ['active', 'review'], ['review', 'integration']]);
    const observations = fs.readFileSync(trace, 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(observations.map(o => [o.phase, o.status]), [['review', 'review'], ['review-complete', 'active'], ['repair', 'active'], ['repair-complete', 'active'], ['review', 'review'], ['review-complete', 'integration']]);
    assert.ok(observations.filter(o => o.entry).every(o => o.entry === entry && o.cli.startsWith(path.join(stateHome, 'cli'))));
    console.log('[task-2582-cli-proof]', JSON.stringify({ entry, observations, events: events.map(event => ({ ...event })) }));
  } finally { await database.close(); }
});

const tempDirs: string[] = [];

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `parallix-task-2582-repro-`));
  tempDirs.push(root);
  return root;
}

test.after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

interface Fixture {
  readonly root: string;
  readonly database: SqliteDatabaseAdapter;
  readonly store: SqliteMissionStore;
  readonly lifecycle: MissionLifecycleService;
}

/** A refined mission with checkpoint evidence: activatable and submittable. */
function seedMission(status: 'refined' | 'active' | 'review' | 'integration', review: Review | null): Mission {
  return {
    id: missionId(SLUG),
    repositoryId: repositoryId('parallix'),
    title: `Mission ${SLUG}`,
    labels: missionLabels([]),
    status,
    rawStatus: status,
    checkpoints: [{
      missionId: missionId(SLUG),
      name: 'CP-1',
      rawFilename: 'CP-1.md',
      firstLine: 'CP-1',
      goalCheck: [{ criterion: 'criterion', evidence: 'evidence' }],
      nextActionText: 'hand off',
    }],
    brief: null,
    declaredGates: [],
    successCriteria: [],
    dependencies: [],
    predictedNelBucket: null,
    reproductionTest: null,
    assignee: IMPLEMENTER,
    externalTaskRef: null,
    intakeTrace: null,
    review,
    netEngineeringLines: null,
    closedAt: null,
  } as Mission;
}

async function openFixture(mission: Mission): Promise<Fixture> {
  const root = makeTempRoot();
  const database = new SqliteDatabaseAdapter();
  await database.open({ path: path.join(root, 'parallix.db') });
  await new SqliteMigrationRunner(database).applyPending(loadDefaultMigrations());
  const store = new SqliteMissionStore(database);
  await store.save(mission, null);
  return { root, database, store, lifecycle: new MissionLifecycleService(store) };
}

async function closeFixture(fixture: Fixture): Promise<void> {
  await fixture.database.close();
}

async function missionStatus(fixture: Fixture): Promise<string | null> {
  const loaded = await fixture.store.load(missionId(SLUG));
  return loaded.kind === 'found' ? loaded.mission.status : null;
}

interface LaneEventRow {
  from_status: string | null;
  to_status: string;
  trigger: string;
}

async function laneEvents(fixture: Fixture): Promise<readonly LaneEventRow[]> {
  return fixture.database.query<LaneEventRow>(
    'SELECT from_status, to_status, trigger FROM board_lane_events WHERE mission_id = ? ORDER BY id',
    [SLUG],
  );
}

async function currentReviewOf(fixture: Fixture): Promise<Review> {
  const loaded = await fixture.store.load(missionId(SLUG));
  assert.equal(loaded.kind, 'found', 'the mission is recorded');
  const review = loaded.kind === 'found' ? loaded.mission.review : null;
  assert.ok(review, 'the mission carries a review');
  return review!;
}

/** A review whose current round was approved while the Mission is elsewhere — the TASK-2579 shape. */
function strandedApprovedReview(): Review {
  const round1 = startReview(
    { change: PULL_REQUEST, revision: changeRevision('rev-1') },
    REVIEWER,
    IMPLEMENTER,
    HANDOFF_AT,
    REVIEWER_ELIGIBILITY,
  );
  const withChanges = applyReviewerCommand(round1, {
    type: 'request-changes',
    decidedAt: CHANGES_REQUESTED_AT,
    comment: null,
    findings: [{ id: reviewFindingId('F1'), summary: 'Finding one', location: null }],
  });
  // The implementer resolution, the round-2 advance the loop opens, and the
  // round-2 approval that TASK-2579 recorded over an active Mission.
  const responded = applyImplementerCommand(withChanges, {
    type: 'submit-resolution',
    respondedAt: RESOLVED_AT,
    resolutions: [{ findingId: reviewFindingId('F1'), kind: 'fixed', evidence: 'fixed' }],
    resultingRevision: changeRevision('rev-2'),
  });
  const round2 = beginNextReviewRound(responded, REVIEWER, IMPLEMENTER, ROUND_2_AT, REVIEWER_ELIGIBILITY);
  return applyReviewerCommand(round2, {
    type: 'approve',
    decidedAt: APPROVED_AT,
    comment: null,
    source: { kind: 'local' },
  });
}

test('request-changes -> fixes -> re-review -> approve moves the Mission active -> review -> integration', async () => {
  const fixture = await openFixture(seedMission('refined', null));
  try {
    // 1. activate — the real lifecycle service.
    const activated = await fixture.lifecycle.activate({
      operationId: `activate-${SLUG}`,
      missionId: missionId(SLUG),
      capabilities: new Set(['mission:transition']),
      agent: IMPLEMENTER,
      occurredAt: ACTIVATE_AT,
    });
    assert.equal(activated.status, 'completed', `activate completes: ${activated.error?.message ?? ''}`);

    // 2. submit-for-review (round 1) — the handoff boundary.
    const round1 = startReview(
      { change: PULL_REQUEST, revision: changeRevision('rev-1') },
      REVIEWER,
      IMPLEMENTER,
      HANDOFF_AT,
      REVIEWER_ELIGIBILITY,
    );
    const submitted = await fixture.lifecycle.transition({
      operationId: `handoff-${SLUG}`,
      missionId: missionId(SLUG),
      capabilities: new Set(['mission:transition']),
      command: { type: 'submit-for-review', gatesPassed: true, review: round1, reviewerEligibility: REVIEWER_ELIGIBILITY },
      actor: REVIEWER,
      occurredAt: HANDOFF_AT,
      idempotencyKey: `handoff-${SLUG}`,
    });
    assert.equal(submitted.status, 'completed', `submit-for-review completes: ${submitted.error?.message ?? ''}`);
    assert.equal(await missionStatus(fixture), 'review', 'the Mission is in review after handoff');

    // 3. the reviewer requests changes — the review → active mirror boundary.
    const changes = await recordRequestedChanges(SLUG, {
      findings: [{ id: reviewFindingId('F1'), summary: 'Finding one', location: null }],
      comment: null,
      decidedAt: CHANGES_REQUESTED_AT,
    }, { missionStore: fixture.store, lifecycleService: fixture.lifecycle });
    assert.equal(changes.outcome, 'recorded', `request-changes records: ${changes.outcome === 'failed' ? changes.diagnostic : ''}`);
    assert.equal(await missionStatus(fixture), 'active', 'the request-changes boundary returns the Mission to active');

    // 4. the implementer resolves the finding — the round is ready for round 2.
    const resolved = await recordImplementerResolution(SLUG, {
      itemDispositions: [],
      evidence: 'Finding one fixed',
      resultingRevision: 'rev-2',
      respondedAt: RESOLVED_AT,
    }, { missionStore: fixture.store, lifecycleService: fixture.lifecycle });
    assert.equal(resolved.outcome, 'recorded', `implementer resolution records: ${resolved.outcome === 'failed' ? resolved.diagnostic : ''}`);

    // 5. the loop opens round 2 at its handoff boundary — the same call the
    //    autonomous loop makes, with the real store and lifecycle service.
    const round2Open = await openReviewRound(SLUG, new ReviewState(SLUG, {
      reviewer: REVIEWER,
      implementer: IMPLEMENTER,
      round: 2,
      startedAt: ROUND_2_AT,
    }, fixture.store), {
      worktree: fixture.root,
      log: () => undefined,
      error: () => undefined,
      missionStore: fixture.store,
      lifecycleService: fixture.lifecycle,
    });
    if (round2Open.ok === false) {
      assert.fail(`the round-open boundary did not commit: ${round2Open.diagnostic}`);
    }

    // 6. the reviewer approves round 2 — the approval boundary.
    const approved = await recordApproval(SLUG, {
      comment: null,
      decidedAt: APPROVED_AT,
      source: { kind: 'local' },
    }, { missionStore: fixture.store, lifecycleService: fixture.lifecycle });
    assert.equal(approved.outcome, 'recorded', `approval records: ${approved.outcome === 'failed' ? approved.diagnostic : ''}`);

    // The authoritative Mission followed the whole conversation:
    // active -> review -> active -> review -> integration.
    assert.equal(
      await missionStatus(fixture),
      'integration',
      'the approved re-review lands the Mission in integration, not active',
    );
    const events = await laneEvents(fixture);
    const approveEvent = events.find((event) => event.from_status === 'review' && event.to_status === 'integration');
    assert.ok(approveEvent, `a review → integration lane event exists: ${JSON.stringify(events)}`);
    assert.equal(approveEvent!.trigger, 'approve', 'the integration lane event is the approval boundary');
  } finally {
    await closeFixture(fixture);
  }
});

test('approval cannot report success while the Mission is active (the TASK-2579 shape)', async () => {
  const fixture = await openFixture(seedMission('active', strandedApprovedReview()));
  try {
    const eventsBefore = await laneEvents(fixture);
    const result = await recordApproval(SLUG, {
      comment: null,
      decidedAt: APPROVED_AT,
      source: { kind: 'local' },
    }, { missionStore: fixture.store, lifecycleService: fixture.lifecycle });
    assert.equal(result.outcome, 'failed', 'the approval fails loudly from an active Mission');
    if (result.outcome === 'failed') {
      assert.match(result.diagnostic, /active/i, 'the diagnostic names the active Mission state');
    }
    assert.equal(await missionStatus(fixture), 'active', 'no partial transition: the Mission stays active');
    const eventsAfter = await laneEvents(fixture);
    assert.equal(eventsAfter.length, eventsBefore.length, 'no lane event is recorded for the rejected approval');
  } finally {
    await closeFixture(fixture);
  }
});

test('the flat review-persistence boundary reports boundary-failed from an active Mission', async () => {
  const fixture = await openFixture(seedMission('active', strandedApprovedReview()));
  try {
    const bound = bindReviewPersistence(fixture.store, fixture.lifecycle);
    const state = new ReviewState(SLUG, {
      reviewer: REVIEWER,
      implementer: IMPLEMENTER,
      round: 2,
      startedAt: ROUND_2_AT,
      phase: 'approved',
      disposition: 'APPROVED',
    }, fixture.store);
    const result = await bound.writeReviewState(SLUG, state, fixture.root);
    assert.equal(
      result.outcome,
      'boundary-failed',
      'persisting the approved phase over an active Mission reports the failed boundary instead of committed',
    );
  } finally {
    await closeFixture(fixture);
  }
});

test('a round-open boundary whose authoritative transition cannot commit stops the round', async () => {
  const readyForNextRound = (() => {
    const round1 = startReview(
      { change: PULL_REQUEST, revision: changeRevision('rev-1') },
      REVIEWER,
      IMPLEMENTER,
      HANDOFF_AT,
      REVIEWER_ELIGIBILITY,
    );
    const withChanges = applyReviewerCommand(round1, {
      type: 'request-changes',
      decidedAt: CHANGES_REQUESTED_AT,
      comment: null,
      findings: [{ id: reviewFindingId('F1'), summary: 'Finding one', location: null }],
    });
    return applyImplementerCommand(withChanges, {
      type: 'submit-resolution',
      respondedAt: RESOLVED_AT,
      resolutions: [{ findingId: reviewFindingId('F1'), kind: 'fixed', evidence: 'fixed' }],
      resultingRevision: changeRevision('rev-2'),
    });
  })();
  const fixture = await openFixture(seedMission('active', readyForNextRound));
  try {
    // The store accepts the round advance but refuses the lane transition:
    // the boundary must fail rather than open the round over an uncommitted
    // transition.
    const base = fixture.store;
    const refusingStore = {
      load: (id: Parameters<typeof base.load>[0]) => base.load(id),
      save: (mission: Parameters<typeof base.save>[0], version: Parameters<typeof base.save>[1]) => base.save(mission, version),
      saveWithTransition: async (..._args: unknown[]): Promise<MissionVersion> => {
        throw new Error('lane event storage unavailable');
      },
    } as unknown as MissionTransitionStore;
    const state = new ReviewState(SLUG, {
      reviewer: REVIEWER,
      implementer: IMPLEMENTER,
      round: 2,
      startedAt: ROUND_2_AT,
    }, refusingStore);
    const result = await openReviewRound(SLUG, state, {
      worktree: fixture.root,
      log: () => undefined,
      error: () => undefined,
      missionStore: refusingStore,
      lifecycleService: new MissionLifecycleService(refusingStore),
    });
    assert.equal(result.ok, false, 'the boundary reports the failed authoritative transition');
    if (!result.ok) {
      assert.match(result.diagnostic, /active → review transition failed/i, 'the diagnostic names the failed boundary');
    }
    // F8: a refused transition must not leave the advanced round persisted
    // over a still-active Mission — the round advance and the lane event
    // commit as one unit, so nothing landed before the failure.
    const readback = await refusingStore.load(missionId(SLUG));
    assert.equal(readback.kind, 'found');
    if (readback.kind === 'found') {
      assert.equal(readback.mission.status, 'active', 'the lane stays active when the transition cannot commit');
      assert.equal(readback.mission.review ? currentReviewRound(readback.mission.review).number : null, 1,
        'the round advance is not persisted without the lane event');
    }
  } finally {
    await closeFixture(fixture);
  }
});

test('approval replay emits no duplicate lane event', async () => {
  const fixture = await openFixture(seedMission('refined', null));
  try {
    const activated = await fixture.lifecycle.activate({
      operationId: `activate-${SLUG}`,
      missionId: missionId(SLUG),
      capabilities: new Set(['mission:transition']),
      agent: IMPLEMENTER,
      occurredAt: ACTIVATE_AT,
    });
    assert.equal(activated.status, 'completed');
    const round1 = startReview(
      { change: PULL_REQUEST, revision: changeRevision('rev-1') },
      REVIEWER,
      IMPLEMENTER,
      HANDOFF_AT,
      REVIEWER_ELIGIBILITY,
    );
    const submitted = await fixture.lifecycle.transition({
      operationId: `handoff-${SLUG}`,
      missionId: missionId(SLUG),
      capabilities: new Set(['mission:transition']),
      command: { type: 'submit-for-review', gatesPassed: true, review: round1, reviewerEligibility: REVIEWER_ELIGIBILITY },
      actor: REVIEWER,
      occurredAt: HANDOFF_AT,
      idempotencyKey: `handoff-${SLUG}`,
    });
    assert.equal(submitted.status, 'completed');

    const first = await recordApproval(SLUG, {
      comment: null,
      decidedAt: APPROVED_AT,
      source: { kind: 'local' },
    }, { missionStore: fixture.store, lifecycleService: fixture.lifecycle });
    assert.equal(first.outcome, 'recorded', `first approval records: ${first.outcome === 'failed' ? first.diagnostic : ''}`);
    assert.equal(await missionStatus(fixture), 'integration', 'the first approval integrates the Mission');

    const replay = await recordApproval(SLUG, {
      comment: null,
      decidedAt: APPROVED_AT,
      source: { kind: 'local' },
    }, { missionStore: fixture.store, lifecycleService: fixture.lifecycle });
    assert.notEqual(replay.outcome, 'failed', `a replayed approval is not a failure: ${replay.outcome === 'failed' ? replay.diagnostic : ''}`);

    const events = await laneEvents(fixture);
    const approveEvents = events.filter((event) => event.from_status === 'review' && event.to_status === 'integration');
    assert.equal(approveEvents.length, 1, `the replay records no second lane event: ${JSON.stringify(events)}`);
    assert.equal(await missionStatus(fixture), 'integration', 'the replay leaves the Mission in integration');
  } finally {
    await closeFixture(fixture);
  }
});

test('the unresolved-finding approve guard still rejects an approving round that has not finished fixing', async () => {
  const fixture = await openFixture(seedMission('review', applyReviewerCommand(
    startReview(
      { change: PULL_REQUEST, revision: changeRevision('rev-1') },
      REVIEWER,
      IMPLEMENTER,
      HANDOFF_AT,
      REVIEWER_ELIGIBILITY,
    ),
    {
      type: 'request-changes',
      decidedAt: CHANGES_REQUESTED_AT,
      comment: null,
      findings: [{ id: reviewFindingId('F1'), summary: 'Finding one', location: null }],
    },
  )));
  try {
    const result = await recordApproval(SLUG, {
      comment: null,
      decidedAt: APPROVED_AT,
      source: { kind: 'local' },
    }, { missionStore: fixture.store, lifecycleService: fixture.lifecycle });
    assert.equal(result.outcome, 'failed', 'an approving round still awaiting the implementer cannot be approved');
    if (result.outcome === 'failed') {
      assert.match(result.diagnostic, /awaiting-implementation/, 'the diagnostic names the blocked review status');
    }
    assert.equal(await missionStatus(fixture), 'review', 'the rejected approve leaves the Mission in review');
  } finally {
    await closeFixture(fixture);
  }
});

test('a failing review-state persist at the round-open boundary stops the round', async () => {
  const fixture = await openFixture(seedMission('refined', null));
  try {
    const activated = await fixture.lifecycle.activate({
      operationId: `activate-${SLUG}`,
      missionId: missionId(SLUG),
      capabilities: new Set(['mission:transition']),
      agent: IMPLEMENTER,
      occurredAt: ACTIVATE_AT,
    });
    assert.equal(activated.status, 'completed');
    const round1 = startReview(
      { change: PULL_REQUEST, revision: changeRevision('rev-1') },
      REVIEWER,
      IMPLEMENTER,
      HANDOFF_AT,
      REVIEWER_ELIGIBILITY,
    );
    const submitted = await fixture.lifecycle.transition({
      operationId: `handoff-${SLUG}`,
      missionId: missionId(SLUG),
      capabilities: new Set(['mission:transition']),
      command: { type: 'submit-for-review', gatesPassed: true, review: round1, reviewerEligibility: REVIEWER_ELIGIBILITY },
      actor: REVIEWER,
      occurredAt: HANDOFF_AT,
      idempotencyKey: `handoff-${SLUG}`,
    });
    assert.equal(submitted.status, 'completed');

    const state = new ReviewState(SLUG, {
      reviewer: REVIEWER,
      implementer: IMPLEMENTER,
      round: 1,
      startedAt: HANDOFF_AT,
    }, fixture.store);
    const failingWrite = async (..._args: Parameters<typeof writeReviewState>) => ({
      outcome: 'write-failed' as const,
      stage: 'write' as const,
      diagnostic: 'operator database write refused',
    });
    const result = await openReviewRound(SLUG, state, {
      worktree: fixture.root,
      log: () => undefined,
      error: () => undefined,
      writeReviewStateFn: failingWrite as typeof writeReviewState,
      missionStore: fixture.store,
      lifecycleService: fixture.lifecycle,
    });
    assert.equal(result.ok, false, 'the boundary reports the persist failure instead of opening the round');
    if (!result.ok) {
      assert.match(result.diagnostic, /operator database write refused/, 'the diagnostic carries the persist failure');
    }
  } finally {
    await closeFixture(fixture);
  }
});


test('native child CLI wrapper forwards commands without repeating the executable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2582-native-child-'));
  try {
    const binary = path.join(root, 'native-px');
    fs.writeFileSync(binary, '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o700 });
    const wrapper = pinChildCli(binary, { node: binary, native: true, stateHome: root, env: {} });
    const result = spawnSync(wrapper, ['verdict', 'approve', '--actor', 'reviewer'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(result.stdout.trim().split('\n'), ['verdict', 'approve', '--actor', 'reviewer']);
    const scriptWrapper = pinChildCli(binary, { node: '/node', nodeArgs: ['--import', 'tsx'], native: false, stateHome: root, env: {} });
    assert.ok(fs.readFileSync(scriptWrapper, 'utf8').includes(`'/node' '--import' 'tsx' '${binary}'`));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
