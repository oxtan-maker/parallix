import { HandoffGateRecovery } from '../../../src/application/handoff-gate-recovery.js';
import { DeclaredGateRunner } from '../../../src/application/handoff-declared-gates.js';
import { makePorts, makeRecorder } from '../../helpers/handoff-ports.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { rebound, type ReboundContext, type ReboundReason } from '../../../src/application/rebound-kernel.js';
import type { RepairCheckpointPort } from '../../../src/application/ports/repair-checkpoint.js';

/** Cases owned and executed by rebound-kernel-contract.test.ts. In-process ports only. */
export function repairCheckpointCases(): void {
  const reason: ReboundReason = { kind: 'gate-failure', command: 'npm test -- test/unit/application/rebound-kernel-contract.test.ts', area: 'unit', exitCode: 1, stdout: 'failure', stderr: '' };
  const context = (overrides: Partial<ReboundContext>): ReboundContext => ({
    slug: 'repair-fixture', worktree: '', implementer: 'codex', log() {}, error() {},
    startAgent: async () => ({ result: { status: 0 } }), verify: () => ({ ok: true, command: reason.command }), ...overrides,
  });
  const port = (overrides: Partial<RepairCheckpointPort> = {}): RepairCheckpointPort => ({
    open: async () => ({ name: 'CP-2', version: 2 }), readBlocker: async () => undefined, verify: async () => {}, ...overrides,
  });

  test('repair checkpoint persists before both resumed and fresh launches with identical authority (TASK-2695)', async () => {
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
    assert.deepEqual(sessions, ['resume', 'fresh-ephemeral']);
    for (const prompt of prompts) {
      assert.match(prompt, /REPAIR AUTHORITY:.*resumed execute or act-on-review context/);
      assert.match(prompt, /px checkpoint record --name CP-2/);
      assert.match(prompt, /px checkpoint report-invalid-contract --name CP-2/);
      assert.match(prompt, /Complete every remaining planned checkpoint before handoff/);
    }
  });

  test('repair checkpoint persistence failure prevents any launch or rerun (TASK-2695)', async () => {
    const result = await rebound(reason, context({
      repairCheckpoints: port({ open: async () => { throw new Error('CAS conflict'); } }),
      startAgent: async () => { assert.fail('must not launch'); }, verify: () => { assert.fail('must not verify'); },
    }));
    assert.equal(result.outcome, 'human-only');
    assert.match(result.diagnostic, /CAS conflict/);
  });

  test('first durable agent contract blocker stops retries before verification (TASK-2695)', async () => {
    let launched = 0;
    const blocker = { command: reason.command, diagnostic: 'support module rejected', authorityReason: 'locked command', proposedCorrection: 'operator selects owner' };
    const result = await rebound(reason, context({
      repairCheckpoints: port({ readBlocker: async () => blocker }),
      startAgent: async () => { launched++; return { result: { status: 0 } }; },
      verify: () => { assert.fail('blocker must not be certified by unrelated success'); },
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
      verify: () => { assert.fail('must not rerun after blocker'); },
    }));
    assert.equal(result.outcome, 'human-only'); assert.equal(launched, 1);
  });

  test('mechanically rejected declaration fails closed without a repair launch (TASK-2695)', async () => {
    const result = await rebound({ kind: 'declared-gate-validation', command: 'prose', diagnostic: 'not executable' }, context({
      startAgent: async () => { assert.fail('operator owns declaration'); }, verify: () => { assert.fail('must not verify'); },
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
        verify: () => ({ ok: false, reason: { ...reason, stdout: '', stderr: 'forgejo connection refused', invalidContract } }),
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
    const result = await rebound(reason, context({ repairCheckpoints: port({ verify: async () => { assert.fail('must not stamp success'); } }),
      verify: () => ({ ok: true, command: 'npm test -- unrelated.test.ts' }),
    }));
    assert.equal(result.outcome, 'human-only');
    assert.match(result.diagnostic, /Unrelated check/);
  });

  test('a green rerun with no required-check identity fails closed for recorded repairs (TASK-2695)', async () => {
    const result = await rebound(reason, context({ repairCheckpoints: port(), verify: () => ({ ok: true }) }));
    assert.equal(result.outcome, 'human-only');
    assert.match(result.diagnostic, /cannot certify/);
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
    const verification = { ...ports.verification, formatVerificationCommand: () => command };
    const recovery = new HandoffGateRecovery({ ...ports, verification }, new DeclaredGateRunner(ports));
    const result = await recovery.verifyRepository('fixture', {
      rootDir: '', forgejoUser: 'codex', log() {}, error() {}, recoverGateFailure: true, options: {},
      skipGate: false, area: 'docs', runVerificationGateFn: () => ({ status: 1, stderr: 'failure' }),
      startAgentFn: async () => { launches++; command = 'npm run typecheck'; return { result: { status: 0 } }; },
      retryHandoff: async () => { assert.fail('must not certify a replacement command'); },
    });
    assert.equal(result?.ok, false);
    assert.equal(launches, 1);
    assert.match(result?.error ?? '', /Locked repository verification command changed/);
  });

}
