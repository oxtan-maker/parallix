/** github-publish mode: durable states and transitions.

 * See docs/adr/0058-github-publish-mode.md for the decision. The state machine
 * is pure and side-effect free so it can be unit-tested without git.
 */

/** Durable mission/commit-level state under github-publish mode. */
export type GithubPublishState =
  | 'locally integrated'
  | 'external verification pending'
  | 'externally verified'
  | 'published'
  | 'external verification failed';

/**
 * Advance a state by one accepted transition. Unknown transitions throw: the
 * engine fails closed rather than inventing a path (e.g. verified -> pending
 * is not a legal revert).
 */
export function transitionFrom(
  from: GithubPublishState,
  to: GithubPublishState,
): GithubPublishState {
  const transitions: Record<GithubPublishState, readonly GithubPublishState[]> = {
    'locally integrated': ['external verification pending'],
    'external verification pending': ['externally verified', 'external verification failed'],
    'externally verified': ['published'],
    published: [],
    'external verification failed': [],
  };
  const allowed = transitions[from];
  if (!allowed.includes(to)) {
    throw new Error(
      `illegal github-publish transition: ${from} -> ${to}`,
    );
  }
  return to;
}

/** True when the mission may be published (advanced onto origin/main). */
export function isExternallyVerified(state: GithubPublishState): boolean {
  return state === 'externally verified';
}

/** True when the run is blocked by a failed verification. */
export function isVerificationFailed(state: GithubPublishState): boolean {
  return state === 'external verification failed';
}
