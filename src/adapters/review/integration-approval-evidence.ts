import type { ParallixConfiguration } from '../../application/ports/configuration.js';
import type { IntegrationApprovalEvidencePort } from '../../application/ports/integration-approval-evidence.js';
import { GitMissionPatchComparison } from './mission-patch-comparison.js';
import { composeHumanFeedback } from './review-loop-human-feedback.js';
import { getComments, isProviderEnabled, readToken } from './review-adapter.js';
import { createEvent } from './review-events.js';
import { ReviewState } from './review-state.js';
import { reviewStateDataFrom } from './review-state-mapping.js';
import { missionBranchName } from '../filesystem/mission-utils.js';
import { completedRebaseLineageForCheckout } from '../git/rebase-completion-recorder.js';
import * as fmt from '../../application/presentation/cli-format.js';

interface FeedbackMechanisms {
  providerEnabled: typeof isProviderEnabled; fetchComments: typeof getComments; tokenFor: typeof readToken;
}

/** Retention reads the same provider corrections as review, without consuming them. */
export function createIntegrationApprovalEvidence(worktree: string, validation: IntegrationApprovalEvidencePort['validation'], configuration?: ParallixConfiguration,
  mechanisms: FeedbackMechanisms = { providerEnabled: isProviderEnabled, fetchComments: getComments, tokenFor: readToken }): IntegrationApprovalEvidencePort {
  const comparison = new GitMissionPatchComparison(worktree);
  return {
    samePatch: (a, b) => comparison.samePatch(a, b), now: () => new Date().toISOString(),
    validation,
    completedRebaseLineage: (from, to) => completedRebaseLineageForCheckout(worktree, from, to),
    async reconcileHumanFeedback(mission, store) {
      const round = mission.review?.rounds.at(-1);
      const decision = round?.decision;
      if (decision?.kind !== 'approved' || !decision.revision || !mission.review) { return false; }
      // Only historical restored decisions differ from their original provider judgment.
      const judgedRevision = decision.source.kind === 'mechanical-restoration' ? decision.source.approvedRevision : String(decision.revision);
      const providerEnabled = mechanisms.providerEnabled(worktree);
      let approvalValid = !providerEnabled;
      const feedback = composeHumanFeedback({ slug: String(mission.id), branch: missionBranchName(String(mission.id), worktree),
        worktree, providerEnabled, missionStore: store, strict: true, readOnly: true,
        log: fmt.log.plain, error: fmt.log.plainError, recordHumanNote: createEvent,
        fetchComments: async (branch, token, options) => {
          const comments = await mechanisms.fetchComments(branch, token, { ...options, configuration });
          approvalValid = Array.isArray(comments) && providerApprovalStillStanding(comments, judgedRevision);
          return comments;
        },
        tokenFor: (user, options) => mechanisms.tokenFor(user, { ...options, configuration }) });
      const correction = await feedback.reconcile(new ReviewState(String(mission.id), reviewStateDataFrom(mission.review)));
      return approvalValid && correction === null;
    },
  };
}

interface ProviderReview {
  readonly kind?: string; readonly commitId?: string; readonly state?: string; readonly dismissed?: boolean; readonly created?: string;
}

/** Dismissal invalidates the provider approval even when its original author is an agent. */
function providerApprovalStillStanding(comments: readonly ProviderReview[], revision: string): boolean {
  // Ignore withdrawn change requests; keep dismissed approvals in the decision history.
  const formal = comments.filter(item => item.kind === 'review'
    && ['APPROVED', 'REQUEST_CHANGES', 'DISMISSED'].includes(item.state ?? '')
    && !(item.state === 'REQUEST_CHANGES' && item.dismissed));
  // Legacy records without revision identity cannot replace the judged approval.
  const matching = formal.filter(item => item.commitId === revision);
  if (matching.some(item => !Number.isFinite(Date.parse(item.created ?? '')))) { return false; }
  const latest = matching.sort((left, right) => Date.parse(left.created!) - Date.parse(right.created!)).at(-1);
  return latest?.state === 'APPROVED' && !latest.dismissed;
}
