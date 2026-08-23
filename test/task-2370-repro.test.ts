/**
 * TASK-2370 reproduction — the board cannot tell live mission work from work
 * that needs an operator, and an open interactive board never notices an
 * externally caused change.
 *
 * Three defects, one per test:
 *
 *  A. `BoardProjectionBuilder` hard-codes `currentWork: null`, so a live
 *     operation is invisible in the shared projection.
 *  B. Liveness is inferred from an OS-process scan, so a live review phase run
 *     by another family is misidentified as "nobody is working" and the mission
 *     is pushed into the human attention queue.
 *  C. An already-open interactive board renders one static projection; a change
 *     made by another `px` process is not observed without a restart.
 *
 * Every test is hermetic: no agent launch, no Git, no database, no process
 * scan. The current-work reader and the projection subscription are supplied as
 * plain in-memory fakes.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { BoardProjectionBuilder } from '../src/application/projections/board-readers.js';
import type {
  AgentReadAdapter,
  GateReadAdapter,
  GitReadAdapter,
  MissionReadAdapter,
  OperationLogReadAdapter,
  ReviewReadAdapter,
} from '../src/application/projections/board-readers.js';
import { agentFamily } from '../src/domain/agents.js';
import { missionId, missionLabels, type Mission } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';
import { makeCard, makeProjection } from './fixtures/board-projection.js';

const repo = repositoryId('parallix');
const liveMission = missionId('task-0001');

function makeMissionAdapter(missions: readonly Mission[]): MissionReadAdapter {
  return {
    async loadAllMissions() { return missions; },
    async loadMission(id) { return missions.find((mission) => mission.id === id) ?? null; },
    getSourceFacts() { return [{ source: 'task-markdown', status: 'fresh' as const, value: 'loaded' }]; },
  };
}

const reviews: ReviewReadAdapter = {
  async loadReviews(ids) { return new Map(ids.map((id) => [id, { review: null, approval: null }])); },
};

const gates: GateReadAdapter = { async loadGateStatus() { return 'passed'; } };

const git: GitReadAdapter = {
  async loadRepositoryId() { return repo; },
  async loadHeadCommit() { return 'head-commit'; },
};

const operationLog: OperationLogReadAdapter = { async loadOperationLog() { return []; } };

/** Agent adapter whose process scan reports the given running sessions. */
function makeAgentAdapter(
  runningSessions: readonly { missionId: ReturnType<typeof missionId>; family: ReturnType<typeof agentFamily> | null }[] | null,
): AgentReadAdapter {
  return {
    async loadAgentAvailability() {
      return [
        { family: agentFamily('claude'), launcherAvailable: true, block: { kind: 'none' } },
        { family: agentFamily('qwen'), launcherAvailable: true, block: { kind: 'none' } },
      ];
    },
    async loadAssignedAgent() { return agentFamily('claude'); },
    async loadRunningSessions() { return runningSessions; },
  };
}

function mission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: liveMission,
    repositoryId: repo,
    title: 'Live mission',
    labels: missionLabels(['bug']),
    status: 'active',
    closedAt: null,
    assignee: agentFamily('claude'),
    checkpoints: [],
    review: null,
    netEngineeringLines: null,
    ...overrides,
  } as Mission;
}

/**
 * An in-memory current-work authority. Production supplies the operational-fact
 * reader; the shape asserted here is the one the board consumes.
 */
function makeCurrentWorkAdapter(records: readonly unknown[]) {
  return { async loadCurrentWork() { return records; } };
}

// ---------------------------------------------------------------------------
// A. A live operation has no projected current work
// ---------------------------------------------------------------------------

test('TASK-2370 repro A: a live operation is projected as current work on the board card', async () => {
  const builder = new BoardProjectionBuilder(
    makeMissionAdapter([mission()]),
    reviews,
    gates,
    makeAgentAdapter([{ missionId: liveMission, family: agentFamily('claude') }]),
    git,
    operationLog,
    {
      currentWork: makeCurrentWorkAdapter([{
        missionId: liveMission,
        operationId: 'op-active-1',
        phase: 'execute',
        state: 'running',
        summary: 'running execute agent',
        agent: agentFamily('claude'),
        processId: process.pid,
        occurredAt: new Date().toISOString(),
        blockedReason: null,
      }]),
    } as never,
  );

  const projection = await builder.build();
  const card = projection.stages.flatMap((stage) => stage.cards).find((entry) => entry.id === liveMission);

  assert.ok(card, 'the live mission must appear on the board');
  assert.ok(card.currentWork, 'a live operation must project current work rather than null');
  assert.equal(card.currentWork.phase, 'execute');
  assert.equal(card.currentWork.agent, agentFamily('claude'));
  assert.equal(card.currentWork.summary, 'running execute agent');
});

