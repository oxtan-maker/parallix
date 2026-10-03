import test from 'node:test';
import assert from 'node:assert/strict';

import { BoardCommandController } from '../src/application/controller/board-controller.js';
import { createBoardIntegrateService } from '../src/composition/application-services.js';
import { NO_CURRENT_WORK_PORT } from '../src/application/recording/current-work-recorder.js';
import type { BoardCommandRequest } from '../src/application/controller/board-command.js';
import { makeExecutePorts } from './fixtures/execute-mission-ports.js';

function request(overrides: Partial<BoardCommandRequest> = {}): BoardCommandRequest {
  return {
    operationId: 'integrate-op',
    kind: 'integrate:merge',
    missionId: 'task-2429',
    missionStatusAtRequest: 'integration',
    capabilities: new Set(),
    ...overrides,
  };
}

function controllerFor(status = 'integration', integrate = async (_slug: string): Promise<void> => {}) {
  const effects: string[] = [];
  let writes = 0;
  const store = {
    async load() {
      effects.push('load');
      return { kind: 'found', mission: { status }, version: 1 } as never;
    },
    async save() { writes += 1; return 2 as never; },
  };
  const controller = new BoardCommandController(makeExecutePorts().ports, undefined, {
    integrate: {
      async executeForSlug(slug: string) { effects.push('integrate:' + slug); await integrate(slug); },
    },
  } as never, undefined, store as never);
  return { controller, effects, writes: () => writes };
}

test('task-2429: integrate:merge reads current authority then invokes the integration workflow once', async () => {
  const { controller, effects, writes } = controllerFor();

  const result = await controller.dispatch(request());

  assert.equal(result.status, 'completed');
  assert.deepEqual(result.value, { slug: 'task-2429' });
  assert.deepEqual(effects, ['load', 'integrate:task-2429']);
  assert.equal(writes(), 0, 'completion remains the next authoritative projection, not a controller write');
});

test('task-2429: a gate failure returns failure with no completed-state transition', async () => {
  const { controller, effects } = controllerFor('integration', async () => { throw new Error('gate failed'); });

  const result = await controller.dispatch(request());

  assert.equal(result.status, 'failed');
  assert.equal(result.error?.kind, 'execution');
  assert.notEqual(result.status, 'completed');
  assert.deepEqual(effects, ['load', 'integrate:task-2429']);
});

test('task-2429: unavailable integration rejects before authoritative reads or effects', async () => {
  const effects: string[] = [];
  const controller = new BoardCommandController(makeExecutePorts().ports, undefined, {}, undefined, {
    async load() { effects.push('load'); return { kind: 'found', mission: { status: 'integration' }, version: 1 } as never; },
  });

  const result = await controller.dispatch(request());

  assert.equal(result.status, 'rejected');
  assert.equal(result.error?.kind, 'capability');
  assert.deepEqual(effects, []);
});

test('task-2429: stale integrate:merge is rejected before the integration workflow', async () => {
  const { controller, effects } = controllerFor('review');

  const result = await controller.dispatch(request());

  assert.equal(result.status, 'failed');
  assert.equal(result.error?.kind, 'conflict');
  assert.deepEqual(effects, ['load']);
});

test('task-2429: integration authorization exit returns a board failure, not completed', async () => {
  const prior = process.env.WORKFLOW_AGENT;
  process.env.WORKFLOW_AGENT = 'gemini';
  try {
    const controller = new BoardCommandController(makeExecutePorts().ports, undefined, {
      integrate: createBoardIntegrateService({} as never, NO_CURRENT_WORK_PORT),
    }, undefined, {
      async load() { return { kind: 'found', mission: { status: 'integration' }, version: 1 } as never; },
    });

    const result = await controller.dispatch(request());

    assert.equal(result.status, 'failed');
    assert.equal(result.error?.kind, 'execution');
    assert.notEqual(result.status, 'completed');
  } finally {
    if (prior === undefined) { delete process.env.WORKFLOW_AGENT; }
    else { process.env.WORKFLOW_AGENT = prior; }
  }
});
