import { configureMissionWriteAuthorization } from '../../../../src/application/ports/mission-write-authorization.js';
import { activitySnapshots, projectActivityPublications, ActivityRecorderFixture } from '../../../fixtures/execution-activity.js';
import { missionId as fixtureMissionId } from '../../../../src/domain/mission.js';
// review current work family contract.
// Related scenarios share imports; each contract keeps its own hooks and mutable fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { agentFamily } from '../../../../src/domain/agents.js';
import { type MissionId } from '../../../../src/domain/mission.js';
import {
  parseExecutionActivityEntry,
  reviewLoopPublisher,
  type ExecutionActivity,
} from '../../../../src/application/recording/execution-activity-recorder.js';
import { ConcreteAgentReadAdapter } from '../../../../src/adapters/backlog/concrete-agent-read-adapter.js';
import { type AgentBlockEntry, type AgentBlocklistRepository } from '../../../../src/application/ports/agent-blocklist.js';
import { type SessionMarkerEntry, type SessionMarkerRepository } from '../../../../src/application/ports/mission-store.js';

// TASK-2416 originally fixed a nested CLI bracket masking the live reviewer's
// family, then clearing the parent when the child ended. Preserve that behavior
// through inherited child authorization: evidence/verdict writers cannot publish
// or settle parent activity. A live non-agent publisher remains family unknown,
// and a dead publisher contributes no family attribution.

class EmptyBlocklistRepo implements AgentBlocklistRepository {
  async findAll(): Promise<readonly AgentBlockEntry[]> { return []; }
  async findByAgent(): Promise<AgentBlockEntry | undefined> { return undefined; }
  async save(): Promise<void> { /* unused */ }
  async deleteByAgent(): Promise<void> { /* unused */ }
  async clear(): Promise<void> { /* unused */ }
}

class Markers implements SessionMarkerRepository {
  constructor(private readonly _entries: readonly SessionMarkerEntry[]) {}
  async findAll(): Promise<readonly SessionMarkerEntry[]> { return this._entries; }
  async findByMissionAndRole(): Promise<SessionMarkerEntry | undefined> { return undefined; }
  async save(): Promise<void> { /* unused */ }
  async deleteByMissionAndRole(): Promise<void> { /* unused */ }
  async clear(): Promise<void> { /* unused */ }
}

/** A minimal append-only operational-history repo the recorder writes to. */
function memoryHistoryRepo(): {
  repo: import('../../../../src/application/ports/operation-history.js').OperationalHistoryRepository;
  events: readonly ExecutionActivity[];
} {
  const events: ExecutionActivity[] = [];
  let seq = 0;
  const repo: import('../../../../src/application/ports/operation-history.js').OperationalHistoryRepository = {
    async append(entry) {
      const parsed = parseExecutionActivityEntry({ ...entry, id: ++seq });
      if (parsed) { events.push(parsed); }
    },
    async findAll() { return []; },
    async findByType() { return []; },
    async clear() {},
  };
  return { repo: repo, events };
}

const missionId = fixtureMissionId('task-2416') as MissionId;
const LIVE_WORKTREE = '/home/dev/parallix-task-2416';

function currentWorkReader(events: readonly ExecutionActivity[]) {
  return { async loadCurrentWork() { return activitySnapshots(events); }, async loadMissionCurrentWork(id: MissionId) { return activitySnapshots(events.filter(event => event.missionId === id)); } };
}

/** Drive the real review-loop publication seam for a launched reviewer. */
async function publishReviewLaunch(
  recorder: import('../../../../src/application/recording/execution-activity-recorder.js').ExecutionActivityPort,
  operation: { readonly slug: string; readonly operationId: string },
  agent: string,
): Promise<void> {
  const pub = reviewLoopPublisher(recorder, operation);
  await pub.onAgentLaunched(agent, 'review');
}

