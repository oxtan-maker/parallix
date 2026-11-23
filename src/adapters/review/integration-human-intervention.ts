import type { IntegrateWorkflowPorts } from '../../application/ports/integrate-workflow.js';
import { persistReviewStateOrThrow, readReviewState, writeReviewState } from './review-state.js';

/** Bind integration action-limit handoff to the existing durable review attention state. */
export function createIntegrationHumanIntervention(): IntegrateWorkflowPorts['review']['requestHumanIntervention'] {
  return async (slug, reason, options) => {
    const worktree = options.executionContext.missionWorktree;
    const state = await readReviewState(slug, worktree, options.missionServices.store);
    if (!state) { return { ok: false, diagnostic: `Mission ${slug} has no review state for human attention` }; }
    state.disposition ||= reason;
    state.metadata = {
      ...state.metadata,
      humanEscalationReason: reason,
      humanEscalatedAt: new Date().toISOString(),
    };
    try {
      await persistReviewStateOrThrow(writeReviewState, slug, state, worktree, options.missionServices.store);
      return { ok: true };
    } catch (error) {
      return { ok: false, diagnostic: error instanceof Error ? error.message : String(error) };
    }
  };
}
