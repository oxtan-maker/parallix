// task-2500.01 CP-2: the integration-mode dispatcher centralizes the per-mode
// capability table so callers never branch on the mode themselves. Every mode
// other than the one under test fails closed on an operation it does not own.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  INTEGRATION_OPERATIONS,
  type IntegrationOperation,
} from '../src/application/ports/integration-strategy.js';
import {
  createIntegrationStrategy,
} from '../src/application/services/integration-dispatch.js';
import type { IntegrationStrategyPort } from '../src/application/ports/integration-strategy.js';
import {
  NO_INTEGRATION_EVIDENCE,
  type IntegrationMode,
} from '../src/domain/integration.js';

function strategy(mode: IntegrationMode): IntegrationStrategyPort {
  return createIntegrationStrategy(mode);
}

test('local owns every operation it performs itself', () => {
  const s = strategy('local');
  const localOps = [
    'prepare-integration', 'run-required-local-gates', 'produce-integration-candidate',
    'publish', 'close-mission',
  ] as const;
  for (const op of localOps) {
    assert.equal(s.supportFor(op), 'local', `local should own ${op}`);
    assert.equal(s.refusalFor(op), null, `local should not refuse ${op}`);
  }
});

test('local refuses to submit for external verification (no external provider)', () => {
  const s = strategy('local');
  const refusal = s.refusalFor('submit-for-external-verification');
  assert.ok(refusal, 'local must refuse submit-for-external-verification');
  assert.equal(refusal!.support, 'unsupported');
  assert.equal(refusal!.mode, 'local');
});

test('local run executes the supplied local implementation', async () => {
  const s = strategy('local');
  let ran = false;
  const result = await s.run('produce-integration-candidate', () => { ran = true; return 'candidate-sha'; });
  assert.equal(result, 'candidate-sha');
  assert.ok(ran);
});

test('local run fails closed on an operation it does not own', async () => {
  const s = strategy('local');
  await assert.rejects(
    () => s.run('submit-for-external-verification', () => 'nope'),
    /the "local" integration mode .* does not submit for external verification\./,
  );
});

test('github-publish owns the local preparation steps and fails closed on the provider steps', async () => {
  const s = strategy('github-publish');
  for (const op of ['prepare-integration', 'run-required-local-gates', 'produce-integration-candidate', 'close-mission'] as const) {
    assert.equal(s.supportFor(op), 'local', `github-publish should own ${op}`);
  }
  for (const op of ['submit-for-external-verification', 'publish', 'observe-external-integration'] as const) {
    assert.equal(s.supportFor(op), 'external-pending', `github-publish declares ${op}`);
    const refusal = s.refusalFor(op);
    assert.ok(refusal, `github-publish must refuse to run ${op} without the provider adapter`);
    assert.equal(refusal!.support, 'external-pending');
    await assert.rejects(() => s.run(op as IntegrationOperation, () => 'nope'), /not shipped in this release/);
  }
});

test('github-pr owns the branch-push verification step and refuses the local primary merge', () => {
  const s = strategy('github-pr');
  assert.equal(s.supportFor('submit-for-external-verification'), 'local', 'github-pr pushes its own reviewable branch');
  assert.equal(s.supportFor('produce-integration-candidate'), 'local');
  const publish = s.refusalFor('publish');
  assert.ok(publish, 'github-pr must never merge into the protected primary branch itself');
  assert.equal(publish!.support, 'unsupported');
  assert.match(publish!.message, /GitHub\/PR/);
});

test('github-pr run fails closed on publish', async () => {
  const s = strategy('github-pr');
  await assert.rejects(() => s.run('publish', () => 'nope'), /does not publish/);
});

test('closure blocker enforces each mode\'s evidence requirement', () => {
  assert.equal(strategy('local').closureBlocker({ ...NO_INTEGRATION_EVIDENCE, candidateSha: 'abc123' }), null);
  assert.match(
    strategy('local').closureBlocker(NO_INTEGRATION_EVIDENCE),
    /no integration candidate commit was produced/,
  );
  assert.match(
    strategy('github-publish').closureBlocker({ ...NO_INTEGRATION_EVIDENCE, candidateSha: 'abc123' }),
    /no external verification/,
  );
  assert.match(
    strategy('github-publish').closureBlocker({ candidateSha: 'abc123', verifiedSha: 'def456', externalIntegrationObserved: false }),
    /external verification covers def456, not the integration candidate abc123/,
  );
  assert.equal(
    strategy('github-publish').closureBlocker({ candidateSha: 'abc123', verifiedSha: 'abc123', externalIntegrationObserved: false }),
    null,
  );
  assert.match(
    strategy('github-pr').closureBlocker(NO_INTEGRATION_EVIDENCE),
    /no external integration into the primary branch was observed/,
  );
  assert.equal(
    strategy('github-pr').closureBlocker({ ...NO_INTEGRATION_EVIDENCE, externalIntegrationObserved: true }),
    null,
  );
});
