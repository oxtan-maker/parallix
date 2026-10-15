import type { ReviewStateWriter } from '../../src/application/ports/review-persistence.js';

/** Observe a successful fixture write and return its checked persistence receipt. */
export function reviewStateWriterFixture(
  observe: (...args: Parameters<ReviewStateWriter>) => unknown,
): ReviewStateWriter {
  return async (...args) => {
    await observe(...args);
    return { outcome: 'committed' };
  };
}
