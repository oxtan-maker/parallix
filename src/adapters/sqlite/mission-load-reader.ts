

import type { MissionLoadResult } from '../../application/domain-ports.js';

import type { SqliteDatabaseAdapter } from './database-adapter.js';

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

/**
 * Load every aggregate a scope selects with one query per table instead of
 * one per table per mission. `missions` filters the `missions` table and
 * `children` the child tables; both bind the same `params`.
 */
export async function readMissionAggregates(db: SqliteDatabaseAdapter, scope: MissionQueryScope): Promise<MissionLoadResult[]> {
  const params = [...scope.params];
  const missionRows = await db.query<MissionRecord>(
    `SELECT id, repository_id, title, status, raw_status, assignee,
              net_engineering_lines, reproduction_test, predicted_nel_bucket, description, closed_at, version, next_success_criterion_id
       FROM missions WHERE ${scope.missions} ORDER BY id`,
    params,
  );
  if (missionRows.length === 0) { return []; }

  const [authoring, review] = await Promise.all([readAuthoringRows(db, scope, params), readReviewRows(db, scope, params)]);
  const { labels, briefs, briefOutOfScope, gateRows, criterionRows, dependencyRows, checkpoints, goalChecks, reviews, reviewRounds, findings, resolutions, externalRefs, stageLaunches, reviewEvents } = { ...authoring, ...review };

  const byMission = <T extends { readonly mission_id: string }>(rows: readonly T[]) => {
    const grouped = new Map<string, T[]>();
    for (const row of rows) {
      const group = grouped.get(row.mission_id);
      if (group === undefined) { grouped.set(row.mission_id, [row]); } else { group.push(row); }
    }
    return (id: string): T[] => grouped.get(id) ?? [];
  };
  const labelsOf = byMission(labels);
  const briefsOf = byMission(briefs);
  const briefOutOfScopeOf = byMission(briefOutOfScope);
  const gatesOf = byMission(gateRows);
  const criteriaOf = byMission(criterionRows);
  const dependenciesOf = byMission(dependencyRows);
  const checkpointsOf = byMission(checkpoints);
  const goalChecksOf = byMission(goalChecks);
  const reviewsOf = byMission(reviews);
  const roundsOf = byMission(reviewRounds);
  const findingsOf = byMission(findings);
  const resolutionsOf = byMission(resolutions);
  const externalRefsOf = byMission(externalRefs);
  const stageLaunchesOf = byMission(stageLaunches);
  const reviewEventsOf = byMission(reviewEvents);

  return missionRows.map((mission): MissionLoadResult => ({
    kind: 'found',
    ...hydrateMission({
      mission,
      externalTaskRef: externalRefsOf(mission.id)[0] ?? null,
      labels: labelsOf(mission.id),
      brief: briefsOf(mission.id)[0] ?? null,
      briefOutOfScope: briefOutOfScopeOf(mission.id),
      declaredGates: gatesOf(mission.id),
      successCriteria: criteriaOf(mission.id),
      dependencies: dependenciesOf(mission.id),
      checkpoints: checkpointsOf(mission.id),
      goalChecks: goalChecksOf(mission.id),
      review: reviewsOf(mission.id)[0] ?? null,
      reviewRounds: roundsOf(mission.id),
      findings: findingsOf(mission.id),
      resolutions: resolutionsOf(mission.id),
      stageLaunches: stageLaunchesOf(mission.id),
      reviewEvents: reviewEventsOf(mission.id),
    }),
  }));
}
interface MissionQueryScope { readonly missions: string; readonly children: string; readonly params: readonly string[] }

