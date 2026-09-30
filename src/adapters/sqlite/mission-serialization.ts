import { agentFamily } from '../../domain/agents.js';
import type { CheckpointData, GoalCheckRow } from '../../domain/checkpoint.js';
import { externalTaskRef, type ExternalTaskRef } from '../../domain/external-task.js';
import { isCheckpointName } from '../../domain/checkpoint.js';
import {
  missionId,
  missionLabels,
  type Mission,
  type MissionStatus,
} from '../../domain/mission.js';
import { parseMissionStatus } from '../../domain/board-event.js';
import { repositoryId } from '../../domain/repository.js';
import {
  changeRevision,
  reviewFindingId,
  REVIEW_DISPOSITIONS,
  REVIEW_PHASES,
  type FindingResolution,
  type Review,
  type ReviewDisposition,
  type ReviewEventRecord,
  type ReviewEventType,
  type ReviewFinding,
  type ReviewItemDisposition,
  type ReviewPhase,
  type ReviewRound,
  type ReviewerDecision,
  type ReviewRevocationCause,
  type StageLaunchWindow,
} from '../../domain/review.js';
import { missionVersion, type MissionVersion } from '../../application/domain-ports.js';
import { missionBrief, type MissionBrief } from '../../domain/mission-brief.js';
import { declaredGates } from '../../domain/mission-gates.js';
import { successCriteria } from '../../domain/mission-success-criteria.js';
import { missionDependencies } from '../../domain/mission-dependencies.js';
import type { NelBucketLabel } from '../../domain/net-engineering-lines.js';

/** Typed records returned by the relational Mission schema. */
export interface MissionRecord {
  readonly id: string;
  readonly repository_id: string;
  readonly title: string;
  readonly status: string;
  readonly raw_status: string | null;
  readonly reproduction_test?: string | null;
  readonly predicted_nel_bucket?: string | null;
  readonly assignee: string | null;
  readonly net_engineering_lines: number | null;
  readonly closed_at: string | null;
  readonly version: number;
}

export interface MissionLabelRecord {
  readonly mission_id: string;
  readonly position: number;
  readonly label: string;
}
export interface MissionBriefRecord { readonly mission_id: string; readonly goal: string; readonly why_text: string; readonly scope_text: string | null; }
export interface MissionBriefOutOfScopeRecord { readonly mission_id: string; readonly position: number; readonly entry: string; }
export interface MissionDeclaredGateRecord { readonly mission_id: string; readonly position: number; readonly command: string; }
export interface MissionSuccessCriterionRecord { readonly mission_id: string; readonly position: number; readonly criterion: string; }
export interface MissionDependencyRecord { readonly mission_id: string; readonly position: number; readonly depends_on_mission_id: string; }

export interface MissionCheckpointRecord {
  readonly mission_id: string;
  readonly position: number;
  readonly checkpoint_mission_id: string;
  readonly name: string;
  readonly raw_filename: string | null;
  readonly first_line: string | null;
  readonly next_action_text: string;
}

export interface MissionGoalCheckRecord {
  readonly mission_id: string;
  readonly checkpoint_position: number;
  readonly position: number;
  readonly criterion: string;
  readonly evidence: string;
}

export interface MissionReviewRecord {
  readonly mission_id: string;
  readonly intervention_requested_at: string | null;
  readonly intervention_requested_by: string | null;
  readonly intervention_reason: string | null;
}

