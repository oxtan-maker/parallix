import type {
  MissionLoadResult,
  MissionStore,
  MissionVersion,
} from '../../application/domain-ports.js';
import { missionVersion } from '../../application/domain-ports.js';
import type { LaneTransitionEvent } from '../../domain/board-event.js';
import type { Mission, MissionId } from '../../domain/mission.js';
import type { KnownRepository, RepositoryId } from '../../domain/repository.js';
import type { SqliteDatabaseAdapter } from './database-adapter.js';
import { SqliteBoardLaneEventRepository } from './board-lane-event-repository.js';
import {
  hydrateMission,
  type MissionExternalTaskRefRecord,
  type MissionCheckpointRecord,
  type MissionGoalCheckRecord,
  type MissionLabelRecord,
  type MissionRecord,
  type MissionReviewFindingRecord,
  type MissionReviewRecord,
  type MissionReviewResolutionRecord,
  type MissionReviewRoundRecord,
} from './mission-serialization.js';

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

export interface KnownRepositoryObservation {
  readonly repository: KnownRepository;
  readonly path: string;
  readonly lastAccessed: string;
}

/**
 * Relational SQLite adapter for the checked Mission aggregate.
 *
 * The aggregate root and its value collections are committed on one
 * connection. Version compare-and-swap catches stale writers even when two
 * writers keep the same lifecycle status.
 */
export class SqliteMissionStore implements MissionStore {
  private readonly eventRepo: SqliteBoardLaneEventRepository;

  constructor(private readonly db: SqliteDatabaseAdapter) {
    this.eventRepo = new SqliteBoardLaneEventRepository(db);
  }

  async load(id: MissionId): Promise<MissionLoadResult> {
    const missionRows = await this.db.query<MissionRecord>(
      `SELECT id, repository_id, title, status, raw_status, assignee,
              net_engineering_lines, closed_at, version
       FROM missions WHERE id = ?`,
      [id],
    );
    if (missionRows.length === 0) {
      return { kind: 'missing' };
    }

    const [
      labels,
      checkpoints,
      goalChecks,
      reviews,
      reviewRounds,
      findings,
      resolutions,
      externalRefs,
    ] =
      await Promise.all([
        this.db.query<MissionLabelRecord>(
          'SELECT mission_id, position, label FROM mission_labels WHERE mission_id = ? ORDER BY position',
          [id],
        ),
        this.db.query<MissionCheckpointRecord>(
          `SELECT mission_id, position, checkpoint_mission_id, name, raw_filename,
                  first_line, next_action_text
           FROM mission_checkpoints WHERE mission_id = ? ORDER BY position`,
          [id],
        ),
        this.db.query<MissionGoalCheckRecord>(
          `SELECT mission_id, checkpoint_position, position, criterion, evidence
           FROM mission_checkpoint_goal_checks
           WHERE mission_id = ? ORDER BY checkpoint_position, position`,
          [id],
        ),
        this.db.query<MissionReviewRecord>(
          `SELECT mission_id, intervention_requested_at, intervention_requested_by,
                  intervention_reason
           FROM mission_reviews WHERE mission_id = ?`,
          [id],
        ),
        this.db.query<MissionReviewRoundRecord>(
          `SELECT mission_id, position, round_number, change_kind, provider,
                  provider_change_id, provider_url, source_branch, target_branch,
                  revision, reviewer, implementer, started_at, decision_kind,
                  decided_at, decision_comment, approval_source_kind,
                  approval_source_provider, responded_at, resulting_revision
           FROM mission_review_rounds WHERE mission_id = ? ORDER BY position`,
          [id],
        ),
        this.db.query<MissionReviewFindingRecord>(
          `SELECT mission_id, round_position, position, finding_id, summary, location
           FROM mission_review_findings
           WHERE mission_id = ? ORDER BY round_position, position`,
          [id],
        ),
        this.db.query<MissionReviewResolutionRecord>(
          `SELECT mission_id, round_position, position, finding_id, kind, explanation
           FROM mission_review_resolutions
           WHERE mission_id = ? ORDER BY round_position, position`,
          [id],
        ),
        this.db.query<MissionExternalTaskRefRecord>(
          `SELECT mission_id, source, external_id, url
           FROM mission_external_task_refs WHERE mission_id = ?`,
          [id],
        ),
      ]);

    const hydrated = hydrateMission({
      mission: missionRows[0],
      externalTaskRef: externalRefs[0] ?? null,
      labels,
      checkpoints,
      goalChecks,
      review: reviews[0] ?? null,
      reviewRounds,
      findings,
      resolutions,
    });
    return { kind: 'found', ...hydrated };
  }

