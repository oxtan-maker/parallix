const path = require('path');
const { git } = require('../core/git');
const missionUtils = require('../core/mission-utils');
const rebase = require('./rebase');
const fmt = require('../core/fmt');

/**
 * Check if an error message indicates a relaunchable content error (missing/empty goal-check table).
 *
 * @param {string} errorMsg - The error message to check
 * @returns {boolean} True if the error is relaunchable
 */
function isRelaunchableError(errorMsg) {
  if (!errorMsg || typeof errorMsg !== 'string') {
    return false;
  }
  // Match the exact error message from handoff.js when final checkpoint has no evidence rows
  return errorMsg.includes('has a "## Goal Check" section but no evidence rows') &&
         errorMsg.includes('A goal-check table with real evidence is required before handoff');
}

/**
 * Build a relaunch prompt for an agent to fix a relaunchable error.
 *
 * @param {string} errorMsg - The error message from the failed handoff
 * @param {string} slug - Mission slug
 * @param {string} worktree - Path to the mission worktree
 * @returns {string} The relaunch prompt
 */
function buildRelaunchPrompt(errorMsg, slug, worktree) {
  const year = missionUtils.getMissionYear(slug, worktree);
  const missionDir = missionUtils.findMissionDir(slug, worktree) || missionUtils.missionDirForSlug(worktree, slug);
  
  return `Automated handoff failed for mission ${slug} with a repairable error: ${errorMsg}

` +
         `Please fix the final checkpoint document in ${missionDir} by adding a Goal Check table ` +
         `with real evidence rows (file:line references, test names). The Goal Check table must have ` +
         `a header row and at least one evidence row using pipe syntax (|).

` +
         `Steps:
` +
         `1. Open the final checkpoint document (CP-N.md) in ${missionDir}
` +
         `2. Add or update the "## Goal Check" section
` +
         `3. Create a markdown table with columns for: Goal Check description | Evidence | Status
` +
         `4. Add at least one evidence row with real file:line or test name references
` +
         `5. Commit the updated checkpoint with a descriptive commit message
` +
         `6. Re-run: node parallix review ${slug} --submit

` +
         `Example Goal Check table:
` +
         `| Goal Check | Evidence | Status |
` +
         `|---|---|---|
` +
         `| Final checkpoint has Goal Check section | docs/missions/${year}/${slug}/CP-1.md:15 | PASS |
` +
         `| Tests pass | npm test -- parallix/test/repair-handoff.test.js | PASS |

` +
         `Do NOT add placeholder or generic evidence. Each row must cite real, verifiable artifacts.`;
}

/**
 * Attempt to repair a failed automated handoff by auto-committing mission
 * artifacts or rebasing.
 *
 * @param {string} slug - Mission slug
 * @param {string} worktree - Path to the mission worktree
 * @param {string} errorMsg - The error message from the failed handoff
 * @param {object} [options]
 * @returns {Promise<{repaired: boolean, blocker: string|null}>} Result and optional blocker reason
 */
async function repairHandoff(slug, worktree, errorMsg, options = {}) {
  const {
    taskFile = null,
    gitFn = git,
    rebaseFn = rebase,
    log = fmt.log.plain,
    error = fmt.log.plainError
  } = options;

  const rootDir = worktree || process.cwd();
  let repaired = false;
  let blocker = null;

  function parsePorcelainPath(line) {
    const xy = line.slice(0, 2);
    const rawPath = line.slice(3).trim();
    const pathPart = rawPath.includes('->') ? rawPath.split('->').pop().trim() : rawPath;
    const cleanPath = (pathPart.startsWith('"') && pathPart.endsWith('"')) ? pathPart.slice(1, -1) : pathPart;
    return { xy, file: cleanPath };
  }

  // 0. Check if error is repairable
  const isDirtyError = errorMsg && (
    errorMsg.includes('is modified but uncommitted') ||
    errorMsg.includes('Commit the mission contract before handoff') ||
    errorMsg.includes('Commit the implementation evidence before handoff')
  );

  const isBehind = errorMsg && (
    errorMsg.includes('Updates were rejected') || 
    errorMsg.includes('fetch first') || 
    errorMsg.includes('non-fast-forward') ||
    errorMsg.includes('behind its remote') ||
    // Ensure we don't match generic git push failed unless it has non-fast-forward hints
    (errorMsg.includes('git push failed') && (
      errorMsg.includes('rejected') || 
      errorMsg.includes('remote contains work')
    ))
  );

  if (!isDirtyError && !isBehind) {
    log(`Handoff error is not automatically repairable: ${errorMsg}`);
    return { repaired: false, blocker: null };
  }

  // 1. Auto-commit mission artifacts if uncommitted
  if (isDirtyError || isBehind) {
    const statusResult = gitFn(['-C', rootDir, 'status', '--porcelain']);
    if (statusResult.status === 0 && statusResult.stdout) {
      const dirtyLines = statusResult.stdout.split('\n')
        .filter(line => line.trim().length > 0);

      const dirtyFilesWithStatus = dirtyLines.map(parsePorcelainPath);

      const unmerged = dirtyFilesWithStatus.filter(f => 
        ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(f.xy)
      );

      if (unmerged.length > 0) {
        blocker = `Conflicted files detected:\n${unmerged.map(f => `       - ${f.file}`).join('\n')}`;
        log(`Cannot auto-commit: ${blocker}`);
        return { repaired: false, blocker };
      }

      const dirtyFiles = dirtyFilesWithStatus.map(f => f.file);

      const isSafeToCommit = (file) =>
        missionUtils.isWorkflowGeneratedArtifact(file)
        || missionUtils.isMissionArtifact(file, slug, rootDir);

      const safeFiles = dirtyFiles.filter(isSafeToCommit);
      const unsafeFiles = dirtyFiles.filter(f => !isSafeToCommit(f));

      if (unsafeFiles.length > 0) {
        log(`Cannot auto-commit: dirty files include non-mission paths:`);
        unsafeFiles.forEach(f => log(`       - ${f}`));
        blocker = `dirty files include non-mission paths: ${unsafeFiles.join(', ')}`;
        return { repaired: false, blocker };
      } else if (safeFiles.length > 0) {
        log(`Auto-committing mission artifacts:`);
        const stageFailures = [];
        safeFiles.forEach(f => {
          log(`       - ${f}`);
          const addResult = gitFn(['-C', rootDir, 'add', '--', f]);
          if (addResult.status === 0) {
            return;
          } else {
            const failureText = [addResult.stderr, addResult.stdout].filter(Boolean).join('\n').trim();
            stageFailures.push(`${f}${failureText ? `: ${failureText}` : ''}`);
          }
        });
        if (stageFailures.length > 0) {
          blocker = `failed to stage mission artifacts: ${stageFailures.join(', ')}`;
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
    let rebaseError = null;
    try {
      const { getCurrentBranch } = require('../core/git');
      await rebaseFn([slug], {
        gitFn: (args, opts) => gitFn(args, { ...opts, cwd: rootDir }),
        getCurrentBranchFn: () => getCurrentBranch(rootDir),
        exitFn: (code) => {
          if (code === 0) {
            rebaseSuccess = true;
          } else {
            rebaseError = `rebase exited with code ${code}`;
          }
        }
      });
    } catch (err) {
      rebaseError = err.message;
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

module.exports = repairHandoff;
module.exports.isRelaunchableError = isRelaunchableError;
module.exports.buildRelaunchPrompt = buildRelaunchPrompt;
