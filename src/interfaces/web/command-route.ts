import { admitWebWorkflow } from './workflow-route.js';
import type { FastifyInstance } from 'fastify';
import type { BoardProjection } from '../../application/projections/board.js';
import { failure, rejected } from '../../application/contracts.js';
import type { WebHostOptions } from './host.js';
import { isEditMissionBody } from './transport-edit-mission.js';
import { isCreateMissionBody, isInvalidWebCommandRequest, validateWebCommandRequest } from './transport.js';
import { dispatchProjectedCommand, dispatchEditMission, dispatchCreateMission, sendCommandResult } from './host-support.js';

export const WEB_COMMANDS_PATH = '/api/commands';

export function registerCommandRoute(app: FastifyInstance, options: Pick<WebHostOptions, 'commandDispatcher'>, sharedBuild?: () => Promise<BoardProjection>, invalidate: () => void = () => {}) {
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
    if (!dispatcher.canExecute(validation.value.kind)) {
      return sendCommandResult(reply, 409, failure('conflict', 'This workflow capability is unavailable'));
    }
    if (await admitWebWorkflow(reply, dispatcher, validation.value, invalidate)) { return; }
    return dispatchProjectedCommand(reply, dispatcher, validation.value, sharedBuild);
  });
}
