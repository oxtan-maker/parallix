import type { ReviewLoopPorts } from '../../application/ports/review-round.js';

const activeReviewControllers = new Set<string>();

/** Missing durable history fails closed when the application reads or records it. */
export function unavailableActionHistory(): ReviewLoopPorts['actionHistory'] {
  const unavailable = async (): Promise<never> => { throw new Error('operational review action history unavailable'); };
  return { count: unavailable, record: unavailable };
}

/** One effective process-local review controller owns each worktree key. */
export function reviewControllerLock(key: string): ReviewLoopPorts['lock'] {
  return {
    tryAcquire: () => (activeReviewControllers.has(key) ? false : (activeReviewControllers.add(key), true)),
    release: () => { activeReviewControllers.delete(key); },
  };
}
