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
