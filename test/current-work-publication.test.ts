// Historical regression provenance: TASK-2373, TASK-2387.
/**
 * TASK-2370 CP-2 — the mission-scoped current-work authority and the
 * publication lifecycle around it.
 *
 * These tests pin the authority allocation the mission requires, in code
 * rather than prose:
 *
 *  - current work is recorded on the existing operational-history authority;
 *  - `AgentBlock` is untouched by publication, so family availability stays
 *    its own authority;
 *  - an automatic family handoff updates the *same* mission's current work
 *    instead of creating a second identity for the run;
 *  - the operations that keep the board busy (execute, handoff, review,
 *    review response, integration) each publish their own phase.
 *
 * Every port is an in-memory fake: no agent launch, no database, no Git.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { describe } from 'node:test';
import { setImmediate } from 'node:timers';
import { ConcreteCurrentWorkReadAdapter } from '../src/adapters/backlog/concrete-current-work-read-adapter.js';
import type { BoardCommandRequest } from '../src/application/controller/board-command.js';
import { BoardCommandController } from '../src/application/controller/board-controller.js';
import { makeExecutePorts } from './fixtures/execute-mission-ports.js';
import { ExecuteMissionService } from '../src/application/execute-mission-service.js';
import { IntegrateCommandUseCase } from '../src/application/integrate-command-use-case.js';
import type { ExecuteMissionPorts } from '../src/application/ports/execute-mission.js';
type HandoffReviewRequest = { onAgentLaunched?: (_agent: string, _phase: 'review' | 'review-response') => Promise<void>; onAutonomousStop?: (_reason: string) => Promise<void> };
import type { OperationalHistoryEntry } from '../src/application/ports/operation-history.js';
import type { ReviewWorkflowContext } from '../src/application/ports/review-workflow.js';
import { attentionReason } from '../src/application/projections/board.js';
import { reconcileCurrentWork, isWorkInProgress } from '../src/application/projections/current-work.js';
import { CURRENT_WORK_EVENT_TYPE, CurrentWorkRecorder, currentWorkEventToEntry, currentWorkPublication, parseCurrentWorkEntry, type AgentLaunchPhase } from '../src/application/recording/current-work-recorder.js';
import type { CurrentWorkPort } from '../src/application/recording/current-work-recorder.js';
import { ReviewCommandUseCase } from '../src/application/review-command-use-case.js';
import { composeProductionCapabilities } from '../src/composition/production-capabilities.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import { makeCard } from './fixtures/board-projection.js';
import { inMemoryOperationalHistory } from './fixtures/operational-history.js';

// ── Current-work publication ──


// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/** Parsed current-work facts in publication order. */
function published(appended: readonly OperationalHistoryEntry[]) {
  return appended.flatMap((entry) => parseCurrentWorkEntry(entry) ?? []);
}

