import type { MissionStore } from '../../src/application/domain-ports.js';
import { missionVersion } from '../../src/application/domain-ports.js';
import type { IntegrationMissionServices, IntegrationMissionServicesFactory } from '../../src/application/ports/integration-records.js';
import { repositoryId } from '../../src/domain/repository.js';
import { fixtureMission } from '../fixtures/mission-builders.js';
import { reviewActionStarted } from '../../src/application/review-action-history.js';
import type { ReviewActionStarted } from '../../src/application/ports/review-action-history.js';

type Overrides = Omit<Partial<IntegrationMissionServices>, 'store' | 'lifecycle' | 'integration'> & {
  store?: Partial<MissionStore>;
  lifecycle?: Partial<IntegrationMissionServices['lifecycle']>;
  integration?: Partial<IntegrationMissionServices['integration']>;
};

function completeStore(store: Partial<MissionStore> | undefined): store is MissionStore {
  return typeof store?.load === 'function' && typeof store.save === 'function';
}

function completeLifecycle(lifecycle: Partial<IntegrationMissionServices['lifecycle']> | undefined): lifecycle is IntegrationMissionServices['lifecycle'] {
  return typeof lifecycle?.transition === 'function';
}

function completeIntegration(integration: Partial<IntegrationMissionServices['integration']> | undefined): integration is IntegrationMissionServices['integration'] {
  return typeof integration?.decideIntegration === 'function' && typeof integration.close === 'function';
}

/** Each fixture supplies its observed state and explicitly opts into writes. */
export function integrationServices(overrides: Overrides = {}): IntegrationMissionServices {
  const starts: ReviewActionStarted[] = [];
  return {
    ...overrides,
    reviewActions: overrides.reviewActions === undefined ? {
      countReviewActions: async () => starts.length,
      // Mirrors the durable owner (OperationalHistoryService.recordReviewAction): a replay of the
      // same (action, correlation, changeIdentity) returns its existing start, never a new one.
      recordReviewAction: async input => {
        const existing = starts.find(action => action.action === input.action
          && action.correlation === input.correlation && action.changeIdentity === input.changeIdentity);
        if (existing) { return existing; }
        const started = reviewActionStarted(input, starts.length + 1);
        starts.push(started);
        return started;
      },
    } : overrides.reviewActions,
    store: completeStore(overrides.store) ? overrides.store : {
      async load(id) {
        return { kind: 'found', mission: fixtureMission(id, {
          repositoryId: repositoryId('test-repo'), status: 'review', checkpoints: [],
        }), version: missionVersion(1) };
      },
      async save() { throw new Error('unexpected integration fixture store.save'); },
      ...overrides.store,
    },
    lifecycle: completeLifecycle(overrides.lifecycle) ? overrides.lifecycle : {
      async transition() { throw new Error('unexpected integration fixture lifecycle.transition'); },
      ...overrides.lifecycle,
    },
    integration: completeIntegration(overrides.integration) ? overrides.integration : {
      async decideIntegration() { throw new Error('unexpected integration fixture decideIntegration'); },
      async close() { throw new Error('unexpected integration fixture close'); },
      ...overrides.integration,
    },
  };
}

export function stubIntegrationMissionServices(overrides: Overrides = {}): IntegrationMissionServicesFactory {
  return async () => integrationServices(overrides);
}
