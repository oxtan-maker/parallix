import test from 'node:test';
import assert from 'node:assert/strict';

const { LegacyActiveAdapter } = require('../.test-runtime/lib/adapters/legacy-active-adapter');

function strictRuntime(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const runtime = {
    preflight() { calls.push('preflight'); return { pass: true }; },
    resolveWorktree() { calls.push('worktree'); return '/worktree'; },
    resolveTaskFile() { calls.push('task'); return { ok: true, taskFile: '/worktree/backlog/tasks/task-1.md' }; },
    buildCheckpointContext() { calls.push('checkpoint'); return 'CP-5'; },
    readAgentConfig() { calls.push('config'); return {}; },
    buildExecutePrompt() { calls.push('prompt'); return 'execute prompt'; },
    async selectLaunchAndRecord() { calls.push('launch-record'); return { agent: 'codex', result: { status: 0, startedAt: '2026-07-20T10:00:00Z', endedAt: '2026-07-20T10:01:00Z' }, rebaseDeferred: true }; },
    enforceExecuteCommitSafety() { calls.push('safety'); },
    getTaskStatus() { calls.push('status'); return 'active'; },
    // TASK-2322.05: the adapter no longer calls transitionTask directly. It
    // hands the launched worktree's Mission authority to the lifecycle use
    // case, which decides the transition and writes through this port.
    missionStore() {
      calls.push('mission-store');
      return {
        async load() {
          calls.push('load');
          return {
            kind: 'found',
            version: 3,
            mission: {
              id: 'task-1', repositoryId: 'repo', title: 'Fixture', labels: [],
              assignee: null, checkpoints: [], review: null, netEngineeringLines: null,
              status: 'refined', closedAt: null,
            },
          };
        },
        async save(_mission: unknown, expectedVersion: number) {
          calls.push('synchronize');
          return expectedVersion + 1;
        },
        async saveWithTransition(_mission: unknown, expectedVersion: number) {
          calls.push('synchronize');
          return expectedVersion + 1;
        },
      };
    },
    recordActiveStats() { calls.push('stats'); },
    resolveAgentModel() { calls.push('model'); return 'gpt-5'; },
    resolveStageTelemetry() { calls.push('telemetry'); return null; },
    async runHandoffAndReview() { calls.push('handoff'); return true; },
    ...overrides,
  };
  return { runtime, calls };
}

test('legacy active adapter preserves the launch-synchronize-stats-handoff lifecycle order', async () => {
  const { runtime, calls } = strictRuntime();
  const adapter = new LegacyActiveAdapter('/repo', runtime);
  assert.equal(await adapter.validateSlug('task-1'), null);
  const launch = await adapter.launch('task-1', 'codex');
  await adapter.recordLaunch('task-1', launch.agent);
  await adapter.handoff('task-1', launch.agent);
  assert.deepEqual(calls, ['preflight', 'worktree', 'task', 'checkpoint', 'config', 'prompt', 'launch-record', 'safety', 'status', 'mission-store', 'load', 'synchronize', 'model', 'telemetry', 'stats', 'handoff']);
});

test('legacy active adapter stops after a failed launch without safety, stats, or handoff', async () => {
  const { runtime, calls } = strictRuntime({ async selectLaunchAndRecord() { calls.push('launch-record'); return { agent: 'codex', result: { status: 1 } }; } });
  const adapter = new LegacyActiveAdapter('/repo', runtime);
  assert.equal(await adapter.validateSlug('task-1'), null);
  await assert.rejects(adapter.launch('task-1', 'codex'), {
    message: 'Execute agent (codex) exited with status 1.',
  });
  assert.deepEqual(calls, ['preflight', 'worktree', 'task', 'checkpoint', 'config', 'prompt', 'launch-record']);
});

test('legacy active adapter fails closed when the Mission authority refuses the activation', async () => {
  const { runtime, calls } = strictRuntime({
    missionStore() {
      calls.push('mission-store');
      return {
        // An unrecorded mission cannot be activated: the use case reports
        // unavailable and the adapter keeps its fail-closed message.
        async load() { calls.push('load'); return { kind: 'missing' }; },
        async save() { calls.push('synchronize'); return 1; },
        async saveWithTransition() { calls.push('synchronize'); return 1; },
      };
    },
  });
  const adapter = new LegacyActiveAdapter('/repo', runtime);
  assert.equal(await adapter.validateSlug('task-1'), null);
  const launch = await adapter.launch('task-1', 'codex');
  await assert.rejects(adapter.recordLaunch('task-1', launch.agent), {
    message: 'legacy task lifecycle synchronization failed',
  });
  assert.deepEqual(calls, ['preflight', 'worktree', 'task', 'checkpoint', 'config', 'prompt', 'launch-record', 'safety', 'status', 'mission-store', 'load']);
});
