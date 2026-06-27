const path = require('path');
const { detectRebaseState, git, getCurrentBranch } = require('../core/git');
const { resolveConflictsForMission } = require('./integrate');
const { findMissionDir, findMissionArea, inferSlug, resolveWorktree, conventionalWorktreePath, getPrimaryWorktree, getPrimaryBranch, resolveMissionBaseBranch, missionBranchName, missionDirForSlug } = require('../core/mission-utils');
const { startAgent } = require('../agents/agents');
  const { createPr, readToken, resolveForgejoUser, fetchReviewBranch } = require('../tools/forgejo');
const { resolveTaskFile, getTaskImplementer } = require('../tools/backlog');
const { resolveReviewIdentity } = require('../review/review-state');
const { isForgejoReviewEnabled } = require('../core/product-config');
const fmt = require('../core/fmt');
const { formatVerificationCommand } = require('../core/verification');

/**
 * Rebase a mission branch onto local master, auto-resolving mission-specific
 * conflicts and launching an agent for shared-file conflicts.
 *
 * Usage: px rebase [<slug>] [--push]
 */
/** @param {string[]} args @param {{inferSlugFn?: Function, findMissionDirFn?: Function, findMissionAreaFn?: Function, getCurrentBranchFn?: Function, resolveConflictsFn?: Function, startAgentFn?: Function, createPrFn?: Function, readTokenFn?: Function, resolveForgejoUserFn?: Function, resolveTaskFileFn?: Function, getTaskImplementerFn?: Function, detectRebaseStateFn?: Function, resolveMissionBaseBranchFn?: Function, gitFn?: Function, exitFn?: Function, isForgejoReviewEnabledFn?: Function, fetchReviewBranchFn?: Function}} opts */
async function rebase(args, {
  inferSlugFn = inferSlug,
  findMissionDirFn = findMissionDir,
  findMissionAreaFn = findMissionArea,
  getCurrentBranchFn = getCurrentBranch,
  resolveConflictsFn = resolveConflictsForMission,
  startAgentFn = startAgent,
  createPrFn = createPr,
  readTokenFn = readToken,
  resolveForgejoUserFn = resolveForgejoUser,
  resolveTaskFileFn = resolveTaskFile,
  getTaskImplementerFn = getTaskImplementer,
  detectRebaseStateFn = detectRebaseState,
  resolveMissionBaseBranchFn = resolveMissionBaseBranch,
  gitFn = git,
  exitFn = (/** @type{number} */ code) => process.exit(code),
  isForgejoReviewEnabledFn = isForgejoReviewEnabled,
  fetchReviewBranchFn = fetchReviewBranch,
} = {}) {
  const flags = args.filter(a => a.startsWith('--'));
  const params = args.filter(a => !a.startsWith('--'));
  const isPush = flags.includes('--push');
  const explicitSlug = params[0];
  const slug = inferSlugFn(explicitSlug);
  if (!slug) {
    fmt.log.fail('Usage: px rebase [<slug>] [--push]');
    exitFn(1);
    return;
  }

  const missionDir = findMissionDirFn(slug);
  const area = missionDir ? findMissionAreaFn(missionDir) : 'docs';
  const branch = missionBranchName(slug);

  const existingRebase = detectRebaseStateFn(process.cwd());
  if (existingRebase.inProgress) {
    fmt.log.fail(`Rebase already in progress for ${fmt.branch(branch)}.`);
    if (existingRebase.rebaseHead) {
      fmt.log.info(`Current rebase head: ${existingRebase.rebaseHead}`);
    }
    if (existingRebase.unmergedFiles.length > 0) {
      fmt.log.info('Unmerged files:');
      existingRebase.unmergedFiles.forEach((/** @type {string} */ file) => fmt.log.info(`  - ${file}`));
    }
    fmt.log.info('Recovery commands:');
    fmt.log.info(`  ${fmt.command('git rebase --continue')}`);
    fmt.log.info(`  ${fmt.command('git rebase --abort')}`);
    fmt.log.info(`  ${fmt.command('git rebase --skip')}`);
    exitFn(1);
    return;
  }

  const performPush = async () => {
    if (!isPush) {return;}
    if (!isForgejoReviewEnabledFn(process.cwd())) {
      fmt.log.info(`Skipping Forgejo push (review provider is not forgejo).`);
      return;
    }
    fmt.log.info(`--push detected. Updating Forgejo PR for ${fmt.branch(branch)}...`);

    const reviewIdentity = resolveReviewIdentity(slug, resolveWorktree(slug) || process.cwd());
    let forgejoUser = reviewIdentity.forgejoUser;
    if (!forgejoUser) {
      const taskResolution = resolveTaskFileFn(slug, getPrimaryWorktree());
      if (taskResolution.ok) {
        forgejoUser = getTaskImplementerFn(taskResolution.taskFile);
      }
    }
    forgejoUser = resolveForgejoUserFn(forgejoUser);

    const token = readTokenFn(forgejoUser || 'default');
    if (!token) {
      fmt.log.fail(`No Forgejo token found for user "${fmt.agent(forgejoUser || 'default')}". Push failed.`);
      exitFn(1);
      return;
    }
    const result = createPrFn(branch, forgejoUser || 'default', token, { rootDir: getPrimaryWorktree(), forceWithLease: true });
    if (!result.ok) {
      fmt.log.fail(`Push to Forgejo failed: ${result.error}`);
      exitFn(1);
      return;
    }
    fmt.log.pass(`Branch pushed and PR updated for ${fmt.branch(branch)}.`);
  };

  // Verify we are on the correct branch
  const currentBranch = getCurrentBranchFn();
  if (currentBranch !== branch) {
    fmt.log.fail(`Expected branch ${fmt.branch(branch)}, found ${fmt.branch(currentBranch)}`);
    fmt.log.info(`Switch to the mission branch first: ${fmt.command(`git checkout ${branch}`)}`);
    exitFn(1);
    return;
  }

  // Honor the mission's recorded base branch (a feature-branch mission rebases
  // onto its base, e.g. skunkworks — not the primary branch). Falls back to the
  // primary branch for every mission without a recorded Base-Branch.
  const baseBranch = resolveMissionBaseBranchFn(slug, process.cwd(), { gitFn });
  fmt.log.info(`Rebasing ${fmt.branch(branch)} onto local ${fmt.branch(baseBranch)}...`);
  const rebaseResult = gitFn(['-c', 'core.editor=true', '-c', 'merge.autoedit=no', 'rebase', baseBranch]);

  // Rebase succeeded (status 0) or was already up to date
  // Also handle "Already up to date" variants
  if (rebaseResult.status === 0 || /up to date|Already up to date/i.test(rebaseResult.stdout + rebaseResult.stderr)) {
    const rebaseStatus = gitFn(['rebase', '--show-current']);
    // If no rebase is in progress, we're done
    const rebaseInProg = rebaseStatus.stdout.trim().length > 0;
    if (rebaseInProg) {
      // rebase --show-current returned something but status was 0 — treat as incomplete
      fmt.log.pass('Rebase round completed.');
      fmt.log.warn('Rebase is still in progress (non-empty --show-current). Skipping automatic push.');
      fmt.log.info(`Next: ${fmt.command(formatVerificationCommand(area, process.cwd()))}`);
      fmt.log.info(`Next: ${fmt.command('git rebase --continue')}`);
      exitFn(0);
      return;
    }

    fmt.log.pass('Rebase completed cleanly.');
    await performPush();
    fmt.log.info(`Next: ${fmt.command(formatVerificationCommand(area, process.cwd()))}`);
    fmt.log.info(`Next: ${fmt.command(`px integrate ${slug} --dry-run`)}`);
    exitFn(0);
    return;
  }

  // Rebase paused on conflicts — classify and resolve
  const rebaseOutput = [rebaseResult.stdout, rebaseResult.stderr].filter(Boolean).join('\n').trim();

  // Check if this is actually a conflict (contains CONFLICT lines) or another error
  // Also handle localized output (e.g. Swedish "KONFLIKT")
  const isConflict = /CONFLICT|KONFLIKT/i.test(rebaseOutput);
  if (!isConflict) {
    fmt.log.fail('Rebase failed with a non-conflict error.');
    if (rebaseOutput) {
      fmt.log.fail('--- Git Output ---');
      fmt.log.fail(rebaseOutput);
      fmt.log.fail('------------------');
    }
    if (rebaseResult.status === 128) {
      fmt.log.fail('Hint: This might be a repository lock or an invalid upstream branch.');
    } else if (rebaseOutput.toLowerCase().includes('pre-commit') || rebaseOutput.toLowerCase().includes('hook')) {
      fmt.log.fail('Hint: A git hook failed. Fix the issues reported above and try again.');
    }
    fmt.log.fail(`Recovery: ${fmt.command('git rebase --abort')}`);
    exitFn(1);
    return;
  }

  fmt.log.warn('Rebase paused on conflicts. Classifying...');

  // Resolve the worktree for conflict classification
  const rootDir = getPrimaryWorktree();
  const worktreePath = resolveWorktree(slug) || conventionalWorktreePath(slug, rootDir);

  /** @type{{worktreePathOverride?: string}} */
  const conflictOpts = { worktreePathOverride: worktreePath };
  const conflictResult = resolveConflictsFn(slug, area, conflictOpts);

  // When rebase is in progress in the worktree, dry merge may fail.
  // Fall back to parsing the rebase output directly.
  if (conflictResult.ok === false && conflictResult.error === 'merge-failed') {
    fmt.log.info('Dry merge failed (rebase in progress). Parsing rebase output directly...');
    // Prefer git status --porcelain (authoritative index entries) over localized
    // rebase text, which can contain advice prefixes that parse as false paths.
    const statusFiles = parseConflictFilesFromGitStatus(worktreePath, gitFn);
    const conflictFiles = statusFiles.length > 0
      ? statusFiles
      : parseConflictFilesFromRebaseOutput(rebaseOutput);

    // Classify using mission-specific patterns
    const missionAbsDir = findMissionDir(slug, worktreePath);
    const missionDocPrefix = missionAbsDir
      ? (require('path').relative(worktreePath, missionAbsDir) + '/')
      : path.relative(worktreePath, missionDirForSlug(worktreePath, slug)).split(path.sep).join('/') + '/';
    const taskPattern = new RegExp(`backlog/(?:tasks|completed)/[^/]*${slug}`);
    const missionSpecificFiles = conflictFiles.filter(f =>
      f.startsWith(missionDocPrefix) || taskPattern.test(f)
    );
    const sharedFiles = conflictFiles.filter(f => !missionSpecificFiles.includes(f));

    Object.assign(conflictResult, {
      ok: true,
      conflictFiles,
      missionSpecificFiles,
      sharedFiles,
    });
  } else if (!conflictResult.ok) {
    /** @type{{error?: string}} */
    const cr = conflictResult;
    if (cr.error === 'worktree-missing') {
      fmt.log.fail(`Mission worktree not found: ${fmt.path(worktreePath)}`);
      fmt.log.info(`Ensure the worktree is registered: ${fmt.command(`git worktree add ${conventionalWorktreePath(slug, getPrimaryWorktree())} ${branch}`)}`);
      exitFn(1);
      return;
    }
    fmt.log.fail('Conflict detection failed.');
    fmt.log.info(`Check rebase state: ${fmt.command('git status')}`);
    exitFn(1);
    return;
  }

  // No conflicts detected by classification but rebase reported CONFLICT —
  // fall through to shared-file handling with whatever git reports
  const conflictFiles = conflictResult.conflictFiles.length > 0
    ? conflictResult.conflictFiles
    : parseConflictFilesFromRebaseOutput(rebaseOutput);

  // Only treat unclassified conflict files as shared-file conflicts
  if (conflictResult.sharedFiles.length === 0 && conflictFiles.length > 0) {
    const classified = new Set([...conflictResult.missionSpecificFiles]);
    const unclassified = conflictFiles.filter((/** @type {string} */ f) => !classified.has(f));
    if (unclassified.length > 0) {
      conflictResult.sharedFiles = unclassified;
    }
  }

  // All conflicts are mission-specific — auto-resolve with --theirs
  if (conflictResult.sharedFiles.length === 0) {
    fmt.log.info(`All ${conflictResult.missionSpecificFiles.length} conflict(s) are mission-specific. Auto-resolving...`);
    const maxContinueAttempts = 3;
    let continueAttempts = 0;
    /** @param {{stdio?: string}} opts */
    const continueRebase = (/** @type {{stdio?: string}} */ opts = {}) => {
      continueAttempts += 1;
      return gitFn(['-c', 'core.editor=true', '-c', 'merge.autoedit=no', 'rebase', '--continue'], opts);
    };
    /** @param {{stdout: string, stderr: string, status: number}} result */
    const reportContinueFailure = (result) => {
      const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
      fmt.log.fail(`git rebase --continue failed (status ${result.status}).`);
      if (output) {
        fmt.log.fail('--- Git Output ---');
        fmt.log.fail(output);
        fmt.log.fail('------------------');
      }
      if (output.toLowerCase().includes('pre-commit') || output.toLowerCase().includes('hook')) {
        fmt.log.fail('Hint: A git hook failed. Fix the issues reported above.');
      }
      fmt.log.fail(`Check rebase state: ${fmt.command('git status')}`);
      fmt.log.fail(`Recovery: ${fmt.command('git rebase --abort')}`);
    };

    /** @param {string} branchName */
    const failContinueBudget = (branchName) => {
      fmt.log.fail(`Rebase still in progress on branch ${fmt.branch(branchName || slug)} after ${continueAttempts} failed --continue attempt(s).`);
      fmt.log.fail(`Check rebase state: ${fmt.command('git status')}`);
      fmt.log.fail(`Next: ${fmt.command('git rebase --continue')}`);
      fmt.log.fail(`If the current commit is empty: ${fmt.command('git rebase --skip')}`);
      fmt.log.fail(`If recovery is needed: ${fmt.command('git rebase --abort')}`);
      exitFn(1);
    };

    for (const file of conflictResult.missionSpecificFiles) {
      fmt.log.info(`Resolving: ${fmt.path(file)}`);
      const checkoutResult = gitFn(['checkout', '--theirs', file]);
      if (checkoutResult.status !== 0) {
        // Try add -u as fallback (file may have been added/deleted)
        gitFn(['add', file]);
      }
      const addResult = gitFn(['add', file]);
      if (addResult.status !== 0) {
        fmt.log.warn(`Could not add ${fmt.path(file)} for rebase continue.`);
      }
    }

    fmt.log.info('Continuing rebase...');
    let rebaseCompleted = false;
    const continueResult = continueRebase();
    if (continueResult.status !== 0) {
      // Might have pre-commit hook or editor — check for more conflicts
      const moreOutput = [continueResult.stdout, continueResult.stderr].filter(Boolean).join('\n').trim();
      if (/CONFLICT|KONFLIKT/i.test(moreOutput)) {
        fmt.log.info('More conflicts found. Re-running classification...');
        // Recurse once more for chained conflicts, preserving flags and options
        await rebase(args, {
          inferSlugFn,
          findMissionDirFn,
          findMissionAreaFn,
          getCurrentBranchFn,
          resolveConflictsFn,
          startAgentFn,
          createPrFn,
          readTokenFn,
          resolveForgejoUserFn,
          resolveTaskFileFn,
          getTaskImplementerFn,
          gitFn,
          exitFn,
          isForgejoReviewEnabledFn,
        });
        return;
      }
      // Could be editor opening — check if rebase is still in progress
      const statusResult = gitFn(['status', '--porcelain']);
      if (statusResult.stdout.trim()) {
        fmt.log.info('More changes detected. Continuing rebase...');
        gitFn(['add', '-A']);
        if (continueAttempts >= maxContinueAttempts) {
          const rebaseCheck = gitFn(['rebase', '--show-current']);
          failContinueBudget(rebaseCheck.stdout.trim());
          return;
        }
        const cont2 = continueRebase();
        if (cont2.status !== 0) {
          // Verify whether a rebase is still in progress
          const rebaseCheck = gitFn(['rebase', '--show-current']);
          if (rebaseCheck.stdout.trim().length > 0) {
            if (continueAttempts >= maxContinueAttempts) {
              failContinueBudget(rebaseCheck.stdout.trim());
            } else {
              reportContinueFailure(cont2);
              exitFn(1);
            }
            return;
          }
          reportContinueFailure(cont2);
          exitFn(1);
          return;
        }
        rebaseCompleted = true;
      } else {
        // No staged changes and --continue failed but no conflict — rebase may have completed
        const rebaseCheck = gitFn(['rebase', '--show-current']);
        if (rebaseCheck.stdout.trim().length === 0) {
          rebaseCompleted = true;
        } else {
          // Rebase still in progress with no unresolved conflicts: likely a hook
          // failure or empty pick. Retry --continue with GIT_EDITOR=true to avoid
          // spawning an interactive editor.
          fmt.log.info('No unresolved conflicts; rebase still in progress. Retrying --continue (hook/empty-pick)...');
          if (continueAttempts >= maxContinueAttempts) {
            failContinueBudget(slug);
            return;
          }
          const retryResult = continueRebase();
          if (retryResult.status !== 0) {
            const retryOutput = [retryResult.stdout, retryResult.stderr].filter(Boolean).join('\n').trim();
            if (/CONFLICT|KONFLIKT/i.test(retryOutput)) {
              fmt.log.info('More conflicts found after retry. Re-running classification...');
              await rebase(args, {
                inferSlugFn,
                findMissionDirFn,
                findMissionAreaFn,
                getCurrentBranchFn,
                resolveConflictsFn,
                startAgentFn,
                createPrFn,
                readTokenFn,
                resolveForgejoUserFn,
                fetchReviewBranchFn,
                resolveTaskFileFn,
                getTaskImplementerFn,
                gitFn,
                exitFn,
                isForgejoReviewEnabledFn,
              });
              return;
            }
            // Another empty-pick or hook — verify again
            const recheck = gitFn(['rebase', '--show-current']);
            if (recheck.stdout.trim().length > 0) {
              fmt.log.info('Empty pick detected; continuing to next commit...');
              if (continueAttempts >= maxContinueAttempts) {
                failContinueBudget(recheck.stdout.trim());
                return;
              }
              const cont3 = continueRebase();
              if (cont3.status === 0) {
                rebaseCompleted = true;
              } else {
                const recheck2 = gitFn(['rebase', '--show-current']);
                if (recheck2.stdout.trim().length === 0) {
                  rebaseCompleted = true;
                } else {
                  if (continueAttempts >= maxContinueAttempts) {
                    failContinueBudget(recheck2.stdout.trim());
                  } else {
                    reportContinueFailure(cont3);
                    exitFn(1);
                  }
                  return;
                }
              }
            } else {
              rebaseCompleted = true;
            }
          } else {
            rebaseCompleted = true;
          }
        }
      }
    } else {
      rebaseCompleted = true;
    }

    if (rebaseCompleted) {
      fmt.log.pass('Mission-specific conflicts resolved. Rebase completed.');
      await performPush();
      fmt.log.info(`Next: ${fmt.command(formatVerificationCommand(area, process.cwd()))}`);
      fmt.log.info(`Next: ${fmt.command(`px integrate ${slug} --dry-run`)}`);
      exitFn(0);
      return;
    }
  }

  // Shared-file conflicts exist — launch agent to resolve them
  fmt.log.info(`${conflictResult.sharedFiles.length} shared file(s) require agent-assisted resolution:`);
  conflictResult.sharedFiles.forEach((/** @type {string} */ f) => fmt.log.info(`  - ${fmt.path(f)}`));

  const prompt = buildRebasePrompt({
    slug,
    area,
    worktreePath,
    missionSpecificFiles: conflictResult.missionSpecificFiles,
    sharedFiles: conflictResult.sharedFiles,
    gitFn: /** @type{Function} */(gitFn),
  });

  fmt.log.info('Launching agent for conflict resolution...');
  const { agent, result: agentResult } = await startAgentFn('conflict-resolution', {
    prompt,
    worktree: worktreePath,
  });

  if (agentResult.status !== 0) {
    fmt.log.fail(`Agent (${fmt.agent(agent)}) exited with status ${agentResult.status}.`);
    fmt.log.info(`You may need to abort the rebase: ${fmt.command('git rebase --abort')}`);
    exitFn(agentResult.status || 1);
    return;
  }

  // Verify rebase is actually complete before pushing
  const finalRebaseCheck = gitFn(['rebase', '--show-current']);
  if (finalRebaseCheck.stdout.trim().length > 0) {
    fmt.log.pass(`Agent (${fmt.agent(agent)}) completed their round.`);
    fmt.log.warn('Rebase is still in progress. Skipping automatic push.');
    fmt.log.info('Next: Resolve remaining conflicts or continue rebase.');
    exitFn(0);
    return;
  }

  fmt.log.pass(`Agent (${fmt.agent(agent)}) completed conflict resolution.`);
  await performPush();
  fmt.log.info(`Next: ${fmt.command(formatVerificationCommand(area, process.cwd()))}`);
  fmt.log.info(`Next: ${fmt.command(`px integrate ${slug} --dry-run`)}`);
  exitFn(0);
}

