import { memoryExecutionActivity } from '../../fixtures/execution-activity.js';
import { missionId } from '../../../src/domain/mission.js';
import { configureMissionWriteAuthorization } from '../../../src/application/ports/mission-write-authorization.js';
import { agentFamily } from '../../../src/domain/agents.js';
import { ExecuteMissionService } from '../../../src/application/execute-mission-service.js';
import { makeExecutePorts } from '../../fixtures/execute-mission-ports.js';
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
  select?: ConstructorParameters<typeof WorkflowOperationService>[5];
  draft?: ConstructorParameters<typeof WorkflowOperationService>[7];
  eligible?: (_agent: string) => Promise<boolean>;
} = {}) {
  const rows = new Map<string, WorkflowOperation>();
  let tail: Promise<unknown> = Promise.resolve();
  let writing = false;
  const activity = memoryExecutionActivity();
  const operations: WorkflowOperationStore = {
    activity,
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
    async current(mission) { return [...rows.values()].find(row => row.missionId === mission && ['accepted', 'executing', 'stopping'].includes(row.phase)) ?? null; },
    async open() { return [...rows.values()].filter(row => ['accepted', 'executing', 'stopping'].includes(row.phase)); },
    async latest(mission) { return [...rows.values()].filter(row => row.missionId === mission).at(-1) ?? null; },
    async latestByMission() { return [...rows.values()]; },
    async insert(row) { rows.set(row.id, row); },
    async replace(row, generation) { assert.equal(rows.get(row.id)?.generation, generation); rows.set(row.id, row); },
  };
  const missions = new Map(['task-one', 'task-two'].map(slug => [slug, fixtureMission(slug, { status: 'refined' })]));
  const events: string[] = [];
  const versions = new Map<string, number>();
  const store: MissionTransitionStore = {
    async load(id) { const mission = missions.get(id); return mission ? { kind: 'found', mission, version: missionVersion(versions.get(id) ?? 1) } : { kind: 'missing' }; },
    async save(mission) { missions.set(mission.id, mission); const version = (versions.get(mission.id) ?? 1) + 1; versions.set(mission.id, version); return missionVersion(version); },
    async saveWithTransition(mission, _version, event) { const version = await store.save(mission, _version); events.push(`${event.from}:${event.to}`); return version; },
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
  const publish = activity.publish;
  activity.publish = async (event, source) => { publications.push(event.summary); await publish(event, source); };
  const service = new WorkflowOperationService(operations, store, { canExecute: () => true, async dispatch<T>() { return completed({} as T); } }, processes,
    repositoryId('parallix'), preparation.select ?? (async () => 'codex'), async () => {}, preparation.draft ?? (draftInput ? async () => ({ title: 'Backlog source', labels: [], status: 'backlog' }) : undefined), undefined, wait, preparation.eligible ?? (async () => true));
  return { service, store, operations, activity, missions, events, launches, publications, processes, isWriting: () => writing, setLaunchFailure: (value: boolean) => { failLaunch = value; }, setEffectsSettled: (value: boolean) => { effectsSettled = value; }, setLive: (value: boolean | null) => { live = value; }, setStopped: (value: boolean) => { stopped = value; } };
}
function request(id = 'request-one', mission = 'task-one'): BoardCommandRequest {
  return { operationId: id, requestKey: id, kind: 'active:execute', missionId: mission, missionStatusAtRequest: 'refined', capabilities: new Set(['active:execute']) };
}

test('direct rebase admission owns a durable generation without changing the mission lane (TASK-2835)', async () => {
  const f = fixture();
  const admitted = await f.service.admit({ operationId: 'rebase-one', requestKey: 'rebase-one', kind: 'rebase:run',
    missionId: 'task-one', missionStatusAtRequest: 'refined', capabilities: new Set(['rebase:run']),
    invocation: { command: 'rebase', args: ['task-one'], interactive: false } });
  assert.equal(admitted.status, 'accepted');
  assert.equal(admitted.status === 'accepted' && admitted.operation.command, 'rebase:run');
  assert.equal(admitted.status === 'accepted' && admitted.operation.generation, 0);
  assert.equal(f.missions.get('task-one')?.status, 'refined');
  assert.deepEqual(f.launches, ['rebase-one']);
});

test('review disconnect preserves detached completion and explicit stop excludes replacement (TASK-2826)', async () => {
  const f = fixture();
  f.missions.set('task-one', fixtureMission('task-one', { status: 'review' }));
  const cancellation = { requested: false, stopOwnedWorkflow: false };
  const review = { ...request(), kind: 'review:submit' as const, missionStatusAtRequest: 'review',
    capabilities: new Set(['review:submit' as const]), cancellation };
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let running: Promise<void> | undefined;
  let verdict = false;
  f.processes.launch = async id => {
    running = f.service.run(id, async () => {
      cancellation.requested = true;
      await held;
      await f.service.assertOwner(id, 1);
      verdict = true;
      return completed({});
    });
    await f.operations.transaction(async () => {});
  };
  try {
    assert.match((await f.service.dispatch(review)).error!.message, /continues independently/);
    assert.equal((await f.service.operation('request-one'))?.phase, 'executing');
    assert.equal((await f.service.admit({ ...review, operationId: 'competitor', requestKey: 'competitor', cancellation: undefined })).status, 'failed');
  } finally { release(); await running; }
  assert.equal(verdict, true);
  assert.equal((await f.service.operation('request-one'))?.phase, 'completed');
  f.processes.launch = async () => {};
  const next = { ...review, operationId: 'next', requestKey: 'next', cancellation: undefined };
  assert.equal((await f.service.admit(next)).status, 'accepted');
  f.setEffectsSettled(false);
  assert.equal((await f.service.stop('task-one')).status, 'failed');
  assert.equal((await f.service.admit({ ...next, operationId: 'replacement', requestKey: 'replacement' })).status, 'failed');
  f.setEffectsSettled(true);
  assert.equal((await f.service.stop('task-one')).status, 'completed');
  await assert.rejects(() => f.service.assertOwner('next', 0), /fenced|stopped/);
});

test('review disconnect during admission cancels before insertion or leaves a valid detached launch (TASK-2826)', async () => {
  for (const boundary of ['load', 'insert'] as const) {
    const f = fixture();
    f.missions.set('task-one', fixtureMission('task-one', { status: 'review' }));
    const cancellation = { requested: false, stopOwnedWorkflow: false };
    if (boundary === 'load') {
      const load = f.store.load;
      f.store.load = async id => { cancellation.requested = true; return load(id); };
    } else {
      const insert = f.operations.insert;
      f.operations.insert = async row => { await insert(row); cancellation.requested = true; };
    }
    const result = await f.service.admit({ ...request(), kind: 'review:submit', missionStatusAtRequest: 'review',
      capabilities: new Set(['review:submit']), cancellation });
    assert.equal(result.status, boundary === 'load' ? 'cancelled' : 'accepted');
    assert.equal(f.launches.length, boundary === 'load' ? 0 : 1);
    if (boundary === 'insert') {
      await f.service.run('request-one', async () => completed({}));
      assert.equal((await f.service.operation('request-one'))?.phase, 'completed');
    }
  }
});

test('accepted continuation does not repeat activation before workspace preparation (TASK-2822)', async t => {
  t.after(() => configureMissionWriteAuthorization(null));
  const f = fixture();
  await f.service.admit(request());
  let saves = 0;
  const save = f.store.save.bind(f.store);
  f.store.save = async (...args) => { saves++; return save(...args); };
  const { ports } = makeExecutePorts({ missionTransitions: f.store, workspace: {
    preflight: async () => { assert.equal(saves, 0, 'continuation cannot activate again'); return false; },
  } });
  await f.service.run('request-one', async () => {
    configureMissionWriteAuthorization({ operationId: 'request-one', start: (await f.service.operation('request-one'))!, assert: async () => {} });
    try { return await new ExecuteMissionService(ports).execute({ operationId: 'worker', slug: 'task-one', agent: 'codex', capabilities: new Set(['active:execute']) }); }
    finally { configureMissionWriteAuthorization(null); }
  });
  assert.equal(f.missions.get('task-one')?.status, 'refined', 'only the original activation is compensated');
});

test('prelaunch compensation cannot undo a newer Mission write (TASK-2822)', async () => {
  const f = fixture();
  await f.service.admit(request());
  const loaded = await f.store.load(missionId('task-one'));
  assert.equal(loaded.kind, 'found');
  if (loaded.kind !== 'found') { throw new Error('fixture missing'); }
  await f.store.save({ ...loaded.mission, title: 'newer work' }, loaded.version);
  await f.service.startupFailed('request-one', 'launcher failed');
  assert.equal(f.missions.get('task-one')?.status, 'active');
  assert.equal(f.missions.get('task-one')?.title, 'newer work');
});

test('typed nested activity restores its parent and waiting never becomes provider execution (TASK-2822)', async () => {
  const f = fixture();
  await f.service.admit(request());
  await f.service.run('request-one', async () => {
    const event = { missionId: missionId('task-one'), operationId: 'request-one', phase: 'review-response' as const,
      state: 'running' as const, summary: 'answering findings', agent: agentFamily('codex'), processId: 200,
      blockedReason: null, occurredAt: new Date().toISOString() };
    await f.service.activity('request-one', 1, event, 'child');
    assert.equal((await f.operations.activity.loadMissionCurrentWork(missionId('task-one')))[0]?.frames.at(-1)?.event.summary, 'answering findings');
    await f.service.activity('request-one', 1, { ...event, state: 'ended' }, 'child');
    assert.equal((await f.operations.activity.loadMissionCurrentWork(missionId('task-one')))[0]?.frames.at(-1)?.event.summary, 'preparing workflow');
    await f.service.providerStarted('request-one', 1, 'codex');
    await f.service.activity('request-one', 1, { ...event, phase: 'waiting', summary: 'waiting for capacity', agent: null }, 'request-one');
    const current = (await f.service.operation('request-one'))!;
    assert.equal(current.phase, 'executing');
    assert.equal(current.providerStarted, true);
    assert.equal((await f.operations.activity.loadMissionCurrentWork(missionId('task-one')))[0]?.frames.at(-1)?.event.phase, 'waiting');
    return completed({});
  });
});

test('a same-parent child ending out of order cannot clear a later live child (TASK-2822)', async () => {
  const f = fixture();
  await f.service.admit(request());
  await f.service.run('request-one', async () => {
    const event = { missionId: missionId('task-one'), operationId: 'request-one', phase: 'review' as const,
      state: 'running' as const, summary: 'first child', agent: agentFamily('claude'), processId: 200,
      blockedReason: null, occurredAt: new Date().toISOString() };
    await f.service.activity('request-one', 1, event, 'first');
    await f.service.activity('request-one', 1, { ...event, summary: 'later child', agent: agentFamily('codex') }, 'later');
    await f.service.activity('request-one', 1, { ...event, state: 'ended' }, 'first');
    const current = (await f.operations.activity.loadMissionCurrentWork(event.missionId))[0];
    assert.equal(current.frames.at(-1)?.event.summary, 'later child');
    assert.equal(current.frames.at(-1)?.event.agent, 'codex');
    await f.service.activity('request-one', 1, { ...event, state: 'ended' }, 'later');
    const resumed = (await f.operations.activity.loadMissionCurrentWork(event.missionId))[0];
    assert.equal(resumed.frames.length, 1);
    assert.equal(resumed.frames[0].event.summary, 'preparing workflow');
    return completed({});
  });
});

test('failed nested work survives bracket cleanup until supported parent continuation (TASK-2822)', async () => {
  const f = fixture();
  await f.service.admit(request());
  await f.service.run('request-one', async () => {
    const event = { missionId: missionId('task-one'), operationId: 'request-one', phase: 'review' as const,
      state: 'running' as const, summary: 'reviewer running', agent: agentFamily('claude'), processId: 200,
      blockedReason: null, occurredAt: new Date().toISOString() };
    await f.service.activity('request-one', 1, event, 'reviewer');
    await f.service.activity('request-one', 1, { ...event, state: 'blocked', blockedReason: 'Review needs a reserved decision' }, 'reviewer');
    await f.service.activity('request-one', 1, { ...event, state: 'ended' }, 'reviewer');
    const failed = (await f.operations.activity.loadMissionCurrentWork(event.missionId))[0];
    assert.equal(failed.frames.at(-1)?.event.blockedReason, 'Review needs a reserved decision');
    await f.service.activity('request-one', 1, { ...event, summary: 'supported continuation', agent: null }, 'request-one');
    await f.service.activity('request-one', 1, { ...event, state: 'blocked', blockedReason: 'late child failure' }, 'reviewer');
    const continued = (await f.operations.activity.loadMissionCurrentWork(event.missionId))[0];
    assert.equal(continued.frames.length, 1);
    assert.equal(continued.frames[0].event.summary, 'supported continuation');
    return completed({});
  });
});

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
    invocation: { command: 'review', args: [] } };
  const admitted = await f.service.admit(reviewRequest);
  assert.equal(admitted.status, 'accepted');
  assert.deepEqual((await f.service.operation('request-one'))?.invocation, reviewRequest.invocation);
  let executed = false;
  await f.service.run('request-one', async () => {
    executed = true;
    return completed({});
  });
  assert.equal(executed, true);
  assert.equal(f.missions.get('task-one')?.status, 'review');
  assert.deepEqual(f.events, ['integration:review']);
});

