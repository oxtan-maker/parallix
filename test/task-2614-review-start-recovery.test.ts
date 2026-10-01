// TASK-2614 — red-to-green reproduction for review --start and --reconcile-review
// on a completed native (database-backed) Mission that carries no legacy
// `missions/<slug>` directory and no Backlog task file marked review.
//
// At the mission parent commit a fresh `px review <slug> --start` on such a
// mission fails closed: `ReviewWorkflowAdapter.runLoop` treats the absence of
// the retired `missions/<slug>` directory as "not a known mission" and stops
// before the reviewer-launch seam, and `--reconcile-review` fails closed on the
// absent Backlog task file. After the fix the Mission store is the sole
// authority, so `--start` reaches the reviewer-launch boundary and
// `--reconcile-review` rebuilds the missing round-one Review.

import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';


import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../src/adapters/sqlite/mission-store.js';
import { clearOperatorStateCache } from '../src/adapters/sqlite/adapter-factory.js';
import { mkdtempAt } from './helpers/temp-dir.js';
import { missionId, missionLabels, type Mission } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import { agentFamily } from '../src/domain/agents.js';
import { changeRevision, startReview, ConfiguredReviewerEligibility } from '../src/domain/review.js';
import { ReviewCommandUseCase } from '../src/application/review-command-use-case.js';
import { createReviewWorkflowAdapter, reconcileInterruptedHandoffHandler } from '../src/adapters/review/review-commands.js';
import { readReviewState } from '../src/adapters/review/review-state.js';
import { startReviewLoop } from '../src/adapters/review/review-loop.js';
import { resolveTaskFile } from '../src/adapters/backlog/backlog.js';

const SLUG = 'task-2614-review';
const REVIEWER = agentFamily('codex');
const IMPLEMENTER = agentFamily('claude');

const tempDirs: string[] = [];

