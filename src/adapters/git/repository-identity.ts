import * as path from 'node:path';

import { git } from './git.js';
import { primaryRepositoryWorktree, readRepositoryWorktrees, type GitReader } from './worktree.js';
import { repositoryId, type RepositoryId } from '../../domain/repository.js';

// ---------------------------------------------------------------------------
// Canonical repository identity — one owner
//
// A mission worktree and the checkout it was branched from are the same
// repository. Every command that reads or writes repository-scoped state must
// therefore agree on one identity, or a review preparation running in `<repo>-<slug>` and
// an integrate running in `<repo>` key different rows.
//
// This module is that single owner. A worktree path, the working directory, or
// an arbitrary absolute path is never the answer: the identity is derived from
// the primary checkout that owns the repository, which is what `git worktree
// list` reports first.
// ---------------------------------------------------------------------------

/**
 * The checkout that owns a repository's rows.
 *
 * Mission worktrees resolve back to the checkout they were created from;
 * anything Git cannot describe as a worktree is its own root.
 */
export function resolvePrimaryCheckout(rootDir: string, gitFn: GitReader = git): string {
  try {
    return primaryRepositoryWorktree(readRepositoryWorktrees(rootDir, gitFn))?.path ?? rootDir;
  } catch {
    return rootDir;
  }
}

/**
 * The canonical `RepositoryId` for any checkout of a repository.
 *
 * Both the primary checkout and every linked worktree resolve to the same
 * value, so lifecycle writes, lane reads, measurements, board metrics, cohorts
 * and the CLI statistics reports all name one repository.
 */
export function resolveCanonicalRepositoryId(rootDir: string): RepositoryId {
  const primary = resolvePrimaryCheckout(rootDir);
  return repositoryId(path.basename(primary) || primary);
}
