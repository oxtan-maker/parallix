/** Persistence authority is adapter-owned; this module composes its observers. */
import type { MissionStore, SessionMarkerPort } from '../application/domain-ports.js';
import type { MissionLifecycleService } from '../application/mission-lifecycle-service.js';
import type { ParallixConfiguration } from '../application/ports/configuration.js';
import type { IntegrationMissionServices } from '../application/ports/integration-records.js';
import type { OperationalHistoryService } from '../application/services/operational-history-service.js';
import type { ReviewActionHistoryPort } from '../application/ports/review-action-history.js';
import type { RepositoryId } from '../domain/repository.js';
import type { SqliteDatabaseAdapter } from '../adapters/sqlite/database-adapter.js';
import { createReviewLoopPorts, type ReviewLoopBindings, type ReviewLoopTarget } from '../adapters/review/review-loop.js';
import { bindReviewPersistence, reviewLoopBindings } from '../adapters/review/review-persistence.js';
import { createReviewStartPolicyPorts, createTestsActionPolicyFactory, type ReviewStartObservationServices } from './review-start-observation.js';
import { createPolicyActionPort } from './review-policy-actions.js';
import { runReviewStepTests } from '../adapters/cli/commands/integrate.js';
import { missionId } from '../domain/mission.js';

export { bindReviewPersistence, reviewLoopBindings };

export interface ReviewPersistenceAuthorities {
  readonly mission: {
    readonly store: MissionStore;
    readonly lifecycle: MissionLifecycleService;
    readonly operationalHistory: OperationalHistoryService | null;
    readonly repositoryId: RepositoryId;
    /** Needed only to run a policy-selected integration test through the integrate workflow. */
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
  const policyActions = services && policy ? createPolicyActionPort({ slug, executionContext: target.executionContext,
    configuration: bindings.configuration, policy, missionServices: { store: mission.store, lifecycle: mission.lifecycle,
      integration: mission.integration, operationalHistory: mission.operationalHistory },
    policyFactory: createTestsActionPolicyFactory(bindings.configuration, services) }) : undefined;
  // The fixed sequence owns a tests action whenever no policy decision applies (no pilot, or a direct operator
  // command under a pilot): review and active record the integration run that px integrate later admits
  // (TASK-2872.02 SC2). The tests-action owner decides from its own evidence facts whether a run is still needed.
  const fixedTestsAction = services ? { runTests: () => runReviewStepTests(slug, {
    configuration: bindings.configuration, executionRoot: target.executionContext.missionWorktree,
    missionServicesFn: async (): Promise<IntegrationMissionServices> => ({ store: mission.store, lifecycle: mission.lifecycle,
      integration: mission.integration, operationalHistory: mission.operationalHistory }),
    verificationActionPolicy: createTestsActionPolicyFactory(bindings.configuration, services),
  }) } : undefined;
  const actionHistory: ReviewActionHistoryPort = mission.operationalHistory ? {
    count: () => mission.operationalHistory!.countReviewActions(slug, mission.repositoryId),
    record: input => mission.operationalHistory!.recordReviewAction({
      repositoryId: mission.repositoryId, missionId: missionId(slug), ...input,
    }),
  } : {
    count: async () => { throw new Error('operational review action history unavailable'); },
    record: async () => { throw new Error('operational review action history unavailable'); },
  };
  const ports = createReviewLoopPorts(slug, target, {
    ...bindings,
    ...persistence,
    ...(policy ? { reviewStartPolicy: policy } : {}),
    ...(policyActions ? { policyActions } : {}),
    ...(fixedTestsAction ? { fixedTestsAction } : {}),
    actionHistory,
  });
  return ports;
}
