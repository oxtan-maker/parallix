import type { StatusMissionData } from '../../../application/ports/cli-workflows.js';
import type { Mission } from '../../../domain/mission.js';
import type { MissionCard } from '../../../application/projections/mission-board.js';
import { projectMissionActivity, type MissionActivitySource } from '../../../application/projections/mission-activity.js';
import { recordedClassification } from '../../../domain/mission-authoring.js';
import { latestEvidencedCheckpoint, type GoalCheckRow } from '../../../domain/checkpoint.js';
import { latestIntegrationRepair } from '../../../application/integration-repair-review.js';
import { readLegacyTaskContent } from '../../backlog/legacy-task-content.js';
import { readLegacyMissionContent, readLegacyReviewSnapshot } from '../../backlog/legacy-mission-content.js';

/** Carried rows name their source checkpoint; freshly recorded rows have no provenance key. */
function statusGoalCheckRow(row: GoalCheckRow) {
  return { criterion: row.criterion, criterionId: row.criterionId ?? null, evidence: row.evidence, ...(row.carriedFrom ? { carriedFrom: row.carriedFrom } : {}) };
}

type RecordedMission = { readonly mission: Mission; readonly version: number } | null;
type StatusSources = { recorded: RecordedMission; card: MissionCard | null; latest: ReturnType<typeof latestEvidencedCheckpoint>; brief: Mission['brief']; legacyTask: ReturnType<typeof readLegacyTaskContent> | null; legacyMission: ReturnType<typeof readLegacyMissionContent>; legacyReview: ReturnType<typeof readLegacyReviewSnapshot> };

export function projectStatusMissionData(recorded: RecordedMission, card: MissionCard | null, slug: string, rootDir: string): StatusMissionData {

  // The brief, the declared gates and the write version come from the
  // Mission store, not the board card: the card is a board view, while
  // these are Mission state.
  const latest = latestEvidencedCheckpoint(recorded?.mission.checkpoints ?? []);
  const brief = recorded?.mission.brief ?? null;
  const taskRef = recorded?.mission.externalTaskRef ?? null;
  const legacyTask = taskRef ? readLegacyTaskContent(taskRef, rootDir) : null;
  const legacyMission = readLegacyMissionContent(slug, rootDir);
  const legacyReview = readLegacyReviewSnapshot(slug, rootDir);
  const sources = { recorded, card, latest, brief, legacyTask, legacyMission, legacyReview };
  return {
    activity: card ? projectMissionActivity(card as MissionActivitySource) : null,
    ...authoringFields(sources),
    ...criteriaFields(sources),
    ...checkpointFields(sources),
    ...identityFields(sources),
    ...lifecycleFields(sources),
    ...legacyFields(sources),
    ...reviewFields(sources),
  };
}

function authoringFields({ recorded, brief }: StatusSources) {
  return {
    classification: recordedClassification(recorded?.mission.labels ?? []),
    brief: brief
      ? { goal: brief.goal, why: brief.why, scope: brief.scope, outOfScope: [...brief.outOfScope] }
      : null,
    description: recorded?.mission.description ?? null,
    declaredGates: [...(recorded?.mission.declaredGates ?? [])],
    predictedNelBucket: recorded?.mission.predictedNelBucket ?? null,
    reproductionTest: recorded?.mission.reproductionTest ?? null
  };
}

function criteriaFields({ recorded }: StatusSources) {
  return {
    successCriteria: [...(recorded?.mission.successCriteria ?? [])],
    successCriterionIds: recorded?.mission.successCriterionIds,
    completedSuccessCriteria: [...(recorded?.mission.completedSuccessCriteria ?? [])],
    dependencies: [...(recorded?.mission.dependencies ?? [])]
  };
}

function checkpointFields({ recorded, card, latest }: StatusSources) {
  return {
    checkpoints: (recorded?.mission.checkpoints ?? []).map((checkpoint) => ({
      name: checkpoint.name,
      repair: checkpoint.repair,
      description: checkpoint.firstLine ?? '',
      recorded: checkpoint.goalCheck.length > 0,
      goalCheck: checkpoint.goalCheck.map(statusGoalCheckRow),
    })),
    goalCheck: latest ? latest.goalCheck.map(statusGoalCheckRow) : [],
    nextAction: latest?.nextActionText ?? null,
    // A recorded checkpoint names itself. Only fall back to the board
    // card when nothing is recorded, so the reported name can never
    // belong to a different checkpoint than the Goal Check rows below it.
    checkpoint: latest?.name ?? card?.checkpoint,
    checkpointDescription: card?.checkpointDescription
  };
}

function identityFields({ recorded, card }: StatusSources) {
  return {
    assignee: recorded?.mission.assignee ?? null,
    // `title` is target-repository authority (MISSION_FIELD_AUTHORITY), so
    // it comes from the card. The stored title is written at `px draft`
    // intake while MISSION.md is still the scaffold, so reading it from
    // the aggregate reports the literal `<Title> (slug)` placeholder.
    title: card?.title ?? recorded?.mission.title ?? null,
    version: recorded?.version ?? null
  };
}

function lifecycleFields({ recorded, card }: StatusSources) {
  return {
    externalTaskRef: recorded?.mission.externalTaskRef
      ? {
        source: recorded.mission.externalTaskRef.source,
        id: recorded.mission.externalTaskRef.id,
        url: recorded.mission.externalTaskRef.url,
      }
      : null,
    missionStatus: recorded?.mission.status ?? card?.status,
    // Retained for the JSON compatibility surface; lifecycle presentation
    // reads missionStatus above, never this frozen intake field.
    backlogStatus: card?.rawStatus ?? card?.status ?? recorded?.mission.status ?? 'unknown',
    closedAt: recorded?.mission.closedAt ?? null
  };
}

function legacyFields({ legacyTask, legacyMission, legacyReview }: StatusSources) {
  return {
    legacyTaskContent: legacyTask?.content ?? null,
    legacyTaskError: legacyTask?.error ?? null,
    legacyMissionContent: legacyMission.content,
    legacyMissionError: legacyMission.error,
    legacyReviewStateContent: legacyReview.content,
    legacyReviewStateError: legacyReview.error
  };
}

function reviewFields({ recorded, card }: StatusSources) {
  return {
    reviewPhase: card?.reviewPhase,
    reviewRound: card?.reviewRound,
    reviewDisposition: card?.reviewDisposition,
    approvalOwed: card?.approvalOwed,
    approvalCoverage: card?.approvalCoverage ?? null,
    integrationRepair: recorded ? latestIntegrationRepair(recorded.mission) : null,
    reviewHistory: (card?.reviewHistory || []).map((r) => ({
      number: r.number,
      startRevision: r.startRevision,
      decidedRevision: r.decidedRevision ?? null,
      integrationRepairAssessment: r.integrationRepairAssessment as import('../../../domain/integration-approval-restoration.js').IntegrationRepairAssessment | undefined,
      reviewer: r.reviewer,
      implementer: r.implementer,
      disposition: r.disposition ?? 'pending',
      comment: r.comment,
      findingSummaries: r.findingSummaries || [],
      fixes: r.fixes || [],
      pushbacks: r.pushbacks || [],
      revocation: r.revocation ?? null,
      supersession: r.supersession ?? null,
    }))
  };
}
