import { runReviewStepTests } from '../adapters/cli/commands/integrate.js';
import type { IntegrationMissionServicesFactory } from '../application/ports/integration-records.js';
import * as fmt from '../application/presentation/cli-format.js';
import type { ParallixConfiguration } from '../application/ports/configuration.js';
import type { createProductionApplicationServices } from './application-services.js';
import { createTestsActionPolicyFactory } from './review-start-observation.js';

/**
 * The review step's tests action, started only from the recorded human approval.
 * The next-action owner decides whether anything runs; this reports what it did.
 * `executionRoot` is the checkout the verdict was recorded in, so the executor
 * resolves the same mission worktree the human was acting on.
 */
export async function runReviewStepTestsForSlug(slug: string, configuration: ParallixConfiguration,
  executionRoot: string, missionServicesFn: IntegrationMissionServicesFactory,
  services: Awaited<ReturnType<typeof createProductionApplicationServices>>): Promise<void> {
  const { mission, operatorState } = services;
  const verificationActionPolicy = mission && operatorState.db && operatorState.repositories
    ? createTestsActionPolicyFactory(configuration, { db: operatorState.db, store: mission.store,
      history: mission.operationalHistory, lifecycle: operatorState.repositories.boardLaneEvents,
      repositoryId: mission.repositoryId }) : undefined;
  const outcome = await runReviewStepTests(slug, { configuration, executionRoot, missionServicesFn,
    verificationActionPolicy });
  if (outcome.kind === 'completed') {
    fmt.log.info(`[review] Integration tests ${outcome.verdict} for ${slug}${outcome.recorded ? ' (current run reused)' : ''}.`);
  } else if (outcome.kind === 'human-handoff') {
    fmt.log.warn(`[review] Integration tests for ${slug} need a human: ${outcome.reason} — ${outcome.detail}`);
  }
}
