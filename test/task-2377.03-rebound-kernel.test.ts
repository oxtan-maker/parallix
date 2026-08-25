/**
 * TASK-2377.03 — rebound kernel contract, classification, verify loop, budget.
 *
 * Mock-only: `startAgent` and `verify` are injected; no real agents, no git,
 * no Forgejo.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  rebound,
  classifyReboundReason,
  buildReboundFixPrompt,
  reboundDiagnostic,
  DEFAULT_REBOUND_ATTEMPTS,
  type ReboundContext,
  type ReboundReason,
} from '../src/application/rebound-kernel.js';

const gateReason: ReboundReason = {
  kind: 'gate-failure',
  area: 'static-analysis',
  command: './scripts/verify-local.sh static-analysis',
  exitCode: 1,
  stdout: 'failing test: preserves diagnostic',
  stderr: '',
  error: 'verification gate failed with exit code 1',
};

const hookReason: ReboundReason = {
  kind: 'hook-failure',
  hook: 'pre-commit',
  operation: 'pre-review safety commit',
  output: 'pre-commit hook failed: lint error',
};

/** Context with silent logging and an injected launch/verify pair. */
function contextFor(overrides: Partial<ReboundContext> = {}): ReboundContext {
  return {
    slug: 'task-2377.03-fixture',
    worktree: '/tmp/task-2377.03-fixture',
    implementer: 'codex',
    verify: () => ({ ok: true }),
    startAgent: async () => ({ agent: 'codex', result: { status: 0 } }),
    log: () => {},
    error: () => {},
    ...overrides,
  };
}

// ── Classification (ADR 0048 single table) ───────────────────────────────────

test('task-2377.03: a declared gate that ran and exited non-zero classifies as GateFailure, not a Git blocker', () => {
  const classification = classifyReboundReason(gateReason);
  assert.equal(classification.failureClass, 'GateFailure');
  assert.equal(classification.dispatchAction, 'AutoSendBack');
  assert.equal(classification.isRelaunchable, true);
});

test('task-2377.03: a Git hook failure classifies as a mechanical GitBlockers auto-repair', () => {
  const classification = classifyReboundReason(hookReason);
  assert.equal(classification.failureClass, 'GitBlockers');
  assert.equal(classification.dispatchAction, 'AutoRepair');
  assert.equal(classification.isRelaunchable, true);
});

test('task-2377.03: an artifact-incomplete reason classifies as IncompleteEvidence auto-send-back', () => {
  const classification = classifyReboundReason({
    kind: 'artifact-incomplete',
    role: 'reviewer',
    diagnostic: 'Reviewer produced no review verdict file',
  });
  assert.equal(classification.failureClass, 'IncompleteEvidence');
  assert.equal(classification.dispatchAction, 'AutoSendBack');
});

test('task-2377.03: an agent-timeout reason classifies as incomplete evidence and gets the shared rebound budget', () => {
  const classification = classifyReboundReason({ kind: 'agent-timeout', role: 'reviewer' });
  assert.equal(classification.failureClass, 'IncompleteEvidence');
  assert.equal(classification.dispatchAction, 'AutoSendBack');
  assert.equal(classification.isRelaunchable, true);
});

test('task-2413: an agent-timeout carrying explicit infrastructure evidence does not burn repair attempts', async () => {
  let launches = 0;
  const outcome = await rebound({
    kind: 'agent-timeout', role: 'reviewer', diagnostic: 'forgejo connection refused',
  }, contextFor({ startAgent: async () => { launches++; return { result: { status: 0 } }; } }));
  assert.equal(outcome.outcome, 'human-only');
  assert.equal(outcome.classification.failureClass, 'InfraBlocker');
  assert.equal(launches, 0);
});

test('task-2377.03: a handoff-verification reason classifies from its own ADR 0048 error text', () => {
  const classification = classifyReboundReason({
    kind: 'handoff-verification',
    error: 'checkpoint is missing a "## Goal Check" section',
  });
  assert.equal(classification.failureClass, 'IncompleteEvidence');
  assert.equal(classification.dispatchAction, 'AutoSendBack');
});

test('task-2377.03: the human-only rule inside the classifier keeps an infrastructure gate diagnostic human-only', () => {
  const classification = classifyReboundReason({
    ...(gateReason as { kind: 'gate-failure' } & typeof gateReason),
    stdout: '',
    stderr: 'forgejo authentication failed: token expired',
    error: undefined,
  });
  assert.equal(classification.failureClass, 'InfraBlocker');
  assert.equal(classification.dispatchAction, 'HumanOnly');
  assert.equal(classification.isRelaunchable, false);
});

