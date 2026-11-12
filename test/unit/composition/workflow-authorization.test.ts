import test from 'node:test';
import assert from 'node:assert/strict';
import { bindInheritedWorkflowAuthorization, inheritWorkflowAuthorization } from '../../../src/composition/workflow-authorization.js';
import { resolveConfiguration } from '../../../src/composition/config.js';
import { authorizeMissionWrite, authorizedOperationId, configureMissionWriteAuthorization, hasMissionWriteAuthorization } from '../../../src/application/ports/mission-write-authorization.js';
import { fixtureMission } from '../../fixtures/mission-builders.js';
import type { WorkflowOperation } from '../../../src/domain/workflow-operation.js';
import { WorkflowOwnershipError } from '../../../src/domain/workflow-operation.js';
import { pendingReview, inMemoryTransitionStore } from '../../fixtures/mission-builders.js';
import { reviewVerbPorts } from '../../../src/composition/cli-review-verbs.js';
import { createVerdictCommand } from '../../../src/interfaces/cli/review-verbs.js';
import { MissionLifecycleService } from '../../../src/application/mission-lifecycle-service.js';
import fs from 'node:fs';
import path from 'node:path';
import { mkdtemp } from '../../helpers/temp-dir.js';
import { missionExecutionContext } from '../../fixtures/mission-execution-context.js';

test('production verdict binding retains fenced output before authority or provider effects (TASK-2826)', async t => {
  const root = mkdtemp('fenced-verdict-');
  t.after(() => { configureMissionWriteAuthorization(null); fs.rmSync(root, { recursive: true, force: true }); });
  const original = fixtureMission('task-fenced', { status: 'review', review: pendingReview('task-fenced') });
  const store = inMemoryTransitionStore(original);
  const ports = reviewVerbPorts({ rootDir: process.cwd(), configuration: resolveConfiguration({}), mission: { store, lifecycle: new MissionLifecycleService(store) } });
  const bound = { ...ports, resolveSlug: () => original.id, resolveExecutionContext: () => ({ ok: true as const, context: missionExecutionContext({ missionId: original.id, missionWorktree: root }) }) };
  configureMissionWriteAuthorization({ operationId: 'old-owner', assert: async () => { throw new WorkflowOwnershipError('Workflow ownership was fenced or stopped'); } });
  await assert.rejects(() => createVerdictCommand(bound)(['approve', '--actor', 'claude', '--comment', 'keep original']), /Verdict rejected:.*retained at/);
  const loaded = await store.load(original.id);
  assert.equal(loaded.kind, 'found');
  if (loaded.kind !== 'found') { throw new Error('missing fixture'); }
  assert.deepEqual(loaded.mission, original);
  const directory = path.join(root, '.workflow', 'agent-context');
  const records = fs.readdirSync(directory).map(name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')));
  assert.equal(records.length, 1);
  assert.equal(records[0].accepted, false);
  assert.equal(records[0].workflowId, 'old-owner');
  assert.equal(records[0].round, 1);
  assert.equal(records[0].output.comment, 'keep original');
});

test('inherited CLI authority keeps the workflow fence and refuses writes after replacement (TASK-2750)', async () => {
  const mission = fixtureMission('task-inherited');
  let operation: WorkflowOperation = { id: 'parent-operation', missionId: mission.id, repositoryId: mission.repositoryId,
    requestKey: 'delivery', command: 'active:execute', generation: 1, phase: 'executing', providerStarted: true,
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
