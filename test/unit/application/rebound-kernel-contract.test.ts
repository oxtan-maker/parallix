// Historical regression provenance: TASK-2413, TASK-2369.13, TASK-2492.
// Rebound kernel contract: the single repair loop (classification, per-occurrence budget, fix prompts,
// root-failure dossier, output elision) shared by every automatic bounce.
//
// Behavior-owned suite (TASK-2622.12). Case names are unchanged; each section keeps its historical
// task provenance and the legacy file it replaced.
//   Rebound kernel: TASK-2377.03 (also TASK-2413, TASK-2525.05, TASK-2588, TASK-2620, TASK-2386)
//   Recovery dossier: TASK-2413
//   Bounce output elision: TASK-2369.13
//   Integration gate rebound: TASK-2492

import assert from 'node:assert/strict';
import test, { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { mkdtemp } from '../../helpers/temp-dir.js';
import { INTEGRATION_GATE_REBOUND_ATTEMPTS_PER_INVOCATION, integrationGateFailureReason, integrationOnlyCoverageNote, routeIntegrationGateFailure, type IntegrationGateRouteOptions } from '../../../src/adapters/cli/commands/integrate-gate-rebound.js';
import type { GateRunOutcome } from '../../../src/adapters/config/repository-gates.js';
import { gateFailureReason } from '../../../src/adapters/review/review-gate-handling.js';
import { elideBounceOutput, BOUNCE_OUTPUT_MAX_CHARS } from '../../../src/application/output-elision.js';
import { rebound, classifyReboundReason, buildReboundFixPrompt, reboundDiagnostic, DEFAULT_REBOUND_ATTEMPTS, type ReboundContext, type ReboundReason } from '../../../src/application/rebound-kernel.js';
import { listRecoveryEvidence } from '../../../src/application/recovery-evidence.js';

// ── Rebound kernel — TASK-2377.03 (was task-2377.03-rebound-kernel.test.ts) ──
/**
 * TASK-2377.03 — rebound kernel contract, classification, verify loop, budget.
 *
 * Mock-only: `startAgent` and `verify` are injected; no real agents, no git,
 * no Forgejo.
 */


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

/** Observed px integrate output (TASK-2663): a passing title containing `forbidden`, then a CPU-budget failure. */
const passingForbiddenTitleCpuStdout = [
  '✔ R8: direct review → done forbidden — integrate requires integration status (12.4ms)',
  'integration-test-cpu:exceeded test/integration/cli/headless-cli.test.ts used 2.043s CPU (budget 2.000s)',
].join('\n');

test('TASK-2663: a passing test title containing a human-only keyword does not strand a repairable CPU-budget gate failure', () => {
  const classification = classifyReboundReason({
    kind: 'gate-failure',
    area: 'integration-local',
    command: './scripts/verify-local.sh integration-local',
    exitCode: 1,
    stdout: passingForbiddenTitleCpuStdout,
    stderr: '',
  });
  assert.equal(classification.failureClass, 'GateFailure');
  assert.equal(classification.dispatchAction, 'AutoSendBack');
  assert.equal(classification.isRelaunchable, true);
});

test('TASK-2663: passing TAP and spec titles naming unauthorized access in stderr do not escalate a verification-gate failure', () => {
  const classification = classifyReboundReason({
    ...(gateReason as { kind: 'gate-failure' } & typeof gateReason),
    stdout: 'ok 14 - rejects unauthorized access to the review queue',
    stderr: '  ✓ maps forgejo authentication failed to a typed error\nnot ok 15 - preserves diagnostic',
    error: undefined,
  });
  assert.equal(classification.failureClass, 'GateFailure');
  assert.equal(classification.dispatchAction, 'AutoSendBack');
  assert.equal(classification.isRelaunchable, true);
});

test('TASK-2663: genuine infrastructure evidence beside passing output still dispatches HumanOnly', () => {
  const classification = classifyReboundReason({
    kind: 'gate-failure',
    area: 'integration-local',
    command: './scripts/verify-local.sh integration-local',
    exitCode: 1,
    stdout: passingForbiddenTitleCpuStdout,
    stderr: '',
    error: 'forgejo authentication failed: token expired',
  });
  assert.equal(classification.failureClass, 'InfraBlocker');
  assert.equal(classification.dispatchAction, 'HumanOnly');
  assert.equal(classification.isRelaunchable, false);
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

test('task-2620 AC3: the gate fix prompt names the approved revision and states integration (not review) failed', async () => {
  const prompts: string[] = [];
  await rebound(
    { ...gateReason, area: 'integration gate agent-smoke', approvedRevision: 'abc1234' },
    contextFor({
      startAgent: async (_step, options: any) => {
        prompts.push(options.prompt('codex'));
        return { agent: 'codex', result: { status: 0 } };
      },
    }),
  );
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /Approved revision: abc1234/);
  assert.match(prompts[0], /integration gate agent-smoke/);
  assert.match(prompts[0], /The integration gate \(not the review gate\) failed/);
  assert.match(prompts[0], /reviewed and approved, then a red pre-integration gate/);
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

test('task-2377.03: the budget is per occurrence — a second invocation after an exhausted one starts fresh', async t => {
  await t.test('an exhausted occurrence leaves no retry state behind', async () => {
    const failing = contextFor({ verify: () => ({ ok: false, diagnostic: 'still failing' }) });
    const first = await rebound(gateReason, failing);
    assert.equal(first.outcome, 'exhausted');
  });

  await t.test('the next occurrence receives its full budget', async () => {
    let secondLaunches = 0;
    const second = await rebound(gateReason, contextFor({
      startAgent: async () => { secondLaunches++; return { agent: 'codex', result: { status: 0 } }; },
      verify: () => (secondLaunches < 2 ? { ok: false, diagnostic: 'still failing' } : { ok: true }),
    }));
    assert.equal(second.outcome, 'fixed');
    assert.equal(second.attempts, 2, 'the next occurrence of the same failure class gets a full budget of 2');
  });
});

test('task-2377.03: the budget is configurable per occurrence and never read from persisted state', async () => {
  let launches = 0;
  const outcome = await rebound(gateReason, contextFor({
    maxAttempts: 1,
    startAgent: async () => { launches++; return { agent: 'codex', result: { status: 0 } }; },
    verify: () => ({ ok: false, diagnostic: 'still failing' }),
  }));
  assert.equal(outcome.outcome, 'exhausted');
  assert.equal(launches, 1);
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
  for (const file of ['src/adapters/review/review-gate-handling.ts', 'src/adapters/review/review-loop.ts', 'src/application/review-loop/pre-review.ts']) {
    const source = readFileSync(file, 'utf8');
    assert.ok(!source.includes('FIX REQUIRED'), `${file} must not construct a fix prompt`);
    assert.ok(!source.includes('Retry attempt:'), `${file} must not render its own retry counter`);
  }
});

// ── Transient rerun keeps the original diagnostic in the fix prompt ──────────

test('task-2525.05: a transient gate rerun preserves the original diagnostic in the fix prompt', async () => {
  const transientReason: ReboundReason = { ...gateReason, transient: true, stdout: 'ORIGINAL_GATE_OUTPUT' };
  let capturedPrompt = '';
  let verifyCalls = 0;

  await rebound(transientReason, contextFor({
    maxAttempts: 1,
    verify: () => {
      verifyCalls += 1;
      return { ok: false, diagnostic: 'REFRESHED_GATE_OUTPUT' };
    },
    startAgent: async (_step, options: any) => {
      capturedPrompt = options.prompt('codex');
      return { agent: 'codex', result: { status: 0 } };
    },
  }));

  // The transient rerun refreshed the diagnostic, so the prompt must show both:
  // what the check reports now, and what the mission originally bounced on.
  assert.ok(verifyCalls > 1, 'the transient reason should be rerun before an implementer is launched');
  assert.match(capturedPrompt, /REFRESHED_GATE_OUTPUT/);
  assert.match(capturedPrompt, /ORIGINAL_GATE_OUTPUT/);
});

test('task-2588: targeted failure then fresh diagnostic success keeps both verifier passes and strategies', async () => {
  const launches: any[] = []; const logs: string[] = []; let verifies = 0;
  const outcome = await rebound(gateReason, contextFor({
    verify: () => ({ ok: ++verifies === 2, diagnostic: verifies === 1 ? 'LATEST_FAILURE' : '' }),
    startAgent: async (_step, options: any) => { launches.push(options); return { agent: 'codex', result: { status: 0 } }; },
    log: message => logs.push(message),
  }));
  assert.equal(outcome.outcome, 'fixed'); assert.equal(launches.length, 2); assert.equal(verifies, 2);
  assert.equal(launches[0].sessionPolicy, 'resume'); assert.equal(launches[1].sessionPolicy, 'fresh-ephemeral');
  const freshPrompt = launches[1].prompt('codex'); assert.match(freshPrompt, /LATEST_FAILURE/); assert.match(freshPrompt, /failing test: preserves diagnostic/);
  assert.deepEqual(outcome.attemptsDetail?.map(a => a.strategy), ['targeted', 'fresh-diagnostic']);
  assert.ok(logs.some(line => line.includes('RECOVERY_TELEMETRY strategy=targeted outcome=advance')));
  assert.ok(logs.some(line => line.includes('RECOVERY_TELEMETRY strategy=fresh-diagnostic outcome=rescue')));
});

test('task-2588: fresh failure escalates after two strategies with no false pass', async () => {
  let launches = 0; const logs: string[] = [];
  const outcome = await rebound(gateReason, contextFor({ verify: () => ({ ok: false, diagnostic: 'STILL_RED' }), startAgent: async () => ({ result: { status: 0, }, agent: (++launches, 'codex') }), log: message => logs.push(message) }));
  assert.equal(outcome.outcome, 'exhausted'); assert.equal(launches, 2); assert.match(outcome.dossier || '', /fresh-diagnostic/); assert.ok(!/PASS|APPROVED/.test(outcome.dossier || ''));
  assert.ok(logs.some(line => line.includes('RECOVERY_TELEMETRY strategy=targeted outcome=advance')));
  assert.ok(logs.some(line => line.includes('RECOVERY_TELEMETRY strategy=fresh-diagnostic outcome=escalate')));
});

test('task-2588: targeted success launches once and emits stable pass telemetry', async () => {
  const launches: any[] = []; const logs: string[] = [];
  const outcome = await rebound(gateReason, contextFor({
    startAgent: async (_step, options: any) => (launches.push(options), { agent: 'codex', result: { status: 0 } }),
    log: message => logs.push(message),
  }));
  assert.equal(outcome.outcome, 'fixed');
  assert.equal(launches.length, 1); assert.equal(launches[0].sessionPolicy, 'resume');
  assert.ok(logs.some(line => line.includes('RECOVERY_TELEMETRY strategy=targeted outcome=pass')));
});

test('task-2588: no HEAD change and same failure escalate with per-attempt evidence', async () => {
  const outcome = await rebound(gateReason, contextFor({
    readHead: () => 'head-unchanged', verify: () => ({ ok: false, diagnostic: gateReason.stdout, reason: gateReason }),
  }));
  assert.equal(outcome.outcome, 'exhausted'); assert.equal(outcome.attempts, 2);
  assert.deepEqual(outcome.attemptsDetail?.map(detail => [detail.headBefore, detail.headAfter, detail.fingerprintBefore === detail.fingerprintAfter]), [
    ['head-unchanged', 'head-unchanged', true], ['head-unchanged', 'head-unchanged', true],
  ]);
});

test('task-2588: changed code with the same failure still exhausts the bounded budget', async () => {
  let head = 'before'; let launches = 0;
  const outcome = await rebound(gateReason, contextFor({
    readHead: () => head,
    startAgent: async () => { head = `after-${++launches}`; return { agent: 'codex', result: { status: 0 } }; },
    verify: () => ({ ok: false, diagnostic: gateReason.stdout }),
  }));
  assert.equal(outcome.outcome, 'exhausted'); assert.equal(launches, 2);
  assert.deepEqual(outcome.attemptsDetail?.map(detail => [detail.headBefore, detail.headAfter]), [['before', 'after-1'], ['after-1', 'after-2']]);
});

test('task-2588: a changed failure after attempt one remains bounded at two launches', async () => {
  let launches = 0; let verifies = 0;
  const outcome = await rebound(gateReason, contextFor({
    startAgent: async () => ({ agent: 'codex', result: { status: 0 }, ...(launches++, {}) }),
    verify: () => ({ ok: false, diagnostic: ++verifies === 1 ? 'SECOND_FAILURE' : 'THIRD_FAILURE' }),
  }));
  assert.equal(outcome.outcome, 'exhausted'); assert.equal(launches, 2);
  assert.equal(outcome.attemptsDetail?.[0].fingerprintAfter, outcome.attemptsDetail?.[1].fingerprintBefore);
  assert.notEqual(outcome.attemptsDetail?.[0].fingerprintBefore, outcome.attemptsDetail?.[0].fingerprintAfter);
});

test('task-2588: fresh repair observes the commit created by targeted repair', async () => {
  let head = 'base'; const headsAtLaunch: string[] = []; let verifies = 0;
  const outcome = await rebound(gateReason, contextFor({
    readHead: () => head,
    startAgent: async () => { headsAtLaunch.push(head); head = headsAtLaunch.length === 1 ? 'targeted-commit' : 'fresh-commit'; return { agent: 'codex', result: { status: 0 } }; },
    verify: () => ({ ok: ++verifies === 2, diagnostic: 'still red' }),
  }));
  assert.equal(outcome.outcome, 'fixed'); assert.deepEqual(headsAtLaunch, ['base', 'targeted-commit']);
});

test('task-2642: a failed relaunch persists as a distinct attempt in the original incident', async () => {
  // Hermetic: `startAgent` and `verify` are injected; no real agents, git, or
  // Forgejo. The worktree is a real temp dir so the recovery store writes and
  // reads genuine files. The verify stays red on every launch so the kernel
  // relaunches the per-occurrence budget and each failed relaunch reaches the
  // retry-capture path.
  const worktree = mkdtemp('task-2642-rebound-retry-');
  const outcome = await rebound(gateReason, contextFor({
    slug: 'task-2642',
    worktree,
    readHead: () => 'head-unchanged',
    verify: () => ({ ok: false, diagnostic: gateReason.stdout, reason: gateReason }),
  }));
  assert.equal(outcome.outcome, 'exhausted');
  assert.equal(outcome.attempts, DEFAULT_REBOUND_ATTEMPTS);
  // The original failure and both failed relaunches survive as distinct attempts
  // in one incident, so a restarted agent sees the whole recovery series rather
  // than only the latest failure.
  const refs = listRecoveryEvidence({ cwd: worktree, missionId: 'task-2642' });
  assert.equal(new Set(refs.map((ref) => ref.incidentId)).size, 1, 'one incident holds the whole recovery series');
  assert.deepEqual(refs.map((ref) => ref.attempt).sort((a, b) => a - b), [1, 2, 3], 'original plus each failed relaunch as its own attempt');
  const incidentDir = path.join(worktree, '.workflow', 'recovery-evidence', 'task-2642', refs[0].incidentId);
  for (const ref of refs) {
    assert.ok(fs.existsSync(path.join(incidentDir, `attempt-${ref.attempt}.stdout.txt`)), `stream for attempt ${ref.attempt} is retained`);
    assert.ok(fs.existsSync(path.join(incidentDir, `attempt-${ref.attempt}.stderr.txt`)), `stream for attempt ${ref.attempt} is retained`);
  }
});

// ── Recovery dossier — TASK-2413 (was task-2413-recovery-dossier.test.ts) ──
/**
 * TASK-2413 CP-4: genuine recovery exhaustion retains a bounded, structured
 * dossier instead of collapsing to a generic "Manual intervention required"
 * wrapper.
 *
 * Hermetic: `startAgent` and `verify` are injected; no real agents, git, or
 * Forgejo. Runs in the default unit suite.
 */
describe("Recovery dossier —", () => {
  const gateReason: ReboundReason = {
    kind: 'gate-failure',
    area: 'docs',
    command: './scripts/verify-local.sh docs',
    exitCode: 1,
    stdout: 'AssertionError: expected 1 == 2',
    stderr: '',
    error: 'verification gate failed with exit code 1',
  };

  function exhaustingContext(overrides: Partial<ReboundContext> = {}): ReboundContext {
    return {
      slug: 'task-2413-exhaust',
      worktree: '/tmp/task-2413-exhaust',
      implementer: 'codex',
      startAgent: async () => ({ agent: 'codex', result: { status: 0 } }),
      verify: () => ({ ok: false, diagnostic: 'still failing after attempt N' }),
      log: () => {},
      error: () => {},
      ...overrides,
    };
  }

  test('task-2413: an exhausted recovery retains the structured root-failure dossier', async () => {
    const outcome = await rebound(gateReason, exhaustingContext());

    // Stop reason: the per-occurrence budget was spent.
    assert.equal(outcome.outcome, 'exhausted');
    assert.equal(outcome.attempts, DEFAULT_REBOUND_ATTEMPTS, 'attempt history records every spent attempt');

    // Root failure class and its prescribed action survive (GateFailure /
    // AutoSendBack) — not replaced by a generic wrapper that would misclassify
    // the incident as a Git or infra blocker.
    assert.equal(outcome.classification.failureClass, 'GateFailure');
    assert.equal(outcome.classification.dispatchAction, 'AutoSendBack');
    assert.equal(outcome.classification.label, 'PRE-REVIEW GATE FAILURE');

    // The last observed diagnostic is retained as the actionable evidence.
    assert.match(outcome.diagnostic, /still failing after attempt/);

    // The implementer that ran the final attempt is retained.
    assert.equal(outcome.implementer, 'codex');
    assert.match(outcome.dossier || '', /Successful checks: none recorded before exhaustion/);
    assert.match(outcome.dossier || '', /Stopped because: implementer repair budget \(2\): attempt budget spent \(2\)/);
    assert.match(outcome.dossier || '', /Manual next action: Repair the reported failure, then rerun \.\/scripts\/verify-local\.sh docs from \/tmp\/task-2413-exhaust\./);
  });

  test('task-2413: the exhaustion dossier carries the final diagnostic, not the first', async () => {
    const diagnostics = [
      { ok: false, diagnostic: 'first-run deterministic failure' },
      { ok: false, diagnostic: 'final-run still failing' },
    ];
    let launches = 0;
    const outcome = await rebound(gateReason, exhaustingContext({
      startAgent: async () => { launches++; return { agent: 'codex', result: { status: 0 } }; },
      verify: () => (diagnostics.length ? diagnostics.shift()! : { ok: false, diagnostic: 'unknown' }),
    }));

    // Budget spent -> exhausted. The retained diagnostic is the LAST observed one,
    // so the caller strands on the current failure, not the first attempt's.
    assert.equal(outcome.outcome, 'exhausted');
    assert.equal(outcome.classification.failureClass, 'GateFailure');
    assert.match(outcome.diagnostic, /final-run still failing/);
    assert.equal(launches, DEFAULT_REBOUND_ATTEMPTS);
  });
});

// ── Bounce output elision — TASK-2369.13 (was task-2369.13-bounce-output-elision.test.ts) ──
/**
 * TASK-2369.13 CP-3: auto-bounce prompts must embed bounded gate/hook output.
 *
 * Regression: a 545 KB gate diagnostic (rebase log + full test suite + full
 * bundle) was embedded verbatim in a bounce prompt, pushing the resumed pi
 * session past its 128k-token context window. Pi then clamped max_tokens to
 * 1 on every turn and the mission silently timed out on every retry.
 */
describe("Bounce output elision —", () => {
  describe('elideBounceOutput', () => {
    it('passes through output at or under the cap unchanged', () => {
      const short = 'pre-commit: ESLint found 3 errors';
      assert.equal(elideBounceOutput(short), short);
      const exact = 'x'.repeat(BOUNCE_OUTPUT_MAX_CHARS);
      assert.equal(elideBounceOutput(exact), exact);
    });

    it('elides oversized output to bounded head+tail with a marker', () => {
      const output = `HEAD-LINE-1\n` + 'm'.repeat(100_000) + '\nMIDDLE-NEEDLE\n' + 'm'.repeat(100_000) + `\nTAIL-ERROR: hook failed`;
      const elided = elideBounceOutput(output);
      assert.ok(elided.length <= BOUNCE_OUTPUT_MAX_CHARS + 200, `elided output must be bounded, got ${elided.length}`);
      assert.ok(elided.startsWith('HEAD-LINE-1'), 'head preserved');
      assert.ok(elided.endsWith('TAIL-ERROR: hook failed'), 'tail (failure) preserved');
      assert.match(elided, /chars elided/, 'elision marker present');
      assert.ok(!elided.includes('MIDDLE-NEEDLE'), 'middle content dropped');
    });
  });

  describe('hook-failure bounce prompt embeds bounded output', () => {
    // TASK-2377.05: the hook bounce moved from the deleted standalone policy to
    // the rebound kernel. The elision contract is unchanged — the kernel's one
    // fix-prompt builder runs the same `elideBounceOutput`.
    it('stays bounded with 500 KB of hook output and keeps head+tail', async () => {
      const hookOutput = 'pre-commit: gate start\n' + 'x'.repeat(500_000) + '\nfinal: ESLint found 3 errors';
      let capturedPrompt = '';
      const outcome = await rebound(
        { kind: 'hook-failure', hook: 'pre-commit', operation: 'squash commit', output: hookOutput },
        {
          slug: 'test-slug',
          worktree: '/worktree',
          implementer: 'claude',
          startAgent: async (_step, opts: Record<string, unknown>) => {
            const slot = opts.prompt;
            capturedPrompt = typeof slot === 'function' ? slot('claude') : String(slot);
            return { agent: 'claude', result: { status: 0 } };
          },
          verify: () => ({ ok: true }),
          log: () => {},
          error: () => {},
        },
      );
      assert.equal(outcome.outcome, 'fixed', 'bounce succeeded');
      assert.ok(capturedPrompt.includes('pre-commit: gate start'), 'head of hook output preserved');
      assert.ok(capturedPrompt.includes('final: ESLint found 3 errors'), 'tail (failure) of hook output preserved');
      assert.ok(capturedPrompt.length < 100_000, `prompt must stay small, got ${capturedPrompt.length}`);
    });
  });

  describe('pre-review gate bounce prompt embeds bounded output', () => {
    it('stays bounded with 500 KB of gate stdout and keeps head+tail', async () => {
      const stdout =
        '[INFO] Rebasing mission/task-2369.13 onto local main...\n' +
        '[pre-commit] running pre-review safety commit\n' +
        't'.repeat(500_000) +
        '\n> 2 of 2320 tests failed';
      let capturedPrompt = '';
      const result = await rebound(gateFailureReason({
        ok: false,
        area: 'all',
        command: './scripts/verify-local.sh all',
        exitCode: 1,
        stdout,
        stderr: '',
      }), {
        slug: 'task-2369.13', worktree: '/worktree', implementer: 'claude',
        verify: () => ({ ok: true }),
        startAgent: async (_mode, opts: any) => {
          capturedPrompt = typeof opts.prompt === 'function' ? opts.prompt('claude') : String(opts.prompt);
          return { agent: 'claude', result: { status: 0 } };
        },
        log: () => {},
        error: () => {},
      });
      assert.equal(result.outcome, 'fixed');
      assert.ok(capturedPrompt.includes('[INFO] Rebasing mission/task-2369.13'), 'head of gate output preserved');
      assert.ok(capturedPrompt.includes('2 of 2320 tests failed'), 'tail (failure) of gate output preserved');
      assert.ok(capturedPrompt.length < 100_000, `prompt must stay small, got ${capturedPrompt.length}`);
    });
  });
});

// ── Integration gate rebound — TASK-2492 (was task-2492-integration-gate-rebound.test.ts) ──
// ---------------------------------------------------------------------------
// TASK-2492 — a failed integration gate is classified and routed instead of
// dead-ending in `IntegrationAbort`.
//
// These are the focused contract tests for the routing module itself: the
// classification of one failed `runPhaseGates('integration', ...)` run, the
// reset boundary of the persisted rebound budget, and the four operator-facing
// outcomes. The CLI-level wiring is covered by
// `test/integration/integrate/integration-gate-repair-routing.test.ts`.
//
// Nothing here launches an agent, opens a database, or executes a gate: every
// boundary is injected, and the real rebound kernel runs in the middle.
// ---------------------------------------------------------------------------
describe("Integration gate rebound —", () => {
  const SLUG = 'task-2492-fixture';
  const GATE_COMMAND = 'npm run test:integration';
  const VERIFY_COMMAND = './scripts/verify-local.sh workflow';

  const failedGate = (over: Partial<GateRunOutcome> = {}): GateRunOutcome => ({
    key: 'integration-suite',
    command: GATE_COMMAND,
    exitCode: 1,
    stdout: '',
    stderr: 'test/review-identity-placeholder.test.ts:20 failed',
    ...over,
  });


  // ── Classification and integration-only coverage wording ────────────────────

  test('TASK-2492: a gate command that is not the ordinary verification command is reported as integration-only', () => {
    const note = integrationOnlyCoverageNote(GATE_COMMAND, VERIFY_COMMAND);
    assert.ok(note, 'a differing gate command produces a coverage note');
    assert.match(note as string, /integration-only/);
    assert.match(note as string, /\.\/scripts\/verify-local\.sh workflow/, 'the note names the ordinary verification command');
  });

  test('TASK-2492: a gate command identical to the ordinary verification command carries no integration-only note', () => {
    assert.equal(integrationOnlyCoverageNote(VERIFY_COMMAND, VERIFY_COMMAND), null);
    assert.equal(integrationOnlyCoverageNote(GATE_COMMAND, null), null);
  });

  test('TASK-2492: the integration gate failure classifies as an auto-send-back gate failure', () => {
    const classification = classifyReboundReason(integrationGateFailureReason(failedGate(), { verificationCommand: VERIFY_COMMAND }));
    assert.equal(classification.failureClass, 'GateFailure');
    assert.equal(classification.isRelaunchable, true, 'a mission-local gate failure is relaunchable');
  });

  test('TASK-2492: the bounced prompt names the failed gate command and the integration-only coverage fact', () => {
    const reason = integrationGateFailureReason(failedGate(), { verificationCommand: VERIFY_COMMAND });
    const classification = classifyReboundReason(reason);
    const prompt = buildReboundFixPrompt({
      label: classification.label,
      slug: SLUG,
      worktree: '/tmp/wt',
      area: reason.area,
      facts: [
        ['Area', reason.area],
        ['Gate command', reason.command],
        ['Exit code', String(reason.exitCode)],
        ['Coverage', reason.coverageNote as string],
      ],
      diagnostic: reason.stderr,
      classification,
      attempt: 1,
      maxAttempts: 1,
      remedy: 'fix it',
    });
    assert.match(prompt, /Gate command: npm run test:integration/);
    assert.match(prompt, /Coverage: integration-only/);
    assert.match(prompt, /review-identity-placeholder/, 'the gate output survives into the handoff');
  });

  // ── Routing: the four operator-facing outcomes ──────────────────────────────

  interface Harness {
    launches: number;
    transitions: string[];
    messages: string[];
  }

  function routeArgs(over: Partial<IntegrationGateRouteOptions> & { rerunOk?: boolean }, harness: Harness): IntegrationGateRouteOptions {
    const { rerunOk = true, ...rest } = over;
    return {
      slug: SLUG,
      missionWorktree: '/tmp/mission',
      baseWorktree: '/tmp/base',
      baseBranch: 'main',
      verificationCommand: VERIFY_COMMAND,
      failedGate: failedGate(),
      gateError: 'Repository gate "integration-suite" exited with code 1 for integration.',
      gates: [{ key: 'integration-suite', command: GATE_COMMAND, order: 3 }],
      implementer: 'codex',
      repositoryId: 'parallix',
      startAgentFn: (async () => { harness.launches += 1; return { agent: 'codex', result: { status: 0 } }; }) as never,
      transitionTaskFn: async (slug: string) => { harness.transitions.push(slug); return true; },
      captureFinalTreeFn: (() => ({ ok: true, rootDir: '/tmp/mission', commit: 'c', tree: 't' })) as never,
      runPhaseGatesFn: (async (_p: string, o: any) => (rerunOk
        ? { ok: true, phase: 'integration', gates: o.gates, executed: 1, skipped: false, dryRun: false, failedGate: null, error: null }
        : { ok: false, phase: 'integration', gates: o.gates, executed: 1, skipped: false, dryRun: false, failedGate: failedGate(), error: 'still red' })) as never,
      log: (m: string) => harness.messages.push(m),
      error: (m: string) => harness.messages.push(m),
      gateRunLog: (m: string) => harness.messages.push(m),
      gateRunError: (m: string) => harness.messages.push(m),
      ...rest,
    } as IntegrationGateRouteOptions;
  }

  function harness(): Harness {
    return { launches: 0, transitions: [], messages: [] };
  }

  test('TASK-2492: a mission regression inside budget re-runs the gates and reports fixed', async () => {
    const h = harness();
    const route = await routeIntegrationGateFailure(routeArgs({ rerunOk: true }, h));
    assert.equal(route.route, 'fixed');
    assert.equal(h.launches, 1, 'exactly one implementer relaunch');
    assert.deepEqual(h.transitions, [SLUG], 'the task is transitioned back to the implementer exactly once');
  });

  test('TASK-2663: a CPU-budget failure echoing a passing forbidden title reaches the implementer repair instead of human-only', async () => {
    const h = harness();
    const route = await routeIntegrationGateFailure(routeArgs({
      failedGate: failedGate({
        key: 'integration-local',
        stdout: [
          '✔ R8: direct review → done forbidden — integrate requires integration status (12.4ms)',
          'integration-test-cpu:exceeded test/integration/cli/headless-cli.test.ts used 2.043s CPU (budget 2.000s)',
        ].join('\n'),
        stderr: '',
      }),
      gateError: 'Repository gate "integration-local" exited with code 1 for integration.',
    }, h));
    assert.equal(route.route, 'fixed');
    assert.equal(h.launches, 1, 'the injected startAgent launched one implementer repair');
    assert.doesNotMatch(h.messages.join('\n'), /Human intervention required/);
  });

  test('TASK-2492: a bounce whose re-run stays red reports exhausted after the per-invocation budget', async () => {
    const h = harness();
    const route = await routeIntegrationGateFailure(routeArgs({ rerunOk: false }, h));
    assert.equal(route.route, 'exhausted');
    assert.equal(h.launches, INTEGRATION_GATE_REBOUND_ATTEMPTS_PER_INVOCATION, 'the bounded per-integrate repair budget is spent, then it stops');
    assert.match(h.messages.join('\n'), /bounded budget/i);
    assert.match(h.messages.join('\n'), /px review .* --continue/, 'the exhaustion names its human continuation');
  });

  test('TASK-2492: a repair left uncommitted fails the re-run instead of being reported as fixed', async () => {
    const h = harness();
    const route = await routeIntegrationGateFailure(routeArgs({
      captureFinalTreeFn: (() => ({ ok: false, error: 'selected execution root is not finalized (dirty tree): /tmp/mission' })) as never,
    }, h));
    assert.equal(route.route, 'exhausted');
    assert.match(h.messages.join('\n'), /not committed|dirty tree/);
  });

  test('TASK-2492: the repair budget is bounded per px integrate invocation', () => {
    // The budget is a per-invocation bound, not a lifetime counter (TASK-2620
    // AC5): every human-initiated `px integrate` may spend this many repairs,
    // and a later resume starts with the full budget again.
    assert.equal(INTEGRATION_GATE_REBOUND_ATTEMPTS_PER_INVOCATION, 2);
  });
});
