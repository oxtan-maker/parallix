/**
 * TASK-2413 CP-4: genuine recovery exhaustion retains a bounded, structured
 * dossier instead of collapsing to a generic "Manual intervention required"
 * wrapper.
 *
 * Hermetic: `startAgent` and `verify` are injected; no real agents, git, or
 * Forgejo. Runs in the default unit suite.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rebound,
  DEFAULT_REBOUND_ATTEMPTS,
  type ReboundContext,
  type ReboundReason,
} from '../src/application/rebound-kernel.js';

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
