import { missionId } from '../../domain/mission.js';
import { integrationRepairMustReactivate, integrationRepairRoute, repairedRevisionReviewEligible, repairCanResumeIntegration } from '../../domain/integration-gate-policy.js';
import { integrationRepairNeedsReview } from '../integration-repair-review.js';
import { abortWith } from './support.js';
import type { IntegrationGateDefinition } from '../ports/integration-records.js';
import type { IntegrateWorkflowPorts, IntegrationGateRoute } from '../ports/integrate-workflow.js';
import type { GateStepRequest, IntegrateSeams } from './gates.js';

export class IntegrationStopsForHuman extends Error {
  constructor(readonly message: string) {
  super(message);
  this.name = 'IntegrationStopsForHuman';
  }
}

interface GateRepairCompletion { request: GateStepRequest; ports: Pick<IntegrateWorkflowPorts, 'landing'>; configured: IntegrationGateDefinition[]; checkout: string; route: IntegrationGateRoute; reactivateMission: (slug: string) => Promise<unknown>; reReviewRepairedRevision: (slug: string, checkout: string, revision: string, reReviewFn: NonNullable<IntegrateSeams['reReviewFn']>) => Promise<boolean> }

async function completeRepairReview({ request, ports, configured, checkout, route, reReviewRepairedRevision }: GateRepairCompletion, reReviewFn: NonNullable<IntegrateSeams['reReviewFn']>): Promise<never> {
  const { slug, missionServices } = request;
  const { landing } = ports;
    // The repair changed what the reviewer approved, so the standing approval
    // was retracted on the PR. Re-review the repaired revision through the
    // single live `px review` route. On approval the mission sits
    // in the integration lane for the human to read the fresh PR and
    // integrate; no path auto-restarts integration or merges (TASK-2620 AC2).
    const current = route.invalidation?.ok ? null : await missionServices?.store?.load(missionId(slug));
    if (repairedRevisionReviewEligible(Boolean(route.invalidation?.ok), current?.kind === 'found' && integrationRepairNeedsReview(current.mission))) {
      const approved = await reReviewRepairedRevision(slug, checkout, route.repairedRevision ?? 'unknown', reReviewFn);
      if (approved) {
        throw new IntegrationStopsForHuman(`${configured.length} integration gate(s) passed after ${route.rebounds} integration-gate rebound(s); the repaired revision was re-reviewed and approved. Read the fresh PR and run px integrate ${slug} to land.`);
      }
      throw abortWith(landing, `The repaired revision of ${slug} was not approved in re-review. Run px review ${slug} to resume review; an approval returns the mission to the integration lane for you to integrate.`, 'Aborting before merge.');
    }
    throw abortWith(landing, `The approval for ${slug}'s superseded revision could not be retracted. Aborting before merge.`);
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
  const repairRoute = integrationRepairRoute(route.route, Boolean(seams.reReviewFn));
  if (repairRoute !== 'resume' && missionServices?.store) {
    const failedMission = await missionServices.store.load(missionId(slug));
    if (failedMission.kind === 'found' && integrationRepairMustReactivate(route.route, failedMission.mission.status)) {
      await reactivateMission(slug);
    }
  }
  if (repairRoute === 're-review' && seams.reReviewFn) { return completeRepairReview(completion, seams.reReviewFn); }
  if (repairRoute === 'stop') {
    throw abortWith(landing, `Aborting before merge. Resume the repair review with px review ${slug}; an approval returns the mission to the integration lane for you to integrate.`);
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
  await seams.transitionTaskFn(slug, 'ready-for-integration');
  return `${configured.length} integration gate(s) passed after ${route.rebounds} integration-gate rebound(s)`;
  }
