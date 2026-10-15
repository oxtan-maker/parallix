import assert from 'node:assert/strict';
import test from 'node:test';
import { rebound, type ReboundContext, type ReboundReason } from '../../../src/application/rebound-kernel.js';
import { launchRecoveryAction } from '../../../src/domain/rebound-policy.js';
import { describeLaunchFailure, isDeterministicLaunchFailure, launchFailureOf } from '../../../src/domain/launch-failure.js';

/**
 * Spawn-failure cases owned and executed by rebound-kernel-contract.test.ts
 * (TASK-2760). In-process launch doubles only.
 */
export function launchFailureCases(): void {
  const reason: ReboundReason = { kind: 'gate-failure', area: 'static-analysis', command: './scripts/verify-local.sh static-analysis', exitCode: 1, stdout: 'failing', stderr: '' };
  const e2big = Object.assign(new Error('spawn E2BIG'), { code: 'E2BIG', errno: -7, syscall: 'spawn' });
  const context = (overrides: Partial<ReboundContext>, errors: string[] = []): ReboundContext => ({
    slug: 'task-2760-fixture', worktree: '', implementer: 'codex', log() {}, error: (msg) => { errors.push(msg); },
    verify: () => ({ ok: true }), startAgent: async () => ({ agent: 'codex', result: { status: 0 } }), ...overrides,
  });

  test('an E2BIG spawn failure keeps code, message and signal, stays a failure and is not relaunched unchanged (TASK-2760)', async () => {
    let launches = 0;
    let verifies = 0;
    const errors: string[] = [];
    const outcome = await rebound(reason, context({
      startAgent: async () => { launches++; return { agent: 'codex', result: { status: null, signal: null, error: e2big } }; },
      verify: () => { verifies++; return { ok: true }; },
    }, errors));
    assert.equal(outcome.outcome, 'exhausted', 'a spawn failure is never a fix');
    assert.equal(launches, 1, 'the deterministic oversized launch is not retried');
    assert.equal(verifies, 0);
    assert.deepEqual(outcome.launchFailure, { code: 'E2BIG', message: 'spawn E2BIG', signal: null }, 'structured recovery evidence keeps the spawn error');
    assert.match(outcome.diagnostic, /code E2BIG, message "spawn E2BIG"/);
    assert.match(outcome.diagnostic, /argument-size limit/);
    assert.doesNotMatch(outcome.diagnostic, /ambiguous exit status/);
    assert.match(outcome.dossier ?? '', /Launch failure: code E2BIG/, 'the operator dossier names the spawn error');
    assert.ok(errors.some(line => /not retrying it unchanged/.test(line)), 'the CLI diagnostic is actionable');
  });

  test('a transient spawn error or a signal keeps the existing launcher retry and its evidence (TASK-2760)', async () => {
    const results = [{ status: null, signal: 'SIGKILL' }, { status: null, signal: null, error: Object.assign(new Error('spawn EAGAIN'), { code: 'EAGAIN' }) }];
    for (const result of results) {
      let launches = 0;
      const outcome = await rebound(reason, context({
        startAgent: async () => { launches++; return { agent: 'codex', result: launches === 1 ? result : { status: 0 } }; },
      }));
      assert.equal(outcome.outcome, 'fixed', 'a retried launch can still repair inside the budget');
      assert.equal(launches, 2);
    }
    let null2 = 0;
    const ambiguous = await rebound(reason, context({ startAgent: async () => { null2++; return { agent: 'codex', result: { status: null } }; } }));
    assert.equal(ambiguous.outcome, 'exhausted', 'a bare null exit remains a failure');
    assert.equal(ambiguous.launchFailure, undefined);
    assert.match(ambiguous.diagnostic, /ambiguous exit status \(null\)/);
    assert.equal(null2, 2);
  });

  test('launch failure policy classifies only spawn evidence and stops deterministic launches (TASK-2760)', () => {
    assert.equal(launchFailureOf({ status: 0 }), null);
    assert.equal(launchFailureOf({ status: null }), null, 'no evidence stays ambiguous');
    assert.deepEqual(launchFailureOf({ status: null, signal: 'SIGTERM' }), { code: null, message: null, signal: 'SIGTERM' });
    assert.equal(isDeterministicLaunchFailure({ code: 'E2BIG', message: null, signal: null }), true);
    assert.equal(isDeterministicLaunchFailure({ code: 'EAGAIN', message: null, signal: null }), false);
    assert.match(describeLaunchFailure({ code: 'ENOENT', message: 'spawn codex ENOENT', signal: null }), /retrying it unchanged cannot succeed/);
    assert.equal(launchRecoveryAction(false, false, 0, 0, 1, true), 'stop');
    assert.equal(launchRecoveryAction(false, false, 0, 0, 1, false), 'retry');
  });
}
