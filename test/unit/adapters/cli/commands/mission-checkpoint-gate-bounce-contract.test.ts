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
import { ExecuteHandoffService } from '../../../../../src/application/execute-handoff-service.js';
import { classifyError } from '../../../../../src/application/failure-classification.js';
import { isRelaunchableError } from '../../../../../src/adapters/cli/commands/repair-handoff.js';

// ── Checkpoint gate bounce — TASK-2261 ──
const repairHandoff = mockModule<typeof import('../../../../../src/adapters/cli/commands/repair-handoff.js')>('../../../../../src/adapters/cli/commands/repair-handoff.js', import.meta.url);
await installModuleMocks();
test.afterEach(() => mock.restoreAll());
const runHandoffAndReview = async (slug: string, worktree: string, agent: string, options: Record<string, any> = {}) => {
  const validate = options.validateCheckpointsBeforeHandoffFn ?? (() => ({ ok: true }));
  const handoff = options.performHandoff ?? (async () => ({ ok: true }));
  const repair = options.repairHandoffFn ?? (async () => ({ repaired: false }));
  const launch = options.startAgentFn ?? (async () => ({}));
  return new ExecuteHandoffService({
    checkpoints: { async validateBeforeHandoff(request) { return validate(slug, worktree, { log: request.log, error: request.error }); } },
    handoff: {
      async run(request) { return handoff(slug, { forgejoUser: agent, worktree, force: request.force }); },
      async repairHygiene(request) { return repair(slug, worktree, request.error, { taskFile: request.taskFile, log: request.log, error: request.outputError }); },
      classifyFailure: classifyError,
      isRelaunchableFailure: isRelaunchableError,
    },
    review: { async start(request) { await options.startReviewLoop?.(slug, { implementer: agent, worktree, skipHandoff: true, onAgentLaunched: request.onAgentLaunched, onAutonomousStop: request.onAutonomousStop }); } },
    repairLaunch: {
      available: options.workflowLauncherStatusFn ?? (() => ({ supported: true })),
      readHead() { return null; },
      async launch(request) { return launch('active', { prompt: request.prompt, worktree, agent, slug, role: 'implementer', sessionPolicy: request.sessionPolicy }); },
    },
    output: { log: options.log ?? (() => {}), error: options.error ?? (() => {}), command: (value) => value, formatSlug: (value) => value, formatAgent: (value) => value },
  }).run({ slug, worktree, agent, taskFile: options.taskFile ?? null, onAgentLaunched: options.onAgentLaunched, onAutonomousStop: options.onAutonomousStop });
};

// ── CP-1: Missing checkpoint → repairable relaunch (not stranded instruction) ──