/**
 * Parse conflict file paths from git status --porcelain output
 * when a rebase is in progress. Handles all unmerged states:
 * UU (unmerged), DU/UD (modify/delete), AU/UA (add/add), AA (add/add).
 */
/** @param {string} worktreePath @param {Function} gitFn */
function parseConflictFilesFromGitStatus(worktreePath, gitFn) {
  const statusResult = gitFn(['-C', worktreePath, 'status', '--porcelain']);
  const files = [];
  const unmergedStates = new Set(['UU', 'DU', 'UD', 'AU', 'UA', 'AA']);
  for (const line of (statusResult.stdout || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) {continue;}
    const match = trimmed.match(/^([A-Z]{2})\s+(.+)$/);
    if (match) {
      const code = match[1];
      if (!unmergedStates.has(code)) {continue;}
      let file = match[2].trim();
      // Remove surrounding quotes if present
      if ((file.startsWith('"') && file.endsWith('"')) || (file.startsWith("'") && file.endsWith("'"))) {
        file = file.slice(1, -1);
      }
      if (file) {files.push(file);}
    }
  }
  return [...new Set(files)];
}

/**
 * Parse conflict file paths from git rebase output.
 * Similar to parseConflictFilesFromMergeOutput but handles rebase-specific output.
 */
