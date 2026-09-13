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
import { agentFamily } from '../src/domain/agents.js';
import type { MissionId } from '../src/domain/mission.js';
import { ConcreteAgentReadAdapter } from '../src/adapters/backlog/concrete-agent-read-adapter.js';
import type { AgentBlockEntry, AgentBlocklistRepository } from '../src/application/ports/agent-blocklist.js';
import type { CurrentWorkReadAdapter } from '../src/application/projections/current-work.js';
import type { CurrentWorkEvent } from '../src/application/recording/current-work-recorder.js';
import type { SessionMarkerEntry, SessionMarkerRepository } from '../src/application/ports/mission-store.js';
import type { AgentFamily } from '../src/domain/agents.js';
import { Board } from '../web/src/board.js';
import { toWebBoardSnapshot } from '../src/interfaces/web/transport.js';
import type { MissionCard } from '../src/application/projections/mission-board.js';
import { makeCard, makeProjection } from './fixtures/board-projection.js';

const missionId = 'task-2498' as MissionId;

// ---------------------------------------------------------------------------
// Defect 1 — web flight-card agent pill (SC1, SC2)
// ---------------------------------------------------------------------------

const render = (snapshot: ReturnType<typeof toWebBoardSnapshot>): string =>
  renderToStaticMarkup(React.createElement(Board, { snapshot, onRefresh: async () => {} }));

test('a working card with a null live agent renders "no implementer", never the assignee family', () => {
  const workingNull = makeCard({
    id: 'task-2498' as MissionCard['id'],
    lane: 'review',
    status: 'review',
    agent: agentFamily('custom'),
    currentWork: {
      operationId: 'review:task-2498:current',
      phase: 'review',
      summary: 'px review --continue',
      agent: null,
      updatedAt: '2026-09-12T10:00:00.000Z',
      freshness: 'live',
    },
  });
  const html = render(toWebBoardSnapshot(makeProjection({ review: [workingNull] })));
  assert.match(html, /no implementer/, 'the null live agent renders as absent implementer');
  assert.doesNotMatch(html, /custom/, 'the assignee family must never appear in the pill');
});

test('an idle card still renders its assignee family unchanged', () => {
  const idle = makeCard({
    id: 'task-2498b' as MissionCard['id'],
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
    phase: 'review',
    state: 'running',
    summary: 'px review --continue',
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
    resolveTaskFile: () => ({ ok: true, taskFile: '/home/dev/parallix-task-2498/task-2498.md', matches: [] }),
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
  assert.deepEqual(await adapter.loadRunningSessions(), [{ missionId, family: 'custom' as AgentFamily }]);
});

test('a live non-null agent session still attributes to that agent (SC5)', async () => {
  const adapter = new ConcreteAgentReadAdapter({
    rootDir: '/home/dev/parallix',
    blocklistRepo: new EmptyBlocklistRepo(),
    knownAgentFamilies: [agentFamily('claude')],
    resolveTaskFile: () => ({ ok: false, matches: [] }),
    currentWork: currentWork(nullAgentWork({ agent: agentFamily('claude') })),
    detectRunningSessions: () => [{
      missionId,
      role: null,
      startedAtMs: Date.now(),
      worktree: '/home/dev/parallix-task-2498',
      pinnedAgent: null,
    }],
  });
  assert.deepEqual(await adapter.loadRunningSessions(), [{ missionId, family: 'claude' as AgentFamily }]);
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
    resolveTaskFile: () => ({ ok: true, taskFile: '/home/dev/parallix-task-2498/task-2498.md', matches: [] }),
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
