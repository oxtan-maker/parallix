/** Persistence authority is adapter-owned; this module composes its observers. */
import type { MissionStore, SessionMarkerPort } from '../application/domain-ports.js';
import type { MissionLifecycleService } from '../application/mission-lifecycle-service.js';
import type { ParallixConfiguration } from '../application/ports/configuration.js';
import type { IntegrationMissionServices } from '../application/ports/integration-records.js';
import type { OperationalHistoryService } from '../application/services/operational-history-service.js';
import type { RepositoryId } from '../domain/repository.js';
import type { SqliteDatabaseAdapter } from '../adapters/sqlite/database-adapter.js';
import { createReviewLoopPorts, type ReviewLoopBindings, type ReviewLoopTarget } from '../adapters/review/review-loop.js';
import { bindReviewPersistence, reviewLoopBindings } from '../adapters/review/review-persistence.js';
import { createReviewStartPolicyPorts, createTestsActionPolicyFactory, type ReviewStartObservationServices } from './review-start-observation.js';
import { createPolicyActionPort } from './review-policy-actions.js';

export { bindReviewPersistence, reviewLoopBindings };

export interface ReviewPersistenceAuthorities {
  readonly mission: {
    readonly store: MissionStore;
    readonly lifecycle: MissionLifecycleService;
    readonly operationalHistory: OperationalHistoryService | null;
    readonly repositoryId: RepositoryId;
    /** Needed only to run a pilot-selected integration test through the integrate workflow. */
    readonly integration: IntegrationMissionServices['integration'];
  };
  readonly operatorState: {
    readonly db: SqliteDatabaseAdapter | null;
    readonly repositories: { readonly boardLaneEvents: ReviewStartObservationServices['lifecycle'] } | null;
  };
  readonly sessionMarker?: SessionMarkerPort | null;
}

/** One composition owner for Mission persistence and active review-start policy. */
export function createPersistentReviewLoopPorts(
  slug: string,
  target: ReviewLoopTarget,
  bindings: ReviewLoopBindings & { readonly configuration: ParallixConfiguration },
  authorities: ReviewPersistenceAuthorities,
) {
  const { mission, operatorState } = authorities;
  const persistence = reviewLoopBindings(mission.store, mission.lifecycle, authorities.sessionMarker);
  const services = operatorState.db && operatorState.repositories && mission.operationalHistory
    ? { db: operatorState.db, store: mission.store, history: mission.operationalHistory,
      lifecycle: operatorState.repositories.boardLaneEvents, repositoryId: mission.repositoryId }
    : null;
  const policy = services
    ? createReviewStartPolicyPorts(target.executionContext, slug, bindings.configuration, services)
    : undefined;
  const policyActions = services && policy ? createPolicyActionPort({ slug, history: services.history, executionContext: target.executionContext,
    configuration: bindings.configuration, policy, missionServices: { store: mission.store, lifecycle: mission.lifecycle,
      integration: mission.integration, operationalHistory: mission.operationalHistory },
    policyFactory: createTestsActionPolicyFactory(bindings.configuration, services) }) : undefined;
  return createReviewLoopPorts(slug, target, {
    ...bindings,
    ...persistence,
    ...(policy ? { reviewStartPolicy: policy } : {}),
    ...(policyActions ? { policyActions } : {}),
  });
}
