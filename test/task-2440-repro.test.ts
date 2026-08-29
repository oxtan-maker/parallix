import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { transitionTask } from '../src/adapters/backlog/backlog.js';
import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../src/adapters/sqlite/mission-store.js';
import { composeBoardProjection } from '../src/composition/board-projection.js';
import { missionId, type Mission, type MissionStatus } from '../src/domain/mission.js';
import { repositoryId } from '../src/domain/repository.js';

function fixtureMission(id: string, status: MissionStatus, repository: ReturnType<typeof repositoryId>): Mission {
  return {
    id: missionId(id), repositoryId: repository, title: id, labels: [], assignee: null,
    checkpoints: [], review: null, netEngineeringLines: null, status, closedAt: null,
  };
}

function writeTask(root: string, id: string, status: string): void {
  const file = path.join(root, 'backlog', 'tasks', `${id}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `---\nid: ${id}\ntitle: ${id}\nstatus: ${status}\n---\n`, 'utf8');
}

async function openStore(databasePath: string): Promise<{ database: SqliteDatabaseAdapter; store: SqliteMissionStore }> {
  const database = new SqliteDatabaseAdapter();
  await database.open({ path: databasePath });
  await new SqliteMigrationRunner(database).applyPending(loadDefaultMigrations());
  return { database, store: new SqliteMissionStore(database) };
}

test('external lifecycle update moves only its persisted board card', async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'task-2440-repository-')));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2440-home-'));
  const oldHome = process.env.PARALLIX_HOME;
  const repository = repositoryId(path.basename(root));
  const databasePath = path.join(home, 'parallix.db');
  process.env.PARALLIX_HOME = home;

  try {
    childProcess.spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' });
    childProcess.spawnSync('git', ['config', 'user.name', 'Task 2440'], { cwd: root, encoding: 'utf8' });
    childProcess.spawnSync('git', ['config', 'user.email', 'task-2440@example.test'], { cwd: root, encoding: 'utf8' });
    writeTask(root, 'task-2440', 'backlog');
    writeTask(root, 'task-2441', 'review');
    childProcess.spawnSync('git', ['add', '.'], { cwd: root, encoding: 'utf8' });
    childProcess.spawnSync('git', ['commit', '-m', 'seed tasks'], { cwd: root, encoding: 'utf8' });

    const seeded = await openStore(databasePath);
    await seeded.store.save(fixtureMission('task-2440', 'backlog', repository), null);
    await seeded.store.save(fixtureMission('task-2441', 'review', repository), null);
    await seeded.database.close();

    assert.equal(await transitionTask('task-2440', 'active', { rootDir: root, log: () => {} }), true);

    const opened = await openStore(databasePath);
    try {
      const board = composeBoardProjection({
        rootDir: root,
        missionStore: opened.store,
        repositoryId: repository,
        blocklistRepo: { async findAll() { return []; } } as never,
        historyRepo: { async findAll() { return []; }, async findByType() { return []; } } as never,
        laneEventRepo: { async findAll() { return []; } } as never,
        usageRepo: { async findAll() { return []; } } as never,
        knownAgentFamilies: [],
      });
      const lanes = new Map((await board.builder.build()).stages.flatMap((stage) =>
        stage.cards.map((card) => [card.id, card.lane]),
      ));

      assert.equal(lanes.get(missionId('task-2440')), 'active');
      assert.equal(lanes.get(missionId('task-2441')), 'review');
    } finally {
      await opened.database.close();
    }
  } finally {
    if (oldHome === undefined) { delete process.env.PARALLIX_HOME; } else { process.env.PARALLIX_HOME = oldHome; }
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});
