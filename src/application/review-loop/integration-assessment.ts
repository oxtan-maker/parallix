import { StructuredFailure, failureReason } from '../../domain/failure-reason.js';
import { effectiveRepairObligations } from '../../domain/repair-coverage.js';
import { missionId } from '../../domain/mission.js';
import { pendingIntegrationApproval } from '../../domain/integration-repair-policy.js';
import { retainIntegrationApproval } from '../integrate/approval-retention.js';
import type { ReviewLoopPorts } from '../ports/review-round.js';

/** Pending repair is assessed before an approved loop projection may be replayed. */
export async function resumeIntegrationAssessment(start: { slug: string; dryRun: boolean }, ports: ReviewLoopPorts): Promise<boolean> {
  if (!ports.missionStore || start.dryRun) { return false; }
  const loaded = await ports.missionStore.load(missionId(start.slug));
  const pending = loaded.kind === 'found' && pendingIntegrationApproval(loaded.mission);
  if (!pending) { return false; }
  if (!ports.integrationRepair && needsCertification(loaded, ports.worktree)) {
    throw new StructuredFailure('Integration repair certification is unavailable; resume px integrate.', failureReason('approval-retention-pending', 'lifecycle'));
  }
  const revision = ports.preReview.head();
  const baseline = ports.preReview.reviewBaseline();
  if (!revision || !baseline || !ports.lifecycle || !ports.integrationApprovalEvidence) {
    ports.output.error('Integration repair assessment requires committed revision, baseline and approval evidence; retry px review.');
    ports.output.exit(1);
    return true;
  }
  const outcome = ports.integrationRepair ? await ports.integrationRepair.resume(start.slug) : await retainIntegrationApproval({ slug: start.slug,
    services: { store: ports.missionStore, lifecycle: ports.lifecycle }, evidence: ports.integrationApprovalEvidence,
    candidate: { revision, baseline }, worktree: ports.worktree, head: () => ports.preReview.head() });
  if (outcome === 'changed') {
    // The shared retention owner revoked the old judgment and opened an undecided round.
    // Provider observations remain revision-pinned even if this dismissal is interrupted.
    await ports.provider?.dismissApproval(String(pending.decision!.revision), 'Integration repair changed the approved mission patch; fresh review is required.');
    return false;
  }
  if (outcome === 'retained') {
    ports.output.log(`Original approval retained for ${start.slug}; human px integrate is required to land.`);
    return true;
  }
  ports.output.error('Integration repair assessment is unproven or the decision changed; retry px review or resume verification with px integrate.');
  ports.output.exit(1);
  return true;
}

function needsCertification(loaded: import('../domain-ports.js').MissionLoadResult, worktree: string): boolean {
  return loaded.kind === 'found' && effectiveRepairObligations(loaded.mission.checkpoints,
    loaded.mission.declaredGates, loaded.mission.successCriteria, worktree).length > 0;
}
