import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { BoardCommandDispatcher, BoardCommandRequest } from '../../application/controller/board-command.js';
import { isWorkflowCommand } from '../../application/workflow-operation-service.js';
import { isOpenWorkflow, type WorkflowOperation } from '../../domain/workflow-operation.js';
import { completed, failure, type Capability } from '../../application/contracts.js';
import type { WebCommandRequest } from './transport-types.js';
import { WEB_TRANSPORT_VERSION } from './transport-types.js';
import { sendCommandResult } from './host-support.js';

const ADMISSION_ERROR_STATUSES: Readonly<Record<string, number>> = { conflict: 409, validation: 400, capability: 403 };

function settledWorkflowOutcome(operation: WorkflowOperation) {
  const value = { operationId: operation.id, phase: operation.phase };
  return operation.phase === 'completed' ? completed(value)
    : { ...failure(operation.phase === 'stopped' ? 'cancelled' : 'execution', operation.reason ?? operation.phase), value };
}

/** Returns false only for synchronous commands or legacy injected dispatchers. */
export async function admitWebWorkflow(reply: FastifyReply, dispatcher: BoardCommandDispatcher, command: WebCommandRequest,
  invalidate: () => void): Promise<boolean> {
  if (!dispatcher.admit || (!isWorkflowCommand(command.kind) && command.kind !== 'workflow:stop')) { return false; }
  const request: BoardCommandRequest = {
    operationId: randomUUID(), requestKey: command.requestKey, kind: command.kind, missionId: command.missionId,
    ...(command.payload ? { payload: { kind: 'handoff:record' as const, ...command.payload } } : {}),
    missionStatusAtRequest: command.missionStatusAtRequest, capabilities: new Set([command.kind as Capability]),
  };
  try {
    if (command.kind === 'workflow:stop') {
      const result = await dispatcher.dispatch(request);
      invalidate(); sendCommandResult(reply, result.error?.kind === 'conflict' ? 409 : 200, result); return true;
    }
    const outcome = await dispatcher.admit(request);
    if (outcome.status !== 'accepted') {
      sendCommandResult(reply, ADMISSION_ERROR_STATUSES[outcome.error?.kind ?? 'unavailable'] ?? 503, outcome);
      return true;
    }
    invalidate();
    if (!isOpenWorkflow(outcome.operation)) {
      sendCommandResult(reply, 200, settledWorkflowOutcome(outcome.operation));
      return true;
    }
    reply.code(202).type('application/json; charset=utf-8').send({
      kind: 'command-result', transportVersion: WEB_TRANSPORT_VERSION, status: 'accepted', error: null, durableEvidence: [],
      value: { operationId: outcome.operation.id, phase: outcome.operation.phase, statusUrl: `/api/operations/${encodeURIComponent(outcome.operation.id)}` },
    });
  } catch (error) { sendCommandResult(reply, 503, failure('unavailable', error instanceof Error ? error.message : String(error))); }
  return true;
}

export function registerWorkflowReads(app: FastifyInstance, dispatcher: () => BoardCommandDispatcher | null): void {
  app.get('/api/operations/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id;
    if (id.length > 128) { return reply.code(400).send({ error: 'Invalid operation identity' }); }
    const operation = await dispatcher()?.operation?.(id);
    if (!operation) { return reply.code(404).send({ error: 'Operation not found' }); }
    return reply.send({ operation: { id: operation.id, missionId: operation.missionId, command: operation.command, phase: operation.phase,
      owner: operation.owner, generation: operation.generation, agent: operation.agent, reviewer: operation.reviewer,
      createdAt: operation.createdAt, updatedAt: operation.updatedAt, reason: operation.reason } });
  });
}
