import type { BounceSeams } from '../../src/application/integrate/support.js';

/** Landing-only cases must never launch or reactivate an implementer. */
export function integrationBounceSeams(overrides: Partial<BounceSeams> = {}): BounceSeams {
  return {
    startAgentFn: () => { throw new Error('Unexpected integration agent launch'); },
    transitionTaskFn: () => { throw new Error('Unexpected integration task transition'); },
    applyAgentFallbackFn: () => { throw new Error('Unexpected integration fallback'); },
    ...overrides,
  };
}
