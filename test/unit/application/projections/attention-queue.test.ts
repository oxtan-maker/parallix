// Historical regression provenance: TASK-2444.
// Attention queue contract: which missions the board asks a human (or the supervisor) to look at, how
// they rank, and what source facts back each reason.
//
// Behavior-owned suite (TASK-2622.12). Case names are unchanged; each section keeps its legacy file.
//   Orphaned active mission attention: no task ID in the legacy file
//   Attention queue ranking and sources: TASK-2444

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test, { describe } from 'node:test';
import type { MissionStore } from '../../../../src/application/domain-ports.js';
import type { BoardProjection } from '../../../../src/application/projections/board.js';
import { buildBoardMetrics, buildBoardProjection } from '../../../../src/application/projections/board.js';
import type { BoardLane, MissionCard } from '../../../../src/application/projections/mission-board.js';
import { CURRENT_WORK_EVENT_TYPE, currentWorkEventToEntry, type CurrentWorkEvent } from '../../../../src/application/recording/current-work-recorder.js';
import { composeBoardProjection } from '../../../../src/composition/board-projection.js';
import { agentFamily } from '../../../../src/domain/agents.js';
import type { Mission, MissionId, MissionStatus } from '../../../../src/domain/mission.js';
import { missionId, missionLabels } from '../../../../src/domain/mission.js';
import { repositoryId } from '../../../../src/domain/repository.js';
import { mkdtemp as registeredMkdtemp } from '../../../helpers/temp-dir.js';

// ── Orphaned active mission attention (was attention-orphaned-active-observable.test.ts) ──


/**
 * Regression for the stranded-active observation boundary: a mission whose
 * aggregate is `active` but whose board carries no live work (no published
 * `current-work` fact and no live session) must surface an `orphaned-active`
 * attention item that dispatches to `px active`. Previously the attention
 * projection emitted `kind: 'none'` for such a card, so an abandoned `active`
 * mission dwelt in the queue forever with no human handoff.
 *
 * Hermetic doubles only — no shimmed git CLI, launcher probe, or OS process
 * scan. `historyRepo.findByType` returns no current-work events, so the
 * stranded mission has no standing work fact.
 */
const repository = repositoryId('orphaned-active-observation-repo');

interface BoardHarness {
  readonly root: string;
  readonly projection: BoardProjection;
}

function mission(id: string, status: MissionStatus): Mission {
  return {
    id: missionId(id), repositoryId: repository, title: id, labels: [], assignee: null,
    checkpoints: [], review: null, netEngineeringLines: null, status, closedAt: null,
  };
}

function storeFor(persisted: readonly Mission[]): MissionStore {
  return {
    async load(id: MissionId) {
      const found = persisted.find((candidate) => candidate.id === id);
      return found
        ? { kind: 'found' as const, mission: found, version: 1 as never }
        : { kind: 'missing' as const };
    },
    async save() { return 1 as never; },
    async loadByRepository() { return persisted; },
  };
}

// Hermetic doubles: no shimmed git CLI, launcher probe, or OS process scan.
const gitDouble = () => ({ status: 0, stdout: '', stderr: '' });

async function board(store: MissionStore, currentWork: readonly CurrentWorkEvent[] = []): Promise<BoardHarness> {
  const root = registeredMkdtemp('orphaned-active-');
  const historyEvents = currentWork.map((event) => currentWorkEventToEntry(event));
  const projection = await composeBoardProjection({
    rootDir: root,
    missionStore: store,
    repositoryId: repository,
    blocklistRepo: { async findAll() { return []; } } as never,
    // A non-empty current-work list publishes a standing work fact for the
    // mission, so the board must treat it as worked on (not stranded).
    historyRepo: {
      async findAll() { return []; },
      async findByType(type: string) { return type === CURRENT_WORK_EVENT_TYPE ? historyEvents : []; },
    } as never,
    laneEventRepo: { async findAll() { return []; } } as never,
    usageRepo: { async findAll() { return []; } } as never,
    knownAgentFamilies: [],
    launcherProbe: () => ({ available: true, detail: null }),
    readAgentConfig: () => null,
    detectRunningSessions: () => null,
    gitFn: gitDouble,
  }).builder.build();
  return { root, projection };
}

