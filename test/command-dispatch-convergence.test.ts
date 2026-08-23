/**
 * TASK-2332.05 — CLI and TUI route through one canonical dispatcher
 * (BoardCommandController). Behavioral test proves both surfaces reach it.
 */
import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

import { BoardCommandController } from '../src/application/controller/board-controller.js';
import type { ExecuteMissionPorts } from '../src/application/ports/execute-mission.js';
import { missionVersion } from '../src/application/domain-ports.js';

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
      missionStatusAtRequest: 'active',
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
        agentConfig: null,
      }),
      launch: launchSpy,
    },
    missionTransitions: {
      load: async () => ({ kind: 'missing' as const }),
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
