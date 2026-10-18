import { missionBrief } from '../../../src/domain/mission-brief.js';
import { missionLabels } from '../../../src/domain/mission.js';
// Admission/owner contract is new: execution-service tests own launch ordering,
// while this suite owns durable command identity, exclusion and recovery policy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkflowOperationService } from '../../../src/application/workflow-operation-service.js';
import type { WorkflowOperationStore, WorkflowProcessPort } from '../../../src/application/ports/workflow-operation.js';
import type { WorkflowOperation } from '../../../src/domain/workflow-operation.js';
import type { MissionTransitionStore } from '../../../src/application/domain-ports.js';
import { missionVersion } from '../../../src/application/domain-ports.js';
import type { BoardCommandRequest } from '../../../src/application/controller/board-command.js';
import { completed, failure } from '../../../src/application/contracts.js';
import { fixtureMission } from '../../fixtures/mission-builders.js';
import { repositoryId } from '../../../src/domain/repository.js';

function fixture(draftInput = false, wait?: { now(): number; timeoutMs: number }, preparation: {
  select?: ConstructorParameters<typeof WorkflowOperationService>[6];
  draft?: ConstructorParameters<typeof WorkflowOperationService>[8];
} = {}) {
  const rows = new Map<string, WorkflowOperation>();
  let tail: Promise<unknown> = Promise.resolve();
  let writing = false;
  const operations: WorkflowOperationStore = {
    readOnly: work => tail.then(work),
    transaction<T>(work: () => Promise<T>): Promise<T> {
      const next = tail.then(async () => {
        writing = true;
        try { return await work(); } finally { writing = false; }
      });
      tail = next.catch(() => {}); return next;
    },
    async get(id) { return rows.get(id) ?? null; },
    async byRequest(mission, key) { return [...rows.values()].find(row => row.missionId === mission && row.requestKey === key) ?? null; },
    async current(mission) { return [...rows.values()].find(row => row.missionId === mission && ['accepted', 'preparing', 'waiting', 'running', 'checking', 'stopping'].includes(row.phase)) ?? null; },
    async open() { return [...rows.values()].filter(row => ['accepted', 'preparing', 'waiting', 'running', 'checking', 'stopping'].includes(row.phase)); },
    async insert(row) { rows.set(row.id, row); },
    async replace(row, generation) { assert.equal(rows.get(row.id)?.generation, generation); rows.set(row.id, row); },
  };
  const missions = new Map(['task-one', 'task-two'].map(slug => [slug, fixtureMission(slug, { status: 'refined' })]));
  const events: string[] = [];
  const store: MissionTransitionStore = {
    async load(id) { const mission = missions.get(id); return mission ? { kind: 'found', mission, version: missionVersion(1) } : { kind: 'missing' }; },
    async save(mission) { missions.set(mission.id, mission); return missionVersion(2); },
    async saveWithTransition(mission, _version, event) { missions.set(mission.id, mission); events.push(`${event.from}:${event.to}`); return missionVersion(2); },
  };
  let live: boolean | null = true;
  let stopped = true;
  let failLaunch = false;
  let effectsSettled = true;
  const launches: string[] = [];
  const processes: WorkflowProcessPort = {
    identity() { return { pid: 100, identity: 'owner-start' }; },
    async launch(id) { launches.push(id); if (failLaunch) { throw new Error('spawn failed'); } },
    async alive() { return live; }, async effectsSettled() { return effectsSettled; }, async stop() { return stopped; },
  };
  const publications: string[] = [];
  const service = new WorkflowOperationService(operations, store, { canExecute: () => true, async dispatch<T>() { return completed({} as T); } }, processes,
    { async running(p) { publications.push(p.summary); }, async ended(p) { publications.push(p.summary); }, async blocked(p) { publications.push(p.summary); } },
    repositoryId('parallix'), preparation.select ?? (async () => 'codex'), async () => {}, preparation.draft ?? (draftInput ? async () => ({ title: 'Backlog source', labels: [], status: 'backlog' }) : undefined), undefined, wait);
  return { service, operations, missions, events, launches, publications, processes, isWriting: () => writing, setLaunchFailure: (value: boolean) => { failLaunch = value; }, setEffectsSettled: (value: boolean) => { effectsSettled = value; }, setLive: (value: boolean | null) => { live = value; }, setStopped: (value: boolean) => { stopped = value; } };
}
function request(id = 'request-one', mission = 'task-one'): BoardCommandRequest {
  return { operationId: id, requestKey: id, kind: 'active:execute', missionId: mission, missionStatusAtRequest: 'refined', capabilities: new Set(['active:execute']) };
}