test('attention orphaned-active mission surfaces active resume item', async () => {
  const { root, projection } = await board(storeFor([mission('task-stranded', 'active')]));
  try {
    const card = projection.stages
      .flatMap((stage) => stage.cards)
      .find((c) => c.id === missionId('task-stranded'));

    // The stranded mission projects to the active lane.
    assert.ok(card, 'mission must be present on the board');
    assert.equal(card?.lane, 'active');

    // The active command is enabled on the card so the attention item is not
    // filtered out by the enabled-command gate.
    const activeCmd = card?.commands.find((c) => c.command === 'active');
    assert.ok(activeCmd?.enabled, 'active command must be enabled for a stranded active mission');

    // The attention queue carries the mission with the orphaned-active reason
    // and dispatches it to `px active <id>`.
    const item = projection.attentionQueue.find((i) => i.missionId === missionId('task-stranded'));
    assert.ok(item, 'attention queue must enqueue the stranded active mission');
    assert.deepEqual(item?.reason, { kind: 'orphaned-active', detail: 'Active mission has no live work' });
    assert.equal(item?.action.kind, 'active:execute');
    assert.equal(item?.action.display, `px active ${card!.id}`);
    // The stranded verdict rests on the DB-backed Mission lane, not the task
    // file (ADR 0053 / SC3): this item must declare the mission-store authority.
    assert.deepEqual(item?.dependsOnSources, ['mission-store']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// Negative control: a stranded mission is only an attention item when no agent
// actually holds the turn. A fresh published current-work fact means the
// mission is being worked on and must NOT surface the stranded item.
test('attention active mission with live work stays quiet', async () => {
  const liveWork: CurrentWorkEvent = {
    missionId: missionId('task-live'),
    operationId: 'active:task-live:run',
    phase: 'execute',
    state: 'running',
    summary: 'execute run in progress',
    agent: agentFamily('codex'),
    // A null processId makes `runningFreshness` fall back to the age check,
    // which is fresh here, so the fact is `unverified` — counted as in
    // progress by `isWorkInProgress`. This keeps the negative control free of
    // any real OS process dependency.
    processId: null,
    blockedReason: null,
    occurredAt: new Date().toISOString(),
  };
  const { root, projection } = await board(storeFor([mission('task-live', 'active')]), [liveWork]);
  try {
    const card = projection.stages
      .flatMap((stage) => stage.cards)
      .find((c) => c.id === missionId('task-live'));

    assert.ok(card, 'mission must be present on the board');
    const item = projection.attentionQueue.find((i) => i.missionId === missionId('task-live'));
    assert.equal(item, undefined, 'an actively worked mission must not enqueue an orphaned-active item');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// A mission genuinely closed in the store must never be mistaken for stranded.
test('attention a done mission is not stranded', async () => {
  const { projection } = await board(storeFor([mission('task-done', 'done')]));
  const item = projection.attentionQueue.find((i) => i.missionId === missionId('task-done'));
  assert.equal(item, undefined, 'a done mission must never surface an orphaned-active item');
});

// ── Attention queue ranking and sources — TASK-2444 (was task-2444-attention-queue-repro.test.ts) ──
describe("Attention queue ranking and sources —", () => {
  const repo = repositoryId('task-2444');

  function makeCard(
    id: string,
    lane: BoardLane,
    opts: Partial<Pick<MissionCard, 'blockingReason' | 'gate' | 'currentWork' | 'commands'>> = {},
  ): MissionCard {
    return {
      id: missionId(id), repositoryId: repo, title: id, labels: missionLabels(['user_value']),
      lane, status: lane, rawStatus: lane, closed: lane === 'done', agent: agentFamily('codex'),
      checkpoint: null, checkpointDescription: null, checkpointEvidence: [], nextActionText: null,
      gate: opts.gate ?? 'passed', pullRequest: null, reviewApproved: false,
      reviewRound: null, reviewPhase: null, reviewDisposition: null, reviewHistory: [],
      currentWork: opts.currentWork ?? null, blockingReason: opts.blockingReason ?? null,
      flags: [], commands: opts.commands ?? [{ command: lane === 'integration' ? 'integrate' : lane === 'review' ? 'review' : 'active', enabled: true, reason: null }],
    };
  }

  function project(cards: readonly MissionCard[], sourceFacts: Parameters<typeof buildBoardProjection>[5] = []) {
    return buildBoardProjection(
      repo, cards, [], [],
      buildBoardMetrics({ cumulativeFlow: { series: [], missingHistoryFallback: 'null' }, medianStateTimes: { series: [], missingHistoryFallback: 'null' }, throughput: { series: [], missingHistoryFallback: 'skip' }, reviewBounceRate: { series: [], missingHistoryFallback: 'estimate' } }),
      sourceFacts,
    );
  }

  test('task-2444: all-backlog cards produce no attention items', () => {
    assert.equal(project([makeCard('task-2444-a', 'backlog'), makeCard('task-2444-b', 'backlog')]).attentionQueue.length, 0);
  });

  test('task-2444: mixed-lane attention ranks are contiguous ordinals', () => {
    const mixed = project([
      makeCard('task-2444-blocking', 'active', { blockingReason: 'decision required' }),
      makeCard('task-2444-gate', 'active', { gate: 'failed' }),
      makeCard('task-2444-review', 'review'),
      makeCard('task-2444-integrate', 'integration'),
      makeCard('task-2444-stale', 'active', { currentWork: { operationId: 'op', phase: 'execute', summary: 'stale', agent: agentFamily('codex'), updatedAt: '2026-08-30T00:00:00.000Z', freshness: 'stale' } }),
      makeCard('task-2444-backlog', 'backlog'),
    ]);
    assert.deepEqual(mixed.attentionQueue.map((item) => item.rank), [1, 2, 3, 4, 5]);
    assert.deepEqual(mixed.attentionQueue.map((item) => [item.reason.kind, item.dependsOnSources]), [
      ['blocking', ['current-work']],
      ['gate-failed', ['gate']],
      ['review-lane', ['task-markdown']],
      ['integrate-lane', ['task-markdown']],
      ['stale-work', ['current-work']],
    ]);
  });

  test('task-2444: queued action is enabled on its card', () => {
    const nonRunnable = project([makeCard('task-2337', 'active', {
      blockingReason: 'decision required',
      commands: [{ command: 'active', enabled: false, reason: 'ineligible' }],
    })]);
    assert.equal(nonRunnable.attentionQueue.length, 0);
  });

  test('task-2444: every queued reason carries source dependencies', () => {
    const queue = project([makeCard('task-2444-blocking', 'active', { blockingReason: 'decision required' })]).attentionQueue;
    assert.equal(queue.length, 1);
    assert.ok(queue.every((item) => item.dependsOnSources.length >= 1));
  });

  test('task-2444: source facts are deduplicated by source status and value', () => {
    const duplicateFacts = project([], [
      { source: 'task-markdown', status: 'fresh', value: 'missions/task-2444/MISSION.md' },
      { source: 'task-markdown', status: 'fresh', value: 'missions/task-2444/MISSION.md' },
    ]);
    assert.equal(duplicateFacts.sourceFacts.length, 1);
  });
});
