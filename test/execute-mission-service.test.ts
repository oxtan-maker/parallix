import test from 'node:test';
import assert from 'node:assert/strict';

import { ExecuteMissionService } from '../src/application/execute-mission-service.js';
import type { ExecuteMissionPorts } from '../src/application/ports/execute-mission.js';

// Unit coverage for the ExecuteMission use case against in-memory mechanism
// ports. This is the port-level counterpart of
// test/execute-mission-characterization.test.ts, which drives the same workflow
// through the real adapters.

function strictPorts(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const parts = {
    workspace: {
      async preflight(slug: string) { calls.push(`preflight:${slug}`); return true; },
      async resolveWorktree(slug: string) { calls.push(`worktree:${slug}`); return '/worktree'; },
      async resolveTaskFile(slug: string) { calls.push(`task:${slug}`); return { ok: true, taskFile: '/worktree/task.md' }; },
      async readTaskStatus() { calls.push('status'); return 'active'; },
      async enforceCommitSafety() { calls.push('safety'); },
    },
    agentExecution: {
      async prepare() { calls.push('prepare'); return { prompt: 'execute prompt', agentConfig: {} }; },
      async launch(request: { preselectedAgent: string | null }) {
        calls.push(`launch:${request.preselectedAgent ?? 'default'}`);
        return { agent: 'codex', rebaseDeferred: true, errored: false, errorMessage: null, exitStatus: 0, detail: { startedAt: 'now' } };
      },
    },
    missionTransitions: {
      async load() {
        calls.push('load');
        return {
          kind: 'found', version: 3,
          mission: {
            id: 'task-1', repositoryId: 'repo', title: 'Fixture', labels: [],
            assignee: null, checkpoints: [], review: null, netEngineeringLines: null,
            status: 'refined', closedAt: null,
          },
        };
      },
      async save(_mission: unknown, expectedVersion: number) { calls.push('synchronize'); return expectedVersion + 1; },
      async saveWithTransition(_mission: unknown, expectedVersion: number) { calls.push('synchronize'); return expectedVersion + 1; },
    },
    telemetry: {
      async recordLaunchTelemetry(record: { agent: string }) { calls.push(`telemetry:${record.agent}`); },
    },
    handoffReview: {
      async runHandoffAndReview(request: { agent: string }) { calls.push(`handoff:${request.agent}`); return true; },
    },
  };
  const ports = { ...parts, ...overrides } as unknown as ExecuteMissionPorts;
  return { ports, calls };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    operationId: 'active:task-1',
    slug: 'task-1',
    agent: 'codex',
    capabilities: new Set(['active:execute'] as const),
    ...overrides,
  } as never;
}

test('execute mission use case sequences workspace, agent, lifecycle, telemetry, then handoff', async () => {
  const { ports, calls } = strictPorts();
  const events: Array<{ sequence: number; phase: string }> = [];
  const outcome = await new ExecuteMissionService(ports, (event) => events.push(event))
    .execute(request());
  assert.equal(outcome.status, 'completed');
  assert.deepEqual(calls, [
    'preflight:task-1', 'worktree:task-1', 'task:task-1', 'prepare', 'launch:codex',
    'safety', 'status', 'load', 'synchronize', 'telemetry:codex', 'handoff:codex',
  ]);
  assert.deepEqual(events.map((event) => event.sequence), [1, 2, 3]);
  assert.equal(outcome.durableEvidence.length, 2);
});

test('execute mission use case rejects invalid or incapable requests before any mechanism port', async () => {
  const incapable = strictPorts();
  const capabilityOutcome = await new ExecuteMissionService(incapable.ports)
    .execute(request({ capabilities: new Set() }));
  assert.equal(capabilityOutcome.status, 'rejected');
  assert.equal(capabilityOutcome.error?.kind, 'capability');
  assert.deepEqual(incapable.calls, []);

  const invalid = strictPorts();
  const validationOutcome = await new ExecuteMissionService(invalid.ports)
    .execute(request({ operationId: '' }));
  assert.equal(validationOutcome.error?.kind, 'validation');
  assert.deepEqual(invalid.calls, []);
});

test('execute mission use case cancels after the durable record without a rollback claim', async () => {
  const cancellation = { requested: false };
  const { ports, calls } = strictPorts({
    telemetry: {
      async recordLaunchTelemetry(record: { agent: string }) {
        calls.push(`telemetry:${record.agent}`);
        cancellation.requested = true;
      },
    },
  });
  const outcome = await new ExecuteMissionService(ports).execute(request({ cancellation }));
  assert.equal(outcome.status, 'cancelled');
  assert.equal(outcome.error?.message, 'cancelled after durable launch; re-query task state');
  assert.equal(outcome.durableEvidence.length, 2);
  assert.equal(calls.some((call) => call.startsWith('handoff:')), false);
});

