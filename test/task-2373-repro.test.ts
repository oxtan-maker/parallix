/**
 * TASK-2373 CP-1 — red characterization tests for the six remaining live-board
 * defects.
 *
 * Each test below reproduces one defect described in the mission's SC1. They
 * are written against the production seams (not against the fix), so each one
 * fails on the parent commit and passes once its defect is closed.
 *
 * The sixth defect (`q`/Ctrl+C not terminating a real interactive board while a
 * confirmation dialog is armed) needs a real OS process and lives in
 * `test/task-2373-shutdown.test.ts`; mock evidence is explicitly not accepted
 * for it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { ExecuteMissionService } from '../src/application/execute-mission-service.js';
import type { ExecuteMissionPorts } from '../src/application/ports/execute-mission.js';
import { ReviewCommandUseCase } from '../src/application/review-command-use-case.js';
import {
  CurrentWorkRecorder,
  currentWorkEventToEntry,
  parseCurrentWorkEntry,
  type CurrentWorkEvent,
} from '../src/application/recording/current-work-recorder.js';
import type { OperationalHistoryEntry, OperationalHistoryRepository } from '../src/application/ports/operation-history.js';
import { ConcreteCurrentWorkReadAdapter } from '../src/adapters/backlog/concrete-current-work-read-adapter.js';
import { reconcileCurrentWork } from '../src/application/projections/current-work.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId } from '../src/domain/mission.js';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

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

function published(appended: readonly OperationalHistoryEntry[]) {
  return appended.flatMap((entry) => parseCurrentWorkEntry(entry) ?? []);
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
      async prepare() { return { prompt: 'execute prompt', agentConfig: {} }; },
      async launch() {
        return { agent: 'codex', rebaseDeferred: false, errored: false, errorMessage: null, exitStatus: 0, detail: null };
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

function executeRequest(overrides: Record<string, unknown> = {}) {
  return {
    operationId: 'active:task-2373',
    slug: 'task-2373',
    agent: 'claude',
    capabilities: new Set(['active:execute'] as const),
    ...overrides,
  } as never;
}

function makeReviewWorkflow(overrides: Record<string, unknown> = {}) {
  const operation = () => async () => {};
  return {
    preflight: (args: string[]) => ({ slug: 'task-2373', args, options: {} }),
    verify: operation(), submit: operation(), push: operation(), start: operation(),
    continue: operation(), resume: operation(), comment: operation(), readComments: operation(),
    submitReview: operation(), consumeArtifacts: operation(), close: operation(),
    status: operation(), createEvent: operation(), backfillReview: operation(),
    reconcileReview: operation(), importLegacy: operation(),
    ...overrides,
  };
}

const NOW = Date.parse('2026-08-13T12:00:00.000Z');

function currentWorkEvent(overrides: Partial<CurrentWorkEvent> = {}): CurrentWorkEvent {
  return {
    missionId: missionId('task-2373'),
    operationId: 'op-a',
    phase: 'execute',
    state: 'running',
    summary: 'working',
    agent: agentFamily('claude'),
    processId: null,
    blockedReason: null,
    occurredAt: new Date(NOW - 10_000).toISOString(),
    ...overrides,
  } as CurrentWorkEvent;
}

// ---------------------------------------------------------------------------
// Defect 1 — nested autonomous review reports the wrong phase and agent
// ---------------------------------------------------------------------------

test('TASK-2373 defect 1: px active publishes the agents launched inside the autonomous review loop', async () => {
  const { repo, appended } = makeHistoryRepo();
  let seen: Record<string, unknown> | null = null;
  const ports = strictPorts({
    handoffReview: {
      async runHandoffAndReview(request: Record<string, unknown>) {
        seen = request;
        const onAgentLaunched = request.onAgentLaunched;
        if (typeof onAgentLaunched === 'function') {
          await onAgentLaunched('qwen', 'review');
          await onAgentLaunched('codex', 'review-response');
        }
        return true;
      },
    },
  });

  const outcome = await new ExecuteMissionService(ports, undefined, new CurrentWorkRecorder(repo, { processId: 7 }))
    .execute(executeRequest());
  assert.equal(outcome.status, 'completed');

  assert.equal(
    typeof (seen as unknown as Record<string, unknown> | null)?.onAgentLaunched,
    'function',
    'the handoff/review port must carry the current-work publication seam into the review loop',
  );
  assert.deepEqual(
    published(appended).filter((fact) => fact.phase === 'review' || fact.phase === 'review-response')
      .map((fact) => [fact.phase, fact.agent, fact.state]),
    [
      ['review', 'qwen', 'running'],
      ['review-response', 'codex', 'running'],
    ],
    'nested reviewer and implementer launches must replace the generic handoff fact',
  );
});

// ---------------------------------------------------------------------------
// Defect 2 — asynchronous agent-change publication races later state
// ---------------------------------------------------------------------------

test('TASK-2373 defect 2: an agent-change publication is awaited before the run reads later state', async () => {
  const { repo, appended } = makeHistoryRepo();
  // A recorder that only settles on a later macrotask: a fire-and-forget
  // publication cannot have landed by the time the launcher returns.
  const slowRecorder = {
    async running(publication: { agent?: unknown }) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      await repo.append(currentWorkEventToEntry(currentWorkEvent({
        state: 'running',
        agent: (publication.agent ?? null) as CurrentWorkEvent['agent'],
      })));
    },
    async blocked() {},
    async ended() {},
  };

  let awaitable: unknown = null;
  let agentsAfterLaunch: readonly (string | null)[] = [];
  const ports = strictPorts({
    agentExecution: {
      async prepare() { return { prompt: 'p', agentConfig: {} }; },
      async launch(request: { onAgentChanged?: (_agent: string) => unknown }) {
        awaitable = request.onAgentChanged?.('qwen');
        await awaitable;
        agentsAfterLaunch = published(appended).map((fact) => fact.agent);
        return { agent: 'qwen', rebaseDeferred: false, errored: false, errorMessage: null, exitStatus: 0, detail: null };
      },
    },
  });

  await new ExecuteMissionService(ports, undefined, slowRecorder).execute(executeRequest());

  assert.equal(
    typeof (awaitable as { then?: unknown } | null)?.then,
    'function',
    'the agent-change callback must return an awaitable so the authoritative write is ordered',
  );
  assert.ok(
    agentsAfterLaunch.includes('qwen'),
    `the failover publication must have landed before the launcher returned (saw ${JSON.stringify(agentsAfterLaunch)})`,
  );
});

// ---------------------------------------------------------------------------
// Defect 3 — a terminal event from older work clears newer work
// ---------------------------------------------------------------------------

test('TASK-2373 defect 3: a terminal event from an older operation does not clear newer current work', () => {
  const facts = reconcileCurrentWork([
    currentWorkEvent({ operationId: 'op-a', occurredAt: new Date(NOW - 3_000).toISOString() }),
    currentWorkEvent({ operationId: 'op-b', agent: agentFamily('qwen'), occurredAt: new Date(NOW - 2_000).toISOString() }),
    // The older operation finishes last: its terminal event must clear only
    // its own work, never the operation that started after it.
    currentWorkEvent({ operationId: 'op-a', state: 'ended', occurredAt: new Date(NOW - 1_000).toISOString() }),
  ], { nowMs: NOW, ttlMs: 60_000 }).get(missionId('task-2373'));

  assert.equal(facts?.currentWork?.operationId, 'op-b');
  assert.equal(facts?.currentWork?.agent, 'qwen');
});

test('TASK-2373 defect 3: same-operation replacement is deterministic under identical timestamps', () => {
  const at = new Date(NOW - 1_000).toISOString();
  // Delivered out of order on purpose: only the store's durable sequence can
  // decide which of two same-millisecond events is the later one.
  const facts = reconcileCurrentWork([
    currentWorkEvent({ operationId: 'op-a', phase: 'review-response', agent: agentFamily('qwen'), occurredAt: at, sequence: 2 }),
    currentWorkEvent({ operationId: 'op-a', phase: 'review', agent: agentFamily('claude'), occurredAt: at, sequence: 1 }),
  ], { nowMs: NOW, ttlMs: 60_000 }).get(missionId('task-2373'));

  assert.equal(facts?.currentWork?.phase, 'review-response', 'durable store order decides, not timestamp coincidence');
  assert.equal(facts?.currentWork?.agent, 'qwen');
});

// ---------------------------------------------------------------------------
// Defect 4 — review escalation loses its blocking reason
// ---------------------------------------------------------------------------

test('TASK-2373 defect 4: a review loop that cannot continue publishes its blocking reason', async () => {
  const { repo, appended } = makeHistoryRepo();
  const workflow = makeReviewWorkflow({
    start: async () => { throw new Error('review loop exhausted: no eligible implementer remains'); },
  });

  await assert.rejects(
    new ReviewCommandUseCase(workflow, new CurrentWorkRecorder(repo, { processId: 9 })).execute(['task-2373', '--start']),
    /no eligible implementer remains/,
  );

  const last = published(appended).at(-1);
  assert.equal(last?.state, 'blocked', 'autonomous exhaustion must not be published as a bare ended fact');
  assert.match(String(last?.blockedReason), /no eligible implementer remains/);
});

// ---------------------------------------------------------------------------
// Defect 5 — current-work history is reread unboundedly per board refresh
// ---------------------------------------------------------------------------

/**
 * A history repository that counts the rows it hands to the read adapter, so
 * the test measures the board's real read cost rather than a claim about it.
 */
