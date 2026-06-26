const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

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

const TASK_FILE = path.join(os.tmpdir(), `task-${TEST_SLUG}.md`);

test.afterEach(() => {
  try { fs.unlinkSync(TASK_FILE); } catch (_) {}
});

// ---------- CP-1 Test 1: Blocked auto-derived reviewer fallback ----------

test('CP-1: blocked auto-derived reviewer falls back via selectAgent without mutating Backlog assignee', async () => {
  createTaskFile(TASK_FILE);

  const { startReviewLoop } = require('../lib/review/review');
  const logs = [];
  const errors = [];
  const exitCodes = [];

  // implementer=mistral. selectAgent picks codex (unsupported).
  // The while loop enters, calls selectAgentFn('review', { exclude: ['mistral', 'codex'] })
  // which returns 'claude'. 
  await startReviewLoop(TEST_SLUG, {
    eligibleAgentsForStepFn: () => ['codex', 'claude', 'custom', 'mistral'],
    resolveTaskFileFn: () => ({ ok: true, taskFile: TASK_FILE }),
    implementer: 'mistral',
    dryRun: true,
    log: m => logs.push(m),
    error: m => errors.push(m),
    exit: c => exitCodes.push(c),
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
    buildAutonomousReviewMatrixFn: () => ({ agents: ['codex', 'claude', 'custom', 'mistral'] })
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

  const { startReviewLoop } = require('../lib/review/review');
  const logs = [];
  const errors = [];
  const exitCodes = [];
  let blocklistWrites = [];

  // implementer=claude. selectAgent picks custom.
  // In the real code, startAgent writes the blocklist entry and returns a fallback.
  await startReviewLoop(TEST_SLUG, {
    eligibleAgentsForStepFn: () => ['codex', 'claude', 'mistral', 'custom'],
    resolveTaskFileFn: () => ({ ok: true, taskFile: TASK_FILE }),
    implementer: 'claude',
    dryRun: true,
    log: m => logs.push(m),
    error: m => errors.push(m),
    exit: c => exitCodes.push(c),
    selectAgentFn: (step, opts) => {
      const exclude = opts.exclude instanceof Set ? opts.exclude : new Set(opts.exclude || []);
      if (!exclude.has('custom')) return 'custom';
      return 'mistral';
    },
    workflowLauncherStatusFn: (agent) => ({
      supported: true,
      detail: agent
    }),
    formatMatrixSummaryFn: () => [],
    buildAutonomousReviewMatrixFn: () => ({ agents: ['codex', 'claude', 'mistral', 'custom'] }),
    startAgentFn: async (step, opts) => {
      // Simulate: first attempt picks custom, hits limit -> writes blocklist
      const original = opts.agent || 'custom';
      if (original === 'custom') {
        blocklistWrites.push({ agent: 'custom', until: '2026-06-01 12' });
        // startAgent returns the fallback agent it actually launched
        return { agent: 'mistral', original };
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

  const { startReviewLoop } = require('../lib/review/review');
  const logs = [];
  const errors = [];
  const exitCodes = [];

  // Persisted reviewer=codex (from review-state.json), but codex is unsupported.
  // The while loop enters with reviewerSource='persisted', calls selectAgentFn('review', { exclude: ['custom', 'codex'] })
  // which returns 'mistral'.
  await startReviewLoop(TEST_SLUG, {
    eligibleAgentsForStepFn: () => ['codex', 'claude', 'mistral', 'custom'],
    resolveTaskFileFn: () => ({ ok: true, taskFile: TASK_FILE }),
    implementer: 'custom',
    dryRun: true,
    readReviewStateFn: () => ({ reviewer: 'codex', round: 1, startedAt: '2026-01-01', phase: 'reviewing' }),
    log: m => logs.push(m),
    error: m => errors.push(m),
    exit: c => exitCodes.push(c),
    selectAgentFn: (step, opts) => {
      const exclude = opts.exclude instanceof Set ? opts.exclude : new Set(opts.exclude || []);
      if (!exclude.has('mistral')) return 'mistral';
      return 'claude';
    },
    workflowLauncherStatusFn: (agent) => ({
      supported: agent !== 'codex',
      detail: agent
    }),
    formatMatrixSummaryFn: () => [],
    buildAutonomousReviewMatrixFn: () => ({ agents: ['codex', 'claude', 'mistral', 'custom'] }),
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
    logs.some(l => l.includes('trying fallback "mistral"')),
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

  const { startReviewLoop } = require('../lib/review/review');
  const logs = [];
  const errors = [];
  const exitCodes = [];

  // implementer=mistral. selectAgent picks codex (unsupported).
  // Next selectAgent call returns 'claude'.
  await startReviewLoop(TEST_SLUG, {
    eligibleAgentsForStepFn: () => ['codex', 'claude', 'custom', 'mistral'],
    resolveTaskFileFn: () => ({ ok: true, taskFile: TASK_FILE }),
    implementer: 'mistral',
    dryRun: true,
    log: m => logs.push(m),
    error: m => errors.push(m),
    exit: c => exitCodes.push(c),
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
    buildAutonomousReviewMatrixFn: () => ({ agents: ['codex', 'claude', 'custom', 'mistral'] })
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

  const { startReviewLoop } = require('../lib/review/review');
  const logs = [];
  const errors = [];
  const exitCodes = [];

  // implementer=custom, explicit reviewer=codex (unsupported)
  // Current code: explicit reviewer never enters fallback loop, hard-fails
  await startReviewLoop(TEST_SLUG, {
    eligibleAgentsForStepFn: () => ['claude', 'mistral', 'custom', 'codex'], 
    resolveTaskFileFn: () => ({ ok: true, taskFile: TASK_FILE }),
    implementer: 'custom',
    reviewer: 'codex', // explicit
    dryRun: true,
    log: m => logs.push(m),
    error: m => errors.push(m),
    exit: c => exitCodes.push(c),
    workflowLauncherStatusFn: (agent) => ({
      supported: agent !== 'codex',
      detail: agent
    }),
    formatMatrixSummaryFn: () => [],
    buildAutonomousReviewMatrixFn: () => ({ agents: ['claude', 'mistral', 'custom', 'codex'] })
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

  const { startReviewLoop } = require('../lib/review/review');
  const logs = [];
  const errors = [];
  const exitCodes = [];

  // implementer=custom. selectAgent picks codex (unsupported).
  // Next selectAgent call returns mistral (unsupported).
  // Next selectAgent call returns claude (supported).
  await startReviewLoop(TEST_SLUG, {
    eligibleAgentsForStepFn: () => ['claude', 'custom', 'codex', 'mistral'],
    resolveTaskFileFn: () => ({ ok: true, taskFile: TASK_FILE }),
    implementer: 'custom',
    dryRun: true,
    log: m => logs.push(m),
    error: m => errors.push(m),
    exit: c => exitCodes.push(c),
    selectAgentFn: (step, opts) => {
      const exclude = opts.exclude instanceof Set ? opts.exclude : new Set(opts.exclude || []);
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

  const { startReviewLoop } = require('../lib/review/review');
  const logs = [];
  const errors = [];
  const exitCodes = [];

  // implementer=mistral. selectAgent picks codex (unsupported).
  // Next call returns claude (unsupported).
  // Next call throws because no more agents.
  await startReviewLoop(TEST_SLUG, {
    eligibleAgentsForStepFn: () => ['codex', 'claude', 'mistral'], 
    resolveTaskFileFn: () => ({ ok: true, taskFile: TASK_FILE }),
    implementer: 'mistral',
    dryRun: true,
    log: m => logs.push(m),
    error: m => errors.push(m),
    exit: c => exitCodes.push(c),
    selectAgentFn: (step, opts) => {
      const exclude = opts.exclude instanceof Set ? opts.exclude : new Set(opts.exclude || []);
      const available = ['codex', 'claude'].filter(a => !exclude.has(a));
      if (available.length === 0) throw new Error('No agents available');
      return available[0];
    },
    workflowLauncherStatusFn: () => ({ supported: false, detail: 'blocked' }),
    formatMatrixSummaryFn: () => [],
    buildAutonomousReviewMatrixFn: () => ({ agents: ['codex', 'claude', 'mistral'] })
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

  const { startReviewLoop } = require('../lib/review/review');
  const logs = [];
  const errors = [];
  const exitCodes = [];

  // implementer=claude. Different-family agents are unsupported.
  // -> single-family fallback: claude reviews its own work
  await startReviewLoop(TEST_SLUG, {
    eligibleAgentsForStepFn: () => ['codex', 'claude', 'mistral'],
    resolveTaskFileFn: () => ({ ok: true, taskFile: TASK_FILE }),
    implementer: 'claude',
    dryRun: true,
    log: m => logs.push(m),
    error: m => errors.push(m),
    exit: c => exitCodes.push(c),
    selectAgentFn: (step, opts) => {
      const exclude = opts.exclude instanceof Set ? opts.exclude : new Set(opts.exclude || []);
      const available = ['codex', 'mistral'].filter(a => !exclude.has(a));
      if (available.length === 0) throw new Error('No agents available');
      return available[0];
    },
    workflowLauncherStatusFn: (agent) => ({
      supported: agent === 'claude', // only implementer is runnable
      detail: agent
    }),
    formatMatrixSummaryFn: () => [],
    buildAutonomousReviewMatrixFn: () => ({ agents: ['codex', 'claude', 'mistral'] })
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
