import { activitySnapshots, projectActivityPublications, activityFixture, ActivityRecorderFixture } from '../../../fixtures/execution-activity.js';
import type { ReviewWorkflowPort } from '../../../../src/application/ports/review-workflow.js';
import { makeExecutePorts as completeExecuteFixture } from '../../../fixtures/execute-mission-ports.js';
import { fixtureMission as completeMission } from '../../../fixtures/mission-builders.js';
import { missionId as completeMissionId } from '../../../../src/domain/mission.js';
import { repositoryId as completeRepositoryId } from '../../../../src/domain/repository.js';
import { missionVersion as completeVersion } from '../../../../src/application/domain-ports.js';
import { missionId as fixtureMissionId } from '../../../../src/domain/mission.js';
import { repositoryId as fixtureRepositoryId } from '../../../../src/domain/repository.js';
// Historical regression provenance: TASK-2373, TASK-2393.


import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { ConcreteAgentReadAdapter } from '../../../../src/adapters/backlog/concrete-agent-read-adapter.js';
import { makeExecutePorts } from '../../../fixtures/execute-mission-ports.js';
import { ExecuteMissionService } from '../../../../src/application/execute-mission-service.js';
import type { AgentBlockEntry, AgentBlocklistRepository } from '../../../../src/application/ports/agent-blocklist.js';
import type { ExecuteMissionPorts } from '../../../../src/application/ports/execute-mission.js';
import type { SessionMarkerEntry, SessionMarkerRepository } from '../../../../src/application/ports/mission-store.js';
import type { OperationalHistoryEntry, OperationalHistoryRepository } from '../../../../src/application/ports/operation-history.js';
import { attentionReason } from '../../../../src/application/projections/board.js';
import { ACTIVITY_OBSERVATION_TTL_MS } from '../../../../src/domain/execution-activity.js';
import type { ExecutionActivityReadPort } from '../../../../src/application/ports/execution-activity.js';
import { parseExecutionActivityEntry, executionActivityToEntry, type ExecutionActivity, } from '../../../../src/application/recording/execution-activity-recorder.js';
import { ReviewCommandUseCase } from '../../../../src/application/review-command-use-case.js';
import { agentFamily } from '../../../../src/domain/agents.js';
import { missionId } from '../../../../src/domain/mission.js';
import type { MissionId } from '../../../../src/domain/mission.js';
import { makeCard } from '../../../fixtures/board-projection.js';
import { inMemoryOperationalHistory } from '../../../fixtures/operational-history.js';

// ── Current-work reconciliation ──

const now = Date.parse('2026-08-13T12:00:00.000Z');
const event = (overrides: Record<string, unknown> = {}) => ({
  missionId: missionId('task-2370'), operationId: 'op', phase: 'execute' as const,
  state: 'running' as const, summary: 'working', agent: agentFamily('qwen'),
  processId: 42, blockedReason: null, occurredAt: new Date(now - 1_000).toISOString(), ...overrides,
});

test('worker activity supersedes a live admission publisher for the same execution (TASK-2822)', () => {
  const facts = projectActivityPublications([
    event({ processId: 100, summary: 'preparing' }),
    event({ processId: 200, phase: 'review-response', summary: 'answering findings', sequence: 2 }),
  ], { nowMs: now, ttlMs: 60_000, isProcessAlive: () => true }).get(missionId('task-2370'));
  assert.equal(facts?.currentWork?.summary, 'answering findings');
});

test("current work keeps automatic family review preparation working and makes exhaustion actionable", () => {
  const reviewPreparation = projectActivityPublications([event({ agent: agentFamily('claude') }), event({ agent: agentFamily('qwen'), occurredAt: new Date(now).toISOString() })], {
    nowMs: now, ttlMs: 1_000, isProcessAlive: () => true,
  }).get(missionId('task-2370'))!;
  assert.equal(reviewPreparation.currentWork?.agent, 'qwen');
  assert.equal(attentionReason(makeCard({ currentWork: reviewPreparation.currentWork, blockingReason: reviewPreparation.blockingReason })).kind, 'none');

  const exhausted = projectActivityPublications([event({ state: 'blocked', blockedReason: 'all eligible families are blocked' })], {
    nowMs: now, ttlMs: 1_000,
  }).get(missionId('task-2370'))!;
  assert.equal(attentionReason(makeCard({ currentWork: exhausted.currentWork, blockingReason: exhausted.blockingReason })).kind, 'blocking');
});

