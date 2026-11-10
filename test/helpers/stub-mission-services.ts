import { agentFamily } from '../../src/domain/agents.js';
import { missionVersion } from '../../src/application/domain-ports.js';
/**
 * In-memory Mission services for tests that replace filesystem/module seams.
 * Each factory owns fresh aggregates and never opens the operator database.
 */
import type { ReviewPreparationMissionServices, ReviewPreparationMissionServicesPort } from '../../src/application/ports/review-preparation-workflow.js';
import { repositoryId } from '../../src/domain/repository.js';
import { fixtureMission } from '../fixtures/mission-builders.js';
import { reviewPreparationTransitionValue } from './review-preparation-ports.js';

export function stubMissionServices(overrides: Partial<ReviewPreparationMissionServices> = {}): ReviewPreparationMissionServicesPort {
  return async () => {
    const services: ReviewPreparationMissionServices & { repositoryId: ReturnType<typeof repositoryId> } = {
    repositoryId: repositoryId('test-repo'),
    store: {
      async load(id) {
        return { kind: 'found' as const, mission: fixtureMission(id, {
          assignee: agentFamily('claude'), repositoryId: repositoryId('test-repo'), status: 'review', checkpoints: [],
        }), version: missionVersion(1) };
      },
    },
    checkpoints: { async record() { return { status: 'completed' as const, durableEvidence: [] }; } },
    lifecycle: { async transition(request) { return { status: 'completed' as const, durableEvidence: [],
      value: reviewPreparationTransitionValue(missionVersion((request.expectedVersion ?? 0) + 1), fixtureMission(request.missionId, { status: 'review' })) }; } },
    nel: { async recordNel() { return { status: 'completed' as const, durableEvidence: [] }; } },
    ...overrides,
    };
    return services;
  };
}

export function stubRecordedMissionServices(): ReviewPreparationMissionServicesPort {
  return stubMissionServices({
    store: {
      async load(id) {
        return {
          kind: 'found' as const,
          mission: fixtureMission(id, {
            assignee: agentFamily('claude'), repositoryId: repositoryId('test-repo'), status: 'review',
              checkpoints: [{ missionId: id, name: 'CP-1',
              goalCheck: [{ criterion: "review preparation coverage", evidence: '`npm run typecheck`' }], nextActionText: 'review' }],
            brief: { goal: 'g', why: 'w', scope: 's', outOfScope: [] },
            successCriteria: ["review preparation coverage"], completedSuccessCriteria: [0], declaredGates: ['true'],
          }),
          version: missionVersion(1),
        };
      },
    },
  });
}
