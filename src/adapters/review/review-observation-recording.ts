import { readReviewForDecision } from './review-round-read.js';
import { currentReviewRound } from '../../domain/review.js';
import type { ReviewStatePort, ReviewLoopState } from '../../application/ports/review-round.js';
import type { ReviewRoundPorts, ReviewRoundResult } from './review-round.js';
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
      if (providerEnabled && !observation) {
        const loaded = await readReviewForDecision(slug, ports.missionStore!, undefined, 'approve', observedRound(state));
        if (loaded.kind === 'failed') { throw new Error(loaded.result.outcome === 'failed' ? loaded.result.diagnostic : 'Cannot read the approval'); }
        const decision = currentReviewRound(loaded.mission.review).decision;
        if (decision?.kind !== 'approved') { throw new Error('Provider approval requires the observed revision and submission time'); }
        observation = { disposition: 'APPROVED', revision: decision.revision ?? null, decidedAt: decision.decidedAt, comment: decision.comment };
      }
      const judgment = observation ?? { comment: null, decidedAt: new Date().toISOString(), revision: head() };
      // A polled approval is the running reviewer's own verdict: it is attributed, so a policy that still owes
      // another approval holds it instead of deciding the round.
      await requireRecorded(() => recordApproval(slug, {
        ...judgment, observedRound: observedRound(state),
        result: reviewerResultAttribution(state.reviewer ?? 'reviewer', null),
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

async function requireRecorded(write: () => Promise<ReviewRoundResult>): Promise<void> {
  let result = await write();
  if (result.outcome === 'failed' && result.kind === 'stale-write') { result = await write(); }
  if (result.outcome === 'failed') { throw new Error(result.diagnostic); }
  if (result.outcome === 'unchanged' && result.noRevisionChange) { throw new Error(result.reason); }
}
