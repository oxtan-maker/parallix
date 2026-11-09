/** Pure validation-marker value and commit coverage; real Git/history stays in the existing integration skip suite. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildIntegrationValidationMarker, validationSkipApplies, partitionGatesForSkip, isBookkeepingPath } from '../../../src/domain/integration-validation-policy.js';
import { retentionEvidenceMatches, type IntegrationRepairAssessment } from '../../../src/domain/integration-approval-retention.js';

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

test('completed rebase lineage carries repaired integration validation through review and resume (px-0045 regression, PX-0048)', () => {
  // px-0045: all hooks passed at the repaired revision, main advanced, review
  // preparation completed a rebase whose only tree change was upstream
  // workflow.config.json, and the next integration reran every hook.
  const validated = '622981cb0486eb6abcd4ad47eb3b268880e82b3e';
  const rebased = '90ae8ee3ac329c2d89fd7c110745fe31758de2cc';
  const oldBase = '288406081bc521cb9c649a342d77ecae35bb1d9c';
  const newBase = '63adae40abed4ae1bbe6b3049366b3756ab05a85';
  const lineage = [{ from: validated, to: rebased }];
  const marker = buildIntegrationValidationMarker('px-0045', validated, ['build', 'unit', 'integration-ci']);
  const upstream = { ok: true as const, paths: ['workflow.config.json', 'src/upstream.ts', 'test/upstream.test.ts', 'package.json'] };
  assert.equal(validationSkipApplies(marker, rebased, upstream), false, 'a substantive move without lineage still runs');
  assert.equal(validationSkipApplies(marker, rebased, upstream, lineage), true, 'a completed rebase carries the green hooks');
  assert.equal(validationSkipApplies(marker, rebased, { ok: false }, lineage), true, 'lineage needs no content comparison');
  assert.equal(validationSkipApplies(marker, rebased, upstream, []), false, 'empty lineage is not lineage');
  assert.deepEqual(partitionGatesForSkip(['build', 'unit', 'integration-ci', 'new-upstream-gate'], marker),
    { skip: ['build', 'unit', 'integration-ci'], run: ['new-upstream-gate'] }, 'a never-passed gate still runs');

  const validation = { missionId: 'px-0045', sha: validated, hooks: ['build', 'unit'], baseline: oldBase,
    createdAt: '2026-11-08T19:57:34.000Z', reference: 'operational_history:27894' };
  const assessment = (carried?: object, failed?: boolean): Parameters<typeof retentionEvidenceMatches>[0] => ({
    assessedAt: '2026-11-08T20:10:00.000Z', candidateRevision: rebased, failedGate: 'unit',
    repair: { startedAt: '2026-11-08T19:40:00.000Z', cause: { kind: 'integration-gate-failure', gate: 'unit' } },
    validation: { ...validation, ...(failed ? { failed } : {}), ...(carried ? { carried } : {}) } as IntegrationRepairAssessment['validation'],
  });
  const carried = { revision: rebased, baseline: newBase, lineage };
  assert.equal(retentionEvidenceMatches(assessment(), 'px-0045', newBase), false, 'the original revision alone does not cover the rebase');
  assert.equal(retentionEvidenceMatches(assessment(carried), 'px-0045', newBase), true, 'resume reuses the carried validation');
  assert.equal(retentionEvidenceMatches(assessment(carried)), true, 'persisted retained evidence remains valid');
  assert.equal(retentionEvidenceMatches(assessment(carried, true), 'px-0045', newBase), false, 'a failed validation never carries');
  assert.equal(retentionEvidenceMatches(assessment({ ...carried, lineage: [] }), 'px-0045', newBase), false, 'unsupported lineage');
  assert.equal(retentionEvidenceMatches(assessment({ ...carried, revision: 'other' }), 'px-0045', newBase), false, 'another candidate');
  assert.equal(retentionEvidenceMatches(assessment(carried), 'px-0045', 'unrelated-base'), false, 'another base');
});