  async save(
    mission: Mission,
    expectedVersion: MissionVersion | null,
  ): Promise<MissionVersion> {
    await this.db.beginTransaction();
    try {
      const version = await this.persistAggregate(mission, expectedVersion);
      await this.db.commitTransaction();
      return version;
    } catch (error) {
      await this.db.rollbackTransaction();
      throw error;
    }
  }

  async saveWithTransition(
    mission: Mission,
    expectedVersion: MissionVersion,
    event: LaneTransitionEvent,
  ): Promise<MissionVersion> {
    if (event.missionId !== mission.id || event.repositoryId !== mission.repositoryId) {
      throw new Error('LaneTransitionEvent does not identify the Mission being saved');
    }
    await this.db.beginTransaction();
    try {
      const version = await this.persistAggregate(mission, expectedVersion);
      const appended = await this.eventRepo.append({
        missionId: event.missionId,
        fromStatus: event.from,
        toStatus: event.to,
        trigger: event.trigger,
        agent: event.agent,
        occurredAt: event.occurredAt,
        idempotencyKey: event.idempotencyKey,
      });
      if (!appended) {
        throw new Error(`Duplicate idempotency key: ${event.idempotencyKey}`);
      }
      await this.db.commitTransaction();
      return version;
    } catch (error) {
      await this.db.rollbackTransaction();
      throw error;
    }
  }

  async saveKnownRepository(observation: KnownRepositoryObservation): Promise<void> {
    await this.db.execute(
      `INSERT INTO known_repositories (id, path, display_name, last_accessed)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         path = excluded.path,
         display_name = excluded.display_name,
         last_accessed = excluded.last_accessed`,
      [
        observation.repository.id,
        observation.path,
        observation.repository.displayName,
        observation.lastAccessed,
      ],
    );
  }

  async loadKnownRepository(id: RepositoryId): Promise<KnownRepositoryObservation | null> {
    const rows = await this.db.query<{
      id: string;
      path: string;
      display_name: string | null;
      last_accessed: string;
    }>(
      'SELECT id, path, display_name, last_accessed FROM known_repositories WHERE id = ?',
      [id],
    );
    if (rows.length === 0) {
      return null;
    }
    const row = rows[0];
    return {
      repository: {
        id,
        displayName: row.display_name ?? row.path,
      },
      path: row.path,
      lastAccessed: row.last_accessed,
    };
  }

  private async persistAggregate(
    mission: Mission,
    expectedVersion: MissionVersion | null,
  ): Promise<MissionVersion> {
    const params = [
      mission.repositoryId,
      mission.title,
      mission.status,
      mission.rawStatus ?? null,
      mission.assignee,
      mission.netEngineeringLines,
      mission.closedAt,
    ] as const;

    let nextVersion: MissionVersion;
    if (expectedVersion === null) {
      try {
        await this.db.execute(
          `INSERT INTO missions
             (id, repository_id, title, status, raw_status, assignee,
              net_engineering_lines, closed_at, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [mission.id, ...params],
        );
      } catch (error) {
        const actual = await this.currentVersion(mission.id);
        if (actual !== null) {
          throw new MissionStaleWriteError(mission.id, null, actual);
        }
        throw error;
      }
      nextVersion = missionVersion(1);
    } else {
      const changed = await this.db.execute(
        `UPDATE missions SET
           repository_id = ?, title = ?, status = ?, raw_status = ?, assignee = ?,
           net_engineering_lines = ?, closed_at = ?, version = version + 1
         WHERE id = ? AND version = ?`,
        [...params, mission.id, expectedVersion],
      );
      if (changed !== 1) {
        throw new MissionStaleWriteError(
          mission.id,
          expectedVersion,
          await this.currentVersion(mission.id),
        );
      }
      nextVersion = missionVersion(expectedVersion + 1);
      await this.clearAggregateValues(mission.id);
    }

    await this.insertAggregateValues(mission);
    return nextVersion;
  }

  private async currentVersion(id: MissionId): Promise<MissionVersion | null> {
    const rows = await this.db.query<{ version: number }>(
      'SELECT version FROM missions WHERE id = ?',
      [id],
    );
    return rows.length === 0 ? null : missionVersion(rows[0].version);
  }

  private async clearAggregateValues(id: MissionId): Promise<void> {
    await this.db.execute('DELETE FROM mission_external_task_refs WHERE mission_id = ?', [id]);
    await this.db.execute('DELETE FROM mission_reviews WHERE mission_id = ?', [id]);
    await this.db.execute('DELETE FROM mission_checkpoints WHERE mission_id = ?', [id]);
    await this.db.execute('DELETE FROM mission_labels WHERE mission_id = ?', [id]);
  }

  private async insertAggregateValues(mission: Mission): Promise<void> {
    if (mission.externalTaskRef) {
      await this.db.execute(
        `INSERT INTO mission_external_task_refs (mission_id, source, external_id, url)
         VALUES (?, ?, ?, ?)`,
        [
          mission.id,
          mission.externalTaskRef.source,
          mission.externalTaskRef.id,
          mission.externalTaskRef.url,
        ],
      );
    }
    for (const [position, label] of mission.labels.entries()) {
      await this.db.execute(
        'INSERT INTO mission_labels (mission_id, position, label) VALUES (?, ?, ?)',
        [mission.id, position, label],
      );
    }
    for (const [checkpointPosition, checkpoint] of mission.checkpoints.entries()) {
      await this.db.execute(
        `INSERT INTO mission_checkpoints
           (mission_id, position, checkpoint_mission_id, name, raw_filename,
            first_line, next_action_text)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          mission.id,
          checkpointPosition,
          checkpoint.missionId,
          checkpoint.name,
          checkpoint.rawFilename ?? null,
          checkpoint.firstLine ?? null,
          checkpoint.nextActionText,
        ],
      );
      for (const [position, row] of checkpoint.goalCheck.entries()) {
        await this.db.execute(
          `INSERT INTO mission_checkpoint_goal_checks
             (mission_id, checkpoint_position, position, criterion, evidence)
           VALUES (?, ?, ?, ?, ?)`,
          [mission.id, checkpointPosition, position, row.criterion, row.evidence],
        );
      }
    }
    if (mission.review) {
      await this.insertReview(mission);
    }
  }

