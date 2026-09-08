// @ts-nocheck -- TASK-2328: partial test doubles from ESM seam migration; resolve in follow-up
import test from 'node:test';
import assert from 'node:assert/strict';

// Characterization suite for the execute (`px active`) workflow.
//
// Every assertion below describes observable behavior of the workflow, not of
// a particular class. `buildExecuteWorkflow` is the ONLY construction-aware
// part of this file: TASK-2332.04 moves the sequencing from
// `LegacyActiveAdapter` into an application-owned `ExecuteMission` use case,
// and the contract of that move is that only this factory changes while every
// expectation below stays byte-identical.
import { ExecuteMissionService } from '../src/application/execute-mission-service.js';
import { createExecuteMissionPorts } from '../src/adapters/mission/execute-mission-adapters.js';
function buildExecuteWorkflow(
  runtime: Record<string, unknown>,
  missionTransitionStore: unknown,
  progress?: (_event: unknown) => void,
) {
  return new ExecuteMissionService(
    createExecuteMissionPorts('/repo', { missionTransitionStore }, runtime),
    progress,
  );
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function executeFixture(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const transitionStore = {
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
    async save(_mission: unknown, expectedVersion: number) { calls.push('synchronize'); return expectedVersion + 1; },
    async saveWithTransition(_mission: unknown, expectedVersion: number) { calls.push('synchronize'); return expectedVersion + 1; },
  };
  const runtime = {
    preflight() { calls.push('preflight'); return { pass: true }; },
    resolveWorktree() { calls.push('worktree'); return '/worktree'; },
    resolveTaskFile() { calls.push('task'); return { ok: true, taskFile: '/worktree/backlog/tasks/task-1.md' }; },
    buildCheckpointContext() { calls.push('checkpoint'); return 'CP-5'; },
    readAgentConfig() { calls.push('config'); return {}; },
    buildExecutePrompt() { calls.push('prompt'); return 'execute prompt'; },
    async selectLaunchAndRecord(opts: { preselectedAgent?: string | null }) {
      calls.push(`launch-record:${opts.preselectedAgent ?? 'default'}`);
      return {
        agent: 'codex',
        result: { status: 0, startedAt: '2026-07-20T10:00:00Z', endedAt: '2026-07-20T10:01:00Z' },
        rebaseDeferred: true,
      };
    },
    enforceExecuteCommitSafety() { calls.push('safety'); },
    getTaskStatus() { calls.push('status'); return 'active'; },
    recordActiveStats(record: { implementer: string }) { calls.push(`stats:${record.implementer}`); },
    resolveAgentModel() { calls.push('model'); return 'gpt-5'; },
    resolveStageTelemetry() { calls.push('telemetry'); return null; },
    async runHandoffAndReview(slug: string, worktree: string, agent: string) {
      calls.push(`handoff:${slug}:${worktree}:${agent}`);
      return true;
    },
    ...overrides,
  };
  return { runtime, calls, transitionStore };
}

function executeRequest(overrides: Record<string, unknown> = {}) {
  return {
    operationId: 'active:task-1',
    slug: 'task-1',
    agent: 'codex',
    capabilities: new Set(['active:execute']),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Scenario 1 — `active` success
// ---------------------------------------------------------------------------

test('execute workflow: success runs preflight, prepare, launch, record, telemetry, handoff in order', async () => {
  const { runtime, calls, transitionStore } = executeFixture();
  const events: Array<{ sequence: number; phase: string; agent?: string }> = [];
  const outcome = await buildExecuteWorkflow(runtime, transitionStore, (event) =>
    events.push(event as { sequence: number; phase: string })).execute(executeRequest());

  assert.equal(outcome.status, 'completed');
  assert.deepEqual(outcome.value, { agent: 'codex' });
  assert.deepEqual(calls, [
    'preflight', 'worktree', 'task', 'checkpoint', 'config', 'prompt',
    'launch-record:codex', 'safety', 'status', 'load', 'synchronize',
    'model', 'telemetry', 'stats:codex',
    'handoff:task-1:/worktree:codex',
  ]);
  assert.equal(outcome.durableEvidence.length, 2);
  assert.deepEqual(events.map((event) => event.sequence), [1, 2, 3]);
  assert.deepEqual(events.map((event) => event.phase), ['launch', 'record', 'handoff']);
  assert.equal(events[2].agent, 'codex');
});

test('execute workflow: telemetry failure cannot fail a launch', async () => {
  const { runtime, calls, transitionStore } = executeFixture({
    recordActiveStats() { calls.push('stats'); throw new Error('stats writer unavailable'); },
  });
  const outcome = await buildExecuteWorkflow(runtime, transitionStore).execute(executeRequest());
  assert.equal(outcome.status, 'completed');
  assert.ok(calls.includes('stats'));
  assert.ok(calls.includes('handoff:task-1:/worktree:codex'));
});

test('execute workflow: a task already active without a deferred rebase skips lifecycle synchronization', async () => {
  const { runtime, calls, transitionStore } = executeFixture({
    async selectLaunchAndRecord() {
      calls.push('launch-record:codex');
      return { agent: 'codex', result: { status: 0 }, rebaseDeferred: false };
    },
  });
  const outcome = await buildExecuteWorkflow(runtime, transitionStore).execute(executeRequest());
  assert.equal(outcome.status, 'completed');
  assert.equal(calls.includes('load'), false);
  assert.equal(calls.includes('synchronize'), false);
});

test('execute workflow: lifecycle synchronization fails closed when the Mission authority refuses activation', async () => {
  const { runtime, calls } = executeFixture();
  const missingStore = {
    async load() { calls.push('load'); return { kind: 'missing' }; },
    async save() { calls.push('synchronize'); return 1; },
    async saveWithTransition() { calls.push('synchronize'); return 1; },
  };
  const outcome = await buildExecuteWorkflow(runtime, missingStore).execute(executeRequest());
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.error.kind, 'execution');
  assert.equal(outcome.error.message, 'legacy task lifecycle synchronization failed');
  assert.equal(calls.includes('synchronize'), false);
  assert.equal(calls.some((call) => call.startsWith('handoff:')), false);
});

// ---------------------------------------------------------------------------
// Scenario 2 — agent fallback / relaunch retry
// ---------------------------------------------------------------------------

test('execute workflow: an agent fallback is reported, recorded, and handed off as the agent that actually ran', async () => {
  const { runtime, calls, transitionStore } = executeFixture({
    async selectLaunchAndRecord(opts: { preselectedAgent?: string | null }) {
      calls.push(`launch-record:${opts.preselectedAgent ?? 'default'}`);
      return { agent: 'claude', result: { status: 0 }, rebaseDeferred: true };
    },
  });
  const outcome = await buildExecuteWorkflow(runtime, transitionStore).execute(executeRequest());
  assert.equal(outcome.status, 'completed');
  assert.deepEqual(outcome.value, { agent: 'claude' });
  assert.ok(calls.includes('stats:claude'));
  assert.ok(calls.includes('handoff:task-1:/worktree:claude'));
});

test('execute workflow: a handoff relaunch retry that recovers still completes the launch', async () => {
  let handoffAttempts = 0;
  const { runtime, calls, transitionStore } = executeFixture({
    async runHandoffAndReview(slug: string, worktree: string, agent: string) {
      handoffAttempts++;
      calls.push(`handoff:${slug}:${worktree}:${agent}`);
      // The relaunch/retry loop lives inside the handoff mechanism; the
      // workflow observes only its final boolean verdict.
      return handoffAttempts >= 1;
    },
  });
  const outcome = await buildExecuteWorkflow(runtime, transitionStore).execute(executeRequest());
  assert.equal(outcome.status, 'completed');
  assert.equal(handoffAttempts, 1);
});

// ---------------------------------------------------------------------------
// Scenario 3 — handoff-and-review failure
// ---------------------------------------------------------------------------

test('execute workflow: handoff-and-review failure surfaces as an execution failure after durable evidence', async () => {
  const { runtime, calls, transitionStore } = executeFixture({
    async runHandoffAndReview() { calls.push('handoff'); return false; },
  });
  const outcome = await buildExecuteWorkflow(runtime, transitionStore).execute(executeRequest());
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.error.kind, 'execution');
  assert.equal(outcome.error.message, 'legacy handoff failed');
  assert.ok(calls.includes('safety'));
  assert.ok(calls.includes('stats:codex'));
});

// ---------------------------------------------------------------------------
// Scenario 4 — non-zero agent exit status / launcher error
// ---------------------------------------------------------------------------

test('execute workflow: a non-zero agent exit status stops before safety, telemetry, and handoff', async () => {
  const { runtime, calls, transitionStore } = executeFixture({
    async selectLaunchAndRecord() {
      calls.push('launch-record:codex');
      return { agent: 'codex', result: { status: 23 }, rebaseDeferred: false };
    },
  });
  const outcome = await buildExecuteWorkflow(runtime, transitionStore).execute(executeRequest());
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.error.kind, 'execution');
  assert.equal(outcome.error.message, 'Execute agent (codex) exited with status 23.');
  assert.deepEqual(calls, [
    'preflight', 'worktree', 'task', 'checkpoint', 'config', 'prompt', 'launch-record:codex',
  ]);
});

