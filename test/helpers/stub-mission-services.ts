import { agentFamily } from '../../src/domain/agents.js';
import { missionVersion } from '../../src/application/domain-ports.js';
/**
 * In-memory Mission services for tests that replace filesystem/module seams.
 * Each factory owns fresh aggregates and never opens the operator database.
 */
import type { HandoffMissionServices, HandoffMissionServicesPort } from '../../src/application/ports/handoff-workflow.js';
import { repositoryId } from '../../src/domain/repository.js';
import { fixtureMission } from '../fixtures/mission-builders.js';

export function stubMissionServices(overrides: Partial<HandoffMissionServices> = {}): HandoffMissionServicesPort {
  return async () => {
    const services: HandoffMissionServices & { repositoryId: ReturnType<typeof repositoryId> } = {
    repositoryId: repositoryId('test-repo'),
    store: {
      async load(id) {
        return { kind: 'found' as const, mission: fixtureMission(id, {
          assignee: agentFamily('claude'), repositoryId: repositoryId('test-repo'), status: 'review', checkpoints: [],
        }), version: missionVersion(1) };
      },
    },
    checkpoints: { async record() { return { status: 'completed' as const, durableEvidence: [] }; } },
    lifecycle: { async transition() { return { status: 'completed' as const, durableEvidence: [] }; } },
    handoff: { async recordNel() { return { status: 'completed' as const, durableEvidence: [] }; } },
    ...overrides,
    };
    return services;
  };
}

export function stubRecordedMissionServices(): HandoffMissionServicesPort {
  return stubMissionServices({
    store: {
      async load(id) {
        return {
          kind: 'found' as const,
          mission: fixtureMission(id, {
            assignee: agentFamily('claude'), repositoryId: repositoryId('test-repo'), status: 'review',
              checkpoints: [{ missionId: id, name: 'CP-1',
              goalCheck: [{ criterion: 'handoff coverage', evidence: '`npm run typecheck`' }], nextActionText: 'review' }],
            brief: { goal: 'g', why: 'w', scope: 's', outOfScope: [] },
            successCriteria: ['handoff coverage'], completedSuccessCriteria: [0], declaredGates: ['true'],
          }),
          version: missionVersion(1),
        };
      },
    },
  });
}
