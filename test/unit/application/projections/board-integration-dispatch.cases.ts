import { setLogger } from '../../../../src/application/presentation/cli-format.js';
import { fixtureMission } from '../../../fixtures/mission-builders.js';
import { integrationServices } from '../../../helpers/stub-integration-services.js';
import type { MissionStatus } from '../../../../src/domain/mission.js';
import { missionVersion as fixtureVersion } from '../../../../src/application/domain-ports.js';
import { resolveConfiguration } from '../../../../src/composition/config.js';
const environment: NodeJS.ProcessEnv = { ...process.env };
import test from 'node:test';
import assert from 'node:assert/strict';

import { BoardCommandController } from '../../../../src/application/controller/board-controller.js';
import { createBoardIntegrateService } from '../../../../src/composition/application-services.js';
import { NO_CURRENT_WORK_PORT } from '../../../../src/application/recording/current-work-recorder.js';
import type { BoardCommandRequest } from '../../../../src/application/controller/board-command.js';
import { makeExecutePorts } from '../../../fixtures/execute-mission-ports.js';

function request(overrides: Partial<BoardCommandRequest> = {}): BoardCommandRequest {
  return {
    operationId: 'integrate-op',
    kind: 'integrate:merge' as const,
    missionId: 'task-2429',
    missionStatusAtRequest: 'integration',
    capabilities: new Set(),
    ...overrides,
  };
}

function controllerFor(status: MissionStatus = 'integration', integrate = async (_slug: string): Promise<void> => {}) {
  const effects: string[] = [];
  let writes = 0;
  const store = {
    async load() {
      effects.push('load');
      return { kind: 'found' as const, mission: fixtureMission('task-2429', { status }), version: fixtureVersion(1) };
    },
    async save() { writes += 1; return 2; },
  };
  const controller = new BoardCommandController(makeExecutePorts().ports, undefined, {
    integrate: {
      async executeForSlug(slug: string) { effects.push('integrate:' + slug); await integrate(slug); },
    },
  }, undefined, store);
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
    async load() { effects.push('load'); return { kind: 'found', mission: fixtureMission('task-2429', { status: 'integration' }), version: fixtureVersion(1) }; },
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

test('task-2429: integration authorization exit returns a board failure, not completed', async t => {
  const lines: string[] = [];
  const previousLogger = setLogger({ log: message => { lines.push(String(message)); }, error: message => { lines.push(String(message)); } });
  t.after(() => { setLogger(previousLogger); });
  const configuration = resolveConfiguration({ ...environment, WORKFLOW_AGENT: 'gemini' });
  const root = '/isolated/board-host';
  const resolved: string[] = [];
  const controller = new BoardCommandController(makeExecutePorts().ports, undefined, {
    integrate: createBoardIntegrateService(integrationServices(), NO_CURRENT_WORK_PORT, configuration, root,
      (slug, hostRoot, receivedConfiguration) => {
        resolved.push(slug);
        assert.equal(hostRoot, root);
        assert.equal(receivedConfiguration, configuration);
        return { ok: true, context: { missionId: slug, missionBranch: `mission/${slug}`,
          missionWorktree: '/isolated/mission', baseWorktree: root, baseBranch: 'main' } };
      }),
  }, undefined, {
    async load() { return { kind: 'found', mission: fixtureMission('task-2429', { status: 'integration' }), version: fixtureVersion(1) }; },
  });

  const result = await controller.dispatch(request());

  assert.equal(result.status, 'failed');
  assert.equal(result.error?.kind, 'execution');
  assert.notEqual(result.status, 'completed');
  assert.deepEqual(resolved, ['task-2429'], 'use the supplied resolver instead of real Git (TASK-2777 F1)');
  assert.equal(result.error?.message, 'integrate:merge for task-2429 failed: integration workflow exited with code 1');
  assert.match(lines.join('\n'), /Gemini is not authorized to run integrate/, 'reach the authorization guard (TASK-2777 F1)');
});
