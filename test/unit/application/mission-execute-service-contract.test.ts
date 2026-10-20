import { makeExecutePorts } from '../../fixtures/execute-mission-ports.js';
import { fixtureMission } from '../../fixtures/mission-builders.js';
import { missionVersion } from '../../../src/application/domain-ports.js';
// Mission execute service contract: ExecuteMission use case ordering and rollback against in-memory
// mechanism ports.
//
// Behavior-owned suite (TASK-2622.07). Legacy case names are unchanged (was test/execute-mission-service.test.ts).
import test from 'node:test';
import assert from 'node:assert/strict';

import { ExecuteMissionService } from '../../../src/application/execute-mission-service.js';
import type { ExecuteMissionPorts } from '../../../src/application/ports/execute-mission.js';

// Unit coverage for the ExecuteMission use case against in-memory mechanism
// ports. This is the port-level counterpart of
// test/unit/adapters/mission/mission-execute-adapter-contract.test.ts (Execute Mission characterization section), which drives the same workflow
// through the real adapters.

function strictPorts(overrides: Parameters<typeof makeExecutePorts>[0] = {}) {
  const calls: string[] = [];
  let mission = fixtureMission('task-1', { title: 'Fixture', status: 'refined', brief: { goal: 'Fixture goal', why: 'Fixture why', scope: 'Fixture scope', outOfScope: [] }, declaredGates: ['npm test'], successCriteria: ['The mission is done'], predictedNelBucket: 'Small' });
  const parts = makeExecutePorts({
    workspace: {
      async preflight(slug: string) { calls.push(`preflight:${slug}`); return true; },
      async resolveWorktree(slug: string) { calls.push(`worktree:${slug}`); return '/worktree'; },
      async resolveTaskFile(slug: string) { calls.push(`task:${slug}`); return { ok: true as const, taskFile: '/worktree/task.md' }; },
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
        return { kind: 'found' as const, version: missionVersion(3), mission };
      },
      async save(next, expectedVersion) { assert.ok(expectedVersion); mission = next; calls.push('synchronize'); return missionVersion(expectedVersion + 1); },
      async saveWithTransition(next, expectedVersion) { assert.ok(expectedVersion); mission = next; calls.push('synchronize'); return missionVersion(expectedVersion + 1); },
    },
    telemetry: {
      async recordLaunchTelemetry(record: { agent: string }) { calls.push(`telemetry:${record.agent}`); },
    },
    checkpointValidation: {
      async validateBeforeHandoff() { calls.push('checkpoints'); return { ok: true as const }; },
    },
    handoffExecution: {
      async run(request: { agent: string }) { calls.push(`handoff:${request.agent}`); return { ok: true as const }; },
      async repairHygiene() { return { repaired: false }; },
      classifyFailure() { return null; },
    },
    autonomousReview: { async start() {} },
    repairLaunch: {
      async launch() { return undefined; }, available() { return { supported: false }; }, readHead() { return null; },
    },
    output: {
      log() {}, error() {}, command(command: string) { return command; }, formatSlug(slug: string) { return slug; }, formatAgent(agent: string) { return agent; },
    },
  }).ports;
  const ports = makeExecutePorts({ ...parts, ...overrides }).ports;
  return { ports, calls };
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    operationId: 'active:task-1',
    slug: 'task-1',
    agent: 'codex',
    capabilities: new Set(['active:execute'] as const),
    ...overrides,
  };
}

test('activation and preparing work precede held preflight (TASK-2750)', async () => {
  let release!: () => void;
  let entered!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const boundary = new Promise<void>(resolve => { entered = resolve; });
  const { ports, calls } = strictPorts();
  ports.workspace.preflight = async () => { calls.push('held-preflight'); entered(); await held; return true; };
  const work: string[] = [];
  const run = new ExecuteMissionService(ports, undefined, {
    async running(publication) { work.push(publication.summary); },
    async ended() {}, async blocked() {},
  }).execute(request());
  try {
    await boundary;
    assert.ok(calls.includes('synchronize'), 'authoritative activation must commit before preflight');
    assert.ok(work.some(summary => summary.includes('preparing')), 'preparing work must be published before preflight');
    assert.equal(calls.includes('prepare'), false, 'complete prompt preparation must remain behind the barrier');
  } finally {
    release();
    await run;
  }
});

