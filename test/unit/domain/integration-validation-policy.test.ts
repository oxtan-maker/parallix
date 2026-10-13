/** Pure validation-marker value and commit coverage; real Git/history stays in the existing integration skip suite. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntegrationValidationMarker, validationSkipApplies, partitionGatesForSkip, isBookkeepingPath } from '../../../src/domain/integration-validation-policy.js';

test('validated hooks cover only the same or bookkeeping-equivalent revision (TASK-2668.07)', () => {
  const marker = buildIntegrationValidationMarker('mission', 'sha-a', ['unit', 'unit', 'integration']);
  assert.deepEqual(marker.hooks, ['unit', 'integration']);
  assert.throws(() => buildIntegrationValidationMarker('', 'sha', ['unit']));
  assert.throws(() => buildIntegrationValidationMarker('mission', '', ['unit']));
  assert.throws(() => buildIntegrationValidationMarker('mission', 'sha', []));
  assert.equal(validationSkipApplies(marker, 'sha-a'), true);
  assert.equal(validationSkipApplies(null, 'sha-a'), false);
  assert.equal(validationSkipApplies(marker, null), false);
  assert.equal(validationSkipApplies(marker, 'sha-b'), false);
  assert.equal(validationSkipApplies(marker, 'sha-b', { ok: false }), false);
  assert.equal(validationSkipApplies(marker, 'sha-b', { ok: true, paths: ['backlog/tasks/task-x.md', 'backlog/completed/task-y.md'] }), true);
  for (const path of ['src/policy.ts', 'backlog/tasks/nested/task.md', 'backlog/tasks/task.json', 'workflow.config.json']) {
    assert.equal(isBookkeepingPath(path), false);
    assert.equal(validationSkipApplies(marker, 'sha-b', { ok: true, paths: [path] }), false);
  }
  assert.deepEqual(partitionGatesForSkip(['unit', 'new'], marker), { skip: ['unit'], run: ['new'] });
});

import { restorationEligibility } from '../../../src/domain/integration-approval-restoration.js';

test('integration approval restore requires equivalent patches and preceding green evidence for the failed gate (TASK-2734)', () => {
  const input = { missionId: 'm', approvedRevision: 'a', candidateRevision: 'b', failedGate: 'unit',
    withdrawnAt: '2026-10-01T10:00:00Z', decidedAt: '2026-10-01T12:00:00Z', patchEqual: true,
    validationEqual: true, validation: { missionId: 'm', sha: 'b', hooks: ['unit'], baseline: 'main',
      createdAt: '2026-10-01T11:00:00Z', reference: 'operational_history:42' } };
  assert.equal(restorationEligibility(input).outcome, 'restored');
  assert.equal(restorationEligibility({ ...input, patchEqual: false }).outcome, 'mission-change-differs');
  assert.equal(restorationEligibility({ ...input, patchEqual: null }).outcome, 'comparison-error');
  assert.equal(restorationEligibility({ ...input, validationEqual: null }).outcome, 'comparison-error');
  assert.equal(restorationEligibility({ ...input, validation: null }).outcome, 'gate-evidence-missing');
  assert.equal(restorationEligibility({ ...input, validationEqual: false }).outcome, 'gate-evidence-missing');
  assert.equal(restorationEligibility({ ...input, validation: { ...input.validation, failed: true } }).outcome, 'gate-failed');
  for (const validation of [
    { ...input.validation, missionId: 'other' }, { ...input.validation, hooks: ['other'] },
    { ...input.validation, createdAt: input.decidedAt }, { ...input.validation, createdAt: 'invalid' },
    { ...input.validation, createdAt: '2026-10-01T09:00:00Z' },
  ]) { assert.equal(restorationEligibility({ ...input, validation }).outcome, 'gate-evidence-missing'); }
});