test('task-2377.03: the human-only rule keeps a state-machine gate diagnostic human-only', () => {
  const classification = classifyReboundReason({
    ...(gateReason as { kind: 'gate-failure' } & typeof gateReason),
    stdout: '',
    stderr: 'transition not allowed for this task',
    error: undefined,
  });
  assert.equal(classification.failureClass, 'StateMachineViolation');
  assert.equal(classification.dispatchAction, 'HumanOnly');
});

test('task-2377.03: an unrecognized gate diagnostic still bounces instead of stranding as the classifier default', () => {
  const classification = classifyReboundReason({
    ...(gateReason as { kind: 'gate-failure' } & typeof gateReason),
    stdout: 'AssertionError [ERR_ASSERTION]: expected 3 to equal 4',
    stderr: '',
    error: undefined,
  });
  assert.equal(classification.failureClass, 'GateFailure');
  assert.equal(classification.isRelaunchable, true);
});

test('task-2377.03: reboundDiagnostic flattens structured reasons without regex on combined text', () => {
  assert.match(reboundDiagnostic(gateReason), /failing test: preserves diagnostic/);
  assert.equal(reboundDiagnostic(hookReason), 'pre-commit hook failed: lint error');
  assert.match(reboundDiagnostic({ kind: 'agent-timeout', role: 'reviewer' }), /reviewer did not respond/);
});

// ── Contract: human-only never launches ──────────────────────────────────────

test('task-2377.03: an agent timeout uses the shared rebound launch and verify loop', async () => {
  let launches = 0;
  const outcome = await rebound(
    { kind: 'agent-timeout', role: 'reviewer' },
    contextFor({ startAgent: async () => { launches++; return { agent: 'codex', result: { status: 0 } }; } }),
  );
  assert.equal(outcome.outcome, 'fixed');
  assert.equal(outcome.attempts, 1);
  assert.equal(launches, 1);
});

// ── Fix prompt (single builder) ──────────────────────────────────────────────

test('task-2377.03: the single fix-prompt builder carries the compaction boilerplate and the automatic re-verify statement', async () => {
  const prompts: string[] = [];
  await rebound(gateReason, contextFor({
    startAgent: async (_step, options: any) => {
      prompts.push(options.prompt('codex'));
      return { agent: 'codex', result: { status: 0 } };
    },
  }));
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /PRE-REVIEW GATE FAILURE — FIX REQUIRED/);
  assert.match(prompts[0], /Gate command: \.\/scripts\/verify-local\.sh static-analysis/);
  assert.match(prompts[0], /Classification: GateFailure — AutoSendBack/);
  assert.match(prompts[0], /Retry attempt: 1\/2/);
  assert.match(prompts[0], /Before repair work, compact the aborted working context/i);
  assert.match(prompts[0], /current review round and disposition; unresolved findings and implementer resolutions/i);
  assert.match(prompts[0], /The failing check re-runs automatically after your fix/);
});

test('task-2377.03: the hook fix prompt uses the same builder with hook slots', () => {
  const classification = classifyReboundReason(hookReason);
  const prompt = buildReboundFixPrompt({
    label: classification.label,
    slug: 'task-2377.03-fixture',
    area: 'pre-commit',
    facts: [['Hook type', 'pre-commit']],
    diagnostic: 'pre-commit hook failed: lint error',
    classification,
    attempt: 1,
    maxAttempts: DEFAULT_REBOUND_ATTEMPTS,
    remedy: 'Fix the underlying issue so the Git hook passes.',
  });
  assert.match(prompt, /GIT HOOK FAILURE — FIX REQUIRED/);
  assert.match(prompt, /Before repair work, compact the aborted working context/i);
  assert.match(prompt, /The failing check re-runs automatically after your fix/);
});

test('task-2386: the rebound fix prompt states a stage-specific execute-verify-report contract', () => {
  const classification = classifyReboundReason(hookReason);
  const prompt = buildReboundFixPrompt({
    label: classification.label,
    slug: 'task-2386',
    area: 'workflow',
    facts: [['Hook type', 'pre-commit']],
    diagnostic: 'pre-commit hook failed: lint error',
    classification,
    attempt: 1,
    maxAttempts: DEFAULT_REBOUND_ATTEMPTS,
    remedy: 'Fix the underlying issue so the Git hook passes.',
  });
  assert.match(prompt, /Perform this stage-specific repair now/);
  assert.match(prompt, /Verify the required result/i);
  assert.doesNotMatch(prompt, /listed commands|rebase/i);
});

