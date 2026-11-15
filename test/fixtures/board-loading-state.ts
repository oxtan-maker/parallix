import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SqliteDatabaseAdapter } from '../../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../../src/adapters/sqlite/mission-store.js';
import { repositoryId } from '../../src/domain/repository.js';
import { fixtureMission } from './mission-builders.js';

/**
 * Analytical population matching the measured operator workload
 * (TASK-2854.02): 65468 rows read by the shared analytical session, of which
 * 1119 `rebound.repair` rows carried 499888811 bytes of event JSON with the
 * full gate diagnostic in `fingerprintBefore` and `fingerprintAfter`. Rows are
 * seeded exactly as they were persisted, so a compact-read claim is measured
 * against the real audit shape instead of a stub.
 */
export const BOARD_ANALYTICS_BASELINE_WORKLOAD = {
  /** Rows in the shared analytical families other than `rebound.repair`. */
  analyticalRows: 64_349,
  /** Repair audit rows carrying full diagnostic text. */
  repairRows: 1_119,
  /** Characters of retained gate diagnostic per persisted fingerprint field. */
  repairFingerprintChars: 223_364,
  /**
   * TOTAL Mission checkouts the operator board resolves per build. The measured
   * operator workload keeps a live checkout per open Mission, which is where
   * its per-build Git subprocesses come from; without a checkout the board
   * never asks Git for a revision, a dirty state or gate evidence. The fixture
   * splits this total between open and closed Missions, so `N` means exactly
   * `N` checkouts, never `2N`.
   */
  missionWorktrees: 12,
} as const;

export type BoardLoadingWorkload = {
  analyticalRows?: number;
  repairRows?: number;
  repairFingerprintChars?: number;
  missionWorktrees?: number;
};

/** The analytical families the board's shared read session selects. */
const ANALYTICAL_FAMILIES = ['mission.current-work', 'verification.attempt', 'flow.rebase',
  'lead.operator-judgment', 'stats.recovery.evidence'] as const;

/** Seed the measured analytical population, repair transcripts included. */
async function seedAnalyticalWorkload(database: SqliteDatabaseAdapter, count: number, workload: BoardLoadingWorkload) {
  const analyticalRows = workload.analyticalRows ?? BOARD_ANALYTICS_BASELINE_WORKLOAD.analyticalRows;
  const repairRows = workload.repairRows ?? BOARD_ANALYTICS_BASELINE_WORKLOAD.repairRows;
  const fingerprintChars = workload.repairFingerprintChars ?? BOARD_ANALYTICS_BASELINE_WORKLOAD.repairFingerprintChars;
  // A Mission's history naturally occupies one work window. Distinct Mission
  // timestamps make the chronological compact reader traverse the same paging
  // path as a populated operator repository instead of resolving every Mission
  // from the first page of one shared timestamp.
  const missionCreatedAt = Array.from({ length: count }, (_, index) =>
    new Date(Date.UTC(2026, 9, 11, 12, 0, 0, index)).toISOString());
  for (let index = 0; index < analyticalRows; index++) {
    const family = ANALYTICAL_FAMILIES[index % ANALYTICAL_FAMILIES.length]!;
    await database.execute('INSERT INTO operational_history(event_type,event_data,created_at) VALUES (?,?,?)',
      [family, JSON.stringify({ repositoryId: 'repository', missionId: `task-${9001 + index % count}` }),
        missionCreatedAt[index % count]!]);
  }
  // Exactly what the kernel persisted before bounded identity digests existed:
  // the whole gate transcript in both fingerprint fields.
  const transcript = 'gate output line\n'.repeat(Math.ceil(fingerprintChars / 'gate output line\n'.length));
  for (let index = 0; index < repairRows; index++) {
    await database.execute('INSERT INTO operational_history(event_type,event_data,created_at) VALUES (?,?,?)',
      ['rebound.repair', JSON.stringify({ repositoryId: 'repository', missionId: `task-${9001 + index % count}`,
        occurrenceId: `repair-${index}`, reasonKind: 'gate-failure', area: 'declared gate', attempt: 1, maxAttempts: 2,
        strategy: 'targeted', context: 'resumed', agent: 'codex', provider: null, model: null,
        fingerprintBefore: transcript, fingerprintAfter: transcript, headBefore: null, headAfter: null,
        outcome: 'advance', durationMs: 60_000 }), missionCreatedAt[index % count]!]);
  }
}

/** Fresh populated operator state, never copied from an operator or a running workflow. */
export async function seedBoardLoading(input: string, count = 120, options: {
  telemetry?: boolean; schemaTemplate?: string; workload?: BoardLoadingWorkload | null } = {}) {
  const root = path.join(input, 'repository');
  const home = path.join(input, 'home');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    'commit', '--allow-empty', '-qm', 'fixture'], { cwd: root });
  // One clean checkout per Mission the board asks Git about, as on the operator
  // workstation: an active Mission with a declared gate and a closed Mission
  // with an integration run are where a build spends its Git subprocesses.
  // `missionWorktrees` is the total checkout count, split between the open and
  // the closed half of the population. Callers that do not ask for checkouts
  // keep the single-worktree fixture.
  const worktrees = options.workload?.missionWorktrees ?? 0;
  const openCheckouts = Math.ceil(worktrees / 2);
  const closedCheckouts = worktrees - openCheckouts;
  const checkedOut = new Set<number>();
  for (let index = 1; index <= openCheckouts; index++) { checkedOut.add(index); }
  for (let index = Math.max(openCheckouts + 1, count - closedCheckouts + 1); index <= count; index++) { checkedOut.add(index); }
  const worktreeRoot = path.join(input, 'worktrees');
  fs.mkdirSync(worktreeRoot, { recursive: true });
  for (const index of checkedOut) {
    execFileSync('git', ['worktree', 'add', '-q', path.join(worktreeRoot, `task-${9000 + index}`),
      '-b', `mission/task-${9000 + index}`], { cwd: root });
  }
  const worktreeCount = checkedOut.size;
  const database = new SqliteDatabaseAdapter();
  try {
    // Boundary suites may reuse closed empty schema; all writable data stays
    // private. The manual benchmark still measures fresh migration by default.
    if (options.schemaTemplate) {
      fs.copyFileSync(options.schemaTemplate, path.join(home, 'parallix.db'), fs.constants.COPYFILE_EXCL);
    }
    await database.open({ path: path.join(home, 'parallix.db') });
    await new SqliteMigrationRunner(database).applyPending(loadDefaultMigrations());
    const store = new SqliteMissionStore(database);
    const open = Math.floor(count * 5 / 6);
    for (let index = 1; index <= count; index++) {
      const active = index <= openCheckouts;
      await store.save(fixtureMission(`task-${9000 + index}`, {
        repositoryId: repositoryId('repository'),
        status: index <= open ? (active ? 'active' : 'backlog') : 'done',
        closedAt: index <= open ? null : '2026-10-12T12:00:00.000Z', checkpoints: [],
        // A Mission on a live checkout declares a gate, so the board reads that
        // gate's proof against the checkout instead of reporting it unconfigured.
        declaredGates: checkedOut.has(index) ? ['npm run typecheck'] : [],
        title: `Board loading fixture ${index}`,
      }), null);
    }
    // The loading benchmark needs dense telemetry; HTTP smoke contracts only
    // need persisted Missions. Leave that stress workload with its owner.
    if (options.telemetry === false) { return { root, home, worktrees: worktreeCount }; }
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
    if (options.workload) { await seedAnalyticalWorkload(database, count, options.workload); }
    await database.execute('COMMIT');
  } finally { await database.close(); }
  return { root, home, worktrees: worktreeCount };
}
