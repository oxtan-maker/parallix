import { missionVersion, type MissionVersion } from '../../application/domain-ports.js';
import { type Mission, type MissionId } from '../../domain/mission.js';
import { toCanonicalUtcInstant } from '../../domain/instant.js';
import type { SqliteDatabaseAdapter } from './database-adapter.js';

export class MissionStaleWriteError extends Error {
  readonly disposition = 'stale-write' as const;

  constructor(
    readonly missionId: MissionId,
    readonly expectedVersion: MissionVersion | null,
    readonly actualVersion: MissionVersion | null,
  ) {
    super(
      `Stale write: mission ${missionId} expected version ` +
      `${expectedVersion ?? 'missing'}, found ${actualVersion ?? 'missing'}`,
    );
    this.name = 'MissionStaleWriteError';
  }
}

export async function writeMissionRoot(
  db: SqliteDatabaseAdapter,
  mission: Mission,
  expectedVersion: MissionVersion | null,
): Promise<MissionVersion> {
  const params = missionRootParams(mission, await canonicalClosedAt(db, mission, expectedVersion));
  if (expectedVersion === null) {
    await insertMissionRoot(db, mission, params);
    return missionVersion(1);
  }
  await updateMissionRoot(db, mission, expectedVersion, params);
  return missionVersion(expectedVersion + 1);
}

type MissionRootParams = readonly [
  Mission['repositoryId'], string, Mission['status'], string | null, Mission['assignee'],
  number | null, number, string | null, string | null, string | null, string | null,
  string | null, string | null, string | null, string | null, string | null,
];

function missionRootParams(mission: Mission, closedAt: string | null): MissionRootParams {
  return [
    mission.repositoryId,
    mission.title,
    mission.status,
    mission.rawStatus ?? null,
    mission.assignee,
    mission.netEngineeringLines,
    Number(mission.reviewPreparationPending === true),
    mission.reproductionTest ?? null,
    mission.predictedNelBucket ?? null,
    mission.description ?? null,
    mission.waveParentId ?? null,
    mission.wave ? JSON.stringify(mission.wave.children) : null,
    mission.largeMissionRiskException?.rationale ?? null,
    mission.largeMissionRiskException?.approvedBy ?? null,
    mission.largeMissionRiskException?.approvedAt ?? null,
    closedAt,
  ];
}

async function canonicalClosedAt(
  db: SqliteDatabaseAdapter,
  mission: Mission,
  expectedVersion: MissionVersion | null,
): Promise<string | null> {
  const closedAt = mission.closedAt ?? null;
  if (closedAt === null) { return null; }
  try {
    return toCanonicalUtcInstant(closedAt);
  } catch (error) {
    const existing = expectedVersion === null ? [] : await db.query<{ closed_at: string | null }>(
      'SELECT closed_at FROM missions WHERE id = ? AND version = ?',
      [mission.id, expectedVersion],
    );
    if (existing.length !== 1 || existing[0]!.closed_at !== closedAt) { throw error; }
    return closedAt;
  }
}

async function insertMissionRoot(
  db: SqliteDatabaseAdapter,
  mission: Mission,
  params: MissionRootParams,
): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO missions
         (id, repository_id, title, status, raw_status, assignee,
          net_engineering_lines, review_preparation_pending, reproduction_test, predicted_nel_bucket, description,
          wave_parent_id, wave_children_json, large_risk_rationale, large_risk_approved_by, large_risk_approved_at,
          closed_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [mission.id, ...params],
    );
  } catch (error) {
    const actual = await currentVersion(db, mission.id);
    if (actual !== null) { throw new MissionStaleWriteError(mission.id, null, actual); }
    throw error;
  }
}

async function updateMissionRoot(
  db: SqliteDatabaseAdapter,
  mission: Mission,
  expectedVersion: MissionVersion,
  params: MissionRootParams,
): Promise<void> {
  const changed = await db.execute(
    `UPDATE missions SET
       repository_id = ?, title = ?, status = ?, raw_status = ?, assignee = ?,
       net_engineering_lines = ?, review_preparation_pending = ?, reproduction_test = ?, predicted_nel_bucket = ?, description = ?,
       wave_parent_id = ?, wave_children_json = ?, large_risk_rationale = ?, large_risk_approved_by = ?, large_risk_approved_at = ?,
       closed_at = ?, version = version + 1
     WHERE id = ? AND version = ?`,
    [...params, mission.id, expectedVersion],
  );
  if (changed !== 1) {
    throw new MissionStaleWriteError(mission.id, expectedVersion, await currentVersion(db, mission.id));
  }
}

async function currentVersion(db: SqliteDatabaseAdapter, id: MissionId): Promise<MissionVersion | null> {
  const rows = await db.query<{ version: number }>('SELECT version FROM missions WHERE id = ?', [id]);
  return rows.length === 0 ? null : missionVersion(rows[0].version);
}