test('task-2413: rebound preserves role-family exclusions for fallback selection', async () => {
  let exclude: unknown;
  await rebound(gateReason, contextFor({
    exclude: ['claude'],
    startAgent: async (_step, options: any) => {
      exclude = options.exclude;
      return { agent: 'codex', result: { status: 0 } };
    },
  }));
  assert.deepEqual(exclude, ['claude']);
});

// ── Verify loop, budget, and launch failures (SC2 / SC3 / SC4) ───────────────

test('task-2377.03: a failing verify consumes one attempt and relaunches with the fresh diagnostic', async () => {
  const prompts: string[] = [];
  const verifyDiagnostics = ['second-run diagnostic: 2 tests still failing'];
  const outcome = await rebound(gateReason, contextFor({
    startAgent: async (_step, options: any) => {
      prompts.push(options.prompt('codex'));
      return { agent: 'codex', result: { status: 0 } };
    },
    verify: () => verifyDiagnostics.length
      ? { ok: false, diagnostic: verifyDiagnostics.shift()! }
      : { ok: true },
  }));

  assert.equal(outcome.outcome, 'fixed');
  assert.equal(outcome.attempts, 2, 'the failed verify consumed the first attempt');
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /failing test: preserves diagnostic/);
  assert.match(prompts[1], /second-run diagnostic: 2 tests still failing/, 'the relaunch carries the fresh diagnostic');
  assert.match(prompts[1], /Retry attempt: 2\/2/);
});

test('task-2377.03: two failed verifies exhaust the default budget with the last diagnostic and no third launch', async () => {
  let launches = 0;
  let verifyRuns = 0;
  const outcome = await rebound(gateReason, contextFor({
    startAgent: async () => { launches++; return { agent: 'codex', result: { status: 0 } }; },
    verify: () => { verifyRuns++; return { ok: false, diagnostic: `still failing after attempt ${verifyRuns}` }; },
  }));

  assert.equal(outcome.outcome, 'exhausted');
  assert.equal(outcome.attempts, DEFAULT_REBOUND_ATTEMPTS);
  assert.equal(launches, 2, 'the budget is spent after two launches — there is no third');
  assert.equal(verifyRuns, 2);
  assert.equal(outcome.diagnostic, 'still failing after attempt 2', 'exhaustion carries the last diagnostic');
});

test('task-2377.03: an outcome of fixed is returned only after verify passes', async () => {
  let verifyRuns = 0;
  const outcome = await rebound(gateReason, contextFor({
    verify: () => { verifyRuns++; return { ok: true }; },
  }));
  assert.equal(outcome.outcome, 'fixed');
  assert.equal(outcome.attempts, 1);
  assert.equal(verifyRuns, 1, 'the failing check must re-run before a fix is claimed');
});

test('task-2377.03: an ambiguous null agent exit is a launch failure, never fixed, and consumes budget', async () => {
  let launches = 0;
  let verifyRuns = 0;
  const outcome = await rebound(gateReason, contextFor({
    startAgent: async () => { launches++; return { agent: 'codex', result: { status: null } }; },
    verify: () => { verifyRuns++; return { ok: true }; },
  }));

  assert.equal(outcome.outcome, 'exhausted', 'a null-exit fix is no evidence of a fix');
  assert.equal(launches, DEFAULT_REBOUND_ATTEMPTS, 'each null exit consumes one attempt');
  assert.equal(verifyRuns, 0, 'a failed launch is not verified as a fix');
  assert.match(outcome.diagnostic, /ambiguous exit status \(null\)/);
});

test('task-2377.03: a null-exit first attempt still allows a verified fix inside the same budget', async () => {
  const statuses: Array<number | null> = [null, 0];
  const outcome = await rebound(gateReason, contextFor({
    startAgent: async () => ({ agent: 'codex', result: { status: statuses.shift()! } }),
    verify: () => ({ ok: true }),
  }));
  assert.equal(outcome.outcome, 'fixed');
  assert.equal(outcome.attempts, 1, 'only the completed repair attempt is charged; the launcher retry has its own budget');
});

