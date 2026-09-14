/** Operator status for github-publish mode.

 * Exposes local head, published head, missions awaiting verification,
 * verified-but-blocked missions, and failed verification. Rendering stays in
 * the projection layer; this owns only domain status.
 * See docs/adr/0058-github-publish-mode.md.
 */
import type { VerificationOracle } from './publication-engine.js';
import type { CommitTracking } from './publication-engine.js';

export interface GithubPublishStatus {
  /** Local integration head (local main tip). */
  localHead: string;
  /** Highest published head (origin/main tip). */
  publishedHead: string;
  /** Commits awaiting external verification. */
  awaitingVerification: CommitTracking[];
  /** Externally verified but blocked behind an earlier unverified/failed commit. */
  verifiedBlocked: CommitTracking[];
  /** Failed verifications that block the contiguous run. */
  failed: CommitTracking[];
  /** Contiguous verified run that could advance main this poll. */
  publishableRun: string[];
}

/**
 * Compute operator status from the ahead-commits (oldest first) and their
 * tracking. A commit is "verified but blocked" when it is externally verified
 * yet an earlier commit in the run is not published/verified.
 */
export function computeGithubPublishStatus(
  ahead: CommitTracking[],
  localHead: string,
  publishedHead: string,
  _oracle: VerificationOracle,
): GithubPublishStatus {
  const awaitingVerification: CommitTracking[] = [];
  const verifiedBlocked: CommitTracking[] = [];
  const failed: CommitTracking[] = [];

  let blocked = false;
  for (const commit of ahead) {
    if (commit.state === 'external verification failed') {
      failed.push(commit);
      blocked = true;
      continue;
    }
    if (blocked) {
      // Everything after a failure is blocked regardless of its own state.
      if (commit.state === 'externally verified') {
        verifiedBlocked.push(commit);
      } else {
        awaitingVerification.push(commit);
      }
      continue;
    }
    if (commit.published) {continue;}
    if (commit.state === 'externally verified') {
      verifiedBlocked.push(commit);
    } else {
      awaitingVerification.push(commit);
    }
  }

  // The contiguous publishable run: verified commits from the first unpublished
  // one, stopping at the first non-verified.
  const publishableRun: string[] = [];
  let seenUnpublished = false;
  for (const commit of ahead) {
    if (commit.published) {continue;}
    seenUnpublished = true;
    if (commit.state === 'externally verified') {
      publishableRun.push(commit.sha);
    } else {
      break;
    }
  }
  if (!seenUnpublished) {publishableRun.length = 0;}

  return { localHead, publishedHead, awaitingVerification, verifiedBlocked, failed, publishableRun };
}
