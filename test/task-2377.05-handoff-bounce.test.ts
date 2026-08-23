// ---------------------------------------------------------------------------
// TASK-2377.05 — the two `px active` handoff bounces run through the rebound
// kernel (SC3 checkpoint validation, SC4 handoff failure, SC8 git-only repair).
//
// `runHandoffAndReview` is exercised directly with every boundary injected:
// checkpoint validation, `performHandoff`, `repairHandoff`, the review loop,
// and the agent launch seam are all mocks. No agent, git, LLM, or Forgejo is
// involved.
// ---------------------------------------------------------------------------
import test from 'node:test';
import assert from 'node:assert/strict';
import { runHandoffAndReview } from '../src/adapters/cli/commands/active.js';
import { classifyError, FailureClass, DispatchAction } from '../src/application/failure-classification.js';

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