test('CLI review retains eligibility outside integration continuation (TASK-2750)', async () => {
  const cases = [
    { status: 'backlog', args: ['--submit'] },
    { status: 'done', args: ['--submit'] },
    { status: 'backlog', args: [] },
    { status: 'done', args: [] },
    { status: 'integration', args: ['--submit'] },
    { status: 'integration', args: ['--submit'] },
    { status: 'integration', args: ['--status'] },
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
    invocation: { command: 'review', args: [] } });
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
    assert.equal((await f.activity.loadMissionCurrentWork(missionId('task-one')))[0]?.terminal?.state, 'interrupted');
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
    await late.service.providerStarted('request-one', 1, 'codex');
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
    assert.match((await f.service.current('task-one'))!.reason!, /Stop is pending.*(unconfirmed|not yet reconciled)/);
    f.setEffectsSettled(true); assert.equal((await f.service.stop('task-one')).status, 'completed');
  } finally { release(); await running; }
});

test('provider-capacity waiting remains admitted, visible and exclusively owned (TASK-2750)', async () => {
  const f = fixture(); await f.service.admit(request());
  await f.service.run('request-one', async () => {
    await f.service.providerStarted('request-one', 1, 'codex');
    assert.equal((await f.service.current('task-one'))?.phase, 'executing');
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
    await f.service.providerStarted('request-one', 1, 'claude');
    const current = await f.service.current('task-one');
    assert.equal(current?.id, 'request-one'); assert.equal(current?.agent, 'claude'); assert.equal(current?.providerStarted, true);
    return completed({});
  });
  assert.deepEqual(f.events, ['refined:active']);
});


