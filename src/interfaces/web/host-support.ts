import { validateWebEditMissionRequest } from './transport-edit-mission.js';
import { missionVersion } from '../../application/domain-ports.js';
import type { FastifyReply } from 'fastify';
import * as crypto from 'node:crypto';
import { failure, rejected, type ApplicationOutcome, type Capability } from '../../application/contracts.js';
import type { BoardCommandDispatcher } from '../../application/controller/board-command.js';
import { toWebCommandResult, validateWebCreateMissionRequest } from './transport.js';

export function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Every body this host answers with for a command is the safe wire envelope. */
export function sendCommandResult(reply: FastifyReply, status: number, outcome: ApplicationOutcome<unknown>): void {
  reply.code(status).type('application/json; charset=utf-8').send(toWebCommandResult(outcome));
}

/** The transport status Fastify attached to a lifecycle error, if any. */
export function transportStatusCode(error: unknown): number {
  if (typeof error === 'object' && error !== null && typeof (error as { statusCode?: unknown }).statusCode === 'number') {
    return (error as { statusCode: number }).statusCode;
  }
  return 500;
}

/**
 * Dispatch a validated "Create new mission" body through the guarded board
 * dispatcher. Identity is host-owned exactly as for card commands: a fresh
 * operation ID and the single intake capability; the wire has no key for either.
 */
export async function dispatchCreateMission(reply: FastifyReply, dispatcher: BoardCommandDispatcher, body: unknown): Promise<void> {
  const validation = validateWebCreateMissionRequest(body);
  if ('problems' in validation) { return sendCommandResult(reply, 400, rejected('validation', validation.problems.join('; '))); }
  const { kind: _kind, ...fields } = validation.value;
  let outcome: ApplicationOutcome<unknown>;
  try {
    outcome = await dispatcher.dispatch({
      operationId: crypto.randomUUID(),
      kind: 'mission:create',
      missionId: '',
      capabilities: new Set<Capability>(['mission:intake']),
      payload: { kind: 'mission:create', ...fields },
    });
  } catch (error) {
    outcome = failure('execution', errorMessage(error));
  }
  try {
    reply.code(200).type('application/json; charset=utf-8').send(toWebCommandResult(outcome));
  } catch (error) {
    sendCommandResult(reply, 500, failure('execution', errorMessage(error)));
  }
}

export async function dispatchEditMission(reply: FastifyReply, dispatcher: BoardCommandDispatcher, body: unknown): Promise<void> {
  const validation = validateWebEditMissionRequest(body);
  if ('problems' in validation) { return sendCommandResult(reply, 400, rejected('validation', validation.problems.join('; '))); }
  const request = validation.value;
  try {
    const payload = request.kind === 'mission:edit-read' ? { kind: request.kind } as const
      : { ...request, expectedVersion: missionVersion(request.expectedVersion) };
    const outcome = await dispatcher.dispatch({ operationId: crypto.randomUUID(), kind: request.kind,
      missionId: request.missionId, capabilities: new Set<Capability>(['mission:context']), payload });
    sendCommandResult(reply, 200, outcome);
  } catch (error) { sendCommandResult(reply, 500, failure('execution', errorMessage(error))); }
}