test('current work distinguishes unverified, stale, and known-stopped publishers', () => {
  const options = { ttlMs: 1_000, isProcessAlive: () => null as boolean | null } satisfies Partial<NonNullable<Parameters<typeof projectActivityPublications>[1]>>;
  assert.equal(projectActivityPublications([event()], { ...options, nowMs: now }).get(missionId('task-2370'))?.currentWork?.freshness, 'unverified');
  assert.equal(projectActivityPublications([event()], { ...options, nowMs: now + 2_000 }).get(missionId('task-2370'))?.currentWork?.freshness, 'stale');
  assert.equal(projectActivityPublications([event()], { ...options, isProcessAlive: () => false, nowMs: now }).get(missionId('task-2370'))?.currentWork, null);
});

test('investigation alone cannot erase a durable blocker (TASK-2799)', () => {
  const blocker = event({ state: 'blocked', blockedReason: 'Review authority needs investigation', sequence: 1 });
  const recovery = event({ operationId: 'recovery', phase: 'recovery', sequence: 2 });
  for (const state of ['ended', 'dead', 'stale'] as const) {
    const events = state !== 'ended' ? [blocker, recovery] : [blocker, recovery,
      event({ operationId: 'recovery', phase: 'recovery', state: 'ended', sequence: 3 })];
    const facts = projectActivityPublications(events, { nowMs: state === 'stale' ? now + 120_000 : now, ttlMs: 60_000,
      isProcessAlive: () => state === 'dead' ? false : null }).get(missionId('task-2370'));
    assert.equal(facts?.blockingReason, 'Review authority needs investigation');
    assert.equal(facts?.currentWork, null);
  }
  const continued = projectActivityPublications([blocker, recovery,
    event({ operationId: 'supported-continuation', sequence: 3 }),
    event({ operationId: 'recovery', phase: 'recovery', state: 'ended', sequence: 4 })],
  { nowMs: now, ttlMs: 60_000, isProcessAlive: () => true }).get(missionId('task-2370'));
  assert.equal(continued?.blockingReason, null);
  assert.equal(continued?.currentWork?.operationId, 'supported-continuation');
});

// ── Operation-aware terminal events — TASK-2373 (was task-2373-operation-aware.test.ts) ──
/**
 * TASK-2373 CP-3 — operation-aware replacement and termination (SC8, SC9).
 *
 * Reconciliation is the only place allowed to decide which published fact still
 * describes a mission. These tests pin the two rules that decision now follows:
 * a terminal event clears only its own operation, and same-operation events are
 * ordered by the operational store's durable row order rather than by timestamp
 * coincidence.
 */
describe("Operation-aware terminal events —", () => {
  const MISSION = missionId('task-2373');
  const NOW = Date.parse('2026-08-13T12:00:00.000Z');

  function event(overrides: Partial<ExecutionActivity> = {}): ExecutionActivity {
    return {
      missionId: MISSION,
      operationId: 'op-a',
      phase: 'execute',
      state: 'running',
      summary: 'working',
      agent: agentFamily('claude'),
      processId: null,
      blockedReason: null,
      occurredAt: new Date(NOW - 5_000).toISOString(),
      ...overrides,
    } as ExecutionActivity;
  }

  function reconcile(events: readonly ExecutionActivity[]) {
    return projectActivityPublications(events, { nowMs: NOW, ttlMs: 60_000 }).get(MISSION);
  }

  test('SC8: a terminal event clears the work of the operation it belongs to', () => {
    const facts = reconcile([
      event({ operationId: 'op-a', sequence: 1 }),
      event({ operationId: 'op-a', state: 'ended', sequence: 2 }),
    ]);
    assert.equal(facts?.currentWork, null);
    assert.equal(facts?.blockingReason, null);
  });

  test('SC8: a terminal event from a superseded operation leaves the newer work standing', () => {
    const facts = reconcile([
      event({ operationId: 'op-a', sequence: 1 }),
      event({ operationId: 'op-b', phase: 'review', agent: agentFamily('qwen'), sequence: 2 }),
      event({ operationId: 'op-a', state: 'ended', sequence: 3 }),
      event({ operationId: 'op-a', state: 'blocked', blockedReason: 'stale operation gave up', sequence: 4 }),
    ]);
    assert.equal(facts?.currentWork?.operationId, 'op-b');
    assert.equal(facts?.currentWork?.phase, 'review');
    assert.equal(facts?.blockingReason, null, 'a superseded operation cannot block the mission it no longer owns');
  });

  test('SC8: a blocked event for the standing operation still surfaces its reason', () => {
    const facts = reconcile([
      event({ operationId: 'op-a', sequence: 1 }),
      event({ operationId: 'op-a', state: 'blocked', blockedReason: 'every eligible family is blocked', sequence: 2 }),
    ]);
    assert.equal(facts?.currentWork, null);
    assert.equal(facts?.blockingReason, 'every eligible family is blocked');
  });

  test('SC9: durable store order decides between two events written in the same millisecond', () => {
    const at = new Date(NOW - 1_000).toISOString();
    const facts = reconcile([
      event({ phase: 'review-response', agent: agentFamily('qwen'), occurredAt: at, sequence: 9 }),
      event({ phase: 'review', agent: agentFamily('claude'), occurredAt: at, sequence: 8 }),
    ]);
    assert.equal(facts?.currentWork?.phase, 'review-response');
    assert.equal(facts?.currentWork?.agent, 'qwen');
  });

  test('SC9: the durable sequence comes from the stored row id, not from the publisher', () => {
    const stored = parseExecutionActivityEntry({
      id: 4242,
      ...executionActivityToEntry(event()),
    });
    assert.equal(stored?.sequence, 4242);
  });

  test('SC8: migrated history retains correlated completion', () => {
    const facts = reconcile([
      event({ operationId: 'history:task-2370', sequence: 1 }),
      event({ operationId: 'history:task-2370', state: 'ended', sequence: 2 }),
    ]);
    assert.equal(facts?.currentWork, null);
  });
});

