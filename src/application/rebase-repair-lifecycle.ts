import type { RebaseMissionServices, RebaseWorkflowPort } from './ports/rebase-workflow.js';
import { transitionReviewRepair } from './review-repair-lifecycle.js';
import { missionId } from '../domain/mission.js';
import type { ConfiguredReviewerEligibility } from '../domain/review.js';

/** Effects used by application-owned rebase repair lifecycle decisions. */
export interface RepairBindings {
  missionServices?: (_root: string) => Promise<RebaseMissionServices>;
  cwd(): string;
  transitionTask: RebaseWorkflowPort['transitionTask'];
  reviewerEligibility(_root: string): ConfiguredReviewerEligibility;
}

export async function transitionRebaseRepair(slug: string, status: string, transitionOptions: { rootDir?: string; log?: (message: string) => void }, bindings: RepairBindings) {

  if (bindings.missionServices && status === 'active') {
    const root = transitionOptions?.rootDir || bindings.cwd();
    const services = await bindings.missionServices(root);
    const loaded = await services.store.load(missionId(slug));
    if (loaded.kind !== 'found') { throw new Error(`Mission ${slug} is unavailable for rebase repair`); }
    // Integration rebase repair is part of integration completion.
    if (loaded.mission.status === 'integration') {
      return bindings.transitionTask(slug, 'ready-for-integration', transitionOptions);
    }
    const implementer = loaded.mission.assignee ?? loaded.mission.review?.rounds.at(-1)?.implementer;
    if (!implementer) { throw new Error(`Mission ${slug} has no implementer for rebase repair`); }
    await transitionReviewRepair(slug, 'active', implementer, services.store, services.lifecycle, undefined, { kind: 'rebase-repair' });
  }
  return bindings.transitionTask(slug, status, transitionOptions);

}

export async function resumeRebaseReview(slug: string, root: string, implementer: string, bindings: RepairBindings) {

  if (!bindings.missionServices) { return; }
  const services = await bindings.missionServices(root);
  const loaded = await services.store.load(missionId(slug));
  if (loaded.kind !== 'found') { throw new Error(`Mission ${slug} is unavailable after rebase repair`); }
  if (loaded.mission.status === 'active' && loaded.mission.review && !loaded.mission.review.rounds.at(-1)?.decision) {
    // AC12: reviewer eligibility always comes from the configured review step
    // of THIS mission's worktree, never from the prior round's reviewer.
    const reviewerEligibility = bindings.reviewerEligibility(root);
    await transitionReviewRepair(slug, 'review', implementer, services.store, services.lifecycle, reviewerEligibility);
    await bindings.transitionTask(slug, 'review', { rootDir: root });
  }

}

