import { criterionContract } from '../../domain/mission-success-criteria.js';
import { captureReviewCheckpointState, isPlannedCheckpoint } from '../../domain/checkpoint.js';
import type { CheckpointVersion, CheckpointData, ReviewCheckpointState } from '../../domain/checkpoint.js';
import type { Mission, MissionId } from '../../domain/mission.js';
import type { SqliteDatabaseAdapter } from './database-adapter.js';

interface VersionRow {
  version: number;
  checkpoint_json: string;
  recorded_at: string | null;
  recorded_round: number | null;
  mission_revision: number | null;
}

/** Append-only evidence lives outside the replaceable aggregate projections. */
export class SqliteCheckpointHistory {
  constructor(private readonly _db: SqliteDatabaseAdapter) {}

  async read(id: MissionId): Promise<readonly CheckpointVersion[]> {
    const rows = await this._db.query<VersionRow>(
      `SELECT version, checkpoint_json, recorded_at, recorded_round, mission_revision
       FROM mission_checkpoint_versions WHERE mission_id = ? ORDER BY version`, [id],
    );
    return rows.map(row => ({ version: row.version,
      checkpoint: JSON.parse(row.checkpoint_json) as CheckpointData,
      recordedAt: row.recorded_at, recordedRound: row.recorded_round,
      missionRevision: row.mission_revision }));
  }

  async round(id: MissionId, round: number): Promise<ReviewCheckpointState | null | undefined> {
    const rows = await this._db.query<{ state_json: string | null }>(
      'SELECT state_json FROM mission_review_checkpoint_states WHERE mission_id = ? AND round_number = ?', [id, round],
    );
    if (!rows.length) { return undefined; }
    return rows[0]!.state_json === null ? null : JSON.parse(rows[0]!.state_json) as ReviewCheckpointState;
  }

  /** Persist new round boundaries with their version references in the same transaction.
   * Existing boundaries, including explicitly unknown migrated ones, are untouched. */
  async captureRounds(mission: Mission): Promise<void> {
    const history = await this.read(mission.id);
    for (const round of mission.review?.rounds ?? []) {
      const state = captureReviewCheckpointState(round.number, mission.checkpoints, history, criterionContract(mission));
      await this._db.execute(
        `INSERT INTO mission_review_checkpoint_states (mission_id, round_number, state_json)
         VALUES (?, ?, ?) ON CONFLICT(mission_id, round_number) DO NOTHING`,
        [mission.id, round.number, JSON.stringify(state)],
      );
    }
  }

  /** Called inside the aggregate compare-and-swap transaction. */
  async append(mission: Mission): Promise<void> {
    const history = await this.read(mission.id);
    let version = history.at(-1)?.version ?? 0;
    for (const checkpoint of mission.checkpoints) {
      if (isPlannedCheckpoint(checkpoint)) { continue; }
      const prior = history.findLast(item => item.checkpoint.name === checkpoint.name);
      // An unrelated save (including repair verification) cannot rewrite a record.
      if (prior && (!checkpoint.recording || prior.missionRevision === checkpoint.recording.missionRevision)) { continue; }
      await this._db.execute(
        `INSERT INTO mission_checkpoint_versions
         (mission_id, version, name, checkpoint_json, recorded_at, recorded_round, mission_revision)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [mission.id, ++version, checkpoint.name, JSON.stringify(checkpoint),
          checkpoint.recording?.recordedAt ?? null, checkpoint.recording?.recordedRound ?? null,
          checkpoint.recording?.missionRevision ?? null],
      );
    }
  }
}
