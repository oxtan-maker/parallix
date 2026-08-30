import test from 'node:test';
import assert from 'node:assert/strict';

import { BoardCommandController } from '../src/application/controller/board-controller.js';
import {
  DraftCommandUseCase,
  DraftWorkflowAbortedError,
} from '../src/application/draft-command-use-case.js';
import type { DraftWorkflowPort, DraftWorkflowContext } from '../src/application/ports/cli-workflows.js';
import type { CurrentWorkPort } from '../src/application/recording/current-work-recorder.js';
import { makeExecutePorts } from './fixtures/execute-mission-ports.js';
import type { BoardCommandPayload, BoardCommandRequest } from '../src/application/controller/board-command.js';
import type { Capability } from '../src/application/contracts.js';
import type { MissionLoadResult } from '../src/application/domain-ports.js';

// ---------------------------------------------------------------------------
// Mocked workflow port — no git, no Forgejo, no agent, no SQLite
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<DraftWorkflowContext> = {}): DraftWorkflowContext {
  return {
    exited: false,
    slug: 'task-2427',
    mainRepo: '/repo/main',
    targetWorktree: '/repo/worktrees/task-2427',
    missionFile: '/repo/worktrees/task-2427/missions/task-2427/MISSION.md',
    recordedBase: null,
    syntheticTask: null,
    agent: '',
    actualAgent: 'codex',
    agentResult: { status: 0 },
    exitFn: (_code?: number) => { throw new Error('unreachable'); },
    logFn: () => {},
    errorFn: () => {},
    missionServicesFn: async () => ({}),
    options: {},
    ...overrides,
  };
}

interface MockWorkflow {
  readonly port: DraftWorkflowPort;
  readonly steps: string[];
  readonly preflightArgs: Array<{ args: string[]; options: Record<string, unknown> }>;
}

type SyncStep = (ctx: DraftWorkflowContext) => DraftWorkflowContext;
type AsyncStep = (ctx: DraftWorkflowContext) => Promise<DraftWorkflowContext>;
interface WorkflowOverrides {
  readonly preflight?: (args: string[], options: Record<string, unknown>) => DraftWorkflowContext;
  readonly setup?: SyncStep;
  readonly scaffold?: SyncStep;
  readonly intake?: AsyncStep;
  readonly transition?: AsyncStep;
  readonly launchAgent?: AsyncStep;
  readonly postProcess?: AsyncStep;
  readonly commitSafety?: SyncStep;
  readonly finalTransition?: (ctx: DraftWorkflowContext) => Promise<void>;
}

function makeMockWorkflow(overrides: WorkflowOverrides = {}): MockWorkflow {
  const steps: string[] = [];
  const preflightArgs: Array<{ args: string[]; options: Record<string, unknown> }> = [];
  const ok = (name: string): SyncStep => (ctx) => { steps.push(name); return ctx; };
  const okAsync = (name: string): AsyncStep => (async (ctx) => { steps.push(name); return ctx; });
  const port: DraftWorkflowPort = {
    preflight: overrides.preflight ?? ((args, options = {}) => {
      preflightArgs.push({ args, options });
      steps.push('preflight');
      return makeCtx({ options: { ...options } });
    }),
    setup: overrides.setup ?? ok('setup'),
    scaffold: overrides.scaffold ?? ok('scaffold'),
    intake: overrides.intake ?? okAsync('intake'),
    transition: overrides.transition ?? okAsync('transition'),
    launchAgent: overrides.launchAgent ?? okAsync('launchAgent'),
    postProcess: overrides.postProcess ?? okAsync('postProcess'),
    commitSafety: overrides.commitSafety ?? ok('commitSafety'),
    finalTransition: overrides.finalTransition ?? (async (_ctx) => { steps.push('finalTransition'); }),
  };
  return { port, steps, preflightArgs };
}

function makeCurrentWorkRecorder(): { port: CurrentWorkPort; events: string[] } {
  const events: string[] = [];
  const port: CurrentWorkPort = {
    async running(publication) { events.push(`running:${publication.missionId}`); },
    async blocked(publication, reason) { events.push(`blocked:${publication.missionId}:${reason}`); },
    async ended(publication) { events.push(`ended:${publication.missionId}`); },
  };
  return { port, events };
}

