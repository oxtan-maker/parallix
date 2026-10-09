// ---------------------------------------------------------------------------
// TASK-2504 — an integration-gate bounce must tell the implementer to commit
// its repair, because the automatic re-verification only accepts a finalized
// tree. The prompt is observed through `routeIntegrationGateFailure`'s injected
// agent launcher; no agent, database, or gate is executed.
// ---------------------------------------------------------------------------
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  routeIntegrationGateFailure,
  type IntegrationGateRouteOptions,
} from '../../../../../src/adapters/cli/commands/integrate-gate-rebound.js';
import type { GateRunOutcome } from '../../../../../src/adapters/config/repository-gates.js';

const GATE_COMMAND = 'npm run test:integration';

const failedGate: GateRunOutcome = {
  key: 'integration-suite',
  command: GATE_COMMAND,
  exitCode: 1,
  stdout: '',
  stderr: 'test/verify-review.test.ts: verifyReview handles gate failures failed',
};

function routeArgs(prompts: string[], messages: string[], treeFinalized: boolean): IntegrationGateRouteOptions {
  return {
    slug: 'task-2504-fixture',
    missionWorktree: '/tmp/mission',
    verificationCommand: './scripts/verify-local.sh all',
    failedGate,
    gateError: 'Repository gate "integration-suite" exited with code 1 for integration.',
    gates: [{ key: 'integration-suite', command: GATE_COMMAND, order: 3 }],
    implementer: 'codex',
    repositoryId: 'parallix',
    startAgentFn: (async (_step: string, o: any) => { prompts.push(o.prompt('codex')); return { agent: 'codex', result: { status: 0 } }; }) as never,
    transitionTaskFn: async () => true,
    captureFinalTreeFn: (() => (treeFinalized
      ? { ok: true, rootDir: '/tmp/mission', commit: 'c', tree: 't' }
      : { ok: false, error: 'selected execution root is not finalized (dirty tree): /tmp/mission' })) as never,
    runPhaseGatesFn: (async (_p: string, o: any) => ({ ok: true, phase: 'integration', gates: o.gates, executed: 1, skipped: false, dryRun: false, failedGate: null, error: null })) as never,
    log: (m: string) => messages.push(m),
    error: (m: string) => messages.push(m),
    gateRunLog: (m: string) => messages.push(m),
    gateRunError: (m: string) => messages.push(m),
  } as IntegrationGateRouteOptions;
}

test('TASK-2504: the integration-gate bounce prompt requires committing the repair before re-verification', async () => {
  const prompts: string[] = [];
  const route = await routeIntegrationGateFailure(routeArgs(prompts, [], true));
  assert.equal(route.route, 'fixed');
  assert.equal(prompts.length, 1, 'exactly one implementer fix prompt');
  const prompt = prompts[0] as string;
  assert.match(prompt, /GATE FAILURE/, 'the prompt is the gate-failure rebound');
  assert.match(prompt, /If the repair changes tracked files, commit it before the automatic re-verification/, 'the remedy requires committing a tracked-file repair before re-verification');
  assert.match(prompt, /uncommitted repair cannot be verified/, 'the remedy states the dirty-tree consequence');
});

test('TASK-2504: an uncommitted repair is still rejected by the finalized-tree guard', async () => {
  const messages: string[] = [];
  const route = await routeIntegrationGateFailure(routeArgs([], messages, false));
  assert.notEqual(route.route, 'fixed', 'a dirty tree is never reported as a verified repair');
  assert.match(messages.join('\n'), /The repair is not committed/);
});

test('failed, timed-out and unsupported fresh launches cannot accept a green probe (TASK-2700)', async () => {
  for (const status of [1, null, 'unsupported'] as const) {
    let gateRuns = 0;
    const messages: string[] = [];
    const args = routeArgs([], messages, true);
    args.startAgentFn = (async (_step: string, options: any) => {
      assert.equal(options.sessionPolicy, 'fresh-ephemeral');
      if (status === 'unsupported') { throw new Error('Unsupported launcher'); }
      return { agent: 'codex', result: { status } };
    }) as never;
    args.runPhaseGatesFn = (async () => {
      gateRuns++;
      return { ok: true };
    }) as never;
    const route = await routeIntegrationGateFailure(args);
    assert.notEqual(route.route, 'fixed');
    assert.equal(gateRuns, 0, 'a potentially green verifier cannot certify an unacceptable launch');
    assert.match(messages.join('\n'), status === 'unsupported' ? /Unsupported launcher/ : status === null ? /ambiguous exit status/ : /exited with status 1/);
  }
});

test('fresh repair reruns the authorized integration gates on the committed tree (TASK-2700)', async () => {
  const args = routeArgs([], [], true);
  let runs = 0;
  args.startAgentFn = (async (_step: string, options: any) => {
    assert.equal(options.sessionPolicy, 'fresh-ephemeral');
    return { agent: 'codex', result: { status: 0 } };
  }) as never;
  args.runPhaseGatesFn = (async (phase: string, options: any) => {
    runs++;
    assert.equal(phase, 'integration');
    assert.deepEqual(options.gates, args.gates);
    assert.equal(options.checkoutPath, args.missionWorktree);
    return { ok: true };
  }) as never;
  assert.equal((await routeIntegrationGateFailure(args)).route, 'fixed');
  assert.equal(runs, 1);
});