/** @param {string} output */
function parseConflictFilesFromRebaseOutput(output) {
  const seen = new Set();
  const files = [];
  for ( const line of output.split('\n')) {
    if (!/CONFLICT|KONFLIKT/i.test(line)) {continue;}
    // English: "Merge conflict in <file>"
    const inMatch = line.match(/Merge conflict in (.+)$/);
    if (inMatch) {
      let f = inMatch[1].trim();
      // Strip modify/delete description (e.g. ": deleted by master, modified by HEAD")
      f = f.replace(/\s*:\s*(deleted|modified|added|removed|renamed|both|ours|yours|theirs|by\s*\w+,\s*(modified|deleted)\b).*$/i, '').trim();
      if (f && !seen.has(f)) { seen.add(f); files.push(f); }
      continue;
    }
    // Swedish: "Sammanslagningskonflikt i <file>"
    const svMatch = line.match(/Sammanslagningskonflikt\s+i\s+(.+)$/);
    if (svMatch) {
      let f = svMatch[1].trim();
      // Strip modify/delete description (e.g. ": deleted/raderad av master, modified/ändrad av HEAD")
      f = f.replace(/\s*:\s*(deleted|modified|added|removed|renamed|both|ours|yours|theirs|raderad|ändrad|lagd till|borttagen|by|av|av\s*\w+,\s*(modified|ändrad|deleted|raderad)\b).*$/i, '').trim();
      if (f && !seen.has(f)) { seen.add(f); files.push(f); }
      continue;
    }
   // Swedish modify/delete: "KONFLIKT (ändra/radera): <file> raderad i <commit> ... och ändrad i HEAD"
     const svModDelMatch = line.match(/^KONFLIKT\s+\(ändra\/radera\)\s*:\s*(.+)$/i);
     if (svModDelMatch) {
       let f = svModDelMatch[1].trim();
       // Strip trailing "Versionen HEAD av <file> lämnad i trädet." sentence (real git output)
       // Must come before raderad/ändrad stripping since the trailing sentence contains "ändrad"
       f = f.replace(/\s+Versionen\s+HEAD[\s\S]*$/i, '').trim();
       // Strip "raderad i <commit> ... och ändrad i HEAD" (Swedish modify/delete description)
       f = f.replace(/\s+raderad\s+i\s+\S+(?:\s*\([^)]*\))?\s+(?:och|and)\s+ändrad\s+i\s+\S+\.?\s*$/i, '').trim();
       // Also handle "raderad i <commit> och ändrad i HEAD" without trailing period
       f = f.replace(/\s+raderad\s+i\s+\S+(?:\s*\([^)]*\))?\s+och\s+ändrad\s+i\s+\S+\s*$/i, '').trim();
       if (f && !seen.has(f)) { seen.add(f); files.push(f); }
       continue;
     }

    // Generic: try to extract a file path from the line using colon-delimited segments.
    // Common patterns:
    //   "CONFLICT (content): Merge conflict in <file>"  -> handled above
    //   "<file>: <description>"                          -> generic fallback
    //   "CONFLICT (content): <file>: <description>"      -> nested colons
    //   "CONFLICT (modify/delete): <file>: deleted by ..., modified by ..." -> modify/delete
    //   "CONFLICT (modify/delete): <file>: ..."          -> modify/delete header
    const colonIdx = line.indexOf(':');
    if (colonIdx !== -1) {
      const beforeColon = line.slice(0, colonIdx).trim();
      const afterColon = line.slice(colonIdx + 1).trim();
      const isNonPathPrefix = /^(CONFLICT|KONFLIKT|CONFLICTS|Merge conflict|Sammanslagningskonflikt|Automatic merge|Auto-merging|resolved|merged|deleted|added|changed|modified|rejected|skipped|dropped|superseded|discarded|kept|stashed|applied|already|would|both|ours|yours|their|his|her|its|your|my|us|we|they|he|she|it|a|an|the|but|and|or|for|nor|not|so|yet)\b/i.test(beforeColon);
      if (!isNonPathPrefix) {
        // Skip known advice/hint labels — the rest of the line is not a path.
        if (/^(tips|hint|note)\b/i.test(beforeColon)) {continue;}
        const f = beforeColon;
        if (f && !seen.has(f)) { seen.add(f); files.push(f); }
      } else if (afterColon) {
        // Skip the prefix and look for a path after the first colon.
        // If there's a second colon, take the segment before it as the path.
        const secondColonIdx = afterColon.indexOf(':');
        if (secondColonIdx !== -1) {
          let f = afterColon.slice(0, secondColonIdx).trim();
          // Strip modify/delete description (e.g. ": deleted by master, modified by HEAD")
          f = f.replace(/\s*:\s*(deleted|modified|added|removed|renamed|both|ours|yours|theirs|raderad|ändrad|lagd till|borttagen|by|av|av\s*\w+,\s*(modified|ändrad|deleted|raderad)\b).*$/i, '');
          f = f.trim();
          if (f && !seen.has(f)) { seen.add(f); files.push(f); }
        } else {
          // No second colon — take everything after the first colon as the path.
          const f = afterColon;
          if (f && !seen.has(f)) { seen.add(f); files.push(f); }
        }
      }
    }
  }
  return files;
}

