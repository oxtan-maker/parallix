import type { GitCommandResult } from './rebase-workflow.js';

/**
 * Typed port for Git lock contention (TASK-2830).
 *
 * The application layer decides *what* to do once a lock is free; the adapter
 * owns *how* the failure is recognised (filesystem/process evidence rather than
 * locale-sensitive text) and *how long* the wait lasts. Keeping both sides
 * behind this port preserves the ports-and-adapters direction: the rebase and
 * integration workflows never import a Git adapter.
 */

/** Lock families reachable from the Git commands Parallix actually runs. */
export type GitLockFamily =
  | 'index'
  | 'head'
  | 'packed-refs'
  | 'ref'
  | 'reflog'
  | 'config'
  | 'worktree-admin'
  | 'fetch-metadata'
  | 'maintenance'
  | 'unknown';

/** Where the lock lives: one worktree's Git directory, or the shared repository. */
export type GitResourceScope = 'worktree' | 'repository';

/** Distinct failure classes; only `lock-contention` waits by default. */
export type GitFailureKind =
  | 'lock-contention'
  | 'protected-owner'
  | 'permission'
  | 'storage'
  | 'ref-compare-and-swap'
  | 'worktree-marker'
  | 'remote'
  | 'unrelated';

/**
 * Who is believed to hold the resource. `external-or-unknown` is the safe
 * default: an unprovable owner is never disturbed.
 */
export type GitLockOwnerEvidence = 'parallix-lease' | 'external-or-unknown' | 'unknown';

export interface GitLockEvidence {
  readonly kind: GitFailureKind;
  /** Repository-visible lock path; empty when the failure has no local lock. */
  readonly lockPath: string;
  readonly family: GitLockFamily;
  readonly scope: GitResourceScope;
  readonly owner: GitLockOwnerEvidence;
  readonly ownerPid: number | null;
  /** Lease/lock age in milliseconds, or null when it cannot be observed. */
  readonly ageMs: number | null;
  /** True only when Parallix demonstrated the lock and proved its owner gone. */
  readonly removable: boolean;
  /** Actionable, resource-scoped diagnostic for the operator. */
  readonly diagnostics: string;
}

export interface GitInvocation {
  readonly cwd: string;
  readonly args: readonly string[];
}

/** Progress notification emitted once per admission poll while waiting. */
export interface GitWaitingState {
  readonly resource: string;
  readonly lockPath: string;
  readonly scope: GitResourceScope;
  readonly owner: GitLockOwnerEvidence;
  readonly attempts: number;
  readonly waitedMs: number;
}

export type GitWaitStopReason = 'released' | 'cancelled' | 'wait-limit' | 'unrecoverable';

export interface GitLockWaitOutcome {
  readonly released: boolean;
  readonly attempts: number;
  readonly waitedMs: number;
  readonly evidence: GitLockEvidence;
  readonly stopReason: GitWaitStopReason;
}

export interface GitContentionPort {
  /** Structured classification of a failed invocation, or null when unrelated. */
  inspect(_result: GitCommandResult, _invocation: GitInvocation): GitLockEvidence | null;
  /** Wait through the shared admission owner; never deletes a lock it does not own. */
  waitForRelease(_evidence: GitLockEvidence, _options?: {
    signal?: AbortSignal;
    onWaiting?: (_state: GitWaitingState) => void;
  }): Promise<GitLockWaitOutcome>;
}