test('agent selection occurs outside admission writes and settled retries do not repeat it (TASK-2750)', async () => {
  let f: ReturnType<typeof fixture>;
  let selections = 0;
  f = fixture(false, undefined, { select: async () => {
    assert.equal(f.isWriting(), false, 'configuration and availability must not hold the writer');
    selections++;
    return 'codex';
  } });
  assert.equal((await f.service.admit(request())).status, 'accepted');
  await f.service.run('request-one', async () => completed({}));
  assert.equal((await f.service.admit(request())).status, 'accepted');
  assert.equal(selections, 1);
  assert.equal(f.launches.length, 1);
});

test('admission rechecks mission eligibility after external preparation (TASK-2750)', async () => {
  let f: ReturnType<typeof fixture>;
  f = fixture(false, undefined, { select: async () => {
    f.missions.set('task-one', fixtureMission('task-one', { status: 'done' }));
    return 'codex';
  } });
  assert.equal((await f.service.admit(request())).status, 'failed');
  assert.deepEqual(f.events, []);
  assert.deepEqual(f.launches, []);
  assert.equal((await f.operations.open()).length, 0);
});

test('cancellation during external preparation prevents activation (TASK-2750)', async () => {
  const cancellation = { requested: false };
  const f = fixture(false, undefined, { select: async () => { cancellation.requested = true; return 'codex'; } });
  const result = await f.service.admit({ ...request(), cancellation });
  assert.equal(result.status, 'cancelled');
  assert.equal(result.error?.kind, 'cancelled');
  assert.deepEqual(f.events, []);
  assert.deepEqual(f.launches, []);
});

test('missing mission rejects before consulting agent configuration (TASK-2750)', async () => {
  let selected = false;
  const f = fixture(false, undefined, { select: async () => { selected = true; throw new Error('configuration unavailable'); } });
  f.missions.delete('task-one');
  const result = await f.service.admit(request());
  assert.equal(result.status, 'failed');
  assert.equal(result.error?.kind, 'unavailable');
  assert.equal(selected, false);
});

test('draft source reads occur before the admission write transaction (TASK-2750)', async () => {
  let f: ReturnType<typeof fixture>;
  f = fixture(true, undefined, { draft: async () => {
    assert.equal(f.isWriting(), false, 'reading task files must not hold the writer');
    return { title: 'Backlog source', labels: [], status: 'backlog' };
  } });
  const result = await f.service.admit({ ...request('draft', 'task-new'), kind: 'draft:create',
    missionStatusAtRequest: 'backlog', capabilities: new Set(['draft:create']) });
  assert.equal(result.status, 'accepted');
  assert.equal(f.missions.get('task-new')?.status, 'backlog');
});

test('review continuation is admitted from integration without moving the mission (TASK-2750)', async () => {
  const f = fixture();
  f.missions.set('task-one', fixtureMission('task-one', { status: 'integration' }));
  const reviewRequest: BoardCommandRequest = { ...request(), kind: 'review:submit',
    missionStatusAtRequest: 'integration', capabilities: new Set(['review:submit']),
    invocation: { command: 'review', args: ['--continue'] } };
  const admitted = await f.service.admit(reviewRequest);
  assert.equal(admitted.status, 'accepted');
  assert.deepEqual((await f.service.operation('request-one'))?.invocation, reviewRequest.invocation);
  let executed = false;
  await f.service.run('request-one', async () => {
    executed = true;
    return completed({});
  });
  assert.equal(executed, true);
  assert.equal(f.missions.get('task-one')?.status, 'integration');
  assert.deepEqual(f.events, []);
});

