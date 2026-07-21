import { setupReview } from '../tools/setup-review.js';

/**
 * Workflow command entry point for `setup-review`.
 * Delegates to the Forgejo bootstrap tool (tools/setup-review.js).
 *
 * Usage: node parallix setup-review
 */
/** @param {string[]} args @param {{[key: string]: any}} [options] */
async function setupReviewCommand(args: string[], options?: {[key: string]: any}) {
  await setupReview(args, options);
}

export default setupReviewCommand;
export { setupReviewCommand };

// CJS compat: ensure require() returns the function directly
declare const module: { exports: any } | undefined;
if (typeof module !== 'undefined') { module.exports = setupReviewCommand; }