function makeRequest(overrides: Partial<BoardCommandRequest> = {}): BoardCommandRequest {
  return {
    operationId: 'op-draft',
    kind: 'draft:create',
    missionId: 'task-2427',
    missionStatusAtRequest: 'backlog',
    capabilities: new Set<Capability>(['mission:intake']),
    ...overrides,
  };
}

interface ControllerDeps {
  readonly status?: string;
  readonly workflow?: MockWorkflow;
  readonly currentWork?: { port: CurrentWorkPort; events: string[] };
}

/** Controller with a mocked mission store (the only authority the backstop reads). */
function makeController(deps: ControllerDeps = {}) {
  const { ports } = makeExecutePorts();
  const workflow = deps.workflow ?? makeMockWorkflow();
  const currentWork = deps.currentWork ?? makeCurrentWorkRecorder();
  const draft = new DraftCommandUseCase(workflow.port, currentWork.port);
  const loadCalls: string[] = [];
  const store = {
    async load(id: string): Promise<MissionLoadResult> {
      loadCalls.push(id);
      return { kind: 'found', mission: { status: deps.status ?? 'backlog' }, version: 1 } as never;
    },
  };
  const controller = new BoardCommandController(ports, undefined, { draft }, currentWork.port, store);
  return { controller, workflow, currentWork, loadCalls };
}

// ---------------------------------------------------------------------------
// SC2/SC5: one dispatch, one outcome, slug is the only value that arrives
// ---------------------------------------------------------------------------

test('draft:create dispatches the draft sequence once and returns one completed outcome', async () => {
  const { controller, workflow, currentWork } = makeController();
  const result = await controller.dispatch(makeRequest());

  assert.equal(result.status, 'completed');
  assert.deepEqual(result.value, { slug: 'task-2427' });
  assert.deepEqual(workflow.steps, [
    'preflight', 'setup', 'scaffold', 'intake', 'transition',
    'launchAgent', 'postProcess', 'commitSafety', 'finalTransition',
  ], 'each workflow step runs exactly once');
  assert.equal(workflow.steps.length, 9, 'one dispatch, one run of the sequence');
  assert.deepEqual(currentWork.events.map((event) => event.split(':')[0]), ['running', 'ended']);
});

