/** github-publish verification-ref naming and collision handling.

 * The verification ref encodes the exact commit SHA so it is unique per commit
 * and collision-free. See docs/adr/0058-github-publish-mode.md.
 */

/** Default prefix for the verification ref, e.g. refs/github-publish/<sha>. */
export const DEFAULT_VERIFICATION_REF_PREFIX = 'github-publish';

/**
 * Build the verification ref name for a commit SHA.
 *
 * The ref is `refs/<prefix>/<sha>` where `<sha>` is the full 40-char commit
 * hash. Encoding the SHA makes every ref unique and lets the engine detect a
 * pre-existing ref that points at a different commit (collision) versus one
 * that already verifies the same commit (idempotent retry).
 *
 * @param sha full commit SHA (40 hex chars)
 * @param prefix ref path prefix under refs/ (default 'github-publish')
 */
export function verificationRefName(
  sha: string,
  prefix: string = DEFAULT_VERIFICATION_REF_PREFIX,
): string {
  assertSha(sha);
  return `refs/${prefix}/${sha}`;
}

/** Commit SHA assertion for verification-ref naming. */
function assertSha(sha: string): void {
  if (!/^[0-9a-f]{40}$/i.test(sha)) {
    throw new Error(`invalid commit SHA for verification ref: ${sha}`);
  }
}

/**
 * Resolve the outcome of a ref that already exists.
 *
 * @param existingSha current SHA the existing ref points at
 * @param expectedSha SHA the engine intends to publish
 * @returns a resolution describing the safe action
 */
export function resolveExistingRef(
  existingSha: string,
  expectedSha: string,
): { action: 'idempotent-retry' | 'collision' } {
  if (normalize(existingSha) === normalize(expectedSha)) {
    // Same SHA already published. The ref is not a collision; the publish is an
    // idempotent no-op and verification may proceed.
    return { action: 'idempotent-retry' };
  }
  // A pre-existing ref at a different commit is a genuine collision: never
  // clobber it. Fail closed and let the operator reconcile.
  return { action: 'collision' };
}

function normalize(sha: string): string {
  return sha.trim().toLowerCase();
}
