import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { composeBoardProjection } from '../src/composition/board-projection.js';
import type { MissionStore } from '../src/application/domain-ports.js';
import type { Mission, MissionId, MissionStatus } from '../src/domain/mission.js';
import { missionId } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';

/**
 * Regression for TASK-2515: a mission whose SQLite `Mission` aggregate is stuck
 * in a non-terminal lifecycle (`integration`) must project into the integration
 * board lane and expose the human-only `integrate-lane` attention item even when
 * its `backlog/completed/` task file carries `status: done`. The board derives
 * its lane from the shared DB-backed projection, never from the stale Markdown.
 */
const repository = repositoryId('task-2515-not-masked-repo');

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

function board(rootDir: string, store: MissionStore) {
  return composeBoardProjection({
    rootDir,
    missionStore: store,
    repositoryId: repository,
    blocklistRepo: { async findAll() { return []; } } as never,
    historyRepo: { async findAll() { return []; }, async findByType() { return []; } } as never,
    laneEventRepo: { async findAll() { return []; } } as never,
    usageRepo: { async findAll() { return []; } } as never,
    knownAgentFamilies: [],
    launcherProbe: () => ({ available: true, detail: null }),
    readAgentConfig: () => null,
    detectRunningSessions: () => null,
    gitFn: gitDouble,
  });
}

function writeCompletedTask(root: string, id: string, status: string): void {
  const file = path.join(root, 'backlog', 'completed', `${id}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `---\nid: ${id}\ntitle: ${id}\nstatus: ${status}\n---\n`, 'utf8');
}

test('task-2515 integration lifecycle not masked by completed backlog task', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2515-'));
  try {
    // Completed task Markdown says `done`; the persisted aggregate says `integration`.
    writeCompletedTask(root, 'task-2515', 'done');
    const store = storeFor([mission('task-2515', 'integration')]);
    const projection = await board(root, store).builder.build();

    const card = projection.stages
      .flatMap((stage) => stage.cards)
      .find((c) => c.id === missionId('task-2515'));

    // SC1: projected into the integration lane despite the completed Markdown.
    assert.ok(card, 'mission must be present on the board');
    assert.equal(card?.lane, 'integration');
    assert.equal(card?.status, 'integration');

    // The `integrate` command is enabled on the card (human-only path).
    const integrateCmd = card?.commands.find((c) => c.command === 'integrate');
    assert.ok(integrateCmd?.enabled, 'integrate command must be enabled on an integration card');

    // SC2: attention queue carries the mission with the integrate-lane reason.
    const item = projection.attentionQueue.find((i) => i.missionId === missionId('task-2515'));
    assert.ok(item, 'attention queue must enqueue the integration mission');
    assert.deepEqual(item?.reason, { kind: 'integrate-lane', detail: 'Awaiting integration' });
    assert.equal(item?.action.kind, 'integrate:merge');
    assert.equal(item?.action.display, `px integrate ${card!.id}`);

    // SC3: single DB-backed projection — no Markdown-only reconstruction.
    const sourceFacts = projection.sourceFacts.some((f) => f.source === 'mission-store');
    assert.ok(sourceFacts, 'projection must cite the mission-store authority');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// SC1 extends to every non-terminal status: a completed-Markdown `done` must never
// override a non-terminal persisted lifecycle. Each case is hermetic.
const NON_TERMINAL: MissionStatus[] = ['backlog', 'refined', 'active', 'review', 'integration'];
test('task-2515 every non-terminal persisted lifecycle wins over completed Markdown', async () => {
  for (const status of NON_TERMINAL) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2515-'));
    try {
      writeCompletedTask(root, 'task-2515', 'done');
      const projection = await board(root, storeFor([mission('task-2515', status)])).builder.build();
      const card = projection.stages
        .flatMap((stage) => stage.cards)
        .find((c) => c.id === missionId('task-2515'));
      assert.equal(card?.lane, status, `persisted ${status} must project to lane ${status}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});