test('execute workflow: a launcher error reports the agent family and the launcher message', async () => {
  const { runtime, calls, transitionStore } = executeFixture({
    async selectLaunchAndRecord() {
      calls.push('launch-record:codex');
      return { agent: 'codex', result: { error: new Error('launcher exploded') }, rebaseDeferred: false };
    },
  });
  const outcome = await buildExecuteWorkflow(runtime, transitionStore).execute(executeRequest());
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.error.message, 'Could not start execute agent (codex): launcher exploded');
  assert.equal(calls.includes('safety'), false);
});

// ---------------------------------------------------------------------------
// Scenario 5 — cancellation before launch
// ---------------------------------------------------------------------------

test('execute workflow: cancellation before launch touches no mechanism port', async () => {
  const { runtime, calls, transitionStore } = executeFixture();
  const outcome = await buildExecuteWorkflow(runtime, transitionStore)
    .execute(executeRequest({ cancellation: { requested: true } }));
  assert.equal(outcome.status, 'cancelled');
  assert.equal(outcome.error.message, 'cancelled before launch');
  assert.deepEqual(calls, []);
});

// ---------------------------------------------------------------------------
// Scenario 6 — cancellation after durable launch
// ---------------------------------------------------------------------------

test('execute workflow: cancellation after durable launch keeps both evidence records and skips handoff', async () => {
  const cancellation = { requested: false };
  const { runtime, calls, transitionStore } = executeFixture({
    recordActiveStats(record: { implementer: string }) {
      calls.push(`stats:${record.implementer}`);
      cancellation.requested = true;
    },
  });
  const outcome = await buildExecuteWorkflow(runtime, transitionStore)
    .execute(executeRequest({ cancellation }));
  assert.equal(outcome.status, 'cancelled');
  assert.equal(outcome.error.message, 'cancelled after durable launch; re-query task state');
  assert.equal(outcome.durableEvidence.length, 2);
  assert.equal(calls.some((call) => call.startsWith('handoff:')), false);
});