test('missing checkpoint: runHandoffAndReview classifies as repairable and relaunches agent instead of stranding', async () => {
  const slug = 'task-2261';
  const worktree = '/tmp/worktree-task-2261';
  const logs = [];
  const errors = [];
  let relaunchCalled = false;
  let relaunchPrompt = null;
  let performHandoffCallCount = 0;

  const result = await runHandoffAndReview(slug, worktree, 'codex', {
    validateCheckpointsBeforeHandoffFn: () => ({
      ok: false,
      error: `No checkpoint documents found in /tmp/worktree-task-2261/missions/task-2261. The execute agent must create checkpoint documents (CP-N.md) with a Goal Check table before handoff. Create at least CP-1 documenting your implementation, including a Goal Check table with real evidence such as a backticked command, test name, ADR reference, or test file path.`
    }),
    performHandoff: async () => {
      performHandoffCallCount++;
      return { ok: false, error: 'still missing' };
    },
    startAgentFn: async (_step, opts) => {
      relaunchCalled = true;
      // TASK-2377.05: the kernel builds the fix prompt and hands it to the port.
      const slot = opts.prompt;
      relaunchPrompt = typeof slot === 'function' ? slot('codex') : String(slot ?? '');
      // Simulate the launch succeeding but the checkpoint still not created
      return { agent: 'codex', result: { status: 0 } };
    },
    repairHandoffFn: async () => ({ repaired: false, blocker: null }),
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
  const { classifyError, FailureClass } = repairHandoff;
  const errorMsg = 'No checkpoint documents found in /tmp/worktree/missions/task-2261. The execute agent must create checkpoint documents (CP-N.md) with a Goal Check table before handoff. Create at least CP-1 documenting your implementation, including a Goal Check table with real evidence such as a backticked command, test name, ADR reference, or test file path.';

  const result = classifyError(errorMsg);

  assert.ok(
    result.failureClass === FailureClass.IncompleteEvidence || result.failureClass === FailureClass.MissingArtifacts,
    `Missing checkpoint should be classified as IncompleteEvidence or MissingArtifacts, got ${result.failureClass}`
  );
  assert.equal(result.dispatchAction, 'AutoSendBack',
    'Missing checkpoint should dispatch AutoSendBack for agent relaunch');
});

test('missing checkpoint: compatibility prompt preserves the actual checkpoint failure', () => {
  const { buildRelaunchPrompt } = repairHandoff;
  const errorMsg = 'No checkpoint documents found in /tmp/worktree/missions/task-2261. The execute agent must create checkpoint documents (CP-N.md) with a Goal Check table before handoff.';

  const prompt = buildRelaunchPrompt(errorMsg, 'task-2261', '/tmp/worktree');

  assert.ok(typeof prompt === 'string', 'Prompt should be a string');
  assert.ok(prompt.includes('CP-'), 'Prompt should name the required checkpoint artifact (CP-N.md)');
  assert.ok(/## Goal Check/.test(prompt), 'Prompt should require the exact ## Goal Check heading');
  assert.ok(/Criterion\s*\|\s*Evidence\s*\|\s*Status/.test(prompt), 'Prompt should specify the exact table columns');
  assert.ok(prompt.includes('px review task-2261 --submit'), 'Prompt should supply the retry command');
  assert.ok(prompt.includes(errorMsg));
  assert.ok(prompt.includes('Working directory: /tmp/worktree'));
  assert.ok(prompt.includes('Classification: IncompleteEvidence — AutoSendBack'));
});

// ── CP-2: Checkpoint missing Goal Check table → repairable relaunch ──

test('checkpoint missing Goal Check: classifyError recognizes as IncompleteEvidence', () => {
  const { classifyError, FailureClass } = repairHandoff;
  const errorMsg = 'The final checkpoint at missions/task-2261/CP-1.md is missing a "## Goal Check" section. Review requires a goal-check table with real evidence before handoff.';

  const result = classifyError(errorMsg);

  assert.equal(result.failureClass, FailureClass.IncompleteEvidence,
    'Missing Goal Check section should be classified as IncompleteEvidence');
  assert.equal(result.dispatchAction, 'AutoSendBack',
    'Missing Goal Check should dispatch AutoSendBack for agent relaunch');
});

test('checkpoint missing Goal Check: compatibility prompt retains the failed check evidence', () => {
  const { buildRelaunchPrompt } = repairHandoff;
  const errorMsg = 'The final checkpoint at missions/task-2261/CP-1.md is missing a "## Goal Check" section. Review requires a goal-check table with real evidence before handoff.';

  const prompt = buildRelaunchPrompt(errorMsg, 'task-2261', '/tmp/worktree');

  assert.ok(/## Goal Check/.test(prompt), 'Prompt should require the ## Goal Check heading');
  assert.ok(/Criterion\s*\|\s*Evidence\s*\|\s*Status/.test(prompt), 'Prompt should specify table columns');
  assert.ok(prompt.includes('px review task-2261 --submit'), 'Prompt should supply the retry command');
  assert.ok(prompt.includes(errorMsg));
  assert.ok(prompt.includes('Classification: IncompleteEvidence — AutoSendBack'));
});

// ── CP-3: Retry lifecycle outcomes ──

test('valid repaired checkpoint: runHandoffAndReview unblocks handoff after relaunch creates valid checkpoint', async () => {
  const slug = 'task-2261';
  const worktree = '/tmp/worktree-task-2261';
  let handoffAttempts = 0;
  let relaunchCount = 0;
  let reviewLoopCalled = false;

  const result = await runHandoffAndReview(slug, worktree, 'codex', {
    validateCheckpointsBeforeHandoffFn: () => ({ ok: true }),
    performHandoff: async () => {
      handoffAttempts++;
      if (handoffAttempts === 1) {
        return { ok: false, error: 'The final checkpoint at missions/task-2261/CP-1.md has a "## Goal Check" section but no evidence rows. A goal-check table with real evidence is required before handoff.' };
      }
      return { ok: true };
    },
    startAgentFn: async () => {
      relaunchCount++;
      return { agent: 'codex', result: { status: 0 } };
    },
    repairHandoffFn: async () => ({ repaired: false, blocker: null }),
    startReviewLoop: () => { reviewLoopCalled = true; },
    log: () => {},
    error: () => {}
  });

  assert.equal(result, true, 'Handoff should succeed after agent relaunch creates valid checkpoint');
  assert.ok(handoffAttempts >= 2, 'Handoff should be retried after relaunch');
  assert.ok(relaunchCount >= 1, 'Agent relaunch should be attempted');
  assert.ok(reviewLoopCalled, 'Review loop should be started after successful handoff');
});

test('exhaustion: runHandoffAndReview stops after bounded relaunch attempts without submitting review', async () => {
  const slug = 'task-2261';
  const worktree = '/tmp/worktree-task-2261';
  let handoffAttempts = 0;
  let relaunchCount = 0;
  let reviewLoopCalled = false;

  const result = await runHandoffAndReview(slug, worktree, 'codex', {
    validateCheckpointsBeforeHandoffFn: () => ({ ok: true }),
    performHandoff: async () => {
      handoffAttempts++;
      return { ok: false, error: 'The final checkpoint at missions/task-2261/CP-1.md has a "## Goal Check" section but no evidence rows. A goal-check table with real evidence is required before handoff.' };
    },
    startAgentFn: async () => {
      relaunchCount++;
      return { agent: 'codex', result: { status: 0 } };
    },
    repairHandoffFn: async () => ({ repaired: false, blocker: null }),
    startReviewLoop: () => { reviewLoopCalled = true; },
    log: () => {},
    error: () => {}
  });

  assert.equal(result, false, 'Handoff should fail after exhaustion');
  assert.ok(!reviewLoopCalled, 'Review loop should NOT be called when exhaustion is reached');
  assert.ok(relaunchCount >= 2, 'Should attempt at least 2 relaunches before exhaustion');
});

// ── CP-3: Missing checkpoint path — relaunch then unblocks or exhausts ──

test('missing checkpoint: valid CP after relaunch unblocks handoff and starts review loop', async () => {
  // Deterministic filesystem fixture: creates a real CP-1.md with Goal Check table
  // and one evidence row per mission criterion, then verifies the validation path accepts it.
  const tmpRoot = registeredMkdtemp('task-2261-valid-cp-');
  const slug = 'task-2261';
  const missionDir = path.join(tmpRoot, 'missions', slug);
  fs.mkdirSync(missionDir, { recursive: true });
  // Initially: no checkpoint files
  let handoffAttempts = 0;
  let relaunchCount = 0;
  let reviewLoopCalled = false;
  let checkpointCreated = false;

  const result = await runHandoffAndReview(slug, tmpRoot, 'codex', {
    validateCheckpointsBeforeHandoffFn: (s, w) => {
      // Real filesystem check: look for CP-*.md files with Goal Check content
      const cpFiles = fs.readdirSync(missionDir).filter(f => /^CP-\d+\.md$/.test(f));
      if (cpFiles.length === 0) {
        return { ok: false, error: 'No checkpoint documents found in ' + missionDir + '. The execute agent must create checkpoint documents (CP-N.md) with a Goal Check table before handoff.' };
      }
      // Validate Goal Check table is present in the latest checkpoint
      const latestCp = cpFiles.sort().pop();
      const cpContent = fs.readFileSync(path.join(missionDir, latestCp), 'utf8');
      if (!/## Goal Check/.test(cpContent) || !/\| Criterion \| Evidence \| Status \|/.test(cpContent)) {
        return { ok: false, error: 'Checkpoint ' + latestCp + ' is missing a valid ## Goal Check table.' };
      }
      // Check for at least one evidence row
      const evidenceRows = cpContent.split('\n').filter(l => /^\|/.test(l) && !/Criterion/.test(l) && !/^\|-+\|/.test(l));
      if (evidenceRows.length === 0) {
        return { ok: false, error: 'Checkpoint ' + latestCp + ' has a ## Goal Check section but no evidence rows.' };
      }
      return { ok: true };
    },
    performHandoff: async () => {
      handoffAttempts++;
      return { ok: true };
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
| Deterministic regression test reproduces execute-complete mission with no checkpoint | test/task-2261-checkpoint-gates-repro.test.ts:20 — "missing checkpoint: runHandoffAndReview classifies as repairable and relaunches agent" | PASS |
| Handoff classifies missing CP-N.md and missing Goal Check as IncompleteEvidence | test/task-2261-checkpoint-gates-repro.test.ts:58 — classifyError test; test/task-2261-checkpoint-gates-repro.test.ts:89 — Goal Check classifyError test | PASS |
| Targeted relaunch names CP-N.md, requires ## Goal Check and table columns, supplies px review --submit | test/task-2261-checkpoint-gates-repro.test.ts:72 — buildRelaunchPrompt test | PASS |
| Valid checkpoint with one evidence row per criterion unblocks automated handoff retry | test/task-2261-checkpoint-gates-repro.test.ts:178 — "missing checkpoint: valid CP after relaunch unblocks handoff" | PASS |
| Repeated absent evidence reaches configured retry/exhaustion boundary without review submission | test/task-2261-checkpoint-gates-repro.test.ts:258 — "missing checkpoint: still absent after relaunch returns false" (asserts relaunchCount === 2) | PASS |
| Focused tests and verify-local.sh all pass | npm test -- test/task-2261-checkpoint-gates-repro.test.ts (12 tests); ./scripts/verify-local.sh all (1330 tests) | PASS |
`, 'utf8');
      }
      return { agent: 'codex', result: { status: 0 } };
    },
    repairHandoffFn: async () => ({ repaired: false, blocker: null }),
    startReviewLoop: () => { reviewLoopCalled = true; },
    log: () => {},
    error: () => {}
  });

  assert.equal(result, true, 'Handoff should succeed after agent creates valid checkpoint with Goal Check');
  assert.equal(relaunchCount, 1, 'Should attempt exactly 1 relaunch (checkpoint valid after first)');
  assert.ok(checkpointCreated, 'Agent relaunch should have created a real CP-1.md');
  assert.ok(fs.existsSync(path.join(missionDir, 'CP-1.md')), 'CP-1.md file should exist on disk');
  const cpContent = fs.readFileSync(path.join(missionDir, 'CP-1.md'), 'utf8');
  assert.ok(/## Goal Check/.test(cpContent), 'CP-1.md should contain ## Goal Check heading');
  assert.ok(/\| Criterion \| Evidence \| Status \|/.test(cpContent), 'CP-1.md should contain the 3-column table header');
  const evidenceRows = cpContent.split('\n').filter(l => /^\|/.test(l) && !/Criterion/.test(l) && !/^\|-+\|/.test(l));
  assert.equal(evidenceRows.length, 6, 'CP-1.md should have exactly 6 evidence rows (one per mission Success Criterion)');
  assert.equal(handoffAttempts, 1, 'performHandoff should be called once after validation passes');
  assert.ok(reviewLoopCalled, 'Review loop should be started after successful handoff');

  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('missing checkpoint: still absent after relaunch returns false with manual instruction', async () => {
  const slug = 'task-2261';
  const worktree = '/tmp/worktree-task-2261';
  let handoffAttempts = 0;
  let relaunchCount = 0;
  let reviewLoopCalled = false;
  const errors = [];

  const result = await runHandoffAndReview(slug, worktree, 'codex', {
    validateCheckpointsBeforeHandoffFn: () => ({
      ok: false,
      error: 'No checkpoint documents found in /tmp/worktree-task-2261/missions/task-2261. The execute agent must create checkpoint documents (CP-N.md) with a Goal Check table before handoff.'
    }),
    performHandoff: async () => {
      handoffAttempts++;
      return { ok: false, error: 'still missing' };
    },
    startAgentFn: async () => {
      relaunchCount++;
      return { agent: 'codex', result: { status: 0 } };
    },
    repairHandoffFn: async () => ({ repaired: false, blocker: null }),
    startReviewLoop: () => { reviewLoopCalled = true; },
    log: () => {},
    error: (msg) => errors.push(msg)
  });

  assert.equal(result, false, 'Should return false when checkpoint still missing after bounded relaunches');
  assert.equal(relaunchCount, 2, 'Should attempt 2 relaunches (bounded retry) before exhaustion');
  assert.equal(handoffAttempts, 0, 'performHandoff should NOT be called when validation still fails');
  assert.ok(!reviewLoopCalled, 'Review loop should NOT be called');
  assert.ok(errors.some(e => e.includes('Create a checkpoint document')), 'Should emit manual instruction');
  assert.ok(errors.some(e => e.includes('px review task-2261 --submit')), 'Should include retry command');
});

test('missing checkpoint: relaunch failure returns false with manual instruction', async () => {
  const slug = 'task-2261';
  const worktree = '/tmp/worktree-task-2261';
  let handoffAttempts = 0;
  let relaunchCount = 0;
  let reviewLoopCalled = false;
  const errors = [];

  const result = await runHandoffAndReview(slug, worktree, 'codex', {
    validateCheckpointsBeforeHandoffFn: () => ({
      ok: false,
      error: 'No checkpoint documents found in /tmp/worktree-task-2261/missions/task-2261. The execute agent must create checkpoint documents (CP-N.md) with a Goal Check table before handoff.'
    }),
    performHandoff: async () => {
      handoffAttempts++;
      return { ok: false, error: 'still missing' };
    },
    startAgentFn: async () => {
      relaunchCount++;
      throw new Error('agent launcher not available');
    },
    repairHandoffFn: async () => ({ repaired: false, blocker: null }),
    startReviewLoop: () => { reviewLoopCalled = true; },
    log: () => {},
    error: (msg) => errors.push(msg)
  });

  assert.equal(result, false, 'Should return false when relaunch fails');
  // TASK-2377.05 (SC5): the rebound kernel's per-occurrence budget is 2, and a
  // failed launch consumes an attempt rather than aborting the bounce.
  assert.equal(relaunchCount, 2, 'Should spend the kernel budget of 2 launch attempts');
  assert.equal(handoffAttempts, 0, 'performHandoff should NOT be called when relaunch fails');
  assert.ok(!reviewLoopCalled, 'Review loop should NOT be called');
  assert.ok(errors.some(e => e.includes('Create a checkpoint document')), 'Should emit manual instruction');
});

// ── Dirty checkpoint regression: GitBlockers do NOT enter the IncompleteEvidence relaunch loop ──

test('dirty checkpoint: GitBlockers classification does NOT enter the IncompleteEvidence relaunch loop', async () => {
  const slug = 'task-2261';
  const worktree = '/tmp/worktree-task-2261';
  let handoffAttempts = 0;
  let relaunchCount = 0;
  let reviewLoopCalled = false;
  const errors = [];

  const result = await runHandoffAndReview(slug, worktree, 'codex', {
    validateCheckpointsBeforeHandoffFn: () => ({
      ok: false,
      error: 'Checkpoint documents must be committed before handoff. Uncommitted checkpoint files: CP-1.md. Commit the checkpoint update and re-run the handoff.'
    }),
    performHandoff: async () => {
      handoffAttempts++;
      return { ok: false, error: 'still dirty' };
    },
    startAgentFn: async () => {
      relaunchCount++;
      return { agent: 'codex', result: { status: 0 } };
    },
    repairHandoffFn: async () => ({ repaired: false, blocker: null }),
    startReviewLoop: () => { reviewLoopCalled = true; },
    log: () => {},
    error: (msg) => errors.push(msg)
  });

  // Dirty checkpoint error is NOT IncompleteEvidence — it should NOT trigger
  // the targeted relaunch loop. Returns false immediately with manual instruction.
  assert.equal(result, false, 'Should return false for dirty checkpoint (not IncompleteEvidence)');
  assert.equal(relaunchCount, 0, 'Should NOT attempt any relaunches for non-IncompleteEvidence errors');
  assert.equal(handoffAttempts, 0, 'performHandoff should NOT be called');
  assert.ok(!reviewLoopCalled, 'Review loop should NOT be called');
});

test('dirty checkpoint: classifyError does NOT classify uncommitted checkpoint as IncompleteEvidence', () => {
  const { classifyError, FailureClass } = repairHandoff;
  const errorMsg = 'Checkpoint documents must be committed before handoff. Uncommitted checkpoint files: CP-1.md. Commit the checkpoint update and re-run the handoff.';

  const result = classifyError(errorMsg);

  assert.notEqual(result.failureClass, FailureClass.IncompleteEvidence,
    'Dirty checkpoint should NOT be classified as IncompleteEvidence (got ' + result.failureClass + ')');
});

// ── Missing checkpoint error classification — TASK-2215 (was 2215.ts) ──
describe("Missing checkpoint error classification —", () => {
  const { classifyError, FailureClass, DispatchAction } = repairHandoff;

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
    const result = classifyError(autoRemediationError);
    assert.equal(result.failureClass, FailureClass.MissingArtifacts,
      'auto-remediation failure must be MissingArtifacts per ADR 0048, not InfraBlocker');
    assert.equal(result.dispatchAction, DispatchAction.AutoSendBack,
      'auto-remediation failure must auto-send-back to the implementer, not require a human');
  });

  test('missing checkpoint evidence is sent back without generating placeholders', () => {
    const result = classifyError('No checkpoint documents found in missions/task-2521.06. Import historical evidence or record it with px checkpoint record; handoff never generates evidence.');
    assert.equal(result.failureClass, FailureClass.MissingArtifacts);
    assert.equal(result.dispatchAction, DispatchAction.AutoSendBack);
  });
});

// ── Typed checkpoint recovery advice — TASK-2581 (was 2581.ts) ──
// Regression coverage for typed-mission recovery advice. Both paths use
// injected boundaries: no agent process, network service, or Mission write is
// involved.
describe("Typed checkpoint recovery advice —", () => {
  const { buildRelaunchPrompt } = repairHandoff;
  const slug = 'task-2581';
  const worktree = '/tmp/worktree-task-2581';
  const typedCheckpointFailure = 'Planned checkpoint evidence is missing before handoff: CP-2. Record each with `px checkpoint record --name <CP-N>` before handoff.';

  function assertRecordedCheckpointRecoveryAdvice(prompt: string) {
    assert.match(prompt, /px status task-2581/, 'recovery reloads the recorded Mission contract');
    assert.match(prompt, /px checkpoint record --name CP-2/, 'recovery records the named missing checkpoint');
    assert.match(prompt, /--expected-version <n>/, 'recovery obtains and uses the current expected version');
    assert.match(prompt, /every declared gate passes/, 'typed recovery retains the mission gate completion requirement');
    assert.match(prompt, /only evidence from work and verification actually performed/, 'recording evidence requires real implementation and verification');
    assert.doesNotMatch(prompt, /(?:Create|Fix|Update) (?:a |the )?(?:final )?checkpoint document/i, 'typed recovery must not create a legacy checkpoint document');
    assert.doesNotMatch(prompt, /Create (?:a )?CP-(?:N|2)\.md/i, 'typed recovery must not create a legacy checkpoint template');
  }

  test('typed active checkpoint recovery uses recorded checkpoint commands through mocked boundaries', async () => {
    const prompts: string[] = [];

    const result = await runHandoffAndReview(slug, worktree, 'codex', {
      validateCheckpointsBeforeHandoffFn: () => ({
        ok: false,
        error: typedCheckpointFailure,
        nextCheckpoint: 'CP-2',
      }),
      startAgentFn: async (_stage: string, options: { prompt: string }) => {
        prompts.push(options.prompt);
        return { agent: 'codex', result: { status: 0 } };
      },
      workflowLauncherStatusFn: () => ({ supported: true }),
      performHandoff: async () => { throw new Error('handoff must not run while checkpoint evidence is missing'); },
      startReviewLoop: async () => {},
      log: () => {},
      error: () => {},
    });

    assert.equal(result, false, 'the mocked validation remains unresolved after the bounded recovery attempts');
    assert.ok(prompts.length > 0, 'the typed failure is sent to the mocked recovery launcher');
    assertRecordedCheckpointRecoveryAdvice(prompts[0]);
  });

  test('typed repair-handoff recovery uses recorded checkpoint commands without legacy templates', () => {
    const prompt = buildRelaunchPrompt(typedCheckpointFailure, slug, worktree);

    assertRecordedCheckpointRecoveryAdvice(prompt);
    assert.match(prompt, /historical[- ]import/i, 'legacy document import remains an explicit, separate compatibility path');
    assert.match(prompt, /px import-legacy/, 'historical documents retain their explicit import command');
  });
});

import { fixtureMission, inMemoryTransitionStore } from '../../../../fixtures/mission-builders.js';
import { MissionCheckpointService } from '../../../../../src/application/mission-checkpoint-service.js';
import { RepairCheckpointService, repairCheckpointFailure } from '../../../../../src/application/repair-checkpoint-service.js';
import { configureRepairCheckpoints } from '../../../../../src/application/ports/repair-checkpoint.js';
import { missionId } from '../../../../../src/domain/mission.js';

test('missing planned checkpoint repair creates durable incident evidence and completes the original plan before handoff (TASK-2695)', async (t) => {
  const slug = 'typed-checkpoint-gap';
  const id = missionId(slug);
  const store = inMemoryTransitionStore(fixtureMission(slug, { brief: {} as never, successCriteria: ['implemented'], completedSuccessCriteria: [0],
    checkpoints: ['CP-1', 'CP-2'].map(name => ({ missionId: id, name, firstLine: 'original plan', goalCheck: [], nextActionText: '' })),
  }));
  configureRepairCheckpoints(new RepairCheckpointService(store));
  t.after(() => configureRepairCheckpoints(undefined));
  const service = new MissionCheckpointService(store);
  let launches = 0;
  let handoffs = 0;
  let reviews = 0;
  const result = await runHandoffAndReview(slug, '', 'codex', {
    validateCheckpointsBeforeHandoffFn: () => {
      const missing = store.mission().checkpoints.filter(cp => !cp.goalCheck.length || (cp.repair && !cp.repair.evidenceRecorded));
      return missing.length ? { ok: false, error: `Planned checkpoint evidence is missing before handoff: ${missing.map(cp => cp.name).join(', ')}.`, nextCheckpoint: missing[0].name } : { ok: true };
    },
    startAgentFn: async (_step: string, options: { prompt: string }) => {
      launches++;
      assert.match(options.prompt, /Harness-created repair checkpoint: CP-3/);
      assert.match(options.prompt, /Complete every remaining planned checkpoint before handoff/);
      assert.equal(store.mission().checkpoints[2].repair?.command, 'px handoff');
      assert.equal(store.mission().checkpoints[0].goalCheck.length, 0, 'harness must not invent implementation proof');
      for (const name of ['CP-1', 'CP-2', 'CP-3']) {
        const recorded = await service.record({ operationId: name, missionId: id, expectedVersion: (await store.load()).version,
          capabilities: new Set(['checkpoint:record']), checkpoint: { missionId: id, name, nextActionText: 'handoff',
            goalCheck: [{ criterion: 'implemented', evidence: 'npm test -- test/unit/adapters/cli/commands/mission-checkpoint-gate-bounce-contract.test.ts' }] } });
        assert.equal(recorded.status, 'completed');
      }
      return { result: { status: 0 } };
    },
    performHandoff: async () => { handoffs++; assert.equal(repairCheckpointFailure(store.mission().checkpoints), null); return { ok: true }; },
    startReviewLoop: async () => { reviews++; },
  });
  assert.equal(result, true);
  assert.equal(launches, 1); assert.equal(handoffs, 1); assert.equal(reviews, 1);
  assert.equal(store.mission().checkpoints[2].repair?.verified, true);
});
