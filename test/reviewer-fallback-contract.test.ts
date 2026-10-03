// @ts-nocheck -- Retained legacy partial request doubles (TASK-2328).
// reviewer fallback contract.
// Related scenarios share imports; each contract keeps its own hooks and mutable fixtures.
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { startReviewLoop, selectPreparedReviewer } from '../src/adapters/review/review-loop.js';
import fs from 'node:fs';
import path from 'node:path';
import { mkdtemp } from './helpers/temp-dir.js';
import { reviewLoopOutput } from './fixtures/review-loop.js';
import { agentFamily } from '../src/domain/agents.js';
import { PreparedAgentSelection } from '../src/application/services/agent-selection.js';

// Regression provenance: TASK-1079.
describe("review blocked fallback", { concurrency: false }, () => {
  // Reproduction test for TASK-1079.
  //
  // Original bug: when the auto-derived reviewer is blocked (eligibleAgentsForStep
  // excludes it because of a usage-limit hit), startReviewLoop crashed with
  //   [FAIL] Unsupported reviewer: "codex". Supported for review: claude, mistral, custom
  // even though mistral and claude were available as fallbacks.
  //
  // The fix: the launcher-availability `while` loop in workflow/lib/review/review.js
  // must also gate on `agents.includes(reviewer)` so a blocked auto-derived
  // reviewer is treated as needing a fallback, not as a hard failure.

  const TEST_SLUG = 'task-test-1079-blocked-fallback';

  test('startReviewLoop falls back when the auto-derived reviewer is blocked but a different-family agent is available', async () => {
    const { logs, errors, exitCodes, output } = reviewLoopOutput();

    // implementer=custom. selectAgent picks mistral (unblocked).
    // Pre-refactor: reviewerFor(custom) -> codex (blocked), which triggered while loop.
    // Post-refactor: selectAgent skips codex and picks mistral directly.
    await startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['claude', 'vibe', 'custom'], // codex blocked
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      implementer: 'custom',
      dryRun: true,
      ...output,
      selectAgentFn: (step, { exclude }) => {
        const available = ['vibe', 'claude'].filter(a => !exclude.has(a));
        return available[0];
      },
      workflowLauncherStatusFn: () => ({ supported: true, detail: 'mock' }),
      formatMatrixSummaryFn: () => [],
      buildAutonomousReviewMatrixFn: () => ({ agents: ['claude', 'vibe', 'custom'] })
    });

    assert.equal(
      exitCodes.length,
      0,
      `startReviewLoop must not exit when a fallback is available; errors: ${errors.join(' | ')}`
    );
    // The review-start header emits the reviewer on its own line (mission
    // task-2477 recomposed the header); the selection source stays on the
    // `Selected reviewer:` line. Assert on that stable announcement.
    assert.ok(
      logs.some(l => l.includes('Selected reviewer: vibe (auto-derived)')),
      `Expected selected-reviewer=vibe log; got: ${logs.join(' | ')}`
    );
  });

  test('startReviewLoop iterates past a blocked deterministic fallback to a third unblocked agent (Mission SC #3 — "Mistral or Claude")', async () => {
    const { logs, errors, exitCodes, output } = reviewLoopOutput();

    // implementer=custom. To test the while loop multi-hop, we make selectAgent pick
    // codex first (unsupported), then vibe (unsupported), then claude (supported).
    await startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['claude', 'custom', 'codex', 'vibe'],
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      implementer: 'custom',
      dryRun: true,
      ...output,
      selectAgentFn: (step, { exclude }) => {
        if (!exclude.has('codex')) return 'codex';
        if (!exclude.has('vibe')) return 'vibe';
        return 'claude';
      },
      workflowLauncherStatusFn: (agent) => ({
        supported: agent === 'claude' || agent === 'custom',
        detail: agent
      }),
      formatMatrixSummaryFn: () => [],
      buildAutonomousReviewMatrixFn: () => ({ agents: ['claude', 'custom', 'codex', 'vibe'] })
    });

    assert.equal(
      exitCodes.length,
      0,
      `startReviewLoop must walk past a blocked deterministic fallback when another unblocked different-family agent exists; errors: ${errors.join(' | ')}`
    );
    assert.ok(
      logs.some(l => l.includes('Selected reviewer: claude (auto-derived-fallback)')),
      `Expected selected-reviewer=claude after multi-hop fallback; got: ${logs.join(' | ')}`
    );
  });

  test('startReviewLoop still rejects with a clear error when the explicit reviewer is blocked and no fallback path exists', async () => {
    const { errors, exitCodes, output } = reviewLoopOutput();

    await startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['claude', 'gemini', 'custom', 'codex'],
      resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
      implementer: 'custom',
      reviewer: 'codex',
      dryRun: true,
      ...output,
      workflowLauncherStatusFn: (agent) => ({ supported: agent !== 'codex', detail: 'mock' }),
      formatMatrixSummaryFn: () => [],
      buildAutonomousReviewMatrixFn: () => ({ agents: ['claude', 'vibe', 'custom', 'codex'] })
    });

    assert.ok(exitCodes.includes(1), `Expected exit(1) when explicit reviewer is blocked; exitCodes: ${exitCodes.join(',')}`);
    assert.ok(
      errors.some(e => e.includes('Unsupported reviewer: "codex"') && e.includes('launcher is not available')),
      `Expected launcher-unavailable error; got: ${errors.join(' | ')}`
    );
  });
});