export interface MissionReviewRoundRecord {
  readonly mission_id: string;
  readonly position: number;
  readonly round_number: number;
  readonly change_kind: string;
  readonly provider: string | null;
  readonly provider_change_id: string | null;
  readonly provider_url: string | null;
  readonly source_branch: string;
  readonly target_branch: string;
  readonly revision: string;
  readonly reviewer: string;
  readonly implementer: string;
  readonly started_at: string;
  readonly decision_kind: string | null;
  readonly decided_at: string | null;
  readonly decision_comment: string | null;
  readonly approval_source_kind: string | null;
  readonly approval_source_provider: string | null;
  readonly revoked_at: string | null;
  readonly revoked_by: string | null;
  readonly revoked_reason: string | null;
  readonly revoked_cause?: string | null;
  readonly revoked_gate?: string | null;
  readonly revoked_gate_command?: string | null;
  readonly revoked_gate_log?: string | null;
  readonly superseded_at?: string | null;
  readonly superseding_revision?: string | null;
  readonly superseded_by?: string | null;
  readonly responded_at: string | null;
  readonly resulting_revision: string | null;
  readonly phase: string;
  readonly disposition: string | null;
  readonly reviewer_retry_count: number;
  readonly implementer_retry_count: number;
  readonly implementer_response_content: string | null;
  /** JSON array of {kind: 'fixed'|'pushed_back'|'parked', findingId: string} */
  readonly item_dispositions: string | null;
  readonly blocked_reason: string | null;
}

export interface MissionReviewStageLaunchRecord {
  readonly mission_id: string;
  readonly stage_key: string;
  readonly position: number;
  readonly fingerprint: string;
}

export interface MissionReviewFindingRecord {
  readonly mission_id: string;
  readonly round_position: number;
  readonly position: number;
  readonly finding_id: string;
  readonly summary: string;
  readonly location: string | null;
}

export interface MissionReviewResolutionRecord {
  readonly mission_id: string;
  readonly round_position: number;
  readonly position: number;
  readonly finding_id: string;
  readonly kind: string;
  readonly explanation: string;
}

export interface MissionExternalTaskRefRecord {
  readonly mission_id: string;
  readonly source: string;
  readonly external_id: string;
  readonly url: string | null;
}

export interface MissionReviewEventRecord {
  readonly mission_id: string;
  readonly position: number;
  readonly event_type: string;
  readonly round_number: number | null;
  readonly phase: string | null;
  readonly actor: string | null;
  readonly content: string;
  readonly disposition: string | null;
  readonly verdict: string | null;
  /** JSON array of {kind: 'fixed'|'pushed_back'|'parked', findingId: string} */
  readonly item_dispositions: string | null;
  readonly blocked_reason: string | null;
  readonly followup_reference: string | null;
  readonly created_at: string;
}

export interface MissionAggregateRecords {
  readonly mission: MissionRecord;
  readonly externalTaskRef?: MissionExternalTaskRefRecord | null;
  readonly labels: readonly MissionLabelRecord[];
  readonly brief: MissionBriefRecord | null;
  readonly briefOutOfScope: readonly MissionBriefOutOfScopeRecord[];
  readonly declaredGates: readonly MissionDeclaredGateRecord[];
  readonly successCriteria?: readonly MissionSuccessCriterionRecord[];
  readonly dependencies?: readonly MissionDependencyRecord[];
  readonly checkpoints: readonly MissionCheckpointRecord[];
  readonly goalChecks: readonly MissionGoalCheckRecord[];
  readonly review: MissionReviewRecord | null;
  readonly reviewRounds: readonly MissionReviewRoundRecord[];
  readonly findings: readonly MissionReviewFindingRecord[];
  readonly resolutions: readonly MissionReviewResolutionRecord[];
  readonly stageLaunches: readonly MissionReviewStageLaunchRecord[];
  readonly reviewEvents: readonly MissionReviewEventRecord[];
}

type MissionReviewRecords = Pick<
  MissionAggregateRecords,
  'review' | 'reviewRounds' | 'findings' | 'resolutions' | 'stageLaunches' | 'reviewEvents'
>;

export interface HydratedMission {
  readonly mission: Mission;
  readonly version: MissionVersion;
}

/** The withdrawal recorded on an approval, with its typed cause when one was recorded. */
function approvalRevocation(row: MissionReviewRoundRecord) {
  if (!row.revoked_at) { return {}; }
  const cause = revocationCause(row);
  return { revocation: {
    revokedAt: requiredText(row.revoked_at, 'revocation time'),
    revokedBy: requiredText(row.revoked_by ?? '', 'revoker'),
    reason: requiredText(row.revoked_reason ?? '', 'revocation reason'),
    ...(cause ? { cause } : {}),
  } };
}

