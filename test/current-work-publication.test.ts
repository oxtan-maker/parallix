/**
 * TASK-2370 CP-2 — the mission-scoped current-work authority and the
 * publication lifecycle around it.
 *
 * These tests pin the authority allocation the mission requires, in code
 * rather than prose:
 *
 *  - current work is recorded on the existing operational-history authority
 *    and nowhere else — no Mission write, no lane event, no session marker;
 *  - `AgentBlock` is untouched by publication, so family availability stays
 *    its own authority;
 *  - an automatic family handoff updates the *same* mission's current work
 *    instead of creating a second identity for the run;
 *  - the operations that keep the board busy (execute, handoff, review,
 *    review response, integration) each publish their own phase.
 *
 * Every port is an in-memory fake: no agent launch, no database, no Git.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { ExecuteMissionService } from '../src/application/execute-mission-service.js';
import type { ExecuteMissionPorts } from '../src/application/ports/execute-mission.js';
import type { ReviewWorkflowContext } from '../src/application/ports/review-workflow.js';
import { ReviewCommandUseCase } from '../src/application/review-command-use-case.js';
import { IntegrateCommandUseCase } from '../src/application/integrate-command-use-case.js';
import {
  CURRENT_WORK_EVENT_TYPE,
  CurrentWorkRecorder,
  currentWorkEventToEntry,
  currentWorkPublication,
  parseCurrentWorkEntry,
} from '../src/application/recording/current-work-recorder.js';
import type { OperationalHistoryEntry, OperationalHistoryRepository } from '../src/application/ports/operation-history.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId } from '../src/domain/mission.js';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** The only storage authority publication is allowed to touch. */
function makeHistoryRepo() {
  const appended: OperationalHistoryEntry[] = [];
  const repo: OperationalHistoryRepository = {
    async findAll() { return appended; },
    async findByType(type: string) { return appended.filter((entry) => entry.eventType === type); },
    async append(entry: OperationalHistoryEntry) { appended.push(entry); },
    async clear() { appended.length = 0; },
  };
  return { repo, appended };
}

/** Parsed current-work facts in publication order. */
function published(appended: readonly OperationalHistoryEntry[]) {
  return appended.flatMap((entry) => parseCurrentWorkEntry(entry) ?? []);
}

function strictPorts(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const parts = {
    workspace: {
      async preflight() { return true; },
      async resolveWorktree() { return '/worktree'; },
      async resolveTaskFile() { return { ok: true, taskFile: '/worktree/task.md' }; },
      async readTaskStatus() { return 'active'; },
      async enforceCommitSafety() { calls.push('safety'); },
    },
    agentExecution: {
      async prepare() { return { prompt: 'execute prompt', agentConfig: {} }; },
      async launch() {
        calls.push('launch');
        return { agent: 'codex', rebaseDeferred: false, errored: false, errorMessage: null, exitStatus: 0, detail: null };
      },
    },
    missionTransitions: {
      async load() { throw new Error('lifecycle must not be touched by publication'); },
      async save() { throw new Error('lifecycle must not be touched by publication'); },
      async saveWithTransition() { throw new Error('lifecycle must not be touched by publication'); },
    },
    telemetry: { async recordLaunchTelemetry() { calls.push('telemetry'); } },
    handoffReview: { async runHandoffAndReview() { calls.push('handoff'); return true; } },
  };
  return { ports: { ...parts, ...overrides } as unknown as ExecuteMissionPorts, calls };
}

function executeRequest(overrides: Record<string, unknown> = {}) {
  return {
    operationId: 'active:task-2370',
    slug: 'task-2370',
    agent: 'claude',
    capabilities: new Set(['active:execute'] as const),
    ...overrides,
  } as never;
}

// ---------------------------------------------------------------------------
// The recorded fact itself
// ---------------------------------------------------------------------------

