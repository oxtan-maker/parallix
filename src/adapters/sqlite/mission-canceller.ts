import type { MissionId } from '../../domain/mission.js';
import type { SqliteDatabaseAdapter } from './database-adapter.js';

/**
 * Delete one Mission's lifecycle rows in a single transaction.
 *
 * The `missions` row cascades its aggregate-owned children. The operational
 * tables carry no foreign key and are deleted explicitly. `usage_statistics`
 * is deliberately retained: a cancelled Mission still cost what it cost.
 */
export class SqliteMissionCanceller {
  constructor(private readonly db: SqliteDatabaseAdapter) {}

  async cancel(id: MissionId): Promise<void> {
    const pragma = await this.db.query<{ foreign_keys: number }>('PRAGMA foreign_keys');
    if (pragma[0]?.foreign_keys !== 1) {
      throw new Error(`Refusing to cancel ${id}: PRAGMA foreign_keys is not enabled on this connection`);
    }
    await this.db.beginWriteTransaction();
    try {
      const current = await this.db.query<{ status: string }>('SELECT status FROM missions WHERE id = ?', [id]);
      if (current[0]?.status === 'done') {
        throw new Error(`Refusing to cancel ${id}: integrated Mission closeout must finish through px integrate --recover-landed`);
      }
      await this.db.execute('DELETE FROM execution_activity WHERE mission_id = ?', [id]);
      await this.db.execute('DELETE FROM session_markers WHERE mission_id = ?', [id]);
      await this.db.execute('DELETE FROM board_lane_events WHERE mission_id = ?', [id]);
      await this.db.execute('DELETE FROM missions WHERE id = ?', [id]);
      const violations = await this.db.query('PRAGMA foreign_key_check');
      if (violations.length > 0) {
        throw new Error(`Refusing to commit cancel of ${id}: ${violations.length} foreign-key violation(s)`);
      }
      await this.db.commitTransaction();
    } catch (error) {
      await this.db.rollbackTransaction();
      throw error;
    }
  }
}
