import type { MissionStore } from '../../src/application/domain-ports.js';
import { missionVersion } from '../../src/application/domain-ports.js';
import type { IntegrationMissionServices, IntegrationMissionServicesFactory } from '../../src/application/ports/integration-records.js';
import { repositoryId } from '../../src/domain/repository.js';
import { fixtureMission } from '../fixtures/mission-builders.js';

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
  return {
    ...overrides,
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