test('execute mission use case reports a refused handoff as an execution failure', async () => {
  const { ports } = strictPorts({
    handoffReview: { async runHandoffAndReview() { return false; } },
  });
  const outcome = await new ExecuteMissionService(ports).execute(request());
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.error?.kind, 'execution');
  assert.equal(outcome.error?.message, 'legacy handoff failed');
});

test('execute mission use case keeps telemetry failures non-fatal', async () => {
  const { ports, calls } = strictPorts({
    telemetry: {
      async recordLaunchTelemetry() { calls.push('telemetry'); throw new Error('stats writer unavailable'); },
    },
  });
  const outcome = await new ExecuteMissionService(ports).execute(request());
  assert.equal(outcome.status, 'completed');
  assert.ok(calls.includes('telemetry'));
  assert.ok(calls.includes('handoff:codex'));
});

test('execute mission use case owns the launcher-error and exit-status operator messages', async () => {
  const failed = strictPorts({
    agentExecution: {
      async prepare() { return { prompt: 'p', agentConfig: {} }; },
      async launch() { return { agent: 'codex', rebaseDeferred: false, errored: true, errorMessage: 'launcher exploded', exitStatus: null, detail: null }; },
    },
  });
  const errorOutcome = await new ExecuteMissionService(failed.ports).execute(request());
  assert.equal(errorOutcome.error?.message, 'Could not start execute agent (codex): launcher exploded');
  assert.equal(failed.calls.includes('safety'), false);

  const nonZero = strictPorts({
    agentExecution: {
      async prepare() { return { prompt: 'p', agentConfig: {} }; },
      async launch() { return { agent: 'codex', rebaseDeferred: false, errored: false, errorMessage: null, exitStatus: 23, detail: null }; },
    },
  });
  const statusOutcome = await new ExecuteMissionService(nonZero.ports).execute(request());
  assert.equal(statusOutcome.error?.message, 'Execute agent (codex) exited with status 23.');
});

test('execute mission use case stops the run on a launcher error whose message is empty', async () => {
  const failed = strictPorts({
    agentExecution: {
      async prepare() { return { prompt: 'p', agentConfig: {} }; },
      async launch() { return { agent: 'codex', rebaseDeferred: false, errored: true, errorMessage: '', exitStatus: null, detail: null }; },
    },
  });
  const outcome = await new ExecuteMissionService(failed.ports).execute(request());
  assert.equal(outcome.error?.message, 'Could not start execute agent (codex): ');
  assert.equal(failed.calls.includes('safety'), false);
});

test('execute mission use case fails closed when the checked Mission authority refuses activation', async () => {
  const { ports, calls } = strictPorts({
    missionTransitions: {
      async load() { calls.push('load'); return { kind: 'missing' }; },
      async save() { calls.push('synchronize'); return 1; },
      async saveWithTransition() { calls.push('synchronize'); return 1; },
    },
  });
  const outcome = await new ExecuteMissionService(ports).execute(request());
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.error?.message, 'legacy task lifecycle synchronization failed');
  assert.equal(calls.includes('synchronize'), false);
  assert.equal(calls.some((call) => call.startsWith('handoff:')), false);
});

test('execute mission use case carries run state per call instead of holding it per slug', async () => {
  const { ports, calls } = strictPorts({
    workspace: {
      async preflight() { return true; },
      async resolveWorktree(slug: string) { calls.push(`worktree:${slug}`); return `/worktrees/${slug}`; },
      async resolveTaskFile() { return { ok: true, taskFile: '/task.md' }; },
      async readTaskStatus() { return 'active'; },
      async enforceCommitSafety(input: { slug: string; worktree: string }) { calls.push(`safety:${input.slug}:${input.worktree}`); },
    },
  });
  const service = new ExecuteMissionService(ports);
  const [first, second] = await Promise.all([
    service.execute(request()),
    service.execute(request({ slug: 'task-2', operationId: 'active:task-2' })),
  ]);
  assert.equal(first.status, 'completed');
  assert.equal(second.status, 'completed');
  assert.ok(calls.includes('safety:task-1:/worktrees/task-1'));
  assert.ok(calls.includes('safety:task-2:/worktrees/task-2'));
});
