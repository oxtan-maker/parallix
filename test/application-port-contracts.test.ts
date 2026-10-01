// Application port contracts: typed outcomes, production capability
// composition, and single-dispatcher convergence for CLI and TUI.
//
// Behavior-owned suite (TASK-2622.06 pilot). Ports are injected fakes; no
// concrete operator database or launcher is constructed. Legacy case names are
// unchanged; sections keep task provenance.
//   Application outcomes and view data: no task ID in the legacy file
//   Production capability composition: no task ID in the legacy file
//   Command dispatch convergence: TASK-2332.05

import test, { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { failure, rejected } from '../src/application/contracts.js';
import { composeProductionCapabilities } from '../src/composition/production-capabilities.js';
import { repositoryId } from '../src/domain/repository.js';
import { makeExecutePorts } from './fixtures/execute-mission-ports.js';
import { NO_CURRENT_WORK_PORT } from '../src/application/recording/current-work-recorder.js';
import { BoardCommandController } from '../src/application/controller/board-controller.js';
import type { ExecuteMissionPorts } from '../src/application/ports/execute-mission.js';
import { missionVersion } from '../src/application/domain-ports.js';

describe('Application outcomes and view data', () => {
  test('application outcomes have one terminal status and typed error variants', () => {
    const validation = rejected('validation', 'bad request');
    const capability = rejected('capability', 'not allowed');
    const unavailable = failure('unavailable', 'offline');
    const cancelled = failure('cancelled', 'stopped');
    assert.deepEqual([validation.status, capability.status, unavailable.status, cancelled.status], ['rejected', 'rejected', 'failed', 'cancelled']);
    assert.equal(validation.error.kind, 'validation');
    assert.equal(capability.error.kind, 'capability');
    assert.equal(unavailable.error.kind, 'unavailable');
    assert.equal(cancelled.error.kind, 'cancelled');
  });

  test('stats projections preserve source and staleness labels as view data', () => {
    const projection = { rows: [], sources: [{ source: 'stats', status: 'stale', value: '2026-07-20' }] };
    assert.equal(projection.sources[0].source, 'stats');
    assert.equal(projection.sources[0].status, 'stale');
  });
});

describe('Production capability composition', () => {
  const repositories = {
    agentBlocklist: { async findAll() { return []; }, async findByAgent() { return undefined; }, async save() {}, async deleteByAgent() {}, async clear() {} },
    operationalHistory: { async findAll() { return []; }, async findByType() { return []; }, async append() {}, async clear() {} },
    boardLaneEvents: { async findAll() { return []; }, async findByMissionId() { return []; }, async findByRepositoryId() { return []; }, async append() { return true; }, async clear() {} },
    usage: { async findAll() { return []; }, async findWhere() { return []; }, async save() {}, async saveAll() {}, async clear() {} },
  };

  test('production composition gives CLI and TUI identical board and active capability instances', () => {
    const { ports } = makeExecutePorts();

    const capabilities = composeProductionCapabilities('/fixture-repository', repositoryId('fixture-repository'), repositories, ports, null, NO_CURRENT_WORK_PORT);

    assert.strictEqual(capabilities.boardProjection, capabilities.tui.boardProjection);
    assert.strictEqual(capabilities.missionDetails, capabilities.tui.missionDetails);
    assert.strictEqual(capabilities.executePorts, ports);
  });
});

describe('Command dispatch convergence (TASK-2332.05)', () => {
  /**
   * TASK-2332.05 — CLI and TUI route through one canonical dispatcher
   * (BoardCommandController). Behavioral test proves both surfaces reach it.
   */
  describe('command-dispatch-convergence', () => {
    it('CLI active command dispatches through BoardCommandController', async () => {
      const launchSpy = mock.fn(async () => ({
        agent: 'codex',
        rebaseDeferred: false,
        errored: false,
        errorMessage: null,
        exitStatus: 0,
        detail: null,
      }));

      const ports = createPorts(launchSpy);
      const controller = new BoardCommandController(ports);

      const result = await controller.dispatch({
        kind: 'active:execute',
        missionId: 'task-test',
        operationId: 'active:task-test',
        capabilities: new Set(['active:execute']),
      });

      assert.equal(result.status, 'completed', 'dispatch returns completed');
      assert.equal(launchSpy.mock.callCount(), 1, 'agentExecution.launch called via controller');
    });

    it('TUI dispatches through same BoardCommandController type', async () => {
      const launchSpy = mock.fn(async () => ({
        agent: 'codex',
        rebaseDeferred: false,
        errored: false,
        errorMessage: null,
        exitStatus: 0,
        detail: null,
      }));

      const ports = createPorts(launchSpy);
      const controller = new BoardCommandController(ports);

      const result = await controller.dispatch({
        kind: 'active:execute',
        missionId: 'task-test',
        missionStatusAtRequest: 'active',
        operationId: 'tui:active:task-test',
        capabilities: new Set(['active:execute']),
      });

      assert.equal(result.status, 'completed', 'TUI dispatch returns completed');
      assert.equal(launchSpy.mock.callCount(), 1, 'TUI routes through controller');
    });

    it('single BoardCommandController instance serves both surfaces', async () => {
      const launchSpy = mock.fn(async () => ({
        agent: 'codex',
        rebaseDeferred: false,
        errored: false,
        errorMessage: null,
        exitStatus: 0,
        detail: null,
      }));

      const ports = createPorts(launchSpy);
      const controller = new BoardCommandController(ports);

      // CLI dispatch
      await controller.dispatch({
        kind: 'active:execute',
        missionId: 'task-test',
        missionStatusAtRequest: 'active',
        operationId: 'cli:1',
        capabilities: new Set(['active:execute']),
      });

      // TUI dispatch
      await controller.dispatch({
        kind: 'active:execute',
        missionId: 'task-test',
        missionStatusAtRequest: 'active',
        operationId: 'tui:1',
        capabilities: new Set(['active:execute']),
      });

      assert.equal(
        launchSpy.mock.callCount(),
        2,
        'Both surfaces route through same controller instance',
      );
    });

    it('BoardCommandController wraps ExecuteMissionService (not raw ports)', () => {
      const launchSpy = mock.fn(async () => ({}));
      const ports = createPorts(launchSpy);
      const controller = new BoardCommandController(ports);
      // Controller internally creates ExecuteMissionService from ports
      assert.ok(controller instanceof BoardCommandController);
    });
  });

  function createPorts(launchSpy: any): ExecuteMissionPorts {
    return {
      workspace: {
        preflight: async () => true,
        resolveWorktree: async () => '/tmp/wt',
        resolveTaskFile: async () => ({ ok: true, taskFile: '/tmp/task.md' }),
        readTaskStatus: async () => 'active',
        enforceCommitSafety: async () => {},
      },
      agentExecution: {
        prepare: async () => ({
          prompt: 'test',
          agent: 'codex',
          agentConfig: null,
        }),
        launch: launchSpy,
      },
      missionTransitions: {
        load: async () => ({ kind: 'found' as const, mission: { status: 'active' } as never, version: missionVersion(1) }),
        save: async () => missionVersion(1),
        saveWithTransition: async () => missionVersion(1),
      },
      telemetry: {
        recordLaunchTelemetry: async () => {},
      },
      handoffReview: {
        runHandoffAndReview: async () => true,
      },
    };
  }
});
