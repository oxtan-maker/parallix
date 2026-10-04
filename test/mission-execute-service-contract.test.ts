// Mission execute service contract: ExecuteMission use case ordering and rollback against in-memory
// mechanism ports.
//
// Behavior-owned suite (TASK-2622.07). Legacy case names are unchanged (was test/execute-mission-service.test.ts).
import test from 'node:test';
import assert from 'node:assert/strict';

import { ExecuteMissionService } from '../src/application/execute-mission-service.js';
import type { ExecuteMissionPorts } from '../src/application/ports/execute-mission.js';

// Unit coverage for the ExecuteMission use case against in-memory mechanism
// ports. This is the port-level counterpart of
// test/mission-execute-adapter-contract.test.ts (Execute Mission characterization section), which drives the same workflow
// through the real adapters.

function strictPorts(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  let mission = {
    id: 'task-1', repositoryId: 'repo', title: 'Fixture', labels: [],
    assignee: null, checkpoints: [{ missionId: 'task-1', name: 'CP-1', firstLine: 'Do the work', goalCheck: [], nextActionText: '' }], review: null, netEngineeringLines: null,
    brief: { goal: 'Fixture goal', why: 'Fixture why', scope: 'Fixture scope', outOfScope: [] },
    declaredGates: ['npm test'], successCriteria: ['The mission is done'], predictedNelBucket: 'Small',
    status: 'refined' as const, closedAt: null,
  };
  const parts = {
    workspace: {
      async preflight(slug: string) { calls.push(`preflight:${slug}`); return true; },
      async resolveWorktree(slug: string) { calls.push(`worktree:${slug}`); return '/worktree'; },
      async resolveTaskFile(slug: string) { calls.push(`task:${slug}`); return { ok: true, taskFile: '/worktree/task.md' }; },
      async readTaskStatus() { calls.push('status'); return 'active'; },
      async enforceCommitSafety() { calls.push('safety'); },
    },
    agentExecution: {
      async prepare() { calls.push('prepare'); return { prompt: 'execute prompt', agent: 'codex', agentConfig: {} }; },
      async launch(request: { preselectedAgent: string | null }) {
        calls.push(`launch:${request.preselectedAgent ?? 'default'}`);
        return { agent: 'codex', rebaseDeferred: true, errored: false, errorMessage: null, exitStatus: 0, detail: { startedAt: 'now' } };
      },
    },
    missionTransitions: {
      async load() {
        calls.push('load');
        return { kind: 'found', version: 3, mission };
      },
      async save(next: typeof mission, expectedVersion: number) { mission = next; calls.push('synchronize'); return expectedVersion + 1; },
      async saveWithTransition(next: typeof mission, expectedVersion: number) { mission = next; calls.push('synchronize'); return expectedVersion + 1; },
    },
    telemetry: {
      async recordLaunchTelemetry(record: { agent: string }) { calls.push(`telemetry:${record.agent}`); },
    },
    checkpointValidation: {
      async validateBeforeHandoff() { calls.push('checkpoints'); return { ok: true }; },
    },
    handoffExecution: {
      async run(request: { agent: string }) { calls.push(`handoff:${request.agent}`); return { ok: true }; },
      async repairHygiene() { return { repaired: false }; },
      classifyFailure() { return null; },
    },
    autonomousReview: { async start() {} },
    repairLaunch: {
      async launch() {}, available() { return { supported: false }; }, readHead() { return null; },
    },
    output: {
      log() {}, error() {}, command(command: string) { return command; }, formatSlug(slug: string) { return slug; }, formatAgent(agent: string) { return agent; },
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

test('execute mission use case activates before launch, then records telemetry and handoff', async () => {
  const { ports, calls } = strictPorts();
  const events: Array<{ sequence: number; phase: string }> = [];
  const work: Array<{ phase: string; agent: string | null }> = [];
  const currentWork = {
    async running(publication: { phase: string; agent?: string | null }) { work.push({ phase: publication.phase, agent: publication.agent ?? null }); },
    async ended() {},
    async blocked() {},
  };
  const outcome = await new ExecuteMissionService(ports, (event) => events.push(event), currentWork)
    .execute(request());
  assert.equal(outcome.status, 'completed');
  assert.deepEqual(calls, [
    'preflight:task-1', 'worktree:task-1', 'task:task-1', 'prepare', 'load', 'synchronize',
    'launch:codex', 'safety', 'telemetry:codex', 'checkpoints', 'handoff:codex',
  ]);
  assert.deepEqual(events.map((event) => event.sequence), [1, 2, 3]);
  assert.deepEqual(work.filter((entry) => entry.phase === 'handoff'), [
    { phase: 'handoff', agent: null },
  ]);
  assert.equal(outcome.durableEvidence.length, 2);
});

test('execute mission use case sequences typed checkpoint, handoff, and review ports instead of the legacy delegation', async () => {
  const { ports, calls } = strictPorts({
    checkpointValidation: {
      async validateBeforeHandoff() { calls.push('checkpoints'); return { ok: true }; },
    },
    handoffExecution: {
      async run() { calls.push('typed-handoff'); return { ok: true }; },
      async repairHygiene() { throw new Error('unexpected hygiene repair'); },
      classifyFailure() { return null; },
      isRelaunchableFailure() { return false; },
    },
    autonomousReview: {
      async start() { calls.push('review'); },
    },
    repairLaunch: {
      async launch() { throw new Error('unexpected repair launch'); },
      available() { return { supported: false }; },
      readHead() { return null; },
    },
    output: {
      log(message: string) { calls.push(`output:${message.startsWith('\nStarting autonomous') ? 'review' : 'other'}`); },
      error() {}, command(command: string) { return command; }, formatSlug(slug: string) { return slug; }, formatAgent(agent: string) { return agent; },
    },
  });
  const outcome = await new ExecuteMissionService(ports).execute(request());
  assert.equal(outcome.status, 'completed');
  assert.ok(calls.indexOf('checkpoints') < calls.indexOf('typed-handoff'));
  assert.ok(calls.indexOf('typed-handoff') < calls.indexOf('review'));
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
    handoffExecution: {
      async run() { return { ok: false }; },
      async repairHygiene() { return { repaired: false }; },
      classifyFailure() { return null; },
      isRelaunchableFailure() { return false; },
    },
  });
  const outcome = await new ExecuteMissionService(ports).execute(request());
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.error?.kind, 'execution');
  assert.equal(outcome.error?.message, 'handoff and review failed');
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

test('execute mission use case blocks work and preserves the launch error when activation compensation fails', async () => {
  const { ports } = strictPorts({
    agentExecution: {
      async prepare() { return { prompt: 'p', agent: 'codex', agentConfig: {} }; },
      async launch() { throw new Error('launcher exploded'); },
    },
  });
  const transitions = ports.missionTransitions as { saveWithTransition: (...args: unknown[]) => Promise<number> };
  const save = transitions.saveWithTransition.bind(transitions);
  let writes = 0;
  transitions.saveWithTransition = async (...args) => {
    writes += 1;
    if (writes === 2) { throw new Error('compensation store unavailable'); }
    return save(...args);
  };
  const blocked: string[] = [];
  const outcome = await new ExecuteMissionService(ports, undefined, {
    async running() {}, async ended() {}, async blocked(_publication, reason) { blocked.push(reason); },
  }).execute(request());
  assert.equal(outcome.status, 'failed');
  assert.match(outcome.error?.message ?? '', /launcher exploded/);
  assert.match(outcome.error?.message ?? '', /Could not undo failed activation/);
  assert.equal(blocked.length, 1);
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
  assert.match(outcome.error?.message ?? '', /^legacy task lifecycle synchronization failed: /);
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
