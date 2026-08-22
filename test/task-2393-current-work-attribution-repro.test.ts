import test from 'node:test';
import assert from 'node:assert/strict';
import { agentFamily } from '../src/domain/agents.js';
import type { MissionId } from '../src/domain/mission.js';
import { ConcreteAgentReadAdapter } from '../src/adapters/backlog/concrete-agent-read-adapter.js';
import type { AgentBlockEntry, AgentBlocklistRepository } from '../src/application/ports/agent-blocklist.js';
import type { CurrentWorkReadAdapter } from '../src/application/projections/current-work.js';
import { CURRENT_WORK_TTL_MS } from '../src/application/projections/current-work.js';
import type { CurrentWorkEvent } from '../src/application/recording/current-work-recorder.js';
import type { SessionMarkerEntry, SessionMarkerRepository } from '../src/application/ports/mission-store.js';

class EmptyBlocklistRepo implements AgentBlocklistRepository {
  async findAll(): Promise<readonly AgentBlockEntry[]> { return []; }
  async findByAgent(): Promise<AgentBlockEntry | undefined> { return undefined; }
  async save(): Promise<void> { /* unused */ }
  async deleteByAgent(): Promise<void> { /* unused */ }
  async clear(): Promise<void> { /* unused */ }
}

const missionId = 'task-2393' as MissionId;
function work(overrides: Partial<CurrentWorkEvent> = {}): CurrentWorkEvent {
  return {
    missionId,
    operationId: 'review:task-2393:current',
    phase: 'review',
    state: 'running',
    summary: 'px review --continue',
    agent: agentFamily('claude'),
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
    resolveTaskFile: () => ({ ok: false, matches: [] }),
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
    [currentWork(work({ occurredAt: new Date(Date.now() - CURRENT_WORK_TTL_MS - 1).toISOString() })), undefined],
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
      repositoryId: 'parallix' as SessionMarkerEntry['repositoryId'], missionId, role: 'execute', agent: agentFamily('custom'),
      lastLaunched: new Date(Date.now() + 1_000).toISOString(), sessionId: null, updatedAt: new Date().toISOString(),
    }]),
    detectRunningSessions: () => [{ missionId, role: 'execute', startedAtMs: Date.now(), worktree: null, pinnedAgent: 'custom' }],
  });
  assert.deepEqual(await adapter.loadRunningSessions(), [{ missionId, family: 'claude' }]);
});
