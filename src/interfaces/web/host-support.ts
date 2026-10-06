import type { FastifyReply } from 'fastify';
import type { ApplicationOutcome } from '../../application/contracts.js';
import { toWebCommandResult } from './transport.js';

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