test('CLI review retains eligibility outside integration continuation (TASK-2750)', async () => {
  const cases = [
    { status: 'backlog', args: ['--submit'] },
    { status: 'done', args: ['--submit'] },
    { status: 'backlog', args: ['--continue'] },
    { status: 'done', args: ['--continue'] },
    { status: 'integration', args: ['--submit'] },
    { status: 'integration', args: ['--start'] },
    { status: 'integration', args: ['--submit', '--continue'] },
    { status: 'integration', args: ['--status', '--continue'] },
  ] as const;
  for (const { status, args } of cases) {
    const f = fixture();
    f.missions.set('task-one', fixtureMission('task-one', { status }));
    const result = await f.service.admit({ ...request(), kind: 'review:submit',
      missionStatusAtRequest: status, capabilities: new Set(['review:submit']),
      invocation: { command: 'review', args } });
    assert.equal(result.status, 'rejected', `${status}: ${args.join(' ')}`);
    assert.equal(result.error?.kind, 'validation');
    assert.deepEqual(f.launches, []);
    assert.deepEqual(f.events, []);
    assert.equal((await f.operations.open()).length, 0);
  }
});

test('review invocation cannot make another workflow eligible (TASK-2750)', async () => {
  const f = fixture();
  f.missions.set('task-one', fixtureMission('task-one', { status: 'integration' }));
  const result = await f.service.admit({ ...request(), missionStatusAtRequest: 'integration',
    invocation: { command: 'review', args: ['--continue'] } });
  assert.equal(result.status, 'rejected');
  assert.deepEqual(f.launches, []);
});

test('admission commits activation, lane event and preparing before execution (TASK-2750)', async () => {
  const f = fixture();
  const admitted = await f.service.admit(request());
  assert.equal(admitted.status, 'accepted');
  assert.equal(f.missions.get('task-one')?.status, 'active');
  assert.deepEqual(f.events, ['refined:active']);
  assert.deepEqual(f.publications, ['preparing workflow']);
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const running = f.service.run('request-one', async () => { await barrier; return completed({}); });
  try {
    const second = await f.service.admit(request('request-two', 'task-two'));
    assert.equal(second.status, 'accepted');
    assert.equal(f.missions.get('task-two')?.status, 'active');
  } finally { release(); await running; }
  assert.equal((await f.service.operation('request-one'))?.phase, 'completed');
});

test('duplicate requests join one identity, CLI/web races conflict, and duplicate workers execute once (TASK-2750)', async () => {
  const f = fixture();
  const results = await Promise.all([f.service.admit(request()), f.service.admit(request()), f.service.admit(request('competitor'))]);
  assert.deepEqual(results.map(result => result.status), ['accepted', 'accepted', 'failed']);
  assert.equal(f.launches.length, 1, 'duplicate requests do not spawn another supervisor (F3)');
  assert.deepEqual(f.events, ['refined:active']);
  let executions = 0;
  await Promise.all([f.service.run('request-one', async () => { executions++; return completed({}); }),
    f.service.run('request-one', async () => { executions++; return completed({}); })]);
  assert.equal(executions, 1);
});

test('invalid and stale admission preserves mission state (TASK-2750)', async () => {
  const f = fixture();
  assert.equal((await f.service.admit({ ...request(), missionStatusAtRequest: 'active' })).status, 'failed');
  assert.equal((await f.service.admit({ ...request(), capabilities: new Set() })).status, 'rejected');
  f.missions.set('task-one', fixtureMission('task-one', { status: 'done' }));
  assert.equal((await f.service.admit({ ...request(), missionStatusAtRequest: 'done' })).status, 'rejected');
  assert.equal(f.events.length, 0);
  assert.equal((await f.operations.open()).length, 0);
});

test('recovery dispatches accepted intent and never replays a crashed external workflow (TASK-2750)', async () => {
  const f = fixture(); await f.service.admit(request());
  await f.service.recover(); assert.equal(f.launches.length, 2);
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const run = f.service.run('request-one', async () => { await barrier; return completed({}); });
  try {
    await f.operations.transaction(async () => {});
    f.setLive(false); await f.service.recover();
    assert.equal((await f.service.operation('request-one'))?.phase, 'interrupted');
    assert.equal(f.launches.length, 2);
  } finally { release(); await run; }
  assert.equal((await f.service.operation('request-one'))?.phase, 'interrupted');
});

