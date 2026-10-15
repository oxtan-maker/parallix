import type { SqlParameter } from './database-adapter.js';

import { type Mission } from '../../domain/mission.js';

import type { ReviewerDecision, ReviewRound } from '../../domain/review.js';

import type { SqliteDatabaseAdapter } from './database-adapter.js';

export class SqliteMissionValueWriter {
  constructor(private readonly db: SqliteDatabaseAdapter) { }

  async insert(mission: Mission): Promise<void> {
    await this.insertAuthoring(mission);
    await this.insertMirrors(mission);
    await this.insertCheckpoints(mission);
    if (mission.review) {
      await this.insertReview(mission);
    }
  }

  private async insertAuthoring(mission: Mission): Promise<void> {
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
        'INSERT INTO mission_success_criteria (mission_id, position, criterion, completed, criterion_id) VALUES (?, ?, ?, ?, ?)',
        [mission.id, position, criterion, (mission.completedSuccessCriteria ?? []).includes(position) ? 1 : 0, mission.successCriterionIds?.[position] ?? null],
      );
    }
  }

  private async insertMirrors(mission: Mission): Promise<void> {
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
  }

  private async insertCheckpoints(mission: Mission): Promise<void> {
    for (const [checkpointPosition, checkpoint] of mission.checkpoints.entries()) {
      await this.db.execute(
        `INSERT INTO mission_checkpoints
           (mission_id, position, checkpoint_mission_id, name, raw_filename,
            first_line, next_action_text, repair_json, recording_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          mission.id,
          checkpointPosition,
          checkpoint.missionId,
          checkpoint.name,
          checkpoint.rawFilename ?? null,
          checkpoint.firstLine ?? null,
          checkpoint.nextActionText,
          checkpoint.repair ? JSON.stringify(checkpoint.repair) : null,
          checkpoint.recording ? JSON.stringify(checkpoint.recording) : null,
        ],
      );
      for (const [position, row] of checkpoint.goalCheck.entries()) {
        await this.db.execute(
          `INSERT INTO mission_checkpoint_goal_checks
             (mission_id, checkpoint_position, position, criterion, evidence, recorded_round, repaired_gate, repaired_gates, criterion_id, carried_from)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [mission.id, checkpointPosition, position, row.criterion, row.evidence, row.recordedRound ?? null, row.repairedGate ?? null, row.repairedGates ? JSON.stringify(row.repairedGates) : null, row.criterionId ?? null, row.carriedFrom ?? null],
        );
      }
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

  private async insertReviewRound(missionId: string, roundPosition: number, round: ReviewRound): Promise<void> {
    const decision = round.decision;
    await this.db.execute(
      `INSERT INTO mission_review_rounds
           (mission_id, position, round_number, change_kind, provider,
            provider_change_id, provider_url, source_branch, target_branch,
            revision, review_baseline, reviewer, implementer, started_at, decision_kind,
            decided_at, decided_revision, decision_comment, classifier_source, integration_repair_assessment, mechanical_source, approval_source_kind,
            approval_source_provider, revoked_at, revoked_by, revoked_reason, revoked_cause, revoked_gate, revoked_gate_command, revoked_gate_log,
                  superseded_at, superseding_revision, superseded_by, responded_at, resulting_revision,
            phase, disposition, reviewer_retry_count, implementer_retry_count,
            implementer_response_content, item_dispositions, blocked_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [missionId, roundPosition, ...reviewIdentityColumns(round), ...reviewDecisionColumns(round), ...reviewApprovalColumns(round), ...reviewWithdrawalColumns(round), ...reviewSupersessionColumns(round), ...reviewResponseColumns(round)],
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
function reviewIdentityColumns(round: ReviewRound): SqlParameter[] {
  const change = round.subject.change;
  return [
    round.number,
    change.kind,
    change.kind === 'pull-request' ? change.provider : null,
    change.kind === 'pull-request' ? change.id : null,
    change.kind === 'pull-request' ? change.url : null,
    change.sourceBranch,
    change.targetBranch,
    round.subject.revision,
    round.subject.baseline ?? null,
    round.reviewer,
    round.implementer,
    round.startedAt,
  ];
}

function reviewDecisionColumns(round: ReviewRound): SqlParameter[] {
  const decision = round.decision;
  return [
    decision?.kind ?? null,
    decision?.decidedAt ?? null,
    decision?.revision ?? null,
    decision?.comment ?? null,
    decision?.classifier ? JSON.stringify(decision.classifier) : null,
    round.integrationRepairAssessment ? JSON.stringify(round.integrationRepairAssessment) : null,
  ];
}

function reviewApprovalColumns(round: ReviewRound): SqlParameter[] {
  const decision = round.decision;
  const approval = decision?.kind === 'approved' ? decision.source : null;
  return [
    approval?.kind === 'mechanical-restoration' ? JSON.stringify(approval) : null,
    approval?.kind === 'mechanical-restoration' ? 'local' : approval?.kind ?? null,
    approval?.kind === 'provider' ? approval.provider : null,
  ];
}

function reviewWithdrawalColumns(round: ReviewRound): SqlParameter[] {
  const decision = round.decision;
  const revocation = decision?.kind === 'approved' ? decision.revocation : undefined;
  return [
    revocation?.revokedAt ?? null,
    revocation?.revokedBy ?? null,
    revocation?.reason ?? null,
    revocation?.cause?.kind ?? null,
    ...gateFailureColumns(decision),
  ];
}

function reviewSupersessionColumns(round: ReviewRound): SqlParameter[] {
  const decision = round.decision;
  const supersession = decision?.kind === 'approved' ? decision.supersession : undefined;
  return [
    supersession?.supersededAt ?? null,
    supersession?.supersedingRevision ?? null,
    supersession?.recordedBy ?? null,
  ];
}

function reviewResponseColumns(round: ReviewRound): SqlParameter[] {

  return [
    round.response?.respondedAt ?? null,
    round.response?.resultingRevision ?? null,
    round.phase,
    round.disposition,
    round.reviewerRetryCount,
    round.implementerRetryCount,
    round.implementerResponseContent ?? null,
    round.itemDispositions ? JSON.stringify(round.itemDispositions) : null,
    round.blockedReason ?? null,
  ];
}
