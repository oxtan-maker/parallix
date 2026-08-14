/**
 * TASK-2373 CP-4 — truthful NEEDS YOU (SC10–SC12).
 *
 * WORKING and NEEDS YOU are two views of the same reconciled fact, so these
 * tests always assert the pair: what the operator rail says *and* whether the
 * mission still counts as worked.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { ExecuteMissionService } from '../src/application/execute-mission-service.js';
import type { ExecuteMissionPorts, HandoffReviewRequest } from '../src/application/ports/execute-mission.js';
import { CurrentWorkRecorder, parseCurrentWorkEntry } from '../src/application/recording/current-work-recorder.js';
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

/** WORKING and NEEDS YOU as the board would render them for this mission. */
function boardState(appended: readonly OperationalHistoryEntry[], options: { nowMs?: number; alive?: boolean | null } = {}) {
  const events = appended.flatMap((entry) => parseCurrentWorkEntry(entry) ?? []);
  const facts = reconcileCurrentWork(events, {
    nowMs: options.nowMs ?? Date.now(),
    ttlMs: 5 * 60_000,
    isProcessAlive: () => options.alive ?? true,
  }).get(MISSION) ?? { currentWork: null, blockingReason: null };
  const reason = attentionReason(makeCard({ currentWork: facts.currentWork, blockingReason: facts.blockingReason }));
  return {
    working: isWorkInProgress(facts.currentWork),
    needsYou: reason.kind !== 'none',
    attention: reason.kind,
    detail: 'detail' in reason ? reason.detail : null,
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

// ---------------------------------------------------------------------------
// SC10, SC11 — the reason survives the end of current work
// ---------------------------------------------------------------------------

test('SC10: review-loop escalation during px active leaves the mission in NEEDS YOU with its reason', async () => {
  const { repo, appended } = makeHistoryRepo();
  const ports = strictPorts({
    handoffReview: {
      async runHandoffAndReview(request: HandoffReviewRequest) {
        await request.onAgentLaunched?.('qwen', 'review');
        // The loop gives up: no eligible reviewer remains for this round.
        await request.onAutonomousStop?.('REVIEWER_ARTIFACT_RETRY_EXHAUSTED');
        return true;
      },
    },
  });

  const outcome = await new ExecuteMissionService(ports, undefined, new CurrentWorkRecorder(repo, { processId: 7 }))
    .execute(executeRequest());

  // The run itself completed; the mission still cannot progress autonomously.
  assert.equal(outcome.status, 'completed');
  const state = boardState(appended);
  assert.equal(state.working, false, 'an escalated mission must leave WORKING');
  assert.equal(state.attention, 'blocking');
  assert.match(String(state.detail), /REVIEWER_ARTIFACT_RETRY_EXHAUSTED/);
});

test('SC10: the bracket-closing ended fact cannot erase an escalation reason', async () => {
  const { repo, appended } = makeHistoryRepo();
  const ports = strictPorts({
    handoffReview: {
      async runHandoffAndReview(request: HandoffReviewRequest) {
        await request.onAutonomousStop?.('implementer reported BLOCKED');
        return true;
      },
    },
  });
  await new ExecuteMissionService(ports, undefined, new CurrentWorkRecorder(repo, { processId: 7 })).execute(executeRequest());

  // The execute run publishes `ended` for the same operation on its way out.
  const states = appended.flatMap((entry) => parseCurrentWorkEntry(entry) ?? []).map((fact) => fact.state);
  assert.ok(states.includes('blocked') && states.at(-1) === 'ended', 'the run still closes its bracket');
  assert.match(String(boardState(appended).detail), /implementer reported BLOCKED/);
});

test('SC11: exhausted execute options survive into NEEDS YOU as the operator-facing reason', async () => {
  const { repo, appended } = makeHistoryRepo();
  const ports = strictPorts({
    agentExecution: {
      async prepare() { return { prompt: 'p', agentConfig: {} }; },
      async launch() {
        return {
          agent: 'claude', rebaseDeferred: false, errored: true,
          errorMessage: 'all eligible implementer families are exhausted', exitStatus: null, detail: null,
        };
      },
    },
  });

  const outcome = await new ExecuteMissionService(ports, undefined, new CurrentWorkRecorder(repo, { processId: 7 }))
    .execute(executeRequest());

  assert.equal(outcome.status, 'failed');
  const state = boardState(appended);
  assert.equal(state.working, false);
  assert.equal(state.attention, 'blocking');
  assert.match(String(state.detail), /all eligible implementer families are exhausted/);
});

test('SC11: one family becoming usage-blocked while another can take over creates no attention', async () => {
  const { repo, appended } = makeHistoryRepo();
  const ports = strictPorts({
    agentExecution: {
      async prepare() { return { prompt: 'p', agentConfig: {} }; },
      async launch(request: { onAgentChanged?: (_agent: string) => Promise<void> }) {
        await request.onAgentChanged?.('claude');
        await request.onAgentChanged?.('qwen');
        return { agent: 'qwen', rebaseDeferred: false, errored: false, errorMessage: null, exitStatus: 0, detail: null };
      },
    },
    handoffReview: {
      async runHandoffAndReview(request: HandoffReviewRequest) {
        await request.onAgentLaunched?.('codex', 'review');
        return true;
      },
    },
  });
  await new ExecuteMissionService(ports, undefined, new CurrentWorkRecorder(repo, { processId: 7 })).execute(executeRequest());

  const facts = appended.flatMap((entry) => parseCurrentWorkEntry(entry) ?? []);
  assert.ok(facts.every((fact) => fact.state !== 'blocked'), 'recoverable failover never publishes a blocked fact');
});

// ---------------------------------------------------------------------------
// SC12 — WORKING and NEEDS YOU stay mutually truthful across four states
// ---------------------------------------------------------------------------

test('SC12: active work, failover, exhaustion, and dead work each project one truthful state', async () => {
  // 1. active autonomous work -> WORKING. Sampled from inside the review loop:
  // after the bracket closes the mission is legitimately idle.
  const sampled = makeHistoryRepo();
  let duringWork = boardState(sampled.appended);
  await new ExecuteMissionService(strictPorts({
    handoffReview: {
      async runHandoffAndReview(request: HandoffReviewRequest) {
        await request.onAgentLaunched?.('qwen', 'review');
        duringWork = boardState(sampled.appended);
        return true;
      },
    },
  }), undefined, new CurrentWorkRecorder(sampled.repo, { processId: 7 })).execute(executeRequest());
  assert.deepEqual(
    { working: duringWork.working, needsYou: duringWork.needsYou },
    { working: true, needsYou: false },
    'active autonomous work is WORKING and not attention',
  );

  // 2. failover in progress -> still WORKING
  const failover = makeHistoryRepo();
  let duringFailover = boardState(failover.appended);
  await new ExecuteMissionService(strictPorts({
    agentExecution: {
      async prepare() { return { prompt: 'p', agentConfig: {} }; },
      async launch(request: { onAgentChanged?: (_agent: string) => Promise<void> }) {
        await request.onAgentChanged?.('claude');
        await request.onAgentChanged?.('qwen');
        duringFailover = boardState(failover.appended);
        return { agent: 'qwen', rebaseDeferred: false, errored: false, errorMessage: null, exitStatus: 0, detail: null };
      },
    },
  }), undefined, new CurrentWorkRecorder(failover.repo, { processId: 7 })).execute(executeRequest());
  assert.deepEqual(
    { working: duringFailover.working, needsYou: duringFailover.needsYou },
    { working: true, needsYou: false },
    'a failover in progress is still WORKING',
  );

  // 3. no autonomous progress possible -> NEEDS YOU
  const exhausted = makeHistoryRepo();
  await new ExecuteMissionService(strictPorts({
    handoffReview: {
      async runHandoffAndReview(request: HandoffReviewRequest) {
        await request.onAutonomousStop?.('REVIEWER_NON_APPROVAL');
        return true;
      },
    },
  }), undefined, new CurrentWorkRecorder(exhausted.repo, { processId: 7 })).execute(executeRequest());
  const exhaustedState = boardState(exhausted.appended);
  assert.deepEqual(
    { working: exhaustedState.working, needsYou: exhaustedState.needsYou },
    { working: false, needsYou: true },
  );

  // 4. stale/dead work -> not WORKING
  const stale = makeHistoryRepo();
  await new ExecuteMissionService(strictPorts({
    handoffReview: {
      async runHandoffAndReview(request: HandoffReviewRequest) {
        await request.onAgentLaunched?.('qwen', 'review');
        return false; // the pipeline never closed its bracket
      },
    },
  }), undefined, new CurrentWorkRecorder(stale.repo, { processId: 7 })).execute(executeRequest());
  const staleState = boardState(stale.appended, { alive: null, nowMs: Date.now() + 60 * 60_000 });
  assert.equal(staleState.working, false, 'work that stopped being verifiable is not WORKING');
  assert.equal(staleState.needsYou, true, 'and it is not silently dropped either');
});
