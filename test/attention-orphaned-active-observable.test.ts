import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { composeBoardProjection } from '../src/composition/board-projection.js';
import type { MissionStore } from '../src/application/domain-ports.js';
import type { Mission, MissionId, MissionStatus } from '../src/domain/mission.js';
import { missionId } from '../src/domain/mission.js';
import { agentFamily } from '../src/domain/agents.js';
import { repositoryId } from '../src/domain/repository.js';
import type { BoardProjection } from '../src/application/projections/board.js';
import {
  CURRENT_WORK_EVENT_TYPE,
  currentWorkEventToEntry,
  type CurrentWorkEvent,
} from '../src/application/recording/current-work-recorder.js';

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orphaned-active-'));
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
