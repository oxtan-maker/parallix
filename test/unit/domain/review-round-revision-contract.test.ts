import { resolveConfiguration } from '../../../src/composition/config.js';
const environment: NodeJS.ProcessEnv = { ...process.env };
// Historical regression provenance: TASK-2478.
// review round revision contract.
// Related scenarios share imports; each contract keeps its own hooks and mutable fixtures.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, after } from 'node:test';
import { postWorkflowReview } from '../../../src/adapters/review/review-artifacts.js';
import { continueReviewInvalidatesBlocker } from '../../../src/adapters/review/review-commands.js';
import { readAllEvents } from '../../../src/adapters/review/review-events.js';
import { applyReviewStateToReview, reviewStateDataFrom } from '../../../src/adapters/review/review-state-mapping.js';
import { ReviewState } from '../../../src/adapters/review/review-state.js';
import { clearOperatorStateCache } from '../../../src/adapters/sqlite/adapter-factory.js';
import { SqliteDatabaseAdapter } from '../../../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../../../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../../../src/adapters/sqlite/mission-store.js';
import { bindReviewPersistence, reviewLoopBindings } from '../../../src/composition/review-persistence.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { missionId, missionLabels, type Mission } from '../../../src/domain/mission.js';
import { repositoryId } from '../../../src/domain/repository.js';
import { ConfiguredReviewerEligibility, changeRevision, currentReviewRound, Review, ReviewRound, startReview, applyImplementerCommand, applyReviewerCommand, beginNextReviewRound, FindingResolution, reviewFindingId, reviewStatus } from '../../../src/domain/review.js';
import { mkdtemp as registeredMkdtemp } from '../../helpers/temp-dir.js';
import * as os from 'node:os';

// ── Review round revision ──

