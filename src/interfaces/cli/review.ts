import * as fmt from '../../application/presentation/cli-format.js';
import { suggestFlag } from '../../application/presentation/cli-flags.js';
import { ReviewCommandUseCase } from '../../application/review-command-use-case.js';

const REVIEW_FLAGS = new Set([
  '--actor', '--backfill-review', '--branch', '--close', '--comment', '--comment-file', '--comments', '--consume-artifacts', '--continue', '--create-event', '--disposition', '--dry-run', '--eligible-reviewer', '--focus', '--force', '--implementer', '--import-legacy', '--input-file', '--max-attempts', '--message', '--message-file', '--mission', '--no-gate', '--phase', '--poll-timeout-seconds', '--push', '--reconcile-review', '--resume', '--reset', '--reviewer', '--round', '--revision', '--start', '--status', '--submit', '--submit-review', '--target', '--tmp-dir', '--type', '--verbose', '--verdict', '--verify'
]);
const REVIEW_VALUE_FLAGS = new Set([
  '--actor', '--branch', '--comment', '--comment-file', '--disposition', '--eligible-reviewer', '--focus', '--implementer', '--input-file', '--max-attempts', '--message', '--message-file', '--mission', '--phase', '--poll-timeout-seconds', '--reviewer', '--round', '--revision', '--submit-review', '--target', '--tmp-dir', '--type', '--verdict'
]);

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
