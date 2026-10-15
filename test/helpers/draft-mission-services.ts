import type { DraftMissionServices } from '../../src/application/ports/cli-workflows.js';
import { repositoryId } from '../../src/domain/repository.js';

/** Unprovided collaborators fail explicitly; cases supply the operations they exercise. */
export function draftMissionServicesFixture(overrides: Partial<DraftMissionServices> = {}): DraftMissionServices {
  return {
    repositoryId: repositoryId('draft-fixture'),
    store: { async load() { throw new Error('Unexpected draft fixture store.load'); } },
    intake: { async execute() { throw new Error('Unexpected draft fixture intake.execute'); } },
    lifecycle: { async transition() { throw new Error('Unexpected draft fixture lifecycle.transition'); } },
    ...overrides,
  };
}