function revocationCause(row: MissionReviewRoundRecord): ReviewRevocationCause | null {
  const kind = row.revoked_cause ?? null;
  switch (kind) {
    case null: return null;
    case 'integration-gate-failure':
      return { kind, gate: row.revoked_gate ?? null, command: row.revoked_gate_command ?? null, log: row.revoked_gate_log ?? null };
    case 'operator': case 'review-repair': case 'rebase-repair': return { kind };
    default: throw new Error(`Persisted revocation cause is invalid: ${kind}`);
  }
}

/** The recorded branch move against an approval, when one was recorded (TASK-2555). */
function approvalSupersession(row: MissionReviewRoundRecord) {
  if (!row.superseded_at) { return {}; }
  return { supersession: {
    supersededAt: requiredText(row.superseded_at, 'supersession time'),
    supersedingRevision: changeRevision(requiredText(row.superseding_revision ?? '', 'superseding revision')),
    recordedBy: requiredText(row.superseded_by ?? '', 'superseding operation'),
  } };
}

function requiredText(value: string, field: string): string {
  if (!value.trim()) {
    throw new Error(`Persisted Mission ${field} must not be empty`);
  }
  return value;
}

function requiredInteger(value: number, field: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`Persisted Mission ${field} is invalid: ${value}`);
  }
  return value;
}

function status(value: string): MissionStatus {
  const parsed = parseMissionStatus(value);
  if (!parsed) {
    throw new Error(`Persisted Mission status is invalid: ${JSON.stringify(value)}`);
  }
  return parsed;
}

function checkpointsFrom(records: MissionAggregateRecords): readonly CheckpointData[] {
  return records.checkpoints.map((checkpoint) => {
    requiredInteger(checkpoint.position, 'checkpoint position');
    if (checkpoint.checkpoint_mission_id !== records.mission.id) {
      throw new Error('Persisted checkpoint belongs to another Mission');
    }
    if (!isCheckpointName(checkpoint.name)) {
      throw new Error(`Persisted checkpoint name is invalid: ${checkpoint.name}`);
    }
    const goalCheck: GoalCheckRow[] = records.goalChecks
      .filter((row) => row.checkpoint_position === checkpoint.position)
      .map((row) => ({
        criterion: requiredText(row.criterion, 'goal criterion'),
        evidence: requiredText(row.evidence, 'goal evidence'),
      }));
    return {
      missionId: missionId(checkpoint.checkpoint_mission_id),
      name: checkpoint.name,
      rawFilename: checkpoint.raw_filename ?? undefined,
      firstLine: checkpoint.first_line ?? undefined,
      goalCheck,
      nextActionText: checkpoint.next_action_text,
    };
  });
}

function briefFrom(records: MissionAggregateRecords): MissionBrief | null {
  const brief = records.brief;
  if (!brief) {return null;}
  return missionBrief({
    goal: brief.goal,
    why: brief.why_text,
    scope: brief.scope_text,
    outOfScope: records.briefOutOfScope.map(({ entry }) => entry),
  });
}

function declaredGatesFrom(records: MissionAggregateRecords): readonly string[] {
  return declaredGates(records.declaredGates.map(({ command }) => command));
}

function predictedNelBucketFrom(value: string | null | undefined): NelBucketLabel | null {
  if (value === null || value === undefined) { return null; }
  if (value !== 'Small' && value !== 'Medium' && value !== 'Large') {
    throw new Error(`Persisted predicted NEL bucket is invalid: ${value}`);
  }
  return value;
}

function findingsFor(
  records: MissionReviewRecords,
  roundPosition: number,
): readonly ReviewFinding[] {
  return records.findings
    .filter((finding) => finding.round_position === roundPosition)
    .map((finding) => ({
      id: reviewFindingId(finding.finding_id),
      summary: requiredText(finding.summary, 'review finding summary'),
      location: finding.location,
    }));
}

