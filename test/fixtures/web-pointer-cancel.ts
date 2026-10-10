import fs from 'node:fs';
import path from 'node:path';
import { caseRoot } from './case-root.js';
import { SqliteDatabaseAdapter } from '../../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../../src/adapters/sqlite/mission-store.js';
import { MissionCancelService } from '../../src/application/mission-cancel-service.js';
import { archiveTask } from '../../src/adapters/backlog/task-transitions.js';
import { pointerBoard } from './web-pointer-board.js';

/** Manual browser fixture: one disposable database and backlog task, no operator paths. */
export async function pointerCancel() {
  const directory = caseRoot('parallix-pointer-cancel-');
  const db = new SqliteDatabaseAdapter();
  let board: Awaited<ReturnType<typeof pointerBoard>> | undefined;
  try {
    await db.open({ path: path.join(directory.root, 'disposable.db') });
    await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
    for (const id of ['task-pointer-disposable', 'task-pointer-bystander']) {
      await db.execute('INSERT INTO missions (id, repository_id, title, status) VALUES (?, ?, ?, ?)', [id, 'pointer-repo', id, 'backlog']);
      await db.execute('INSERT INTO usage_statistics (repo, mission, stage, cost_usd, actor_key) VALUES (?, ?, ?, ?, ?)', ['pointer-repo', id, 'implementer', 1, 'test']);
    }
    const task = path.join(directory.root, 'backlog/tasks/task-pointer-disposable - Disposable.md');
    fs.mkdirSync(path.dirname(task), { recursive: true });
    fs.writeFileSync(task, '---\nid: TASK-POINTER-DISPOSABLE\nstatus: backlog\n---\n# Disposable\n');
    const cancel = new MissionCancelService(new SqliteMissionStore(db), () => 'manual cleanup advisory', (slug) => archiveTask(slug, directory.root));
    board = await pointerBoard(async (request) => {
      if (request.kind !== 'mission:cancel' || request.missionId !== 'task-pointer-disposable') { throw new Error('fixture accepts only its disposable cancellation'); }
      await cancel.executeForSlug(request.missionId);
    });
    return {
      ...board,
      async facts() {
        return {
          missions: await db.query<{id: string}>('SELECT id FROM missions ORDER BY id'),
          usage: await db.query<{mission: string}>('SELECT mission FROM usage_statistics ORDER BY mission'),
          taskPresent: fs.existsSync(task),
          archived: fs.existsSync(path.join(directory.root, 'backlog/archive/tasks', path.basename(task))),
        };
      },
      async close() { await board!.close(); await db.close(); directory.dispose(); },
    };
  } catch (error) { await board?.close(); await db.close(); directory.dispose(); throw error; }
}