// Regression provenance: TASK-2385.
describe("stale review round repro", { concurrency: false }, () => {
  /**
   * Regression repro for TASK-2385: a flattened review-state write carrying a
   * round number lower than the aggregate's current round used to silently
   * renumber the newest round downward (round 2 -> round 1), which then violated
   * the round uniqueness constraint on the SQLite write and dropped the verdict.
   *
   * Before the fix this file is red: applying `round: 1` to an aggregate holding
   * rounds [1, 2] renumbers round 2 to round 1 and produces a duplicate round.
   * After the fix the stale write is rejected before persistence with a
   * diagnostic naming both the supplied and current round numbers, and equal /
   * higher round writes keep their monotonic numbering.
   */

  function twoRoundReview(): Review {
    const change = { kind: 'local-branch' as const, sourceBranch: 'mission/task-2385', targetBranch: 'main' };
    const reviewer = agentFamily('codex');
    const implementer = agentFamily('claude');
    const eligibility = ConfiguredReviewerEligibility.fromReviewStep({ eligible: [reviewer] } as never);
    const round1 = startReview({ change, revision: changeRevision('rev-1') }, reviewer, implementer, '2026-08-01T10:00:00.000Z', eligibility);
    const base = round1.rounds[0];
    const round2: ReviewRound = { ...base, number: 2 };
    return { ...round1, rounds: [base, round2] as unknown as Review['rounds'] };
  }

  describe("stale review round", () => {
    it('rejects a lower state round without renumbering an existing round', () => {
      const review = twoRoundReview();
      assert.deepEqual(
        review.rounds.map((round) => round.number),
        [1, 2],
        'seeded aggregate holds rounds 1 and 2',
      );

      let message = '';
      try {
        applyReviewStateToReview(review, { reviewer: 'codex', implementer: 'claude', round: 1, phase: 'reviewing' });
      } catch (error) {
        message = (error as Error).message;
      }

      // The stale write must be rejected, not silently applied.
      assert.ok(message, 'a stale lower round must be rejected');
      // The diagnostic must name both the supplied round and the current round.
      assert.match(message, /round 1/, `diagnostic must name the supplied round 1: ${message}`);
      assert.match(message, /round 2/, `diagnostic must name the current round 2: ${message}`);

      // A stale write must not mutate the input aggregate: round 2 stays numbered
      // 2. The rejection itself prevents any duplicate round from being created
      // (the mapper throws before constructing a new round list), so the only
      // observable duplicate-round guarantee is that the input is left intact.
      const numbers = review.rounds.map((round) => round.number);
      assert.deepEqual(numbers, [1, 2], `rejected write must not mutate the input aggregate: ${JSON.stringify(numbers)}`);
      const unique = new Set(numbers);
      assert.equal(unique.size, numbers.length, 'round numbers must remain unique');
    });

    it('updates the current round when the state round equals it', () => {
      const review = twoRoundReview();
      const applied = applyReviewStateToReview(
        review,
        { reviewer: 'codex', implementer: 'claude', round: 2, phase: 'approved', disposition: 'APPROVED' },
      );
      assert.deepEqual(
        applied.rounds.map((round) => round.number),
        [1, 2],
        'equal round must not add or shift rounds',
      );
      assert.equal(currentReviewRound(applied).phase, 'approved');
      assert.equal(currentReviewRound(applied).disposition, 'APPROVED');
    });

    it('advances to a higher round without changing prior round numbers', () => {
      const review = twoRoundReview();
      const applied = applyReviewStateToReview(
        review,
        { reviewer: 'codex', implementer: 'claude', round: 3, phase: 'reviewing' },
      );
      assert.deepEqual(
        applied.rounds.map((round) => round.number),
        [1, 2, 3],
        'a higher round appends without altering rounds 1 and 2',
      );
    });
  });

  describe("verdict persistence through the bound reviewer output seam", () => {
    /**
     * A 2-round mission in the operator store. Round 2 is current. This test
     * drives the production verdict writer through `bindReviewPersistence`, then
     * reads its typed output through `reviewLoopBindings`, with a real bound
     * store. It does NOT inject `readReviewStateFn` into
     * `postWorkflowReview`, so the verdict can only persist if the production path
     * forwards the bound reader (and `missionStore`) to `recordLocalReviewVerdict`.
     * A regression that drops that forward (TASK-2385 F1) makes the verdict read
     * miss and throws, so this test fails until the forward is present.
     */
    function twoRoundStore() {
      const base = {
        number: 1,
        subject: {
          change: { kind: 'local-branch' as const, sourceBranch: 'mission/task-2385', targetBranch: 'main' },
          revision: 'rev-1',
        },
        reviewer: 'claude',
        implementer: 'codex',
        startedAt: '2026-08-01T10:00:00.000Z',
        decision: null,
        response: null,
        phase: 'reviewing',
        disposition: null,
        reviewerRetryCount: 0,
        implementerRetryCount: 0,
      };
      const state = { mission: { id: 'task-2385', status: 'review', review: { rounds: [base, { ...base, number: 2 }], intervention: null, stageLaunches: [], reviewEvents: [] } as any }, version: 1, saves: [] as unknown[] };
      return {
        state,
        async load() { return { kind: 'found', mission: state.mission, version: state.version }; },
        async save(mission: any) { state.mission = mission; state.version += 1; state.saves.push(mission); return state.version; },
        async saveWithTransition(mission: any) { return this.save(mission); },
      };
    }

    function artifactDir(files: Record<string, string>) {
      const dir = registeredMkdtemp('task-2385-');
      for (const [name, content] of Object.entries(files)) { fs.writeFileSync(path.join(dir, name), content, 'utf8'); }
      return dir;
    }

    it('records an approve verdict onto the stored round 2 through the bound output path', async () => {
      const store = twoRoundStore();
      const tmpDir = artifactDir({
        'task-2385-review-findings.md': 'No blocking findings.',
        'task-2385-review-outcome.md': 'Verdict: approve',
        'task-2385-review-verdict.txt': 'approve',
      });
      let providerReviewCalled = false;

      const result = await bindReviewPersistence(store as never).consumeReviewerArtifacts('task-2385', 'claude', {
        worktree: tmpDir,
        tmpDir,
        providerEnabled: true,
        readTokenFn: () => 'mock-token',
        postCommentFn: () => ({ ok: true }),
        // Self-author: claude is the reviewer AND the PR author, so the provider
        // review POST is skipped and the verdict must persist locally on round 2.
        getPrAuthorFn: () => 'claude',
        postReviewFn: () => { providerReviewCalled = true; return { ok: true }; },
      });

      assert.equal(result.ok, true, 'the bound verdict writer consumes the artifacts');
      assert.equal(providerReviewCalled, false, 'a self-author verdict skips the provider review POST');
      const output = await reviewLoopBindings(store as never).consumeReviewerArtifacts('task-2385', 'claude', { worktree: tmpDir });
      assert.equal(output.consumed, true, 'the review loop reads the persisted verdict output');
      // The persisted verdict survives on round 2, not a fabricated round 1, and
      // round 1 keeps its number: the stale-round invariant holds end to end.
      assert.equal(store.state.mission.review.rounds[1].disposition, 'APPROVED', 'the approve verdict persists on the current round 2');
      assert.equal(store.state.mission.review.rounds[1].phase, 'approved', 'round 2 transitions to the approved phase');
      assert.deepEqual(
        store.state.mission.review.rounds.map((round: any) => round.number),
        [1, 2],
        'round numbers stay 1 and 2 after the verdict persists',
      );
    });
  });

  describe("verdict recording read miss", () => {
    it('fails closed when review state cannot be read instead of fabricating round 1', async () => {
      let verdictStateWritten = false;
      await assert.rejects(
        postWorkflowReview('task-2385-verdict', 'approve', 'looks good', {
          forgejoUser: 'reviewer-agent',
          readTokenFn: () => 'mock-token',
          getPrAuthorFn: () => 'reviewer-agent', // self-author => local verdict path
          postReviewFn: () => ({ ok: true }),
          readReviewStateFn: () => null, // read miss: no review state
          writeReviewStateFn: () => {
            verdictStateWritten = true;
            return Promise.resolve({ outcome: 'committed' as const });
          },
          createEventFn: () => ({ ok: true, path: '/mock' }),
          buildMetadataFooterFn: () => '',
          log: () => {},
          error: () => {},
        }),
        /no review state found|fabricate round 1/i,
        'a verdict read miss must fail closed rather than record a fabricated round 1',
      );
      assert.equal(verdictStateWritten, false, 'no verdict state must be written on a read miss');
    });
  });

  describe("verdict persistence to the Review aggregate", () => {
    it('records an approve verdict onto the current round without renumbering it', async () => {
      let captured: unknown;
      const result = await postWorkflowReview(
        'task-2385-persist',
        'approve',
        'looks good',
        {
          forgejoUser: 'reviewer-agent',
          readTokenFn: () => 'mock-token',
          getPrAuthorFn: () => 'reviewer-agent', // self-author => local verdict path
          readReviewStateFn: () => ({ round: 2, phase: 'reviewing', reviewer: 'claude', implementer: 'codex' }),
          writeReviewStateFn: (_slug: string, state: unknown) => {
            captured = state;
            return Promise.resolve({ outcome: 'committed' as const });
          },
          createEventFn: () => ({ ok: true, path: '/mock' }),
          buildMetadataFooterFn: () => '',
          log: () => {},
          error: () => {},
        },
      );

      assert.equal(result.ok, true, 'the self-author local verdict path records and returns ok');
      assert.equal(result.skipped, true, 'the provider POST is skipped on self-approval');
      assert.ok(captured instanceof ReviewState, 'the persisted verdict is a ReviewState aggregate');
      const capturedState = captured as ReviewState;
      assert.equal(capturedState.round, 2, 'the verdict attaches to the current round 2, not a fabricated round 1');
      assert.equal(capturedState.disposition, 'APPROVED', 'the approve verdict is recorded as APPROVED on the round');
      assert.equal(capturedState.phase, 'approved', 'the round transitions to the approved phase');
    });
  });
});

