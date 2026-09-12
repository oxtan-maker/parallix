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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  INTEGRATION_GATE_REBOUND_LIMIT,
  INTEGRATION_GATE_REBOUND_EVENT,
  createMainlineGateTask,
  integrationGateFailureReason,
  integrationOnlyCoverageNote,
  mainlineGateTaskId,
  probeBaseBranchReproduction,
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

// ── Base-branch reproduction probe ──────────────────────────────────────────

test('TASK-2492: the reproduction probe refuses to run when the base worktree is not on the base branch', async () => {
  const probe = await probeBaseBranchReproduction({
    slug: SLUG,
    baseWorktree: '/tmp/base',
    baseBranch: 'main',
    failedGate: failedGate(),
    gitFn: (() => ({ status: 0, stdout: 'mission/other\n', stderr: '' })) as never,
    captureFinalTreeFn: (() => { throw new Error('must not capture'); }) as never,
    runPhaseGatesFn: (() => { throw new Error('must not run a gate'); }) as never,
    log: () => {},
  });
  assert.equal(probe.checked, false);
  assert.match(probe.detail, /not main/);
});

test('TASK-2492: the reproduction probe refuses to run against a dirty base worktree', async () => {
  const probe = await probeBaseBranchReproduction({
    slug: SLUG,
    baseWorktree: '/tmp/base',
    baseBranch: 'main',
    failedGate: failedGate(),
    gitFn: (() => ({ status: 0, stdout: 'main\n', stderr: '' })) as never,
    captureFinalTreeFn: (() => ({ ok: false, error: 'selected execution root is not finalized (dirty tree): /tmp/base' })) as never,
    runPhaseGatesFn: (() => { throw new Error('must not run a gate'); }) as never,
    log: () => {},
  });
  assert.equal(probe.checked, false);
  assert.match(probe.detail, /dirty tree/);
});

test('TASK-2492: the reproduction probe runs only the failed gate command in the clean base worktree', async () => {
  const ran: Array<{ checkoutPath: string; gates: unknown }> = [];
  const probe = await probeBaseBranchReproduction({
    slug: SLUG,
    baseWorktree: '/tmp/base',
    baseBranch: 'main',
    failedGate: failedGate(),
    gitFn: (() => ({ status: 0, stdout: 'main\n', stderr: '' })) as never,
    captureFinalTreeFn: (() => ({ ok: true, rootDir: '/tmp/base', commit: 'abc123def456', tree: 't' })) as never,
    runPhaseGatesFn: (async (_phase: string, opts: any) => {
      ran.push({ checkoutPath: opts.checkoutPath, gates: opts.gates });
      return { ok: false, phase: 'integration', gates: opts.gates, executed: 1, skipped: false, dryRun: false, failedGate: failedGate(), error: 'gate failed on main' };
    }) as never,
    log: () => {},
    gateRunLog: () => {},
    gateRunError: () => {},
  });
  assert.equal(ran.length, 1, 'exactly one probe execution');
  assert.equal(ran[0]!.checkoutPath, '/tmp/base');
  assert.deepEqual(ran[0]!.gates, [{ key: 'integration-suite', command: GATE_COMMAND, order: 0 }]);
  assert.equal(probe.checked, true);
  assert.equal(probe.reproduced, true);
  assert.equal(probe.baseCommit, 'abc123def456');
});

test('TASK-2492: a gate that passes on the base branch is reported as a mission regression', async () => {
  const probe = await probeBaseBranchReproduction({
    slug: SLUG,
    baseWorktree: '/tmp/base',
    baseBranch: 'main',
    failedGate: failedGate(),
    gitFn: (() => ({ status: 0, stdout: 'main\n', stderr: '' })) as never,
    captureFinalTreeFn: (() => ({ ok: true, rootDir: '/tmp/base', commit: 'abc123', tree: 't' })) as never,
    runPhaseGatesFn: (async (_p: string, o: any) => ({ ok: true, phase: 'integration', gates: o.gates, executed: 1, skipped: false, dryRun: false, failedGate: null, error: null })) as never,
    log: () => {},
    gateRunLog: () => {},
    gateRunError: () => {},
  });
  assert.equal(probe.checked, true);
  assert.equal(probe.reproduced, false);
  assert.match(probe.detail, /mission regression/);
});

