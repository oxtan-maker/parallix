// @ts-nocheck -- TASK-2328: partial test doubles from ESM seam migration; resolve in follow-up
import test from 'node:test';
import assert from 'node:assert/strict';

// Adapter-level contract for the execute mechanism set. The workflow ordering
// itself is covered by test/execute-mission-characterization.test.ts, which
// drives these same adapters end to end.
import { createExecuteMissionPorts, MissionWorkspaceAdapter, AgentExecutionAdapter, ExecuteTelemetryAdapter, HandoffReviewAdapter, } from '../src/adapters/mission/execute-mission-adapters.js';
function runtimeStub(overrides: Record<string, unknown> = {}) {
  return {
    preflight() { return { pass: true }; },
    resolveWorktree() { return '/worktree'; },
    resolveTaskFile() { return { ok: true, taskFile: '/worktree/task.md' }; },
    buildCheckpointContext() { return 'CP-5'; },
    readAgentConfig() { return { steps: ['active'] }; },
    buildExecutePrompt() { return 'execute prompt'; },
    async selectLaunchAndRecord() { return { agent: 'codex', result: { status: 0 }, rebaseDeferred: false }; },
    enforceExecuteCommitSafety() {},
    getTaskStatus() { return 'active'; },
    recordActiveStats() {},
    resolveAgentModel() { return 'gpt-5'; },
    resolveStageTelemetry() { return null; },
    async runHandoffAndReview() { return true; },
    ...overrides,
  };
}

const transitionStore = {
  async load() { return { kind: 'missing' }; },
  async save() { return 1; },
  async saveWithTransition() { return 1; },
};

test('execute mission ports use the injected mission transition store identity', () => {
  const ports = createExecuteMissionPorts('/repo', { missionTransitionStore: transitionStore }, runtimeStub());
  assert.strictEqual(ports.missionTransitions, transitionStore);
});

test('execute mission ports refuse construction without a mission transition store', () => {
  assert.throws(
    () => createExecuteMissionPorts('/repo', {} as never, runtimeStub()),
    { message: 'composition must supply a mission transition store' },
  );
});

test('each execute mechanism port is a distinct narrow adapter', () => {
  const ports = createExecuteMissionPorts('/repo', { missionTransitionStore: transitionStore }, runtimeStub());
  assert.ok(ports.workspace instanceof MissionWorkspaceAdapter);
  assert.ok(ports.agentExecution instanceof AgentExecutionAdapter);
  assert.ok(ports.telemetry instanceof ExecuteTelemetryAdapter);
  assert.ok(ports.handoffReview instanceof HandoffReviewAdapter);
});

test('workspace adapter maps a failed preflight and an unresolved worktree to falsy verdicts', async () => {
  const ports = createExecuteMissionPorts('/repo', { missionTransitionStore: transitionStore }, runtimeStub({
    preflight() { return { pass: false }; },
    resolveWorktree() { return undefined; },
  }));
  assert.equal(await ports.workspace.preflight('task-1'), false);
  assert.equal(await ports.workspace.resolveWorktree('task-1'), null);
});

test('agent execution adapter overlays the operator blocklist onto the file agent config', async () => {
  const blocklist = { codex: { until: '2026-08-01T00:00:00Z' } };
  const ports = createExecuteMissionPorts(
    '/repo',
    { missionTransitionStore: transitionStore, operatorBlocklist: blocklist },
    runtimeStub({
      async selectLaunchAndRecord(opts: { agentConfig: Record<string, unknown> }) {
        return { agent: 'codex', result: { status: 0, agentConfig: opts.agentConfig }, rebaseDeferred: false };
      },
    }),
  );
  const plan = await ports.agentExecution.prepare({ slug: 'task-1', worktree: '/worktree' });
  assert.deepEqual(plan.agentConfig, { steps: ['active'], blocklist });
  assert.equal(plan.prompt, 'execute prompt');
});

test('agent execution adapter leaves the file agent config untouched without a blocklist overlay', async () => {
  const ports = createExecuteMissionPorts('/repo', { missionTransitionStore: transitionStore }, runtimeStub());
  const plan = await ports.agentExecution.prepare({ slug: 'task-1', worktree: '/worktree' });
  assert.deepEqual(plan.agentConfig, { steps: ['active'] });
});

test('agent execution adapter reports launcher errors and exit status as raw facts', async () => {
  const errored = createExecuteMissionPorts('/repo', { missionTransitionStore: transitionStore }, runtimeStub({
    async selectLaunchAndRecord() { return { agent: 'codex', result: { error: new Error('launcher exploded') }, rebaseDeferred: false }; },
  }));
  const failedLaunch = await errored.agentExecution.launch({
    slug: 'task-1', worktree: '/worktree', plan: { prompt: 'p', agentConfig: {} },
    taskResolution: { ok: true, taskFile: '/worktree/task.md' }, preselectedAgent: 'codex',
  });
  assert.equal(failedLaunch.errored, true);
  assert.equal(failedLaunch.errorMessage, 'launcher exploded');
  assert.equal(failedLaunch.exitStatus, null);

  const nonZero = createExecuteMissionPorts('/repo', { missionTransitionStore: transitionStore }, runtimeStub({
    async selectLaunchAndRecord() { return { agent: 'codex', result: { status: 7 }, rebaseDeferred: true }; },
  }));
  const statusLaunch = await nonZero.agentExecution.launch({
    slug: 'task-1', worktree: '/worktree', plan: { prompt: 'p', agentConfig: {} },
    taskResolution: { ok: true, taskFile: '/worktree/task.md' }, preselectedAgent: 'codex',
  });
  assert.equal(statusLaunch.errored, false);
  assert.equal(statusLaunch.errorMessage, null);
  assert.equal(statusLaunch.exitStatus, 7);
  assert.equal(statusLaunch.rebaseDeferred, true);
});

test('telemetry adapter derives the stage window and duration from the launch detail', async () => {
  const recorded: Array<Record<string, unknown>> = [];
  const windows: Array<Record<string, unknown>> = [];
  const ports = createExecuteMissionPorts('/repo', { missionTransitionStore: transitionStore }, runtimeStub({
    recordActiveStats(record: Record<string, unknown>) { recorded.push(record); },
    resolveStageTelemetry(options: Record<string, unknown>) { windows.push(options); return null; },
  }));
  await ports.telemetry.recordLaunchTelemetry({
    slug: 'task-1',
    worktree: '/worktree',
    agent: 'codex',
    launch: {
      agent: 'codex', rebaseDeferred: false, errored: false, errorMessage: null, exitStatus: 0,
      detail: { startedAt: '2026-07-20T10:00:00Z', endedAt: '2026-07-20T10:03:00Z' },
    },
  });
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].implementer, 'codex');
  assert.equal(recorded[0].model, 'gpt-5');
  assert.equal(recorded[0].durationMinutes, 3);
  assert.equal(windows[0].sinceMs, Date.parse('2026-07-20T10:00:00Z'));
});

test('handoff review adapter forwards the resolved task file and returns the pipeline verdict', async () => {
  const seen: Array<unknown[]> = [];
  const ports = createExecuteMissionPorts('/repo', { missionTransitionStore: transitionStore }, runtimeStub({
    async runHandoffAndReview(...args: unknown[]) { seen.push(args); return false; },
  }));
  const verdict = await ports.handoffReview.runHandoffAndReview({
    slug: 'task-1', worktree: '/worktree', agent: 'codex', taskFile: '/worktree/task.md',
  });
  assert.equal(verdict, false);
  assert.deepEqual(seen[0], ['task-1', '/worktree', 'codex', { taskFile: '/worktree/task.md' }]);
});
