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
    blocked = collectCommitStatus(commit, blocked, awaitingVerification, verifiedBlocked, failed);
  }

  return { localHead, publishedHead, awaitingVerification, verifiedBlocked, failed, publishableRun: collectPublishableRun(ahead) };
}

function collectCommitStatus(
  commit: CommitTracking,
  blocked: boolean,
  awaitingVerification: CommitTracking[],
  verifiedBlocked: CommitTracking[],
  failed: CommitTracking[],
): boolean {
  if (commit.state === 'external verification failed') { failed.push(commit); return true; }
  if (blocked) {
    if (commit.state === 'externally verified') { verifiedBlocked.push(commit); }
    else { awaitingVerification.push(commit); }
    return true;
  }
  if (commit.published) { return false; }
  if (commit.state === 'externally verified') { verifiedBlocked.push(commit); return false; }
  awaitingVerification.push(commit);
  return false;
}

function collectPublishableRun(ahead: CommitTracking[]): string[] {
  const unpublished = ahead.filter((commit) => !commit.published);
  const firstUnverified = unpublished.findIndex((commit) => commit.state !== 'externally verified');
  return unpublished.slice(0, firstUnverified < 0 ? undefined : firstUnverified).map((commit) => commit.sha);
}
