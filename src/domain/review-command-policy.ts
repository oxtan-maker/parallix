export type ReviewOperation = 'status' | 'verify' | 'submit' | 'push' | 'readComments' | 'comment' | 'submitReview' | 'close' | 'createEvent' | 'importLegacy' | 'backfillReview' | 'reconcileReview' | 'start' | 'continue' | 'resume';
/**
 * Review operations that keep the board busy, and the phase each publishes.
 *
 * Only the long-running ones appear here. `--status`, `--comments`, and the
 * one-shot maintenance flags finish in milliseconds; publishing current work
 * for them would flicker the board without telling an operator anything.
 */
const PUBLISHED_PHASES: Readonly<Record<string, 'review'>> = {
  start: 'review',
  continue: 'review',
  submit: 'review',
  submitReview: 'review',
};
const REVIEW_FLAG_OPERATIONS: ReadonlyArray<readonly [string, ReviewOperation]> = [
  ['--status', 'status'], ['--verify', 'verify'], ['--submit', 'submit'], ['--push', 'push'], ['--comments', 'readComments'], ['--comment', 'comment'], ['--comment-file', 'comment'], ['--submit-review', 'submitReview'], ['--close', 'close'], ['--create-event', 'createEvent'], ['--import-legacy', 'importLegacy'], ['--backfill-review', 'backfillReview'], ['--reconcile-review', 'reconcileReview'], ['--start', 'start'], ['--continue', 'continue'], ['--resume', 'resume'],
];


export function reviewOperation(args: readonly string[]): ReviewOperation {
  const flags = new Set(args.filter(arg => arg.startsWith('--')).map(arg => arg.split('=', 1)[0]));
  return REVIEW_FLAG_OPERATIONS.find(([flag]) => flags.has(flag))?.[1] || 'status';
}

export function reviewOperationPhase(operation: ReviewOperation): 'review' | undefined { return PUBLISHED_PHASES[operation]; }

export function reviewPushIdentity(identityUser: string | null | undefined, taskImplementer: string | null | undefined, providerEnabled: boolean) {
  const fallback = providerEnabled ? null : 'autonomous';
  const identity = identityUser || taskImplementer || fallback;
  return { identity: !identity || (providerEnabled && identity === 'autonomous') ? null : identity,
    defaulted: !identityUser && !taskImplementer && Boolean(fallback) };
}