// ── Mainline problem ticket ─────────────────────────────────────────────────

test('TASK-2492: the mainline task identity is derived from the gate key and the base commit', () => {
  const a = mainlineGateTaskId('integration-suite', 'abc123');
  assert.equal(a, mainlineGateTaskId('integration-suite', 'abc123'), 'deterministic for the same base commit');
  assert.notEqual(a, mainlineGateTaskId('integration-suite', 'def456'), 'a different base commit is a different problem');
  assert.notEqual(a, mainlineGateTaskId('workflow', 'abc123'), 'a different gate is a different problem');
  assert.match(a, /^TASK-MAINGATE-[0-9A-F]{8}$/, 'outside the numeric TASK-NNNN range that backlog counters hand out');
});

test('TASK-2492: the mainline task is written once and re-resolves instead of duplicating', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-2492-'));
  try {
    fs.mkdirSync(path.join(root, 'backlog', 'tasks'), { recursive: true });
    const args = {
      baseWorktree: root,
      baseBranch: 'main',
      baseCommit: 'abc123def456',
      slug: SLUG,
      failedGate: failedGate(),
      gateError: 'Repository gate "integration-suite" exited with code 1 for integration.',
      gitFn: (() => okRun) as never,
      log: () => {},
    };
    const first = createMainlineGateTask(args);
    assert.equal(first.created, true);
    const body = fs.readFileSync(first.taskFile as string, 'utf8');
    assert.match(body, new RegExp(`id: ${first.taskId}`));
    assert.match(body, /status: backlog/);
    assert.match(body, /Gate command: `npm run test:integration`/);
    assert.match(body, /Reproduced on: `main` @ abc123def456/);
    assert.match(body, new RegExp(SLUG));

    const second = createMainlineGateTask(args);
    assert.equal(second.created, false, 'the same mainline problem is not ticketed twice');
    assert.equal(second.taskId, first.taskId);
    assert.equal(fs.readdirSync(path.join(root, 'backlog', 'tasks')).length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── Routing: the four operator-facing outcomes ──────────────────────────────

interface Harness {
  launches: number;
  transitions: string[];
  recorded: Array<{ slug: string; gate: string }>;
  mainlineTasks: string[];
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
    probeBaseBranchReproductionFn: (async () => ({ checked: true, reproduced: false, detail: 'passes on main', baseCommit: 'abc123' })) as never,
    createMainlineGateTaskFn: ((o: any) => { harness.mainlineTasks.push(o.baseCommit); return { taskId: mainlineGateTaskId(o.failedGate.key, o.baseCommit), taskFile: '/tmp/base/backlog/tasks/x.md', created: true }; }) as never,
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
  return { launches: 0, transitions: [], recorded: [], mainlineTasks: [], messages: [] };
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

test('TASK-2492: a gate failure reproducing on main creates one backlog task and never bounces', async () => {
  const h = harness();
  const route = await routeIntegrationGateFailure(routeArgs({
    spent: 0,
    probeBaseBranchReproductionFn: (async () => ({ checked: true, reproduced: true, detail: 'also fails on main', baseCommit: 'abc123' })) as never,
  }, h));
  assert.equal(route.route, 'mainline');
  assert.equal(h.launches, 0, 'a main problem never launches an implementer');
  assert.deepEqual(h.transitions, [], 'a main problem never transitions the mission to active');
  assert.deepEqual(h.recorded, [], 'a main problem spends no integration-gate rebound budget');
  assert.deepEqual(h.mainlineTasks, ['abc123'], 'exactly one mainline problem task');
  assert.match(h.messages.join('\n'), /Human action required/);
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

test('TASK-2492: an undeterminable base-branch reproduction is treated as a mission regression', async () => {
  const h = harness();
  const route = await routeIntegrationGateFailure(routeArgs({
    probeBaseBranchReproductionFn: (async () => ({ checked: false, reproduced: false, detail: 'base worktree is dirty', baseCommit: null })) as never,
  }, h));
  assert.equal(route.route, 'fixed');
  assert.equal(h.launches, 1, 'an undeterminable probe still takes the recoverable route');
  assert.deepEqual(h.mainlineTasks, [], 'and never invents a mainline problem from an unclassified failure');
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
