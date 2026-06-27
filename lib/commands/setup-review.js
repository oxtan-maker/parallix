const setupReview = require('../tools/setup-review');

/**
 * Workflow command entry point for `setup-review`.
 * Delegates to the Forgejo bootstrap tool (tools/setup-review.js).
 *
 * Usage: node parallix setup-review
 */
/** @param {string[]} args @param {object} options */
async function setupReviewCommand(args, options) {
  await setupReview(args, options);
}

module.exports = setupReviewCommand;
