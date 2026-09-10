/**
 * TASK-2373 CP-2 — current work through the complete autonomous workflow.
 *
 * The workflow under test is the composed one, not isolated entry points:
 * `px active -> execute -> handoff -> autonomous review -> reviewer ->
 * implementer act-on-review -> further rounds`. Every assertion is about what
 * the board would show, so a publication that is written but never reconciled
 * into WORKING still fails.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { ExecuteMissionService } from '../src/application/execute-mission-service.js';
import type { ExecuteMissionPorts, HandoffReviewRequest } from '../src/application/ports/execute-mission.js';
import { ReviewCommandUseCase } from '../src/application/review-command-use-case.js';
import type { ReviewWorkflowContext } from '../src/application/ports/review-workflow.js';
import {
  CurrentWorkRecorder,
  parseCurrentWorkEntry,
  type AgentLaunchPhase,
} from '../src/application/recording/current-work-recorder.js';
import type { OperationalHistoryEntry, OperationalHistoryRepository } from '../src/application/ports/operation-history.js';
import { reconcileCurrentWork, isWorkInProgress } from '../src/application/projections/current-work.js';
import { attentionReason } from '../src/application/projections/board.js';
import { makeCard } from './fixtures/board-projection.js';
import { missionId } from '../src/domain/mission.js';

const SLUG = 'task-2373';
const MISSION = missionId(SLUG);

function makeHistoryRepo() {
  const appended: OperationalHistoryEntry[] = [];
  let sequence = 0;
  const repo: OperationalHistoryRepository = {
    async findAll() { return appended; },
    async findByType(type: string) { return appended.filter((entry) => entry.eventType === type); },
    async append(entry: OperationalHistoryEntry) { sequence += 1; appended.push({ ...entry, id: sequence }); },
    async clear() { appended.length = 0; },
  };
  return { repo, appended };
}

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
      async load() { throw new Error('lifecycle must not be touched by publication'); },
      async save() { throw new Error('lifecycle must not be touched by publication'); },
      async saveWithTransition() { throw new Error('lifecycle must not be touched by publication'); },
    },
    telemetry: { async recordLaunchTelemetry() {} },
    handoffReview: { async runHandoffAndReview() { return true; } },
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
    async runHandoffAndReview(request: HandoffReviewRequest) {
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
  const { repo, appended } = makeHistoryRepo();
  const observed: { agent: string | null; phase: string | null; working: boolean }[] = [];
  const ports = strictPorts({
    handoffReview: scriptedReviewLoop(
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
  const { repo, appended } = makeHistoryRepo();
  const ports = strictPorts({
    handoffReview: scriptedReviewLoop([['qwen', 'review'], ['claude', 'review-response']]),
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
  const { repo, appended } = makeHistoryRepo();
  const seen: (string | null)[] = [];
  const ports = strictPorts({
    handoffReview: scriptedReviewLoop(
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
  const viaActive = makeHistoryRepo();
  await new ExecuteMissionService(
    strictPorts({ handoffReview: scriptedReviewLoop([['qwen', 'review']]) }),
    undefined,
    new CurrentWorkRecorder(viaActive.repo, { processId: 7 }),
  ).execute(executeRequest());

  const viaReview = makeHistoryRepo();
  const operation = () => async () => {};
  await new ReviewCommandUseCase({
    preflight: (args: string[]) => ({ slug: SLUG, args, options: {} }),
    verify: operation(), submit: operation(), push: operation(),
    start: async (context: ReviewWorkflowContext) => {
      await (context.options.onAgentLaunched as (_agent: string, _phase: AgentLaunchPhase) => Promise<void>)('qwen', 'review');
    },
    continue: operation(), resume: operation(), comment: operation(), readComments: operation(),
    submitReview: operation(), consumeArtifacts: operation(), close: operation(),
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
  const { repo, appended } = makeHistoryRepo();
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
    handoffReview: scriptedReviewLoop([['qwen', 'review']], () => { timeline.push(boardState(appended)); }),
  });

  const outcome = await new ExecuteMissionService(ports, undefined, new CurrentWorkRecorder(repo, { processId: 7 }))
    .execute(executeRequest());

  assert.equal(outcome.status, 'completed');
  assert.deepEqual(timeline.map((state) => state.agent), ['claude', 'qwen', 'qwen']);
  assert.ok(timeline.every((state) => state.working), 'a recoverable family failover never leaves WORKING');
  assert.ok(timeline.every((state) => state.attention === 'none'), 'a recoverable family failover creates no attention');
});

test('SC7: a delayed current-work publication lands before the next state is read', async () => {
  const { repo, appended } = makeHistoryRepo();
  const slowRecorder = new CurrentWorkRecorder(repo, { processId: 7 });
  const delayed = {
    async running(publication: Parameters<CurrentWorkRecorder['running']>[0]) {
      await new Promise((resolve) => setTimeout(resolve, 5));
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