test('execute mission use case activates before launch, then records telemetry and handoff', async () => {
  const { ports, calls } = strictPorts();
  const events: Array<{ sequence: number; phase: string }> = [];
  const work: Array<{ phase: string; agent: string | null }> = [];
  const currentWork = {
    async running(publication: { phase: string; agent?: string | null }) { work.push({ phase: publication.phase, agent: publication.agent ?? null }); },
    async ended() {},
    async blocked() {},
  } satisfies NonNullable<ConstructorParameters<typeof ExecuteMissionService>[2]>;
  const outcome = await new ExecuteMissionService(ports, (event) => events.push(event), currentWork)
    .execute(request());
  assert.equal(outcome.status, 'completed');
  assert.deepEqual(calls, [
    'load', 'load', 'synchronize', 'preflight:task-1', 'worktree:task-1', 'task:task-1', 'prepare',
    'launch:codex', 'load', 'safety', 'telemetry:codex', 'checkpoints', 'handoff:codex',
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
      async validateBeforeHandoff() { calls.push('checkpoints'); return { ok: true as const }; },
    },
    handoffExecution: {
      async run() { calls.push('typed-handoff'); return { ok: true as const }; },
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

test('execute mission use case hands the explicit reviewer to review and to every handoff attempt (TASK-2723)', async () => {
  const handoffs: Array<{ reviewer?: string; force?: boolean }> = [];
  const reviews: Array<{ implementer: string; reviewer?: string }> = [];
  const { ports } = strictPorts({
    handoffExecution: {
      async run(handoff: { reviewer?: string; force?: boolean }) {
        handoffs.push({ reviewer: handoff.reviewer, force: handoff.force });
        return handoffs.length === 1 ? { ok: false, error: 'dirty worktree' } : { ok: true };
      },
      async repairHygiene() { return { repaired: true }; },
      classifyFailure() { return null; },
      isRelaunchableFailure() { return false; },
    },
    autonomousReview: { async start(review: { implementer: string; reviewer?: string }) { reviews.push(review); } },
  });
  const outcome = await new ExecuteMissionService(ports).execute(request({ reviewer: 'claude' }));
  assert.equal(outcome.status, 'completed');
  assert.deepEqual(handoffs, [{ reviewer: 'claude', force: undefined }, { reviewer: 'claude', force: true }]);
  assert.deepEqual(reviews.map(({ implementer, reviewer }) => ({ implementer, reviewer })), [{ implementer: 'codex', reviewer: 'claude' }]);
});

test('execute mission use case leaves the reviewer unset when none was requested (TASK-2723)', async () => {
  const reviews: Array<{ reviewer?: string }> = [];
  const { ports } = strictPorts({ autonomousReview: { async start(review: { reviewer?: string }) { reviews.push(review); } } });
  const outcome = await new ExecuteMissionService(ports).execute(request());
  assert.equal(outcome.status, 'completed');
  assert.deepEqual(reviews.map(review => review.reviewer), [undefined]);
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
      async run() { return { ok: false as const }; },
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
      async load() { calls.push('load'); return { kind: 'missing' as const }; },
      async save() { calls.push('synchronize'); return missionVersion(1); },
      async saveWithTransition() { calls.push('synchronize'); return missionVersion(1); },
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
      async resolveTaskFile() { return { ok: true as const, taskFile: '/task.md' }; },
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

import { ExecuteHandoffService } from '../../../src/application/execute-handoff-service.js';
import { validateCheckpointsBeforeHandoff } from '../../../src/adapters/mission/checkpoint-validation.js';

for (const callback of [true, false]) {
  test(`checkpoint repair fallback retains actual identity through handoff/review, callback=${callback} (TASK-2778 F1)`, async () => {
    const { ports } = strictPorts();
    let checks = 0;
    let actual = 'codex';
    const service = new ExecuteHandoffService({
      checkpoints: { validateBeforeHandoff: async () => ++checks === 1
        ? { ok: false, error: 'Planned checkpoint evidence is missing before handoff: CP-2.', nextCheckpoint: 'CP-2' }
        : { ok: actual === 'custom', error: 'actual repair identity was not recorded' } },
      repairLaunch: { ...ports.repairLaunch, launch: async request => {
        if (callback) { await request.onAgentChanged?.('custom'); assert.equal(actual, 'custom'); }
        return { agent: 'custom', result: { status: 0 } };
      } },
      handoff: { ...ports.handoffExecution, run: async request => { assert.equal(request.agent, 'custom'); return { ok: true }; } },
      review: { start: async request => { assert.equal(request.implementer, 'custom'); } },
      output: ports.output,
    });
    assert.equal(await service.run({ slug: 'task-1', worktree: '/worktree', agent: 'codex', taskFile: null,
      onImplementerLaunched: async agent => { actual = agent; },
    }), true);
    assert.equal(actual, 'custom');
  });
}

test('recorded contract blocker stops checkpoint repair despite missing CP-5 and CP-6 (TASK-2713)', async () => {
  const blocker = { command: 'npm test', diagnostic: 'requires operator decision', authorityReason: 'locked contract', proposedCorrection: 'operator choice' };
  const verdict = await validateCheckpointsBeforeHandoff('task-1', '/worktree', { loadRecordedCheckpointsFn: async () => ({
    planned: ['CP-1', 'CP-5', 'CP-6'], recorded: ['CP-1'], humanOnlyContractBlocker: blocker,
  }) });
  assert.deepEqual(verdict.humanOnlyContractBlocker, blocker);
  assert.match(verdict.error ?? '', /Invalid locked contract requires human review/);
  let launches = 0;
  let handoffs = 0;
  let hygiene = 0;
  const stops: string[] = [];
  const { ports } = strictPorts();
  const service = new ExecuteHandoffService({ checkpoints: { validateBeforeHandoff: async () => verdict },
    handoff: { ...ports.handoffExecution, run: async () => { handoffs++; return { ok: true }; }, repairHygiene: async () => { hygiene++; return { repaired: false }; } },
    review: ports.autonomousReview, repairLaunch: { ...ports.repairLaunch, launch: async () => { launches++; return undefined; } }, output: ports.output });
  for (let attempt = 0; attempt < 2; attempt++) {
    assert.equal(await service.run({ slug: 'task-1', worktree: '/worktree', agent: 'codex', taskFile: null,
      onAutonomousStop: async reason => { stops.push(reason); } }), false);
  }
  assert.equal(launches, 0);
  assert.equal(handoffs, 0);
  assert.equal(hygiene, 0);
  assert.equal(stops.length, 2);
});

test('handoff typed contract blocker stops hygiene and evidence repair after validation (TASK-2713)', async () => {
  const { ports } = strictPorts();
  let repairs = 0;
  const service = new ExecuteHandoffService({ checkpoints: ports.checkpointValidation,
    handoff: { ...ports.handoffExecution, run: async () => ({ ok: false, reason: 'human-only-contract-blocker', error: 'Invalid locked contract requires human review' }),
      repairHygiene: async () => { repairs++; return { repaired: true }; } },
    review: ports.autonomousReview, repairLaunch: { ...ports.repairLaunch, launch: async () => { repairs++; return undefined; } }, output: ports.output });
  assert.equal(await service.run({ slug: 'task-1', worktree: '/worktree', agent: 'codex', taskFile: null }), false);
  assert.equal(repairs, 0);
});

test('a contract blocker discovered during handoff retry stops further evidence launches (TASK-2713)', async () => {
  const { ports } = strictPorts();
  let launches = 0;
  let handoffs = 0;
  const stops: string[] = [];
  const service = new ExecuteHandoffService({ checkpoints: ports.checkpointValidation,
    handoff: { ...ports.handoffExecution, run: async () => ++handoffs === 1
      ? { ok: false, error: 'Missing evidence; run `px checkpoint record`' }
      : { ok: false, reason: 'human-only-contract-blocker', error: 'Recorded contract requires operator decision' },
      classifyFailure: () => ({ failureClass: 'IncompleteEvidence', dispatchAction: 'AutoSendBack' }) },
    review: ports.autonomousReview, repairLaunch: { ...ports.repairLaunch, launch: async () => { launches++; return { result: { status: 0 } } as never; } }, output: ports.output });
  assert.equal(await service.run({ slug: 'task-1', worktree: '/worktree', agent: 'codex', taskFile: null, onAutonomousStop: async reason => { stops.push(reason); } }), false);
  assert.deepEqual(stops, ['Recorded contract requires operator decision']);
  assert.equal(launches, 1);
  assert.equal(handoffs, 2);
});

test('execute handoff preserves gate-to-conflict cause and actual early stop count (TASK-2778)', async () => {
  const { ports } = strictPorts();
  const errors: string[] = [];
  const prompts: string[] = [];
  let calls = 0;
  const service = new ExecuteHandoffService({ checkpoints: ports.checkpointValidation,
    handoff: { ...ports.handoffExecution,
      run: async () => {
        calls++;
        if (calls === 1) { return { ok: false, error: 'gate failed', gateFailure: {
          kind: 'gate-failure', area: 'unit', command: 'npm test', exitCode: 1, stdout: 'original assertion', stderr: '' } }; }
        if (calls === 2) { return { ok: false, error: 'shared conflict', recoveryFailure: {
          kind: 'rebase-conflict', files: ['shared.ts'], diagnostic: 'shared conflict after repaired gate' } }; }
        return { ok: false, recoveryFailure: { kind: 'handoff-verification', error: 'connection refused' }, error: 'connection refused' };
      }, classifyFailure: () => ({ failureClass: 'GateFailure', dispatchAction: 'AutoSendBack' }),
      repairHygiene: async () => assert.fail('structured conflicts use semantic resolver') },
    review: ports.autonomousReview,
    repairLaunch: { ...ports.repairLaunch, launch: async request => {
      prompts.push(request.prompt); return { agent: 'codex', result: { status: 0 } };
    } }, output: { ...ports.output, error: text => { errors.push(text); } },
  });
  assert.equal(await service.run({ slug: 'task-1', worktree: '', agent: 'codex', taskFile: null }), false);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /REBASE CONFLICT/);
  assert.match(errors.join('\n'), /Recovery stopped after 2 relaunch attempt/);
  assert.match(errors.join('\n'), /Last diagnostic: connection refused/);
  assert.doesNotMatch(errors.join('\n'), /Gate failure persisting/);
});
