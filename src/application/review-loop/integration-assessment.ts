import { StructuredFailure, failureReason } from '../../domain/failure-reason.js';
import { continuePendingIntegrationRepair } from '../integrate/repair-resumption.js';
import type { ReviewLoopPorts } from '../ports/review-round.js';

/** Pending repair is assessed before generic repair or an approved loop projection may be replayed. */
export async function resumeIntegrationAssessment(start: { slug: string; dryRun: boolean }, ports: ReviewLoopPorts): Promise<boolean> {
  if (!ports.missionStore) { return false; }
  const next = await continuePendingIntegrationRepair(start.slug, ports.missionStore, ports.integrationRepair, start.dryRun ? 'preview' : 'resume');
  if (next.kind === 'not-pending') { return false; }
  if (next.kind === 'preview') {
    ports.output.log(`Pending integration repair for ${start.slug}: certification and approval retention run before any generic repair; dry run certified nothing.`);
    return true;
  }
  if (next.kind === 'unavailable') {
    throw new StructuredFailure('Integration repair certification is unavailable; resume px integrate.', failureReason('approval-retention-pending', 'lifecycle'));
  }
  if (next.kind === 'review-required') {
    // The shared retention owner revoked the old judgment and opened an undecided round.
    // Provider observations remain revision-pinned; a withdrawal with no decided revision has no
    // provider record to dismiss, so fresh review is still required without inventing one.
    if (next.withdrawnRevision === null) {
      ports.output.log(`Integration repair for ${start.slug} withdrew an approval with no recorded revision; no provider dismissal is possible and fresh review is still required.`);
    } else {
      await ports.provider?.dismissApproval(next.withdrawnRevision, 'Integration repair changed the approved mission patch; fresh review is required.');
    }
    return false;
  }
  if (next.kind === 'retained') {
    ports.output.log(`Original approval retained for ${start.slug}; human px integrate is required to land.`);
    return true;
  }
  if (next.kind === 'landed') {
    ports.output.log(`Integration repair for ${start.slug} already landed; no review, launch or px integrate is owed.`);
    return true;
  }
  ports.output.error('Integration repair assessment is unproven or the decision changed; retry px review or resume verification with px integrate.');
  ports.output.exit(1);
  return true;
}
