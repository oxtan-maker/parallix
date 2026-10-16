// Asynchronous HTTP admission envelope; no socket or full board projection.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyReply } from 'fastify';
import { admitWebWorkflow } from '../../../../src/interfaces/web/workflow-route.js';
import type { BoardCommandDispatcher, BoardCommandRequest } from '../../../../src/application/controller/board-command.js';
import type { WebCommandRequest } from '../../../../src/interfaces/web/transport.js';
import { failure, rejected } from '../../../../src/application/contracts.js';

test('workflow admission forwards checked handoff evidence and stale version (TASK-2750 F8)', async () => {
  let received: BoardCommandRequest | undefined;
  let status = 0;
  const reply = { code(value: number) { status = value; return this; }, type() { return this; }, send() {} } as unknown as FastifyReply;
  const dispatcher: BoardCommandDispatcher = { canExecute: () => true, dispatch: async () => failure('execution', 'unused'),
    admit: async request => { received = request; return failure('conflict', 'stale Mission version'); } };
  const payload = { netEngineeringLines: 3, capturedAt: '2026-10-15T00:00:00Z', expectedVersion: 4 };
  await admitWebWorkflow(reply, dispatcher, { kind: 'handoff:record', missionId: 'task-test', missionStatusAtRequest: 'active',
    requestKey: 'delivery', payload } as WebCommandRequest, () => {});
  assert.equal(status, 409);
  assert.deepEqual(received?.payload, { kind: 'handoff:record', ...payload });
  assert.equal(received?.requestKey, 'delivery');
});

test('activation contract refusals are validation responses rather than unavailable (TASK-2750 F8)', async () => {
  let status = 0;
  const reply = { code(value: number) { status = value; return this; }, type() { return this; }, send() {} } as unknown as FastifyReply;
  const dispatcher: BoardCommandDispatcher = { canExecute: () => true, dispatch: async () => failure('execution', 'unused'),
    admit: async () => failure('validation', 'Mission brief is incomplete') };
  await admitWebWorkflow(reply, dispatcher, { kind: 'active:execute', missionId: 'task-test', missionStatusAtRequest: 'refined' }, () => {});
  assert.equal(status, 400);
});

test('workflow capability rejection returns forbidden without invalidating the board (TASK-2750)', async () => {
  let status = 0;
  let body: unknown;
  let invalidated = false;
  const reply = { code(value: number) { status = value; return this; }, type() { return this; },
    send(value: unknown) { body = value; } } as unknown as FastifyReply;
  const dispatcher: BoardCommandDispatcher = { canExecute: () => true, dispatch: async () => failure('execution', 'unused'),
    admit: async () => rejected('capability', 'Workflow command is not available') };
  await admitWebWorkflow(reply, dispatcher, { kind: 'active:execute', missionId: 'task-test', missionStatusAtRequest: 'refined' },
    () => { invalidated = true; });
  assert.equal(status, 403);
  assert.equal(invalidated, false);
  assert.deepEqual((body as { error: unknown }).error, { kind: 'capability', message: 'Workflow command is not available' });
});

test('settled retry returns the recorded terminal outcome with HTTP 200 (TASK-2750)', async () => {
  for (const phase of ['completed', 'blocked', 'interrupted', 'stopped'] as const) {
    let status = 0;
    let body: { status: string; value?: unknown; error: { message: string } } | undefined;
    const reply = { code(value: number) { status = value; return this; }, type() { return this; }, send(value: unknown) { body = value as typeof body; } } as unknown as FastifyReply;
    const dispatcher: BoardCommandDispatcher = { canExecute: () => true, dispatch: async () => failure('execution', 'unused'),
      admit: async () => ({ status: 'accepted', operation: { id: 'retained', phase, reason: 'retained outcome' } as import('../../../../src/application/ports/workflow-operation.js').WorkflowOperationRecord }) };
    await admitWebWorkflow(reply, dispatcher, { kind: 'active:execute', missionId: 'task-test', missionStatusAtRequest: 'refined', requestKey: 'retry' }, () => {});
    assert.equal(status, 200);
    assert.ok(body);
    assert.equal(body.status, phase === 'completed' ? 'completed' : phase === 'stopped' ? 'cancelled' : 'failed');
    assert.deepEqual(body.value, { operationId: 'retained', phase });
    if (phase !== 'completed') { assert.equal(body.error.message, 'retained outcome'); }
  }
});

test('workflow status reads bound identities and expose the retained operation (TASK-2750)', async () => {
  const { registerWorkflowReads } = await import('../../../../src/interfaces/web/workflow-route.js');
  let handler: (request: unknown, reply: unknown) => Promise<unknown> = async () => {};
  const operation = { id: 'operation', missionId: 'task-test', command: 'active:execute', phase: 'running', generation: 2, owner: null, agent: 'custom', reviewer: null, createdAt: 'start', updatedAt: 'now', reason: null };
  const reads: string[] = [];
  registerWorkflowReads({ get: (path: string, callback: typeof handler) => { assert.equal(path, '/api/operations/:id'); handler = callback; } } as never,
    () => ({ operation: async (id: string) => { reads.push(id); return id === operation.id ? operation : null; } }) as never);
  let status = 200;
  let body: unknown;
  const reply = { code(value: number) { status = value; return this; }, send(value: unknown) { body = value; } };
  await handler({ params: { id: 'x'.repeat(129) } }, reply);
  assert.equal(status, 400);
  assert.deepEqual(reads, []);
  await handler({ params: { id: 'missing' } }, reply);
  assert.equal(status, 404);
  await handler({ params: { id: operation.id } }, reply);
  assert.deepEqual(body, { operation });
  assert.deepEqual(reads, ['missing', 'operation']);
});

for (const error of [new Error('offline'), 'offline']) {
  test(`admission boundary reports ${typeof error} failures as unavailable (TASK-2750)`, async () => {
    let status = 0;
    let body: { error?: { message: string } } = {};
    const reply = { code(value: number) { status = value; return this; }, type() { return this; }, send(value: typeof body) { body = value; } } as unknown as FastifyReply;
    const dispatcher: BoardCommandDispatcher = { canExecute: () => true, dispatch: async () => failure('execution', 'unused'), admit: async () => { throw error; } };
    assert.equal(await admitWebWorkflow(reply, dispatcher, { kind: 'active:execute', missionId: 'task-test', missionStatusAtRequest: 'refined' }, () => { assert.fail('failed admission must not invalidate'); }), true);
    assert.equal(status, 503);
    assert.equal(body.error?.message, 'offline');
  });
}