// ---------------------------------------------------------------------------
// B. Process inference misidentifies a live non-active phase
// ---------------------------------------------------------------------------

test('TASK-2370 repro B: a live review phase is not misidentified as needing a human when the process scan sees nothing', async () => {
  const builder = new BoardProjectionBuilder(
    makeMissionAdapter([mission({ status: 'review' })]),
    reviews,
    gates,
    // The process scan cannot attribute `px review` to a mission, so it reports
    // no running session at all. That must not conclude "nobody is working".
    makeAgentAdapter([]),
    git,
    operationLog,
    {
      currentWork: makeCurrentWorkAdapter([{
        missionId: liveMission,
        operationId: 'op-review-1',
        phase: 'review',
        state: 'running',
        summary: 'reviewer round 1',
        agent: agentFamily('qwen'),
        processId: process.pid,
        occurredAt: new Date().toISOString(),
        blockedReason: null,
      }]),
    } as never,
  );

  const projection = await builder.build();
  const card = projection.stages.flatMap((stage) => stage.cards).find((entry) => entry.id === liveMission);
  const attention = projection.attentionQueue.find((item) => item.missionId === liveMission);

  assert.ok(card?.currentWork, 'a live review operation must project current work');
  assert.equal(card.currentWork.phase, 'review');
  assert.equal(card.currentWork.agent, agentFamily('qwen'), 'the authoritative family must win over the process scan');
  assert.equal(attention?.reason.kind, 'none', 'a mission with live work is WORKING, not NEEDS YOU');
});

// ---------------------------------------------------------------------------
// C. An open interactive board does not observe an external change
// ---------------------------------------------------------------------------

class Stream extends EventEmitter {
  public columns = 120;
  public rows = 30;
  public readonly isTTY = true;
  public readonly writes: string[] = [];
  write(value: string): boolean { this.writes.push(value); return true; }
  setRawMode(_enabled: boolean): void {}
  setEncoding(_encoding: string): void {}
  resume(): void {}
  ref(): void {}
  unref(): void {}
  read(): string | null { return null; }
}

test('TASK-2370 repro C: an already-open interactive board rebuilds after an external board-relevant change', async () => {
  const ink = await import('ink');
  const React = await import('react');
  const { BoardShell } = await import('../src/interfaces/tui/shell.js');

  const before = makeProjection({ refined: [makeCard({ id: 'task-before' as never, lane: 'refined', status: 'refined', rawStatus: 'refined' })] });
  const after = makeProjection(
    { active: [makeCard({ id: 'task-after' as never, lane: 'active', status: 'active', rawStatus: 'active' })] },
    'after-repository',
  );

  // Stands in for another `px` process changing shared state: the application
  // boundary hands the shell a new projection; the shell must re-render it.
  let publish: ((_projection: unknown) => void) | null = null;
  const subscribeProjection = (onChange: (_projection: unknown) => void) => {
    publish = onChange;
    return () => { publish = null; };
  };

  const stdin = new Stream();
  const stdout = new Stream();
  const instance = ink.render(
    React.createElement(BoardShell, { projection: before, subscribeProjection } as never),
    { stdin: stdin as unknown as NodeJS.ReadStream, stdout: stdout as unknown as NodeJS.WriteStream, patchConsole: false, exitOnCtrlC: false },
  );

  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.ok(publish, 'the shell must subscribe to shared projection changes while it is open');
  publish(after);
  await new Promise((resolve) => setTimeout(resolve, 60));
  instance.unmount();

  const rendered = stdout.writes.join('');
  assert.match(rendered, /after-repository/, 'the open board must show the externally changed projection without a restart');
});