test('a recorded current-work fact round-trips through the operational-history entry', async () => {
  const { repo, appended } = makeHistoryRepo();
  const recorder = new CurrentWorkRecorder(repo, { processId: 4242, now: () => new Date('2026-08-13T10:00:00.000Z') });

  await recorder.running({
    missionId: missionId('task-2370'),
    operationId: 'active:task-2370',
    phase: 'execute',
    summary: 'running execute agent',
    agent: agentFamily('claude'),
  });

  assert.equal(appended.length, 1);
  assert.equal(appended[0].eventType, CURRENT_WORK_EVENT_TYPE);
  assert.deepEqual(parseCurrentWorkEntry(appended[0]), {
    missionId: 'task-2370',
    operationId: 'active:task-2370',
    phase: 'execute',
    state: 'running',
    summary: 'running execute agent',
    agent: 'claude',
    processId: 4242,
    processIdentity: null,
    blockedReason: null,
    occurredAt: '2026-08-13T10:00:00.000Z',
    // No durable order yet: the entry has not been through the store.
    sequence: undefined,
  });
});

test('a stored entry of another event type is never read as current work', () => {
  assert.equal(parseCurrentWorkEntry({
    eventType: 'mission.activate',
    eventData: JSON.stringify({ missionId: 'task-2370', phase: 'execute', state: 'running' }),
    createdAt: '2026-08-13T10:00:00.000Z',
  }), null);
});

test('a malformed current-work payload is dropped rather than treated as running work', () => {
  assert.equal(parseCurrentWorkEntry({
    eventType: CURRENT_WORK_EVENT_TYPE,
    eventData: 'not json',
    createdAt: '2026-08-13T10:00:00.000Z',
  }), null);
  assert.equal(parseCurrentWorkEntry(currentWorkEventToEntry({
    missionId: missionId('task-2370'),
    operationId: 'op',
    phase: 'execute',
    state: 'running',
    summary: '',
    agent: null,
    processId: null,
    blockedReason: null,
    occurredAt: '2026-08-13T10:00:00.000Z',
  }))?.state, 'running');
});

test('publication of a non-mission slug is skipped instead of throwing into the command', () => {
  assert.equal(currentWorkPublication({ slug: 'notaslug', operationId: 'op', phase: 'execute', summary: 's' }), null);
  assert.equal(
    currentWorkPublication({ slug: 'task-2370', operationId: 'op', phase: 'execute', summary: 's', agent: 'Not A Family' })?.agent,
    null,
  );
});

// ---------------------------------------------------------------------------
// Execute: launch, family handoff, handoff phase, completion
// ---------------------------------------------------------------------------

test('an execute run publishes execute work, then handoff work, then clears it', async () => {
  const { repo, appended } = makeHistoryRepo();
  const { ports } = strictPorts();
  const outcome = await new ExecuteMissionService(ports, undefined, new CurrentWorkRecorder(repo, { processId: 7 }))
    .execute(executeRequest());

  assert.equal(outcome.status, 'completed');
  const facts = published(appended);
  assert.deepEqual(facts.map((fact) => [fact.phase, fact.state]), [
    ['execute', 'running'],
    ['handoff', 'running'],
    ['execute', 'ended'],
  ]);
  assert.ok(facts.every((fact) => fact.missionId === 'task-2370'), 'every fact belongs to the same mission');
  assert.ok(facts.every((fact) => fact.processId === 7), 'each fact names the publishing process for reconciliation');
});

