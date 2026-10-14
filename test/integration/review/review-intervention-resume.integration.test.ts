// review intervention resume.integration.
// Related scenarios share imports; each contract keeps its own hooks and mutable fixtures.
import { describe, afterEach, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SqliteDatabaseAdapter } from '../../../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../../../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../../../src/adapters/sqlite/mission-store.js';
import { clearOperatorStateCache } from '../../../src/adapters/sqlite/adapter-factory.js';
import { missionId, missionLabels, type Mission } from '../../../src/domain/mission.js';
import { repositoryId } from '../../../src/domain/repository.js';
import { agentFamily } from '../../../src/domain/agents.js';
import {
  applyImplementerCommand,
  applyReviewerCommand,
  beginNextReviewRound,
  changeRevision,
  ConfiguredReviewerEligibility,
  requestReviewIntervention,
  reviewFindingId,
  reviewStatus,
  startReview,
  type Review,
} from '../../../src/domain/review.js';
import { ReviewCommandUseCase } from '../../../src/application/review-command-use-case.js';
import {
  continueReviewClearsIntervention,
  createReviewWorkflowAdapter,
} from '../../../src/adapters/review/review-commands.js';
import { unknownReviewFlags } from '../../../src/adapters/review/review-cli-flags.js';
import { applyReviewStateToReview, reviewStateDataFrom } from '../../../src/adapters/review/review-state-mapping.js';
import { readAllEvents } from '../../../src/adapters/review/review-events.js';
import { mkdtemp as registeredMkdtemp } from '../../helpers/temp-dir.js';

// Regression provenance: TASK-2473.
// TASK-2473 — red-to-green reproduction for `px review --resume`.
//
// A review stopped in `human-intervention` by `IMPLEMENTER_ARTIFACT_RETRY_EXHAUSTED`
// (task-2465 round 4 shape: reviewer decided `changes-requested`, then the
// implementer stopped on budget exhaustion) cannot be resubmitted while the
// intervention flag is set: `submit-for-review` throws
// `A submitted review must be awaiting a reviewer decision`, and `resumeReview`
// is only reachable from tests. This test drives the supported `--resume` CLI
// path against a real operator database and asserts the intervention is cleared,
// the derived status is not `human-intervention`, the cleared state survives a
// reload, and the handoff the derived status permits runs without a
// `MissionRuleViolation`.
//
// Red at the mission parent commit: `ReviewCommandUseCase.dispatch` has no
// `--resume` branch, so the flag falls through to `status` and no supported
// invocation clears the intervention. Green after the fix.

const SLUG = 'task-2473-resume';
const REVIEWER = agentFamily('configured-reviewer');
const IMPLEMENTER = agentFamily('configured-implementer');

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function createTempRoot(): string {
  const dir = registeredMkdtemp(`parallix-task-2473-resume-`);
  tempDirs.push(dir);
  fs.mkdirSync(path.join(dir, 'missions', SLUG), { recursive: true });
  fs.writeFileSync(path.join(dir, 'missions', SLUG, 'MISSION.md'), `# Mission: ${SLUG}\n`);
  fs.mkdirSync(path.join(dir, 'parallix-home'), { recursive: true });
  return dir;
}

function databasePathOf(root: string): string {
  return path.join(root, 'parallix-home', 'parallix.db');
}

async function withHome<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.PARALLIX_HOME;
  process.env.PARALLIX_HOME = path.join(root, 'parallix-home');
  await clearOperatorStateCache();
  try {
    return await fn();
  } finally {
    if (previous === undefined) { delete process.env.PARALLIX_HOME; }
    else { process.env.PARALLIX_HOME = previous; }
    await clearOperatorStateCache();
  }
}

const reviewerEligibility = ConfiguredReviewerEligibility.fromReviewStep({
  eligible: [REVIEWER],
  strategy: 'random',
});

/**
 * Build the task-2465 round-4 shape: a `changes-requested` round whose
 * implementer stopped on budget exhaustion, escalating to `human-intervention`
 * with `workflow`-requested metadata exactly the way `escalateToHumanReview`
 * persists it.
 */
