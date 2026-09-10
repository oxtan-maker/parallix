import crypto from 'node:crypto';
import type { SqliteDatabaseAdapter } from './database-adapter.js';
import { isSameLiveProcess } from '../process/process-liveness.js';

type LeaseRow = { lease_id: string; capacity: number | null; launcher_pid: number; launcher_start_id: string | null; child_pid: number | null; child_start_id: string | null };

export class SqliteCustomAgentLeaseRepository {
  constructor(private readonly _db: SqliteDatabaseAdapter) {}

  async acquire(repositoryRoot: string, capacity: number, launcher: {pid: number; startId: string | null}): Promise<string | null> {
    await this._db.beginImmediateTransaction();
    try {
      const rows = await this._db.query<LeaseRow>('SELECT lease_id, capacity, launcher_pid, launcher_start_id, child_pid, child_start_id FROM custom_agent_leases');
      for (const row of rows) {
        const live = row.child_pid !== null ? isSameLiveProcess(row.child_pid, row.child_start_id) : isSameLiveProcess(row.launcher_pid, row.launcher_start_id);
        if (!live) {
          await this._db.execute('DELETE FROM custom_agent_leases WHERE lease_id = ?', [row.lease_id]);
        }
      }
      const liveRows = await this._db.query<LeaseRow>('SELECT lease_id, capacity, launcher_pid, launcher_start_id, child_pid, child_start_id FROM custom_agent_leases');
      const finite = [capacity, ...liveRows.map(row => row.capacity).filter((value): value is number => value !== null)];
      if (liveRows.length >= Math.min(...finite)) {
        await this._db.rollbackTransaction();
        return null;
      }
      const leaseId = crypto.randomUUID();
      await this._db.execute('INSERT INTO custom_agent_leases (lease_id, repository_root, capacity, launcher_pid, launcher_start_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', [leaseId, repositoryRoot, capacity, launcher.pid, launcher.startId, new Date().toISOString()]);
      await this._db.commitTransaction();
      return leaseId;
    } catch (error) {
      await this._db.rollbackTransaction();
      throw error;
    }
  }

  bindChild(leaseId: string, child: {pid: number; startId: string | null}): void {
    this._db.executeSync('UPDATE custom_agent_leases SET child_pid = ?, child_start_id = ? WHERE lease_id = ?', [child.pid, child.startId, leaseId]);
  }

  release(leaseId: string): void { this._db.executeSync('DELETE FROM custom_agent_leases WHERE lease_id = ?', [leaseId]); }
}