test('an automatic family handoff updates the same mission current work and creates no second identity', async () => {
  const { repo, appended } = makeHistoryRepo();
  // The launcher hits a usage block on claude and continues with qwen inside
  // the same call — exactly what startAgent's retry loop does today.
  const { ports } = strictPorts({
    agentExecution: {
      async prepare() { return { prompt: 'p', agentConfig: {} }; },
      async launch(request: { onAgentChanged?: (_agent: string) => void }) {
        request.onAgentChanged?.('claude');
        request.onAgentChanged?.('qwen');
        return { agent: 'qwen', rebaseDeferred: false, errored: false, errorMessage: null, exitStatus: 0, detail: null };
      },
    },
  });

  const outcome = await new ExecuteMissionService(ports, undefined, new CurrentWorkRecorder(repo, { processId: 7 }))
    .execute(executeRequest());

  assert.equal(outcome.status, 'completed');
  const running = published(appended).filter((fact) => fact.state === 'running');
  assert.deepEqual(running.map((fact) => fact.agent), ['claude', 'claude', 'qwen', 'qwen']);
  assert.equal(new Set(published(appended).map((fact) => fact.missionId)).size, 1);
  assert.ok(
    published(appended).every((fact) => fact.state !== 'blocked'),
    'an autonomous handoff never publishes a blocked fact',
  );
});

test('an execute run that cannot finish publishes blocked work carrying the reason', async () => {
  const { repo, appended } = makeHistoryRepo();
  const { ports } = strictPorts({
    agentExecution: {
      async prepare() { return { prompt: 'p', agentConfig: {} }; },
      async launch() {
        return { agent: 'claude', rebaseDeferred: false, errored: true, errorMessage: 'all eligible agents are exhausted', exitStatus: null, detail: null };
      },
    },
  });

  const outcome = await new ExecuteMissionService(ports, undefined, new CurrentWorkRecorder(repo, { processId: 7 }))
    .execute(executeRequest());

  assert.equal(outcome.status, 'failed');
  const last = published(appended).at(-1);
  assert.equal(last?.state, 'blocked');
  assert.match(String(last?.blockedReason), /all eligible agents are exhausted/);
});

test('a recorder outage never turns a completed execute run into a failure', async () => {
  const { ports } = strictPorts();
  const brokenRecorder = {
    async running() { throw new Error('database is locked'); },
    async blocked() { throw new Error('database is locked'); },
    async ended() { throw new Error('database is locked'); },
  };

  const outcome = await new ExecuteMissionService(ports, undefined, brokenRecorder).execute(executeRequest());
  assert.equal(outcome.status, 'completed');
});

// ---------------------------------------------------------------------------
// Authority separation
// ---------------------------------------------------------------------------

test('publishing current work writes only operational history and touches no other authority', async () => {
  const { repo, appended } = makeHistoryRepo();
  const { ports, calls } = strictPorts();
  // `missionTransitions` throws on any call, so a lifecycle write would fail
  // this test rather than pass silently.
  await new ExecuteMissionService(ports, undefined, new CurrentWorkRecorder(repo, { processId: 7 })).execute(executeRequest());

  assert.ok(appended.every((entry) => entry.eventType === CURRENT_WORK_EVENT_TYPE));
  assert.deepEqual(calls, ['launch', 'safety', 'telemetry', 'handoff']);
});

// ---------------------------------------------------------------------------
// Review and review response
// ---------------------------------------------------------------------------

function makeReviewWorkflow(ran: string[]) {
  const operation = (name: string) => async () => { ran.push(name); };
  return {
    preflight: (args: string[]) => ({ slug: 'task-2370', args, options: {} }),
    verify: operation('verify'),
    submit: operation('submit'),
    push: operation('push'),
    start: operation('start'),
    continue: operation('continue'),
    resume: operation('resume'),
    comment: operation('comment'),
    readComments: operation('readComments'),
    submitReview: operation('submitReview'),
    consumeArtifacts: operation('consumeArtifacts'),
    close: operation('close'),
    status: operation('status'),
    createEvent: operation('createEvent'),
    backfillReview: operation('backfillReview'),
    reconcileReview: operation('reconcileReview'),
    importLegacy: operation('importLegacy'),
  };
}

test('px review --start brackets the review loop with review-phase current work', async () => {
  const { repo, appended } = makeHistoryRepo();
  const ran: string[] = [];
  await new ReviewCommandUseCase(makeReviewWorkflow(ran), new CurrentWorkRecorder(repo, { processId: 9 }))
    .execute(['task-2370', '--start']);

  assert.deepEqual(ran, ['start']);
  assert.deepEqual(published(appended).map((fact) => [fact.phase, fact.state]), [
    ['review', 'running'],
    ['review', 'ended'],
  ]);
});

