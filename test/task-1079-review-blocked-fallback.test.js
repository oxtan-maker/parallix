const test = require('node:test');
const assert = require('node:assert/strict');

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
  const { startReviewLoop } = require('../lib/review/review');
  const logs = [];
  const errors = [];
  const exitCodes = [];

  // implementer=custom. selectAgent picks mistral (unblocked).
  // Pre-refactor: reviewerFor(custom) -> codex (blocked), which triggered while loop.
  // Post-refactor: selectAgent skips codex and picks mistral directly.
  await startReviewLoop(TEST_SLUG, {
    eligibleAgentsForStepFn: () => ['claude', 'mistral', 'custom'], // codex blocked
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    implementer: 'custom',
    dryRun: true,
    log: m => logs.push(m),
    error: m => errors.push(m),
    exit: c => exitCodes.push(c),
    selectAgentFn: (step, { exclude }) => {
      const available = ['mistral', 'claude'].filter(a => !exclude.has(a));
      return available[0];
    },
    workflowLauncherStatusFn: () => ({ supported: true, detail: 'mock' }),
    formatMatrixSummaryFn: () => [],
    buildAutonomousReviewMatrixFn: () => ({ agents: ['claude', 'mistral', 'custom'] })
  });

  assert.equal(
    exitCodes.length,
    0,
    `startReviewLoop must not exit when a fallback is available; errors: ${errors.join(' | ')}`
  );
  assert.ok(
    logs.some(l => l.includes('Reviewer: mistral (auto-derived)')),
    `Expected selected-reviewer=mistral log; got: ${logs.join(' | ')}`
  );
});

test('startReviewLoop iterates past a blocked deterministic fallback to a third unblocked agent (Mission SC #3 — "Mistral or Claude")', async () => {
  const { startReviewLoop } = require('../lib/review/review');
  const logs = [];
  const errors = [];
  const exitCodes = [];

  // implementer=custom. To test the while loop multi-hop, we make selectAgent pick
  // codex first (unsupported), then mistral (unsupported), then claude (supported).
  await startReviewLoop(TEST_SLUG, {
    eligibleAgentsForStepFn: () => ['claude', 'custom', 'codex', 'mistral'],
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    implementer: 'custom',
    dryRun: true,
    log: m => logs.push(m),
    error: m => errors.push(m),
    exit: c => exitCodes.push(c),
    selectAgentFn: (step, { exclude }) => {
      if (!exclude.has('codex')) return 'codex';
      if (!exclude.has('mistral')) return 'mistral';
      return 'claude';
    },
    workflowLauncherStatusFn: (agent) => ({
      supported: agent === 'claude' || agent === 'custom',
      detail: agent
    }),
    formatMatrixSummaryFn: () => [],
    buildAutonomousReviewMatrixFn: () => ({ agents: ['claude', 'custom', 'codex', 'mistral'] })
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
  const { startReviewLoop } = require('../lib/review/review');
  const errors = [];
  const exitCodes = [];

  await startReviewLoop(TEST_SLUG, {
    eligibleAgentsForStepFn: () => ['claude', 'gemini', 'custom', 'codex'], 
    resolveTaskFileFn: () => ({ ok: true, taskFile: '/tmp/task.md' }),
    implementer: 'custom',
    reviewer: 'codex',
    dryRun: true,
    log: () => {},
    error: m => errors.push(m),
    exit: c => exitCodes.push(c),
    workflowLauncherStatusFn: (agent) => ({ supported: agent !== 'codex', detail: 'mock' }),
    formatMatrixSummaryFn: () => [],
    buildAutonomousReviewMatrixFn: () => ({ agents: ['claude', 'mistral', 'custom', 'codex'] })
  });

  assert.ok(exitCodes.includes(1), `Expected exit(1) when explicit reviewer is blocked; exitCodes: ${exitCodes.join(',')}`);
  assert.ok(
    errors.some(e => e.includes('Unsupported reviewer: "codex"') && e.includes('launcher is not available')),
    `Expected launcher-unavailable error; got: ${errors.join(' | ')}`
  );
});