function stoppedReview(): Review {
  const review = startReview(
    {
      change: { kind: 'local-branch', sourceBranch: `mission/${SLUG}`, targetBranch: 'main' },
      revision: changeRevision('rev-1'),
    },
    REVIEWER,
    IMPLEMENTER,
    '2026-09-01T09:00:00.000Z',
    reviewerEligibility,
  );
  const withChanges = applyReviewerCommand(review, {
    type: 'request-changes',
    decidedAt: '2026-09-01T10:00:00.000Z',
    comment: 'Fix the security findings',
    findings: [{ id: reviewFindingId('F1'), summary: 'Security findings', location: null }],
  });
  return requestReviewIntervention(withChanges, {
    requestedAt: '2026-09-01T11:00:00.000Z',
    requestedBy: 'workflow',
    reason: 'IMPLEMENTER_ARTIFACT_RETRY_EXHAUSTED',
  });
}

/**
 * A stopped review in round 2: round 1 resolved, round 2 decided
 * `changes-requested`, then escalated. Exercises the audit-event round
 * derivation (task-2473 round 2 F1).
 */
function stoppedReviewRound2(): Review {
  const review = startReview(
    { change: { kind: 'local-branch', sourceBranch: `mission/${SLUG}`, targetBranch: 'main' }, revision: changeRevision('rev-1') },
    REVIEWER, IMPLEMENTER, '2026-09-01T09:00:00.000Z', reviewerEligibility,
  );
  const r1 = applyReviewerCommand(review, {
    type: 'request-changes', decidedAt: '2026-09-01T10:00:00.000Z', comment: 'Fix findings', findings: [{ id: reviewFindingId('F1'), summary: 'Security', location: null }],
  });
  const r1responded = applyImplementerCommand(r1, {
    type: 'submit-resolution', respondedAt: '2026-09-01T11:00:00.000Z', resolutions: [{ findingId: reviewFindingId('F1'), kind: 'fixed', evidence: 'patched' }], resultingRevision: changeRevision('rev-2'),
  });
  const r2 = beginNextReviewRound(r1responded, REVIEWER, IMPLEMENTER, '2026-09-02T09:00:00.000Z', reviewerEligibility);
  const r2decided = applyReviewerCommand(r2, {
    type: 'request-changes', decidedAt: '2026-09-02T10:00:00.000Z', comment: 'Fix the security findings', findings: [{ id: reviewFindingId('F2'), summary: 'Security findings', location: null }],
  });
  return requestReviewIntervention(r2decided, {
    requestedAt: '2026-09-02T11:00:00.000Z', requestedBy: 'workflow', reason: 'IMPLEMENTER_ARTIFACT_RETRY_EXHAUSTED',
  });
}

function plainReadyForNextRound(): Review {
  const review = startReview(
    { change: { kind: 'local-branch', sourceBranch: `mission/${SLUG}`, targetBranch: 'main' }, revision: changeRevision('rev-1') },
    REVIEWER, IMPLEMENTER, '2026-09-02T09:00:00.000Z', reviewerEligibility,
  );
  const withChanges = applyReviewerCommand(review, {
    type: 'request-changes', decidedAt: '2026-09-02T10:00:00.000Z', comment: null, findings: [{ id: reviewFindingId('F1'), summary: 'Security findings', location: null }],
  });
  return applyImplementerCommand(withChanges, {
    type: 'submit-resolution',
    respondedAt: '2026-09-02T11:00:00.000Z',
    resolutions: [{ findingId: reviewFindingId('F1'), kind: 'fixed', evidence: 'patched' }],
    resultingRevision: changeRevision('rev-3'),
  });
}

function missionWith(review: Review): Mission {
  return {
    id: missionId(SLUG),
    repositoryId: repositoryId('parallix'),
    title: `Mission ${SLUG}`,
    labels: missionLabels([]),
    status: 'review',
    rawStatus: 'review',
    checkpoints: [],
    netEngineeringLines: null,
    closedAt: null,
    assignee: null,
    externalTaskRef: null,
    intakeTrace: null,
    review,
  } as Mission;
}

async function openMigrated(root: string): Promise<SqliteDatabaseAdapter> {
  const db = new SqliteDatabaseAdapter();
  await db.open({ path: databasePathOf(root) });
  await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
  return db;
}

interface Harness { root: string; store: SqliteMissionStore; }

async function seedRoot(review: Review): Promise<Harness> {
  const root = createTempRoot();
  const db = await openMigrated(root);
  const store = new SqliteMissionStore(db);
  await store.save(missionWith(review), null);
  return { root, store };
}

