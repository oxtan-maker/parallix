import test from 'node:test';
import assert from 'node:assert/strict';
import { agentFamily } from '../src/domain/agents.js';
import type { MissionId } from '../src/domain/mission.js';
import {
  CurrentWorkRecorder,
  reviewLoopPublisher,
} from '../src/application/recording/current-work-recorder.js';
import { reconcileCurrentWork } from '../src/application/projections/current-work.js';
import { ConcreteAgentReadAdapter } from '../src/adapters/backlog/concrete-agent-read-adapter.js';
import type { AgentBlockEntry, AgentBlocklistRepository } from '../src/application/ports/agent-blocklist.js';
import type { SessionMarkerEntry, SessionMarkerRepository } from '../src/application/ports/mission-store.js';
import type { CurrentWorkEvent } from '../src/application/recording/current-work-recorder.js';

// ---------------------------------------------------------------------------
// TASK-2416 — regression + behavior guards for board-strip family attribution.
//
// This is a genuine red-then-green regression test for a real defect (see
// missions/task-2416/CP-1.md): the review loop's own agents run `px review
// --start` / `--submit` / `--consume-artifacts`, each a separate process under
// its own operationId (all in `PUBLISHED_PHASES`). Their nested `running`
// fact shadowed the outer `px review --continue` loop's family-carrying fact,
// attributing the live continuation as `family unknown`, and their `ended`
// then cleared the mission's live work entirely even though the outer process
// was still alive. The fix lives in `reconcileCurrentWork`
// (`src/application/projections/current-work.ts`): a `running` event from a
// different, still-alive process no longer supersedes the outer operation's
// family-carrying fact.
// ---------------------------------------------------------------------------

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
  repo: import('../src/application/ports/operation-history.js').OperationalHistoryRepository;
  events: readonly CurrentWorkEvent[];
} {
  const events: CurrentWorkEvent[] = [];
  let seq = 0;
  const repo: any = {
    async append(entry: { eventData: string; createdAt: string }) {
      const data = JSON.parse(entry.eventData);
      events.push({
        missionId: data.missionId,
        operationId: data.operationId,
        phase: data.phase,
        state: data.state,
        summary: data.summary,
        agent: data.agent,
        processId: data.processId,
        processIdentity: data.processIdentity ?? null,
        blockedReason: data.blockedReason,
        occurredAt: entry.createdAt,
        sequence: seq += 1,
      });
    },
    async findAll() { return []; },
    async findByOperationId() { return undefined; },
    async save() {},
    async deleteByOperationId() {},
    async clear() {},
  };
  return { repo: repo as any, events };
}

const missionId = 'task-2416' as MissionId;
const LIVE_WORKTREE = '/home/dev/parallix-task-2416';

function currentWorkReader(events: readonly CurrentWorkEvent[]) {
  return { async loadCurrentWork() { return events; } };
}

/** Drive the real review-loop publication seam for a launched reviewer. */
async function publishReviewLaunch(
  recorder: import('../src/application/recording/current-work-recorder.js').CurrentWorkPort,
  operation: { readonly slug: string; readonly operationId: string },
  agent: string,
): Promise<void> {
  const pub = reviewLoopPublisher(recorder, operation);
  await pub.onAgentLaunched(agent, 'review');
}

/**
 * The regression guard (TASK-2416). Publishes, in the order a live review round
 * actually produces them: the outer `px review --continue` bracket, the loop's
 * agent-launch fact (carrying the family), then a nested `running({agent:
 * null})` from a *different* operationId and *different* live pid (the nested
 * `px review --start` the loop's own agents run), then that nested operation's
 * `ended`. Asserts the live review continuation still attributes its family and
 * still reports live work after the nested operation closes.
 *
 * This fails without the reconcileCurrentWork fix: the nested null-family fact
 * supersedes the outer family-carrying fact (family -> null) and the nested
 * `ended` then clears the mission's current work entirely.
 */
test('TASK-2416 repro: a nested px review --start must not shadow the outer review family', async () => {
  const { repo, events } = memoryHistoryRepo();
  const outer = new CurrentWorkRecorder(repo, { processId: 100 });

  // Outer `px review --continue` run() bracket.
  await outer.running({
    missionId,
    operationId: 'opA',
    phase: 'review',
    summary: 'px review --continue task-2416',
    agent: null,
  });
  // The review loop launches a claude reviewer — this fact carries the family.
  await publishReviewLaunch(outer, { slug: 'task-2416', operationId: 'opA' }, 'claude');

  // Nested `px review --start` runs as a separate process (pid 200) under a
  // different operationId, publishing its own bracket with agent: null.
  const nested = new CurrentWorkRecorder(repo, { processId: 200 });
  await nested.running({
    missionId,
    operationId: 'opB',
    phase: 'review',
    summary: 'px review --start task-2416',
    agent: null,
  });

  // During the nested --start the outer continuation must still attribute claude.
  const mid = reconcileCurrentWork(events, {
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
    resolveTaskFile: () => ({ ok: false, matches: [] }),
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
  const recorder = new CurrentWorkRecorder(repo, { processId: 4322 });
  // A live non-agent `px draft <slug>` publishes a running fact with agent: null.
  await recorder.running({
    missionId,
    operationId: 'draft:task-2416:guard',
    phase: 'execute',
    summary: 'px draft task-2416',
    agent: null,
  });

  const adapter = new ConcreteAgentReadAdapter({
    rootDir: '/home/dev/parallix',
    blocklistRepo: new EmptyBlocklistRepo(),
    knownAgentFamilies: [agentFamily('claude'), agentFamily('custom')],
    resolveTaskFile: () => ({ ok: false, matches: [] }),
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
  const deadEvent: CurrentWorkEvent = {
    missionId,
    operationId: 'review:task-2416:dead',
    phase: 'review',
    state: 'running',
    summary: 'px review --continue task-2416',
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
    resolveTaskFile: () => ({ ok: false, matches: [] }),
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