// ---------------------------------------------------------------------------
// Scenario 7 — preflight failure
// ---------------------------------------------------------------------------

test('execute workflow: preflight failure rejects with "execute preflight failed" before worktree resolution', async () => {
  const { runtime, calls, transitionStore } = executeFixture({
    preflight() { calls.push('preflight'); return { pass: false }; },
  });
  const outcome = await buildExecuteWorkflow(runtime, transitionStore).execute(executeRequest());
  assert.equal(outcome.status, 'rejected');
  assert.equal(outcome.error.kind, 'validation');
  assert.equal(outcome.error.message, 'execute preflight failed');
  assert.deepEqual(calls, ['preflight']);
});

// ---------------------------------------------------------------------------
// Scenario 8 — missing dedicated worktree
// ---------------------------------------------------------------------------

test('execute workflow: a missing dedicated worktree rejects with "dedicated execute worktree is required"', async () => {
  const { runtime, calls, transitionStore } = executeFixture({
    resolveWorktree() { calls.push('worktree'); return null; },
  });
  const outcome = await buildExecuteWorkflow(runtime, transitionStore).execute(executeRequest());
  assert.equal(outcome.status, 'rejected');
  assert.equal(outcome.error.kind, 'validation');
  assert.equal(outcome.error.message, 'dedicated execute worktree is required');
  assert.deepEqual(calls, ['preflight', 'worktree']);
});