// ── Live session attribution — TASK-2393 (was task-2393-current-work-attribution-repro.test.ts) ──
describe("Live session attribution —", () => {
  class EmptyBlocklistRepo implements AgentBlocklistRepository {
    async findAll(): Promise<readonly AgentBlockEntry[]> { return []; }
    async findByAgent(): Promise<AgentBlockEntry | undefined> { return undefined; }
    async save(): Promise<void> { /* unused */ }
    async deleteByAgent(): Promise<void> { /* unused */ }
    async clear(): Promise<void> { /* unused */ }
  }

  const missionId = fixtureMissionId('task-2393') as MissionId;
  function work(overrides: Partial<ExecutionActivity> = {}): ExecutionActivity {
    return {
      missionId,
      operationId: 'review:task-2393:current',
      phase: 'review' as const,
      state: 'running',
      summary: 'px review',
      agent: agentFamily('claude'),
      processId: null,
      blockedReason: null,
      occurredAt: new Date().toISOString(),
      ...overrides,
    };
  }

  function currentWork(...events: ExecutionActivity[]): ExecutionActivityReadPort {
    return {
      async loadCurrentWork() { return activitySnapshots(events); },
      async loadMissionCurrentWork(id) { return activitySnapshots(events.filter(event => event.missionId === id)); },
    };
  }

  class Markers implements SessionMarkerRepository {
    constructor(private readonly entries: readonly SessionMarkerEntry[]) {}
    async findAll(): Promise<readonly SessionMarkerEntry[]> { return this.entries; }
    async findByMissionAndRole(): Promise<SessionMarkerEntry | undefined> { return undefined; }
    async save(): Promise<void> { /* unused */ }
    async deleteByMissionAndRole(): Promise<void> { /* unused */ }
    async clear(): Promise<void> { /* unused */ }
  }

  const liveCurrentWork = currentWork(
    work(),
  );

  test('TASK-2393 SC1/SC2: a live role-null review session uses reconciled current-work attribution', async () => {
    const adapter = new ConcreteAgentReadAdapter({
      rootDir: '/home/dev/parallix',
      blocklistRepo: new EmptyBlocklistRepo(),
      knownAgentFamilies: [agentFamily('claude')],
      resolveTaskFile: () => ({ ok: false as const, matches: [] }),
      currentWork: liveCurrentWork,
      detectRunningSessions: () => [{
        missionId,
        role: null,
        startedAtMs: Date.now(),
        worktree: '/home/dev/parallix-task-2393',
        pinnedAgent: null,
      }],
    });

    assert.deepEqual(await adapter.loadRunningSessions(), [{ missionId, family: 'claude' }]);
  });

  test('TASK-2393: stale or dead current-work does not attribute a live session', async () => {
    for (const [reader, isProcessAlive] of [
      [currentWork(work({ occurredAt: new Date(Date.now() - ACTIVITY_OBSERVATION_TTL_MS - 1).toISOString() })), undefined],
      [currentWork(work({ processId: 123 })), () => false],
    ] as const) {
      const adapter = new ConcreteAgentReadAdapter({
        rootDir: '/home/dev/parallix',
        blocklistRepo: new EmptyBlocklistRepo(),
        knownAgentFamilies: [agentFamily('claude')],
        currentWork: reader,
        isProcessAlive,
        detectRunningSessions: () => [{ missionId, role: null, startedAtMs: Date.now(), worktree: null, pinnedAgent: null }],
      });
      assert.deepEqual(await adapter.loadRunningSessions(), [{ missionId, family: null }]);
    }
  });

  test('TASK-2393: live current-work outranks a fresh marker and pinned family', async () => {
    const adapter = new ConcreteAgentReadAdapter({
      rootDir: '/home/dev/parallix',
      blocklistRepo: new EmptyBlocklistRepo(),
      knownAgentFamilies: [agentFamily('claude'), agentFamily('custom')],
      currentWork: liveCurrentWork,
      sessionMarkers: new Markers([{
        repositoryId: fixtureRepositoryId('parallix') as SessionMarkerEntry['repositoryId'], missionId, role: 'execute', agent: agentFamily('custom'),
        lastLaunched: new Date(Date.now() + 1_000).toISOString(), sessionId: null, updatedAt: new Date().toISOString(),
      }]),
      detectRunningSessions: () => [{ missionId, role: 'execute', startedAtMs: Date.now(), worktree: null, pinnedAgent: 'custom' }],
    });
    assert.deepEqual(await adapter.loadRunningSessions(), [{ missionId, family: 'claude' }]);
  });
});