test('px review republishes current work with the family that actually launched', async () => {
  const { repo, appended } = makeHistoryRepo();
  const workflow = {
    ...makeReviewWorkflow([]),
    start: async (context) => {
      await (context as any).options.onAgentLaunched('custom', 'review');
    },
  };
  await new ReviewCommandUseCase(workflow, new CurrentWorkRecorder(repo, { processId: 9 }))
    .execute(['task-2370', '--start']);

  assert.deepEqual(published(appended).map((fact) => [fact.phase, fact.agent, fact.state]), [
    ['review', null, 'running'],
    ['review', 'custom', 'running'],
    ['review', null, 'ended'],
  ]);
});

test('px review --consume-artifacts publishes the review-response phase', async () => {
  const { repo, appended } = makeHistoryRepo();
  const ran: string[] = [];
  await new ReviewCommandUseCase(makeReviewWorkflow(ran), new CurrentWorkRecorder(repo, { processId: 9 }))
    .execute(['task-2370', '--consume-artifacts']);

  assert.deepEqual(ran, ['consumeArtifacts']);
  assert.deepEqual(published(appended).map((fact) => fact.phase), ['review-response', 'review-response']);
});

test('a short review read publishes no current work', async () => {
  const { repo, appended } = makeHistoryRepo();
  const ran: string[] = [];
  await new ReviewCommandUseCase(makeReviewWorkflow(ran), new CurrentWorkRecorder(repo, { processId: 9 }))
    .execute(['task-2370', '--status']);

  assert.deepEqual(ran, ['status']);
  assert.deepEqual(appended, []);
});

test('a failing review operation stops claiming work and keeps its reason', async () => {
  const { repo, appended } = makeHistoryRepo();
  const workflow = {
    ...makeReviewWorkflow([]),
    start: async () => { throw new Error('review loop failed'); },
  };
  await assert.rejects(
    new ReviewCommandUseCase(workflow, new CurrentWorkRecorder(repo, { processId: 9 })).execute(['task-2370', '--start']),
    /review loop failed/,
  );
  // The mission stops being WORKING either way; publishing `blocked` keeps the
  // sentence that explains why an operator is now needed (TASK-2373 SC10).
  const last = published(appended).at(-1);
  assert.equal(last?.state, 'blocked');
  assert.match(String(last?.blockedReason), /review loop failed/);
});

// ---------------------------------------------------------------------------
// Integration
// ---------------------------------------------------------------------------

test('px integrate brackets the run with integrate-phase current work', async () => {
  const { repo, appended } = makeHistoryRepo();
  let ran = 0;
  const outcome = await new IntegrateCommandUseCase(
    { execute: async () => { ran += 1; return 'merged'; } },
    new CurrentWorkRecorder(repo, { processId: 11 }),
  ).execute(['task-2370']);

  assert.equal(ran, 1);
  assert.equal(outcome, 'merged');
  assert.deepEqual(published(appended).map((fact) => [fact.phase, fact.state]), [
    ['integrate', 'running'],
    ['integrate', 'ended'],
  ]);
});

test('px integrate without a slug publishes for the adapter-inferred mission', async () => {
  const { repo, appended } = makeHistoryRepo();
  let ran = 0;
  await new IntegrateCommandUseCase(
    { execute: async () => { ran += 1; return null; } },
    new CurrentWorkRecorder(repo, { processId: 11 }),
    () => 'task-2370',
  ).execute(['--dry-run']);

  assert.equal(ran, 1);
  assert.deepEqual(published(appended).map((fact) => [fact.missionId, fact.phase, fact.state]), [
    ['task-2370', 'integrate', 'running'],
    ['task-2370', 'integrate', 'ended'],
  ]);
});