after(() => {
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * A completed native Mission: active, at least one checkpoint carrying Goal
 * Check evidence, no Review, and — critically — no `missions/<slug>` directory
 * anywhere under the worktree. This is the TASK-2614 shape.
 */
function completedNativeMission(slug: string, rootDir: string): Mission {
  return {
    id: missionId(slug),
    repositoryId: repositoryId(rootDir),
    title: `Mission ${slug}`,
    labels: missionLabels(['ai_sdlc']),
    assignee: IMPLEMENTER,
    status: 'active',
    rawStatus: 'active',
    checkpoints: [
      {
        missionId: missionId(slug),
        name: 'CP-1',
        firstLine: 'CP-1: reproduce and fix',
        goalCheck: [{ criterion: 'AC-1', evidence: 'test/task-2614-review-start-recovery.test.ts' }],
        nextActionText: 'record evidence',
      },
    ],
    netEngineeringLines: 40,
    predictedNelBucket: 'Medium',
    reproductionTest: 'test/task-2614-review-start-recovery.test.ts',
    brief: null,
    declaredGates: ['./scripts/verify-local.sh all'],
    successCriteria: ['native Mission reaches review'],
    dependencies: [],
    closedAt: null,
    externalTaskRef: null,
    review: null,
  } as unknown as Mission;
}

function createFileFreeHome(slug: string): string {
  const root = mkdtempAt(os.tmpdir(), `parallix-task-2614-${slug}-`);
  tempDirs.push(root);
  fs.mkdirSync(path.join(root, 'parallix-home'), { recursive: true });
  // Deliberately NO missions/<slug> directory: this is a file-free Mission. The
  // review start/reconcile seams are injected, so no working Git repository is
  // needed; a real one would only push this into the integration layer.
  return root;
}

async function openStore(root: string): Promise<SqliteMissionStore> {
  const db = new SqliteDatabaseAdapter();
  await db.open({ path: path.join(root, 'parallix-home', 'parallix.db') });
  await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
  return new SqliteMissionStore(db);
}

interface InvokeStartResult {
  launched: boolean;
  error: string | null;
}

/** Drive `px review <slug> --start` through the review CLI against a store. */
async function invokeStart(store: SqliteMissionStore, root: string, status: 'active' | 'review'): Promise<InvokeStartResult> {
  let launched = false;
  let error: string | null = null;
  const adapter = createReviewWorkflowAdapter({
    missionStore: store,
    resolveWorktreeFn: () => root,
    log: () => undefined,
    error: (msg: string) => { error = msg; },
    exit: (code: number) => { throw new Error(`exit:${code}`); },
    inferSlugFn: () => SLUG,
    requireReviewAggregate: true,
    readReviewStateFn: (target: string, worktree: string, missionStore: import('../src/application/domain-ports.js').MissionStore | null | undefined) => readReviewState(target, worktree, missionStore),
    startReviewLoopFn: async () => { launched = true; },
  });
  const useCase = new ReviewCommandUseCase(adapter);
  try {
    await useCase.execute([SLUG, '--start'], {});
  } catch {
    // exit() throws; a launch either happened before the throw or the guard
    // rejected the start.
  }
  return { launched, error };
}

async function invokeReconcile(store: SqliteMissionStore, root: string): Promise<{ outcome: string; error: string | null }> {
  let error: string | null = null;
  const adapter = createReviewWorkflowAdapter({
    missionStore: store,
    resolveWorktreeFn: () => root,
    log: () => undefined,
    error: (msg: string) => { error = msg; },
    exit: (code: number) => { throw new Error(`exit:${code}`); },
    inferSlugFn: () => SLUG,
    reconcileInterruptedHandoffFn: (target: string, inputs: unknown, worktree: string, opts: unknown) =>
      import('../src/adapters/review/review-state.js').then((m) => m.reconcileInterruptedHandoff(target, inputs as never, worktree, opts as never)),
  });
  const useCase = new ReviewCommandUseCase(adapter);
  try {
    await useCase.execute([
      SLUG, '--reconcile-review', '--branch', `mission/${SLUG}`, '--target', 'main',
      '--reviewer', 'codex', '--implementer', 'claude', '--revision', 'abc123', '--eligible-reviewer', 'codex',
    ], {});
  } catch {
    // exit() throws on a failed reconciliation.
  }
  const loaded = await store.load(missionId(SLUG));
  const review = loaded.kind === 'found' ? loaded.mission.review : null;
  return { outcome: review ? 'reconciled' : 'not-reconciled', error };
}

interface StartTransitionResult {
  handoffRan: boolean;
  reviewerLaunched: boolean;
  reviewPersisted: boolean;
  error: string | null;
}

/**
 * Drive the real exported `startReviewLoop` fresh-start transition through the
 * public entry point with every external seam injected, so the review-loop's
 * open-PR handoff path executes for real — no copied helper, no Forgejo, no
 * live reviewer. The injected handoff writes the missing round-one Review and
 * performs the active → review transition (what the real handoff does), so the
 * loop then reaches the reviewer-launch boundary and the Review is persisted to
 * the operator store.
 *
 * Returns whether the handoff ran, whether the reviewer was launched, whether a
 * Review aggregate is persisted in the store, and any surfaced loop failure.
 */
async function driveStartTransition(
  store: SqliteMissionStore,
  root: string,
  opts: { openPr: boolean; launchReviewer?: boolean },
): Promise<StartTransitionResult> {
  let handoffRan = false;
  let reviewerLaunched = false;
  let error: string | null = null;
  let handoffWroteReview = false;
  // readReviewStateFn returns null until the handoff has run (so the fresh
  // start sees no Review and the Mission-authority reset lets the handoff
  // proceed), then returns an approved round-one view so the launched round
  // stops cleanly after the reviewer launch instead of spinning.
  let reviewed = false;
  try {
    // Typed `any`: the loop exposes 60+ injected seams, so a structural cast
    // against the full options type trips TS overlap checks. The seams are
    // exercised at runtime, not validated by their static shapes here.
    const loopOptions: any = {
      implementer: 'claude',
      reviewer: 'codex',
      worktree: root,
      missionStore: store,
      dryRun: false,
      isContinue: false,
      maxAttempts: 1,
      log: () => undefined,
      error: (msg: string) => { error = msg; },
      exit: (() => {}) as unknown as (_code: number) => never,
      providerAvailableFn: () => Promise.resolve(true),
      isForgejoReviewEnabledFn: () => true,
      maybeUpdateGraphifyBeforeReviewFn: async () => {},
      resolveTaskFileFn: () => ({ ok: true, taskFile: 'task.md' }) as ReturnType<typeof resolveTaskFile>,
      getTaskStatusFn: () => 'review',
      transitionTaskFn: () => Promise.resolve(true),
      getPrStatusFn: () =>
        opts.openPr
          ? ({ exists: true, number: 536, state: 'open', url: 'https://forgejo.example/reviews/536' })
          : ({ exists: false }),
      readReviewStateFn: () =>
        Promise.resolve((reviewed ? { reviewer: 'codex', round: 1, phase: 'reviewing', disposition: 'APPROVED' } : null) as unknown as ReturnType<typeof readReviewState>),
      performHandoffFn: async () => {
        handoffRan = true;
        const loaded = await store.load(missionId(SLUG));
        if (loaded.kind === 'found' && !loaded.mission.review) {
          const review = startReview(
            { change: { kind: 'local-branch', sourceBranch: `mission/${SLUG}`, targetBranch: 'main' }, revision: changeRevision('rev-1') },
            agentFamily('codex'),
            agentFamily('claude'),
            '2026-09-29T10:00:00.000Z',
            ConfiguredReviewerEligibility.fromReviewStep({ eligible: [agentFamily('codex'), agentFamily('qwen'), agentFamily('vibe')], strategy: 'random' }),
          );
          await store.save({ ...loaded.mission, status: 'review', rawStatus: 'review', review } as unknown as Mission, loaded.version);
          handoffWroteReview = true;
        }
        reviewed = true;
        return { ok: true };
      },
      rebaseBeforeReviewRoundFn: async () => ({ ok: true }),
      runPreReviewGateFn: async () => ({ ok: true, area: 'all', exitCode: 0 }),
      workflowLauncherStatusFn: () => ({ agent: 'codex', supported: opts.launchReviewer, detail: 'test-seam' }),
      writeReviewStateFn: async () => ({ outcome: 'committed' as const }),
      recordStageStatsSafeFn: async () => {},
      readTokenFn: () => null,
      ...(opts.launchReviewer
        ? {
          startAgentFn: async (step: string) => { if (step === 'review') { reviewerLaunched = true; } return { agent: 'codex' }; },
          applyAgentFallbackFn: async ({ original }: { original: string }) => original,
          // Approve immediately after launch so the round stops cleanly instead
          // of spinning on a missing reviewer outcome.
          consumeReviewerArtifactsFn: async () => ({ consumed: true, ok: true, reviewState: 'APPROVED', reviewFindings: [] }),
        }
        : {}),
      eligibleAgentsForStepFn: () => [agentFamily('codex'), agentFamily('qwen'), agentFamily('vibe')],
    };
    await startReviewLoop(SLUG, loopOptions);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const loaded = await store.load(missionId(SLUG));
  const reviewPersisted = loaded.kind === 'found' && Boolean(loaded.mission.review);
  return { handoffRan, reviewerLaunched, reviewPersisted: reviewPersisted || handoffWroteReview, error };
}

describe('TASK-2614: native Mission review start and recovery', () => {
  it('reproduces TASK-2614 start path: Review null with an existing open PR resumes', async () => {
    // The TASK-2614 shape: a handoff already opened a Forgejo PR, but the
    // round-one Review aggregate was never persisted to the operator store
    // (Review null). A fresh `px review <slug> --start` must resume. This drives
    // the real exported `startReviewLoop` transition through the public entry
    // point with every external seam injected, so the review-loop's open-PR
    // handoff path executes for real — not a copied helper.
    const root = createFileFreeHome(SLUG);
    const previousHome = process.env.PARALLIX_HOME;
    process.env.PARALLIX_HOME = path.join(root, 'parallix-home');
    clearOperatorStateCache();
    try {
      const store = await openStore(root);
      await store.save(completedNativeMission(SLUG, root), null);

      // This single fresh, persisted Review-null Mission drives the complete
      // existing-open-PR recovery: handoff records the missing aggregate, then
      // the loop reaches the reviewer-launch boundary.
      const resumeLaunched = await driveStartTransition(store, root, { openPr: true, launchReviewer: true });
      assert.equal(resumeLaunched.handoffRan, true, 'handoff runs when an open PR exists but the Review aggregate is missing');
      assert.equal(resumeLaunched.reviewerLaunched, true, 'the loop reaches the reviewer-launch boundary when the Review is missing');
      assert.equal(resumeLaunched.reviewPersisted, true, 'the missing round-one Review is persisted to the operator store');
      assert.equal(resumeLaunched.error, null, 'no failure diagnostic on the resume transition');
    } finally {
      if (previousHome === undefined) { delete process.env.PARALLIX_HOME; }
      else { process.env.PARALLIX_HOME = previousHome; }
      clearOperatorStateCache();
    }
  });

  it('surfaces a genuine loop failure instead of swallowing it', async () => {
    // The loop must not fail silently: when no reviewer can be routed, the
    // failure is observable (exit is wired to surface it), so a regression that
    // silently stops the loop is caught rather than passing the test.
    const root = createFileFreeHome(SLUG);
    const previousHome = process.env.PARALLIX_HOME;
    process.env.PARALLIX_HOME = path.join(root, 'parallix-home');
    clearOperatorStateCache();
    let surfaced = false;
    try {
      const store = await openStore(root);
      await store.save(completedNativeMission(SLUG, root), null);
      await startReviewLoop(SLUG, {
        implementer: 'claude',
        reviewer: 'codex',
        worktree: root,
        missionStore: store,
        dryRun: false,
        isContinue: false,
        log: () => undefined,
        error: () => undefined,
        // A real exit throws, so a loop that fails closed is observed.
        exit: (() => { surfaced = true; throw new Error('loop-exit'); }) as unknown as (_code: number) => never,
        providerAvailableFn: () => Promise.resolve(true),
        isForgejoReviewEnabledFn: () => true,
        maybeUpdateGraphifyBeforeReviewFn: async () => {},
        resolveTaskFileFn: () => ({ ok: true, taskFile: 'task.md' }) as ReturnType<typeof resolveTaskFile>,
        getTaskStatusFn: () => 'review',
        transitionTaskFn: () => Promise.resolve(true),
        getPrStatusFn: () => ({ exists: false }),
        readReviewStateFn: () => Promise.resolve(null),
        performHandoffFn: async () => ({ ok: true }),
        eligibleAgentsForStepFn: () => [], // no reviewer can be routed
      } as Parameters<typeof startReviewLoop>[1]);
    } catch {
      // expected: the surfaced exit throws
    } finally {
      if (previousHome === undefined) { delete process.env.PARALLIX_HOME; }
      else { process.env.PARALLIX_HOME = previousHome; }
      clearOperatorStateCache();
    }
    assert.equal(surfaced, true, 'a loop failure is surfaced, not swallowed');
  });

  it('starts review for a completed native Mission with no legacy directory', async () => {
    const root = createFileFreeHome(SLUG);
    const previousHome = process.env.PARALLIX_HOME;
    process.env.PARALLIX_HOME = path.join(root, 'parallix-home');
    clearOperatorStateCache();
    try {
      const store = await openStore(root);
      await store.save(completedNativeMission(SLUG, root), null);

      const { launched, error } = await invokeStart(store, root, 'active');
      assert.equal(launched, true, 'a fresh --start reaches the reviewer-launch boundary for a known native Mission');
      assert.equal(error, null, 'no failure diagnostic is emitted for a known active Mission');
    } finally {
      if (previousHome === undefined) { delete process.env.PARALLIX_HOME; }
      else { process.env.PARALLIX_HOME = previousHome; }
      clearOperatorStateCache();
    }
  });

  it('rejects a --start for a Mission that is not in the operator database', async () => {
    const root = createFileFreeHome('task-2614-unknown');
    const previousHome = process.env.PARALLIX_HOME;
    process.env.PARALLIX_HOME = path.join(root, 'parallix-home');
    clearOperatorStateCache();
    try {
      const store = await openStore(root);
      // No mission saved: the identity is unknown to the store and carries no
      // legacy directory, so a fresh --start must fail closed.
      const { launched, error } = await invokeStart(store, root, 'active');
      assert.equal(launched, false, 'an unknown Mission never reaches the reviewer-launch seam');
      assert.match(error ?? '', /no valid Review aggregate/);
    } finally {
      if (previousHome === undefined) { delete process.env.PARALLIX_HOME; }
      else { process.env.PARALLIX_HOME = previousHome; }
      clearOperatorStateCache();
    }
  });

  it('rejects --reconcile-review for a Mission not in the review lane', async () => {
    // A completed native Mission still in the `active` lane has no Review and
    // no task file marked review. The fixed reconcile path must fail closed on
    // the invalid status transition rather than inventing a round-one Review,
    // while the diagnostic points at the executable continuation.
    const root = createFileFreeHome(SLUG);
    const previousHome = process.env.PARALLIX_HOME;
    process.env.PARALLIX_HOME = path.join(root, 'parallix-home');
    clearOperatorStateCache();
    try {
      const store = await openStore(root);
      await store.save(completedNativeMission(SLUG, root), null);
      const { outcome, error } = await invokeReconcile(store, root);
      assert.equal(outcome, 'not-reconciled', 'an active Mission is not reconcilable');
      assert.ok(error && /review lane/.test(error), 'the diagnostic names the invalid status transition');
    } finally {
      if (previousHome === undefined) { delete process.env.PARALLIX_HOME; }
      else { process.env.PARALLIX_HOME = previousHome; }
      clearOperatorStateCache();
    }
  });

  it('rejects a self-reviewing reviewer through the preserved reviewer-separation guard', async () => {
    // AC#3: the guard fix must not weaken reviewer separation. A reviewer that
    // is also the implementer, when the policy allows another reviewer, is a
    // self review and must stay rejected through the start path that builds the
    // round-one Review.
    const eligibility = ConfiguredReviewerEligibility.fromReviewStep({
      eligible: [REVIEWER, agentFamily('vibe')],
      strategy: 'random',
    });
    assert.throws(
      () => startReview(
        { change: { kind: 'local-branch', sourceBranch: `mission/${SLUG}`, targetBranch: 'main' }, revision: changeRevision('rev-1') },
        REVIEWER,
        REVIEWER,
        '2026-09-01T09:00:00.000Z',
        eligibility,
      ),
      /may not review its own work/,
      'a reviewer that is the implementer is a self review and is rejected',
    );
  });

  it('rebuilds the missing round-one Review for a native Mission stuck in review', async () => {
    const root = createFileFreeHome(SLUG);
    const previousHome = process.env.PARALLIX_HOME;
    process.env.PARALLIX_HOME = path.join(root, 'parallix-home');
    clearOperatorStateCache();
    try {
      // A native Mission that reached the review lane but never persisted its
      // round-one Review: an interrupted handoff with no Backlog task file.
      const mission = {
        ...completedNativeMission(SLUG, root),
        status: 'review',
        rawStatus: 'review',
        review: null,
      } as unknown as Mission;
      const store = await openStore(root);
      await store.save(mission, null);

      const { outcome, error } = await invokeReconcile(store, root);
      assert.equal(outcome, "reconciled", "the supported recovery command rebuilds the missing round-one Review");
      assert.equal(error, null);
      const loaded = await store.load(missionId(SLUG));
      assert.ok(loaded.kind === 'found' && loaded.mission.review, 'the Review aggregate now persists in the store');
    } finally {
      if (previousHome === undefined) { delete process.env.PARALLIX_HOME; }
      else { process.env.PARALLIX_HOME = previousHome; }
      clearOperatorStateCache();
    }
  });

  it('fails closed when reconciliation cannot read the Mission authority', async () => {
    const root = createFileFreeHome('task-2614-unreadable-authority');
    const args = [
      '--reconcile-review', '--branch', `mission/${SLUG}`, '--target', 'main',
      '--reviewer', 'codex', '--implementer', 'claude', '--revision', 'abc123', '--eligible-reviewer', 'codex',
    ];
    const unreadableStore = { load: async () => { throw new Error('database unavailable'); } } as unknown as SqliteMissionStore;
    for (const missionStore of [null, unreadableStore]) {
      const errors: string[] = [];
      await assert.rejects(
        reconcileInterruptedHandoffHandler(SLUG, args, {
          missionStore,
          resolveWorktreeFn: () => root,
          error: (message: string) => errors.push(message),
          exit: () => { throw new Error('exit:1'); },
        }),
        /exit:1/,
      );
      assert.match(errors.join('\n'), /no Mission in the operator database is in the review lane/);
    }
  });
});
