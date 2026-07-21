import test from 'node:test';
import assert from 'node:assert/strict';

const { LegacyActiveAdapter } = require('../dist/lib/adapters/legacy-active-adapter');

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
    transitionTask() { calls.push('synchronize'); return true; },
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
  assert.deepEqual(calls, ['preflight', 'worktree', 'task', 'checkpoint', 'config', 'prompt', 'launch-record', 'safety', 'status', 'synchronize', 'model', 'telemetry', 'stats', 'handoff']);
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