function strictPorts(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const parts = {
    ...makeExecutePorts().ports,
    workspace: {
      async preflight() { return true; },
      async resolveWorktree() { return '/worktree'; },
      async resolveTaskFile() { return { ok: true, taskFile: '/worktree/task.md' }; },
      async readTaskStatus() { return 'active'; },
      async enforceCommitSafety() { calls.push('safety'); },
    },
    agentExecution: {
      async prepare() { return { prompt: 'execute prompt', agent: 'claude', agentConfig: {} }; },
      async launch() {
        calls.push('launch');
        return { agent: 'codex', rebaseDeferred: false, errored: false, errorMessage: null, exitStatus: 0, detail: null };
      },
    },
    missionTransitions: {
      async load() { return { kind: 'found' as const, version: 1, mission: {
        id: 'task-2370', repositoryId: 'repo', title: 'Fixture', labels: [], assignee: null,
        checkpoints: [{ missionId: 'task-2370', name: 'CP-1', firstLine: 'work', goalCheck: [], nextActionText: '' }],
        review: null, netEngineeringLines: null, brief: { goal: 'g', why: 'w', scope: 's', outOfScope: [] },
        declaredGates: ['npm test'], successCriteria: ['done'], predictedNelBucket: 'Small', status: 'refined' as const, closedAt: null,
      } }; },
      async save() { calls.push('lifecycle'); return 2; },
      async saveWithTransition() { calls.push('lifecycle'); return 2; },
    },
    telemetry: { async recordLaunchTelemetry() { calls.push('telemetry'); } },
    handoffExecution: { ...makeExecutePorts().ports.handoffExecution, async run() { calls.push('handoff'); return { ok: true }; } },
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
  const { repo, appended } = inMemoryOperationalHistory();
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
  const { repo, appended } = inMemoryOperationalHistory();
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
  const { repo, appended } = inMemoryOperationalHistory();
  // The launcher hits a usage block on claude and continues with qwen inside
  // the same call — exactly what startAgent's retry loop does today.
  const { ports } = strictPorts({
    agentExecution: {
      async prepare() { return { prompt: 'p', agentConfig: {} }; },
      async launch(request: { onAgentChanged?: (_agent: string) => Promise<void> }) {
        await request.onAgentChanged?.('claude');
        await request.onAgentChanged?.('qwen');
        return { agent: 'qwen', rebaseDeferred: false, errored: false, errorMessage: null, exitStatus: 0, detail: null };
      },
    },
  });

  const outcome = await new ExecuteMissionService(ports, undefined, new CurrentWorkRecorder(repo, { processId: 7 }))
    .execute(executeRequest());

  assert.equal(outcome.status, 'completed');
  const running = published(appended).filter((fact) => fact.state === 'running');
  assert.deepEqual(running.map((fact) => fact.agent), [null, 'claude', 'qwen', null]);
  assert.equal(new Set(published(appended).map((fact) => fact.missionId)).size, 1);
  assert.ok(
    published(appended).every((fact) => fact.state !== 'blocked'),
    'an autonomous handoff never publishes a blocked fact',
  );
});