function decisionFor(
  row: MissionReviewRoundRecord,
  records: MissionReviewRecords,
): ReviewerDecision | null {
  if (row.decision_kind === null) {
    return null;
  }
  const decidedAt = requiredText(row.decided_at ?? '', 'review decision time');
  if (row.decision_kind === 'changes-requested') {
    const findings = findingsFor(records, row.position);
    if (findings.length === 0) {
      // Older flattened review state recorded this verdict without its finding
      // payload. It cannot form a valid domain decision, but must not make the
      // whole board unreadable.
      return null;
    }
    return {
      kind: 'changes-requested',
      decidedAt,
      comment: row.decision_comment,
      findings,
    };
  }
  if (row.decision_kind !== 'approved') {
    throw new Error(`Persisted reviewer decision is invalid: ${row.decision_kind}`);
  }
  if (row.approval_source_kind === 'local') {
    return {
      kind: 'approved',
      decidedAt,
      comment: row.decision_comment,
      source: { kind: 'local' },
      ...approvalRevocation(row),
      ...approvalSupersession(row),
    };
  }
  if (row.approval_source_kind === 'provider') {
    return {
      kind: 'approved',
      decidedAt,
      comment: row.decision_comment,
      source: {
        kind: 'provider',
        provider: requiredText(row.approval_source_provider ?? '', 'approval provider'),
      },
      ...approvalRevocation(row),
      ...approvalSupersession(row),
    };
  }
  throw new Error(`Persisted approval source is invalid: ${row.approval_source_kind}`);
}

function resolutionsFor(
  records: MissionReviewRecords,
  roundPosition: number,
): readonly FindingResolution[] {
  return records.resolutions
    .filter((resolution) => resolution.round_position === roundPosition)
    .map((resolution) => {
      const findingId = reviewFindingId(resolution.finding_id);
      const explanation = requiredText(resolution.explanation, 'finding resolution');
      if (resolution.kind === 'fixed') {
        return { findingId, kind: 'fixed', evidence: explanation };
      }
      if (resolution.kind === 'disputed') {
        return { findingId, kind: 'disputed', rationale: explanation };
      }
      throw new Error(`Persisted finding resolution is invalid: ${resolution.kind}`);
    });
}

function reviewRoundFrom(
  row: MissionReviewRoundRecord,
  records: MissionReviewRecords,
): ReviewRound {
  const change = row.change_kind === 'pull-request'
    ? {
      kind: 'pull-request' as const,
      provider: requiredText(row.provider ?? '', 'review provider'),
      id: requiredText(row.provider_change_id ?? '', 'review provider id'),
      url: row.provider_url,
      sourceBranch: requiredText(row.source_branch, 'review source branch'),
      targetBranch: requiredText(row.target_branch, 'review target branch'),
    }
    : row.change_kind === 'local-branch'
      ? {
        kind: 'local-branch' as const,
        sourceBranch: requiredText(row.source_branch, 'review source branch'),
        targetBranch: requiredText(row.target_branch, 'review target branch'),
      }
      : (() => { throw new Error(`Persisted reviewed change is invalid: ${row.change_kind}`); })();

  const response = row.responded_at === null
    ? null
    : {
      kind: 'resolved' as const,
      respondedAt: requiredText(row.responded_at, 'review response time'),
      resolutions: resolutionsFor(records, row.position),
      resultingRevision: changeRevision(
        requiredText(row.resulting_revision ?? '', 'resulting revision'),
      ),
    };

  // The optional implementer-response fields are omitted rather than set to
  // `undefined`, so a round that never carried them reloads value-identical to
  // the one that was saved.
  const itemDispositions = parseItemDispositions(row.item_dispositions);

  return {
    number: requiredInteger(row.round_number, 'review round number', 1),
    subject: { change, revision: changeRevision(row.revision) },
    reviewer: agentFamily(row.reviewer),
    implementer: agentFamily(row.implementer),
    startedAt: requiredText(row.started_at, 'review start time'),
    decision: decisionFor(row, records),
    response,
    phase: reviewPhaseFrom(row.phase),
    disposition: reviewDispositionFrom(row.disposition),
    reviewerRetryCount: requiredInteger(row.reviewer_retry_count, 'reviewer retry count', 0),
    implementerRetryCount: requiredInteger(
      row.implementer_retry_count, 'implementer retry count', 0,
    ),
    ...(row.implementer_response_content === null
      ? {}
      : { implementerResponseContent: row.implementer_response_content }),
    ...(itemDispositions === null ? {} : { itemDispositions }),
    ...(row.blocked_reason === null ? {} : { blockedReason: row.blocked_reason }),
  };
}

