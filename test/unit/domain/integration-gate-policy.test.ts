// Pure gate disposition and repair routing; orchestration stays in the adapter contract suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { integrationGateDisposition, integrationRepairRoute, integrationRepairMustReactivate, repairedRevisionReviewEligible, repairCanResumeIntegration } from '../../../src/domain/integration-gate-policy.js';

test('integration gate precedence and repaired-revision routing are pure (TASK-2668.07)', () => {
  const facts = { dryRun: false, skippedAll: false, skipped: false, required: true, ok: false, cancelled: false };
  assert.equal(integrationGateDisposition({ ...facts, dryRun: true, skippedAll: true }), 'plan');
  assert.equal(integrationGateDisposition({ ...facts, skippedAll: true, skipped: true }), 'validated');
  assert.equal(integrationGateDisposition({ ...facts, skipped: true, ok: true }), 'mandatory-missing');
  assert.equal(integrationGateDisposition({ ...facts, skipped: true, required: false }), 'unconfigured');
  assert.equal(integrationGateDisposition({ ...facts, ok: true, cancelled: true }), 'passed');
  assert.equal(integrationGateDisposition({ ...facts, cancelled: true }), 'cancelled');
  assert.equal(integrationGateDisposition(facts), 'recover');
  assert.equal(integrationRepairRoute('fixed', true), 'resume');
  assert.equal(integrationRepairRoute('revision-changed', true), 're-review');
  assert.equal(integrationRepairRoute('revision-changed', false), 'stop');
  assert.equal(integrationRepairMustReactivate('exhausted', 'integration'), true);
  assert.equal(integrationRepairMustReactivate('fixed', 'integration'), false);
  assert.equal(repairedRevisionReviewEligible(false, true), true);
  assert.equal(repairedRevisionReviewEligible(false, false), false);
  assert.equal(repairCanResumeIntegration('active'), false);
  assert.equal(repairCanResumeIntegration('integration'), true);
});
