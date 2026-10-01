// Mission handoff lane-event contract: bounce/relaunch ordering, retry without a duplicate lane event,
// and active-lane projection.
//
// Behavior-owned suite (TASK-2622.07). Legacy case names are unchanged; each section keeps its
// historical task provenance and the legacy file it replaced.
//   Handoff bounce: TASK-2377.05
//   Handoff retry lane events: TASK-2456
//   Active lane projection: TASK-2392

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { runHandoffAndReview } from '../src/adapters/cli/commands/active.js';
import { classifyError, FailureClass, DispatchAction } from '../src/application/failure-classification.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId } from '../src/domain/mission.js';
import { ConfiguredReviewerEligibility, applyImplementerCommand, applyReviewerCommand, beginNextReviewRound, changeRevision, reviewFindingId, startReview, type Review, type ReviewedChange } from '../src/domain/review.js';
import { MissionVersion } from '../src/application/domain-ports.js';
import { MissionLifecycleService } from '../src/application/mission-lifecycle-service.js';
import { fixtureMission } from './fixtures/mission-builders.js';
import { openMigratedMissionStore, type MigratedMissionStore } from './fixtures/mission-sqlite-store.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ConcreteMissionReadAdapter } from '../src/adapters/backlog/concrete-mission-read-adapter.js';
import { buildBoardMetrics, buildBoardProjection } from '../src/application/projections/board.js';
import { projectMissionCard } from '../src/application/projections/mission-board.js';
import { repositoryId } from '../src/domain/repository.js';
import { mkdtemp as registeredMkdtemp } from './helpers/temp-dir.js';