/**
 * Parse the item_dispositions JSON column into a typed array.
 *
 * Accepts both the new format [{kind, findingId}] and the legacy format
 * where fixedItems, pushedBackItems, parkedItems were separate arrays of
 * findingId strings. Returns null on empty or malformed input.
 */
function parseItemDispositions(value: string | null): ReviewItemDisposition[] | null {
  if (!value || !value.trim()) { return null; }
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) { return null; }
    const dispositions: ReviewItemDisposition[] = [];
    for (const item of parsed) {
      if (typeof item === 'object' && item !== null && 'kind' in item && 'findingId' in item) {
        const kind = item.kind as string;
        if (kind === 'fixed' || kind === 'pushed_back' || kind === 'parked') {
          dispositions.push({ kind, findingId: reviewFindingId(String(item.findingId)) });
        }
      }
    }
    return dispositions.length > 0 ? dispositions : null;
  } catch {
    return null;
  }
}

/** Parse review events from the records. */
function reviewEventsFrom(records: MissionReviewRecords): readonly ReviewEventRecord[] {
  return records.reviewEvents.map((row) => ({
    position: requiredInteger(row.position, 'review event position'),
    eventType: requiredText(row.event_type, 'review event type') as ReviewEventType,
    roundNumber: row.round_number,
    phase: row.phase,
    actor: row.actor,
    content: row.content ?? '',
    disposition: row.disposition,
    verdict: row.verdict,
    itemDispositions: parseItemDispositions(row.item_dispositions),
    blockedReason: row.blocked_reason,
    followUpReference: row.followup_reference,
    createdAt: requiredText(row.created_at, 'review event created_at'),
  }));
}

function reviewPhaseFrom(value: string): ReviewPhase {
  if (!(REVIEW_PHASES as readonly string[]).includes(value)) {
    throw new Error(`Persisted review phase is invalid: ${value}`);
  }
  return value as ReviewPhase;
}

function reviewDispositionFrom(value: string | null): ReviewDisposition | null {
  if (value === null) { return null; }
  if (!(REVIEW_DISPOSITIONS as readonly string[]).includes(value)) {
    throw new Error(`Persisted review disposition is invalid: ${value}`);
  }
  return value as ReviewDisposition;
}

/** Rebuild the stage-launch windows, preserving per-window insertion order. */
function stageLaunchesFrom(records: MissionReviewRecords): readonly StageLaunchWindow[] {
  const windows = new Map<string, string[]>();
  for (const row of [...records.stageLaunches].sort((a, b) => a.position - b.position)) {
    const fingerprints = windows.get(row.stage_key) ?? [];
    fingerprints.push(requiredText(row.fingerprint, 'stage launch fingerprint'));
    windows.set(row.stage_key, fingerprints);
  }
  return [...windows.entries()].map(([stageKey, fingerprints]) => ({ stageKey, fingerprints }));
}

