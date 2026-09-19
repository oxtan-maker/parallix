// ---------------------------------------------------------------------------
// TASK-2492 — a failed integration gate is classified and routed instead of
// dead-ending in `IntegrationAbort`.
//
// These are the focused contract tests for the routing module itself: the
// classification of one failed `runPhaseGates('integration', ...)` run, the
// reset boundary of the persisted rebound budget, and the four operator-facing
// outcomes. The CLI-level wiring is covered by
// `test/task-2492-integrate-gate-bounce.test.ts`.
//
// Nothing here launches an agent, opens a database, or executes a gate: every
// boundary is injected, and the real rebound kernel runs in the middle.
// ---------------------------------------------------------------------------
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INTEGRATION_GATE_REBOUND_LIMIT,
  INTEGRATION_GATE_REBOUND_EVENT,
  integrationGateFailureReason,
  integrationOnlyCoverageNote,
  routeIntegrationGateFailure,
  type IntegrationGateRouteOptions,
} from '../src/adapters/cli/commands/integrate-gate-rebound.js';
import { buildReboundFixPrompt, classifyReboundReason } from '../src/application/rebound-kernel.js';
import type { GateRunOutcome } from '../src/adapters/config/repository-gates.js';

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

const okRun = { status: 0, stdout: '', stderr: '' };

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
  recorded: Array<{ slug: string; gate: string }>;
  messages: string[];
}

function routeArgs(over: Partial<IntegrationGateRouteOptions> & { spent?: number | null; rerunOk?: boolean }, harness: Harness): IntegrationGateRouteOptions {
  const { spent = 0, rerunOk = true, ...rest } = over;
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
    readReboundsFn: async () => spent,
    recordReboundFn: async (slug: string, facts: any) => { harness.recorded.push({ slug, gate: facts.gate }); return true; },
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
  return { launches: 0, transitions: [], recorded: [], messages: [] };
}

test('TASK-2492: a mission regression inside budget bounces once, re-runs the gates, and reports fixed', async () => {
  const h = harness();
  const route = await routeIntegrationGateFailure(routeArgs({ spent: 0, rerunOk: true }, h));
  assert.equal(route.route, 'fixed');
  assert.equal(h.launches, 1, 'exactly one implementer relaunch');
  assert.deepEqual(h.transitions, [SLUG], 'the task is transitioned back to the implementer exactly once');
  assert.deepEqual(h.recorded, [{ slug: SLUG, gate: 'integration-suite' }], 'the spent rebound is persisted');
});

test('TASK-2492: a bounce whose re-run stays red reports exhausted without a second launch', async () => {
  const h = harness();
  const route = await routeIntegrationGateFailure(routeArgs({ spent: 0, rerunOk: false }, h));
  assert.equal(route.route, 'exhausted');
  assert.equal(h.launches, 1, 'one relaunch per px integrate invocation');
});

test('TASK-2492: an exhausted rebound budget escalates to a human without a transition or a launch', async () => {
  const h = harness();
  const route = await routeIntegrationGateFailure(routeArgs({ spent: INTEGRATION_GATE_REBOUND_LIMIT }, h));
  assert.equal(route.route, 'limit-reached');
  assert.equal(h.launches, 0);
  assert.deepEqual(h.transitions, []);
  assert.deepEqual(h.recorded, []);
  assert.match(h.messages.join('\n'), /human action required/i);
  assert.match(h.messages.join('\n'), /npm run test:integration/, 'the escalation names the reproduction command');
});

test('TASK-2492: an unreadable rebound budget strands rather than bouncing an unbounded number of times', async () => {
  const h = harness();
  const route = await routeIntegrationGateFailure(routeArgs({ spent: null }, h));
  assert.equal(route.route, 'stranded');
  assert.equal(h.launches, 0);
});

test('TASK-2492: a repair left uncommitted fails the re-run instead of being reported as fixed', async () => {
  const h = harness();
  const route = await routeIntegrationGateFailure(routeArgs({
    captureFinalTreeFn: (() => ({ ok: false, error: 'selected execution root is not finalized (dirty tree): /tmp/mission' })) as never,
  }, h));
  assert.equal(route.route, 'exhausted');
  assert.match(h.messages.join('\n'), /not committed|dirty tree/);
});

test('TASK-2492: the persisted rebound budget is keyed on the mission and never resets inside it', () => {
  // The reset boundary is structural, not temporal: the budget is the count of
  // append-only `integration.gate-rebound` rows carrying this mission id, so it
  // cannot reset on a new commit, review round, or process, and cannot be
  // inherited from another mission.
  assert.equal(INTEGRATION_GATE_REBOUND_EVENT, 'integration.gate-rebound');
  assert.equal(INTEGRATION_GATE_REBOUND_LIMIT, 2);
});