// ---------------------------------------------------------------------------
// Request guards
// ---------------------------------------------------------------------------

test('execute workflow: an unrecognized slug is rejected before preflight', async () => {
  const { runtime, calls, transitionStore } = executeFixture();
  const outcome = await buildExecuteWorkflow(runtime, transitionStore)
    .execute(executeRequest({ slug: 'mission-1' }));
  assert.equal(outcome.status, 'rejected');
  assert.equal(outcome.error.message, 'slug is not a recognized mission identity');
  assert.deepEqual(calls, []);
});

test('execute workflow: a DB-owned adhoc identity is accepted, not refused by a task- prefix assumption', async () => {
  const { runtime, calls, transitionStore } = executeFixture();
  const outcome = await buildExecuteWorkflow(runtime, transitionStore)
    .execute(executeRequest({ slug: 'parallix-adhoc-0001' }));
  assert.equal(outcome.status, 'completed');
  assert.ok(calls.includes('preflight'), 'adhoc identity must reach preflight via the shared validator');
});

test('execute workflow: a request without active:execute is rejected before any mechanism port', async () => {
  const { runtime, calls, transitionStore } = executeFixture();
  const outcome = await buildExecuteWorkflow(runtime, transitionStore)
    .execute(executeRequest({ capabilities: new Set() }));
  assert.equal(outcome.status, 'rejected');
  assert.equal(outcome.error.kind, 'capability');
  assert.deepEqual(calls, []);
});

test('execute workflow: a request without an operationId or slug is rejected as invalid', async () => {
  const { runtime, calls, transitionStore } = executeFixture();
  const outcome = await buildExecuteWorkflow(runtime, transitionStore)
    .execute(executeRequest({ operationId: '' }));
  assert.equal(outcome.status, 'rejected');
  assert.equal(outcome.error.kind, 'validation');
  assert.deepEqual(calls, []);
});

// ---------------------------------------------------------------------------
// Workflow state is carried explicitly, not held per slug inside a port
// ---------------------------------------------------------------------------

test('execute workflow: two concurrent slugs each resolve their own worktree and handoff', async () => {
  const first = executeFixture();
  const second = executeFixture({
    resolveWorktree() { second.calls.push('worktree'); return '/other-worktree'; },
  });
  const [outcomeA, outcomeB] = await Promise.all([
    buildExecuteWorkflow(first.runtime, first.transitionStore).execute(executeRequest()),
    buildExecuteWorkflow(second.runtime, second.transitionStore).execute(executeRequest({ slug: 'task-2' })),
  ]);
  assert.equal(outcomeA.status, 'completed');
  assert.equal(outcomeB.status, 'completed');
  assert.ok(first.calls.includes('handoff:task-1:/worktree:codex'));
  assert.ok(second.calls.includes('handoff:task-2:/other-worktree:codex'));
});
