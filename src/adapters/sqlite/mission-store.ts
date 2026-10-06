import type {
  MissionLoadResult,
  MissionNelRecordReceipt,
  MissionNelRecorder,
  MissionStore,
  MissionVersion,
} from '../../application/domain-ports.js';
import { missionVersion } from '../../application/domain-ports.js';
import type { LaneTransitionEvent } from '../../domain/board-event.js';
import type { MissionNelRecord } from '../../domain/net-engineering-lines.js';
import { missionTitle, type Mission, type MissionId } from '../../domain/mission.js';
import { missionBrief } from '../../domain/mission-brief.js';
import { declaredGates } from '../../domain/mission-gates.js';
import { completedCriteria, successCriteria } from '../../domain/mission-success-criteria.js';
import { missionDependencies } from '../../domain/mission-dependencies.js';
import type { KnownRepository, RepositoryId } from '../../domain/repository.js';
import type { ReviewerDecision } from '../../domain/review.js';
import type { SqliteDatabaseAdapter } from './database-adapter.js';
import { SqliteBoardLaneEventRepository } from './board-lane-event-repository.js';
import {
  hydrateMission,
  type MissionExternalTaskRefRecord,
  type MissionCheckpointRecord,
  type MissionGoalCheckRecord,
  type MissionLabelRecord,
  type MissionBriefRecord,
  type MissionBriefOutOfScopeRecord,
  type MissionDeclaredGateRecord,
  type MissionSuccessCriterionRecord,
  type MissionDependencyRecord,
  type MissionRecord,
  type MissionReviewEventRecord,
  type MissionReviewFindingRecord,
  type MissionReviewRecord,
  type MissionReviewResolutionRecord,
  type MissionReviewStageLaunchRecord,
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
 *
 * Aggregate reads and writes are serialized on this store. A write rewrites the
 * value collections as DELETE-then-INSERT, and composition shares a single
 * `DatabaseSync` handle process-wide, so a transaction gives a concurrent read
 * on that same handle no isolation whatsoever: a `load` that interleaves with a
 * `save` observes the aggregate mid-rewrite and reports a mission whose Review
 * has vanished. The review loop does exactly that — recording a stage launch
 * while consuming reviewer artifacts — and the reviewer's verdict was dropped
 * with "no Review in the operator database" while the Review was on disk the
 * whole time. Concurrency between *processes* keeps SQLite's own isolation;
 * this queue closes the in-process window that shared handle opens.
 */
export class SqliteMissionStore implements MissionStore, MissionNelRecorder {
  private readonly eventRepo: SqliteBoardLaneEventRepository;
  /** Tail of the serialized aggregate-operation chain. */
  private aggregateQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly db: SqliteDatabaseAdapter) {
    this.eventRepo = new SqliteBoardLaneEventRepository(db);
  }

  /**
   * Run an aggregate operation after every operation already queued.
   *
   * A rejected operation must not poison the chain: the next caller waits for
   * this one to settle, not to succeed.
   */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.aggregateQueue.then(operation, operation);
    this.aggregateQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  /** Resolve once every queued aggregate operation has settled. */
  async drain(): Promise<void> {
    await this.aggregateQueue;
  }

  async load(id: MissionId): Promise<MissionLoadResult> {
    return this.enqueue(() => this.loadAggregate(id));
  }

  async loadByRepository(repositoryId: RepositoryId): Promise<readonly Mission[]> {
    return this.enqueue(async () => {
      const rows = await this.db.query<{ id: MissionId }>(
        'SELECT id FROM missions WHERE repository_id = ? ORDER BY id',
        [repositoryId],
      );
      const loaded = await Promise.all(rows.map(({ id }) => this.loadAggregate(id)));
      return loaded.flatMap((result) => result.kind === 'found' ? [result.mission] : []);
    });
  }

  async save(
    mission: Mission,
    expectedVersion: MissionVersion | null,
  ): Promise<MissionVersion> {
    return this.enqueue(() => this.saveAggregate(mission, expectedVersion));
  }

  async saveWithTransition(
    mission: Mission,
    expectedVersion: MissionVersion | null,
    event: LaneTransitionEvent,
  ): Promise<MissionVersion> {
    return this.enqueue(() => this.saveAggregateWithTransition(mission, expectedVersion, event));
  }

  async findTransitions(missionId: MissionId) {
    return this.eventRepo.findByMissionId(missionId);
  }

  async cancel(id: MissionId): Promise<void> {
    return this.enqueue(() => this.cancelAggregate(id));
  }

  private async loadAggregate(id: MissionId): Promise<MissionLoadResult> {
    const missionRows = await this.db.query<MissionRecord>(
      `SELECT id, repository_id, title, status, raw_status, assignee,
              net_engineering_lines, reproduction_test, predicted_nel_bucket, closed_at, version
       FROM missions WHERE id = ?`,
      [id],
    );
    if (missionRows.length === 0) {
      return { kind: 'missing' };
    }

    const [
      labels,
      briefs,
      briefOutOfScope,
      gateRows,
      criterionRows,
      dependencyRows,
      checkpoints,
      goalChecks,
      reviews,
      reviewRounds,
      findings,
      resolutions,
      externalRefs,
      stageLaunches,
      reviewEvents,
    ] =
      await Promise.all([
        this.db.query<MissionLabelRecord>(
          'SELECT mission_id, position, label FROM mission_labels WHERE mission_id = ? ORDER BY position',
          [id],
        ),
        this.db.query<MissionBriefRecord>('SELECT mission_id, goal, why_text, scope_text FROM mission_briefs WHERE mission_id = ?', [id]),
        this.db.query<MissionBriefOutOfScopeRecord>('SELECT mission_id, position, entry FROM mission_brief_out_of_scope WHERE mission_id = ? ORDER BY position', [id]),
        this.db.query<MissionDeclaredGateRecord>('SELECT mission_id, position, command FROM mission_declared_gates WHERE mission_id = ? ORDER BY position', [id]),
        this.db.query<MissionSuccessCriterionRecord>('SELECT mission_id, position, criterion, completed FROM mission_success_criteria WHERE mission_id = ? ORDER BY position', [id]),
        this.db.query<MissionDependencyRecord>('SELECT mission_id, position, depends_on_mission_id FROM mission_dependencies WHERE mission_id = ? ORDER BY position', [id]),
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
                  decided_at, decision_comment, classifier_source, approval_source_kind,
                  approval_source_provider, revoked_at, revoked_by, revoked_reason, revoked_cause, revoked_gate, revoked_gate_command, revoked_gate_log,
                  superseded_at, superseding_revision, superseded_by, responded_at, resulting_revision,
                  phase, disposition, reviewer_retry_count, implementer_retry_count,
                  implementer_response_content, item_dispositions, blocked_reason
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
        this.db.query<MissionReviewStageLaunchRecord>(
          `SELECT mission_id, stage_key, position, fingerprint
           FROM mission_review_stage_launches
           WHERE mission_id = ? ORDER BY stage_key, position`,
          [id],
        ),
        this.db.query<MissionReviewEventRecord>(
          `SELECT mission_id, position, event_type, round_number, phase, actor,
                  content, disposition, verdict, item_dispositions, blocked_reason, followup_reference, created_at
           FROM mission_review_events
           WHERE mission_id = ? ORDER BY position`,
          [id],
        ),
      ]);

    const hydrated = hydrateMission({
      mission: missionRows[0],
      externalTaskRef: externalRefs[0] ?? null,
      labels,
      brief: briefs[0] ?? null,
      briefOutOfScope,
      declaredGates: gateRows,
      successCriteria: criterionRows,
      dependencies: dependencyRows,
      checkpoints,
      goalChecks,
      review: reviews[0] ?? null,
      reviewRounds,
      findings,
      resolutions,
      stageLaunches,
      reviewEvents,
    });
    return { kind: 'found', ...hydrated };
  }

  /**
   * Delete one mission's lifecycle rows in a single transaction.
   *
   * Every statement filters on the one id. The `missions` row cascades
   * `mission_labels`, `mission_checkpoints`, `mission_checkpoint_goal_checks`,
   * `mission_reviews`, `mission_review_rounds`, `mission_review_findings`,
   * `mission_review_resolutions`, `mission_review_stage_launches`,
   * `mission_review_events` and `mission_external_task_refs`; the two tables
   * below carry no foreign key and are deleted explicitly. `usage_statistics`
   * is deliberately absent: a cancelled mission still cost what it cost.
   */
  private async cancelAggregate(id: MissionId): Promise<void> {
    const pragma = await this.db.query<{ foreign_keys: number }>('PRAGMA foreign_keys');
    if (pragma[0]?.foreign_keys !== 1) {
      throw new Error(`Refusing to cancel ${id}: PRAGMA foreign_keys is not enabled on this connection`);
    }
    await this.db.beginTransaction();
    try {
      const current = await this.db.query<{ status: string }>('SELECT status FROM missions WHERE id = ?', [id]);
      if (current[0]?.status === 'done') {
        throw new Error(`Refusing to cancel ${id}: integrated Mission closeout must finish through px integrate --recover-landed`);
      }
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

  private async saveAggregate(
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

  private async saveAggregateWithTransition(
    mission: Mission,
    expectedVersion: MissionVersion | null,
    event: LaneTransitionEvent,
  ): Promise<MissionVersion> {
    if (event.missionId !== mission.id || event.repositoryId !== mission.repositoryId) {
      throw new Error('LaneTransitionEvent does not identify the Mission being saved');
    }
    await this.db.beginTransaction();
    try {
      const version = await this.persistAggregate(mission, expectedVersion);
      const appended = await this.eventRepo.append({
        repositoryId: event.repositoryId,
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

  // -----------------------------------------------------------------------
  // MissionNelRecorder
  // -----------------------------------------------------------------------

  /**
   * Record the structured NEL report in the missions table.
   *
   * The `net_engineering_lines` column is the authoritative NEL field.
   * The additional structured fields (predicted bucket, actual bucket,
   * review rounds, capturedAt, artifacts) are recorded as part of the
   * Mission aggregate through the `save()` call in MissionHandoffService.
   * This method persists the NEL measurement and returns a row reference.
   */
  async recordNel(record: MissionNelRecord): Promise<MissionNelRecordReceipt> {
    await this.db.execute(
      'UPDATE missions SET net_engineering_lines = ? WHERE id = ?',
      [record.netEngineeringLines, record.missionId],
    );
    return {
      reference: `missions:${record.missionId}`,
    };
  }

  private async persistAggregate(
    mission: Mission,
    expectedVersion: MissionVersion | null,
  ): Promise<MissionVersion> {
    // MissionStore is a public persistence port: callers other than the brief
    // service may save an aggregate, so reject an invalid brief or gate list
    // before any relational row can make a Mission unloadable on restart.
    mission = { ...mission, title: missionTitle(mission.title, mission.id) };
    if (mission.brief) {
      mission = { ...mission, brief: missionBrief(mission.brief) };
    }
    if (mission.declaredGates && mission.declaredGates.length > 0) {
      mission = { ...mission, declaredGates: declaredGates(mission.declaredGates) };
    }
    if (mission.successCriteria && mission.successCriteria.length > 0) {
      mission = { ...mission, successCriteria: successCriteria(mission.successCriteria) };
    }
    if (mission.completedSuccessCriteria && mission.completedSuccessCriteria.length > 0) {
      mission = { ...mission, completedSuccessCriteria: completedCriteria(mission.completedSuccessCriteria, mission.successCriteria?.length ?? 0) };
    }
    if (mission.dependencies && mission.dependencies.length > 0) {
      mission = { ...mission, dependencies: missionDependencies(mission.dependencies, mission.id) };
    }
    const params = [
      mission.repositoryId,
      mission.title,
      mission.status,
      mission.rawStatus ?? null,
      mission.assignee,
      mission.netEngineeringLines,
      mission.reproductionTest ?? null,
      mission.predictedNelBucket ?? null,
      mission.closedAt,
    ] as const;

    let nextVersion: MissionVersion;
    if (expectedVersion === null) {
      try {
        await this.db.execute(
          `INSERT INTO missions
             (id, repository_id, title, status, raw_status, assignee,
              net_engineering_lines, reproduction_test, predicted_nel_bucket, closed_at, version)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
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
           net_engineering_lines = ?, reproduction_test = ?, predicted_nel_bucket = ?, closed_at = ?, version = version + 1
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
      await this.clearAggregateValues(mission);
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

  /**
   * Clear the value collections a write is about to rewrite.
   *
   * The `mission_reviews` row is kept whenever the mission still has a Review:
   * every other review table cascades from it, so deleting it discards the
   * rounds, findings, resolutions, stage launches and the whole review-event
   * audit trail on every unrelated save. The row is updated in place by
   * `insertReview` instead, and its children are cleared explicitly here.
   */
  private async clearAggregateValues(mission: Mission): Promise<void> {
    const id = mission.id;
    await this.db.execute('DELETE FROM mission_external_task_refs WHERE mission_id = ?', [id]);
    await this.db.execute('DELETE FROM mission_briefs WHERE mission_id = ?', [id]);
    await this.db.execute('DELETE FROM mission_declared_gates WHERE mission_id = ?', [id]);
    await this.db.execute('DELETE FROM mission_success_criteria WHERE mission_id = ?', [id]);
    await this.db.execute('DELETE FROM mission_dependencies WHERE mission_id = ?', [id]);
    await this.db.execute('DELETE FROM mission_checkpoints WHERE mission_id = ?', [id]);
    await this.db.execute('DELETE FROM mission_labels WHERE mission_id = ?', [id]);
    if (!mission.review) {
      // No Review to keep: the cascade clears every review table.
      await this.db.execute('DELETE FROM mission_reviews WHERE mission_id = ?', [id]);
      return;
    }
    await this.db.execute('DELETE FROM mission_review_events WHERE mission_id = ?', [id]);
    await this.db.execute('DELETE FROM mission_review_stage_launches WHERE mission_id = ?', [id]);
    await this.db.execute('DELETE FROM mission_review_resolutions WHERE mission_id = ?', [id]);
    await this.db.execute('DELETE FROM mission_review_findings WHERE mission_id = ?', [id]);
    await this.db.execute('DELETE FROM mission_review_rounds WHERE mission_id = ?', [id]);
  }

  private async insertAggregateValues(mission: Mission): Promise<void> {
    if (mission.brief) {
      const brief = mission.brief;
      await this.db.execute(
        'INSERT INTO mission_briefs (mission_id, goal, why_text, scope_text) VALUES (?, ?, ?, ?)',
        [mission.id, brief.goal, brief.why, brief.scope],
      );
      for (const [position, entry] of brief.outOfScope.entries()) {
        await this.db.execute(
          'INSERT INTO mission_brief_out_of_scope (mission_id, position, entry) VALUES (?, ?, ?)',
          [mission.id, position, entry],
        );
      }
    }
    for (const [position, command] of (mission.declaredGates ?? []).entries()) {
      await this.db.execute(
        'INSERT INTO mission_declared_gates (mission_id, position, command) VALUES (?, ?, ?)',
        [mission.id, position, command],
      );
    }
    for (const [position, dependency] of (mission.dependencies ?? []).entries()) {
      await this.db.execute(
        'INSERT INTO mission_dependencies (mission_id, position, depends_on_mission_id) VALUES (?, ?, ?)',
        [mission.id, position, dependency],
      );
    }
    for (const [position, criterion] of (mission.successCriteria ?? []).entries()) {
      await this.db.execute(
        'INSERT INTO mission_success_criteria (mission_id, position, criterion, completed) VALUES (?, ?, ?, ?)',
        [mission.id, position, criterion, (mission.completedSuccessCriteria ?? []).includes(position) ? 1 : 0],
      );
    }
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
    // Upsert, never delete-and-reinsert: the review children cascade from this
    // row, and a concurrent reader must never observe the mission without it.
    await this.db.execute(
      `INSERT INTO mission_reviews
         (mission_id, intervention_requested_at, intervention_requested_by,
          intervention_reason)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(mission_id) DO UPDATE SET
         intervention_requested_at = excluded.intervention_requested_at,
         intervention_requested_by = excluded.intervention_requested_by,
         intervention_reason = excluded.intervention_reason`,
      [
        mission.id,
        review.intervention?.requestedAt ?? null,
        review.intervention?.requestedBy ?? null,
        review.intervention?.reason ?? null,
      ],
    );

    for (const [roundPosition, round] of review.rounds.entries()) {
      await this.insertReviewRound(mission.id, roundPosition, round);
    }

    for (const window of review.stageLaunches) {
      for (const [position, fingerprint] of window.fingerprints.entries()) {
        await this.db.execute(
          `INSERT INTO mission_review_stage_launches
             (mission_id, stage_key, position, fingerprint)
           VALUES (?, ?, ?, ?)`,
          [mission.id, window.stageKey, position, fingerprint],
        );
      }
    }

    // Insert review events (audit trail, replaces .md files)
    for (const [position, event] of review.reviewEvents.entries()) {
      await this.db.execute(
        `INSERT INTO mission_review_events
           (mission_id, position, event_type, round_number, phase, actor,
            content, disposition, verdict, item_dispositions, blocked_reason, followup_reference, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [mission.id, position, event.eventType, event.roundNumber, event.phase, event.actor,
          event.content, event.disposition, event.verdict,
          event.itemDispositions ? JSON.stringify(event.itemDispositions) : null,
          event.blockedReason, event.followUpReference, event.createdAt],
      );
    }
  }

  private async insertReviewRound(missionId: string, roundPosition: number, round: any): Promise<void> {
      const change = round.subject.change;
      const decision = round.decision;
      const approval = decision?.kind === 'approved' ? decision.source : null;
      await this.db.execute(
        `INSERT INTO mission_review_rounds
           (mission_id, position, round_number, change_kind, provider,
            provider_change_id, provider_url, source_branch, target_branch,
            revision, reviewer, implementer, started_at, decision_kind,
            decided_at, decision_comment, classifier_source, approval_source_kind,
            approval_source_provider, revoked_at, revoked_by, revoked_reason, revoked_cause, revoked_gate, revoked_gate_command, revoked_gate_log,
                  superseded_at, superseding_revision, superseded_by, responded_at, resulting_revision,
            phase, disposition, reviewer_retry_count, implementer_retry_count,
            implementer_response_content, item_dispositions, blocked_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          missionId,
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
          decision?.classifier ? JSON.stringify(decision.classifier) : null,
          approval?.kind ?? null,
          approval?.kind === 'provider' ? approval.provider : null,
          decision?.kind === 'approved' ? decision.revocation?.revokedAt ?? null : null,
          decision?.kind === 'approved' ? decision.revocation?.revokedBy ?? null : null,
          decision?.kind === 'approved' ? decision.revocation?.reason ?? null : null,
          decision?.kind === 'approved' ? decision.revocation?.cause?.kind ?? null : null,
          ...gateFailureColumns(decision),
          decision?.kind === 'approved' ? decision.supersession?.supersededAt ?? null : null,
          decision?.kind === 'approved' ? decision.supersession?.supersedingRevision ?? null : null,
          decision?.kind === 'approved' ? decision.supersession?.recordedBy ?? null : null,
          round.response?.respondedAt ?? null,
          round.response?.resultingRevision ?? null,
          round.phase,
          round.disposition,
          round.reviewerRetryCount,
          round.implementerRetryCount,
          round.implementerResponseContent ?? null,
          round.itemDispositions ? JSON.stringify(round.itemDispositions) : null,
          round.blockedReason ?? null,
        ],
      );

      if (decision?.kind === 'changes-requested') {
        for (const [position, finding] of decision.findings.entries()) {
          await this.db.execute(
            `INSERT INTO mission_review_findings
               (mission_id, round_position, position, finding_id, summary, location)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
              missionId,
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
              missionId,
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

/** The red integration gate recorded on a withdrawn approval, as its three columns. */
function gateFailureColumns(decision: ReviewerDecision | null): [string | null, string | null, string | null] {
  const cause = decision?.kind === 'approved' ? decision.revocation?.cause : undefined;
  if (cause?.kind !== 'integration-gate-failure') { return [null, null, null]; }
  return [cause.gate, cause.command ?? null, cause.log ?? null];
}