test('recovery cannot steal a stop while process termination is held (TASK-2750 F2)', async () => {
  const f = fixture(); await f.service.admit(request());
  const accepted = (await f.service.operation('request-one'))!;
  await f.operations.replace({ ...accepted, phase: 'executing', owner: f.processes.identity(), generation: 1 }, 0);
  f.processes.stop = async () => {
    f.setLive(false);
    await f.service.recover();
    assert.equal((await f.service.operation('request-one'))?.phase, 'stopping');
    return true;
  };
  assert.equal((await f.service.stop('task-one')).status, 'completed');
  assert.equal((await f.service.operation('request-one'))?.reason, 'Stopped by operator');
  assert.equal((await f.activity.loadMissionCurrentWork(missionId('task-one')))[0]?.terminal?.state, 'cancelled');
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

test('one-shot evidence writes are not admitted as long-running execution (TASK-2750 F8)', async () => {
  const f = fixture();
  f.missions.set('task-one', fixtureMission('task-one', { status: 'active', checkpoints: [] }));
  const result = await f.service.admit({ ...request(), missionStatusAtRequest: 'active', kind: 'checkpoint:record', capabilities: new Set(['checkpoint:record']) });
  assert.ok(result.status !== 'accepted' && result.error?.kind === 'validation');
  assert.equal(f.launches.length, 0);
});





test('activation refusal preserves its validation error and admits no owner (TASK-2750 F8)', async () => {
  const f = fixture();
  f.missions.set('task-one', fixtureMission('task-one', { status: 'refined', labels: missionLabels(['ai_sdlc']), brief: missionBrief({ goal: 'goal', why: 'why', scope: null, outOfScope: [] }) }));
  const outcome = await f.service.admit(request());
  assert.ok(outcome.status !== 'accepted' && outcome.error?.kind === 'validation');
  assert.equal(await f.service.current('task-one'), null);
  assert.equal(f.events.length, 0);
});


for (const phase of ['execute', 'review', 'waiting'] as const) {
  test(`foreground cancellation settles ${phase} before retry and fences late completion (TASK-2771)`, async () => {
    const f = fixture();
    const cancellation = { requested: false, stopOwnedWorkflow: true };
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    let running: Promise<void> | undefined;
    f.processes.launch = async id => {
      running = f.service.run(id, async () => {
        await f.service.activity(id, 1, { missionId: missionId('task-one'), operationId: id, phase, state: 'running', summary: phase, agent: null, processId: 100, blockedReason: null, occurredAt: new Date().toISOString() }, id);
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
      await assert.rejects(() => f.service.providerStarted('request-one', 1, 'codex'), /fenced|stopped/);
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


test('normal active continuation retains the authoritative implementer (TASK-2793)', async () => {
  let selections = 0;
  const f = fixture(false, undefined, { select: async () => { selections++; return 'custom'; } });
  f.missions.set('task-one', { ...fixtureMission('task-one', { status: 'active' }), assignee: agentFamily('codex') });
  const admitted = await f.service.admit({ ...request(), missionStatusAtRequest: 'active' });
  assert.equal(admitted.status, 'accepted');
  assert.equal((await f.service.operation('request-one'))?.agent, 'codex');
  assert.equal(f.missions.get('task-one')?.assignee, 'codex');
  assert.equal(selections, 0);
});


test('first activation selects once and execution uses the admitted family (TASK-2793)', async () => {
  let selections = 0;
  const f = fixture(false, undefined, { select: async () => { selections++; return 'custom'; } });
  // Draft ownership is not an activated implementer.
  f.missions.set('task-one', { ...f.missions.get('task-one')!, assignee: agentFamily('claude') });
  assert.equal((await f.service.admit(request())).status, 'accepted');
  assert.equal(f.missions.get('task-one')?.assignee, 'custom');
  const launched: string[] = [];
  const { ports } = makeExecutePorts({ missionTransitions: f.store, agentExecution: {
    async select() { selections++; return 'codex'; },
    async launch(r) { launched.push(r.preselectedAgent!); return { agent: r.preselectedAgent!, rebaseDeferred: true, errored: false, errorMessage: null, exitStatus: 0, detail: null }; },
  } });
  await f.service.run('request-one', r => new ExecuteMissionService(ports).execute({ ...r, slug: r.missionId, reviewer: r.reviewer ?? undefined }));
  assert.deepEqual(launched, ['custom']);
  assert.equal(selections, 1);
  assert.equal((await f.service.operation('request-one'))?.phase, 'completed');
});

test('stop and new invocation retain ownership but override and ineligible owner select replacements (TASK-2793)', async () => {
  let selections = 0;
  let eligible = true;
  const f = fixture(false, undefined, { select: async () => { selections++; return 'custom'; }, eligible: async () => eligible });
  await f.service.admit({ ...request(), agent: 'codex' });
  await f.service.stop('task-one');
  await f.service.admit({ ...request('restart'), missionStatusAtRequest: 'active' });
  assert.equal((await f.service.operation('restart'))?.agent, 'codex');
  assert.equal(selections, 0);
  await f.service.run('restart', async () => completed({}));
  await f.service.admit({ ...request('override'), missionStatusAtRequest: 'active', agent: 'claude' });
  assert.equal(f.missions.get('task-one')?.assignee, 'claude');
  await f.service.run('override', async () => completed({}));
  eligible = false;
  await f.service.admit({ ...request('fallback'), missionStatusAtRequest: 'active' });
  assert.equal(f.missions.get('task-one')?.assignee, 'custom');
  assert.equal(selections, 1);
});


test('explicit web family and pin survive durable admission for the executor', async () => {
  const f = fixture();
  const outcome = await f.service.admit({ ...request(), agent: 'custom-family', pinnedAgent: true });
  assert.equal(outcome.status, 'accepted');
  const operation = await f.service.operation('request-one');
  assert.equal(operation?.requestedAgent, 'custom-family');
  assert.equal(operation?.pinnedAgent, true);
  assert.equal(operation?.agent, 'custom-family');
});

test('prelaunch compensation restores the recorded assignee through the execution owner (TASK-2822)', async () => {
  for (const prior of [null, agentFamily('codex')]) {
    const f = fixture(false, undefined, { select: async () => 'claude' });
    f.missions.set('task-one', fixtureMission('task-one', { status: 'refined', assignee: prior }));
    assert.equal((await f.service.admit(request())).status, 'accepted');
    assert.equal(f.missions.get('task-one')?.assignee, 'claude');
    await f.service.run('request-one', async () => failure('execution', 'provider did not start'));
    assert.equal(f.missions.get('task-one')?.status, 'refined');
    assert.equal(f.missions.get('task-one')?.assignee, prior);
    assert.equal((await f.service.operation('request-one'))?.phase, 'blocked');
    assert.deepEqual(f.events, ['refined:active', 'active:refined']);
  }
});

import { approvedReview } from '../../fixtures/mission-builders.js';
import { decideMission } from '../../../src/domain/mission-workflow.js';
import { currentReviewRound } from '../../../src/domain/review.js';

test('pending integration repair admission preserves approval and skips agent selection and activation (TASK-2829)', async () => {
  const f = fixture(false, undefined, { select: async () => assert.fail('retention requires no implementer selection') });
  const review = approvedReview('task-one');
  const approved = fixtureMission('task-one', { status: 'integration', review, assignee: currentReviewRound(review).implementer });
  const pending = decideMission(approved, { type: 'rebound-to-active', agent: currentReviewRound(review).implementer,
    cause: { kind: 'integration-gate-failure', gate: 'unit', command: 'npm test' }, occurredAt: '2026-11-02T10:00:00Z' });
  f.missions.set('task-one', pending);
  const result = await f.service.admit({ ...request(), missionStatusAtRequest: 'active' });
  assert.equal(result.status, 'accepted');
  if (result.status !== 'accepted') { assert.fail('safe retention continuation must be admitted'); }
  assert.equal(result.operation.agent, null);
  assert.deepEqual(f.events, []);
  assert.deepEqual(f.missions.get('task-one'), pending);
});
