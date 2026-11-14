import { findBoardMission, type BoardProjection } from '../../application/projections/board.js';
import type { BoardCommandRequest } from '../../application/controller/board-command.js';
import type { WebCommandRequest, WebBoardSnapshot, WebCommandResult } from './transport.js';
import { toWebBoardSnapshot } from './transport.js';
import type { SharedProjectionRead } from './shared-build.js';
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

/** Surface deferred historical work without claiming that its values are current. */
export function withAnalyticsFreshness(read: SharedProjectionRead<BoardProjection>): SharedProjectionRead<BoardProjection> {
  const analytics = read.projection.metrics.analytics;
  if (read.freshness.state === 'stale' || analytics === undefined || analytics.freshness === 'fresh') { return read; }
  return { ...read, freshness: { ...read.freshness, state: 'stale',
    reason: analytics.reason ?? 'Historical analytics are unavailable.' } };
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

function staleProjectionReason(read: SharedProjectionRead<BoardProjection>): string | null {
  if (read.freshness.state === 'fresh') { return null; }
  return read.freshness.reason ?? 'board projection is stale; refresh and retry';
}

/** Read the retained command gate and fail closed unless its identity is fresh. */
export async function readFreshProjection(reply: FastifyReply,
  readProjection?: () => Promise<SharedProjectionRead<BoardProjection>>): Promise<SharedProjectionRead<BoardProjection> | null> {
  if (readProjection === undefined) {
    sendCommandResult(reply, 503, failure('unavailable', 'board projection port is not wired'));
    return null;
  }
  try {
    const read = await readProjection();
    const reason = staleProjectionReason(read);
    if (reason !== null) {
      sendCommandResult(reply, 503, failure('unavailable', reason));
      return null;
    }
    return read;
  } catch (error) {
    sendCommandResult(reply, 503, failure('unavailable', errorMessage(error)));
    return null;
  }
}

/**
 * Dispatch a validated "Create new mission" body through the guarded board
 * dispatcher. Identity is host-owned exactly as for card commands: a fresh
 * operation ID and the single intake capability; the wire has no key for either.
 */
export async function dispatchCreateMission(reply: FastifyReply, dispatcher: BoardCommandDispatcher, body: unknown,
  afterDispatch: () => Promise<void> = async () => {}): Promise<void> {
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
  await afterDispatch();
  try {
    reply.code(200).type('application/json; charset=utf-8').send(toWebCommandResult(outcome));
  } catch (error) {
    sendCommandResult(reply, 500, failure('execution', errorMessage(error)));
  }
}

export async function dispatchEditMission(reply: FastifyReply, dispatcher: BoardCommandDispatcher, body: unknown,
  afterDispatch: () => Promise<void> = async () => {}): Promise<void> {
  const validation = validateWebEditMissionRequest(body);
  if ('problems' in validation) { return sendCommandResult(reply, 400, rejected('validation', validation.problems.join('; '))); }
  const request = validation.value;
  try {
    const payload = request.kind === 'mission:edit-read' ? { kind: request.kind } as const
      : { ...request, expectedVersion: missionVersion(request.expectedVersion) };
    const outcome = await dispatcher.dispatch({ operationId: crypto.randomUUID(), kind: request.kind,
      missionId: request.missionId, capabilities: new Set<Capability>(['mission:context']), payload });
    if (request.kind === 'mission:edit') { await afterDispatch(); }
    sendCommandResult(reply, 200, outcome);
  } catch (error) { sendCommandResult(reply, 500, failure('execution', errorMessage(error))); }
}

/** Synchronous card actions retain projection eligibility and guarded dispatch. */
export async function dispatchProjectedCommand(reply: FastifyReply, dispatcher: BoardCommandDispatcher, command: WebCommandRequest,
  read?: SharedProjectionRead<BoardProjection>, afterDispatch: () => Promise<void> = async () => {}): Promise<void> {
  if (read === undefined) {
    return sendCommandResult(reply, 503, failure('unavailable', 'board projection port is not wired'));
  }
  const staleReason = staleProjectionReason(read);
  if (staleReason !== null) {
    return sendCommandResult(reply, 503, failure('unavailable', staleReason));
  }
  let snapshot: WebBoardSnapshot;
  try {
    // Gating on the wire card reuses the server-owned action states
    // (`enabled`/`ineligible`/`unavailable`) rather than re-deriving
    // them: one definition of "currently advertised".
    snapshot = toWebBoardSnapshot(read.projection, read.freshness);
  } catch (error) {
    return sendCommandResult(reply, 500, failure('execution', errorMessage(error)));
  }
  if (findBoardMission(read.projection, command.missionId) === undefined) {
    return sendCommandResult(reply, 409, failure('conflict', `mission ${command.missionId} is not on the board`));
  }
  const card = snapshot.stages.flatMap(stage => [...stage.cards, ...stage.historyCards ?? []])
    .find(candidate => candidate.id === command.missionId)!;
  const action = card.actions.find((candidate) => candidate.kind === command.kind);
  if (action === undefined || action.state !== 'enabled') {
    const detail = action?.reason !== null && action?.reason !== undefined ? `: ${action.reason}` : '';
    return sendCommandResult(reply, 409, failure('conflict',
      `action ${command.kind} is not enabled for mission ${command.missionId}${detail}`));
  }
  // Identity is host-owned (fresh operation ID, single-kind capability set).
  const boardRequest: BoardCommandRequest = {
    operationId: crypto.randomUUID(),
    kind: command.kind,
    missionId: command.missionId,
    missionStatusAtRequest: command.missionStatusAtRequest,
    ...selectedFamilyFields(command.agent),
    capabilities: new Set([command.kind as Capability] as const),

  };
  let outcome: ApplicationOutcome<unknown>;
  try {
    outcome = await dispatcher.dispatch(boardRequest);
  } catch (error) {
    // A dispatcher that throws is an execution failure; only its
    // message may cross the wire.
    outcome = failure('execution', errorMessage(error));
  }
  let result: WebCommandResult;
  try {
    result = toWebCommandResult(outcome);
  } catch (error) {
    // An outcome the transport refuses to project is a contract
    // failure, not a dispatched outcome.
    return sendCommandResult(reply, 500, failure('execution', errorMessage(error)));
  }
  await afterDispatch();
  // Every dispatched outcome — completed, conflict, failed, cancelled —
  // answers 200 inside the envelope; the wire status carries the
  // meaning and no server-side retry happens.
  reply.code(200).type('application/json; charset=utf-8').send(result);
}

/** The transport exposes only a validated family, never launcher options. */
export function selectedFamilyFields(agent?: string): Pick<BoardCommandRequest, 'agent' | 'pinnedAgent'> {
  return agent === undefined ? {} : { agent, pinnedAgent: true };
}