/** Invoke the supported `px review --resume` CLI recovery adapter path. */
async function invokeResume(store: SqliteMissionStore, root: string, actor: string | null): Promise<{ cleared: boolean; outcome: string | null }> {
  const adapter = createReviewWorkflowAdapter({
    missionStore: store,
    resolveWorktreeFn: () => root,
    log: () => undefined,
    error: () => undefined,
    exit: (code: number) => { throw new Error(`exit:${code}`); },
    inferSlugFn: () => SLUG,
  });
  const useCase = new ReviewCommandUseCase(adapter);
  const args = actor === null ? [SLUG, '--resume'] : [SLUG, '--resume', `--actor=${actor}`];
  try {
    await useCase.execute(args, {});
  } catch {
    // parent commit: `--resume` is an unknown flag and the CLI exits 1.
  }
  const loaded = await store.load(missionId(SLUG));
  const review = loaded.kind === 'found' && loaded.mission.review ? loaded.mission.review : null;
  return { cleared: review?.intervention === null, outcome: review ? reviewStatus(review) : null };
}

describe("stopped review recovery through px review --resume", () => {
  it('clears a human-intervention stop and derives the surviving-round status', async () => {
    await withHome(createTempRoot(), async () => {
      const { root, store } = await seedRoot(stoppedReview());
      const { cleared, outcome } = await invokeResume(store, root, 'human');
      assert.equal(cleared, true, 'review.intervention is null after recovery');
      assert.notEqual(outcome, 'human-intervention', 'recovery derives the surviving-round status');
    });
  });

  it('rejects a review that is not in human-intervention', async () => {
    await withHome(createTempRoot(), async () => {
      const { root, store } = await seedRoot(plainReadyForNextRound());
      const { outcome } = await invokeResume(store, root, 'human');
      assert.equal(outcome, 'ready-for-next-round', 'a non-intervened review is left untouched');
    });
  });

  it('requires an authorized --actor to clear the intervention', async () => {
    await withHome(createTempRoot(), async () => {
      const { root, store } = await seedRoot(stoppedReview());
      const { cleared } = await invokeResume(store, root, null);
      assert.equal(cleared, false, 'an operator identity is required to clear an intervention');
    });
  });

  it('does not resurrect the intervention on reload', async () => {
    await withHome(createTempRoot(), async () => {
      const { root, store } = await seedRoot(stoppedReview());
      await invokeResume(store, root, 'human');
      const reloaded = await store.load(missionId(SLUG));
      const review = reloaded.kind === 'found' ? reloaded.mission.review! : stoppedReview();
      assert.equal(review.intervention, null, 'persisted intervention is null');
      const metadata = reviewStateDataFrom(review).metadata || {};
      assert.equal(metadata.humanEscalationReason, undefined);
      assert.equal(metadata.humanEscalatedAt, undefined);
      const reapplied = applyReviewStateToReview(review, reviewStateDataFrom(review));
      assert.equal(reapplied.intervention, null, 'applyReviewStateToReview yields no intervention');
    });
  });

  it('lets the derived-status handoff proceed without a MissionRuleViolation', async () => {
    await withHome(createTempRoot(), async () => {
      const { root, store } = await seedRoot(stoppedReview());
      await invokeResume(store, root, 'human');
      const reloaded = await store.load(missionId(SLUG));
      const review = reloaded.kind === 'found' ? reloaded.mission.review! : stoppedReview();
      // The task-2465 shape derives `awaiting-implementation`: the implementer
      // resolution is the handoff that status permits.
      const status = reviewStatus(review);
      assert.equal(status, 'awaiting-implementation', `expected awaiting-implementation, got ${status}`);
      assert.doesNotThrow(() =>
        applyImplementerCommand(review, {
          type: 'submit-resolution',
          respondedAt: '2026-09-03T09:00:00.000Z',
          resolutions: [{ findingId: reviewFindingId('F1'), kind: 'fixed', evidence: 'patched' }],
          resultingRevision: changeRevision('rev-2'),
        }),
      );
    });
  });

  it('leaves an approved review that carries a stale intervention untouched', async () => {
    await withHome(createTempRoot(), async () => {
      const review = applyReviewerCommand(
        startReview(
          { change: { kind: 'local-branch', sourceBranch: `mission/${SLUG}`, targetBranch: 'main' }, revision: changeRevision('rev-1') },
          REVIEWER, IMPLEMENTER, '2026-09-05T09:00:00.000Z', reviewerEligibility,
        ),
        { type: 'approve', decidedAt: '2026-09-05T10:00:00.000Z', comment: null, source: { kind: 'local' } },
      );
      // A stale intervention from a superseded round: reviewStatus reports
      // 'approved' ahead of it, so this review is never a recovery candidate.
      const stale = { ...review, intervention: { requestedAt: '2026-09-05T08:00:00.000Z', requestedBy: 'reviewer' as const, reason: 'stale' } };
      assert.equal(reviewStatus(stale), 'approved');
      const { root, store } = await seedRoot(stale);
      const { outcome } = await invokeResume(store, root, 'human');
      assert.equal(outcome, 'approved', 'an approved review is not a recovery candidate');
    });
  });

  it('attributes the clearing actor to a review event', async () => {
    // F1/F2: the --actor override must be attributable. Drive a real recovery
    // with a named operator and assert that identity lands on a review event,
    // so an operator inspecting review-events/ can see who cleared the stop.
    await withHome(createTempRoot(), async () => {
      const { root, store } = await seedRoot(stoppedReview());
      const { cleared } = await invokeResume(store, root, 'operator-alice');
      assert.equal(cleared, true, 'review.intervention is null after recovery');
      const events = await readAllEvents(SLUG, { rootDir: root, missionStore: store });
      const resumeNote = (events as Array<Record<string, unknown>>).find(
        (e) => e.event_type === 'human_note' && String(e.actor) === 'operator-alice',
      );
      assert.ok(resumeNote, 'the clearing operator is attributed to a review event');
      assert.match(String(resumeNote!.content), /operator-alice/, 'the event names who cleared the stop');
    });
  });

  it('records the audit event at the recovered round', async () => {
    // task-2473 round 2 F1: the audit event round must follow the recovered
    // review's current round, not be hard-coded to 1. A round-2 stop must
    // export a round-2 human_note.
    await withHome(createTempRoot(), async () => {
      const { root, store } = await seedRoot(stoppedReviewRound2());
      const { cleared } = await invokeResume(store, root, 'operator-alice');
      assert.equal(cleared, true, 'review.intervention is null after recovery');
      const events = await readAllEvents(SLUG, { rootDir: root, missionStore: store });
      const resumeNote = (events as Array<Record<string, unknown>>).find(
        (e) => e.event_type === 'human_note' && String(e.actor) === 'operator-alice',
      );
      assert.ok(resumeNote, 'the clearing operator is attributed to a review event');
      assert.equal((resumeNote as Record<string, unknown>).round, 2, 'the audit event records the recovered round 2');
    });
  });

  it('keeps ordinary review command flags parsing (continue and resume coexist)', () => {
    // Regression: adding --resume did not disturb the existing flag allow-list;
    // --continue and --resume are both recognized and --resume is not a value
    // flag.
    assert.deepEqual(
      unknownReviewFlags([SLUG, '--continue', '--resume', '--actor', 'human']),
      [],
      'continue and resume are recognized review flags',
    );
  });

  it('continue clears a human-intervention stop attributed to the git user', async () => {
    // `px review --continue` relaunches the loop after clearing the stop. It
    // takes no --actor: attribution is to the operator (the current git user),
    // with zero ceremony. A stubbed `run` stands in for `git config user.name`.
    await withHome(createTempRoot(), async () => {
      const { root, store } = await seedRoot(stoppedReview());
      const gitUser = { status: 0, stdout: 'alice-dev\n', stderr: '', error: null };
      const cleared = await continueReviewClearsIntervention(SLUG, [], {
        resolveWorktreeFn: () => root,
        missionStore: store,
        log: () => undefined,
        error: () => undefined,
        runFn: (() => gitUser) as any,
      });
      assert.equal(cleared, true, 'the intervention is cleared by --continue');
      const loaded = await store.load(missionId(SLUG));
      const review = loaded.kind === 'found' ? loaded.mission.review! : null;
      assert.equal(review?.intervention, null, 'intervention cleared on the persisted aggregate');
      const events = await readAllEvents(SLUG, { rootDir: root, missionStore: store });
      const note = (events as Array<Record<string, unknown>>).find((e) => e.event_type === 'human_note' && String(e.actor) === 'alice-dev');
      assert.ok(note, 'the clearing is attributed to the current git user');
    });
  });

  it('continue falls back to a generic operator when no git user is set', async () => {
    await withHome(createTempRoot(), async () => {
      const { root, store } = await seedRoot(stoppedReview());
      const gitUser = { status: 1, stdout: '', stderr: 'fatal: not a git repository', error: null };
      const cleared = await continueReviewClearsIntervention(SLUG, [], {
        resolveWorktreeFn: () => root,
        missionStore: store,
        log: () => undefined,
        error: () => undefined,
        runFn: (() => gitUser) as any,
      });
      assert.equal(cleared, true, 'still clears without a git user');
      const events = await readAllEvents(SLUG, { rootDir: root, missionStore: store });
      const note = (events as Array<Record<string, unknown>>).find((e) => e.event_type === 'human_note' && String(e.actor) === 'operator');
      assert.ok(note, 'a generic operator attribution is recorded when no git user is resolvable');
    });
  });

  it('continue leaves a non-intervened review untouched', async () => {
    await withHome(createTempRoot(), async () => {
      const { root, store } = await seedRoot(plainReadyForNextRound());
      const gitUser = { status: 0, stdout: 'alice-dev\n', stderr: '', error: null };
      const cleared = await continueReviewClearsIntervention(SLUG, [], {
        resolveWorktreeFn: () => root,
        missionStore: store,
        log: () => undefined,
        error: () => undefined,
        runFn: (() => gitUser) as any,
      });
      assert.equal(cleared, false, 'no intervention to clear');
      const loaded = await store.load(missionId(SLUG));
      const review = loaded.kind === 'found' ? loaded.mission.review! : null;
      assert.equal(review?.intervention, null, 'aggregate unchanged');
      const events = await readAllEvents(SLUG, { rootDir: root, missionStore: store });
      assert.equal((events as Array<Record<string, unknown>>).filter((e) => e.event_type === 'human_note').length, 0, 'no audit event for a no-op');
    });
  });

  it('reproduces the red parent-commit state: dispatch falls through to status', async () => {
    // This assertion documents the red baseline: at the mission parent commit
    // `--resume` has no dispatch branch, so the command falls through to
    // `status` and leaves the review in human-intervention. It stays green at
    // HEAD too, because after the fix the actor-less call is still rejected by
    // the --actor boundary — so this pins the boundary, not a flag allow-list.
    await withHome(createTempRoot(), async () => {
      const { root, store } = await seedRoot(stoppedReview());
      const { cleared, outcome } = await invokeResume(store, root, null);
      assert.equal(cleared, false, 'no supported invocation clears the intervention without an actor');
      assert.equal(outcome, 'human-intervention');
    });
  });
});

