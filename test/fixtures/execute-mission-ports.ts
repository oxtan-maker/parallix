import type { ExecuteMissionPorts } from '../../src/application/ports/execute-mission.js';

/**
 * In-memory execute-workflow mechanism ports (TASK-2332.04).
 *
 * Shared by the board controller and progress-event suites so both dispatch
 * through the real `ExecuteMissionService` while every effect stays in memory.
 * The default run needs no lifecycle synchronization (the launch deferred no
 * rebase and the task is already active), so `missionTransitions` stays untouched
 * unless a test asks for it.
 */
export function makeExecutePorts(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const ports = {
    workspace: {
      async preflight(slug: string) { calls.push(`validate:${slug}`); return true; },
      async resolveWorktree() { return '/worktree'; },
      async resolveTaskFile() { return { ok: true, taskFile: '/worktree/task.md' }; },
      async readTaskStatus() { return 'active'; },
      async enforceCommitSafety() { /* traced by the adapter suites, not here */ },
    },
    agentExecution: {
      async prepare() { return { prompt: 'execute prompt', agentConfig: {} }; },
      async launch(request: { slug: string; preselectedAgent: string | null }) {
        calls.push(`launch:${request.slug}:${request.preselectedAgent ?? 'default'}`);
        return {
          agent: request.preselectedAgent ?? 'codex',
          rebaseDeferred: false,
          errored: false,
          errorMessage: null,
          exitStatus: 0,
          detail: null,
        };
      },
    },
    missionTransitions: {
      async load() { return { kind: 'found', mission: { status: 'refined' }, version: 1 }; },
      async save() { calls.push('synchronize'); return 1; },
      async saveWithTransition() { calls.push('synchronize'); return 1; },
    },
    telemetry: {
      async recordLaunchTelemetry(record: { slug: string; agent: string }) {
        calls.push(`record:${record.slug}:${record.agent}`);
      },
    },
    handoffReview: {
      async runHandoffAndReview(request: { slug: string; agent: string }) {
        calls.push(`handoff:${request.slug}:${request.agent}`);
        return true;
      },
    },
    ...overrides,
  };
  return { ports: ports as unknown as ExecuteMissionPorts, calls };
}