// Regression provenance: TASK-2478.
describe("revision integrity", { concurrency: false }, () => {
  /**
   * Stale-approval / revision-integrity guards for TASK-2478 (criterion 8, ADR
   * 0048 fail-closed). These drive the Review aggregate commands directly: a
   * stale earlier-round approval must never satisfy the later round, and
   * `CHANGES_MADE` alone must never be proof that a finding was resolved.
   */
  const reviewer = agentFamily('codex');
  const implementer = agentFamily('custom');
  const eligibility = ConfiguredReviewerEligibility.fromReviewStep({ eligible: [reviewer] } as never);

  const finding = { id: reviewFindingId('F1'), summary: 'fractional input accepted instead of rejected', location: null };

  function baseReview(): ReturnType<typeof startReview> {
    return startReview(
      { change: { kind: 'local-branch', sourceBranch: 'mission/task-2478', targetBranch: 'main' }, revision: changeRevision('rev-1') },
      reviewer,
      implementer,
      '2026-09-10T10:00:00.000Z',
      eligibility,
    );
  }

  function requestChanges(review: ReturnType<typeof startReview>, decidedAt: string): ReturnType<typeof startReview> {
    return applyReviewerCommand(review, { type: 'request-changes', decidedAt, comment: 'F1 blocks', findings: [finding] });
  }

  function resolve(review: ReturnType<typeof startReview>, respondedAt: string, resolutions: readonly FindingResolution[]) {
    return applyImplementerCommand(review, {
      type: 'submit-resolution',
      respondedAt,
      resolutions,
      resultingRevision: changeRevision('rev-2'),
    });
  }

  it('rejects an approve against a round still awaiting implementation (stale approval cannot advance, ADR 0048)', () => {
    const awaitingImpl = requestChanges(baseReview(), '2026-09-10T11:00:00.000Z');
    assert.equal(reviewStatus(awaitingImpl), 'awaiting-implementation');
    assert.throws(
      () => applyReviewerCommand(awaitingImpl, { type: 'approve', decidedAt: '2026-09-10T12:00:00.000Z', comment: null, source: { kind: 'local' } }),
      /cannot approve while review is awaiting-implementation/,
      'an approval cannot be recorded against a round that has not resolved its findings',
    );
  });

  it('rejects an empty resolution: CHANGES_MADE alone is not proof the finding was resolved', () => {
    const awaitingImpl = requestChanges(baseReview(), '2026-09-10T11:00:00.000Z');
    assert.throws(
      () => resolve(awaitingImpl, '2026-09-10T12:00:00.000Z', []),
      /Missing resolution for F1/,
      'a disposition without a resolution for every finding is rejected',
    );
  });

  it('rejects an implementer resolution on a round that was not requested-for-changes', () => {
    const awaitingReview = baseReview();
    assert.equal(reviewStatus(awaitingReview), 'awaiting-review');
    assert.throws(
      () => resolve(awaitingReview, '2026-09-10T12:00:00.000Z', [{ findingId: reviewFindingId('F1'), kind: 'fixed', evidence: 'x' }]),
      /while review is awaiting-review/,
    );
  });

  it('begins round 2 on the revised revision; an already-approved round is terminal and cannot re-round', () => {
    const resolved = resolve(requestChanges(baseReview(), '2026-09-10T11:00:00.000Z'), '2026-09-10T12:00:00.000Z', [
      { findingId: reviewFindingId('F1'), kind: 'fixed', evidence: 'guarded fractional input' },
    ]);
    assert.equal(reviewStatus(resolved), 'ready-for-next-round');

    const round2 = beginNextReviewRound(resolved, reviewer, implementer, '2026-09-10T13:00:00.000Z', eligibility);
    assert.equal(currentReviewRound(round2).number, 2, 'round 2 is a new round');
    assert.equal(
      currentReviewRound(round2).subject.revision,
      changeRevision('rev-2'),
      "round 2 evaluates the implementer's revised revision, not rev-1",
    );
    assert.equal(reviewStatus(round2), 'awaiting-review', 'round 2 is a fresh decision surface');
    assert.equal(currentReviewRound(round2).decision, null, 'the earlier round decision is not carried into round 2');
  });

  it('round 2 requires its own independent approval, attached to round 2 (criterion 9)', () => {
    const resolved = resolve(requestChanges(baseReview(), '2026-09-10T11:00:00.000Z'), '2026-09-10T12:00:00.000Z', [
      { findingId: reviewFindingId('F1'), kind: 'fixed', evidence: 'guarded fractional input' },
    ]);
    const round2 = beginNextReviewRound(resolved, reviewer, implementer, '2026-09-10T13:00:00.000Z', eligibility);

    const approvedR2 = applyReviewerCommand(round2, { type: 'approve', decidedAt: '2026-09-10T14:00:00.000Z', comment: null, source: { kind: 'local' } });
    const decision = currentReviewRound(approvedR2).decision;
    assert.equal(decision?.kind, 'approved', 'round 2 reaches approval with its own decision');
    assert.equal(currentReviewRound(approvedR2).number, 2, 'the approval is associated with round 2');
  });
});

