import { readReviewForDecision } from './review-round-read.js';
import { currentReviewRound, currentRevisionApprovals } from '../../domain/review.js';
import { approvalRequirementMet } from '../../domain/reviewer-policy.js';
import type { ProviderApproval, ReviewStatePort, ReviewLoopState } from '../../application/ports/review-round.js';
import type { ReviewRoundPorts, ReviewRoundResult } from './review-round.js';
import type { Review, ReviewerResult, ReviewerResultAttribution } from '../../domain/review.js';
import { reviewerResultAttribution } from './reviewer-result-attribution.js';
import { recordApproval, recordRequestedChanges, recordImplementerResolution } from './review-round.js';

/** Bind observed provider facts to the existing decision/resolution owners. */
export function createReviewObservationRecorder(slug: string, head: () => string | null, providerEnabled: boolean,
  ports: ReviewRoundPorts): Pick<ReviewStatePort, 'recordApproval' | 'recordRequestedChanges' | 'recordResolution'> {
  const observedRound = (state: ReviewLoopState) => ({ number: state.round, startedAt: state.startedAt });
  const requireLifecycle = () => {
    if (!ports.missionStore || !ports.lifecycleService) { throw new Error('Review observation requires the Mission store and lifecycle service'); }
  };
  return {
    async recordApproval(state, observation) {
      requireLifecycle();
      let result = reviewerResultAttribution(state.reviewer ?? 'reviewer', null);
      if (!observation) {
        ({ observation, result } = await recoverApprovalEvidence(slug, state, providerEnabled, ports));
      }
      const judgment = observation ?? { comment: null, decidedAt: new Date().toISOString(), revision: head() };
      // A polled approval is the running reviewer's own verdict: it is attributed, so a policy that still owes
      // another approval holds it instead of deciding the round.
      await requireRecorded(() => recordApproval(slug, {
        ...judgment, observedRound: observedRound(state),
        result,
        source: providerEnabled ? { kind: 'provider', provider: 'forgejo' } : { kind: 'local' },
      }, ports));
    },
    async recordRequestedChanges(state, observation) {
      requireLifecycle();
      await requireRecorded(() => recordRequestedChanges(slug, { ...observation, observedRound: observedRound(state) }, ports));
    },
    async recordResolution(state, observation) {
      const resultingRevision = head();
      if (!resultingRevision) { throw new Error('Cannot record a provider resolution without the resulting revision'); }
      await requireRecorded(() => recordImplementerResolution(slug, {
        ...observation, resultingRevision, observedRound: observedRound(state),
      }, ports));
    },
  };
}

async function recoverApprovalEvidence(slug: string, state: ReviewLoopState, providerEnabled: boolean,
  ports: ReviewRoundPorts): Promise<{ observation?: ProviderApproval; result: ReviewerResultAttribution }> {
  const loaded = await readReviewForDecision(slug, ports.missionStore!, undefined, 'approve', { number: state.round, startedAt: state.startedAt });
  if (loaded.kind === 'failed') { throw new Error(loaded.result.outcome === 'failed' ? loaded.result.diagnostic : 'Cannot read the approval'); }
  const { observation, recorded, governed } = recoveredApproval(loaded.mission.review);
  const result = recorded && observation?.revision === recorded.revision && observation.decidedAt === recorded.publishedAt
    ? recorded : reviewerResultAttribution(state.reviewer ?? 'reviewer', null);
  if ((providerEnabled || governed) && !observation) { throw new Error('Provider approval requires the observed revision and submission time'); }
  return { observation, result };
}

function recoveredApproval(review: Review): { observation?: ProviderApproval; recorded?: ReviewerResult; governed: boolean } {
  const round = currentReviewRound(review);
  const decision = round.decision;
  const revision = round.reviewerPolicy?.revision ?? round.subject.revision;
  const recorded = currentRevisionApprovals(review, revision)
    .find(approval => approval.agentFamily === round.reviewer && (!round.reviewerPolicy || round.reviewerPolicy.selected.includes(approval.agentFamily)));
  let observation: ProviderApproval | undefined;
  if (decision?.kind === 'approved') {
    observation = { disposition: 'APPROVED', revision: decision.revision ?? null, decidedAt: decision.decidedAt, comment: decision.comment };
  } else if (recorded && round.reviewerPolicy && approvalRequirementMet(review, revision)) {
    // A lowered requirement can make a held publication decisive.
    // Reuse its exact revision, time and identity; no new verdict ran.
    observation = { disposition: 'APPROVED', revision: recorded.revision, decidedAt: recorded.publishedAt, comment: null };
  }
  return { observation, recorded, governed: Boolean(round.reviewerPolicy) };
}

async function requireRecorded(write: () => Promise<ReviewRoundResult>): Promise<void> {
  let result = await write();
  if (result.outcome === 'failed' && result.kind === 'stale-write') { result = await write(); }
  if (result.outcome === 'failed') { throw new Error(result.diagnostic); }
  if (result.outcome === 'unchanged' && result.noRevisionChange) { throw new Error(result.reason); }
}
