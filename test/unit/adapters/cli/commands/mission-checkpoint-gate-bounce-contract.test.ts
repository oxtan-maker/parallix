import type { ExecuteReviewPreparationPorts, ExecuteReviewPreparationRequest } from '../../../../../src/application/execute-review-preparation-service.js';
// Historical regression provenance: TASK-2215, TASK-2581.
// Mission checkpoint gate bounce contract: missing or invalid checkpoint evidence is repairable and
// relaunches the agent within a bounded budget.
//
// Behavior-owned suite (TASK-2622.07). Legacy case names are unchanged; provenance TASK-2261
// (was test/task-2261-checkpoint-gates-repro.test.ts).
// Reproduction test for task-2261: checkpoint gates bouncing not working.
//
// Models a completed execute phase whose mission directory contains no CP-N.md
// and asserts that handoff classifies it as a repairable incomplete-evidence
// failure and launches a targeted repair flow rather than only emitting the
// stranded manual instruction.
//
// This test must be RED at the mission parent commit and GREEN after the repair.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { mock, describe } from 'node:test';
import { mkdtemp as registeredMkdtemp } from '../../../../helpers/temp-dir.js';
import { mockModule, installModuleMocks } from '../../../../lib/module-mock.js';
import { ExecuteReviewPreparationService } from '../../../../../src/application/execute-review-preparation-service.js';
import { classifyError } from '../../../../../src/application/failure-classification.js';
import { isRelaunchableError } from '../../../../../src/adapters/cli/commands/repair-review-preparation.js';

