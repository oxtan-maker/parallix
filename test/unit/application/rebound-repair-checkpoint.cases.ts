import { HandoffGateRecovery } from '../../../src/application/handoff-gate-recovery.js';
import { DeclaredGateRunner } from '../../../src/application/handoff-declared-gates.js';
import { makePorts, makeRecorder } from '../../helpers/handoff-ports.js';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { mkdtemp } from '../../helpers/temp-dir.js';
import { fixtureMission, inMemoryTransitionStore } from '../../fixtures/mission-builders.js';
import { RepairCheckpointService } from '../../../src/application/repair-checkpoint-service.js';
import { buildTypedMissionRecoveryAdvice } from '../../../src/application/typed-mission-recovery-advice.js';
import { rebound, type ReboundContext, type ReboundReason } from '../../../src/application/rebound-kernel.js';
import type { RepairCheckpointPort } from '../../../src/application/ports/repair-checkpoint.js';

/** Cases owned and executed by rebound-kernel-contract.test.ts. In-process ports only. */
export function repairCheckpointCases(): void {
  const reason = { kind: 'gate-failure', command: 'npm test -- test/unit/application/rebound-kernel-contract.test.ts', area: 'unit', exitCode: 1, stdout: 'failure', stderr: '' } satisfies ReboundReason;
  const context = (overrides: Partial<ReboundContext>): ReboundContext => ({
    slug: 'repair-fixture', worktree: '', implementer: 'codex', log() {}, error() {},
    startAgent: async () => ({ result: { status: 0 } }), verify: () => ({ ok: true as const, command: reason.command }), ...overrides,
  });
  const port = (overrides: Partial<RepairCheckpointPort> = {}): RepairCheckpointPort => ({
    open: async () => ({ name: 'CP-2', version: 2 }), readBlocker: async () => undefined, verify: async () => {}, ...overrides,
  });

  test('repair checkpoint persists before first and later fresh launches with identical authority (TASK-2695)', async () => {
    const order: string[] = [];
    const incidents: string[] = [];
    const prompts: string[] = [];
    const sessions: unknown[] = [];
    const result = await rebound(reason, context({
      repairCheckpoints: port({ open: async input => { order.push(`persist-${input.attempt}`); incidents.push(input.incidentId); return { name: 'CP-2', version: input.attempt + 1 }; }, verify: async () => { order.push('checkpoint-verified'); } }),
      startAgent: async (_step, options) => {
        order.push('launch'); sessions.push(options.sessionPolicy);
        prompts.push((options.prompt as (_agent: string) => string)('codex'));
        return { result: { status: 0 } };
      },
      verify: attempt => { order.push('harness'); return { ok: attempt === 2, command: reason.command, diagnostic: 'still failing' }; },
    }));
    assert.equal(result.outcome, 'fixed');
    assert.deepEqual(order, ['persist-1', 'launch', 'harness', 'persist-2', 'launch', 'harness', 'checkpoint-verified']);
    assert.equal(incidents[0], incidents[1]);
    assert.deepEqual(sessions, ['fresh-ephemeral', 'fresh-ephemeral']);
    for (const prompt of prompts) {
      assert.match(prompt, /FRESH-CONTEXT DIAGNOSTIC REPAIR REQUIRED/);
      assert.doesNotMatch(prompt, /compact the aborted working context/);
      assert.match(prompt, /REPAIR AUTHORITY:.*resumed execute or act-on-review context/);
      assert.match(prompt, /px checkpoint record --name CP-2/);
      assert.match(prompt, /px checkpoint report-invalid-contract --name CP-2/);
      assert.match(prompt, /Complete every remaining planned checkpoint before handoff/);
    }
  });

  test('repair launch authorizes evidence for unfinished original CP-3 and harness CP-5 within the locked contract (TASK-2726)', async () => {
    const prompts: string[] = [];
    await rebound(reason, context({
      repairCheckpoints: port({ open: async () => ({ name: 'CP-5', version: 9 }) }),
      startAgent: async (_step, options) => { prompts.push((options.prompt as (_agent: string) => string)('codex')); return { result: { status: 0 } }; },
    }));
    const [prompt] = prompts;
    assert.match(prompt, /px checkpoint record --name CP-5/);
    assert.match(prompt, /--name <CP-N>[^.]*planned checkpoint[^.]*CP-3[^.]*without recorded evidence/);
    assert.match(prompt, /locked (scope|contract)[^.]*success criteri/i);
    assert.doesNotMatch(prompt, /Write only authorized repair evidence to CP-5/);
    assert.match(prompt, /earlier evidence is no longer accurate, re-record that checkpoint with corrected fresh evidence/);
    assert.match(prompt, /report-invalid-contract --name CP-5/);
    assert.match(prompt, /independent review|self-approv/i);
  });

  test('typed recovery advice authorizes unfinished CP-3 beside CP-5 and keeps safeguards (TASK-2726)', () => {
    const advice = buildTypedMissionRecoveryAdvice('task-2726', 'CP-5');
    assert.match(advice, /still lack evidence \(for example an original CP-3 alongside CP-5\)/);
    assert.match(advice, /Retain valid earlier evidence for unaffected criteria without restatement/);
    assert.match(advice, /fresh verifiable current-round evidence/);
    assert.match(advice, /earlier evidence is no longer accurate, re-record that checkpoint with corrected fresh evidence/);
    assert.match(advice, /Never edit locked scope or criteria, weaken or bypass gates, or self-approve/);
    assert.match(advice, /report-invalid-contract.*stop for the operator/);
  });

  test('repair checkpoint persistence failure prevents any launch or rerun (TASK-2695)', async () => {
    const result = await rebound(reason, context({
      repairCheckpoints: port({ open: async () => { throw new Error('CAS conflict'); } }),
      startAgent: async () => { return assert.fail('must not launch'); }, verify: () => { return assert.fail('must not verify'); },
    }));
    assert.equal(result.outcome, 'human-only');
    assert.match(result.diagnostic, /CAS conflict/);
  });

  test('repair checkpoint and certification follow the newly failed gate within the same budget (TASK-2750)', async () => {
    const next: ReboundReason = { ...reason, command: 'npm run test:integration:ci:prebuilt', area: 'integration-ci', stdout: 'integration failed' };
    const commands: string[] = [];
    const incidents: string[] = [];
    const prompts: string[] = [];
    let certified = 0;
    const result = await rebound(reason, context({
      repairCheckpoints: port({
        open: async input => { commands.push(input.command); incidents.push(input.incidentId); return { name: 'CP-2', version: input.attempt }; },
        verify: async () => { certified++; },
      }),
      startAgent: async (_step, options) => { prompts.push((options.prompt as (_agent: string) => string)('codex')); return { result: { status: 0 } }; },
      verify: attempt => attempt === 1
        ? { ok: false as const, reason: next }
        : { ok: true as const, command: next.command },
    }));
    assert.equal(result.outcome, 'fixed');
    assert.equal(result.attempts, 2);
    assert.deepEqual(commands, [reason.command, next.command]);
    assert.equal(incidents[0], incidents[1], 'changing the failed gate must not reset the repair budget');
    assert.match(prompts[1], /integration failed/);
    assert.equal(certified, 1, 'only the full green rerun certifies the current repair');
  });

  test('the original green command cannot certify a later integration repair (TASK-2750)', async () => {
    const result = await rebound(reason, context({
      repairCheckpoints: port({ verify: async () => { assert.fail('must not certify the superseded command'); } }),
      verify: attempt => attempt === 1
        ? { ok: false as const, reason: { ...reason, command: 'npm run test:integration:ci:prebuilt' } }
        : { ok: true as const, command: reason.command },
    }));
    assert.equal(result.outcome, 'human-only');
    assert.match(result.diagnostic, /Unrelated check.*cannot certify npm run test:integration:ci:prebuilt/);
  });

  test('first durable agent contract blocker stops retries before verification (TASK-2695)', async () => {
    let launched = 0;
    const blocker = { command: reason.command, diagnostic: 'support module rejected', authorityReason: 'locked command', proposedCorrection: 'operator selects owner' };
    const result = await rebound(reason, context({
      repairCheckpoints: port({ readBlocker: async () => blocker }),
      startAgent: async () => { launched++; return { result: { status: 0 } }; },
      verify: () => { return assert.fail('blocker must not be certified by unrelated success'); },
    }));
    assert.equal(result.outcome, 'human-only');
    assert.equal(launched, 1);
    assert.match(result.dossier ?? '', /operator selects owner/);
  });

  test('agent structured launch blocker stops even on nonzero exit (TASK-2695)', async () => {
    let launched = 0;
    const result = await rebound(reason, context({
      startAgent: async () => { launched++; return { result: { status: 1, invalidContract: {
        command: reason.command, diagnostic: 'invalid locked contract', authorityReason: 'operator owns checks', proposedCorrection: 'operator corrects command',
      } } }; },
      verify: () => { return assert.fail('must not rerun after blocker'); },
    }));
    assert.equal(result.outcome, 'human-only'); assert.equal(launched, 1);
  });

  test('mechanically rejected declaration fails closed without a repair launch (TASK-2695)', async () => {
    const result = await rebound({ kind: 'declared-gate-validation', command: 'prose', diagnostic: 'not executable' }, context({
      startAgent: async () => { return assert.fail('operator owns declaration'); }, verify: () => { return assert.fail('must not verify'); },
    }));
    assert.equal(result.outcome, 'human-only');
  });

  test('fresh infrastructure failure retains exhaustion evidence while contract reports escalate immediately (TASK-2695)', async () => {
    for (const invalidContract of [undefined, {
      command: reason.command, diagnostic: 'support module rejected',
      authorityReason: 'operator owns locked checks', proposedCorrection: 'operator selects owner',
    }]) {
      let launches = 0;
      const result = await rebound(reason, context({
        startAgent: async () => { launches++; return { result: { status: 0 } }; },
        verify: () => ({ ok: false as const, reason: { ...reason, stdout: '', stderr: 'forgejo connection refused', invalidContract } }),
      }));
      assert.equal(launches, 1);
      assert.equal(result.outcome, invalidContract ? 'human-only' : 'exhausted');
      assert.equal(result.attempts, 1);
      if (!invalidContract) {
        assert.equal(result.classification.failureClass, 'InfraBlocker');
        assert.equal(result.attemptsDetail?.length, 1);
        assert.match(result.dossier ?? '', /fresh structured failure requires human action/);
      }
    }
  });

  test('unrelated successful check cannot certify the authorized required gate (TASK-2695)', async () => {
    const result = await rebound(reason, context({ repairCheckpoints: port({ verify: async () => { return assert.fail('must not stamp success'); } }),
      verify: () => ({ ok: true as const, command: 'npm test -- unrelated.test.ts' }),
    }));
    assert.equal(result.outcome, 'human-only');
    assert.match(result.diagnostic, /Unrelated check/);
  });

  test('a green rerun with no required-check identity fails closed for recorded repairs (TASK-2695)', async () => {
    const result = await rebound(reason, context({ repairCheckpoints: port(), verify: () => ({ ok: true as const }) }));
    assert.equal(result.outcome, 'human-only');
    assert.match(result.diagnostic, /cannot certify/);
  });

  function realRepair(t: TestContext) {
    const worktree = mkdtemp('checkpoint-preparation-');
    t.after(() => fs.rmSync(worktree, { recursive: true, force: true }));
    const mission = fixtureMission('repair-fixture', { brief: { goal: 'g', why: 'w', scope: 's', outOfScope: [] },
      declaredGates: [reason.command], successCriteria: ['criterion'], completedSuccessCriteria: [0] });
    const store = inMemoryTransitionStore(mission);
    const checkpoints = new RepairCheckpointService(store);
    const options = context({ worktree, maxAttempts: 2, repairCheckpoints: checkpoints, readHead: () => 'execution-head',
      retainedFailure: { version: 1, incidentId: 'retained-failure', attempt: 1, command: reason.command, cwd: worktree,
        capturedRevision: 'failed-head', exitCode: 1, signal: null, stdoutPath: path.join(worktree, 'stdout'),
        stderrPath: path.join(worktree, 'stderr'), stdoutBytes: 7, stderrBytes: 0, captureComplete: true,
        truncatedFrom: null, redacted: false, capturedAt: '2026-10-21T13:00:00Z' },
    });
    return { store, checkpoints, options };
  }

  test('real checkpoint service without recorded evidence preserves reruns, relaunch and structured stop (TASK-2802 F1)', async t => {
    const f = realRepair(t);
    let launches = 0;
    let verifies = 0;
    const outcome = await rebound(reason, { ...f.options,
      startAgent: async () => { launches++; return { result: { status: 0 } }; },
      verify: () => { verifies++; return { ok: verifies === 2, command: reason.command }; },
    });
    assert.equal(launches, 2);
    assert.equal(verifies, 2, 'the authorized failing check still executes before evidence certification');
    assert.equal(outcome.outcome, 'human-only');
    assert.equal(outcome.attempts, 2);
    assert.match(outcome.diagnostic, /fresh authorized evidence/);
    assert.match(outcome.dossier ?? '', /Recovery dossier/);
    const repair = f.store.mission().checkpoints.at(-1)!.repair!;
    assert.equal(repair.evidenceRecorded, false);
    assert.equal(repair.verified, false);
    assert.equal(repair.exactSuccessCoverage, undefined);
  });

  test('snapshot preparation port failure returns the structured kernel stop (TASK-2802 F1)', async () => {
    const outcome = await rebound(reason, context({
      repairCheckpoints: port({ prepareVerification: async () => { throw new Error('Mission store unavailable during snapshot'); },
        verify: async () => { assert.fail('failed preparation cannot certify success'); } }),
      verify: () => { return assert.fail('cannot run with unavailable authority'); },
    }));
    assert.equal(outcome.outcome, 'human-only');
    assert.match(outcome.diagnostic, /Mission store unavailable during snapshot/);
    assert.match(outcome.dossier ?? '', /Recovery dossier/);
  });

  test('snapshot contract refusal preserves its actual cause in the structured stop (TASK-2802 F1)', async t => {
    const f = realRepair(t);
    const outcome = await rebound(reason, { ...f.options,
      startAgent: async () => {
        await f.store.save({ ...f.store.mission(), declaredGates: ['changed required check'] });
        return { result: { status: 0 } };
      },
      verify: () => { return assert.fail('changed authority must stop before running a gate'); },
    });
    assert.equal(outcome.outcome, 'human-only');
    assert.match(outcome.diagnostic, /Authorized required checks changed/);
    assert.doesNotMatch(outcome.diagnostic, /requires fresh accepted evidence/);
    assert.match(outcome.dossier ?? '', /Recovery dossier/);
    assert.equal(f.store.mission().checkpoints.at(-1)!.repair!.verified, false);
  });

  test('harness success with missing fresh repair evidence still fails closed (TASK-2695)', async () => {
    const result = await rebound(reason, context({ repairCheckpoints: port({ verify: async () => { throw new Error('stale evidence'); } }) }));
    assert.equal(result.outcome, 'human-only'); assert.match(result.diagnostic, /stale evidence/);
  });
  test('handoff repository repair refuses a changed verifier command before rerunning handoff (TASK-2695)', async () => {
    const recorder = makeRecorder();
    const ports = makePorts(recorder);
    let command = 'npm test';
    let launches = 0;
    const verification = { ...ports.verification, formatVerificationCommand: () => command } satisfies import("../../../src/application/ports/handoff-workflow.js").HandoffVerificationPort;
    const recovery = new HandoffGateRecovery({ ...ports, verification }, new DeclaredGateRunner(ports));
    const result = await recovery.verifyRepository('fixture', {
      rootDir: '', forgejoUser: 'codex', log() {}, error() {}, recoverGateFailure: true, options: {},
      skipGate: false, area: 'docs', runVerificationGateFn: () => ({ status: 1, stderr: 'failure' }),
      startAgentFn: async () => { launches++; command = 'npm run typecheck'; return { result: { status: 0 } }; },
      retryHandoff: async () => { return assert.fail('must not certify a replacement command'); },
    });
    assert.equal(result?.ok, false);
    assert.equal(launches, 1);
    assert.match(result?.error ?? '', /Locked repository verification command changed/);
  });

}
