import type { SQLInputValue } from 'node:sqlite';
import { SqliteDatabaseAdapter } from '../../../src/adapters/sqlite/database-adapter.js';
import { missionVersion as fixtureVersion } from '../../../src/application/domain-ports.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { composeBoardProjection } from '../../../src/composition/board-projection.js';
import { SqliteMissionStore } from '../../../src/adapters/sqlite/mission-store.js';
import type { MissionStore } from '../../../src/application/domain-ports.js';
import type { Mission, MissionId, MissionStatus } from '../../../src/domain/mission.js';
import { missionId } from '../../../src/domain/mission.js';
import { repositoryId } from '../../../src/domain/repository.js';

const repository = repositoryId('task-2438-repository');
const foreignRepository = repositoryId('task-2438-foreign');

function mission(id: string, status: MissionStatus, repositoryId = repository, title = id): Mission {
  return {
    id: missionId(id), repositoryId, title, labels: [], assignee: null,
    checkpoints: [], review: null, netEngineeringLines: null, status, closedAt: null,
  };
}

const persisted = [
  mission('task-2438-active', 'active', repository, 'Recorded active title'),
  mission('task-2438-review', 'review'),
  mission('task-2438-integration', 'integration'),
  mission('task-2438-archived', 'active'),
  mission('task-2438-sibling', 'active', repository, 'Recorded sibling title'),
  mission('task-2438-done', 'done'),
  mission('task-2438-foreign', 'active', foreignRepository),
];
let requestedRepository: { value: typeof repository | null } = { value: null };

const store: MissionStore = {
  async load(id: MissionId) {
    const found = persisted.find((candidate) => candidate.id === id);
    return found ? { kind: 'found' as const, mission: found, version: fixtureVersion(1) } : { kind: 'missing' as const };
  },
  async save() { return fixtureVersion(1); },
  async loadByRepository(id) {
    requestedRepository.value = id;
    return persisted.filter((candidate) => candidate.repositoryId === id);
  },
};

// Hermetic doubles: the board must build without spawning the shimmed git
// CLI, launcher probes, or the OS process scan (each ~50-100 ms per call).
const gitDouble: NonNullable<NonNullable<Parameters<typeof composeBoardProjection>[0]>["gitFn"]> = () => ({ status: 0, stdout: '', stderr: '' });

function board(rootDir: string) {
  return composeBoardProjection({
    rootDir,
    missionStore: store,
    repositoryId: repository,
    blocklistRepo: { async findAll() { return []; }, async findByAgent() { return undefined; }, async save() { throw new Error('Unexpected block save'); }, async deleteByAgent() { throw new Error('Unexpected block delete'); }, async clear() { throw new Error('Unexpected block clear'); } },
    historyRepo: { async findAll() { return []; }, async findByType() { return []; }, async append() { throw new Error('Unexpected history append'); }, async clear() { throw new Error('Unexpected history clear'); } },
    laneEventRepo: { async findAll() { return []; }, async findByMissionId() { return []; }, async findByRepositoryId() { return []; }, async append() { throw new Error('Unexpected lane append'); }, async clear() { throw new Error('Unexpected lane clear'); } },
    usageRepo: { async findAll() { return []; }, async findWhere() { return []; } },
    knownAgentFamilies: [],
    launcherProbe: () => ({ available: true, detail: null }),
    readAgentConfig: () => null,
    detectRunningSessions: () => null,
    gitFn: gitDouble,
  });
}

function writeTask(root: string, directory: string, id: string, status: string, title = id): void {
  const file = path.join(root, 'backlog', directory, `${id}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `---\nid: ${id}\ntitle: ${title}\nstatus: ${status}\n---\n`, 'utf8');
}

function writeCatalog(root: string, statuses: readonly string[]): void {
  writeTask(root, 'tasks', 'task-2438-backlog', 'backlog', 'Backlog Markdown title');
  writeTask(root, 'tasks', 'task-2438-active', statuses[0], 'Active Markdown title');
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
    writeTask(secondRoot, 'tasks', 'task-2438-sibling', 'active', 'Sibling Markdown title');
    // Legacy checkpoint files must never replace or supply recorded evidence.
    const checkpoint = path.join(root, 'missions/task-2438-active/CP-1.md');
    fs.mkdirSync(path.dirname(checkpoint), { recursive: true });
    fs.writeFileSync(checkpoint, '# CP-1: stale file evidence\n');
    const firstBoard = board(root);
    const projection = await firstBoard.builder.build();
    const secondProjection = await board(secondRoot).builder.build();
    const lanes = new Map(
      projection.stages.flatMap((stage) => stage.cards.map((card) => [card.id, card.lane])),
    );
    const secondLanes = new Map(
      secondProjection.stages.flatMap((stage) => stage.cards.map((card) => [card.id, card.lane])),
    );

    assert.deepEqual(lanes, new Map([
      ['task-2438-backlog', 'backlog'],
      ['task-2438-active', 'active'],
      ['task-2438-review', 'review'],
      ['task-2438-integration', 'integration'],
      ['task-2438-sibling', 'active'],
      ['task-2438-archived', 'active'],
      ['task-2438-done', 'done'],
    ]));
    assert.deepEqual(secondLanes, lanes);
    assert.equal(lanes.has(missionId('task-2438-done')), true);
    const titles = new Map(projection.stages.flatMap((stage) => stage.cards.map((card) => [card.id, card.title])));
    const secondTitles = new Map(secondProjection.stages.flatMap((stage) => stage.cards.map((card) => [card.id, card.title])));
    // Saved planning fields are authoritative even when a worktree has stale intake.
    assert.equal(titles.get(missionId('task-2438-active')), 'Recorded active title');
    assert.equal(secondTitles.get(missionId('task-2438-active')), 'Recorded active title');
    assert.equal(titles.get(missionId('task-2438-sibling')), 'Recorded sibling title');
    assert.equal(secondTitles.get(missionId('task-2438-sibling')), 'Recorded sibling title');
    assert.equal(titles.get(missionId('task-2438-backlog')), 'Backlog Markdown title');
    assert.equal(secondTitles.get(missionId('task-2438-backlog')), 'Backlog Markdown title');
    assert.equal((await firstBoard.missionQuery.detail(missionId('task-2438-backlog')))?.id, missionId('task-2438-backlog'));
    const active = await firstBoard.missionQuery.detail(missionId('task-2438-active'));
    assert.deepEqual(active?.checkpoints, []);
    assert.equal(requestedRepository.value, repository);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(secondRoot, { recursive: true, force: true });
  }
});

test('task-2438 mission store scopes board reads to the repository', async () => {
  const calls: (readonly SQLInputValue[] | undefined)[] = [];
  const database = new SqliteDatabaseAdapter();
  test.mock.method(database, 'query', async (_sql: string, params?: readonly SQLInputValue[]) => { calls.push(params); return []; });
  const store = new SqliteMissionStore(database);

  assert.deepEqual(await store.loadByRepository(repository), []);
  assert.deepEqual(calls, [[repository]]);
});
