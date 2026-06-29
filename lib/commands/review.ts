import { review } from '../review/review-commands.js';

/**
 * Workflow command entry point for `review`.
 * Delegates to the review subsystem (review-commands.js).
 *
 * Usage: node parallix review [<slug>] [--verify] [--submit] [--push] ...
 */
/** @param {string[]} args */
async function reviewCommand(args: string[]) {
  await review(args);
}

export = reviewCommand;