test('stop refuses unconfirmed replacement and fences delayed writes after a settled stop (TASK-2750)', async () => {
  const f = fixture(); await f.service.admit(request());
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const run = f.service.run('request-one', async () => { await barrier; return completed({}); });
  try {
    await f.operations.transaction(async () => {});
    f.setStopped(false);
    const pending = await f.service.stop('task-one');
    assert.equal(pending.status, 'failed');
    assert.match(pending.error!.message, /Inspect px history task-one/);
    assert.match(pending.error!.message, /verifying its current start identity matches/);
    assert.match(pending.error!.message, /rerun px stop task-one/);
    assert.equal((await f.service.admit({ ...request('replacement'), missionStatusAtRequest: 'active' })).status, 'failed');
    f.setStopped(true); assert.equal((await f.service.stop('task-one')).status, 'completed');
    const replacement = await f.service.admit({ ...request('replacement'), missionStatusAtRequest: 'active' });
    assert.equal(replacement.status, 'accepted');
    await assert.rejects(() => f.service.assertOwner('request-one', 1), /fenced|stopped/);
    assert.equal(f.missions.size, 2);
    assert.deepEqual(f.events, ['refined:active']);
  } finally { release(); await run; }
  assert.equal((await f.service.operation('request-one'))?.phase, 'stopped');
});

test('startup and prelaunch failure safely compensate; later failures retain active evidence (TASK-2750)', async () => {
  const early = fixture(); await early.service.admit(request());
  await early.service.startupFailed('request-one', 'Cannot host worker');
  assert.equal(early.missions.get('task-one')?.status, 'refined');
  assert.equal((await early.service.operation('request-one'))?.phase, 'blocked');
  const late = fixture(); await late.service.admit(request());
  await late.service.run('request-one', async () => {
    await late.service.progress('request-one', 1, 'execute', 'running execute agent (codex)', 'codex', true);
    return failure('execution', 'Gate failed after launch');
  });
  assert.equal(late.missions.get('task-one')?.status, 'active');
  assert.equal((await late.service.operation('request-one'))?.reason, 'Gate failed after launch');
});


test('a supervisor startup reason is the board command outcome, naming the mission and unresolved fact (TASK-2777)', async () => {
  const f = fixture();
  const reason = 'Mission task-one: mission worktree /work/repo-task-one is on main, expected mission/task-one.';
  f.processes.launch = async id => { void Promise.resolve().then(() => f.service.startupFailed(id, reason)); };
  const outcome = await f.service.dispatch(request());
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.error?.message, reason);
  assert.equal((await f.service.operation('request-one'))?.reason, reason);
  assert.equal(f.missions.get('task-one')?.status, 'refined');
});

test('backlog draft intake and ownership are admitted together before preparation (TASK-2750)', async () => {
  const f = fixture(true);
  const outcome = await f.service.admit({ operationId: 'draft-key', missionId: 'task-new', kind: 'draft:create', missionStatusAtRequest: 'backlog', capabilities: new Set(['draft:create' as never]) });
  assert.equal(outcome.status, 'accepted');
  assert.equal(f.missions.get('task-new')?.status, 'backlog');
  assert.equal((await f.service.current('task-new'))?.command, 'draft:create');
});


test('failed spawn retains accepted intent and recovery uses the same command identity (TASK-2750)', async () => {
  const f = fixture(); f.setLaunchFailure(true);
  assert.equal((await f.service.admit(request())).status, 'accepted');
  assert.equal((await f.service.operation('request-one'))?.phase, 'accepted');
  f.setLaunchFailure(false); await f.service.recover();
  assert.deepEqual(f.launches, ['request-one', 'request-one']);
  await f.service.run('request-one');
  assert.equal((await f.service.operation('request-one'))?.phase, 'completed');
  assert.deepEqual(f.events, ['refined:active']);
});