// ── Checkpoint gate bounce — TASK-2261 ──
const repairReviewPreparation = mockModule<typeof import('../../../../../src/adapters/cli/commands/repair-review-preparation.js')>('../../../../../src/adapters/cli/commands/repair-review-preparation.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
interface BounceOptions {
  validateCheckpointsBeforeReviewPreparationFn?: (slug: string, worktree: string, output: Partial<Pick<ExecuteReviewPreparationPorts['output'], 'log' | 'error'>>) => Awaited<ReturnType<ExecuteReviewPreparationPorts['checkpoints']["validateBeforeReviewPreparation"]>>;
  performReviewPreparation?: (slug: string, options: { forgejoUser: string; worktree: string; force?: boolean }) => ReturnType<ExecuteReviewPreparationPorts['reviewPreparation']['run']>;
  repairReviewPreparationFn?: (slug: string, worktree: string, error: string, options: { taskFile: string | null; log: (message: string) => void; error: (message: string) => void }) => Promise<{ repaired: boolean; blocker?: string | null }>;
  startAgentFn?: (step: string, options: Parameters<ExecuteReviewPreparationPorts['repairLaunch']['launch']>[0] & { role: 'implementer' }) => ReturnType<ExecuteReviewPreparationPorts['repairLaunch']['launch']>;
  startReviewLoop?: (slug: string, options: Parameters<ExecuteReviewPreparationPorts['review']['start']>[0] & { skipReviewPreparation: true }) => void | Promise<void>;
  workflowLauncherStatusFn?: ExecuteReviewPreparationPorts['repairLaunch']['available'];
  log?: ExecuteReviewPreparationPorts['output']['log'];
  error?: ExecuteReviewPreparationPorts['output']['error'];
  taskFile?: string | null;
  onAgentLaunched?: ExecuteReviewPreparationRequest['onAgentLaunched'];
  onAutonomousStop?: ExecuteReviewPreparationRequest['onAutonomousStop'];
}
const runReviewPreparationAndReview = async (slug: string, worktree: string, agent: string, options: BounceOptions = {}) => {
  const validate = options.validateCheckpointsBeforeReviewPreparationFn ?? (() => ({ ok: true as const }));
  const reviewPreparation = options.performReviewPreparation ?? (async () => ({ ok: true as const }));
  const repair: NonNullable<BounceOptions["repairReviewPreparationFn"]> = options.repairReviewPreparationFn ?? (async () => ({ repaired: false }));
  const launch = options.startAgentFn ?? (async () => ({}));
  return new ExecuteReviewPreparationService({
    checkpoints: { async validateBeforeReviewPreparation(request) { return validate(slug, worktree, { log: request.log, error: request.error }); } },
    reviewPreparation: {
      async run(request) { return reviewPreparation(slug, { forgejoUser: agent, worktree, force: request.force }); },
      async repairHygiene(request) { const result = await repair(slug, worktree, request.error, { taskFile: request.taskFile, log: request.log, error: request.outputError }); return { ...result, blocker: result.blocker ?? undefined }; },
    },
    review: { async start(request) { await options.startReviewLoop?.(slug, { slug, implementer: agent, worktree, skipReviewPreparation: true, onAgentLaunched: request.onAgentLaunched, onAutonomousStop: request.onAutonomousStop }); } },
    repairLaunch: {
      available: options.workflowLauncherStatusFn ?? (() => ({ supported: true })),
      readHead() { return null; },
      async launch(request) { return launch('active', { prompt: request.prompt, worktree, agent, slug, role: 'implementer', sessionPolicy: request.sessionPolicy }); },
    },
    output: { log: options.log ?? (() => {}), error: options.error ?? (() => {}), command: (value) => value, formatSlug: (value) => value, formatAgent: (value) => value },
  }).run({ slug, worktree, agent, taskFile: options.taskFile ?? null, onAgentLaunched: options.onAgentLaunched, onAutonomousStop: options.onAutonomousStop });
};

// ── CP-1: Missing checkpoint → repairable relaunch (not stranded instruction) ──

test("missing checkpoint: runReviewPreparationAndReview classifies as repairable and relaunches agent instead of stranding", async () => {
  const slug = 'task-2261';
  const worktree = '/tmp/worktree-task-2261';
  const logs: string[] = [];
  const errors: string[] = [];
  let relaunchCalled = false;
  let relaunchPrompt = null;
  let performReviewPreparationCallCount = 0;

  const result = await runReviewPreparationAndReview(slug, worktree, 'codex', {
    validateCheckpointsBeforeReviewPreparationFn: () => ({ failureReason: { version: 1, code: 'incomplete-evidence', source: 'review-preparation' },
      ok: false as const,
      error: `No checkpoint documents found in /tmp/worktree-task-2261/missions/task-2261. The execute agent must create checkpoint documents (CP-N.md) with a Goal Check table before review preparation. Create at least CP-1 documenting your implementation, including a Goal Check table with real evidence such as a backticked command, test name, ADR reference, or test file path.`
    }),
    performReviewPreparation: async () => {
      performReviewPreparationCallCount++;
      return { failureReason: { version: 1, code: 'infrastructure', source: 'review-preparation' }, ok: false as const, error: 'still missing' };
    },
    startAgentFn: async (_step, opts) => {
      relaunchCalled = true;
      // TASK-2377.05: the kernel builds the fix prompt and hands it to the port.
      relaunchPrompt = opts.prompt;
      // Simulate the launch succeeding but the checkpoint still not created
      return { agent: 'codex', result: { status: 0 } };
    },
    repairReviewPreparationFn: async () => ({ repaired: false, blocker: null }),
    startReviewLoop: () => {},
    log: (msg) => logs.push(msg),
    error: (msg) => errors.push(msg)
  });

  // The key assertion: missing checkpoints should trigger a relaunch,
  // not just print manual instructions and return false immediately.
  assert.equal(relaunchCalled, true,
    'Missing checkpoint should trigger an agent relaunch (repair bounce), not just emit stranded manual instructions');
});

test('missing checkpoint: classifyError recognizes missing-checkpoint message as IncompleteEvidence', () => {
  const { classifyError, FailureClass } = repairReviewPreparation;
  const errorMsg = "No checkpoint documents found in /tmp/worktree/missions/task-2261. The execute agent must create checkpoint documents (CP-N.md) with a Goal Check table before review preparation. Create at least CP-1 documenting your implementation, including a Goal Check table with real evidence such as a backticked command, test name, ADR reference, or test file path.";

  const result = classifyError(errorMsg, { version: 1, code: 'incomplete-evidence', source: 'review-preparation' });

  assert.ok(
    result.failureClass === FailureClass.IncompleteEvidence || result.failureClass === FailureClass.MissingArtifacts,
    `Missing checkpoint should be classified as IncompleteEvidence or MissingArtifacts, got ${result.failureClass}`
  );
  assert.equal(result.dispatchAction, 'AutoSendBack',
    'Missing checkpoint should dispatch AutoSendBack for agent relaunch');
});

// ── CP-2: Checkpoint missing Goal Check table → repairable relaunch ──

test('checkpoint missing Goal Check: classifyError recognizes as IncompleteEvidence', () => {
  const { classifyError, FailureClass } = repairReviewPreparation;
  const errorMsg = "The final checkpoint at missions/task-2261/CP-1.md is missing a \"## Goal Check\" section. Review requires a goal-check table with real evidence before review preparation.";

  const result = classifyError(errorMsg, { version: 1, code: 'incomplete-evidence', source: 'review-preparation' });

  assert.equal(result.failureClass, FailureClass.IncompleteEvidence,
    'Missing Goal Check section should be classified as IncompleteEvidence');
  assert.equal(result.dispatchAction, 'AutoSendBack',
    'Missing Goal Check should dispatch AutoSendBack for agent relaunch');
});

// ── CP-3: Retry lifecycle outcomes ──

test("valid repaired checkpoint: runReviewPreparationAndReview unblocks review preparation after relaunch creates valid checkpoint", async () => {
  const slug = 'task-2261';
  const worktree = '/tmp/worktree-task-2261';
  let reviewPreparationAttempts = 0;
  let relaunchCount = 0;
  let reviewLoopCalled = false;

  const result = await runReviewPreparationAndReview(slug, worktree, 'codex', {
    validateCheckpointsBeforeReviewPreparationFn: () => ({ ok: true as const }),
    performReviewPreparation: async () => {
      reviewPreparationAttempts++;
      if (reviewPreparationAttempts === 1) {
        return { failureReason: { version: 1, code: 'incomplete-evidence', source: 'review-preparation' }, ok: false as const, error: "The final checkpoint at missions/task-2261/CP-1.md has a \"## Goal Check\" section but no evidence rows. A goal-check table with real evidence is required before review preparation." };
      }
      return { ok: true as const };
    },
    startAgentFn: async () => {
      relaunchCount++;
      return { agent: 'codex', result: { status: 0 } };
    },
    repairReviewPreparationFn: async () => ({ repaired: false, blocker: null }),
    startReviewLoop: () => { reviewLoopCalled = true; },
    log: () => {},
    error: () => {}
  });

  assert.equal(result, true, "ReviewPreparation should succeed after agent relaunch creates valid checkpoint");
  assert.ok(reviewPreparationAttempts >= 2, "ReviewPreparation should be retried after relaunch");
  assert.ok(relaunchCount >= 1, 'Agent relaunch should be attempted');
  assert.ok(reviewLoopCalled, "Review loop should be started after successful review preparation");
});

test("exhaustion: runReviewPreparationAndReview stops after bounded relaunch attempts without submitting review", async () => {
  const slug = 'task-2261';
  const worktree = '/tmp/worktree-task-2261';
  let reviewPreparationAttempts = 0;
  let relaunchCount = 0;
  let reviewLoopCalled = false;

  const result = await runReviewPreparationAndReview(slug, worktree, 'codex', {
    validateCheckpointsBeforeReviewPreparationFn: () => ({ ok: true as const }),
    performReviewPreparation: async () => {
      reviewPreparationAttempts++;
      return { failureReason: { version: 1, code: 'incomplete-evidence', source: 'review-preparation' }, ok: false as const, error: "The final checkpoint at missions/task-2261/CP-1.md has a \"## Goal Check\" section but no evidence rows. A goal-check table with real evidence is required before review preparation." };
    },
    startAgentFn: async () => {
      relaunchCount++;
      return { agent: 'codex', result: { status: 0 } };
    },
    repairReviewPreparationFn: async () => ({ repaired: false, blocker: null }),
    startReviewLoop: () => { reviewLoopCalled = true; },
    log: () => {},
    error: () => {}
  });

  assert.equal(result, false, "ReviewPreparation should fail after exhaustion");
  assert.ok(!reviewLoopCalled, 'Review loop should NOT be called when exhaustion is reached');
  assert.ok(relaunchCount >= 2, 'Should attempt at least 2 relaunches before exhaustion');
});

// ── CP-3: Missing checkpoint path — relaunch then unblocks or exhausts ──

test("missing checkpoint: valid CP after relaunch unblocks review preparation and starts review loop", async () => {
  // Deterministic filesystem fixture: creates a real CP-1.md with Goal Check table
  // and one evidence row per mission criterion, then verifies the validation path accepts it.
  const tmpRoot = registeredMkdtemp('task-2261-valid-cp-');
  const slug = 'task-2261';
  const missionDir = path.join(tmpRoot, 'missions', slug);
  fs.mkdirSync(missionDir, { recursive: true });
  // Initially: no checkpoint files
  let reviewPreparationAttempts = 0;
  let relaunchCount = 0;
  let reviewLoopCalled = false;
  let checkpointCreated = false;

  const result = await runReviewPreparationAndReview(slug, tmpRoot, 'codex', {
    validateCheckpointsBeforeReviewPreparationFn: (s, w) => {
      // Real filesystem check: look for CP-*.md files with Goal Check content
      const cpFiles = fs.readdirSync(missionDir).filter(f => /^CP-\d+\.md$/.test(f));
      if (cpFiles.length === 0) {
        return { failureReason: { version: 1 as const, code: 'incomplete-evidence' as const }, ok: false as const, error: 'No checkpoint documents found in ' + missionDir + ". The execute agent must create checkpoint documents (CP-N.md) with a Goal Check table before review preparation." };
      }
      // Validate Goal Check table is present in the latest checkpoint
      const latestCp = cpFiles.sort().pop();
      assert.ok(latestCp);
      const cpContent = fs.readFileSync(path.join(missionDir, latestCp), 'utf8');
      if (!/## Goal Check/.test(cpContent) || !/\| Criterion \| Evidence \| Status \|/.test(cpContent)) {
        return { ok: false as const, error: 'Checkpoint ' + latestCp + ' is missing a valid ## Goal Check table.' };
      }
      // Check for at least one evidence row
      const evidenceRows = cpContent.split('\n').filter(l => /^\|/.test(l) && !/Criterion/.test(l) && !/^\|-+\|/.test(l));
      if (evidenceRows.length === 0) {
        return { ok: false as const, error: 'Checkpoint ' + latestCp + ' has a ## Goal Check section but no evidence rows.' };
      }
      return { ok: true as const };
    },
    performReviewPreparation: async () => {
      reviewPreparationAttempts++;
      return { ok: true as const };
    },
    startAgentFn: async () => {
      relaunchCount++;
      // On the first launch, create a real CP-1.md with a Goal Check table
      if (!checkpointCreated) {
        checkpointCreated = true;
        fs.writeFileSync(path.join(missionDir, 'CP-1.md'),
`# CP-1: Valid checkpoint with Goal Check evidence

## Summary
Checkpoint created after targeted repair relaunch.

## Goal Check

| Criterion | Evidence | Status |
|---|---|---|
| Deterministic regression test reproduces execute-complete mission with no checkpoint | test/task-2261-checkpoint-gates-repro.test.ts:20 — "missing checkpoint: runReviewPreparationAndReview classifies as repairable and relaunches agent" | PASS |
| ReviewPreparation classifies missing CP-N.md and missing Goal Check as IncompleteEvidence | test/task-2261-checkpoint-gates-repro.test.ts:58 — classifyError test; test/task-2261-checkpoint-gates-repro.test.ts:89 — Goal Check classifyError test | PASS |
| Targeted relaunch names CP-N.md, requires ## Goal Check and table columns, supplies px review --submit | test/task-2261-checkpoint-gates-repro.test.ts:72 — captured repair prompt | PASS |
| Valid checkpoint with one evidence row per criterion unblocks automated review preparation retry | test/task-2261-checkpoint-gates-repro.test.ts:178 — "missing checkpoint: valid CP after relaunch unblocks review preparation" | PASS |
| Repeated absent evidence reaches configured retry/exhaustion boundary without review submission | test/task-2261-checkpoint-gates-repro.test.ts:258 — "missing checkpoint: still absent after relaunch returns false" (asserts relaunchCount === 2) | PASS |
| Focused tests and verify-local.sh all pass | npm test -- test/task-2261-checkpoint-gates-repro.test.ts (12 tests); ./scripts/verify-local.sh all (1330 tests) | PASS |
`, 'utf8');
      }
      return { agent: 'codex', result: { status: 0 } };
    },
    repairReviewPreparationFn: async () => ({ repaired: false, blocker: null }),
    startReviewLoop: () => { reviewLoopCalled = true; },
    log: () => {},
    error: () => {}
  });

  assert.equal(result, true, "ReviewPreparation should succeed after agent creates valid checkpoint with Goal Check");
  assert.equal(relaunchCount, 1, 'Should attempt exactly 1 relaunch (checkpoint valid after first)');
  assert.ok(checkpointCreated, 'Agent relaunch should have created a real CP-1.md');
  assert.ok(fs.existsSync(path.join(missionDir, 'CP-1.md')), 'CP-1.md file should exist on disk');
  const cpContent = fs.readFileSync(path.join(missionDir, 'CP-1.md'), 'utf8');
  assert.ok(/## Goal Check/.test(cpContent), 'CP-1.md should contain ## Goal Check heading');
  assert.ok(/\| Criterion \| Evidence \| Status \|/.test(cpContent), 'CP-1.md should contain the 3-column table header');
  const evidenceRows = cpContent.split('\n').filter(l => /^\|/.test(l) && !/Criterion/.test(l) && !/^\|-+\|/.test(l));
  assert.equal(evidenceRows.length, 6, 'CP-1.md should have exactly 6 evidence rows (one per mission Success Criterion)');
  assert.equal(reviewPreparationAttempts, 1, "performReviewPreparation should be called once after validation passes");
  assert.ok(reviewLoopCalled, "Review loop should be started after successful review preparation");

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('missing checkpoint: still absent after relaunch returns false with manual instruction', async () => {
  const slug = 'task-2261';
  const worktree = '/tmp/worktree-task-2261';
  let reviewPreparationAttempts = 0;
  let relaunchCount = 0;
  let reviewLoopCalled = false;
  const errors: string[] = [];

  const result = await runReviewPreparationAndReview(slug, worktree, 'codex', {
    validateCheckpointsBeforeReviewPreparationFn: () => ({ failureReason: { version: 1, code: 'incomplete-evidence', source: 'review-preparation' },
      ok: false as const,
      error: "No checkpoint documents found in /tmp/worktree-task-2261/missions/task-2261. The execute agent must create checkpoint documents (CP-N.md) with a Goal Check table before review preparation."
    }),
    performReviewPreparation: async () => {
      reviewPreparationAttempts++;
      return { failureReason: { version: 1, code: 'infrastructure', source: 'review-preparation' }, ok: false as const, error: 'still missing' };
    },
    startAgentFn: async () => {
      relaunchCount++;
      return { agent: 'codex', result: { status: 0 } };
    },
    repairReviewPreparationFn: async () => ({ repaired: false, blocker: null }),
    startReviewLoop: () => { reviewLoopCalled = true; },
    log: () => {},
    error: (msg) => errors.push(msg)
  });

  assert.equal(result, false, 'Should return false when checkpoint still missing after bounded relaunches');
  assert.equal(relaunchCount, 2, 'Should attempt 2 relaunches (bounded retry) before exhaustion');
  assert.equal(reviewPreparationAttempts, 0, "performReviewPreparation should NOT be called when validation still fails");
  assert.ok(!reviewLoopCalled, 'Review loop should NOT be called');
  assert.ok(errors.some(e => e.includes('Create a checkpoint document')), 'Should emit manual instruction');
  assert.ok(errors.some(e => e.includes('px review task-2261 --submit')), 'Should include retry command');
});

test('missing checkpoint: relaunch failure returns false with manual instruction', async () => {
  const slug = 'task-2261';
  const worktree = '/tmp/worktree-task-2261';
  let reviewPreparationAttempts = 0;
  let relaunchCount = 0;
  let reviewLoopCalled = false;
  const errors: string[] = [];

  const result = await runReviewPreparationAndReview(slug, worktree, 'codex', {
    validateCheckpointsBeforeReviewPreparationFn: () => ({ failureReason: { version: 1, code: 'incomplete-evidence', source: 'review-preparation' },
      ok: false as const,
      error: "No checkpoint documents found in /tmp/worktree-task-2261/missions/task-2261. The execute agent must create checkpoint documents (CP-N.md) with a Goal Check table before review preparation."
    }),
    performReviewPreparation: async () => {
      reviewPreparationAttempts++;
      return { failureReason: { version: 1, code: 'infrastructure', source: 'review-preparation' }, ok: false as const, error: 'still missing' };
    },
    startAgentFn: async () => {
      relaunchCount++;
      throw new Error('agent launcher not available');
    },
    repairReviewPreparationFn: async () => ({ repaired: false, blocker: null }),
    startReviewLoop: () => { reviewLoopCalled = true; },
    log: () => {},
    error: (msg) => errors.push(msg)
  });

  assert.equal(result, false, 'Should return false when relaunch fails');
  // TASK-2377.05 (SC5): the rebound kernel's per-occurrence budget is 2, and a
  // failed launch consumes an attempt rather than aborting the bounce.
  assert.equal(relaunchCount, 2, 'Should spend the kernel budget of 2 launch attempts');
  assert.equal(reviewPreparationAttempts, 0, "performReviewPreparation should NOT be called when relaunch fails");
  assert.ok(!reviewLoopCalled, 'Review loop should NOT be called');
  assert.ok(errors.some(e => e.includes('Create a checkpoint document')), 'Should emit manual instruction');
});

// ── Dirty checkpoint regression: GitBlockers do NOT enter the IncompleteEvidence relaunch loop ──

test('dirty checkpoint: GitBlockers classification does NOT enter the IncompleteEvidence relaunch loop', async () => {
  const slug = 'task-2261';
  const worktree = '/tmp/worktree-task-2261';
  let reviewPreparationAttempts = 0;
  let relaunchCount = 0;
  let reviewLoopCalled = false;
  const errors: string[] = [];

  const result = await runReviewPreparationAndReview(slug, worktree, 'codex', {
    validateCheckpointsBeforeReviewPreparationFn: () => ({ failureReason: { version: 1, code: 'infrastructure', source: 'review-preparation' },
      ok: false as const,
      error: "Checkpoint documents must be committed before review preparation. Uncommitted checkpoint files: CP-1.md. Commit the checkpoint update and re-run the review preparation."
    }),
    performReviewPreparation: async () => {
      reviewPreparationAttempts++;
      return { failureReason: { version: 1, code: 'infrastructure', source: 'review-preparation' }, ok: false as const, error: 'still dirty' };
    },
    startAgentFn: async () => {
      relaunchCount++;
      return { agent: 'codex', result: { status: 0 } };
    },
    repairReviewPreparationFn: async () => ({ repaired: false, blocker: null }),
    startReviewLoop: () => { reviewLoopCalled = true; },
    log: () => {},
    error: (msg) => errors.push(msg)
  });

  // Dirty checkpoint error is NOT IncompleteEvidence — it should NOT trigger
  // the targeted relaunch loop. Returns false immediately with manual instruction.
  assert.equal(result, false, 'Should return false for dirty checkpoint (not IncompleteEvidence)');
  assert.equal(relaunchCount, 0, 'Should NOT attempt any relaunches for non-IncompleteEvidence errors');
  assert.equal(reviewPreparationAttempts, 0, "performReviewPreparation should NOT be called");
  assert.ok(!reviewLoopCalled, 'Review loop should NOT be called');
});

test('dirty checkpoint: classifyError does NOT classify uncommitted checkpoint as IncompleteEvidence', () => {
  const { classifyError, FailureClass } = repairReviewPreparation;
  const errorMsg = "Checkpoint documents must be committed before review preparation. Uncommitted checkpoint files: CP-1.md. Commit the checkpoint update and re-run the review preparation.";

  const result = classifyError(errorMsg, { version: 1, code: 'infrastructure', source: 'review-preparation' });

  assert.notEqual(result.failureClass, FailureClass.IncompleteEvidence,
    'Dirty checkpoint should NOT be classified as IncompleteEvidence (got ' + result.failureClass + ')');
});

// ── Missing checkpoint error classification — TASK-2215 (was 2215.ts) ──
describe("Missing checkpoint error classification —", () => {
  const { classifyError, FailureClass, DispatchAction } = repairReviewPreparation;

  // Reproduction tests for task-2215 (missing error bounce).
  //
  // When automated handoff cannot find checkpoint documents even after
  // auto-remediation (handoff.ts emits "No checkpoint documents found in ...
  // even after auto-remediation."), ADR 0048 prescribes MissingArtifacts →
  // AutoSendBack so the implementer agent is relaunched with a repair prompt.
  // Before the fix, this message fell through classifyError's patterns to the
  // default InfraBlocker/HumanOnly, stranding the task on manual intervention.

  const autoRemediationError =
    'No checkpoint documents found in /home/magnus/code/parallix-task-2213/missions/task-2213 ' +
    'even after auto-remediation. Implementation evidence is mandatory for review.';

  test('task-2215 repro: classifyError classifies auto-remediation checkpoint failure as MissingArtifacts/AutoSendBack', () => {
    const result = classifyError(autoRemediationError, { version: 1, code: 'missing-artifacts', source: 'review-preparation' });
    assert.equal(result.failureClass, FailureClass.MissingArtifacts,
      'auto-remediation failure must be MissingArtifacts per ADR 0048, not InfraBlocker');
    assert.equal(result.dispatchAction, DispatchAction.AutoSendBack,
      'auto-remediation failure must auto-send-back to the implementer, not require a human');
  });

  test('missing checkpoint evidence is sent back without generating placeholders', () => {
    const result = classifyError("No checkpoint documents found in missions/task-2521.06. Import historical evidence or record it with px checkpoint record; review preparation never generates evidence.", { version: 1, code: 'missing-artifacts', source: 'review-preparation' });
    assert.equal(result.failureClass, FailureClass.MissingArtifacts);
    assert.equal(result.dispatchAction, DispatchAction.AutoSendBack);
  });
});

// ── Typed checkpoint recovery advice — TASK-2581 (was 2581.ts) ──
// Regression coverage for typed-mission recovery advice. Both paths use
// injected boundaries: no agent process, network service, or Mission write is
// involved.
describe("Typed checkpoint recovery advice —", () => {
  const slug = 'task-2581';
  const worktree = '/tmp/worktree-task-2581';
  const typedCheckpointFailure = "Planned checkpoint evidence is missing before review preparation: CP-2. Record each with `px checkpoint record --name <CP-N>` before review preparation.";

  function assertRecordedCheckpointRecoveryAdvice(prompt: string) {
    assert.match(prompt, /px status task-2581/, 'recovery reloads the recorded Mission contract');
    assert.match(prompt, /px checkpoint record --name CP-2/, 'recovery records the named missing checkpoint');
    assert.match(prompt, /resolves its own current version/, 'recovery resolves the current version automatically');
    assert.match(prompt, /every declared gate passes/, 'typed recovery retains the mission gate completion requirement');
    assert.match(prompt, /only evidence from work and verification actually performed/, 'recording evidence requires real implementation and verification');
    assert.doesNotMatch(prompt, /(?:Create|Fix|Update) (?:a |the )?(?:final )?checkpoint document/i, 'typed recovery must not create a legacy checkpoint document');
    assert.doesNotMatch(prompt, /Create (?:a )?CP-(?:N|2)\.md/i, 'typed recovery must not create a legacy checkpoint template');
  }

  test('typed active checkpoint recovery uses recorded checkpoint commands through mocked boundaries', async () => {
    const prompts: string[] = [];

    const result = await runReviewPreparationAndReview(slug, worktree, 'codex', {
      validateCheckpointsBeforeReviewPreparationFn: () => ({ failureReason: { version: 1, code: 'incomplete-evidence', source: 'review-preparation' },
        ok: false as const,
        error: typedCheckpointFailure,
        source: 'recorded', nextCheckpoint: 'CP-2',
      }),
      startAgentFn: async (_stage: string, options: { prompt: string }) => {
        prompts.push(options.prompt);
        return { agent: 'codex', result: { status: 0 } };
      },
      workflowLauncherStatusFn: () => ({ supported: true }),
      performReviewPreparation: async () => { throw new Error("review preparation must not run while checkpoint evidence is missing"); },
      startReviewLoop: async () => {},
      log: () => {},
      error: () => {},
    });

    assert.equal(result, false, 'the mocked validation remains unresolved after the bounded recovery attempts');
    assert.ok(prompts.length > 0, 'the typed failure is sent to the mocked recovery launcher');
    assertRecordedCheckpointRecoveryAdvice(prompts[0]);
  });
});

import { fixtureMission, inMemoryTransitionStore } from '../../../../fixtures/mission-builders.js';
import { MissionCheckpointService } from '../../../../../src/application/mission-checkpoint-service.js';
import { RepairCheckpointService, repairCheckpointFailure } from '../../../../../src/application/repair-checkpoint-service.js';
import { configureRepairCheckpoints } from '../../../../../src/application/ports/repair-checkpoint.js';
import { missionId } from '../../../../../src/domain/mission.js';

test("missing planned checkpoint repair creates durable incident evidence and completes the original plan before review preparation (TASK-2695)", async (t) => {
  const slug = 'typed-checkpoint-gap';
  const id = missionId(slug);
  const store = inMemoryTransitionStore(fixtureMission(slug, { brief: { goal: 'Repair missing checkpoint evidence', why: 'Preserve the planned checkpoint contract', scope: 'Fixture evidence', outOfScope: ['External state'] }, successCriteria: ['implemented'], completedSuccessCriteria: [0],
    checkpoints: ['CP-1', 'CP-2'].map(name => ({ missionId: id, name, firstLine: 'original plan', goalCheck: [], nextActionText: '' })),
  }));
  configureRepairCheckpoints(new RepairCheckpointService(store));
  t.after(() => configureRepairCheckpoints(undefined));
  const service = new MissionCheckpointService(store);
  let launches = 0;
  let reviewPreparations = 0;
  let reviews = 0;
  const result = await runReviewPreparationAndReview(slug, '', 'codex', {
    validateCheckpointsBeforeReviewPreparationFn: () => {
      const missing = store.mission().checkpoints.filter(cp => !cp.goalCheck.length || (cp.repair && !cp.repair.evidenceRecorded));
      return missing.length ? { ok: false, error: `Planned checkpoint evidence is missing before review preparation: ${missing.map(cp => cp.name).join(', ')}.`, nextCheckpoint: missing[0].name } : { ok: true };
    },
    startAgentFn: async (_step: string, options: { prompt: string }) => {
      launches++;
      assert.match(options.prompt, /Harness-created repair checkpoint: CP-3/);
      assert.match(options.prompt, /Complete every remaining planned checkpoint before review preparation/);
      assert.equal(store.mission().checkpoints[2].repair?.command, 'review-preparation');
      assert.equal(store.mission().checkpoints[0].goalCheck.length, 0, 'harness must not invent implementation proof');
      for (const name of ['CP-1', 'CP-2', 'CP-3']) {
        const recorded = await service.record({ operationId: name, missionId: id, expectedVersion: (await store.load()).version,
          capabilities: new Set(['checkpoint:record']), checkpoint: { missionId: id, name, nextActionText: 'handoff',
            goalCheck: [{ criterion: 'implemented', evidence: 'npm test -- test/unit/adapters/cli/commands/mission-checkpoint-gate-bounce-contract.test.ts' }] } });
        assert.equal(recorded.status, 'completed');
      }
      return { result: { status: 0 } };
    },
    performReviewPreparation: async () => { reviewPreparations++; assert.equal(repairCheckpointFailure(store.mission().checkpoints), null); return { ok: true as const }; },
    startReviewLoop: async () => { reviews++; },
  });
  assert.equal(result, true);
  assert.equal(launches, 1); assert.equal(reviewPreparations, 1); assert.equal(reviews, 1);
  assert.equal(store.mission().checkpoints[2].repair?.verified, true);
});
