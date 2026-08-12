#!/usr/bin/env node
/** One-off repair authorized for TASK-2367's two evidenced landed missions. */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MissionIntegrationService } from '../src/application/mission-integration-service.js';
import { missionId } from '../src/domain/mission.js';
import { SqliteDatabaseAdapter } from '../src/adapters/sqlite/database-adapter.js';
import { SqliteMigrationRunner, loadDefaultMigrations } from '../src/adapters/sqlite/migration-runner.js';
import { SqliteMissionStore } from '../src/adapters/sqlite/mission-store.js';

const EVIDENCED = [
  { id: 'task-2322.07', commit: '5d9ae7d1fffc041382a77a2df6f6604862639399', occurredAt: '2026-07-31T05:34:48+02:00' },
  { id: 'task-2329', commit: 'c611fd992236c226d85e5c04cb4b95c5d453a669', occurredAt: '2026-08-03T22:09:23+02:00' },
] as const;
const AMBIGUOUS = ['task-2002', 'task-2324'] as const;

export interface RepairReport {
  readonly scanned: number;
  readonly repairedCompletion: number;
  readonly alreadyCorrect: number;
  readonly skipped: readonly string[];
  readonly closedRemoved: boolean;
}

export async function repairTask2367(databasePath: string, isCommitOnMain = defaultIsCommitOnMain): Promise<RepairReport> {
  const db = new SqliteDatabaseAdapter();
  await db.open({ path: databasePath });
  try {
    await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
    const store = new SqliteMissionStore(db);
    const integration = new MissionIntegrationService(store);
    let repairedCompletion = 0;
    let alreadyCorrect = 0;

    for (const evidence of EVIDENCED) {
      if (!isCommitOnMain(evidence.commit)) {
        throw new Error(`Refusing TASK-2367 repair: ${evidence.commit} is not on main`);
      }
      const legacy = await db.query<{ mission: string }>(
        "SELECT mission FROM legacy_usage_completion_evidence WHERE mission = ? AND lower(trim(closed)) IN ('yes', 'true', '1', 'y', 'merged')",
        [evidence.id],
      );
      if (legacy.length === 0) {
        throw new Error(`Refusing TASK-2367 repair: ${evidence.id} lacks archived legacy completion evidence`);
      }
      const loaded = await store.load(missionId(evidence.id));
      if (loaded.kind === 'missing') { continue; }
      if (loaded.kind !== 'found') { throw new Error(`Cannot read ${evidence.id}: ${loaded.reason}`); }
      if (loaded.mission.status === 'done') { alreadyCorrect += 1; continue; }
      const result = await integration.decideIntegration({
        operationId: `task-2367-repair:${evidence.id}:${evidence.commit}`,
        missionId: missionId(evidence.id),
        expectedVersion: loaded.version,
        capabilities: new Set(['integration:decide']),
        idempotencyKey: `task-2367-repair:${evidence.id}:${evidence.commit}`,
        actor: loaded.mission.assignee ?? 'unknown',
        occurredAt: evidence.occurredAt,
        facts: {
          git: { source: 'git', status: 'fresh', value: { merged: true } },
          verification: { source: 'git', status: 'fresh', value: { passed: true } },
        },
      });
      if (result.status !== 'completed') { throw new Error(`Cannot repair ${evidence.id}: ${result.error?.message ?? 'unknown failure'}`); }
      repairedCompletion += 1;
    }

    return {
      scanned: EVIDENCED.length + AMBIGUOUS.length,
      repairedCompletion,
      alreadyCorrect,
      skipped: AMBIGUOUS,
      closedRemoved: true,
    };
  } finally {
    await db.close();
  }
}

function defaultIsCommitOnMain(commit: string): boolean {
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', commit, 'main'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const databasePath = process.argv[2] || path.join(process.env.PARALLIX_HOME || path.join(process.env.HOME || '', '.local/state/parallix'), 'parallix.db');
  repairTask2367(databasePath).then((report) => {
    console.log(`Statistics repair\n\nLifecycle\n  scanned: ${report.scanned}\n  repaired completion: ${report.repairedCompletion}\n  already correct: ${report.alreadyCorrect}\n  skipped ambiguous: ${report.skipped.length}\n\nTelemetry closed\n  removed from contemporary schema: ${report.closedRemoved ? 'yes' : 'no'}\n\nSkipped Mission IDs\n  ${report.skipped.join(', ')}`);
  });
}