test('uncertain external execution keeps ownership until reconciliation confirms stop (TASK-2750)', async () => {
  const f = fixture(); await f.service.admit(request());
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const running = f.service.run('request-one', async () => { await gate; return completed({}); });
  try {
    await f.operations.transaction(async () => {});
    f.setLive(false); f.setEffectsSettled(false); await f.service.recover();
    assert.equal((await f.service.operation('request-one'))?.phase, 'stopping');
    assert.equal((await f.service.admit({ ...request('replacement'), missionStatusAtRequest: 'active' })).status, 'failed');
    assert.equal((await f.service.stop('task-one')).status, 'failed');
    f.setEffectsSettled(true); assert.equal((await f.service.stop('task-one')).status, 'completed');
  } finally { release(); await running; }
});

test('provider-capacity waiting remains admitted, visible and exclusively owned (TASK-2750)', async () => {
  const f = fixture(); await f.service.admit(request());
  await f.service.run('request-one', async () => {
    await f.service.progress('request-one', 1, 'waiting', 'waiting for provider capacity');
    assert.equal((await f.service.current('task-one'))?.phase, 'waiting');
    assert.equal((await f.service.admit({ ...request('competitor'), missionStatusAtRequest: 'active' })).status, 'failed');
    return completed({});
  });
});


test('only one supervisor reserves capture and dispatch for repeated accepted delivery (TASK-2750)', async () => {
  const f = fixture(); await f.service.admit(request());
  const reserved = await Promise.all([f.service.reserveLaunch('request-one'), f.service.reserveLaunch('request-one')]);
  assert.deepEqual(reserved, [true, false]);
  f.setLive(false);
  assert.equal(await f.service.reserveLaunch('request-one'), true, 'an unclaimed intent recovers a dead launcher');
});


test('fallback progress changes the attributed family without changing command ownership (TASK-2750)', async () => {
  const f = fixture(); await f.service.admit(request());
  await f.service.run('request-one', async () => {
    await f.service.progress('request-one', 1, 'execute', 'running execute agent (claude)', 'claude', true);
    const current = await f.service.current('task-one');
    assert.equal(current?.id, 'request-one'); assert.equal(current?.agent, 'claude'); assert.equal(current?.providerStarted, true);
    return completed({});
  });
  assert.deepEqual(f.events, ['refined:active']);
});


test('recovery cannot steal a stop while process termination is held (TASK-2750 F2)', async () => {
  const f = fixture(); await f.service.admit(request());
  const accepted = (await f.service.operation('request-one'))!;
  await f.operations.replace({ ...accepted, phase: 'preparing', owner: f.processes.identity(), generation: 1 }, 0);
  f.processes.stop = async () => {
    f.setLive(false);
    await f.service.recover();
    assert.equal((await f.service.operation('request-one'))?.phase, 'stopping');
    return true;
  };
  assert.equal((await f.service.stop('task-one')).status, 'completed');
  assert.equal((await f.service.operation('request-one'))?.reason, 'Stopped by operator');
});

test('handoff stale versions reject before ownership and payload reaches executor (TASK-2750 F8)', async () => {
  const f = fixture();
  f.missions.set('task-one', fixtureMission('task-one', { status: 'active' }));
  const payload = { kind: 'handoff:record' as const, netEngineeringLines: 2, capturedAt: new Date().toISOString(), expectedVersion: missionVersion(2) };
  const r = { ...request(), missionStatusAtRequest: 'active', kind: 'handoff:record' as const, capabilities: new Set(['handoff:record'] as const), payload };
  const rejected = await f.service.admit(r);
  assert.ok(rejected.status !== 'accepted' && rejected.error?.kind === 'conflict');
  assert.equal(await f.service.current('task-one'), null);
});


test('CLI waiting ends on stopping or deadline without cancelling independent work (TASK-2750 F4)', async () => {
  let time = 0;
  const timed = fixture(false, { now: () => time++, timeoutMs: 2 });
  const outcome = await timed.service.dispatch(request());
  assert.equal(outcome.status, 'cancelled');
  assert.match(outcome.error!.message, /continues independently/);
  assert.equal((await timed.service.current('task-one'))?.phase, 'accepted');
  const stopping = fixture();
  stopping.processes.launch = async () => {
    const operation = (await stopping.service.operation('request-one'))!;
    await stopping.operations.replace({ ...operation, phase: 'stopping' }, 0);
  };
  assert.match((await stopping.service.dispatch(request())).error!.message, /Stop is pending/);
});