  private async insertReview(mission: Mission): Promise<void> {
    const review = mission.review;
    if (!review) {
      return;
    }
    await this.db.execute(
      `INSERT INTO mission_reviews
         (mission_id, intervention_requested_at, intervention_requested_by,
          intervention_reason)
       VALUES (?, ?, ?, ?)`,
      [
        mission.id,
        review.intervention?.requestedAt ?? null,
        review.intervention?.requestedBy ?? null,
        review.intervention?.reason ?? null,
      ],
    );

    for (const [roundPosition, round] of review.rounds.entries()) {
      const change = round.subject.change;
      const decision = round.decision;
      const approval = decision?.kind === 'approved' ? decision.source : null;
      await this.db.execute(
        `INSERT INTO mission_review_rounds
           (mission_id, position, round_number, change_kind, provider,
            provider_change_id, provider_url, source_branch, target_branch,
            revision, reviewer, implementer, started_at, decision_kind,
            decided_at, decision_comment, approval_source_kind,
            approval_source_provider, responded_at, resulting_revision)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          mission.id,
          roundPosition,
          round.number,
          change.kind,
          change.kind === 'pull-request' ? change.provider : null,
          change.kind === 'pull-request' ? change.id : null,
          change.kind === 'pull-request' ? change.url : null,
          change.sourceBranch,
          change.targetBranch,
          round.subject.revision,
          round.reviewer,
          round.implementer,
          round.startedAt,
          decision?.kind ?? null,
          decision?.decidedAt ?? null,
          decision?.comment ?? null,
          approval?.kind ?? null,
          approval?.kind === 'provider' ? approval.provider : null,
          round.response?.respondedAt ?? null,
          round.response?.resultingRevision ?? null,
        ],
      );

      if (decision?.kind === 'changes-requested') {
        for (const [position, finding] of decision.findings.entries()) {
          await this.db.execute(
            `INSERT INTO mission_review_findings
               (mission_id, round_position, position, finding_id, summary, location)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              mission.id,
              roundPosition,
              position,
              finding.id,
              finding.summary,
              finding.location,
            ],
          );
        }
      }
      if (round.response) {
        for (const [position, resolution] of round.response.resolutions.entries()) {
          await this.db.execute(
            `INSERT INTO mission_review_resolutions
               (mission_id, round_position, position, finding_id, kind, explanation)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              mission.id,
              roundPosition,
              position,
              resolution.findingId,
              resolution.kind,
              resolution.kind === 'fixed' ? resolution.evidence : resolution.rationale,
            ],
          );
        }
      }
    }
  }
}