test('task-2377.03: a throwing launch is a failed attempt, not a fix', async () => {
  const outcome = await rebound(gateReason, contextFor({
    startAgent: async () => { throw new Error('no eligible agent'); },
  }));
  assert.equal(outcome.outcome, 'exhausted');
  assert.match(outcome.diagnostic, /Could not launch implementer \(codex\): no eligible agent/);
});

test('task-2377.03: the budget is per occurrence — a second invocation after an exhausted one starts fresh', async () => {
  const failing = contextFor({ verify: () => ({ ok: false, diagnostic: 'still failing' }) });
  const first = await rebound(gateReason, failing);
  assert.equal(first.outcome, 'exhausted');

  let secondLaunches = 0;
  const second = await rebound(gateReason, contextFor({
    startAgent: async () => { secondLaunches++; return { agent: 'codex', result: { status: 0 } }; },
    verify: () => (secondLaunches < 2 ? { ok: false, diagnostic: 'still failing' } : { ok: true }),
  }));
  assert.equal(second.outcome, 'fixed');
  assert.equal(second.attempts, 2, 'the next occurrence of the same failure class gets a full budget of 2');
});

test('task-2377.03: the budget is configurable per occurrence and never read from persisted state', async () => {
  let launches = 0;
  const outcome = await rebound(gateReason, contextFor({
    maxAttempts: 3,
    startAgent: async () => { launches++; return { agent: 'codex', result: { status: 0 } }; },
    verify: () => ({ ok: false, diagnostic: 'still failing' }),
  }));
  assert.equal(outcome.outcome, 'exhausted');
  assert.equal(launches, 3);
});

test('task-2377.03: the kernel writes nothing to a state store while spending a whole budget', async () => {
  const writes: string[] = [];
  const failOnWriteStore = {
    writeReviewState: (..._args: unknown[]) => { writes.push('writeReviewState'); throw new Error('the kernel must not persist retry state'); },
    persistReviewState: (..._args: unknown[]) => { writes.push('persistReviewState'); throw new Error('the kernel must not persist retry state'); },
    upsertMission: (..._args: unknown[]) => { writes.push('upsertMission'); throw new Error('the kernel must not persist retry state'); },
  };
  // The store is offered to the kernel the only way it could reach one: through
  // the context object. The kernel's context has no state-store slot, so a run
  // that spends the whole budget must leave every write method untouched.
  const outcome = await rebound(gateReason, {
    ...contextFor({ verify: () => ({ ok: false, diagnostic: 'still failing' }) }),
    ...(failOnWriteStore as unknown as Record<string, never>),
  });
  assert.equal(outcome.outcome, 'exhausted');
  assert.deepEqual(writes, [], 'no review-state or SQLite write may originate in the kernel');
});

test('task-2377.03: the kernel returns the fallback-resolved implementer and moves the task to the implementer phase', async () => {
  const transitions: string[] = [];
  const outcome = await rebound(gateReason, contextFor({
    transitionToImplementer: (slug: string) => { transitions.push(slug); },
    applyAgentFallback: () => 'claude',
  }));
  assert.equal(outcome.outcome, 'fixed');
  assert.equal(outcome.implementer, 'claude');
  assert.deepEqual(transitions, ['task-2377.03-fixture']);
});

// ── SC6: exactly one prompt-construction site for the incident path ──────────

test('task-2377.03: the context-compaction boilerplate exists in exactly one source location', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const walk = (dir: string): string[] => readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : (full.endsWith('.ts') ? [full] : []);
  });
  const holders = walk('src')
    .filter(file => readFileSync(file, 'utf8').includes('compact the aborted working context'));
  assert.deepEqual(
    holders.map(file => file.replace(/\\/g, '/')),
    ['src/application/rebound-kernel.ts'],
    'the compaction boilerplate belongs to the single rebound fix-prompt builder',
  );
});

test('task-2377.03: the pre-review gate and hook paths build no prompt of their own', async () => {
  const { readFileSync } = await import('node:fs');
  for (const file of ['src/adapters/review/review-gate-handling.ts', 'src/adapters/review/review-loop.ts']) {
    const source = readFileSync(file, 'utf8');
    assert.ok(!source.includes('FIX REQUIRED'), `${file} must not construct a fix prompt`);
    assert.ok(!source.includes('Retry attempt:'), `${file} must not render its own retry counter`);
  }
});