test('unavailable handoff and invalid activation return validation before launch (TASK-2750 F8)', async () => {
  const f = fixture();
  f.missions.set('task-one', fixtureMission('task-one', { status: 'active', checkpoints: [] }));
  const result = await f.service.admit({ ...request(), missionStatusAtRequest: 'active', kind: 'handoff:record', capabilities: new Set(['handoff:record']) });
  assert.ok(result.status !== 'accepted' && result.error?.kind === 'validation');
  assert.equal(f.launches.length, 0);
});


test('accepted handoff payload survives durable ownership and executor claim (TASK-2750 F8)', async () => {
  const f = fixture();
  f.missions.set('task-one', fixtureMission('task-one', { status: 'active' }));
  const payload = { kind: 'handoff:record' as const, netEngineeringLines: 2, capturedAt: new Date().toISOString(), expectedVersion: missionVersion(1) };
  assert.equal((await f.service.admit({ ...request(), missionStatusAtRequest: 'active', kind: 'handoff:record', capabilities: new Set(['handoff:record']), payload })).status, 'accepted');
  await f.service.run('request-one', async request => {
    assert.deepEqual(request.payload, payload);
    return completed({});
  });
});


test('activation refusal preserves its validation error and admits no owner (TASK-2750 F8)', async () => {
  const f = fixture();
  f.missions.set('task-one', fixtureMission('task-one', { status: 'refined', labels: missionLabels(['ai_sdlc']), brief: missionBrief({ goal: 'goal', why: 'why', scope: null, outOfScope: [] }) }));
  const outcome = await f.service.admit(request());
  assert.ok(outcome.status !== 'accepted' && outcome.error?.kind === 'validation');
  assert.equal(await f.service.current('task-one'), null);
  assert.equal(f.events.length, 0);
});


for (const phase of ['preparing', 'checking', 'running'] as const) {
  test(`foreground cancellation settles ${phase} before retry and fences late completion (TASK-2771)`, async () => {
    const f = fixture();
    const cancellation = { requested: false, stopOwnedWorkflow: true };
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let running: Promise<void> | undefined;
    f.processes.launch = async id => {
      running = f.service.run(id, async () => {
        await f.service.progress(id, 1, phase === 'checking' ? 'handoff' : 'execute', phase, undefined, phase === 'running');
        cancellation.requested = true;
        await held;
        return completed({});
      });
      await f.operations.transaction(async () => {});
    };
    const stopped: number[] = [];
    f.processes.stop = async owner => { stopped.push(owner.pid); return true; };
    const evidence = f.missions.get('task-one')!.checkpoints;
    try {
      const result = await f.service.dispatch({ ...request(), cancellation });
      assert.equal(result.status, 'cancelled');
      assert.equal((await f.service.operation('request-one'))?.phase, 'stopped');
      assert.equal(stopped.length, 1);
      assert.deepEqual(f.missions.get('task-one')!.checkpoints, evidence);
      f.processes.launch = async () => {};
      assert.equal((await f.service.admit({ ...request('replacement'), missionStatusAtRequest: 'active' })).status, 'accepted');
      await assert.rejects(() => f.service.progress('request-one', 1, 'execute', 'late'), /fenced|stopped/);
    } finally { release(); await running; }
    assert.equal((await f.service.operation('request-one'))?.phase, 'stopped');
    assert.equal((await f.service.current('task-one'))?.id, 'replacement');
  });
}

test('foreground cancellation cannot stop a replacement or an independent workflow (TASK-2771)', async () => {
  const f = fixture();
  await f.service.admit(request()); await f.service.admit(request('independent', 'task-two'));
  await f.service.stop('task-one');
  await f.service.admit({ ...request('replacement'), missionStatusAtRequest: 'active' });
  let stops = 0; f.processes.stop = async () => { stops++; return true; };
  assert.equal((await f.service.stop('task-one', 'request-one')).status, 'completed');
  assert.equal((await f.service.current('task-one'))?.id, 'replacement');
  assert.equal((await f.service.current('task-two'))?.id, 'independent');
  assert.equal(stops, 0);
});