// ── Publish-then-reconcile defects — TASK-2373 (was task-2373-repro.test.ts) ──
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
describe("Publish-then-reconcile defects —", () => {
  // ---------------------------------------------------------------------------
  // Fakes
  // ---------------------------------------------------------------------------

  function published(appended: readonly OperationalHistoryEntry[]) {
    return appended.flatMap((entry) => parseExecutionActivityEntry(entry) ?? []);
  }

  function strictPorts(overrides: Record<string, unknown> = {}) {
  let recordedMission = completeMission(String('task-2373'), {repositoryId: completeRepositoryId('repo'),title: 'Fixture',labels: [],assignee: null,checkpoints: [{ missionId: completeMissionId('task-2373'), name: 'CP-1', firstLine: 'work', goalCheck: [], nextActionText: '' }],review: null,netEngineeringLines: null,brief: { goal: 'g', why: 'w', scope: 's', outOfScope: [] },declaredGates: ['npm test'],successCriteria: ['done'],predictedNelBucket: 'Small',status: 'refined' as const,closedAt: null});
    const parts = completeExecuteFixture({
      ...makeExecutePorts().ports,
      workspace: {
        async preflight() { return true; },
        async resolveWorktree() { return '/worktree'; },
        async resolveTaskFile() { return { ok: true as const, taskFile: '/worktree/task.md' }; },
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
        async load() { return { kind: 'found' as const, version: completeVersion(1), mission: recordedMission }; },
        async save(next) { recordedMission = next; return completeVersion(2); },
        async saveWithTransition(next) { recordedMission = next; return completeVersion(2); },
      },
      telemetry: { async recordLaunchTelemetry() {} },
      autonomousReview: { async start() {} },
    }).ports;
    return { ...parts, ...overrides };
  }

  function executeRequest(overrides: Record<string, unknown> = {}) {
    return {
      operationId: 'active:task-2373',
      slug: 'task-2373',
      agent: 'claude',
      capabilities: new Set(['active:execute'] as const),
      ...overrides,
    };
  }

  function makeReviewWorkflow(overrides: Partial<ReviewWorkflowPort> = {}): ReviewWorkflowPort {
    const operation = () => async () => {};
    return {
      preflight: (args: string[]) => ({ slug: 'task-2373', args, options: {} }),
      verify: operation(), submit: operation(), push: operation(), enter: operation(),
      comment: operation(), readComments: operation(),
      submitReview: operation(), close: operation(),
      status: operation(),
      reconcileReview: operation(),
      ...overrides,
    };
  }

  const NOW = Date.parse('2026-08-13T12:00:00.000Z');

  function currentWorkEvent(overrides: Partial<ExecutionActivity> = {}): ExecutionActivity {
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
    } as ExecutionActivity;
  }

  // ---------------------------------------------------------------------------
  // Defect 1 — nested autonomous review reports the wrong phase and agent
  // ---------------------------------------------------------------------------

  test('TASK-2373 defect 1: px active publishes the agents launched inside the autonomous review loop', async () => {
    const { repo, appended } = inMemoryOperationalHistory();
    let seen: { value: Record<string, unknown> | null } = { value: null };
    const ports = strictPorts({
      autonomousReview: {
        async start(request: Record<string, unknown>) {
          seen.value = request;
          const onAgentLaunched = request.onAgentLaunched;
          if (typeof onAgentLaunched === 'function') {
            await onAgentLaunched('qwen', 'review');
            await onAgentLaunched('codex', 'review-response');
          }
          return true;
        },
      },
    });

    const outcome = await new ExecuteMissionService(ports, undefined, new ActivityRecorderFixture(repo, { processId: 7 }))
      .execute(executeRequest());
    assert.equal(outcome.status, 'completed');

    assert.equal(
      typeof ((seen.value))?.onAgentLaunched,
      'function',
      "the review preparation/review port must carry the current-work publication seam into the review loop",
    );
    assert.deepEqual(
      published(appended).filter((fact) => fact.phase === 'review' || fact.phase === 'review-response')
        .map((fact) => [fact.phase, fact.agent, fact.state]),
      [
        ['review', null, 'running'],
        ['review', 'qwen', 'running'],
        ['review-response', 'codex', 'running'],
      ],
      "nested reviewer and implementer launches must replace the generic review preparation fact",
    );
  });

  // ---------------------------------------------------------------------------
  // Defect 2 — asynchronous agent-change publication races later state
  // ---------------------------------------------------------------------------

  test('TASK-2373 defect 2: an agent-change publication is awaited before the run reads later state', async () => {
    const { repo, appended } = inMemoryOperationalHistory();
    // A recorder that only settles on a later macrotask: a fire-and-forget
    // publication cannot have landed by the time the launcher returns.
    const slowRecorder = {
      async running(publication: { agent?: unknown }) {
        await new Promise((resolve) => setTimeout(resolve, 5));
        await repo.append(executionActivityToEntry(currentWorkEvent({
          state: 'running',
          agent: (publication.agent ?? null) as ExecutionActivity['agent'],
        })));
      },
      async blocked() {},
      async ended() {},
    } satisfies NonNullable<ConstructorParameters<typeof ExecuteMissionService>[2]>;

    let awaitable: { value: unknown } = { value: null };
    let agentsAfterLaunch: readonly (string | null)[] = [];
    const ports = strictPorts({
      agentExecution: {
        async prepare() { return { prompt: 'p', agentConfig: {} }; },
        async launch(request: { onAgentChanged?: (_agent: string) => unknown }) {
          awaitable.value = request.onAgentChanged?.('qwen');
          await awaitable.value;
          agentsAfterLaunch = published(appended).map((fact) => fact.agent);
          return { agent: 'qwen', rebaseDeferred: false, errored: false, errorMessage: null, exitStatus: 0, detail: null };
        },
      },
    });

    await new ExecuteMissionService(ports, undefined, slowRecorder).execute(executeRequest());

    assert.equal(
      typeof (awaitable.value as { then?: unknown } | null)?.then,
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
    const facts = projectActivityPublications([
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
    const facts = projectActivityPublications([
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
    const { repo, appended } = inMemoryOperationalHistory();
    const workflow = makeReviewWorkflow({
      enter: async () => { throw new Error('review loop exhausted: no eligible implementer remains'); },
    });

    await assert.rejects(
      new ReviewCommandUseCase(workflow, new ActivityRecorderFixture(repo, { processId: 9 })).execute(['task-2373']),
      /no eligible implementer remains/,
    );

    const last = published(appended).at(-1);
    assert.equal(last?.state, 'blocked', 'autonomous exhaustion must not be published as a bare ended fact');
    assert.match(String(last?.blockedReason), /no eligible implementer remains/);
  });

  // ---------------------------------------------------------------------------
  // Defect 5 — current-work history is reread unboundedly per board refresh
  // ---------------------------------------------------------------------------

  test('TASK-2373 defect 5: activity reads use snapshots without reading audit history', async () => {
    let reads = 0;
    const repo: OperationalHistoryRepository = {
      async findAll() { reads++; return []; }, async findByType() { reads++; return []; },
      async append() {}, async clear() {},
    };
    const activity = activityFixture(repo);
    const missions = ['task-0001', 'task-0002', 'task-0003'];
    for (let round = 0; round < 400; round++) {
      for (const slug of missions) {
        await activity.publish(currentWorkEvent({ missionId: missionId(slug), operationId: `op-${round}` }), `op-${round}`);
      }
    }
    const snapshots = await activity.loadCurrentWork();
    assert.equal(snapshots.length, missions.length);
    assert.equal(snapshots.every(snapshot => snapshot.frames.at(-1)?.event.operationId === 'op-399'), true);
    assert.equal((await activity.loadMissionCurrentWork(missionId(missions[0]))).length, 1);
    assert.equal(reads, 0, 'audit history cannot become the activity authority');
  });
});
