import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRecoveryReason } from '../../../src/application/rebound-classification.js';
import { classifyError, gateFailureReasonFromProcess } from '../../../src/application/failure-classification.js';
import { recognizedFailureReason } from '../../../src/domain/failure-reason.js';
import { gateFailureReason } from '../../../src/adapters/review/review-gate-handling.js';
import { integrationGateFailureReason } from '../../../src/adapters/cli/commands/integrate-gate-rebound.js';
import { rebound, type GateFailureReason } from '../../../src/application/rebound-kernel.js';

// Cohesive owner for versioned reason precedence and legacy fallback at the application boundary.
// Existing kernel suite is at the file cap; its distinct recovery assertions remain there.
const cpu = '✔ R8: forbidden and forgejo require rejection\nintegration-test-cpu:exceeded case used 2.043s CPU (budget 2.000s)';
const base: GateFailureReason = { kind: 'gate-failure', area: 'unit', command: 'npm test', exitCode: 1, stdout: cpu, stderr: '' };

test('gate writers annotate CPU failure and preserve termination facts (TASK-2663)', () => {
  const preReview = gateFailureReason({ ok: false, area: 'unit', command: 'npm test', exitCode: 1, stdout: cpu, stderr: '' });
  const integration = integrationGateFailureReason({ key: 'unit', command: 'npm test', exitCode: 1, stdout: cpu, stderr: '' });
  for (const reason of [preReview, integration, base]) {
    const logs: string[] = [];
    assert.equal(classifyRecoveryReason(reason, line => logs.push(line)).failureClass, 'GateFailure');
    assert.equal(classifyRecoveryReason(reason, () => {}).isRelaunchable, true);
    assert.equal(logs.length, reason === base ? 1 : 0);
  }
  assert.deepEqual(preReview.failureReason, { version: 1, code: 'cpu-budget-exceeded' });
  const signalled = integrationGateFailureReason({ key: 'unit', command: 'npm test', exitCode: null, signal: 'SIGTERM', stdout: '', stderr: '' });
  assert.equal(signalled.signal, 'SIGTERM');
  assert.deepEqual(signalled.failureReason, { version: 1, code: 'process-terminated' });
  assert.equal(gateFailureReasonFromProcess({ status: 0 }), undefined);
});

test('recognized reasons win conflicting keywords; unsupported codes log fallback', () => {
  for (const [code, expected, relaunchable] of [
    ['cpu-budget-exceeded', 'GateFailure', true], ['gate-failed', 'GateFailure', true],
    ['agent-quota', 'AgentCapacity', true], ['infrastructure', 'InfraBlocker', false], ['state-machine', 'StateMachineViolation', false],
  ] as const) {
    const reason = { ...base, stdout: 'forgejo authentication failed: token expired', failureReason: { version: 1, code } };
    assert.equal(classifyRecoveryReason(reason).failureClass, expected);
    assert.equal(classifyRecoveryReason(reason).isRelaunchable, relaunchable);
    assert.equal(classifyError(reason.stdout, reason.failureReason).failureClass, expected);
  }
  for (const [failureReason, label] of [[undefined, 'missing'], [{ version: 1, code: 'future' }, 'unknown-code'], [{ version: 99, code: 'gate-failed' }, 'unsupported-version']] as const) {
    const logs: string[] = [];
    const reason = { ...base, stderr: 'forgejo authentication failed', failureReason };
    assert.equal(recognizedFailureReason(failureReason), null);
    assert.equal(classifyRecoveryReason(reason, line => logs.push(line)).isRelaunchable, false);
    assert.match(logs[0], new RegExp(`legacy fallback \\(${label}\\)`));
    assert.equal(classifyError(reason.stderr, failureReason, line => logs.push(line)).failureClass, 'InfraBlocker');
    assert.equal(logs.length, 2);
  }
});

test('kernel routes typed CPU versus infrastructure and logs fallback before routing', async () => {
  for (const failureReason of [{ version: 1, code: 'cpu-budget-exceeded' }, { version: 1, code: 'infrastructure' }, undefined]) {
    const logs: string[] = [];
    const outcome = await rebound({ ...base, stderr: 'forgejo authentication failed', failureReason }, {
      slug: 'task-reason', implementer: 'codex', worktree: '', maxAttempts: 0,
      startAgent: async () => assert.fail('zero budget must not launch'), verify: () => assert.fail('zero budget must not verify'),
      log: line => logs.push(line), error: line => logs.push(line),
    });
    assert.equal(outcome.outcome, failureReason?.code === 'cpu-budget-exceeded' ? 'exhausted' : 'human-only');
    assert.equal(logs.some(line => line.includes('legacy fallback')), !failureReason);
  }
});