// TASK-2377.05 (was test/task-2377.05-handoff-bounce.test.ts)
describe('Handoff bounce', () => {
  // ---------------------------------------------------------------------------
  // TASK-2377.05 — the two `px active` handoff bounces run through the rebound
  // kernel (SC3 checkpoint validation, SC4 handoff failure, SC8 git-only repair).
  //
  // `runHandoffAndReview` is exercised directly with every boundary injected:
  // checkpoint validation, `performHandoff`, `repairHandoff`, the review loop,
  // and the agent launch seam are all mocks. No agent, git, LLM, or Forgejo is
  // involved.
  // ---------------------------------------------------------------------------

  const SLUG = 'task-2377.05';
  const WORKTREE = '/tmp/worktree-task-2377.05';

  /** Checkpoint gap text the validator emits and the guard treats as relaunchable. */
  const CHECKPOINT_GAP =
    'No checkpoint documents found in /tmp/worktree-task-2377.05/missions/task-2377.05. '
    + 'The execute agent must create checkpoint documents (CP-N.md) with a Goal Check table before handoff.';

  /** A relaunchable gate failure: AutoSendBack, not GitBlockers, not HumanOnly. */
  const GATE_FAILURE =
    'Verification gate failed for area all: `./scripts/verify-local.sh all` exited 1.';

  // ── SC3: checkpoint-validation bounce ───────────────────────────────────────

  test('SC3: checkpoint re-validation passing falls through to performHandoff', async () => {
    let validations = 0;
    let launches = 0;
    let handoffCalls = 0;
    const result = await runHandoffAndReview(SLUG, WORKTREE, 'codex', {
      validateCheckpointsBeforeHandoffFn: () => {
        validations++;
        return validations === 1 ? { ok: false, error: CHECKPOINT_GAP } : { ok: true };
      },
      startAgentFn: async () => { launches++; return { agent: 'codex', result: { status: 0 } }; },
      performHandoff: async () => { handoffCalls++; return { ok: true }; },
      startReviewLoop: async () => {},
      log: () => {},
      error: () => {},
    });

    assert.equal(result, true, 'the mission proceeds once checkpoints validate');
    assert.equal(launches, 1, 'one bounce was enough');
    assert.equal(validations, 2, 'the kernel verify re-ran the exact check that failed');
    assert.equal(handoffCalls, 1, 'the fixed outcome falls through to performHandoff');
  });

  test('SC3: two failed re-validations return false after exactly two launches', async () => {
    let launches = 0;
    let handoffCalls = 0;
    const errors: string[] = [];
    const result = await runHandoffAndReview(SLUG, WORKTREE, 'codex', {
      validateCheckpointsBeforeHandoffFn: () => ({ ok: false, error: CHECKPOINT_GAP }),
      startAgentFn: async () => { launches++; return { agent: 'codex', result: { status: 0 } }; },
      performHandoff: async () => { handoffCalls++; return { ok: true }; },
      startReviewLoop: async () => {},
      log: () => {},
      error: (msg: string) => errors.push(msg),
    });

    assert.equal(result, false, 'an exhausted checkpoint bounce strands the mission');
    assert.equal(launches, 2, 'exactly the kernel per-occurrence budget of two launches');
    assert.equal(handoffCalls, 0, 'performHandoff is never reached');
    assert.ok(
      errors.some(msg => msg.includes('Create a checkpoint document')),
      'checkpointValidationNextAction is still emitted on exhaustion',
    );
  });

  test('SC3: a non-relaunchable checkpoint error launches no agent at all', async () => {
    let launches = 0;
    let handoffCalls = 0;
    const errors: string[] = [];
    // A dirty-worktree checkpoint is GitBlockers — not IncompleteEvidence, and no
    // nextCheckpoint — so the guard declines to call the kernel.
    const result = await runHandoffAndReview(SLUG, WORKTREE, 'codex', {
      validateCheckpointsBeforeHandoffFn: () => ({
        ok: false,
        error: 'Checkpoint documents are uncommitted in the worktree; commit them before handoff.',
      }),
      startAgentFn: async () => { launches++; return { agent: 'codex', result: { status: 0 } }; },
      performHandoff: async () => { handoffCalls++; return { ok: true }; },
      startReviewLoop: async () => {},
      log: () => {},
      error: (msg: string) => errors.push(msg),
    });

    assert.equal(result, false, 'a non-relaunchable checkpoint error strands the mission');
    assert.equal(launches, 0, 'no agent is launched');
    assert.equal(handoffCalls, 0, 'performHandoff is never reached');
    assert.ok(errors.length > 0, 'the operator instruction is emitted');
  });

  // ── SC4: handoff-failure bounce ─────────────────────────────────────────────

  test('SC4: a passing performHandoff re-run flows into the gatekeeper-pushback branch', async () => {
    let launches = 0;
    let handoffCalls = 0;
    let reviewLoopStarted = false;
    const result = await runHandoffAndReview(SLUG, WORKTREE, 'codex', {
      validateCheckpointsBeforeHandoffFn: () => ({ ok: true }),
      performHandoff: async () => {
        handoffCalls++;
        return handoffCalls === 1
          ? { ok: false, error: GATE_FAILURE, gateOutput: { stdout: 'gate stdout', stderr: 'gate stderr' } }
          : { ok: true, gatekeeperPushedBack: true };
      },
      startAgentFn: async () => { launches++; return { agent: 'codex', result: { status: 0 } }; },
      startReviewLoop: async () => { reviewLoopStarted = true; },
      log: () => {},
      error: () => {},
    });

    assert.equal(result, true, 'the refreshed successful handoffResult is carried forward');
    assert.equal(launches, 1, 'one bounce was enough');
    assert.equal(handoffCalls, 2, 'the kernel verify re-ran performHandoff');
    assert.equal(reviewLoopStarted, false, 'the refreshed result reaches the gatekeeper-pushback branch');
  });

  test('SC4: the kernel carries the captured gate output into the bounce', async () => {
    let promptSeen = '';
    await runHandoffAndReview(SLUG, WORKTREE, 'codex', {
      validateCheckpointsBeforeHandoffFn: () => ({ ok: true }),
      performHandoff: async () => ({
        ok: false, error: GATE_FAILURE, gateOutput: { stdout: 'gate stdout', stderr: 'gate stderr' },
      }),
      startAgentFn: async (_step: string, opts: { prompt?: unknown }) => {
        // Only the first attempt's prompt carries the original gate output; the
        // kernel replaces the diagnostic with the verify re-run's fresher one.
        if (!promptSeen) {
          const slot = opts.prompt;
          promptSeen = typeof slot === 'function' ? slot('codex') : String(slot ?? '');
        }
        return { agent: 'codex', result: { status: 0 } };
      },
      startReviewLoop: async () => {},
      log: () => {},
      error: () => {},
    });

    assert.match(promptSeen, /HANDOFF VERIFICATION FAILURE/, 'the kernel builds the fix prompt');
    assert.match(promptSeen, /gate stderr/, 'the captured gate output reaches the prompt');
  });

  test('SC4: two failed performHandoff re-runs give exactly two launches and the failure path', async () => {
    let launches = 0;
    let handoffCalls = 0;
    let reviewLoopStarted = false;
    const errors: string[] = [];
    const result = await runHandoffAndReview(SLUG, WORKTREE, 'codex', {
      validateCheckpointsBeforeHandoffFn: () => ({ ok: true }),
      performHandoff: async () => { handoffCalls++; return { ok: false, error: GATE_FAILURE }; },
      startAgentFn: async () => { launches++; return { agent: 'codex', result: { status: 0 } }; },
      startReviewLoop: async () => { reviewLoopStarted = true; },
      log: () => {},
      error: (msg: string) => errors.push(msg),
    });

    assert.equal(result, false, 'an exhausted handoff bounce strands the mission');
    assert.equal(launches, 2, 'exactly the kernel per-occurrence budget of two launches');
    assert.equal(handoffCalls, 3, 'the initial handoff plus one verify re-run per attempt');
    assert.equal(reviewLoopStarted, false, 'the review loop is never started');
    assert.ok(
      errors.some(msg => msg.includes('Automated handoff failed')),
      'the automated-handoff-failed error path is taken',
    );
  });

  test('SC4: a HumanOnly classification launches no agent and takes the repairHandoffFn branch', async () => {
    let launches = 0;
    let repairCalls = 0;
    await runHandoffAndReview(SLUG, WORKTREE, 'codex', {
      validateCheckpointsBeforeHandoffFn: () => ({ ok: true }),
      performHandoff: async () => ({
        ok: false,
        error: 'ENOSPC: no space left on device while writing the review artifact.',
      }),
      repairHandoffFn: async () => { repairCalls++; return { repaired: false, blocker: 'disk full' }; },
      startAgentFn: async () => { launches++; return { agent: 'codex', result: { status: 0 } }; },
      startReviewLoop: async () => {},
      log: () => {},
      error: () => {},
    });

    assert.equal(launches, 0, 'a HumanOnly failure never bounces');
    assert.equal(repairCalls, 1, 'the git-only repairHandoffFn branch runs instead');
  });

  test('SC4/SC8: a GitBlockers classification takes the git-only repair branch, agent-less', async () => {
    let launches = 0;
    let repairCalls = 0;
    let handoffCalls = 0;
    const result = await runHandoffAndReview(SLUG, WORKTREE, 'codex', {
      validateCheckpointsBeforeHandoffFn: () => ({ ok: true }),
      performHandoff: async () => {
        handoffCalls++;
        return handoffCalls === 1
          ? { ok: false, error: 'The worktree has uncommitted changes; commit them before handoff.' }
          : { ok: true };
      },
      repairHandoffFn: async () => { repairCalls++; return { repaired: true }; },
      startAgentFn: async () => { launches++; return { agent: 'codex', result: { status: 0 } }; },
      startReviewLoop: async () => {},
      log: () => {},
      error: () => {},
    });

    assert.equal(launches, 0, 'GitBlockers never bounce to an agent');
    assert.equal(repairCalls, 1, 'repairHandoff performs the git-only repair');
    assert.equal(result, true, 'the repaired handoff proceeds');
  });

  // ── SC5: the budget is per occurrence and nothing is persisted ──────────────

  test('SC5: a second handoff occurrence in one process starts from a full budget of two', async () => {
    const launchCounts: number[] = [];
    for (const _run of [1, 2]) {
      let launches = 0;
      await runHandoffAndReview(SLUG, WORKTREE, 'codex', {
        validateCheckpointsBeforeHandoffFn: () => ({ ok: true }),
        performHandoff: async () => ({ ok: false, error: GATE_FAILURE }),
        startAgentFn: async () => { launches++; return { agent: 'codex', result: { status: 0 } }; },
        startReviewLoop: async () => {},
        log: () => {},
        error: () => {},
      });
      launchCounts.push(launches);
    }
    assert.deepEqual(launchCounts, [2, 2], 'the second occurrence is not starved by the first');
  });

  // ── A declared checkpoint gap is agent hallucination, not infrastructure ────
  //
  // Regression: `validateCheckpointsBeforeHandoff` emits "Declared checkpoint
  // documents are missing before handoff: CP-2, …" when an agent ends its turn
  // without writing the checkpoints its own mission declared. That text matched no
  // classifier pattern and fell to the catch-all InfraBlocker/HumanOnly default,
  // so the kernel refused to bounce and the mission stranded on manual
  // instructions — even though one relaunch with the named gap fixes it. ADR 0048
  // class 4 ("Incomplete checkpoint evidence") already prescribes auto-send-back;
  // the classifier was simply missing the pattern.

  const DECLARED_GAP =
    'Declared checkpoint documents are missing before handoff: CP-2, CP-3. '
    + 'Create and commit CP-2.md, CP-3.md in /tmp/worktree-task-2377.05/missions/task-2377.05 before handoff.';

  test('a declared checkpoint gap classifies as IncompleteEvidence, not InfraBlocker', () => {
    const classified = classifyError(DECLARED_GAP);
    assert.equal(classified.failureClass, FailureClass.IncompleteEvidence);
    assert.equal(classified.dispatchAction, DispatchAction.AutoSendBack);
  });

  test('a single-checkpoint gap classifies as IncompleteEvidence too', () => {
    const classified = classifyError(
      'Declared checkpoint documents are missing before handoff: CP-2. Create and commit CP-2.md before handoff.',
    );
    assert.equal(classified.dispatchAction, DispatchAction.AutoSendBack);
  });

  test('the new rule does not reclassify real infrastructure blockers', () => {
    for (const infra of [
      'Forgejo authentication failed for the review remote.',
      'connection refused while pushing the review ref',
      'token expired',
    ]) {
      assert.equal(classifyError(infra).dispatchAction, DispatchAction.HumanOnly, infra);
    }
  });

  test('a declared checkpoint gap bounces and continues once the agent writes the checkpoints', async () => {
    let validations = 0;
    let launches = 0;
    let handoffCalls = 0;
    let reviewLoopStarted = false;
    const result = await runHandoffAndReview(SLUG, WORKTREE, 'codex', {
      validateCheckpointsBeforeHandoffFn: () => {
        validations++;
        return validations === 1 ? { ok: false, error: DECLARED_GAP, nextCheckpoint: 'CP-2' } : { ok: true };
      },
      startAgentFn: async () => { launches++; return { agent: 'codex', result: { status: 0 } }; },
      performHandoff: async () => { handoffCalls++; return { ok: true }; },
      startReviewLoop: async () => { reviewLoopStarted = true; },
      log: () => {},
      error: () => {},
    });

    assert.equal(launches, 1, 'the gap bounces to the implementer instead of stranding');
    assert.equal(handoffCalls, 1, 'the mission continues to handoff after the fix verifies');
    assert.ok(reviewLoopStarted, 'and on into the review loop');
    assert.equal(result, true);
  });
});