// Regression provenance: TASK-1135.
describe("review fallback", { concurrency: false }, () => {
  // CP-1: Reproduce the current reviewer fallback path with focused tests.
  //
  // These tests verify the behavior of startReviewLoop's reviewer
  // fallback logic after the unbiased config-driven refactor:
  //
  // 1. Blocked auto-derived reviewer: when the auto-derived reviewer is
  //    blocked (unsupported launcher), the while loop picks a fallback
  //    via selectAgentFn.
  //
  // 2. Usage-limit reviewer reroute: when a reviewer launch hits a usage limit,
  //    startAgent (simulated) returns a fallback agent.
  //
  // 3. Persisted reviewer reroute: when review-state.json carries a reviewer
  //    that is blocked, the loop falls back to the next eligible agent.
  //
  // 4. Backlog assignee mutation: verify no Backlog assignee mutation happens
  //    during autonomous fallback (SC 5).

  const TEST_SLUG = 'task-test-cp1-fallback';

  // Helper: create a minimal task file that enforceTaskAssignee can mutate.
  // enforceTaskAssignee (backlog.js:581) returns false when the file doesn't exist.
  // It requires an `id:` line to find the insert position (backlog.js:594).
  function createTaskFile(filePath) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `id: ${TEST_SLUG.toUpperCase()}\ntitle: CP-1 Test Task\nstatus: review\n`);
    return filePath;
  }

  let taskRoot;
  let TASK_FILE;
  test.beforeEach(() => {
    taskRoot = mkdtemp('reviewer-fallback-');
    TASK_FILE = path.join(taskRoot, 'task.md');
  });
  test.afterEach(() => {
    fs.rmSync(taskRoot, { recursive: true, force: true });
  });

  // ---------- CP-1 Test 1: Blocked auto-derived reviewer fallback ----------

  test('CP-1: blocked auto-derived reviewer falls back via selectAgent without mutating Backlog assignee', async () => {
    createTaskFile(TASK_FILE);

    const { logs, errors, exitCodes, output } = reviewLoopOutput();

    // implementer=mistral. selectAgent picks codex (unsupported).
    // The while loop enters, calls selectAgentFn('review', { exclude: ['vibe', 'codex'] })
    // which returns 'claude'.
    await startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'custom', 'vibe'],
      resolveTaskFileFn: () => ({ ok: true, taskFile: TASK_FILE }),
      implementer: 'vibe',
      dryRun: true,
      ...output,
      selectAgentFn: (step, opts) => {
        const exclude = opts.exclude instanceof Set ? opts.exclude : new Set(opts.exclude || []);
        if (!exclude.has('codex')) return 'codex';
        if (!exclude.has('claude')) return 'claude';
        return 'custom';
      },
      workflowLauncherStatusFn: (agent) => ({
        supported: agent !== 'codex',
        detail: agent
      }),
      formatMatrixSummaryFn: () => [],
      buildAutonomousReviewMatrixFn: () => ({ agents: ['codex', 'claude', 'custom', 'vibe'] })
    });

    // The loop should have succeeded by falling back to claude
    assert.equal(
      exitCodes.length,
      0,
      `startReviewLoop must not exit when fallback is available; errors: ${errors.join(' | ')}`
    );

    // Verify the blocked reviewer was detected
    assert.ok(
      logs.some(l => l.includes('Unsupported reviewer: "codex"')),
      `Expected blocked-reviewer warning; got: ${logs.join(' | ')}`
    );

    // Verify fallback was selected
    assert.ok(
      logs.some(l => l.includes('trying fallback "claude"')),
      `Expected fallback-to-claude log; got: ${logs.join(' | ')}`
    );

    // Verify no Backlog assignee mutation (CP-2 removed this - SC 5)
    assert.equal(
      logs.filter(l => l.includes('Updated Backlog task assignee')).length,
      0,
      `Expected no Backlog assignee mutation after CP-2; got: ${logs.join(' | ')}`
    );

    // Verify reviewerSource reflects auto-derived-fallback
    assert.ok(
      logs.some(l => l.includes('auto-derived-fallback')),
      `Expected reviewerSource=auto-derived-fallback; got: ${logs.join(' | ')}`
    );
  });

  // ---------- CP-1 Test 2: Usage-limit reviewer reroute (while loop scans remaining agents) ----------

  test('CP-1: usage-limit on auto-derived reviewer triggers fallback with blocklist write', async () => {
    createTaskFile(TASK_FILE);

    const { logs, errors, exitCodes, output } = reviewLoopOutput();
    let blocklistWrites = [];

    // implementer=claude. selectAgent picks custom.
    // In the real code, startAgent writes the blocklist entry and returns a fallback.
    await startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'vibe', 'custom'],
      resolveTaskFileFn: () => ({ ok: true, taskFile: TASK_FILE }),
      implementer: 'claude',
      dryRun: true,
      ...output,
      selectAgentFn: (step, opts) => {
        const exclude = opts.exclude instanceof Set ? opts.exclude : new Set(opts.exclude || []);
        if (!exclude.has('custom')) return 'custom';
        return 'vibe';
      },
      workflowLauncherStatusFn: (agent) => ({
        supported: true,
        detail: agent
      }),
      formatMatrixSummaryFn: () => [],
      buildAutonomousReviewMatrixFn: () => ({ agents: ['codex', 'claude', 'vibe', 'custom'] }),
      startAgentFn: async (step, opts) => {
        // Simulate: first attempt picks custom, hits limit -> writes blocklist
        const original = opts.agent || 'custom';
        if (original === 'custom') {
          blocklistWrites.push({ agent: 'custom', until: '2026-06-01 12' });
          // startAgent returns the fallback agent it actually launched
          return { agent: 'vibe', original };
        }
        return { agent: original };
      }
    });

    // The loop should have succeeded
    assert.equal(
      exitCodes.length,
      0,
      `startReviewLoop must not exit on usage-limit; errors: ${errors.join(' | ')}`
    );

    // Verify the reviewer was selected (in dry-run mode startAgentFn is not called, so reviewer stays as custom)
    assert.ok(
      logs.some(l => l.includes('Selected reviewer: custom')),
      `Expected selected-reviewer=custom (dry-run); got: ${logs.join(' | ')}`
    );

    // Verify no Backlog assignee mutation (CP-2 removed this - SC 5)
    assert.equal(
      logs.filter(l => l.includes('Updated Backlog task assignee')).length,
      0,
      `Expected no Backlog assignee mutation after CP-2; got: ${logs.join(' | ')}`
    );
  });

  // ---------- CP-1 Test 3: Persisted reviewer reroute ----------

  test('CP-1: persisted blocked reviewer falls back via selectAgent without mutating Backlog assignee', async () => {
    createTaskFile(TASK_FILE);

    const { logs, errors, exitCodes, output } = reviewLoopOutput();

    // Persisted reviewer=codex (from review-state.json), but codex is unsupported.
    // The while loop enters with reviewerSource='persisted', calls selectAgentFn('review', { exclude: ['custom', 'codex'] })
    // which returns 'vibe'.
    await startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'vibe', 'custom'],
      resolveTaskFileFn: () => ({ ok: true, taskFile: TASK_FILE }),
      implementer: 'custom',
      dryRun: true,
      readReviewStateFn: () => ({ reviewer: 'codex', round: 1, startedAt: '2026-01-01', phase: 'reviewing' }),
      // The synthetic slug deliberately has no mission directory. Persistence is
      // a separate adapter concern, so keep this fallback-routing unit test
      // hermetic instead of invoking the real review-state filesystem adapter.
      writeReviewStateFn: () => ({ outcome: 'unchanged' }),
      ...output,
      selectAgentFn: (step, opts) => {
        const exclude = opts.exclude instanceof Set ? opts.exclude : new Set(opts.exclude || []);
        if (!exclude.has('vibe')) return 'vibe';
        return 'claude';
      },
      workflowLauncherStatusFn: (agent) => ({
        supported: agent !== 'codex',
        detail: agent
      }),
      formatMatrixSummaryFn: () => [],
      buildAutonomousReviewMatrixFn: () => ({ agents: ['codex', 'claude', 'vibe', 'custom'] }),
      startAgentFn: async (step, opts) => {
        return { agent: opts.agent };
      }
    });

    // The loop should have succeeded by falling back to mistral
    assert.equal(
      exitCodes.length,
      0,
      `startReviewLoop must not exit on persisted blocked reviewer; errors: ${errors.join(' | ')}`
    );

    // Verify the blocked persisted reviewer was detected
    assert.ok(
      logs.some(l => l.includes('Unsupported reviewer: "codex"')),
      `Expected blocked-persisted-reviewer warning; got: ${errors.join(' | ')}`
    );

    // Verify fallback was selected
    assert.ok(
      logs.some(l => l.includes('trying fallback "vibe"')),
      `Expected fallback-to-mistral log; got: ${logs.join(' | ')}`
    );

    // Verify reviewerSource reflects persisted-fallback
    assert.ok(
      logs.some(l => l.includes('persisted-fallback')),
      `Expected reviewerSource=persisted-fallback; got: ${logs.join(' | ')}`
    );

    // Verify no Backlog assignee mutation (CP-2 removed this - SC 5)
    assert.equal(
      logs.filter(l => l.includes('Updated Backlog task assignee')).length,
      0,
      `Expected no Backlog assignee mutation after CP-2; got: ${logs.join(' | ')}`
    );
  });

  // ---------- CP-1 Test 4: Backlog assignee mutation regression ----------

  test('CP-1: reviewer fallback with no Backlog assignee mutation (regression)', async () => {
    createTaskFile(TASK_FILE);

    const { logs, errors, exitCodes, output } = reviewLoopOutput();

    // implementer=mistral. selectAgent picks codex (unsupported).
    // Next selectAgent call returns 'claude'.
    await startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'custom', 'vibe'],
      resolveTaskFileFn: () => ({ ok: true, taskFile: TASK_FILE }),
      implementer: 'vibe',
      dryRun: true,
      ...output,
      selectAgentFn: (step, opts) => {
        const exclude = opts.exclude instanceof Set ? opts.exclude : new Set(opts.exclude || []);
        if (!exclude.has('codex')) return 'codex';
        return 'claude';
      },
      workflowLauncherStatusFn: (agent) => ({
        supported: agent !== 'codex',
        detail: agent
      }),
      formatMatrixSummaryFn: () => [],
      buildAutonomousReviewMatrixFn: () => ({ agents: ['codex', 'claude', 'custom', 'vibe'] })
    });

    // Verify no Backlog assignee mutation (CP-2 removed this - SC 5)
    assert.equal(
      logs.filter(l => l.includes('Updated Backlog task assignee')).length,
      0,
      `Expected no Backlog assignee mutation after CP-2; got: ${logs.join(' | ')}`
    );
  });

  // ---------- CP-1 Test 5: Explicit reviewer fail-fast (unchanged) ----------

  test('CP-1: explicit blocked reviewer fails fast without fallback (unchanged behavior)', async () => {
    createTaskFile(TASK_FILE);

    const { logs, errors, exitCodes, output } = reviewLoopOutput();

    // implementer=custom, explicit reviewer=codex (unsupported)
    // Current code: explicit reviewer never enters fallback loop, hard-fails
    await startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['claude', 'vibe', 'custom', 'codex'],
      resolveTaskFileFn: () => ({ ok: true, taskFile: TASK_FILE }),
      implementer: 'custom',
      reviewer: 'codex', // explicit
      dryRun: true,
      ...output,
      workflowLauncherStatusFn: (agent) => ({
        supported: agent !== 'codex',
        detail: agent
      }),
      formatMatrixSummaryFn: () => [],
      buildAutonomousReviewMatrixFn: () => ({ agents: ['claude', 'vibe', 'custom', 'codex'] })
    });

    // Explicit blocked reviewer should fail fast
    assert.ok(
      exitCodes.includes(1),
      `Expected exit(1) for explicit blocked reviewer; exitCodes: ${exitCodes.join(',')}`
    );
    assert.ok(
      errors.some(e => e.includes('Unsupported reviewer: "codex"')),
      `Expected unsupported-reviewer error; got: ${errors.join(' | ')}`
    );
  });

  // ---------- CP-1 Test 6: Multi-hop fallback through blocked deterministic fallback ----------

  test('CP-1: multi-hop fallback scans remaining eligible agents when deterministic fallback is also blocked', async () => {
    createTaskFile(TASK_FILE);

    const { logs, errors, exitCodes, output } = reviewLoopOutput();

    // implementer=custom. selectAgent picks codex (unsupported).
    // Next selectAgent call returns vibe (unsupported).
    // Next selectAgent call returns claude (supported).
    await startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['claude', 'custom', 'codex', 'vibe'],
      resolveTaskFileFn: () => ({ ok: true, taskFile: TASK_FILE }),
      implementer: 'custom',
      dryRun: true,
      ...output,
      selectAgentFn: (step, opts) => {
        const exclude = opts.exclude instanceof Set ? opts.exclude : new Set(opts.exclude || []);
        if (!exclude.has('codex')) return 'codex';
        if (!exclude.has('vibe')) return 'vibe';
        return 'claude';
      },
      workflowLauncherStatusFn: (agent) => ({
        supported: agent === 'claude' || agent === 'custom',
        detail: agent
      }),
      formatMatrixSummaryFn: () => [],
      buildAutonomousReviewMatrixFn: () => ({ agents: ['claude', 'custom', 'codex', 'vibe'] })
    });

    // Should succeed by scanning remaining eligible agents
    assert.equal(
      exitCodes.length,
      0,
      `startReviewLoop must scan remaining eligible agents; errors: ${errors.join(' | ')}`
    );

    // Verify multi-hop: codex -> mistral (blocked) -> claude
    assert.ok(
      logs.some(l => l.includes('Selected reviewer: claude')),
      `Expected selected-reviewer=claude after multi-hop; got: ${logs.join(' | ')}`
    );
  });

  // ---------- CP-1 Test 7: No runnable reviewer exits cleanly ----------

  test('CP-1: no runnable reviewer exits with error and does not mutate Backlog assignee', async () => {
    createTaskFile(TASK_FILE);

    const { logs, errors, exitCodes, output } = reviewLoopOutput();

    // implementer=mistral. selectAgent picks codex (unsupported).
    // Next call returns claude (unsupported).
    // Next call throws because no more agents.
    await startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'vibe'],
      resolveTaskFileFn: () => ({ ok: true, taskFile: TASK_FILE }),
      implementer: 'vibe',
      dryRun: true,
      ...output,
      selectAgentFn: (step, opts) => {
        const exclude = opts.exclude instanceof Set ? opts.exclude : new Set(opts.exclude || []);
        const available = ['codex', 'claude'].filter(a => !exclude.has(a));
        if (available.length === 0) throw new Error('No agents available');
        return available[0];
      },
      workflowLauncherStatusFn: () => ({ supported: false, detail: 'blocked' }),
      formatMatrixSummaryFn: () => [],
      buildAutonomousReviewMatrixFn: () => ({ agents: ['codex', 'claude', 'vibe'] })
    });

    // Should exit with error
    assert.ok(
      exitCodes.includes(1),
      `Expected exit(1) when no reviewer is runnable; exitCodes: ${exitCodes.join(',')}`
    );

    // Should show "No runnable reviewer route" error
    assert.ok(
      errors.some(e => e.includes('No runnable reviewer route')),
      `Expected no-runnable-reviewer error; got: ${errors.join(' | ')}`
    );
  });

  // ---------- CP-1 Test 8: Single-family fallback path ----------

  test('CP-1: single-family fallback when no different-family reviewer is runnable (unchanged)', async () => {
    createTaskFile(TASK_FILE);

    const { logs, errors, exitCodes, output } = reviewLoopOutput();

    // implementer=claude. Different-family agents are unsupported.
    // -> single-family fallback: claude reviews its own work
    await startReviewLoop(TEST_SLUG, {
      eligibleAgentsForStepFn: () => ['codex', 'claude', 'vibe'],
      resolveTaskFileFn: () => ({ ok: true, taskFile: TASK_FILE }),
      implementer: 'claude',
      dryRun: true,
      ...output,
      selectAgentFn: (step, opts) => {
        const exclude = opts.exclude instanceof Set ? opts.exclude : new Set(opts.exclude || []);
        const available = ['codex', 'vibe'].filter(a => !exclude.has(a));
        if (available.length === 0) throw new Error('No agents available');
        return available[0];
      },
      workflowLauncherStatusFn: (agent) => ({
        supported: agent === 'claude', // only implementer is runnable
        detail: agent
      }),
      formatMatrixSummaryFn: () => [],
      buildAutonomousReviewMatrixFn: () => ({ agents: ['codex', 'claude', 'vibe'] })
    });

    // Should succeed with single-family fallback
    assert.equal(
      exitCodes.length,
      0,
      `startReviewLoop must succeed with single-family fallback; errors: ${errors.join(' | ')}`
    );

    // Verify single-family fallback was selected
    assert.ok(
      logs.some(l => l.includes('Selected reviewer: claude')),
      `Expected selected-reviewer=claude (single-family); got: ${logs.join(' | ')}`
    );
    assert.ok(
      logs.some(l => l.includes('single-family-fallback')),
      `Expected reviewerSource=single-family-fallback; got: ${logs.join(' | ')}`
    );
  });
});

// Regression provenance: TASK-2351.
describe("review loop selection", { concurrency: false }, () => {
  test('review-loop prepared selection skips SQLite-blocked reviewer before any launch (TASK-2351)', async () => {
    const codex = agentFamily('codex');
    const claude = agentFamily('claude');
    let launchCalls = 0;
    const prepared = await PreparedAgentSelection.prepare({
      async load() {
        return {
          capturedAtMs: 1_000,
          defaultPolicy: { eligible: [codex, claude], strategy: 'random' },
          steps: { review: { eligible: [codex, claude], strategy: 'random' } },
          agents: [
            { family: codex, launcherAvailable: true, block: { kind: 'until', untilMs: 2_000, reason: 'SQLite limit' } },
            { family: claude, launcherAvailable: true, block: { kind: 'none' } },
          ],
        };
      },
    });
    const reviewer = selectPreparedReviewer(prepared, new Set());
    if (reviewer === 'codex') { launchCalls += 1; }
    assert.equal(reviewer, 'claude');
    assert.equal(launchCalls, 0, 'blocked codex receives zero launch calls');
  });

});