test('draft request carries only the slug: extra args/options/env/path/agent values never reach the workflow', async () => {
  const { controller, workflow } = makeController();
  // A hostile request smuggling CLI-shaped values. The typed board boundary has
  // no fields for them; they exist only to prove the dispatch ignores them.
  const request = makeRequest({
    agent: 'opencode',
    payload: {
      kind: 'draft:create',
      args: ['task-2427', '--agent', 'codex'],
      options: { env: { WORKFLOW_AGENT: 'codex' } },
      worktreePath: '/tmp/smuggled-worktree',
      agent: 'codex',
    } as unknown as BoardCommandPayload,
  });
  const result = await controller.dispatch(request);

  assert.equal(result.status, 'completed');
  assert.equal(workflow.preflightArgs.length, 1, 'preflight ran exactly once');
  const seen = workflow.preflightArgs[0];
  assert.deepEqual(seen.args, ['task-2427'], 'only the envelope slug reaches argv');
  assert.deepEqual(seen.options, {}, 'no options bag reaches the workflow');
  const serialized = JSON.stringify(seen);
  for (const smuggled of ['opencode', 'WORKFLOW_AGENT', '/tmp/smuggled-worktree']) {
    assert.doesNotMatch(serialized, new RegExp(smuggled.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('executeForSlug is the typed entry: it forwards only the slug and empty options', async () => {
  const workflow = makeMockWorkflow();
  const useCase = new DraftCommandUseCase(workflow.port);
  await useCase.executeForSlug('task-2427');
  assert.deepEqual(workflow.preflightArgs, [{ args: ['task-2427'], options: {} }]);
});

// ---------------------------------------------------------------------------
// SC3: availability from authoritative state
// ---------------------------------------------------------------------------

test('canExecute(draft:create) is false unwired and true wired', () => {
  const unwired = new BoardCommandController(makeExecutePorts().ports, undefined, {});
  assert.equal(unwired.canExecute('draft:create'), false);
  const { controller } = makeController();
  assert.equal(controller.canExecute('draft:create'), true);
});

test('unwired controller returns the typed unavailable capability without touching mission authority', async () => {
  const { ports } = makeExecutePorts();
  const loadCalls: string[] = [];
  const controller = new BoardCommandController(ports, undefined, {}, undefined, {
    async load(id: string) { loadCalls.push(id); return { kind: 'found', mission: { status: 'backlog' }, version: 1 } as never; },
  });
  const result = await controller.dispatch(makeRequest());

  assert.equal(result.status, 'rejected');
  assert.equal(result.error?.kind, 'capability');
  assert.ok(result.error?.message.includes('draft:create'));
  assert.deepEqual(loadCalls, [], 'no database or git handle is opened on the unwired path');
});

test('non-draftable lifecycle states reject before the draft workflow port is called', async () => {
  for (const status of ['active', 'review', 'integration', 'done'] as const) {
    const { controller, workflow } = makeController({ status });
    // No drift: the request captured the mission's actual (non-backlog) state,
    // so the stale guard passes and the dispatch backstop must reject.
    const result = await controller.dispatch(makeRequest({ missionStatusAtRequest: status }));
    assert.equal(result.status, 'rejected', `${status}: rejected`);
    assert.equal(result.error?.kind, 'validation', `${status}: validation kind`);
    assert.ok(result.error?.message.includes(status), `${status}: message names the current state`);
    assert.deepEqual(workflow.steps, [], `${status}: zero workflow calls`);
  }
});

test('drift into a non-draftable state between request and dispatch is a stale conflict, never a draft', async () => {
  const { controller, workflow } = makeController({ status: 'active' });
  const result = await controller.dispatch(makeRequest({ missionStatusAtRequest: 'backlog' }));
  assert.equal(result.status, 'failed');
  assert.equal(result.error?.kind, 'conflict');
  assert.deepEqual(workflow.steps, [], 'zero workflow calls');
});

// ---------------------------------------------------------------------------
// SC4: aborts map to failure/rejection, never completed
// ---------------------------------------------------------------------------

test('preflight abort (unresolvable task) returns failure and publishes nothing', async () => {
  const workflow = makeMockWorkflow({
    preflight: (_args, _options) => makeCtx({ exited: true }),
  });
  const { controller, currentWork } = makeController({ workflow });
  const result = await controller.dispatch(makeRequest());

  assert.equal(result.status, 'failed');
  assert.notEqual(result.status, 'completed');
  assert.equal(result.error?.kind, 'execution');
  assert.ok(result.error?.message.includes('task-2427'));
  assert.deepEqual(currentWork.events, [], 'nothing was running, so nothing is published');
});

test('existing-worktree abort after launch publishes blocked and returns failure', async () => {
  const workflow = makeMockWorkflow({
    setup: (ctx: DraftWorkflowContext) => ({ ...ctx, exited: true }),
  });
  const { controller, currentWork } = makeController({ workflow });
  const result = await controller.dispatch(makeRequest());

  assert.equal(result.status, 'failed');
  assert.notEqual(result.status, 'completed');
  assert.equal(result.error?.kind, 'execution');
  assert.equal(currentWork.events.length, 2);
  assert.match(currentWork.events[0], /^running:task-2427$/);
  assert.match(currentWork.events[1], /^blocked:task-2427:/);
});

test('a thrown workflow abort (exit function throwing) maps to failure with blocked publication', async () => {
  const workflow = makeMockWorkflow({
    launchAgent: async (_ctx: DraftWorkflowContext) => { throw new Error('draft workflow aborted (exit 1)'); },
  });
  const { controller, currentWork } = makeController({ workflow });
  const result = await controller.dispatch(makeRequest());

  assert.equal(result.status, 'failed');
  assert.ok(result.error?.message.includes('draft workflow aborted (exit 1)'));
  assert.equal(currentWork.events[1], `blocked:task-2427:draft workflow aborted (exit 1)`);
});

test('DraftWorkflowAbortedError is the typed abort the use case throws', async () => {
  const workflow = makeMockWorkflow({
    scaffold: (ctx: DraftWorkflowContext) => ({ ...ctx, exited: true }) as DraftWorkflowContext,
  });
  const useCase = new DraftCommandUseCase(workflow.port);
  await assert.rejects(
    () => useCase.executeForSlug('task-2427'),
    (error: unknown) => error instanceof DraftWorkflowAbortedError && error.slug === 'task-2427',
  );
});