/**
 * Build the prompt for the agent during shared-file conflict resolution.
 */
/** @param {{slug: string, area: string, worktreePath: string, missionSpecificFiles: string[], sharedFiles: string[], gitFn?: Function}} opts */
function buildRebasePrompt({ slug, area, worktreePath, missionSpecificFiles, sharedFiles, gitFn = /** @type {Function | undefined} */ (undefined) }) {
  const missionFileCommands = missionSpecificFiles
    .map(f => `  git checkout --theirs "${f}" && git add "${f}"`)
    .join('\n');
  const sharedFileList = sharedFiles.map(f => `  - ${f}`).join('\n');

  let primaryBranch = 'main';
  try {
    primaryBranch = resolveMissionBaseBranch(slug, worktreePath, { gitFn });
  } catch (_) {
    try {
      primaryBranch = getPrimaryBranch(worktreePath, gitFn);
    } catch (_e) {
      primaryBranch = 'main';
    }
  }

  return [
    'Mode: rebase conflict-resolution.',
    '',
    `Mission: ${slug}`,
    `Mission worktree: ${worktreePath}`,
    '',
    `Rebase onto ${primaryBranch} paused on conflicts.`,
    '',
    'Step 1 — Resolve mission-specific conflicts (--theirs):',
    missionFileCommands.length > 0
      ? missionFileCommands
      : '  (none — all conflicts are shared files)',
    '',
    'Step 2 — Resolve shared-file conflicts:',
    sharedFileList,
    '',
    'Step 3 — After resolving each shared file:',
    '  git add <resolved-files>',
    '  git rebase --continue',
    '',
    'Step 4 — Repeat Steps 1-3 until rebase completes.',
    '',
    'Step 5 — Verify:',
    `  ${formatVerificationCommand(area, worktreePath)}`,
    `  px integrate ${slug} --dry-run`,
    '',
    'Rules:',
    '- Take --theirs for every mission-specific file listed above.',
    '- For shared files, inspect the conflict markers and resolve sensibly.',
    '- If rebase pauses again, repeat the process.',
    '- If any command fails, stop and report the failure.',
  ].join('\n');
}

module.exports = rebase;
module.exports.buildRebasePrompt = buildRebasePrompt;
module.exports.parseConflictFilesFromRebaseOutput = parseConflictFilesFromRebaseOutput;
module.exports.parseConflictFilesFromGitStatus = parseConflictFilesFromGitStatus;
