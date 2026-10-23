import { missionId as fixtureMissionId } from '../../../../src/domain/mission.js';
import { agentFamily as fixtureAgentFamily } from '../../../../src/domain/agents.js';
/**
 * Reproduction for TASK-2498: the null-agent code-run phase of `px review
 * --continue` (a `review/running` current-work fact with `agent: null`)
 * misreads on two independent read paths — the web flight-card agent pill and
 * the per-family running-session attribution in `ConcreteAgentReadAdapter`.
 *
 * Both fixtures model the operator-DB fact sequence: a live `px review
 * --continue` whose reconciled current-work fact names a `null` agent and whose
 * mission assignee is `custom`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { agentFamily } from '../../../../src/domain/agents.js';
import type { MissionId } from '../../../../src/domain/mission.js';
import { ConcreteAgentReadAdapter } from '../../../../src/adapters/backlog/concrete-agent-read-adapter.js';
import type { AgentBlockEntry, AgentBlocklistRepository } from '../../../../src/application/ports/agent-blocklist.js';
import type { CurrentWorkReadAdapter } from '../../../../src/application/projections/current-work.js';
import type { CurrentWorkEvent } from '../../../../src/application/recording/current-work-recorder.js';
import type { SessionMarkerEntry, SessionMarkerRepository } from '../../../../src/application/ports/mission-store.js';
import type { AgentFamily } from '../../../../src/domain/agents.js';
import { Board } from '../../../../web/src/board.js';
import { toWebBoardSnapshot } from '../../../../src/interfaces/web/transport.js';
import type { MissionCard } from '../../../../src/application/projections/mission-board.js';
import { makeCard, makeProjection } from '../../../fixtures/board-projection.js';

const missionId = fixtureMissionId('task-2498') as MissionId;

// ---------------------------------------------------------------------------
// Defect 1 — web flight-card agent pill (SC1, SC2)
// ---------------------------------------------------------------------------

const render = (snapshot: ReturnType<typeof toWebBoardSnapshot>): string =>
  renderToStaticMarkup(React.createElement(Board, { snapshot, onRefresh: async () => {} }));

test('a working card with an unidentified agent omits its label and dot, never the assignee family', () => {
  const workingNull = makeCard({
    id: fixtureMissionId('task-2498') as MissionCard['id'],
    lane: 'review',
    status: 'review',
    agent: agentFamily('custom'),
    currentWork: {
      operationId: 'review:task-2498:current',
      phase: 'review',
      summary: 'px review',
      agent: null,
      updatedAt: '2026-09-12T10:00:00.000Z',
      freshness: 'live',
    },
  });
  const html = render(toWebBoardSnapshot(makeProjection({ review: [workingNull] })));
  assert.doesNotMatch(html, /no implementer|class="live-indicator"/, 'an unidentified agent has no label or blinking dot');
  assert.equal((html.match(/fan spin/g) ?? []).length, 2, 'work still spins the fans');
  assert.doesNotMatch(html, /custom/, 'the assignee family must never appear in the pill');
});

test('an idle card still renders its assignee family unchanged', () => {
  const idle = makeCard({
    id: fixtureMissionId('task-2498b') as MissionCard['id'],
    lane: 'active',
    status: 'active',
    agent: agentFamily('custom'),
  });
  const html = render(toWebBoardSnapshot(makeProjection({ active: [idle] })));
  assert.match(html, /custom/, 'an idle card keeps showing who owns the mission');
});

// ---------------------------------------------------------------------------
// Defect 2 — running-session attribution (SC3, SC4, SC5)
// ---------------------------------------------------------------------------

class EmptyBlocklistRepo implements AgentBlocklistRepository {
  async findAll(): Promise<readonly AgentBlockEntry[]> { return []; }
  async findByAgent(): Promise<AgentBlockEntry | undefined> { return undefined; }
  async save(): Promise<void> { /* unused */ }
  async deleteByAgent(): Promise<void> { /* unused */ }
  async clear(): Promise<void> { /* unused */ }
}

function nullAgentWork(overrides: Partial<CurrentWorkEvent> = {}): CurrentWorkEvent {
  return {
    missionId,
    operationId: 'review:task-2498:current',
    phase: 'review' as const,
    state: 'running',
    summary: 'px review',
    agent: null,
    processId: null,
    blockedReason: null,
    occurredAt: new Date().toISOString(),
    ...overrides,
  };
}

function currentWork(...events: CurrentWorkEvent[]): CurrentWorkReadAdapter {
  return {
    async loadCurrentWork() { return events; },
  };
}