async function readAuthoringRows(db: SqliteDatabaseAdapter, scope: MissionQueryScope, params: readonly string[]) {
  const [labels, briefs, briefOutOfScope, gateRows, criterionRows, dependencyRows, checkpoints, goalChecks] = await Promise.all([
    db.query<MissionLabelRecord>(
      `SELECT mission_id, position, label FROM mission_labels WHERE ${scope.children} ORDER BY mission_id, position`,
      params,
    ),
    db.query<MissionBriefRecord>(`SELECT mission_id, goal, why_text, scope_text FROM mission_briefs WHERE ${scope.children}`, params),
    db.query<MissionBriefOutOfScopeRecord>(`SELECT mission_id, position, entry FROM mission_brief_out_of_scope WHERE ${scope.children} ORDER BY mission_id, position`, params),
    db.query<MissionDeclaredGateRecord>(`SELECT mission_id, position, command FROM mission_declared_gates WHERE ${scope.children} ORDER BY mission_id, position`, params),
    db.query<MissionSuccessCriterionRecord>(`SELECT mission_id, position, criterion, criterion_id, completed FROM mission_success_criteria WHERE ${scope.children} ORDER BY mission_id, position`, params),
    db.query<MissionDependencyRecord>(`SELECT mission_id, position, depends_on_mission_id FROM mission_dependencies WHERE ${scope.children} ORDER BY mission_id, position`, params),
    db.query<MissionCheckpointRecord>(
      `SELECT mission_id, position, checkpoint_mission_id, name, raw_filename,
                  first_line, next_action_text, repair_json, recording_json
           FROM mission_checkpoints WHERE ${scope.children} ORDER BY mission_id, position`,
      params,
    ),
    db.query<MissionGoalCheckRecord>(
      `SELECT mission_id, checkpoint_position, position, criterion, criterion_id, evidence, recorded_round, repaired_gate, repaired_gates, carried_from
           FROM mission_checkpoint_goal_checks
           WHERE ${scope.children} ORDER BY mission_id, checkpoint_position, position`,
      params,
    )
  ]);
  return { labels, briefs, briefOutOfScope, gateRows, criterionRows, dependencyRows, checkpoints, goalChecks };
}

async function readReviewRows(db: SqliteDatabaseAdapter, scope: MissionQueryScope, params: readonly string[]) {
  const [reviews, reviewRounds, findings, resolutions, externalRefs, stageLaunches, reviewEvents] = await Promise.all([
    db.query<MissionReviewRecord>(
      `SELECT mission_id, intervention_requested_at, intervention_requested_by,
                  intervention_reason
           FROM mission_reviews WHERE ${scope.children}`,
      params,
    ),
    db.query<MissionReviewRoundRecord>(
      `SELECT mission_id, position, round_number, change_kind, provider,
                  provider_change_id, provider_url, source_branch, target_branch,
                  revision, review_baseline, reviewer, implementer, started_at, decision_kind,
                  decided_at, decided_revision, decision_comment, classifier_source, integration_repair_assessment, mechanical_source, approval_source_kind,
                  approval_source_provider, revoked_at, revoked_by, revoked_reason, revoked_cause, revoked_gate, revoked_gate_command, revoked_gate_log,
                  superseded_at, superseding_revision, superseded_by, responded_at, resulting_revision,
                  phase, disposition, reviewer_retry_count, implementer_retry_count,
                  implementer_response_content, item_dispositions, blocked_reason
           FROM mission_review_rounds WHERE ${scope.children} ORDER BY mission_id, position`,
      params,
    ),
    db.query<MissionReviewFindingRecord>(
      `SELECT mission_id, round_position, position, finding_id, summary, location
           FROM mission_review_findings
           WHERE ${scope.children} ORDER BY mission_id, round_position, position`,
      params,
    ),
    db.query<MissionReviewResolutionRecord>(
      `SELECT mission_id, round_position, position, finding_id, kind, explanation
           FROM mission_review_resolutions
           WHERE ${scope.children} ORDER BY mission_id, round_position, position`,
      params,
    ),
    db.query<MissionExternalTaskRefRecord>(
      `SELECT mission_id, source, external_id, url
           FROM mission_external_task_refs WHERE ${scope.children}`,
      params,
    ),
    db.query<MissionReviewStageLaunchRecord>(
      `SELECT mission_id, stage_key, position, fingerprint
           FROM mission_review_stage_launches
           WHERE ${scope.children} ORDER BY mission_id, stage_key, position`,
      params,
    ),
    db.query<MissionReviewEventRecord>(
      `SELECT mission_id, position, event_type, round_number, phase, actor,
                  content, disposition, verdict, item_dispositions, blocked_reason, followup_reference, created_at
           FROM mission_review_events
           WHERE ${scope.children} ORDER BY mission_id, position`,
      params,
    )
  ]);
  return { reviews, reviewRounds, findings, resolutions, externalRefs, stageLaunches, reviewEvents };
}
