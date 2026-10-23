import * as fmt from '../../application/presentation/cli-format.js';
import { suggestFlag } from '../../application/presentation/cli-flags.js';
import { ReviewCommandUseCase } from '../../application/review-command-use-case.js';

import { REVIEW_FLAGS, REVIEW_VALUE_FLAGS } from '../../domain/review-cli-options.js';

export interface ReviewCliRequest {
  readonly explicitSlug?: string;
  readonly flags: readonly string[];
}

/** Parse review flags without consulting filesystem or adapters. */
export function parseReviewCliRequest(args: string[]): ReviewCliRequest {
  const flags: string[] = [];
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const equals = arg.indexOf('=');
    const flag = equals === -1 ? arg : arg.slice(0, equals);
    if (!REVIEW_FLAGS.has(flag)) {
      const suggestion = suggestFlag(flag, REVIEW_FLAGS);
      throw new Error(`Unknown flag for px review: ${flag}${suggestion ? ` — did you mean ${suggestion}?` : ''}`);
    }
    flags.push(flag);
    if (equals === -1 && REVIEW_VALUE_FLAGS.has(flag) && args[index + 1] !== undefined) { index += 1; }
  }
  return { explicitSlug: positional[0], flags };
}

/** Render parser diagnostics and delegate valid requests to the application use case. */
export function createReviewCommand(useCase: ReviewCommandUseCase) {
  return (args: string[], options: Record<string, unknown> = {}) => {
    const error = (options.error || options.errorFn || fmt.log.plainError) as (_message: string) => void;
    const exit = (options.exit || options.exitFn || process.exit) as (_code?: number) => never;
    try {
      parseReviewCliRequest(args);
    } catch (caught) {
      error(fmt.status('FAIL', (caught as Error).message));
      exit(1);
      return;
    }
    return useCase.execute(args, options);
  };
}
