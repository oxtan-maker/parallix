import { IntegrationStopsForHuman, reviewBeforeIntegration } from './review-before-integration.js';
import { missionId } from '../../domain/mission.js';
import { pendingIntegrationApproval } from '../../domain/integration-repair-policy.js';
import { integrationRepairMustReactivate, integrationRepairRoute, repairedRevisionReviewEligible, repairCanResumeIntegration } from '../../domain/integration-gate-policy.js';
import { integrationRepairNeedsReview } from '../integration-repair-review.js';
import { abortWith, projectBacklogTransition } from './support.js';
import type { IntegrationGateDefinition } from '../ports/integration-records.js';
import type { IntegrateWorkflowPorts, IntegrationGateRoute } from '../ports/integrate-workflow.js';
import type { GateStepRequest, IntegrateSeams } from './gates.js';

interface GateRepairCompletion {
  request: GateStepRequest;
  ports: Pick<IntegrateWorkflowPorts, 'landing'>;
  configured: IntegrationGateDefinition[];
  checkout: string;
  route: IntegrationGateRoute;
  reactivateMission: (slug: string) => Promise<unknown>;
}

async function completeRepairReview({ request, ports, configured, checkout, route }: GateRepairCompletion, reReviewFn: NonNullable<IntegrateSeams['reReviewFn']>): Promise<never> {
  const { slug, missionServices } = request;
  const { landing } = ports;
  // Provider invalidation or authoritative local review debt must establish
  // that fresh review is allowed before entering the shared continuation.
  const current = route.invalidation?.ok ? null : await missionServices?.store?.load(missionId(slug));
  if (repairedRevisionReviewEligible(Boolean(route.invalidation?.ok), current?.kind === 'found' && integrationRepairNeedsReview(current.mission))) {
    return reviewBeforeIntegration(slug, checkout, landing, reReviewFn,
      `${configured.length} integration gate(s) passed after ${route.rebounds} integration-gate rebound(s); the repaired revision was re-reviewed and approved. Read the fresh PR and run px integrate ${slug} to land.`, route.repairedRevision);
  }
  throw abortWith(landing, `The approval for ${slug}'s superseded revision could not be retracted. Aborting before merge.`);
}

async function stopNonContinuingRepair({ request, ports, route }: GateRepairCompletion): Promise<void> {
  const { slug, seams } = request;
  if (route.route === 'retained') {
    await projectBacklogTransition(request.context.mirrorOwnership, seams.transitionTaskFn, slug, 'ready-for-integration');
    throw new IntegrationStopsForHuman(`Original approval retained for ${slug}; review the PR and run px integrate ${slug} to land.`);
  }
  if (route.route === 'human-only') {
    throw abortWith(ports.landing, `Integration gate repair for ${slug} requires human action: ${route.diagnostic ?? 'the failure is classified as human-only'}. The failed gate evidence was retained and no repair agent was launched.`);
  }
}

export async function completeGateRepairRoute(completion: GateRepairCompletion): Promise<string> {
  const { request, ports, configured, route, reactivateMission } = completion;
  const { slug, missionServices, seams } = request;
  const { landing } = ports;
  // A route that cannot continue landing must leave the authoritative lane
  // in active repair state. The live rebound reaches this through
  // `transitionToImplementer`; retain the same fail-closed outcome for
  // exhausted transient retries and injected routing boundaries that did
  // not launch a repair.
  await stopNonContinuingRepair(completion);
  const repairRoute = integrationRepairRoute(route.route, Boolean(seams.reReviewFn));
  if (repairRoute !== 'resume' && missionServices?.store) {
    const failedMission = await missionServices.store.load(missionId(slug));
    if (failedMission.kind === 'found' && integrationRepairMustReactivate(route.route, failedMission.mission.status)) {
      await reactivateMission(slug);
    }
  }
  if (repairRoute === 're-review' && seams.reReviewFn) { return completeRepairReview(completion, seams.reReviewFn); }
  if (repairRoute === 'stop') {
    const current = await missionServices.store.load(missionId(slug));
    const pending = current.kind === 'found' && pendingIntegrationApproval(current.mission);
    throw abortWith(landing, pending
      ? `Aborting before merge. Resume integration repair with px integrate ${slug}; an approval returns the mission to the integration lane for you to integrate.`
      : `Aborting before merge. No pending original approval can authorize retention. Run px review ${slug} for a fresh review before integration.`);
  }
  // A route may report `fixed` only if the repair left the approved diff
  // unchanged and its approval was never retracted. Restore the mission to
  // the integration lane through the authoritative lifecycle guard so a
  // legacy or injected route cannot claim a green gate while the mission is
  // still in its active repair lane.
  const repaired = await missionServices.store.load(missionId(slug));
  if (repaired.kind !== 'found') { throw abortWith(landing, `Mission ${slug} is unavailable after integration repair.`); }
  if (!repairCanResumeIntegration(repaired.mission.status)) {
    throw abortWith(landing, `Mission ${slug} cannot resume integration from ${repaired.mission.status}.`);
  }
  await projectBacklogTransition(request.context.mirrorOwnership, seams.transitionTaskFn, slug, 'ready-for-integration');
  return `${configured.length} integration gate(s) passed after ${route.rebounds} integration-gate rebound(s)`;
}