test('TASK-2416 repro: a nested px review must not shadow the outer review family', async t => {
  t.after(() => configureMissionWriteAuthorization(null));
  const { repo, events } = memoryHistoryRepo();
  const outer = new ActivityRecorderFixture(repo, { processId: 100 });

  // Outer `px review` run() bracket.
  await outer.running({
    missionId,
    operationId: 'opA',
    phase: 'review',
    summary: 'px review task-2416',
    agent: null,
  });
  // The review loop launches a claude reviewer — this fact carries the family.
  await publishReviewLaunch(outer, { slug: 'task-2416', operationId: 'opA' }, 'claude');

  // Nested `px review` runs as a separate process (pid 200) under a
  // different operationId, publishing its own bracket with agent: null.
  configureMissionWriteAuthorization({ operationId: 'opA', inherited: true, assert: async () => {} });
  const nested = new ActivityRecorderFixture(repo, { processId: 200 });
  await nested.running({
    missionId,
    operationId: 'opB',
    phase: 'review',
    summary: 'px review task-2416',
    agent: null,
  });

  // The nested evidence write must leave the running reviewer attributed to claude.
  const mid = projectActivityPublications(events, {
    nowMs: Date.now(),
    ttlMs: 5 * 60 * 1000,
    isProcessAlive: () => true,
  });
  assert.equal(mid.get(missionId)?.currentWork?.agent, 'claude',
    'the nested null-family bracket must not shadow the outer family-carrying fact');

  // The nested operation closes.
  await nested.ended({
    missionId,
    operationId: 'opB',
    phase: 'review',
    summary: 'nested review finished',
    agent: null,
  });

  const adapter = new ConcreteAgentReadAdapter({
    rootDir: '/home/dev/parallix',
    blocklistRepo: new EmptyBlocklistRepo(),
    knownAgentFamilies: [agentFamily('claude')],
    resolveTaskFile: () => ({ ok: false as const, matches: [] }),
    sessionMarkers: new Markers([]),
    currentWork: currentWorkReader(events),
    isProcessAlive: () => true,
    detectRunningSessions: () => [{
      missionId,
      role: null,
      startedAtMs: Date.now(),
      worktree: LIVE_WORKTREE,
      pinnedAgent: null,
    }],
  });

  const sessions = await adapter.loadRunningSessions();
  assert.deepEqual(sessions, [
    { missionId, family: 'claude' },
  ], 'after the nested operation closes, the outer review continuation must still attribute its family and report live work');
});

test('TASK-2416 guard: a live non-agent operation that publishes a null current-work fact stays family unknown', async () => {
  // The interesting case the mission risk section names: a non-agent operation
  // that *does* publish a current-work fact with agent: null must NOT fabricate
  // a family from the live session (a broken implementation that attributed a
  // family from the session alone would fail this). Drive the path through a
  // real published fact, not empty events.
  const { repo, events } = memoryHistoryRepo();
  const recorder = new ActivityRecorderFixture(repo, { processId: 4322 });
  // A live non-agent `px draft <slug>` publishes a running fact with agent: null.
  await recorder.running({
    missionId,
    operationId: 'draft:task-2416:guard',
    phase: 'draft',
    summary: 'px draft task-2416',
    agent: null,
  });

  const adapter = new ConcreteAgentReadAdapter({
    rootDir: '/home/dev/parallix',
    blocklistRepo: new EmptyBlocklistRepo(),
    knownAgentFamilies: [agentFamily('claude'), agentFamily('custom')],
    resolveTaskFile: () => ({ ok: false as const, matches: [] }),
    sessionMarkers: new Markers([]),
    currentWork: currentWorkReader(events),
    detectRunningSessions: () => [{
      missionId,
      role: 'draft',
      startedAtMs: Date.now(),
      worktree: LIVE_WORKTREE,
      pinnedAgent: null,
    }],
  });

  const sessions = await adapter.loadRunningSessions();
  assert.deepEqual(sessions, [
    { missionId, family: null },
  ], 'a live non-agent operation with agent: null must stay family unknown, not fabricate a family');
});

test('TASK-2416 guard: a dead recording process shows no family attribution', async () => {
  // A current-work fact whose publishing process is observed dead reconciles to
  // no current work at all, so a live scan of that mission yields no family
  // attribution (and, per the board, no live blink either).
  const deadEvent: ExecutionActivity = {
    missionId,
    operationId: 'review:task-2416:dead',
    phase: 'review',
    state: 'running',
    summary: 'px review task-2416',
    agent: agentFamily('claude'),
    processId: 9999,
    blockedReason: null,
    occurredAt: new Date().toISOString(),
    sequence: 1,
  };
  const adapter = new ConcreteAgentReadAdapter({
    rootDir: '/home/dev/parallix',
    blocklistRepo: new EmptyBlocklistRepo(),
    knownAgentFamilies: [agentFamily('claude')],
    resolveTaskFile: () => ({ ok: false as const, matches: [] }),
    sessionMarkers: new Markers([]),
    currentWork: currentWorkReader([deadEvent]),
    isProcessAlive: () => false,
    detectRunningSessions: () => [{
      missionId,
      role: null,
      startedAtMs: Date.now(),
      worktree: LIVE_WORKTREE,
      pinnedAgent: null,
    }],
  });

  const sessions = await adapter.loadRunningSessions();
  assert.deepEqual(sessions, [
    { missionId, family: null },
  ], 'a dead recording process must not attribute a family');
});
