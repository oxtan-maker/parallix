import { preserveHistoricalRestoration } from '../../domain/integration-repair-record.js';
import { integrationRepairCertified } from './repair-certification.js';
import { missionId } from '../../domain/mission.js';
import { pendingIntegrationApproval } from '../../domain/integration-repair-policy.js';
import { currentReviewRound, replaceCurrentRound, revokeApprovedDecision, type ReviewRound } from '../../domain/review.js';
import { retentionEvidenceMatches, type IntegrationRepairAssessment, type RetentionBlockReason } from '../../domain/integration-approval-retention.js';
import type { IntegrationApprovalEvidencePort } from '../ports/integration-approval-evidence.js';
import type { IntegrationMissionServices } from '../ports/integration-records.js';
import type { MissionLoadResult } from '../domain-ports.js';

export type RetentionOutcome = 'retained' | 'changed' | 'blocked' | 'not-pending';
interface RetentionRequest {
  slug: string; services: IntegrationMissionServices; evidence: IntegrationApprovalEvidencePort;
  candidate: { revision: string; baseline: string }; worktree?: string; head(): string | null;
}

/** One revision-pinned assessment for both immediate repair and interrupted work. */
export async function retainIntegrationApproval(input: RetentionRequest): Promise<RetentionOutcome> {
  const loaded = await input.services.store.load(missionId(input.slug));
  if (loaded.kind !== 'found') { return 'blocked'; }
  const round = pendingIntegrationApproval(loaded.mission);
  if (!round || !loaded.mission.review) { return 'not-pending'; }
  if (!round.decision?.revision) { return 'blocked'; }
  const assessment = await assessCandidate(input, round);
  if (assessment.outcome === 'retained' && !integrationRepairCertified(loaded.mission, input.worktree)) { return 'blocked'; }
  if (assessment.outcome === 'retained' && !await input.evidence.reconcileHumanFeedback(loaded.mission, input.services.store).catch(() => false)) { return 'blocked'; }
  // Both repository and aggregate must still describe the facts we just read.
  const latest = await input.services.store.load(loaded.mission.id);
  if (latest.kind !== 'found' || latest.version !== loaded.version || input.head() !== input.candidate.revision) { return 'blocked'; }
  return commitAssessment(input, loaded, round, assessment);
}

async function samePatch(input: RetentionRequest, round: ReviewRound): Promise<boolean | null> {
  if (round.decision?.kind === 'approved' && round.decision.supersession) { return false; }
  if (!round.subject.baseline || !input.candidate.baseline) { return null; }
  return input.evidence.samePatch({ revision: String(round.decision!.revision), baseline: String(round.subject.baseline) }, input.candidate).catch(() => null);
}

async function assessCandidate(input: RetentionRequest, round: ReviewRound): Promise<IntegrationRepairAssessment> {
  const patchEqual = await samePatch(input, round);
  const validation = await input.evidence.validation(input.slug).catch(() => null);
  const base = { assessedAt: input.evidence.now(), approvedRevision: String(round.decision!.revision),
    candidateRevision: input.candidate.revision, failedGate: round.integrationRepairAssessment!.repair!.cause.gate,
    repair: round.integrationRepairAssessment!.repair!, ...preserveHistoricalRestoration(round.integrationRepairAssessment) };
  // Gates prove the committed tree, not an equivalent patch on a different base.
  const green = retentionEvidenceMatches({ ...base, ...(validation ? { validation } : {}) }, input.slug, input.candidate.baseline);
  const fallback: RetentionBlockReason = patchEqual === null ? 'comparison-error'
    : !patchEqual ? 'mission-change-differs' : validation?.failed ? 'gate-failed' : 'gate-evidence-missing';
  return { ...base, outcome: patchEqual === true && green ? 'retained' : fallback, ...(green && validation ? { validation } : {}) };
}

async function commitAssessment(input: RetentionRequest, loaded: Extract<MissionLoadResult, { kind: 'found' }>,
  round: ReviewRound, assessment: IntegrationRepairAssessment): Promise<RetentionOutcome> {
  const original = loaded.mission.review!;
  const review = { ...original, rounds: replaceCurrentRound(original, { ...round, integrationRepairAssessment: assessment }) };
  const changed = assessment.outcome === 'mission-change-differs';
  if (!changed && assessment.outcome !== 'retained') {
    await input.services.store.save({ ...loaded.mission, review }, loaded.version);
    return 'blocked';
  }
  // A changed mission makes the earlier judgment stale even if gates still fail.
  const proposed = changed ? revokeApprovedDecision(review, currentReviewRound(review).number, {
    revokedAt: assessment.assessedAt, revokedBy: 'workflow', reason: 'Integration repair changed the approved mission patch.', cause: assessment.repair!.cause,
  }) : review;
  const result = await input.services.lifecycle.transition({
    operationId: `integration-retention:${input.slug}:${loaded.version}`,
    missionId: loaded.mission.id, expectedVersion: loaded.version, capabilities: new Set(['mission:transition']),
    command: { type: changed ? 'revoke-approval' : 'approve', review: proposed }, actor: 'parallix', occurredAt: assessment.assessedAt,
    idempotencyKey: `integration-retention:${input.slug}:${loaded.version}`,
  });
  return result.status === 'completed' ? changed ? 'changed' : 'retained' : 'blocked';
}

/** A later human request must also block the final integrate invocation. */
export async function retainedApprovalFeedbackAllowsLanding(slug: string, services: IntegrationMissionServices,
  evidenceFor: () => IntegrationApprovalEvidencePort | undefined): Promise<boolean> {
  const loaded = await services.store.load(missionId(slug));
  if (loaded.kind !== 'found') { return false; }
  if (loaded.mission.review?.rounds.at(-1)?.integrationRepairAssessment?.outcome !== 'retained') { return true; }
  const evidence = evidenceFor();
  if (!evidence) { return false; }
  return evidence.reconcileHumanFeedback(loaded.mission, services.store).catch(() => false);
}