test('an execute run that cannot finish publishes blocked work carrying the reason', async () => {
  const { repo, appended } = inMemoryOperationalHistory();
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

test('publishing current work remains isolated from the activation write', async () => {
  const { repo, appended } = inMemoryOperationalHistory();
  const { ports, calls } = strictPorts();
  await new ExecuteMissionService(ports, undefined, new CurrentWorkRecorder(repo, { processId: 7 })).execute(executeRequest());

  assert.ok(appended.every((entry) => entry.eventType === CURRENT_WORK_EVENT_TYPE));
  assert.deepEqual(calls, ['lifecycle', 'launch', 'safety', 'telemetry', 'handoff']);
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
    close: operation('close'),
    status: operation('status'),
    createEvent: operation('createEvent'),
    backfillReview: operation('backfillReview'),
    reconcileReview: operation('reconcileReview'),
    importLegacy: operation('importLegacy'),
  };
}

test('px review --start brackets the review loop with review-phase current work', async () => {
  const { repo, appended } = inMemoryOperationalHistory();
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
  const { repo, appended } = inMemoryOperationalHistory();
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

test('a short review read publishes no current work', async () => {
  const { repo, appended } = inMemoryOperationalHistory();
  const ran: string[] = [];
  await new ReviewCommandUseCase(makeReviewWorkflow(ran), new CurrentWorkRecorder(repo, { processId: 9 }))
    .execute(['task-2370', '--status']);

  assert.deepEqual(ran, ['status']);
  assert.deepEqual(appended, []);
});

test('a failing review operation stops claiming work and keeps its reason', async () => {
  const { repo, appended } = inMemoryOperationalHistory();
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
  const { repo, appended } = inMemoryOperationalHistory();
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
  const { repo, appended } = inMemoryOperationalHistory();
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

// ── Workflow current work follows launches — TASK-2373 (was task-2373-current-work-workflow.test.ts) ──
/**
 * TASK-2373 CP-2 — current work through the complete autonomous workflow.
 *
 * The workflow under test is the composed one, not isolated entry points:
 * `px active -> execute -> handoff -> autonomous review -> reviewer ->
 * implementer act-on-review -> further rounds`. Every assertion is about what
 * the board would show, so a publication that is written but never reconciled
 * into WORKING still fails.
 */
describe("Workflow current work follows launches —", () => {
  const SLUG = 'task-2373';
  const MISSION = missionId(SLUG);

  function published(appended: readonly OperationalHistoryEntry[]) {
    return appended.flatMap((entry) => parseCurrentWorkEntry(entry) ?? []);
  }

  /** What the board would show for the mission after the given publications. */
  function boardState(appended: readonly OperationalHistoryEntry[], nowMs = Date.now()) {
    const facts = reconcileCurrentWork(published(appended), { nowMs, ttlMs: 5 * 60_000, isProcessAlive: () => true })
      .get(MISSION) ?? { currentWork: null, blockingReason: null };
    return {
      working: isWorkInProgress(facts.currentWork),
      agent: facts.currentWork?.agent ?? null,
      phase: facts.currentWork?.phase ?? null,
      attention: attentionReason(makeCard({ currentWork: facts.currentWork, blockingReason: facts.blockingReason })).kind,
      blockingReason: facts.blockingReason,
    };
  }

  function strictPorts(overrides: Record<string, unknown> = {}) {
    const parts = {
      ...makeExecutePorts().ports,
      workspace: {
        async preflight() { return true; },
        async resolveWorktree() { return '/worktree'; },
        async resolveTaskFile() { return { ok: true, taskFile: '/worktree/task.md' }; },
        async readTaskStatus() { return 'active'; },
        async enforceCommitSafety() {},
      },
      agentExecution: {
        async prepare() { return { prompt: 'p', agentConfig: {} }; },
        async launch() {
          return { agent: 'claude', rebaseDeferred: false, errored: false, errorMessage: null, exitStatus: 0, detail: null };
        },
      },
      missionTransitions: {
        async load() { return { kind: 'found' as const, version: 1, mission: { id: SLUG, repositoryId: 'repo', title: 'Fixture', labels: [], assignee: null, checkpoints: [{ missionId: SLUG, name: 'CP-1', firstLine: 'work', goalCheck: [], nextActionText: '' }], review: null, netEngineeringLines: null, brief: { goal: 'g', why: 'w', scope: 's', outOfScope: [] }, declaredGates: ['npm test'], successCriteria: ['done'], predictedNelBucket: 'Small', status: 'refined' as const, closedAt: null } }; },
        async save() { return 2; },
        async saveWithTransition() { return 2; },
      },
      telemetry: { async recordLaunchTelemetry() {} },
      autonomousReview: { async start() { return true; } },
    };
    return { ...parts, ...overrides } as unknown as ExecuteMissionPorts;
  }

  function executeRequest() {
    return {
      operationId: `active:${SLUG}`,
      slug: SLUG,
      agent: 'claude',
      capabilities: new Set(['active:execute'] as const),
    } as never;
  }

  /** A handoff/review port that replays a scripted sequence of agent launches. */
  function scriptedReviewLoop(rounds: readonly (readonly [string, AgentLaunchPhase])[], observe?: () => void) {
    return {
      async start(request: HandoffReviewRequest) {
        for (const [agent, phase] of rounds) {
          await request.onAgentLaunched?.(agent, phase);
          observe?.();
        }
        return true;
      },
    };
  }

  // ---------------------------------------------------------------------------
  // SC2, SC3 — current work follows the review loop, not the original handoff
  // ---------------------------------------------------------------------------

  test('SC2: current work follows reviewer and implementer launches after handoff instead of the original implementer', async () => {
    const { repo, appended } = inMemoryOperationalHistory({ assignIds: true });
    const observed: { agent: string | null; phase: string | null; working: boolean }[] = [];
    const ports = strictPorts({
      autonomousReview: scriptedReviewLoop(
        [['qwen', 'review'], ['claude', 'review-response'], ['codex', 'review']],
        () => {
          const state = boardState(appended);
          observed.push({ agent: state.agent, phase: state.phase, working: state.working });
        },
      ),
    });

    const outcome = await new ExecuteMissionService(ports, undefined, new CurrentWorkRecorder(repo, { processId: 7 }))
      .execute(executeRequest());

    assert.equal(outcome.status, 'completed');
    assert.deepEqual(observed, [
      { agent: 'qwen', phase: 'review', working: true },
      { agent: 'claude', phase: 'review-response', working: true },
      { agent: 'codex', phase: 'review', working: true },
    ]);
  });

  test('SC3: reviewer launches publish a review phase and implementer launches publish review-response', async () => {
    const { repo, appended } = inMemoryOperationalHistory({ assignIds: true });
    const ports = strictPorts({
      autonomousReview: scriptedReviewLoop([['qwen', 'review'], ['claude', 'review-response']]),
    });
    await new ExecuteMissionService(ports, undefined, new CurrentWorkRecorder(repo, { processId: 7 })).execute(executeRequest());

    assert.deepEqual(
      published(appended)
        .filter((fact) => fact.phase === 'review' || fact.phase === 'review-response')
        .map((fact) => [fact.phase, fact.agent, fact.state]),
      [['review', 'qwen', 'running'], ['review-response', 'claude', 'running']],
    );
  });

  test('SC4: three consecutive review rounds each update the same mission current work', async () => {
    const { repo, appended } = inMemoryOperationalHistory({ assignIds: true });
    const seen: (string | null)[] = [];
    const ports = strictPorts({
      autonomousReview: scriptedReviewLoop(
        [
          ['qwen', 'review'], ['claude', 'review-response'],
          ['codex', 'review'], ['claude', 'review-response'],
          ['gemini', 'review'], ['claude', 'review-response'],
        ],
        () => { seen.push(`${boardState(appended).phase}:${boardState(appended).agent}`); },
      ),
    });
    await new ExecuteMissionService(ports, undefined, new CurrentWorkRecorder(repo, { processId: 7 })).execute(executeRequest());

    assert.deepEqual(seen, [
      'review:qwen', 'review-response:claude',
      'review:codex', 'review-response:claude',
      'review:gemini', 'review-response:claude',
    ]);
    assert.equal(new Set(published(appended).map((fact) => fact.missionId)).size, 1, 'every round stays one mission');
  });

  // ---------------------------------------------------------------------------
  // SC5 — one shared publication seam
  // ---------------------------------------------------------------------------

  test('SC5: px review and px active publish nested review work through one seam', async () => {
    // Behavioural half: both entry points produce the same fact for the same launch.
    const viaActive = inMemoryOperationalHistory({ assignIds: true });
    await new ExecuteMissionService(
      strictPorts({ autonomousReview: scriptedReviewLoop([['qwen', 'review']]) }),
      undefined,
      new CurrentWorkRecorder(viaActive.repo, { processId: 7 }),
    ).execute(executeRequest());

    const viaReview = inMemoryOperationalHistory({ assignIds: true });
    const operation = () => async () => {};
    await new ReviewCommandUseCase({
      preflight: (args: string[]) => ({ slug: SLUG, args, options: {} }),
      verify: operation(), submit: operation(), push: operation(),
      start: async (context: ReviewWorkflowContext) => {
        await (context.options.onAgentLaunched as (_agent: string, _phase: AgentLaunchPhase) => Promise<void>)('qwen', 'review');
      },
      continue: operation(), resume: operation(), comment: operation(), readComments: operation(),
      submitReview: operation(), close: operation(),
      status: operation(), createEvent: operation(), backfillReview: operation(),
      reconcileReview: operation(), importLegacy: operation(),
    }, new CurrentWorkRecorder(viaReview.repo, { processId: 7 })).execute([SLUG, '--start']);

    const launchFact = (entries: readonly OperationalHistoryEntry[]) =>
      published(entries).filter((fact) => fact.agent === 'qwen').map((fact) => [fact.phase, fact.agent, fact.summary]);
    assert.deepEqual(launchFact(viaActive.appended), launchFact(viaReview.appended));

    // Structural half: exactly one call site each, and no consumer infers it.
    const callers = [
      'src/application/execute-mission-service.ts',
      'src/application/review-command-use-case.ts',
    ];
    for (const file of callers) {
      const source = readFileSync(file, 'utf8');
      assert.equal(
        source.split('reviewLoopPublisher(').length - 1, 1,
        `${file} must build the publication seam exactly once`,
      );
    }
    for (const consumer of [
      'src/application/projections/board-readers.ts',
      'src/application/projections/board.ts',
      'src/interfaces/tui/shell.tsx',
      'src/interfaces/tui/ui-command.ts',
    ]) {
      assert.doesNotMatch(
        readFileSync(consumer, 'utf8'),
        /review-response|reviewLoopPublisher/,
        `${consumer} must not infer review-runtime state; publication happens at the source`,
      );
    }
  });

  // ---------------------------------------------------------------------------
  // SC6, SC7 — failover stays WORKING, and its write is ordered
  // ---------------------------------------------------------------------------

  test('SC6: claude blocked by usage limits and replaced by qwen keeps the mission WORKING throughout', async () => {
    const { repo, appended } = inMemoryOperationalHistory({ assignIds: true });
    const timeline: { agent: string | null; working: boolean; attention: string }[] = [];
    const ports = strictPorts({
      agentExecution: {
        async prepare() { return { prompt: 'p', agentConfig: {} }; },
        async launch(request: { onAgentChanged?: (_agent: string) => Promise<void> }) {
          await request.onAgentChanged?.('claude');
          timeline.push(boardState(appended));
          // claude hits its usage limit; the launcher continues with qwen inside
          // the same operation.
          await request.onAgentChanged?.('qwen');
          timeline.push(boardState(appended));
          return { agent: 'qwen', rebaseDeferred: false, errored: false, errorMessage: null, exitStatus: 0, detail: null };
        },
      },
      autonomousReview: scriptedReviewLoop([['qwen', 'review']], () => { timeline.push(boardState(appended)); }),
    });

    const outcome = await new ExecuteMissionService(ports, undefined, new CurrentWorkRecorder(repo, { processId: 7 }))
      .execute(executeRequest());

    assert.equal(outcome.status, 'completed');
    assert.deepEqual(timeline.map((state) => state.agent), ['claude', 'qwen', 'qwen']);
    assert.ok(timeline.every((state) => state.working), 'a recoverable family failover never leaves WORKING');
    assert.ok(timeline.every((state) => state.attention === 'none'), 'a recoverable family failover creates no attention');
  });

  test('SC7: a delayed current-work publication lands before the next state is read', async () => {
    const { repo, appended } = inMemoryOperationalHistory({ assignIds: true });
    const slowRecorder = new CurrentWorkRecorder(repo, { processId: 7 });
    const delayed = {
      async running(publication: Parameters<CurrentWorkRecorder['running']>[0]) {
        // Defer to the next event-loop turn so a missing await remains visible,
        // without a fixed timer delay. A resolved promise can complete before
        // the caller observes the board even when publication is not awaited.
        await new Promise<void>((resolve) => setImmediate(resolve));
        await slowRecorder.running(publication);
      },
      blocked: slowRecorder.blocked.bind(slowRecorder),
      ended: slowRecorder.ended.bind(slowRecorder),
    };

    let stateAfterLaunch = boardState(appended);
    const ports = strictPorts({
      agentExecution: {
        async prepare() { return { prompt: 'p', agentConfig: {} }; },
        async launch(request: { onAgentChanged?: (_agent: string) => Promise<void> }) {
          await request.onAgentChanged?.('qwen');
          stateAfterLaunch = boardState(appended);
          return { agent: 'qwen', rebaseDeferred: false, errored: false, errorMessage: null, exitStatus: 0, detail: null };
        },
      },
    });

    await new ExecuteMissionService(ports, undefined, delayed).execute(executeRequest());
    assert.equal(stateAfterLaunch.agent, 'qwen', 'the failover write is awaited, not fire-and-forget');
  });
});

// ── Board-launched current work — TASK-2387 (was task-2387-board-current-work.test.ts) ──
describe("Board-launched current work —", () => {
  const CURRENT_WORK_TTL_MS = 5 * 60 * 1000;

  function boardRequest(overrides: Record<string, unknown> = {}): BoardCommandRequest {
    return {
      operationId: 'active:task-2387',
      kind: 'active:execute',
      missionId: 'task-2387',
      missionStatusAtRequest: 'refined',
      agent: 'codex',
      capabilities: new Set(['active:execute']),
      cancellation: { requested: false },
      ...overrides,
    } as BoardCommandRequest;
  }

  /** A CurrentWorkPort that records every call for assertions. */
  function spyCurrentWork(): CurrentWorkPort & { calls: Array<{ phase: string; state: string }> } {
    const calls: Array<{ phase: string; state: string }> = [];
    return {
      calls,
      async running(publication) { calls.push({ phase: publication.phase, state: 'running' }); },
      async blocked(publication) { calls.push({ phase: publication.phase, state: 'blocked' }); },
      async ended(publication) { calls.push({ phase: publication.phase, state: 'ended' }); },
    };
  }

  // ---------------------------------------------------------------------------
  // SC1 + SC2(completion): running then ended through the real controller
  // ---------------------------------------------------------------------------

  test('board active:execute publishes running and ended current work', async () => {
    const { ports } = makeExecutePorts();
    const spy = spyCurrentWork();
    const controller = new BoardCommandController(ports, undefined, undefined, spy);

    const result = await controller.dispatch(boardRequest());

    assert.equal(result.status, 'completed');
    assert.ok(spy.calls.some((call) => call.phase === 'execute' && call.state === 'running'), 'launch publishes running');
    assert.ok(spy.calls.some((call) => call.phase === 'execute' && call.state === 'ended'), 'completion publishes ended');
  });

  // ---------------------------------------------------------------------------
  // SC2(failure): a launch that cannot finish publishes blocked with its reason
  // ---------------------------------------------------------------------------

  test('a board execute that cannot finish publishes blocked carrying the reason', async () => {
    const { ports } = makeExecutePorts({
      agentExecution: {
        async prepare() { return { prompt: 'p', agentConfig: {} }; },
        async launch() {
          return { agent: 'codex', rebaseDeferred: false, errored: true, errorMessage: 'all eligible agents are exhausted', exitStatus: null, detail: null };
        },
      },
    });
    const spy = spyCurrentWork();
    const controller = new BoardCommandController(ports, undefined, undefined, spy);

    const result = await controller.dispatch(boardRequest());

    assert.equal(result.status, 'failed');
    const blocked = spy.calls.find((call) => call.state === 'blocked');
    assert.ok(blocked, 'a blocked fact is published');
    assert.equal(blocked?.phase, 'execute');
  });

  // ---------------------------------------------------------------------------
  // SC2(cancellation): a cancellation observed after the durable launch records ended
  // ---------------------------------------------------------------------------

  test('a board cancellation observed after the durable launch publishes ended', async () => {
    const cancellation = { requested: false };
    const { ports } = makeExecutePorts({
      agentExecution: {
        async prepare() { return { prompt: 'p', agentConfig: {} }; },
        async launch() {
          // Flip the cancellation after the durable launch so execute() reaches
          // the post-record cancellation boundary and publishes `ended`.
          cancellation.requested = true;
          return { agent: 'codex', rebaseDeferred: false, errored: false, errorMessage: null, exitStatus: 0, detail: null };
        },
      },
    });
    const spy = spyCurrentWork();
    const controller = new BoardCommandController(ports, undefined, undefined, spy);

    const result = await controller.dispatch(boardRequest({ cancellation }));

    assert.equal(result.status, 'cancelled');
    assert.ok(spy.calls.some((call) => call.phase === 'execute' && call.state === 'ended'), 'cancellation after launch publishes ended');
  });

  // ---------------------------------------------------------------------------
  // SC3: production composition wires the real recorder, never the no-op default
  // ---------------------------------------------------------------------------

  test('production composition delivers a board controller that publishes to the wired recorder', async () => {
    const { ports } = makeExecutePorts();
    const { repo } = inMemoryOperationalHistory();
    const recorder = new CurrentWorkRecorder(repo, { processId: 2387 });
    const missionStore = {
      async load() { return { kind: 'found', mission: { status: 'refined' }, version: 1 }; },
    };

    // Built via a typed const so the repository fakes are structurally checked
    // against their interfaces rather than flagged for extra test-only methods.
    const repositories = {
      agentBlocklist: { async findAll() { return []; }, async findByAgent() { return undefined; }, async save() {}, async deleteByAgent() {}, async clear() {} },
      operationalHistory: { async findAll() { return []; }, async findByType() { return []; }, async append() {}, async clear() {} },
      boardLaneEvents: { async findAll() { return []; }, async findByMissionId() { return []; }, async findByRepositoryId() { return []; }, async append() { return true; }, async clear() {} },
      usage: { async findAll() { return []; }, async findWhere() { return []; }, async save() {}, async saveAll() {}, async clear() {} },
    };

    const capabilities = composeProductionCapabilities(
      '/fixture-repository',
      repositoryId('/fixture-repository'),
      repositories,
      ports,
      missionStore as never,
      recorder,
    );

    // The factory delivered by the production composition forwards the same
    // recorder composition received: a completed board launch publishes through it.
    const progressEvents: string[] = [];
    const result = await capabilities.tui.commandControllerFactory((event) => progressEvents.push(event.phase)).dispatch(boardRequest());
    assert.equal(result.status, 'completed');
    assert.ok(progressEvents.includes('dispatch'), 'the TUI progress sink receives controller events');

    const events = await new ConcreteCurrentWorkReadAdapter(repo).loadCurrentWork();
    // loadCurrentWork already parses the events into CurrentWorkEvent facts.
    const states = events.map((event) => event.state);
    // The production recorder is the value composition received: a completed board
    // launch writes running/ended facts to the operational-history authority it owns.
    assert.ok(states.includes('running'), 'the production recorder received a running fact');
    assert.ok(states.includes('ended'), 'the production recorder received an ended fact');
    assert.equal(events.length, 3, 'a completed launch publishes running, running, ended');
  });

  // ---------------------------------------------------------------------------
  // SC4: the WORKING projection sees a live board launch and clears on a terminal state
  // ---------------------------------------------------------------------------

  test('a board-launched agent surfaces in the WORKING projection and clears on completion', async () => {
    const { repo } = inMemoryOperationalHistory();
    const recorder = new CurrentWorkRecorder(repo, { processId: 999 });
    const controller = new BoardCommandController(makeExecutePorts().ports, undefined, {}, recorder);

    // A live launch lands a running fact; the projection grades it WORKING.
    await recorder.running({
      missionId: missionId('task-2387'),
      operationId: 'active:task-2387',
      phase: 'execute',
      summary: 'running execute agent',
      agent: agentFamily('codex'),
    });
    const working = await reconcileCurrentWork(
      await new ConcreteCurrentWorkReadAdapter(repo).loadCurrentWork(),
      { nowMs: Date.now(), ttlMs: CURRENT_WORK_TTL_MS },
    );
    const workingFact = working.get(missionId('task-2387'));
    assert.ok(isWorkInProgress(workingFact?.currentWork), 'a live launch surfaces as WORKING');

    // A completed board launch through the real controller brackets itself with an
    // ended fact, clearing the standing WORKING fact.
    const result = await controller.dispatch(boardRequest());
    assert.equal(result.status, 'completed');

    const cleared = await reconcileCurrentWork(
      await new ConcreteCurrentWorkReadAdapter(repo).loadCurrentWork(),
      { nowMs: Date.now(), ttlMs: CURRENT_WORK_TTL_MS },
    );
    const clearedFact = cleared.get(missionId('task-2387'));
    assert.equal(clearedFact?.currentWork, null, 'an ended fact clears the WORKING projection');
    assert.equal(isWorkInProgress(clearedFact?.currentWork), false, 'a cleared fact is not in progress');
  });

  test('a blocked board launch records a blocking reason in the projection', async () => {
    const { repo } = inMemoryOperationalHistory();
    const controller = new BoardCommandController(
      makeExecutePorts({
        agentExecution: {
          async prepare() { return { prompt: 'p', agentConfig: {} }; },
          async launch() {
            return { agent: 'codex', rebaseDeferred: false, errored: true, errorMessage: 'no eligible agent family', exitStatus: null, detail: null };
          },
        },
      }).ports,
      undefined,
      {},
      new CurrentWorkRecorder(repo, { processId: 1000 }),
    );

    const result = await controller.dispatch(boardRequest());
    assert.equal(result.status, 'failed');

    const facts = await reconcileCurrentWork(
      await new ConcreteCurrentWorkReadAdapter(repo).loadCurrentWork(),
      { nowMs: Date.now(), ttlMs: CURRENT_WORK_TTL_MS },
    );
    const fact = facts.get(missionId('task-2387'));
    assert.equal(fact?.currentWork, null, 'a blocked run is no longer WORKING');
    assert.match(fact?.blockingReason ?? '', /no eligible agent family/);
  });

  // ---------------------------------------------------------------------------
  // Regression: the no-op default still records nothing (read-only shell)
  // ---------------------------------------------------------------------------

  test('the no-op default records no current work', async () => {
    const { ports } = makeExecutePorts();
    const { repo } = inMemoryOperationalHistory();
    // No current-work argument supplied: the controller falls back to the
    // NO_CURRENT_WORK_PORT default for read-only shells and test fixtures.
    const controller = new BoardCommandController(ports);

    await controller.dispatch(boardRequest());

    const events = await new ConcreteCurrentWorkReadAdapter(repo).loadCurrentWork();
    assert.equal(events.length, 0, 'a launched agent publishes nothing when the recorder is the no-op default');
  });
});
