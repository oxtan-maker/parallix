import { missionId, type Mission } from '../../domain/mission.js';
import { applyReviewerCommand, changeRevision, decidedRevisionOf, currentReviewRound, replaceCurrentRound } from '../../domain/review.js';
import { restorationEligibility, type IntegrationRepairAssessment } from '../../domain/integration-approval-restoration.js';
import type { MissionVersion } from '../domain-ports.js';
import type { IntegrationApprovalRestorationPort } from '../ports/integration-approval-restoration.js';
import type { LoopContext, ReviewRound } from './round.js';

function repairCandidate(mission: Mission, context: LoopContext, round: ReviewRound) {
  if (!mission.review || mission.status !== 'review' || !round.verifiedRevision) { return null; }
  const review = mission.review, current = currentReviewRound(review), prior = review.rounds.at(-2);
  const revoked = prior?.decision?.kind === 'approved' ? prior.decision.revocation : null;
  if (!prior || !decidedRevisionOf(prior) || current.decision || current.number !== context.state.round || revoked?.cause?.kind !== 'integration-gate-failure') { return null; }
  return { review, current, prior, revoked, failedGate: revoked.cause.gate,
    candidate: { revision: round.verifiedRevision, baseline: String(current.subject.baseline ?? '') } };
}
type Candidate = NonNullable<ReturnType<typeof repairCandidate>>;

async function assessCandidate(port: IntegrationApprovalRestorationPort, slug: string, facts: Candidate): Promise<IntegrationRepairAssessment> {
  const { prior, candidate, revoked, failedGate } = facts;
  const patchEqual = prior.subject.baseline && candidate.baseline
    ? await port.samePatch({ revision: String(prior.decision!.revision), baseline: String(prior.subject.baseline) }, candidate).catch(() => null) : null;
  const validation = await port.validation(slug).catch(() => null);
  let validationEqual: boolean | null = null;
  if (validation) {
    validationEqual = validation.sha === candidate.revision ? true : validation.baseline && candidate.baseline
      ? await port.samePatch({ revision: validation.sha, baseline: validation.baseline }, candidate).catch(() => null) : null;
  }
  return restorationEligibility({ missionId: slug, approvedRevision: String(prior.decision!.revision), candidateRevision: candidate.revision,
    failedGate, withdrawnAt: revoked.revokedAt, decidedAt: port.now(), patchEqual, validation, validationEqual });
}

/** Only the immediately withdrawn approval can be restored, never one bypassed by human review. */
export async function tryRestoreIntegrationApproval(context: LoopContext, round: ReviewRound): Promise<'APPROVED' | 'stop' | null> {
  const { missionStore: store, restoration: port, lifecycle } = context.ports;
  if (!store || !port || !lifecycle || round.humanFeedback) { return null; }
  try {
    const loaded = await store.load(missionId(context.slug));
    if (loaded.kind !== 'found') { return null; }
    const facts = repairCandidate(loaded.mission, context, round);
    if (!facts) { return null; }
    const assessment = await assessCandidate(port, context.slug, facts);
    // Awaited reads may race a human decision or branch move. Never overwrite either.
    const latest = await store.load(loaded.mission.id);
    if (latest.kind !== 'found' || latest.version !== loaded.version || context.ports.preReview.head() !== facts.candidate.revision) { return null; }
    const assessed = { ...facts.current, integrationRepairAssessment: assessment };
    const review = { ...facts.review, rounds: replaceCurrentRound(facts.review, assessed) };
    const version = await store.save({ ...loaded.mission, review }, loaded.version);
    if (assessment.outcome !== 'restored') {
      context.ports.output.log(`Integration repair: normal review (${assessment.outcome}).`);
      return null;
    }
    return await commitRestoration(context, review, assessment, version);
  } catch { return null; } // Unavailable evidence/store cannot authorize restoration.
}

async function commitRestoration(context: LoopContext, review: Candidate['review'], assessment: IntegrationRepairAssessment,
  version: MissionVersion): Promise<'APPROVED' | 'stop' | null> {
  const source = assessment.source;
  if (!source || context.ports.preReview.head() !== source.candidateRevision) { return null; }
  try {
    const approved = applyReviewerCommand(review, { type: 'approve', revision: changeRevision(source.candidateRevision), decidedAt: assessment.assessedAt,
      comment: `Prior approval restored mechanically; failed gate ${source.failedGate}; ${source.validationReference}.`, source });
    const transition = await context.ports.lifecycle!.transition({ operationId: `restore:${context.slug}:${currentReviewRound(review).number}`,
      missionId: missionId(context.slug), expectedVersion: version, capabilities: new Set(['mission:transition']),
      command: { type: 'approve', review: approved }, actor: 'parallix', occurredAt: assessment.assessedAt });
    if (transition.status !== 'completed') { throw new Error(transition.error?.message ?? transition.status); }
  } catch (error) {
    context.ports.output.error(`Mechanical restoration transition failed: ${String(error)}`);
    await context.escalateToHumanReview('MECHANICAL_RESTORE_PERSIST_FAILURE');
    return 'stop';
  }
  context.ports.output.log(`Integration repair: prior approval restored mechanically (${source.validationReference}); waiting for human px integrate.`);
  return 'APPROVED';
}