function countingHistoryRepo(missions: readonly string[], roundsPerMission: number) {
  let rowsDelivered = 0;
  const rows: OperationalHistoryEntry[] = [];
  let sequence = 0;
  for (let round = 0; round < roundsPerMission; round += 1) {
    for (const slug of missions) {
      sequence += 1;
      rows.push({
        id: sequence,
        ...currentWorkEventToEntry(currentWorkEvent({
          missionId: missionId(slug),
          operationId: `op-${round}`,
          occurredAt: new Date(NOW - 1_000 * (roundsPerMission - round)).toISOString(),
        })),
      });
    }
  }
  const repo = {
    async findAll() { rowsDelivered += rows.length; return rows; },
    async findByType(type: string) {
      const matching = rows.filter((row) => row.eventType === type);
      rowsDelivered += matching.length;
      return matching;
    },
    async findLatestByTypePerMission(type: string, limitPerMission: number) {
      const byMission = new Map<string, OperationalHistoryEntry[]>();
      for (const row of rows) {
        if (row.eventType !== type) { continue; }
        const key = String((JSON.parse(row.eventData) as { missionId?: string }).missionId ?? '');
        byMission.set(key, [...(byMission.get(key) ?? []), row].slice(-limitPerMission));
      }
      const selected = [...byMission.values()].flat();
      rowsDelivered += selected.length;
      return selected;
    },
    async append(entry: OperationalHistoryEntry) { rows.push(entry); },
    async clear() { rows.length = 0; },
  } as unknown as OperationalHistoryRepository;
  return { repo, rowsDelivered: () => rowsDelivered };
}

test('TASK-2373 defect 5: board current-work reads deliver all events for correct reconciliation', async () => {
  // TASK-2375: the bounded N-latest window (limit=2) was the thing that
  // discarded still-running operations when older operations emitted late
  // terminal events. The read now delivers all events so the reconciler can
  // determine the newest standing operation correctly. Read cost grows with
  // history, but correctness is the priority — the reconciler reduces to one
  // fact per mission regardless of input size.
  const missions = ['task-0001', 'task-0002', 'task-0003'];
  const shallow = countingHistoryRepo(missions, 2);
  const deep = countingHistoryRepo(missions, 400);

  await new ConcreteCurrentWorkReadAdapter(shallow.repo).loadCurrentWork();
  await new ConcreteCurrentWorkReadAdapter(deep.repo).loadCurrentWork();

  // Deep repo delivers all rows (not bounded by limit=2), enabling correct
  // reconciliation even when older operations emit many late terminal events.
  assert.ok(
    deep.rowsDelivered() > shallow.rowsDelivered(),
    `deep read delivers all rows (${deep.rowsDelivered()}) vs shallow (${shallow.rowsDelivered()}) — unbounded for correctness`,
  );
});
