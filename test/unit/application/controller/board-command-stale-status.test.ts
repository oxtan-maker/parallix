import { fixtureMission } from '../../../fixtures/mission-builders.js';
import { missionVersion } from '../../../../src/application/domain-ports.js';
import type { MissionStatus } from '../../../../src/domain/mission.js';
import test from 'node:test';
import assert from 'node:assert/strict';

import { BoardCommandController } from '../../../../src/application/controller/board-controller.js';
import type { BoardCommandRequest } from '../../../../src/application/controller/board-command.js';
import { makeExecutePorts } from '../../../fixtures/execute-mission-ports.js';

test('authoritative status change rejects confirmation before the effect is called', async () => {
  let status: MissionStatus = 'backlog';
  const authoritativeMission = {
    async load() { return { kind: 'found' as const, mission: fixtureMission('task-2425', { status }), version: missionVersion(1) }; },
  };
  const { ports, calls } = makeExecutePorts();
  const controller = new BoardCommandController(ports, undefined, {}, undefined, authoritativeMission);
  const request: BoardCommandRequest = {
    operationId: 'task-2425-race',
    kind: 'active:execute',
    missionId: 'task-2425',
    missionStatusAtRequest: status,
    agent: 'codex',
    capabilities: new Set(['active:execute']),
  };

  status = 'refined';
  const result = await controller.dispatch(request);

  assert.equal(result.error?.kind, 'conflict');
  assert.equal(calls.length, 0);
});

test('CLI dispatch without a board status snapshot accepts the authoritative mission', async () => {
  const authoritativeMission = {
    async load() { return { kind: 'found' as const, mission: fixtureMission('task-2425', { status: 'refined' }), version: missionVersion(1) }; },
  };
  const { ports, calls } = makeExecutePorts();
  const controller = new BoardCommandController(ports, undefined, {}, undefined, authoritativeMission);

  const result = await controller.dispatch({
    operationId: 'task-2425-cli',
    kind: 'active:execute',
    missionId: 'task-2425',
    agent: 'codex',
    capabilities: new Set(['active:execute']),
  });

  assert.equal(result.status, 'completed');
  assert.ok(calls.length > 0, 'execute effect should run');
});
