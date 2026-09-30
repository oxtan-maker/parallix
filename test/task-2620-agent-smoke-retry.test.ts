/**
 * TASK-2620 — agent-smoke retry and environment classification.
 *
 * Mock-only: `startAgent` and `verify` are injected; no real agents, no git,
 * no Forgejo. Reproduces TASK-2620 AC4: agent-smoke retries once, then a
 * persistent environment failure returns to the human without launching an
 * implementer (repair budget not spent).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  rebound,
  type ReboundContext,
  type ReboundOutcome,
} from '../src/application/rebound-kernel.js';
import { integrationGateFailureReason } from '../src/adapters/cli/commands/integrate-gate-rebound.js';

/** A red agent-smoke integration gate outcome, as the runner would emit it. */
function agentSmokeGate() {
  return {
    key: 'agent-smoke',
    command: 'node --import tsx test/e2e-real-agent-smoke.test.ts',
    exitCode: 1,
    stdout: 'shared local vLLM timed out under concurrency',
    stderr: '',
  };
}

/** A red non-agent gate outcome, for the contrast path. */
function staticAnalysisGate() {
  return {
    key: 'static-analysis',
    command: './scripts/verify-local.sh static-analysis',
    exitCode: 2,
    stdout: 'failing test: a lint error',
    stderr: '',
  };
}

/** Context with silent logging and injected launch/verify pairs. */
function contextFor(overrides: Partial<ReboundContext> = {}): ReboundContext {
  return {
    slug: 'task-2620-agent-smoke',
    worktree: '/tmp/task-2620-agent-smoke',
    implementer: 'codex',
    verify: () => ({ ok: true }),
    startAgent: async () => ({ agent: 'codex', result: { status: 0 } }),
    log: () => {},
    error: () => {},
    ...overrides,
  };
}

test('task-2620: an agent-smoke integration gate is declared transient and environment', () => {
  const reason = integrationGateFailureReason(agentSmokeGate());
  assert.equal(reason.kind, 'gate-failure');
  assert.equal(reason.transient, true, 'agent-smoke retries once before classification');
  assert.equal(reason.environment, true, 'a persistent agent-smoke failure is an environment failure');
});

test('task-2620: a non-agent integration gate is not declared transient or environment', () => {
  const reason = integrationGateFailureReason(staticAnalysisGate());
  assert.equal(reason.transient, undefined, 'a normal gate is not a transient verifier');
  assert.equal(reason.environment, undefined);
});

test('task-2620: agent-smoke retries once, then returns to the human without launching an implementer', async () => {
  let verifyCalls = 0;
  let launchCalls = 0;
  const context = contextFor({
    maxTransientRetries: 1,
    maxAttempts: 2,
    verify: () => {
      verifyCalls += 1;
      return { ok: false, diagnostic: 'shared local vLLM timed out under concurrency' };
    },
    startAgent: async () => {
      launchCalls += 1;
      return { agent: 'codex', result: { status: 0 } };
    },
  });

  const outcome = await rebound(integrationGateFailureReason(agentSmokeGate()), context);

  assert.equal(verifyCalls, 1, 'the agent-smoke gate reran once on the unchanged tree, then returned to the human without a repair verify');
  assert.equal(launchCalls, 0, 'no implementer is launched for a persistent environment failure');
  assert.equal(outcome.outcome, 'human-only', 'a persistent agent-smoke failure returns to the human');
  assert.equal(outcome.attempts, 0, 'the repair budget is not spent before classification');
  assert.match(outcome.diagnostic, /shared local vLLM timed out under concurrency/, 'the exact actionable reason surfaces');
});

test('task-2620: a transient gate that is not an environment failure still launches an implementer after its retry', async () => {
  let launchCalls = 0;
  const context = contextFor({
    maxTransientRetries: 1,
    maxAttempts: 1,
    verify: () => ({ ok: false, diagnostic: 'still failing after the rerun' }),
    startAgent: async () => {
      launchCalls += 1;
      return { agent: 'codex', result: { status: 0 } };
    },
  });

  // A transient gate WITHOUT the environment flag: the kernel retries once,
  // then an implementer still repairs it (the pre-existing transient contract).
  const transientNonEnvReason = { ...integrationGateFailureReason(staticAnalysisGate()), transient: true };
  const outcome: ReboundOutcome = await rebound(transientNonEnvReason, context);

  assert.equal(launchCalls, 1, 'a fixable transient gate launches an implementer after its retry');
  assert.ok(outcome.outcome === 'fixed' || outcome.outcome === 'exhausted', 'the transient gate is repaired or strands after its budget');
});