test('a live null-agent review session attributes to the mission assignee family', async () => {
  const adapter = new ConcreteAgentReadAdapter({
    rootDir: '/home/dev/parallix',
    blocklistRepo: new EmptyBlocklistRepo(),
    knownAgentFamilies: [agentFamily('custom')],
    resolveTaskFile: () => ({ ok: true as const, taskFile: '/home/dev/parallix-task-2498/task-2498.md', matches: [] }),
    getTaskAssignee: () => 'custom',
    currentWork: currentWork(nullAgentWork()),
    detectRunningSessions: () => [{
      missionId,
      role: null,
      startedAtMs: Date.now(),
      worktree: '/home/dev/parallix-task-2498',
      pinnedAgent: null,
    }],
  });
  assert.deepEqual(await adapter.loadRunningSessions(), [{ missionId, family: fixtureAgentFamily('custom') as AgentFamily }]);
});

test('a live non-null agent session still attributes to that agent (SC5)', async () => {
  const adapter = new ConcreteAgentReadAdapter({
    rootDir: '/home/dev/parallix',
    blocklistRepo: new EmptyBlocklistRepo(),
    knownAgentFamilies: [agentFamily('claude')],
    resolveTaskFile: () => ({ ok: false as const, matches: [] }),
    currentWork: currentWork(nullAgentWork({ agent: agentFamily('claude') })),
    detectRunningSessions: () => [{
      missionId,
      role: null,
      startedAtMs: Date.now(),
      worktree: '/home/dev/parallix-task-2498',
      pinnedAgent: null,
    }],
  });
  assert.deepEqual(await adapter.loadRunningSessions(), [{ missionId, family: fixtureAgentFamily('claude') as AgentFamily }]);
});

test('a non-review null-agent session does NOT fall back to the assignee (F1)', async () => {
  // A live `px active` (role: 'execute') session publishes a null-agent fact
  // and has a resolvable assignee ('custom'). Attribution must stay scoped to
  // the review null-agent bracket (role === null): this session falls through
  // to the general path and reports null, not a fabricated 'custom'.
  const adapter = new ConcreteAgentReadAdapter({
    rootDir: '/home/dev/parallix',
    blocklistRepo: new EmptyBlocklistRepo(),
    knownAgentFamilies: [agentFamily('custom')],
    resolveTaskFile: () => ({ ok: true as const, taskFile: '/home/dev/parallix-task-2498/task-2498.md', matches: [] }),
    getTaskAssignee: () => 'custom',
    currentWork: currentWork(nullAgentWork()),
    detectRunningSessions: () => [{
      missionId,
      role: 'execute',
      startedAtMs: Date.now(),
      worktree: '/home/dev/parallix-task-2498',
      pinnedAgent: null,
    }],
  });
  assert.deepEqual(await adapter.loadRunningSessions(), [{ missionId, family: null as AgentFamily | null }]);
});

// TASK-2769: the workflow family is selection/activity, never execution evidence.
for (const path of ['CLI', 'board'] as const) {
  test(`${path} held preparation excludes selected family from execution indicator (TASK-2769)`, () => {
    const card = makeCard({ id: missionId, agent: agentFamily('custom'), currentWork: {
      operationId: 'workflow:preparing', phase: 'execute', summary: 'preparing workflow',
      agent: agentFamily('codex'), updatedAt: new Date().toISOString(), freshness: 'unverified',
    } });
    const snapshot = toWebBoardSnapshot(makeProjection({ active: [card] }));
    const html = render(snapshot);
    assert.doesNotMatch(html, /title="active worker family: (codex|custom)"/, 'held preparation has no confirmed provider');
    assert.match(html, /fan spin/, 'workflow activity remains visible');
  });
}

test('CLI pinned wrapper during preparation contributes no provider (TASK-2769)', async () => {
  const { projectProviderExecution, unknownExecution } = await import('../../../../src/application/projections/provider-execution.js');
  const adapter = new ConcreteAgentReadAdapter({
    rootDir: '/fixture', blocklistRepo: new EmptyBlocklistRepo(), knownAgentFamilies: [agentFamily('codex')],
    detectRunningSessions: () => [{ missionId, role: 'execute', startedAtMs: Date.now(), worktree: '/fixture', pinnedAgent: agentFamily('codex') }],
    currentWork: currentWork(nullAgentWork({ agent: agentFamily('codex'), summary: 'preparing workflow' })),
  });
  const wrappers = await adapter.loadRunningSessions();
  const board = makeProjection({ active: [makeCard({ id: missionId })] });
  const observed = projectProviderExecution({ ...board, metrics: { ...board.metrics, agentAvailability: [{ family: agentFamily('codex'), available: true, blockedForMs: 0, runningSessions: wrappers?.length }] } },
    { observe: () => ({ ...unknownExecution(), complete: true, limitations: [] }) });
  assert.equal(observed.metrics.agentAvailability[0].runningSessions, 0, 'wrapper liveness is not provider execution');
});

