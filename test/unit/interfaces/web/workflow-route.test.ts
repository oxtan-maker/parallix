// Asynchronous HTTP admission envelope; no socket or full board projection.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { FastifyReply } from 'fastify';
import { admitWebWorkflow } from '../../../../src/interfaces/web/workflow-route.js';
import type { BoardCommandDispatcher, BoardCommandRequest, BoardCommandResult } from '../../../../src/application/controller/board-command.js';
import type { WebCommandRequest } from '../../../../src/interfaces/web/transport.js';
import { completed, failure, rejected } from '../../../../src/application/contracts.js';

test("workflow admission carries review identity and its stale-status guard without a measurement payload (TASK-2822)", async () => {
  let received: BoardCommandRequest | undefined;
  let status = 0;
  const reply = { code(value: number) { status = value; return this; }, type() { return this; }, send() {} } as unknown as FastifyReply;
  const dispatcher: BoardCommandDispatcher = { canExecute: () => true, dispatch: async () => failure('execution', 'unused'),
    admit: async request => { received = request; return failure('conflict', 'stale Mission version'); } };
  await admitWebWorkflow(reply, dispatcher, { kind: 'review:submit', missionId: 'task-test', missionStatusAtRequest: 'active',
    requestKey: 'delivery' } as WebCommandRequest, () => {});
  assert.equal(status, 409);
  assert.equal(received?.payload, undefined);
  assert.equal(received?.missionStatusAtRequest, 'active');
  assert.equal(received?.requestKey, 'delivery');
  assert.equal(received?.operatorInvocation, undefined, 'plain browser review cannot acknowledge a human-only stop');
});

test('web Stop run answers only after settlement and preserves pending-stop guidance (TASK-2839)', async () => {
  let settle!: (value: BoardCommandResult<{ stopped: boolean }>) => void;
  const pending = new Promise<BoardCommandResult<{ stopped: boolean }>>(resolve => { settle = resolve; });
  let status = 0;
  const bodies: unknown[] = [];
  const reply = { code(value: number) { status = value; return this; }, type() { return this; }, send(value: unknown) { bodies.push(value); } } as unknown as FastifyReply;
  const dispatcher: BoardCommandDispatcher = { canExecute: () => true, dispatch: <T>() => pending as Promise<BoardCommandResult<T>> };
  const request = admitWebWorkflow(reply, dispatcher, { kind: 'workflow:stop', missionId: 'task-test', missionStatusAtRequest: 'review' }, () => {});
  await Promise.resolve();
  assert.equal(bodies.length, 0, 'the route has not reported completion before settlement confirmation');
  settle(completed({ stopped: true }));
  await request;
  assert.equal(status, 200);
  assert.equal((bodies[0] as { status: string }).status, 'completed');

  const guidance = 'Inspect px history task-test list; verify the current process start identity, then rerun px stop task-test.';
  const conflict: BoardCommandDispatcher = { canExecute: () => true, dispatch: async () => failure('conflict', guidance) };
  await admitWebWorkflow(reply, conflict, { kind: 'workflow:stop', missionId: 'task-test', missionStatusAtRequest: 'review' }, () => {});
  assert.equal(status, 409);
  assert.match(JSON.stringify(bodies.at(-1)), /px history task-test list/);
  assert.match(JSON.stringify(bodies.at(-1)), /process start identity/);
});

test('authenticated web review carries ordinary review capability and no minted operator authority (TASK-2839)', async () => {
  let received: BoardCommandRequest | undefined;
  const reply = { code() { return this; }, type() { return this; }, send() {} } as unknown as FastifyReply;
  const dispatcher: BoardCommandDispatcher = { canExecute: () => true, dispatch: async () => failure('execution', 'unused'),
    admit: async request => { received = request; return failure('conflict', 'fixture'); } };
  await admitWebWorkflow(reply, dispatcher, { kind: 'review:submit', missionId: 'task-test', missionStatusAtRequest: 'review',
    requestKey: 'resume-once' }, () => {});
  assert.equal(received?.kind, 'review:submit');
  assert.deepEqual([...received!.capabilities], ['review:submit']);
  assert.equal(received?.operatorInvocation, undefined, 'the transport cannot mint generic operator authority');
  assert.equal(received?.invocation, undefined, 'the transport cannot supply CLI argv');
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
  const operation = { id: 'operation', missionId: 'task-test', command: 'active:execute', phase: 'executing', generation: 2, owner: null, agent: 'custom', reviewer: null, createdAt: 'start', updatedAt: 'now', reason: null };
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
