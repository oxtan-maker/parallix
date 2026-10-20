import { commitDirtyFiles } from '../../git/commit-dirty-files.js';
import type { GitReader } from '../../git/worktree.js';
import type { ParallixConfiguration } from '../../../application/ports/configuration.js';
import { git, getCurrentBranch } from '../../git/git.js';
import rebase from './rebase.js';
import * as fmt from '../../../application/presentation/cli-format.js';
import { FailureClass, DispatchAction, classifyError, getDispatchAction } from '../../../application/failure-classification.js';

// ── ADR 0048 classification (single table, owned by the application layer) ───
// The eight failure classes, the three dispatch actions, and `classifyError`
// live in `src/application/failure-classification.ts` so the rebound kernel and
// this repair path share one classifier. Re-exported here for existing callers.
export {
  FailureClass,
  DispatchAction,
  getDispatchAction,
  classifyError,
} from '../../../application/failure-classification.js';

/**
 * Check if an error message indicates a relaunchable content error (missing/empty goal-check table).
 * Delegates to classifyError for backward-compatible classification.
 *
 * @param errorMsg - The error message to check
 * @returns True if the error is relaunchable (IncompleteEvidence or GateFailure)
 */
function isRelaunchableError(errorMsg: string): boolean {
  if (!errorMsg || typeof errorMsg !== 'string') {
    return false;
  }
  const { failureClass } = classifyError(errorMsg);
  // IncompleteEvidence and GateFailure are the only classes that were relaunchable under the old logic
  return failureClass === FailureClass.IncompleteEvidence
    || failureClass === FailureClass.GateFailure;
}

/**
 * Attempt to repair a failed automated handoff by auto-committing dirty files
 * or rebasing.
 *
 * @param {string} slug - Mission slug
 * @param {string} worktree - Path to the mission worktree
 * @param {string} errorMsg - The error message from the failed handoff
 * @param {object} [options]
 * @returns {Promise<{repaired: boolean, blocker: string|null}>} Result and optional blocker reason
  */
async function repairHandoff(slug: string, worktree: string, errorMsg: string, options: { configuration?: ParallixConfiguration, gitFn?: GitReader, rebaseFn?: typeof import('./rebase.js').rebase, log?: (message: string) => void, error?: (message: string) => void } = {}) {
  /** @type {{gitFn?: GitReader, rebaseFn?: typeof import('./rebase.js').rebase, log?: (message: string) => void, error?: (message: string) => void}} */
  const opts = options;
  const {
    gitFn = git,
    rebaseFn = rebase,
    log = fmt.log.plain,
    error = fmt.log.plainError
  } = opts;

  const rootDir = worktree || process.cwd();
  let repaired = false;
  let blocker: string | null = null;

  // 0. Check if error is repairable via classifyError
  const classification = classifyError(errorMsg);
  const isGitBlocker = classification.failureClass === FailureClass.GitBlockers;
  // Derive isBehind from classification result (avoids duplicating classifyError's behind-branch patterns)
  const isBehind = classification.reason === 'behind';

  if (!isGitBlocker) {
    if (classification.failureClass === FailureClass.InfraBlocker) {
      blocker = `Infrastructure blocker detected: the handoff error is infrastructure-related (likely Forgejo credentials, connectivity, or rate limits). No agent relaunch will resolve this — the operator must check the Forgejo instance, verify credentials/token validity, and confirm network connectivity before retrying.`;
      log(blocker);
      return { repaired: false, blocker };
    }
    log(`Handoff error is not automatically repairable: ${errorMsg}`);
    return { repaired: false, blocker: null };
  }

  // 1. Auto-commit non-conflicted dirty files if uncommitted
  if (isGitBlocker) {
    const commit = commitDirtyFiles(rootDir, slug, gitFn, log, error);
    if (commit.blocker) { return commit; }
    repaired = commit.repaired;
  }

  // 2. Auto-rebase if branch is behind
  if (isBehind) { return rebaseHandoffBranch(slug, rootDir, gitFn, rebaseFn, opts, log, error); }

  return { repaired, blocker };
}

async function rebaseHandoffBranch(slug: string, rootDir: string, gitFn: GitReader, rebaseFn: typeof import('./rebase.js').rebase, opts: NonNullable<Parameters<typeof repairHandoff>[3]>, log: (message: string) => void, error: (message: string) => void) {
  let repaired = false;
  let blocker: string | null = null;
    log('Branch appears behind primary branch. Calling rebase...');
    let rebaseSuccess = false;
    let rebaseError: string | null = null;
    try {
      await rebaseFn([slug], {
        configuration: opts.configuration,
        gitFn: (args: string[], opts: import('../../git/git.js').GitOptions = {}) => gitFn(args, { ...opts, cwd: rootDir }),
        getCurrentBranchFn: () => getCurrentBranch(rootDir),
        exitFn: (code: number) => {
          if (code === 0) {
            rebaseSuccess = true;
          } else {
            rebaseError = `rebase exited with code ${code}`;
          }
        }
      });
    } catch (err) {
      rebaseError = (err instanceof Error) ? err.message : String(err);
    }

    if (!rebaseSuccess) {
      const msg = rebaseError || 'unknown rebase failure';
      error(fmt.status('WARN', `Auto-rebase failed: ${msg}`));
      blocker = `Auto-rebase failed: ${msg}`;
      repaired = false; // Reset repaired if rebase fails, even if auto-commit succeeded
    } else {
      repaired = true;
    }

  return { repaired, blocker };
}

const repairHandoffWithHelpers = Object.assign(repairHandoff, { isRelaunchableError, classifyError, getDispatchAction, FailureClass, DispatchAction });

export default repairHandoffWithHelpers;
export { repairHandoff, isRelaunchableError };
