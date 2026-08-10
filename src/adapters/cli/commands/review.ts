import { ReviewCommandUseCase } from '../../../application/review-command-use-case.js';
import { createReviewWorkflowAdapter } from '../../review/review-commands.js';

/**
 * Workflow command entry point for `review`.
 * Delegates to the review subsystem (review-commands.js).
 *
 * Usage: node parallix review [<slug>] [--verify] [--submit] [--push] ...
 */
/** @param {string[]} args */
async function reviewCommand(args: string[], options = {}) {
  const useCase = new ReviewCommandUseCase(createReviewWorkflowAdapter(options));
  await useCase.execute(args, options);
}

export default reviewCommand;
export { reviewCommand };
