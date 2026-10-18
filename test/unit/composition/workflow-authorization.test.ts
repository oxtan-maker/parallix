import test from 'node:test';
import assert from 'node:assert/strict';
import { bindInheritedWorkflowAuthorization, inheritWorkflowAuthorization } from '../../../src/composition/workflow-authorization.js';
import { resolveConfiguration } from '../../../src/composition/config.js';
import { authorizeMissionWrite, authorizedOperationId, configureMissionWriteAuthorization, hasMissionWriteAuthorization } from '../../../src/application/ports/mission-write-authorization.js';
import { fixtureMission } from '../../fixtures/mission-builders.js';
import type { WorkflowOperation } from '../../../src/domain/workflow-operation.js';

test('inherited CLI authority keeps the workflow fence and refuses writes after replacement (TASK-2750)', async () => {
  const mission = fixtureMission('task-inherited');
  let operation: WorkflowOperation = { id: 'parent-operation', missionId: mission.id, repositoryId: mission.repositoryId,
    requestKey: 'delivery', command: 'active:execute', generation: 1, phase: 'running', providerStarted: true,
    agent: 'codex', reviewer: null, originalStatus: 'refined', previousAssignee: null,
    owner: { pid: 123, identity: 'observed-start' }, createdAt: '2026-10-15T00:00:00Z', updatedAt: '2026-10-15T00:00:00Z', reason: null };
  try {
    inheritWorkflowAuthorization(resolveConfiguration({ PARALLIX_WORKFLOW_OPERATION: operation.id, PARALLIX_WORKFLOW_GENERATION: '1' }), { async get() { return operation; } });
    assert.equal(authorizedOperationId(), 'parent-operation');
    await authorizeMissionWrite(mission.id);
    await assert.rejects(() => authorizeMissionWrite('task-other'), /does not own/);
    operation = { ...operation, phase: 'stopped', generation: 2 };
    await assert.rejects(() => authorizeMissionWrite(mission.id), /fenced|stopped/);
  } finally { configureMissionWriteAuthorization(null); }
});

test('an inherited command fails closed without its ownership authority (TASK-2750)', () => {
  try {
    assert.throws(() => inheritWorkflowAuthorization(resolveConfiguration({ PARALLIX_WORKFLOW_OPERATION: 'missing' }), null), /unavailable/);
  } finally { configureMissionWriteAuthorization(null); }
});

test('workflow operations can explicitly opt out of inherited authority (TASK-2762)', () => {
  try {
    const configuration = resolveConfiguration({ PARALLIX_WORKFLOW_OPERATION: 'parent' });
    bindInheritedWorkflowAuthorization(configuration, false, null, null);
    assert.equal(hasMissionWriteAuthorization(), false);
    assert.throws(() => bindInheritedWorkflowAuthorization(configuration, undefined, null, null), /unavailable/);
  } finally { configureMissionWriteAuthorization(null); }
});
