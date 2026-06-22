const review = require('../review/review-commands').review;

/**
 * Workflow command entry point for `review`.
 * Delegates to the review subsystem (review-commands.js).
 *
 * Usage: node parallix review [<slug>] [--verify] [--submit] [--push] ...
 */
async function reviewCommand(args) {
  await review(args);
}

module.exports = reviewCommand;