test('header keeps invocation counts and uncertainty while cards keep actual fallback family (TASK-2769, px-0013)', async () => {
  const { projectProviderExecution } = await import('../../../../src/application/projections/provider-execution.js');
  const board = makeProjection({ active: [makeCard({ id: missionId, currentWork: {
    operationId: 'old', phase: 'execute', summary: 'selected codex', agent: agentFamily('codex'),
    updatedAt: new Date().toISOString(), freshness: 'live',
  } }), makeCard({ id: fixtureMissionId('task-second') })] });
  const availability = ['codex', 'claude'].map(family => ({ family: agentFamily(family), available: true, blockedForMs: 0 }));
  const projected = projectProviderExecution({ ...board, metrics: { ...board.metrics, agentAvailability: availability } }, {
    observe: scope => ({ observedAt: new Date().toISOString(), complete: scope.missionId === missionId,
      limitations: scope.missionId === missionId ? [] : ['probe timed out'],
      invocations: scope.missionId === missionId ? [{ runId: 'execute-claude-a2-test', operationId: 'current', family: agentFamily('claude') }] : [] }),
  });
  assert.deepEqual(projected.metrics.agentAvailability.map(agent => [agent.family, agent.runningSessions, agent.executionComplete]), [['codex', null, false], ['claude', 1, false]]);
  const snapshot = toWebBoardSnapshot(projected);
  const html = render(snapshot);
  assert.doesNotMatch(html, /data-provider-execution|executing|execution unknown/);
  assert.match(html, /title="active worker family: claude"/);
  assert.match(html, />claude<\/span><span[^>]*>1\+<\/span>/);
  assert.match(html, />codex<\/span><span[^>]*>unknown<\/span>/);
  assert.doesNotMatch(html, /title="active worker family: codex"/);
});

test('pending stop preserves execution and missing run evidence makes both surfaces uncertain (TASK-2769)', async () => {
  const { projectProviderExecution } = await import('../../../../src/application/projections/provider-execution.js');
  const { projectWorkflowBoard } = await import('../../../../src/application/projections/workflow-board.js');
  const { workflowOperation } = await import('../../../../src/domain/workflow-operation.js');
  const board = makeProjection({ active: [makeCard({ id: missionId })] });
  const owned = workflowOperation({ id: 'owned', repositoryId: board.repositoryId, missionId, requestKey: 'test', command: 'active:execute',
    generation: 0, phase: 'accepted', providerStarted: false, agent: 'custom', reviewer: null, originalStatus: 'active', previousAssignee: null,
    owner: null, createdAt: '2026-10-16T10:00:00Z', updatedAt: '2026-10-16T10:00:00Z', reason: null });
  const observed = projectProviderExecution({ ...board, metrics: { ...board.metrics, agentAvailability: [{ family: agentFamily('codex'), available: true, blockedForMs: 0 }] } }, {
    observe: () => ({ observedAt: new Date().toISOString(), complete: true, limitations: [], recordedOperationIds: ['owned'],
      invocations: [{ runId: 'execute-codex-a1-test', family: agentFamily('codex'), operationId: 'owned' }] }),
  });
  const stopping = projectWorkflowBoard(observed, [{ ...owned, phase: 'stopping', providerStarted: true }]);
  assert.equal(stopping.metrics.agentAvailability[0].runningSessions, 1, 'stop request alone is not provider exit');
  assert.equal(stopping.stages.flatMap(stage => stage.cards)[0].execution?.invocations[0].family, 'codex');
  const missing = projectWorkflowBoard(projectProviderExecution(observed, { observe: () => ({ observedAt: new Date().toISOString(), complete: true, limitations: [], invocations: [], recordedOperationIds: [] }) }), [{ ...owned, providerStarted: true }]);
  assert.equal(missing.metrics.agentAvailability[0].runningSessions, null);
  assert.equal(missing.stages.flatMap(stage => stage.cards)[0].execution?.complete, false);
  const foreign = projectWorkflowBoard(observed, [{ ...owned, repositoryId: 'other' as typeof owned.repositoryId, providerStarted: true }]);
  assert.equal(foreign.stages.flatMap(stage => stage.cards)[0].currentWork, null, 'same MissionId in another repository cannot own this card');
  assert.equal(foreign.metrics.agentAvailability[0].runningSessions, 1);
});
