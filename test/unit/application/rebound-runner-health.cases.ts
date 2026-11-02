import test from 'node:test';
import assert from 'node:assert/strict';
import { assertRunnerHealth, RUNNER_HEALTH_MIN_BYTES } from '../../../src/adapters/process/test-memory-cgroup.js';
import { gateFailureReason } from '../../../src/adapters/review/review-gate-handling.js';
import { rebound } from '../../../src/application/rebound-kernel.js';

// Part of the existing rebound-kernel contract suite: runner admission must
// never enter the implementer repair loop, including on repeated evidence.
export function runnerHealthRecoveryCases(): void {
  test('runner health returns unchanged failures to human with zero attempts and retains evidence (TASK-2815)', async () => {
    const diagnostic = '[runner-health] infrastructure: operation=create-and-read-memory-limited-scope; resource=systemd user manager; observedAt=2026-11-01T12:00:00Z; remediation=restore manager then rerun original gate';
    const command = './scripts/verify-local.sh all';
    const reason = gateFailureReason({ ok: false, area: 'unit', command, exitCode: 75, stdout: '', stderr: diagnostic });
    for (let repeat = 0; repeat < 2; repeat++) {
      const output: string[] = [];
      const outcome = await rebound(reason, {
        slug: 'task-health-fixture', worktree: '', implementer: 'codex', maxAttempts: 2,
        startAgent: async () => assert.fail('runner health must not launch implementer'),
        verify: () => assert.fail('human must restore runner before retry'),
        log: line => output.push(line), error: line => output.push(line),
      });
      assert.equal(outcome.outcome, 'human-only');
      assert.equal(outcome.attempts, 0);
      assert.deepEqual(outcome.attemptsDetail, []);
      assert.equal(outcome.classification.failureClass, 'InfraBlocker');
      assert.ok(outcome.diagnostic.includes(diagnostic));
      assert.ok(output.some(line => line.includes(diagnostic)));
      assert.ok(outcome.dossier?.includes(command));
      assert.ok(outcome.dossier?.includes(diagnostic));
    }
  });

  test('runner recovery needs fresh health and original verification, healthy admission alone cannot pass (TASK-2815)', async () => {
    let available = 0;
    let healthChecks = 0;
    let verificationRuns = 0;
    let originalPasses = false;
    const command = './scripts/verify-local.sh all';
    const runOriginalGate = () => {
      healthChecks++;
      assertRunnerHealth(512, {
        runtimeDir: '/runtime', tempDir: '/temp',
        capacity: () => ({ availableBytes: available, freeInodes: 10 }),
        spawn: () => ({ status: 0, stdout: `${512 * 1048576}\n0`, stderr: '' }),
      });
      verificationRuns++;
      return originalPasses;
    };
    assert.throws(runOriginalGate, /runner-health/);
    assert.equal(verificationRuns, 0);
    available = RUNNER_HEALTH_MIN_BYTES;
    assert.equal(runOriginalGate(), false);
    const reason = gateFailureReason({ ok: false, area: 'unit', command, exitCode: 1, stdout: 'unit assertion failed', stderr: '' });
    const outcome = await rebound(reason, {
      slug: 'task-health-recovery', worktree: '', implementer: 'codex', maxAttempts: 0,
      startAgent: async () => assert.fail('zero budget'), verify: () => assert.fail('zero budget'), log: () => {}, error: () => {},
    });
    assert.equal(outcome.classification.failureClass, 'GateFailure');
    assert.equal(outcome.outcome, 'exhausted');
    originalPasses = true;
    assert.equal(runOriginalGate(), true);
    assert.equal(healthChecks, 3);
    assert.equal(verificationRuns, 2);
  });
}
