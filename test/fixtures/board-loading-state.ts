import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SqliteDatabaseAdapter } from '../../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../../src/adapters/sqlite/mission-store.js';
import { repositoryId } from '../../src/domain/repository.js';
import { fixtureMission } from './mission-builders.js';

/** Fresh populated operator state, never copied from an operator or a running workflow. */
export async function seedBoardLoading(input: string, count = 120, options: { telemetry?: boolean } = {}) {
  const root = path.join(input, 'repository');
  const home = path.join(input, 'home');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    'commit', '--allow-empty', '-qm', 'fixture'], { cwd: root });
  const database = new SqliteDatabaseAdapter();
  try {
    await database.open({ path: path.join(home, 'parallix.db') });
    await new SqliteMigrationRunner(database).applyPending(loadDefaultMigrations());
    const store = new SqliteMissionStore(database);
    const open = Math.floor(count * 5 / 6);
    for (let index = 1; index <= count; index++) {
      await store.save(fixtureMission(`task-${9000 + index}`, {
        repositoryId: repositoryId('repository'), status: index <= open ? 'backlog' : 'done',
        closedAt: index <= open ? null : '2026-10-12T12:00:00.000Z', checkpoints: [],
        title: `Board loading fixture ${index}`,
      }), null);
    }
    // The loading benchmark needs dense telemetry; HTTP smoke contracts only
    // need persisted Missions. Leave that stress workload with its owner.
    if (options.telemetry === false) { return { root, home }; }
    await database.execute('BEGIN');
    for (let index = 0; index < count * 20; index++) {
      await database.execute(`INSERT INTO board_lane_events
        (repository_id,mission_id,from_status,to_status,trigger,agent,occurred_at,idempotency_key)
        VALUES (?,?,?,?,?,?,?,?)`, ['repository', `task-${9001 + open + index % (count - open)}`,
        index % 2 ? 'active' : 'backlog', index % 2 ? 'done' : 'active', 'active', 'codex',
        new Date(Date.UTC(2026, 8, 1) + index * 3_600_000).toISOString(), `fixture-${index}`]);
    }
    for (let index = 0; index < Math.floor(count * 5000 / 120); index++) {
      await database.execute('INSERT INTO operational_history(event_type,event_data,created_at) VALUES (?,?,?)',
        ['fixture', JSON.stringify({ repositoryId: 'repository', missionId: `task-${9001 + index % count}`,
          message: 'isolated fixture history' }), '2026-10-12T12:00:00.000Z']);
    }
    await database.execute('COMMIT');
  } finally { await database.close(); }
  return { root, home };
}
