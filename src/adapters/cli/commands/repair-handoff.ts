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

function parsePorcelainPath(line: string) {
  const xy = line.slice(0, 2);
  const rawPath = line.slice(3).trim();
  const pathPart = rawPath.includes('->') ? (rawPath.split('->').pop() || '').trim() : rawPath;
  return { xy, file: (pathPart.startsWith('"') && pathPart.endsWith('"')) ? pathPart.slice(1, -1) : pathPart };
}

function conflictedFiles(status: string) {
  return status.split('\n').filter((line: string) => line.trim()).map(parsePorcelainPath)
    .filter(({ xy }) => ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(xy));
}

function commitDirtyFiles(rootDir: string, slug: string, gitFn: Function, log: Function, error: Function) {
  const status = gitFn(['-C', rootDir, 'status', '--porcelain']);
  if (status.status !== 0 || !status.stdout) { return { repaired: false, blocker: null }; }
  const conflicts = conflictedFiles(status.stdout);
  if (conflicts.length) {
    const blocker = `Conflicted files detected:\n${conflicts.map(({ file }: { file: string }) => `       - ${file}`).join('\n')}`;
    log(`Cannot auto-commit: ${blocker}`);
    return { repaired: false, blocker };
  }
  const files = status.stdout.split('\n').filter((line: string) => line.trim()).map(parsePorcelainPath).map(({ file }: { file: string }) => file);
  if (!files.length) { return { repaired: false, blocker: null }; }
  log('Auto-committing dirty files:'); files.forEach((file: string) => log(`       - ${file}`));
  const added = gitFn(['-C', rootDir, 'add', '--', ...files]);
  if (added.status !== 0) {
    const failure = [added.stderr, added.stdout].filter(Boolean).join('\n').trim();
    const blocker = `failed to stage dirty files${failure ? `: ${failure}` : ''}`;
    error(fmt.status('FAIL', blocker));
    return { repaired: false, blocker };
  }
  const committed = gitFn(['-C', rootDir, 'commit', '-m', `workflow(${slug}): auto-commit mission artifacts before handoff`]);
  if (committed.status === 0) { log(fmt.status('PASS', 'Mission artifacts committed.')); return { repaired: true, blocker: null }; }
  const blocker = `failed to commit mission artifacts: ${committed.stderr}`;
  error(fmt.status('WARN', `Failed to commit mission artifacts: ${committed.stderr}`));
  return { repaired: false, blocker };
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
async function repairHandoff(slug: string, worktree: string, errorMsg: string, options: { gitFn?: Function, rebaseFn?: Function, log?: Function, error?: Function } = {}) {
  /** @type {{gitFn?: Function, rebaseFn?: Function, log?: Function, error?: Function}} */
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
  if (isBehind) {
    log('Branch appears behind primary branch. Calling rebase...');
    let rebaseSuccess = false;
    let rebaseError: string | null = null;
    try {
      await rebaseFn([slug], {
        gitFn: (args: string[], opts: { cwd?: string }) => gitFn(args, { ...opts, cwd: rootDir }),
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
  }

  return { repaired, blocker };
}

(repairHandoff as any).isRelaunchableError = isRelaunchableError;
(repairHandoff as any).classifyError = classifyError;
(repairHandoff as any).getDispatchAction = getDispatchAction;
(repairHandoff as any).FailureClass = FailureClass;
(repairHandoff as any).DispatchAction = DispatchAction;

export default repairHandoff;
export { repairHandoff, isRelaunchableError };