// TASK-2456 (was test/task-2456-handoff-retry-duplicate-lane-event.test.ts)
describe('Handoff retry lane events', () => {
  // TASK-2456 CP-1 — red reproduction of the handoff retry that a duplicate lane
  // event turns into a failure.
  //
  // `performHandoff` deliberately passes the stable idempotency key
  // `handoff-${slug}` to the review transition so the lane-event UNIQUE
  // constraint deduplicates a retried handoff
  // (`src/application/handoff-command-use-case.ts`). Once a handoff has committed
  // its `active -> review` lane event under that key, any later handoff of the
  // same mission collides with it. `MissionLifecycleService.transition` maps that
  // refusal to `failure('conflict', …)`, so the retried handoff bombs before the
  // Backlog task is synchronised to `review`.
  //
  // Fixture (mission task-2456-repro):
  //   10:00  handoff 1: active -> review, lane event key `handoff-<slug>`
  //   11:00  reviewer requests changes: review -> active
  //   12:00  implementer resolves the finding and opens round 2
  //   13:00  handoff 2: active -> review with the SAME `handoff-<slug>` key
  //
  // R1 (SC1): the 13:00 transition is a replay of the `active -> review`
  // transition already recorded under that key, so it must return `completed`
  // with `to === 'review'`. RED on the parent commit: it returns
  // `failure('conflict', 'Duplicate idempotency key: handoff-…')`.
  //
  // R2 (SC2): reusing the same key for a genuinely distinct transition
  // (`review -> integration` via `approve`) is not a replay of anything recorded
  // under that key, so it must remain a `conflict`.



  const HANDOFF_1_AT = '2026-02-01T10:00:00Z';
  const CHANGES_REQUESTED_AT = '2026-02-01T11:00:00Z';
  const RESOLVED_AT = '2026-02-01T12:00:00Z';
  const HANDOFF_2_AT = '2026-02-01T13:00:00Z';
  const APPROVED_AT = '2026-02-01T14:00:00Z';

  const implementer = agentFamily('configured-implementer');
  const reviewer = agentFamily('configured-reviewer');
  const reviewerEligibility = ConfiguredReviewerEligibility.fromReviewStep({
    eligible: [reviewer],
    strategy: 'random',
  });
  const pullRequest: ReviewedChange = {
    kind: 'pull-request',
    provider: 'forgejo',
    id: '2456',
    url: null,
    sourceBranch: 'mission/task-2456',
    targetBranch: 'main',
  };

  interface Fixture extends MigratedMissionStore {
    readonly lifecycle: MissionLifecycleService;
    readonly slug: string;
  }

  async function openFixture(slug: string): Promise<Fixture> {
    const migrated = await openMigratedMissionStore([
      fixtureMission(slug, { title: 'Task 2456 repro', assignee: implementer }),
    ]);
    return { ...migrated, lifecycle: new MissionLifecycleService(migrated.store), slug };
  }

  async function currentVersion(fixture: Fixture): Promise<MissionVersion> {
    const loaded = await fixture.store.load(missionId(fixture.slug));
    assert.equal(loaded.kind, 'found');
    if (loaded.kind !== 'found') { throw new Error(`mission ${fixture.slug} is not recorded`); }
    return loaded.version;
  }

  async function currentReview(fixture: Fixture): Promise<Review> {
    const loaded = await fixture.store.load(missionId(fixture.slug));
    assert.equal(loaded.kind, 'found');
    const review = loaded.kind === 'found' ? loaded.mission.review : null;
    assert.ok(review, 'the persisted mission carries a review');
    return review;
  }

  /** Hand off the mission for review under the stable `handoff-<slug>` key. */
  async function handOff(fixture: Fixture, review: Review, occurredAt: string) {
    return fixture.lifecycle.transition({
      operationId: `handoff-transition-${fixture.slug}`,
      missionId: missionId(fixture.slug),
      expectedVersion: await currentVersion(fixture),
      capabilities: new Set(['mission:transition' as const]),
      command: { type: 'submit-for-review', gatesPassed: true, review, reviewerEligibility },
      actor: reviewer,
      occurredAt,
      idempotencyKey: `handoff-${fixture.slug}`,
    });
  }

  test('a retried handoff replays its already recorded active -> review lane event instead of conflicting', async () => {
    const fixture = await openFixture('task-2456-retry');
    try {
      // 10:00 — the first handoff commits `active -> review` together with the
      // lane event keyed `handoff-<slug>`.
      const firstHandoff = await handOff(
        fixture,
        startReview(
          { change: pullRequest, revision: changeRevision('rev-round-1') },
          reviewer,
          implementer,
          HANDOFF_1_AT,
          reviewerEligibility,
        ),
        HANDOFF_1_AT,
      );
      assert.equal(firstHandoff.status, 'completed', 'the first handoff enters review');

      // 11:00 — the reviewer requests changes, so the mission returns to active.
      const finding = {
        id: reviewFindingId('F1'),
        summary: 'Fix the duplicate lane-event handling',
        location: null,
      };
      const changesRequested = await fixture.lifecycle.transition({
        operationId: `request-changes-${fixture.slug}`,
        missionId: missionId(fixture.slug),
        expectedVersion: await currentVersion(fixture),
        capabilities: new Set(['mission:transition' as const]),
        command: {
          type: 'request-changes',
          review: applyReviewerCommand(await currentReview(fixture), {
            type: 'request-changes',
            decidedAt: CHANGES_REQUESTED_AT,
            comment: null,
            findings: [finding],
          }),
        },
        actor: reviewer,
        occurredAt: CHANGES_REQUESTED_AT,
      });
      assert.equal(changesRequested.status, 'completed', 'the mission returns to active');

      // 12:00 — the implementer resolves the finding and opens round 2.
      const resolved = applyImplementerCommand(await currentReview(fixture), {
        type: 'submit-resolution',
        respondedAt: RESOLVED_AT,
        resultingRevision: changeRevision('rev-round-2'),
        resolutions: [{ findingId: finding.id, kind: 'fixed', evidence: 'Fixed in round 2.' }],
      });
      const roundTwo = beginNextReviewRound(
        resolved,
        reviewer,
        implementer,
        HANDOFF_2_AT,
        reviewerEligibility,
      );

      // 13:00 — the retried handoff reuses the stable key. Its `active -> review`
      // transition is already recorded under that key, so this is a replay.
      const retriedHandoff = await handOff(fixture, roundTwo, HANDOFF_2_AT);
      assert.equal(
        retriedHandoff.status,
        'completed',
        `retried handoff must complete, got ${retriedHandoff.status}: ${retriedHandoff.error?.message ?? ''}`,
      );
      assert.equal(retriedHandoff.value?.to, 'review', 'the replay lands the mission in review');
      assert.equal(
        retriedHandoff.value?.version,
        await currentVersion(fixture),
        'the returned version is the persisted one',
      );

      const loaded = await fixture.store.load(missionId(fixture.slug));
      assert.equal(
        loaded.kind === 'found' ? loaded.mission.status : null,
        'review',
        'the persisted mission reached review so the Backlog sync can run',
      );

      const events = await fixture.database.query<{ from_status: string | null; to_status: string }>(
        'SELECT from_status, to_status FROM board_lane_events WHERE idempotency_key = ?',
        [`handoff-${fixture.slug}`],
      );
      assert.equal(events.length, 1, 'the stable key still records exactly one lane event');
    } finally {
      await fixture.close();
    }
  });

  test('a duplicate handoff key on a distinct approve transition stays a conflict', async () => {
    const fixture = await openFixture('task-2456-distinct');
    try {
      const firstHandoff = await handOff(
        fixture,
        startReview(
          { change: pullRequest, revision: changeRevision('rev-round-1') },
          reviewer,
          implementer,
          HANDOFF_1_AT,
          reviewerEligibility,
        ),
        HANDOFF_1_AT,
      );
      assert.equal(firstHandoff.status, 'completed', 'the first handoff enters review');

      // `review -> integration` is a different transition from the one recorded
      // under `handoff-<slug>`, so reusing that key is a genuine collision.
      const approved = await fixture.lifecycle.transition({
        operationId: `approve-${fixture.slug}`,
        missionId: missionId(fixture.slug),
        expectedVersion: await currentVersion(fixture),
        capabilities: new Set(['mission:transition' as const]),
        command: {
          type: 'approve',
          review: applyReviewerCommand(await currentReview(fixture), {
            type: 'approve',
            decidedAt: APPROVED_AT,
            comment: null,
            source: { kind: 'local' },
          }),
        },
        actor: reviewer,
        occurredAt: APPROVED_AT,
        idempotencyKey: `handoff-${fixture.slug}`,
      });
      assert.equal(approved.status, 'failed', 'a non-replay duplicate key is refused');
      assert.equal(approved.error?.kind, 'conflict', 'the refusal is reported as a conflict');

      const loaded = await fixture.store.load(missionId(fixture.slug));
      assert.equal(
        loaded.kind === 'found' ? loaded.mission.status : null,
        'review',
        'the refused transition left the mission untouched',
      );
    } finally {
      await fixture.close();
    }
  });
});