// ── --continue invalidates a BLOCKED/PARKED stop — TASK-2478 (was task-2478-invalidate-blocker.test.ts) ──
// TASK-2478 — `px review --continue` invalidates a BLOCKED/PARKED implementer
// stop so the review loop re-polls the reviewer on the current tree instead of
// relaunching the stuck implementer on every invocation.
//
// Red at the mission parent commit: `continueReviewInvalidatesBlocker` does not
// exist, so `--continue` relaunches the implementer against any persisted
// BLOCKED disposition and spins forever (the loop treats an existing disposition
// as "resolve the blocker"). Green after the fix: a `--continue` on a BLOCKED
// review clears the disposition, resets the round to `reviewing`, and records
// the operator attribution.
describe("continue invalidates a BLOCKED/PARKED stop —", () => {
  const SLUG = 'task-2478-invalidate-blocker';
  const REVIEWER = agentFamily('configured-reviewer');
  const IMPLEMENTER = agentFamily('configured-implementer');

  const tempDirs: string[] = [];

  after(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function createTempRoot(): string {
    const dir = registeredMkdtemp(`parallix-task-2478-blocker-`);
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
    const previous = environment.PARALLIX_HOME;
    environment.PARALLIX_HOME = path.join(root, 'parallix-home');
    await clearOperatorStateCache();
    try {
      return await fn();
    } finally {
      if (previous === undefined) { delete environment.PARALLIX_HOME; }
      else { environment.PARALLIX_HOME = previous; }
      await clearOperatorStateCache();
    }
  }

  const reviewerEligibility = ConfiguredReviewerEligibility.fromReviewStep({
    eligible: [REVIEWER],
    strategy: 'random',
  });

  /**
   * A single round that decided `changes-requested` and whose implementer then
   * stopped on a BLOCKED disposition — the exact shape that pins the loop in the
   * fixing phase and relaunches on every `--continue`.
   */
  function blockedRound(): Review {
    const review = startReview(
      { change: { kind: 'local-branch', sourceBranch: `mission/${SLUG}`, targetBranch: 'main' }, revision: changeRevision('rev-1') },
      REVIEWER, IMPLEMENTER, '2026-09-01T09:00:00.000Z', reviewerEligibility,
    );
    const withChanges = applyReviewerCommand(review, {
      type: 'request-changes', decidedAt: '2026-09-01T10:00:00.000Z', comment: 'Fix findings', findings: [{ id: reviewFindingId('F1'), summary: 'Security', location: null }],
    });
    const state = reviewStateDataFrom(withChanges);
    return applyReviewStateToReview(withChanges, { ...state, phase: 'fixing', disposition: 'BLOCKED' });
  }

  /** Same as blockedRound but parked (a follow-up is owed instead of a fix). */
  function parkedRound(): Review {
    const review = startReview(
      { change: { kind: 'local-branch', sourceBranch: `mission/${SLUG}`, targetBranch: 'main' }, revision: changeRevision('rev-1') },
      REVIEWER, IMPLEMENTER, '2026-09-01T09:00:00.000Z', reviewerEligibility,
    );
    const withChanges = applyReviewerCommand(review, {
      type: 'request-changes', decidedAt: '2026-09-01T10:00:00.000Z', comment: 'Fix findings', findings: [{ id: reviewFindingId('F1'), summary: 'Security', location: null }],
    });
    const state = reviewStateDataFrom(withChanges);
    return applyReviewStateToReview(withChanges, { ...state, phase: 'fixing', disposition: 'PARKED' });
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

  describe("px review --continue invalidates a BLOCKED/PARKED stop", () => {
    it('clears a BLOCKED disposition and resets the round to reviewing', async () => {
      await withHome(createTempRoot(), async () => {
        const { root, store } = await seedRoot(blockedRound());
        const gitUser = { status: 0, stdout: 'alice-dev\n', stderr: '', error: null };
        const result = await continueReviewInvalidatesBlocker(SLUG, [], {
          resolveWorktreeFn: () => root,
          missionStore: store,
          log: () => undefined,
          error: () => undefined,
          runFn: (() => gitUser) as any,
        });
        assert.equal(result.invalidated, true, 'the BLOCKED stop is invalidated');
        const loaded = await store.load(missionId(SLUG));
        const review = loaded.kind === 'found' ? loaded.mission.review! : null;
        const round = currentReviewRound(review!);
        assert.equal(round.disposition, null, 'the round disposition is cleared');
        assert.equal(round.phase, 'reviewing', 'the round resets to reviewing so the loop re-polls the reviewer');
        assert.equal(round.blockedReason, undefined, 'the blocked reason is dropped');
      });
    });

    it('clears a PARKED disposition too', async () => {
      await withHome(createTempRoot(), async () => {
        const { root, store } = await seedRoot(parkedRound());
        const gitUser = { status: 0, stdout: 'alice-dev\n', stderr: '', error: null };
        const result = await continueReviewInvalidatesBlocker(SLUG, [], {
          resolveWorktreeFn: () => root,
          missionStore: store,
          log: () => undefined,
          error: () => undefined,
          runFn: (() => gitUser) as any,
        });
        assert.equal(result.invalidated, true, 'the PARKED stop is invalidated');
        const loaded = await store.load(missionId(SLUG));
        const review = loaded.kind === 'found' ? loaded.mission.review! : null;
        assert.equal(currentReviewRound(review!).disposition, null, 'the round disposition is cleared');
      });
    });

    it('leaves a non-blocked review untouched', async () => {
      await withHome(createTempRoot(), async () => {
        // A review that is already resolved (not blocked) is a no-op.
        const resolved = applyReviewerCommand(
          startReview({ change: { kind: 'local-branch', sourceBranch: `mission/${SLUG}`, targetBranch: 'main' }, revision: changeRevision('rev-1') }, REVIEWER, IMPLEMENTER, '2026-09-01T09:00:00.000Z', reviewerEligibility),
          { type: 'approve', decidedAt: '2026-09-01T10:00:00.000Z', comment: null, source: { kind: 'local' } },
        );
        const { root, store } = await seedRoot(resolved);
        const gitUser = { status: 0, stdout: 'alice-dev\n', stderr: '', error: null };
        const result = await continueReviewInvalidatesBlocker(SLUG, [], {
          resolveWorktreeFn: () => root,
          missionStore: store,
          log: () => undefined,
          error: () => undefined,
          runFn: (() => gitUser) as any,
        });
        assert.equal(result.invalidated, false, 'a non-blocked review is not invalidated');
        const loaded = await store.load(missionId(SLUG));
        const review = loaded.kind === 'found' ? loaded.mission.review! : null;
        assert.equal(reviewStatus(review), 'approved', 'the aggregate is unchanged');
      });
    });

    it('attributes the invalidation to the current git user on a review event', async () => {
      await withHome(createTempRoot(), async () => {
        const { root, store } = await seedRoot(blockedRound());
        const gitUser = { status: 0, stdout: 'alice-dev\n', stderr: '', error: null };
        await continueReviewInvalidatesBlocker(SLUG, [], {
          resolveWorktreeFn: () => root,
          missionStore: store,
          log: () => undefined,
          error: () => undefined,
          runFn: (() => gitUser) as any,
        });
        const events = await readAllEvents(SLUG, { rootDir: root, missionStore: store });
        const note = (events as Array<Record<string, unknown>>).find(
          (e) => e.event_type === 'human_note' && String(e.actor) === 'alice-dev',
        );
        assert.ok(note, 'the invalidation is attributed to the current git user');
        assert.match(String(note!.content), /BLOCKED/, 'the event names the invalidated stop');
      });
    });

    it('forwards a named --actor over the git user', async () => {
      await withHome(createTempRoot(), async () => {
        const { root, store } = await seedRoot(blockedRound());
        const gitUser = { status: 0, stdout: 'alice-dev\n', stderr: '', error: null };
        await continueReviewInvalidatesBlocker(SLUG, ['--actor=operator-carol'], {
          resolveWorktreeFn: () => root,
          missionStore: store,
          log: () => undefined,
          error: () => undefined,
          runFn: (() => gitUser) as any,
        });
        const events = await readAllEvents(SLUG, { rootDir: root, missionStore: store });
        const note = (events as Array<Record<string, unknown>>).find(
          (e) => e.event_type === 'human_note' && String(e.actor) === 'operator-carol',
        );
        assert.ok(note, 'the named operator overrides the git user');
      });
    });
  });
});
