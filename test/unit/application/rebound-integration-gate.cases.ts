import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import fs from 'node:fs';
import {
  INTEGRATION_GATE_REBOUND_ATTEMPTS_PER_INVOCATION,
  integrationGateFailureReason,
  integrationOnlyCoverageNote,
  routeIntegrationGateFailure,
  type IntegrationGateRouteOptions,
} from '../../../src/adapters/cli/commands/integrate-gate-rebound.js';
import type { GateRunOutcome } from '../../../src/adapters/config/repository-gates.js';
import { buildFreshDiagnosticRepairPrompt, classifyReboundReason } from '../../../src/application/rebound-kernel.js';
import { mkdtemp } from '../../helpers/temp-dir.js';
import { reboundWithGateRepairEvidence } from '../../helpers/gate-repair-rebound.js';

/** Integration gate routing cases owned and executed by rebound-kernel-contract.test.ts. */
export function integrationGateReboundCases(): void {
  // TASK-2492 — a failed integration gate is classified and routed instead of
  // dead-ending in `IntegrationAbort`. Nothing here launches an agent, opens a
  // database, or executes a gate: every boundary is injected.
  describe('Integration gate rebound —', () => {
    const SLUG = 'task-2492-fixture';
    const GATE_COMMAND = 'npm run test:integration';
    const VERIFY_COMMAND = './scripts/verify-local.sh workflow';
    const failedGate = (over: Partial<GateRunOutcome> = {}): GateRunOutcome => ({
      key: 'integration-suite', command: GATE_COMMAND, exitCode: 1, stdout: '',
      stderr: 'test/review-identity-placeholder.test.ts:20 failed', ...over,
    });

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
      const prompt = buildFreshDiagnosticRepairPrompt({
        label: classification.label, slug: SLUG, worktree: '/tmp/wt', area: reason.area,
        facts: [['Area', reason.area], ['Gate command', reason.command], ['Exit code', String(reason.exitCode)], ['Coverage', reason.coverageNote as string]],
        diagnostic: reason.stderr, classification, attempt: 1, maxAttempts: 1, remedy: 'fix it',
      });
      assert.match(prompt, /Gate command: npm run test:integration/);
      assert.match(prompt, /Coverage: integration-only/);
      assert.match(prompt, /review-identity-placeholder/, 'the gate output survives into the review preparation');
    });

    interface Harness { launches: number; transitions: string[]; messages: string[]; root: string }
    const harnessRoots: string[] = [];
    afterEach(() => {
      for (const root of harnessRoots.splice(0)) { fs.rmSync(root, { recursive: true, force: true }); }
    });
    function routeArgs(over: Partial<IntegrationGateRouteOptions> & { rerunOk?: boolean }, harness: Harness): IntegrationGateRouteOptions {
      const { rerunOk = true, ...rest } = over;
      return {
        slug: SLUG, missionWorktree: harness.root, baseWorktree: '/tmp/base', baseBranch: 'main',
        executionContext: { missionId: SLUG, missionWorktree: harness.root, missionBranch: `mission/${SLUG}`,
          baseWorktree: '/tmp/base', baseBranch: 'main' },
        verificationCommand: VERIFY_COMMAND, failedGate: failedGate(),
        gateError: 'Repository gate "integration-suite" exited with code 1 for integration.',
        gates: [{ key: 'integration-suite', command: GATE_COMMAND, order: 3 }],
        implementer: 'codex', repositoryId: 'parallix',
        startAgentFn: async () => { harness.launches += 1; return { agent: 'codex', result: { status: 0 } }; },
        transitionTaskFn: async (slug: string) => { harness.transitions.push(slug); return true; },
        captureFinalTreeFn: () => ({ ok: true as const, rootDir: harness.root, commit: 'c', tree: 't' }),
        runPhaseGatesFn: async (_p: string, o) => {
          assert.ok(o.gates, 'the repair rerun receives the configured gate collection');
          assert.equal(o.targetBranch, 'main', 'the repair rerun preserves the receiving branch for policy identity');
          return rerunOk
            ? { ok: true, phase: 'integration', gates: o.gates, executed: 1, skipped: false, dryRun: false,
                failedGate: null, outcomes: o.gates.map(gate => ({ ...gate, exitCode: 0, stdout: '', stderr: '' })), error: null }
            : { failureReason: { version: 1, code: 'infrastructure', source: 'review-preparation' }, ok: false,
                phase: 'integration', gates: o.gates, executed: 1, skipped: false, dryRun: false,
                failedGate: failedGate(), error: 'still red' };
        },
        log: (message: string) => harness.messages.push(message),
        error: (message: string) => harness.messages.push(message),
        gateRunLog: (message: string) => harness.messages.push(message),
        gateRunError: (message: string) => harness.messages.push(message),
        reboundFn: reboundWithGateRepairEvidence,
        ...rest,
      } as IntegrationGateRouteOptions;
    }
    function harness(): Harness {
      const root = mkdtemp('parallix-rebound-route-');
      harnessRoots.push(root);
      return { launches: 0, transitions: [], messages: [], root };
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
          stdout: ['✔ R8: direct review → done forbidden — integrate requires integration status (12.4ms)',
            'integration-test-cpu:exceeded test/integration/cli/headless-cli.test.ts used 2.043s CPU (budget 2.000s)'].join('\n'),
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
      assert.match(h.messages.join('\n'), /px review .*/, 'the exhaustion names its human continuation');
    });

    test('PX-0031: a human-only integration failure retains diagnostics and launches no repair agent', async () => {
      const h = harness();
      const route = await routeIntegrationGateFailure(routeArgs({
        failedGate: failedGate({ failureReason: { version: 1, code: 'state-machine' }, stdout: '', stderr: 'transition not allowed for this mission' }),
      }, h));
      assert.ok(route.route === 'human-only');
      assert.deepEqual([route.rebounds, h.launches, h.transitions.length], [0, 0, 0]);
      assert.match('diagnostic' in route ? route.diagnostic : '', /transition not allowed/);
      assert.match(h.messages.join('\n'), /No repair agent was launched/);
    });

    test('TASK-2492: a repair left uncommitted fails the re-run instead of being reported as fixed', async () => {
      const h = harness();
      const route = await routeIntegrationGateFailure(routeArgs({
        captureFinalTreeFn: () => ({ failureReason: { version: 1, code: 'infrastructure', source: 'review-preparation' }, ok: false as const,
          error: 'selected execution root is not finalized (dirty tree): /tmp/mission' }),
      }, h));
      assert.equal(route.route, 'exhausted');
      assert.match(h.messages.join('\n'), /not committed|dirty tree/);
    });

    test('TASK-2492: the repair budget is bounded per px integrate invocation', () => {
      // The budget is per invocation: a later human-initiated resume starts fresh.
      assert.equal(INTEGRATION_GATE_REBOUND_ATTEMPTS_PER_INVOCATION, 2);
    });
  });
}