// TASK-2392 (was test/task-2392-active-lane-repro.test.ts)
describe('Active lane projection', () => {
  const id = missionId('task-2392');
  const repo = repositoryId('task-2392-repro');

  function task(status: string, title: string, labels: string, assignee: string): string {
    return `---\nid: TASK-2392\ntitle: ${title}\nstatus: ${status}\nassignee: [${assignee}]\nlabels: [${labels}]\n---\n`;
  }

  test('task-2392: active task appears in active stage, not backlog', async () => {
    const root = registeredMkdtemp('px-2392-');
    const base = path.join(root, 'base');
    const worktree = path.join(root, 'worktree');
    const writeTask = (dir: string, content: string) => {
      const file = path.join(dir, 'backlog', 'tasks', 'task-2392 - test.md');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content, 'utf8');
      return file;
    };
    writeTask(base, task('active', 'authoritative title', 'bug', 'codex'));
    writeTask(worktree, task('backlog', 'worktree description wins', 'ai_sdlc, bug', 'custom'));

    try {
      const adapter = new ConcreteMissionReadAdapter({
        rootDir: worktree,
        repositoryId: repo,
        getTaskStorage: (dir = worktree) => ({
          tasksDir: path.join(dir, 'backlog', 'tasks'),
          completedDir: path.join(dir, 'backlog', 'completed'),
          archiveTasksDir: path.join(dir, 'backlog', 'archive', 'tasks'),
        }),
        findMissionDir: () => null,
        findCheckpoints: () => [],
        resolveWorktree: () => worktree,
        resolveBaseWorktree: () => base,
      });
      const materialized = await adapter.loadMission(id);
      assert.ok(materialized, 'mission did not materialize');
      assert.equal(materialized.status, 'active');

      const card = projectMissionCard(materialized, {
        latestGate: 'unknown', reviewApproval: null, currentWork: null, blockingReason: null, flags: [],
      });
      const projection = buildBoardProjection(
        repo, [card], [], [],
        buildBoardMetrics({
          cumulativeFlow: { series: [], missingHistoryFallback: 'skip' },
          medianStateTimes: { series: [], missingHistoryFallback: 'skip' },
          throughput: { series: [], missingHistoryFallback: 'skip' },
          reviewBounceRate: { series: [], missingHistoryFallback: 'skip' },
        }), [],
      );

      const idsIn = (lane: 'active' | 'backlog') => projection.stages
        .find((stage) => stage.lane === lane)!.cards
        .filter((candidate) => candidate.id === id);
      assert.equal(idsIn('active').length, 1);
      assert.equal(idsIn('backlog').length, 0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
