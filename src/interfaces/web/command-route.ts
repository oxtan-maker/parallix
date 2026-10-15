import * as crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { BoardProjection } from '../../application/projections/board.js';
import type { BoardCommandRequest } from '../../application/controller/board-command.js';
import { failure, rejected, type ApplicationOutcome, type Capability } from '../../application/contracts.js';
import type { WebHostOptions } from './host.js';
import { isEditMissionBody } from './transport-edit-mission.js';
import { isCreateMissionBody, isInvalidWebCommandRequest, toWebBoardSnapshot, toWebCommandResult, validateWebCommandRequest, type WebBoardSnapshot, type WebCommandResult } from './transport.js';
import { dispatchEditMission, dispatchCreateMission, errorMessage, sendCommandResult } from './host-support.js';

export const WEB_COMMANDS_PATH = '/api/commands';

function actionConflict(snapshot: WebBoardSnapshot, command: { missionId: string; kind: string }) {
  const card = snapshot.stages
    .flatMap((stage) => stage.cards)
    .find((candidate) => candidate.id === command.missionId);
  if (card === undefined) {
    return failure('conflict', `mission ${command.missionId} is not on the board`);
  }
  const action = card.actions.find((candidate) => candidate.kind === command.kind);
  if (action === undefined || action.state !== 'enabled') {
    const detail = action?.reason !== null && action?.reason !== undefined ? `: ${action.reason}` : '';
    return failure('conflict',
      `action ${command.kind} is not enabled for mission ${command.missionId}${detail}`);
  }
  return null;
}

export function registerCommandRoute(app: FastifyInstance, options: Pick<WebHostOptions, 'commandDispatcher'>, sharedBuild?: () => Promise<BoardProjection>) {
  app.post(WEB_COMMANDS_PATH, async (request, reply) => {
    const dispatcher = options.commandDispatcher?.();
    if (dispatcher === undefined || dispatcher === null) {
      return sendCommandResult(reply, 503, failure('unavailable', 'command dispatcher port is not wired'));
    }
    if (isEditMissionBody(request.body)) { return dispatchEditMission(reply, dispatcher, request.body); }
    if (isCreateMissionBody(request.body)) { return dispatchCreateMission(reply, dispatcher, request.body); }
    const validation = validateWebCommandRequest(request.body);
    if (isInvalidWebCommandRequest(validation)) {
      return sendCommandResult(reply, 400, rejected('validation', validation.problems.join('; ')));
    }
    const build = sharedBuild;
    if (build === undefined) {
      return sendCommandResult(reply, 503, failure('unavailable', 'board projection port is not wired'));
    }
    let projection: BoardProjection;
    try {
      projection = await build();
    } catch (error) {
      // A failed rebuild is transient, exactly as on the snapshot route:
      // "unavailable, try again", never a dispatch on a stale board.
      return sendCommandResult(reply, 503, failure('unavailable', errorMessage(error)));
    }
    let snapshot: WebBoardSnapshot;
    try {
      // Gating on the wire card reuses the server-owned action states
      // (`enabled`/`ineligible`/`unavailable`) rather than re-deriving
      // them: one definition of "currently advertised".
      snapshot = toWebBoardSnapshot(projection);
    } catch (error) {
      return sendCommandResult(reply, 500, failure('execution', errorMessage(error)));
    }
    const command = validation.value;
    const conflict = actionConflict(snapshot, command);
    if (conflict !== null) { return sendCommandResult(reply, 409, conflict); }
    // Identity is host-owned (fresh operation ID, single-kind capability set).
    const boardRequest: BoardCommandRequest = {
      operationId: crypto.randomUUID(),
      kind: command.kind,
      missionId: command.missionId,
      missionStatusAtRequest: command.missionStatusAtRequest,
      capabilities: new Set([command.kind as Capability] as const),
      ...(command.payload !== undefined
        ? { payload: { kind: 'handoff:record' as const, ...command.payload } }
        : {}),
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
    // Every dispatched outcome — completed, conflict, failed, cancelled —
    // answers 200 inside the envelope; the wire status carries the
    // meaning and no server-side retry happens.
    return reply.code(200).type('application/json; charset=utf-8').send(result);
  });

}
