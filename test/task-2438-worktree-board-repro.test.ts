import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { composeBoardProjection } from '../src/composition/board-projection.js';
import { SqliteMissionStore } from '../src/adapters/sqlite/mission-store.js';
import type { MissionStore } from '../src/application/domain-ports.js';
import type { Mission, MissionId, MissionStatus } from '../src/domain/mission.js';
import { missionId } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';

const repository = repositoryId('task-2438-repository');
const foreignRepository = repositoryId('task-2438-foreign');

function mission(id: string, status: MissionStatus, repositoryId = repository): Mission {
  return {
    id: missionId(id), repositoryId, title: id, labels: [], assignee: null,
    checkpoints: [], review: null, netEngineeringLines: null, status, closedAt: null,
  };
}

const persisted = [
  mission('task-2438-active', 'active'),
  mission('task-2438-review', 'review'),
  mission('task-2438-integration', 'integration'),
  mission('task-2438-archived', 'active'),
  mission('task-2438-foreign', 'active', foreignRepository),
];
let requestedRepository: typeof repository | null = null;

const store: MissionStore = {
  async load(id: MissionId) {
    const found = persisted.find((candidate) => candidate.id === id);
    return found ? { kind: 'found' as const, mission: found, version: 1 as never } : { kind: 'missing' as const };
  },
  async save() { return 1 as never; },
  async loadByRepository(id) {
    requestedRepository = id;
    return persisted.filter((candidate) => candidate.repositoryId === id);
  },
};

function board(rootDir: string) {
  return composeBoardProjection({
    rootDir,
    missionStore: store,
    repositoryId: repository,
    blocklistRepo: { async findAll() { return []; } } as never,
    historyRepo: { async findAll() { return []; }, async findByType() { return []; } } as never,
    laneEventRepo: { async findAll() { return []; } } as never,
    usageRepo: { async findAll() { return []; } } as never,
    knownAgentFamilies: [],
  });
}

function writeTask(root: string, directory: string, id: string, status: string): void {
  const file = path.join(root, 'backlog', directory, `${id}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `---\nid: ${id}\ntitle: ${id}\nstatus: ${status}\n---\n`, 'utf8');
}

function writeCatalog(root: string, statuses: readonly string[]): void {
  writeTask(root, 'tasks', 'task-2438-backlog', 'backlog');
  writeTask(root, 'tasks', 'task-2438-active', statuses[0]);
  writeTask(root, 'tasks', 'task-2438-review', statuses[1]);
  writeTask(root, 'tasks', 'task-2438-integration', statuses[2]);
  writeTask(root, 'archive/tasks', 'task-2438-archived', 'active');
}

test('task-2438 board reads persisted repository missions from every worktree', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2438-'));
  const secondRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2438-'));
  try {
    writeCatalog(root, ['refined', 'review', 'ready-for-integration']);
    writeCatalog(secondRoot, ['backlog', 'refined', 'active']);
    const firstBoard = board(root);
    const projection = await firstBoard.builder.build();
    const secondProjection = await board(secondRoot).builder.build();
    const lanes = new Map(
      projection.stages.flatMap((stage) => stage.cards.map((card) => [card.id, card.lane])),
    );

    assert.deepEqual(lanes, new Map([
      ['task-2438-backlog', 'backlog'],
      ['task-2438-active', 'active'],
      ['task-2438-review', 'review'],
      ['task-2438-integration', 'integration'],
    ]));
    assert.deepEqual(secondProjection.stages.map((stage) => stage.cards), projection.stages.map((stage) => stage.cards));
    assert.equal((await firstBoard.missionQuery.detail(missionId('task-2438-backlog')))?.id, missionId('task-2438-backlog'));
    assert.equal(requestedRepository, repository);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(secondRoot, { recursive: true, force: true });
  }
});

test('task-2438 mission store scopes board reads to the repository', async () => {
  const calls: unknown[][] = [];
  const store = new SqliteMissionStore({
    async query(_sql: string, params: unknown[]) {
      calls.push(params);
      return [];
    },
  } as never);

  assert.deepEqual(await store.loadByRepository(repository), []);
  assert.deepEqual(calls, [[repository]]);
});
