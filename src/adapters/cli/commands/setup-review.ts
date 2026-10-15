import { setupReview } from '../../review/setup-review.js';

/**
 * Workflow command entry point for `setup-review`.
 * Delegates to the Forgejo bootstrap tool (tools/setup-review.js).
 *
 * Usage: node parallix setup-review
 */
async function setupReviewCommand(args: string[], options?: Parameters<typeof setupReview>[1]) {
  await setupReview(args, options);
}

export default setupReviewCommand;
export { setupReviewCommand };