// Running CLI recovery contract: real Git/SQLite/composition, isolated launcher boundary.
import { setLogger } from '../../../src/application/presentation/cli-format.js';
import { run as runCli } from '../../../src/composition/create-cli.js';
import { openRepairFixture } from '../../lib/integration-repair-fixture.js';
import { setCommandPathProbe, setLauncherHealthProbe, setWorkflowLaunchPort } from '../../../src/adapters/agents/agents.js';
import { RepairCheckpointService } from '../../../src/application/repair-checkpoint-service.js';
import { revokeApprovedDecision } from '../../../src/domain/review.js';

it('running CLI recovers an interrupted bounceback and retains handoff evidence obligations (TASK-2738)', { timeout: 10000 }, async (t) => {
  const fixture = await openRepairFixture({ slug: 'task-repair-recovery' });
  const priorConfinement = process.env.PARALLIX_NO_BUBBLEWRAP;
  process.env.PARALLIX_NO_BUBBLEWRAP = '1';
  t.after(async () => {
    setWorkflowLaunchPort(null);
    setCommandPathProbe(null);
    setLauncherHealthProbe(null);
    if (priorConfinement === undefined) { delete process.env.PARALLIX_NO_BUBBLEWRAP; }
    else { process.env.PARALLIX_NO_BUBBLEWRAP = priorConfinement; }
    await fixture.close();
  });
  const store = new SqliteMissionStore(fixture.database);
  const original = await fixture.load();
  const bounced = revokeApprovedDecision(original.review!, 1, {
    revokedAt: '2026-10-01T12:00:00Z', revokedBy: 'workflow', reason: 'gate failed',
    cause: { kind: 'integration-gate-failure', gate: ':' },
  });
  const stopped = requestReviewIntervention(bounced, {
    requestedAt: '2026-10-01T13:00:00Z', requestedBy: 'workflow', reason: 'REPAIR_EXHAUSTED',
  });
  await store.save({ ...original, status: 'active', rawStatus: 'active', review: stopped } as Mission, await fixture.version() as never);
  const repair = new RepairCheckpointService(store);
  const opened = await repair.open({ slug: fixture.slug, incidentId: 'interrupted-incident', command: ':', attempt: 3 });
  assert.ok(opened);
  const task = path.join(fixture.worktree, 'backlog', 'tasks', `${fixture.slug} - Fixture.md`);
  fs.writeFileSync(task, fs.readFileSync(task, 'utf8').replace('status: ready-for-integration', 'status: active'));
  fixture.git(fixture.worktree, ['add', '.']);
  fixture.git(fixture.worktree, ['commit', '-m', 'persist interrupted repair fixture']);
  const before = await fixture.load();
  const prompts: string[] = [];
  const launches: string[] = [];
  setCommandPathProbe(() => '/fixture-agent');
  setLauncherHealthProbe(() => ({ ok: true }));
  setWorkflowLaunchPort(({ prompt, worktree }: { prompt: string; worktree?: string }) => {
    launches.push('act-on-review');
    prompts.push(prompt);
    return { invocation: { command: 'fixture-agent', args: [], options: { cwd: worktree } },
      resultPromise: Promise.resolve({ status: 0, stdout: '', stderr: '' }) };
  });
  const messages: string[] = [];
  const previousLogger = setLogger({ log: text => { messages.push(String(text)); }, error: text => { messages.push(String(text)); } });
  t.after(() => { setLogger(previousLogger); });
  const invoke = (args: string[]) => runCli(args, { baseCwd: fixture.worktree, log: text => { messages.push(text); return text; }, error: text => { messages.push(text); return text; } });
  assert.equal(await invoke(['review', fixture.slug, '--continue']), 0);
  assert.deepEqual(launches, ['act-on-review']);
  const prompt = prompts[0];
  for (const text of ['act-on-review', 'status task-repair-recovery', 'checkpoint', 'handoff']) { assert.ok(prompt.includes(text), prompt); }
  const after = await fixture.load();
  assert.deepEqual(after.checkpoints, before.checkpoints);
  assert.equal(after.review?.intervention, null, '--continue clears the operator stop');
  assert.equal(after.checkpoints.at(-1)?.repair?.evidenceRecorded, false);
  assert.equal(after.checkpoints.at(-1)?.repair?.verified, false);

  t.diagnostic(`CLI recovery launched one implementer; ${opened.name}/interrupted-incident retained, evidenceRecorded=false, verified=false; operator stop cleared.`);

  messages.length = 0;
  assert.equal(await invoke(['review', fixture.slug, '--start']), 1);
  assert.ok(messages.join('\n').includes('checkpoint evidence is missing'), messages.join('\n'));
  assert.ok(messages.join('\n').includes(opened.name), messages.join('\n'));
  assert.equal(launches.length, 1, 'handoff refusal must not launch a reviewer or repair agent');
  t.diagnostic(`Reviewer handoff rejected missing ${opened.name} evidence before any reviewer launch.`);
  await assert.rejects(repair.verify(fixture.slug, opened.name), /fresh authorized evidence/);
  assert.equal(await invoke(['checkpoint', 'record', '--slug', fixture.slug, '--name', opened.name,
    '--criterion', 'feature ships', '--evidence', 'feature.txt', '--next', 'Run authorized checks, then independent review']), 0);
  const recorded = await fixture.load();
  assert.equal(recorded.checkpoints.at(-1)?.repair?.evidenceRecorded, true);
  assert.equal(recorded.checkpoints.at(-1)?.repair?.verified, false, 'recorded evidence is not harness verification');
  assert.equal(recorded.checkpoints.at(-1)?.repair?.incidentId, 'interrupted-incident');
  t.diagnostic('Real checkpoint record accepted fresh evidence and retained incident authority; it did not synthesize verification or approval.');
  setWorkflowLaunchPort(({ prompt, worktree }: { prompt: string; worktree?: string }) => ({
    invocation: { command: 'fixture-reviewer', args: [], options: { cwd: worktree } },
    resultPromise: (async () => {
      assert.match(prompt, /^Mode: review\./m, 'only independent reviewer work is allowed after repaired handoff');
      launches.push('review');
      const mission = await fixture.load();
      assert.equal(await invoke(['verdict', 'approve', '--slug', fixture.slug,
        '--actor', mission.review!.rounds.at(-1)!.reviewer, '--comment', 'Fixture repair reviewed']), 0);
      return { status: 0, stdout: '', stderr: '' };
    })(),
  }));
  assert.equal(await invoke(['review', fixture.slug, '--continue']), 0, messages.join('\n'));
  assert.deepEqual(launches, ['act-on-review', 'review']);
  assert.equal(reviewStatus((await fixture.load()).review!), 'approved');
  t.diagnostic('After valid evidence, normal --continue passed handoff and launched the independent reviewer; approval came only from its explicit verdict.');
});
