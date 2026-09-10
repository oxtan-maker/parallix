import { git, getCurrentBranch } from '../../git/git.js';
import * as missionUtils from '../../filesystem/mission-utils.js';
import rebase from './rebase.js';
import * as fmt from '../../../application/presentation/cli-format.js';
import { FailureClass, DispatchAction, classifyError, getDispatchAction } from '../../../application/failure-classification.js';
import {
  buildReboundFixPrompt,
  classifyReboundReason,
  type HandoffVerificationReason,
} from '../../../application/rebound-kernel.js';

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
 * Build a relaunch prompt for an agent to fix a relaunchable error.
 *
 * @param {string} errorMsg - The error message from the failed handoff
 * @param {string} slug - Mission slug
 * @param {string} worktree - Path to the mission worktree
 * @returns {string} The relaunch prompt
  */
function buildRelaunchPrompt(errorMsg: string, slug: string, worktree: string, gateOutput?: { stdout: string; stderr: string }) {
  const reason: HandoffVerificationReason = {
    kind: 'handoff-verification',
    error: errorMsg,
    gateOutput: [gateOutput?.stdout, gateOutput?.stderr].filter(Boolean).join('\n'),
  };
  const classification = classifyReboundReason(reason);
  const missionDir = missionUtils.findMissionDir(slug, worktree) || missionUtils.missionDirForSlug(worktree, slug);
  const offendingRow = errorMsg.match(/Offending row:\s*(.+)$/m)?.[1]?.trim();
  const remedy = classification.failureClass === FailureClass.GateFailure
    ? [
      'This is a verification/test failure, not missing checkpoint evidence. Do not edit checkpoint evidence to work around it.',
      `Fix the specific handoff verification failure shown above: fix the failing verification or test named in the captured output in ${worktree}, rerun that verification, and commit the fix.`,
      `Post-return action: px review ${slug} --submit.`,
    ].join('\n')
    : [
      `${errorMsg.includes('No checkpoint documents found') ? 'Create CP-1.md' : 'Fix the final checkpoint document (CP-N.md)'} in ${missionDir} with a Goal Check table.`,
      'Use one canonical heading: ## Goal Check',
      'Use this exact table shape:',
      '| Criterion | Evidence | Status |',
      '|---|---|---|',
      'Accepted evidence includes exact test names, test file paths, ADR references, recognized repo commands or paths, and file:line references when necessary.',
      'For an integration handoff, ./scripts/verify-local.sh integrate is mandatory; ./scripts/verify-local.sh all alone is not sufficient.',
      ...(offendingRow ? [`Rejected row: ${offendingRow}`, 'Do not retry with only shell output or file metadata; replace it with a test file path, ADR reference, or recognized repo command/path.'] : []),
      `Post-return action: px review ${slug} --submit.`,
    ].join('\n');
  const stageRemedy = `${remedy}\nLet the same verification rerun confirm the repair.`;
  return buildReboundFixPrompt({
    label: classification.label,
    slug,
    worktree,
    area: 'handoff',
    facts: [['Handoff error', errorMsg]],
    diagnostic: [reason.error, reason.gateOutput].filter(Boolean).join('\n'),
    classification,
    attempt: 1,
    maxAttempts: 2,
    remedy: stageRemedy,
  });
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

  /** @param {string} line */
  function parsePorcelainPath(line: string) {
    const xy = line.slice(0, 2);
    const rawPath = line.slice(3).trim();
    const pathPart = rawPath.includes('->') ? (rawPath.split('->').pop() || '').trim() : rawPath;
    const cleanPath = (pathPart.startsWith('"') && pathPart.endsWith('"')) ? pathPart.slice(1, -1) : pathPart;
    return { xy, file: cleanPath };
  }

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
    const statusResult = gitFn(['-C', rootDir, 'status', '--porcelain']);
    if (statusResult.status === 0 && statusResult.stdout) {
      const dirtyLines = statusResult.stdout.split('\n')
        .filter((line: string) => line.trim().length > 0);

      const dirtyFilesWithStatus = dirtyLines.map(parsePorcelainPath);

      const unmerged = dirtyFilesWithStatus.filter((f: { xy: string; file: string }) =>
        ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(f.xy)
      );

      if (unmerged.length > 0) {
        blocker = `Conflicted files detected:\n${unmerged.map((f: { xy: string; file: string }) => `       - ${f.file}`).join('\n')}`;
        log(`Cannot auto-commit: ${blocker}`);
        return { repaired: false, blocker };
      }

      const dirtyFiles = dirtyFilesWithStatus.map((f: { xy: string; file: string }) => f.file);

      if (dirtyFiles.length > 0) {
        log(`Auto-committing dirty files:`);
        dirtyFiles.forEach((file: string) => log(`       - ${file}`));
        const addResult = gitFn(['-C', rootDir, 'add', '--', ...dirtyFiles]);
        if (addResult.status !== 0) {
          const failureText = [addResult.stderr, addResult.stdout].filter(Boolean).join('\n').trim();
          blocker = `failed to stage dirty files${failureText ? `: ${failureText}` : ''}`;
          error(fmt.status('FAIL', blocker));
          return { repaired: false, blocker };
        }
        const commitRes = gitFn(['-C', rootDir, 'commit', '-m', `workflow(${slug}): auto-commit mission artifacts before handoff`]);
        if (commitRes.status === 0) {
          log(fmt.status('PASS', 'Mission artifacts committed.'));
          repaired = true;
        } else {
          error(fmt.status('WARN', `Failed to commit mission artifacts: ${commitRes.stderr}`));
          blocker = `failed to commit mission artifacts: ${commitRes.stderr}`;
          return { repaired: false, blocker };
        }
      }
    }
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
(repairHandoff as any).buildRelaunchPrompt = buildRelaunchPrompt;
(repairHandoff as any).classifyError = classifyError;
(repairHandoff as any).getDispatchAction = getDispatchAction;
(repairHandoff as any).FailureClass = FailureClass;
(repairHandoff as any).DispatchAction = DispatchAction;

export default repairHandoff;
export { repairHandoff, isRelaunchableError, buildRelaunchPrompt };