function reviewFrom(records: MissionReviewRecords): Review | null {
  if (!records.review) {
    if (records.reviewRounds.length > 0) {
      throw new Error('Persisted review rounds exist without a Mission review');
    }
    return null;
  }
  const rounds = records.reviewRounds.map((round) => reviewRoundFrom(round, records));
  if (rounds.length === 0) {
    throw new Error('Persisted Mission review has no rounds');
  }
  const reviewRow = records.review;
  const intervention = reviewRow.intervention_requested_at === null
    ? null
    : {
      requestedAt: requiredText(reviewRow.intervention_requested_at, 'intervention time'),
      requestedBy: reviewRow.intervention_requested_by as 'reviewer' | 'implementer' | 'workflow',
      reason: requiredText(reviewRow.intervention_reason ?? '', 'intervention reason'),
    };
  if (intervention && !['reviewer', 'implementer', 'workflow'].includes(intervention.requestedBy)) {
    throw new Error(`Persisted review intervention actor is invalid: ${intervention.requestedBy}`);
  }
  return {
    rounds: rounds as [ReviewRound, ...ReviewRound[]],
    intervention,
    stageLaunches: stageLaunchesFrom(records),
    reviewEvents: reviewEventsFrom(records),
  };
}

/** Hydrate the board's review read model from the four relations it consumes. */
export function hydrateReviewProjection(records: Pick<
  MissionAggregateRecords,
  'reviewRounds' | 'findings' | 'resolutions' | 'reviewEvents'
>): Review | null {
  if (records.reviewRounds.length === 0) { return null; }
  return reviewFrom({
    ...records,
    review: {
      mission_id: records.reviewRounds[0].mission_id,
      intervention_requested_at: null,
      intervention_requested_by: null,
      intervention_reason: null,
    },
    stageLaunches: [],
  });
}

/**
 * Rebuild the intake trace, if one was recorded.
 *
 * The key stays absent when no row exists so a Mission that was never given an
 * external reference is indistinguishable from one persisted before this column
 * existed — the reference is traceability, not a required aggregate part.
 */
function externalTaskRefFrom(
  records: MissionAggregateRecords,
): { externalTaskRef?: ExternalTaskRef } {
  const row = records.externalTaskRef;
  if (!row) {
    return {};
  }
  if (row.mission_id !== records.mission.id) {
    throw new Error('Persisted external task reference belongs to another Mission');
  }
  return { externalTaskRef: externalTaskRef(row.source, row.external_id, row.url) };
}

/** Reconstruct and validate domain values from the normalized relational rows. */
export function hydrateMission(records: MissionAggregateRecords): HydratedMission {
  const row = records.mission;
  const missionStatus = status(row.status);
  const closedAt = row.closed_at;
  if (closedAt !== null && missionStatus !== 'done') {
    throw new Error('Persisted Mission status/closedAt invariant is invalid');
  }
  if (row.net_engineering_lines !== null) {
    requiredInteger(row.net_engineering_lines, 'net engineering lines');
  }
  const common = {
    id: missionId(row.id),
    repositoryId: repositoryId(row.repository_id),
    title: requiredText(row.title, 'title'),
    labels: missionLabels(records.labels.map(({ label }) => label)),
    assignee: row.assignee === null ? null : agentFamily(row.assignee),
    checkpoints: checkpointsFrom(records),
    brief: briefFrom(records),
    declaredGates: declaredGatesFrom(records),
    successCriteria: successCriteria((records.successCriteria ?? []).map(({ criterion }) => criterion)),
    dependencies: missionDependencies(
      (records.dependencies ?? []).map(({ depends_on_mission_id }) => depends_on_mission_id),
      missionId(records.mission.id),
    ),
    predictedNelBucket: predictedNelBucketFrom(row.predicted_nel_bucket),
    reproductionTest: row.reproduction_test ?? null,
    review: reviewFrom(records),
    netEngineeringLines: row.net_engineering_lines,
    rawStatus: row.raw_status ?? undefined,
    ...externalTaskRefFrom(records),
  };
  const mission: Mission = closedAt === null
    ? { ...common, status: missionStatus, closedAt: null }
    : { ...common, status: 'done', closedAt };
  return { mission, version: missionVersion(row.version) };
}
