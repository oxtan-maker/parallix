// @ts-nocheck
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as git from '../core/git.js';
import * as missionUtils from '../core/mission-utils.js';
import * as backlog from '../tools/backlog.js';
import * as forgejo from '../tools/forgejo.js';
import { resolveReviewIdentity } from '../review/review-state.js';
import * as setupReview from '../tools/setup-review.js';
import * as gatekeeper from '../tools/gatekeeper.js';
import * as fmt from '../core/fmt.js';
import { runVerificationGate } from '../core/verification.js';
import { isForgejoReviewEnabled } from '../core/product-config.js';
import { rebaseBeforeReviewRound } from '../review/rebase.js';
import * as nels from '../core/nels.js';

/**
  * Verifies that the current environment is ready for handoff.
  *
  * @param {string} slug - Mission slug
  * @param {{worktree?: string}} [options]
  * @returns {{ ok: boolean, error?: string, missionDir?: string, area?: string, branch?: string, rootDir?: string }}
  */
 function verifyHandoff(slug, options = {}) {
   /** @type{{worktree?: string}} */
   const opts = options;
   const rootDir = opts.worktree || process.cwd();
  const missionDir = missionUtils.findMissionDir(slug, rootDir);
  if (!missionDir) {
    return { ok: false, error: `Mission directory not found for slug: ${slug}` };
  }

  const area = missionUtils.findMissionArea(missionDir);
  const branch = missionUtils.missionBranchName(slug, rootDir);
  const current = git.getCurrentBranch(rootDir);

  if (current !== branch) {
    return { ok: false, error: `Not on mission branch. Current: ${current}, Expected: ${branch}` };
  }

  const missionMdPath = path.join(missionDir, 'MISSION.md');
  if (!fs.existsSync(missionMdPath)) {
    return { ok: false, error: `MISSION.md not found at ${missionMdPath}. The mission contract must exist before handoff.` };
  }

  return { ok: true, missionDir, area, branch, rootDir };
}

/**
  * Performs the handoff process for a mission:
  * 1. Runs the verification gate.
  * 2. Syncs primary branch and pushes the mission branch to Forgejo, creating or updating the PR.
  * 3. Transitions Backlog task to 'review'.
  * 4. Commits and pushes the Backlog state change to Forgejo.
  *
  * @param {string} slug - Mission slug
  * @param {{skipGate?: boolean, worktree?: string|null, force?: boolean, forceWithLease?: boolean, log?: Function, error?: Function, rebaseFn?: Function, isForgejoReviewEnabledFn?: Function}} [options]
  * @returns {Promise<{ ok: boolean, error?: string, gatekeeperPushedBack?: boolean }>}
  */
 async function performHandoff(slug, options = {}) {
   /** @type{{skipGate?: boolean, worktree?: string|null, force?: boolean, forceWithLease?: boolean, log?: Function, error?: Function, rebaseFn?: Function, isForgejoReviewEnabledFn?: Function}} */
   const opts = options;
   const {
     skipGate = false,
     worktree = null,
     force = false,
     forceWithLease = true,
     log = fmt.log.info,
     error = fmt.log.fail,
     rebaseFn = rebaseBeforeReviewRound
   } = opts;

   const verification = verifyHandoff(slug, { worktree: worktree || undefined });
  if (!verification.ok) {
    error(verification.error);
    return { ok: false, error: verification.error };
  }

  const { area, branch, missionDir } = verification;
  const rootDir = /** @type {string} */(verification.rootDir);
  const missionDirPath = /** @type {string} */(missionDir);

  // Step 0: Resolve Backlog task for identity derivation
  const taskResolution = backlog.resolveTaskFile(slug, rootDir);
  if (!taskResolution.ok) {
    const msg = `Backlog task file for ${fmt.slug(slug)} not found or ambiguous: ${taskResolution.reason}.`;
    error(msg);
    return { ok: false, error: msg };
  }

  // Pre-handoff Content Integrity Check
  const relativeMissionPath = path.relative(rootDir, path.join(missionDirPath, 'MISSION.md'));
  const dirtyFiles = git.getWorktreeStatus(rootDir);
  let checkpoints = missionUtils.findCheckpoints(missionDirPath);

  if (dirtyFiles.some(line => line.endsWith(relativeMissionPath))) {
    const msg = `${fmt.path('MISSION.md')} is modified but uncommitted at ${fmt.path(relativeMissionPath)}. Commit the mission contract before handoff.`;
    error(msg);
    return { ok: false, error: msg };
  }

  if (checkpoints.length === 0) {
    // Auto-remediation (task-1228): rather than hard-failing when no checkpoint
    // document exists, generate a minimal default CP-1.md with a valid Goal Check
    // table so the handoff can proceed without manual intervention. The generated
    // file is clearly marked as auto-generated for reviewer awareness, then we
    // re-scan to confirm it is discoverable via findCheckpoints().
    const autoCheckpointPath = path.join(missionDirPath, 'CP-1.md');
    fs.writeFileSync(autoCheckpointPath, buildAutoCheckpointContent(slug), 'utf8');
    log(fmt.status('WARN', `No checkpoint documents found — auto-generated ${fmt.path('CP-1.md')} in ${fmt.path(missionDirPath)}.`));

    checkpoints = missionUtils.findCheckpoints(missionDirPath);
    if (checkpoints.length === 0) {
      const msg = `No checkpoint documents found in ${fmt.path(missionDirPath)} even after auto-remediation. Implementation evidence is mandatory for review.`;
      error(msg);
      return { ok: false, error: msg };
    }

    // Commit the auto-generated checkpoint so it is included in the handoff push
    // and does not trip the uncommitted-checkpoint check below.
    git.git(['-C', rootDir, 'add', autoCheckpointPath]);
    const commitRes = git.git(['-C', rootDir, 'commit', '-m', `docs(${slug}): auto-generate CP-1.md checkpoint (handoff remediation)`]);
    if (commitRes.status !== 0) {
      log(fmt.status('WARN', `Could not commit auto-generated CP-1.md for ${fmt.slug(slug)}; continuing handoff.`));
    }
  }

  /** @type {string} */
  const finalCheckpoint = checkpoints[checkpoints.length - 1];
  const relativeCheckpointPath = path.relative(rootDir, finalCheckpoint);
  if (dirtyFiles.some(line => line.endsWith(relativeCheckpointPath))) {
    const msg = `The latest checkpoint document is modified but uncommitted at ${fmt.path(relativeCheckpointPath)}. Commit the implementation evidence before handoff.`;
    error(msg);
    return { ok: false, error: msg };
  }

  // Pre-handoff Content Integrity Check: final checkpoint must contain a Goal Check table
  // with real evidence. Per review.md step 5, a missing or empty goal-check table
  // means the checkpoint has not satisfied the mission's evidence requirement.
  // Accept both `## Goal Check` and `## Goal Check Table` heading variants used across repo artifacts.
  const checkpointContent = fs.readFileSync(finalCheckpoint, 'utf8');
  const goalCheckMatch = checkpointContent.match(/^## Goal Check(?: Table)?\s*$/m);
  if (!goalCheckMatch) {
    const msg = `The final checkpoint at ${fmt.path(relativeCheckpointPath)} is missing a "## Goal Check" section. Review requires a goal-check table with real evidence before handoff.`;
    error(msg);
    return { ok: false, error: msg };
  }

  // Verify the goal-check table has at least one row of evidence (table row after header).
  // Must exclude table separator rows (|---|---|---|) and the header row itself —
  // only real evidence rows (with pipe-separated content that is not all dashes) count.
  const goalCheckMatchIndex = goalCheckMatch.index ?? 0;
  const afterHeader = checkpointContent.slice(goalCheckMatchIndex + goalCheckMatch[0].length);
  const separatorPattern = /^\|\s*:?-+:?\s*\|/;
  const headerPattern = /^\| .+\| .+\| .+\|$/;
  const evidenceLinePattern = /^\| .+\| .+\| .+\|$/;
  const linesAfterHeader = afterHeader.split('\n');
  let foundEvidence = false;
  let pastHeader = false;
  for (const line of linesAfterHeader) {
    const trimmed = line.trim();
    if (trimmed === '') {continue;}
    if (!pastHeader && headerPattern.test(trimmed)) {
      pastHeader = true;
      continue;
    }
    if (separatorPattern.test(trimmed)) {continue;}
    if (pastHeader && evidenceLinePattern.test(trimmed)) {
      foundEvidence = true;
      break;
    }
    // Non-empty, non-separator, non-evidence row after header = no valid table
    break;
  }
  if (!foundEvidence) {
    const msg = `The final checkpoint at ${fmt.path(relativeCheckpointPath)} has a "## Goal Check" section but no evidence rows. A goal-check table with real evidence is required before handoff.`;
    error(msg);
    return { ok: false, error: msg };
  }

  const isForgejoReviewEnabledFn = opts.isForgejoReviewEnabledFn || isForgejoReviewEnabled;
  const forgejoEnabled = isForgejoReviewEnabledFn(rootDir);

  const { forgejoUser: reviewStateUser } = resolveReviewIdentity(slug, rootDir, {
  });
  const forgejoUser = reviewStateUser || backlog.getTaskImplementer(/** @type {string} */(taskResolution.taskFile));

  if (!forgejoUser) {
    error('forgejoUser is required for performHandoff. Ensure review-state.json or the Backlog task has an agent family assigned.');
    return { ok: false, error: 'forgejoUser is required' };
  }

  log(`Starting handoff for mission ${fmt.slug(slug)}...`);

  // Step 1: Final Gate Run
  if (skipGate) {
    fmt.log.warn('Step 1: Skipping final verification gate (--no-gate)');
  } else {
    log(`Step 1: Running final verification gate for area: ${fmt.bold(area || 'docs')}...`);
    const verifyResult = runVerificationGate(area || 'docs', {
      rootDir,
      stdio: 'inherit',
      runFn: git.run
    });
    if (verifyResult.status !== 0) {
      const msg = 'Final verification gate failed. Fix errors before submitting or use --no-gate if appropriate.';
      error(msg);
      return { ok: false, error: msg };
    }
  }

  // Step 1.5: Rebase mission branch onto latest primary before PR creation
  log('Step 1.5: Rebasing onto primary branch before handoff...');
  const rebaseResult = await rebaseFn(slug, {
    worktree: worktree || undefined,
    log,
    error,
    isForgejoReviewEnabledFn: isForgejoReviewEnabledFn,
  });
  if (!rebaseResult.ok) {
    if (rebaseResult.sharedFileConflicts) {
      const msg = 'Rebase encountered shared-file conflicts. Resolve the conflicts in the worktree, then re-run handoff.';
      error(msg);
      return { ok: false, error: msg };
    } else {
      const msg = 'Rebase failed before handoff. Ensure the mission branch can be rebased onto the latest primary branch.';
      error(msg);
      return { ok: false, error: msg };
    }
  }

  // Step 1.7: NEL capture — compute actual NEL from merge diff and persist record
  log('Step 1.7: Capturing Net Engineering Lines (NEL) at handoff...');
  const nelResult = captureNelAtHandoff(slug, { rootDir, missionDir: missionDirPath, log, error });
  if (nelResult.ok) {
    log(fmt.status('PASS', `NEL captured: ${nelResult.nel} NEL (${nelResult.bucket.label} bucket)`));
  } else {
    log(fmt.status('WARN', `NEL capture skipped: ${nelResult.error}`));
  }

  // Step 2: Forgejo PR Update/Create (optional mirror when Forgejo is enabled)
  let token = null;
  let fallbackUser = null;
  let bootstrapFailureReason = null;
  if (forgejoEnabled) {
    log(`Step 2: Updating/Creating Forgejo PR as user ${fmt.agent(forgejoUser)}...`);
    token = forgejo.readToken(forgejoUser);
    if (!token) {
      // Token missing for the agent user — attempt non-interactive bootstrap
      error(`Token not found for ${fmt.agent(forgejoUser)}. Attempting non-interactive bootstrap...`);

      const reviewSettings = forgejo.resolveForgejoSettings(rootDir);
      const bootstrapSetup = {
        baseUrl: reviewSettings.url,
        repo: reviewSettings.repo,
        ownerLogin: 'human',
        ownerPassword: '',
        agentPasswords: [{ user: forgejoUser, password: '' }],
      };
      const bootstrapResult = await setupReview.bootstrapReviewSurface(rootDir, bootstrapSetup, {
        interactive: false,
        requestFn: setupReview.apiRequest,
        log,
      });

      if (bootstrapResult.ok) {
        log(fmt.status('PASS', `Bootstrap succeeded for ${fmt.agent(forgejoUser)}.`));
        token = forgejo.readToken(forgejoUser);
        if (!token) {
          bootstrapFailureReason = 'bootstrap completed but token file for the agent user was not found';
          error('Bootstrap completed but token file for the agent user was not found. Falling back to default user.');
        }
      } else {
        bootstrapFailureReason = bootstrapResult.error || 'unknown';
        error(`Bootstrap for ${fmt.agent(forgejoUser)} failed: ${bootstrapFailureReason}. Falling back to default user.`);
      }

      // Handle bootstrap result that may not have error property
      /** @type{{error?: string}} */
      const br = bootstrapResult;

      // Magnus fallback if bootstrap didn't produce a token
      if (!token) {
        token = forgejo.readToken('human');
        if (token) {
          fallbackUser = 'human';
          log(`Token not found for ${fmt.agent(forgejoUser)} and bootstrap did not succeed. Falling back to PR creation as ${fmt.agent(fallbackUser)}.`);
        } else {
          const msg = `No Forgejo token found for user "${fmt.agent(forgejoUser)}", bootstrap failed (${br.error || 'unknown'}), and no fallback token available for "${fmt.agent('human')}". Manual action required: create a token manually or run \`node parallix setup-review\` first.`;
          error(msg);
          return { ok: false, error: msg };
        }
      }
    }

    // Persist durable fallback summary when we fell back to the default user
    if (fallbackUser === 'human') {
      const reason = bootstrapFailureReason || 'agent token was missing and bootstrap did not provide a replacement token';
      const fallbackSummary = `## Fallback: PR submitted as ${fmt.agent(fallbackUser)}\n\nOriginal user: ${fmt.agent(forgejoUser)}\nBootstrap failure reason: ${reason}`;
      if (!writeFallbackSummary(slug, fallbackSummary, { rootDir, log })) {
        log(fmt.status('WARN', `Could not persist fallback summary for ${fmt.slug(slug)}`));
      }
    }

    const prResult = forgejo.createPr(branch || '', String(fallbackUser || forgejoUser || 'default'), String(token || ''), {
      rootDir,
      log,
      forceWithLease
    });
    if (!prResult.ok) {
      const msg = `Forgejo PR creation/update failed: ${prResult.error}`;
      error(msg);
      return { ok: false, error: msg };
    }
  } else {
    log('Step 2: Skipping Forgejo PR (review provider is not forgejo).');
  }

 // Step 2.5: Gatekeeper pre-review validation
  // Run before transitioning Backlog to 'review' so missing artifacts are
  // flagged as a request-changes review instead of consuming a reviewer cycle.
  log('Step 2.5: Running gatekeeper pre-review validation...');
  const gatekeeperResult = gatekeeper.runGatekeeper(slug, { rootDir, log });
  let gatekeeperPushedBack = false;
  if (!gatekeeperResult.ok && gatekeeperResult.posted) {
    fmt.log.warn(`Gatekeeper posted pushback for ${fmt.slug(slug)}: missing ${gatekeeperResult.missing.join(', ')}.`);
    gatekeeperPushedBack = true;
    log(`Keeping task ${fmt.slug(slug)} in active — not transitioning to review while artifacts are missing.`);
  } else if (!gatekeeperResult.ok && (gatekeeperResult.skipped || !gatekeeperResult.posted)) {
    fmt.log.fail(`Gatekeeper detected missing artifacts for ${fmt.slug(slug)} but could not post pushback: skipped=${gatekeeperResult.skipped}, posted=${gatekeeperResult.posted}. Blocking handoff — task remains in active until artifacts are present.`);
    error(`Missing mandatory artifacts: ${gatekeeperResult.missing.join(', ')}.`);
    return { ok: false, error: `Gatekeeper detected missing artifacts but could not post pushback (skipped=${gatekeeperResult.skipped}, posted=${gatekeeperResult.posted}). Fix missing artifacts before handoff: ${gatekeeperResult.missing.join(', ')}.` };
  } else {
    log('Gatekeeper: all mandatory artifacts present.');
  }

  if (gatekeeperPushedBack) {
    log(`Gatekeeper pushback posted for ${fmt.slug(slug)} — skipping Backlog transition to review.`);
    return /** @type{{ok: boolean, gatekeeperPushedBack: boolean}} */({ ok: true, gatekeeperPushedBack: true });
  }

  // Step 2.6: Generic ## Gates runner — execute any gates declared in MISSION.md
  log('Step 2.6: Running declared gates from MISSION.md...');
  const gatesResult = runDeclaredGates(verification.missionDir || '', rootDir, { log, error });
  if (!gatesResult.ok) {
    const msg = `Declared gate "${gatesResult.gate}" failed for ${fmt.slug(slug)}: ${gatesResult.error || gatesResult.reason}. Blocking handoff — task remains in active.`;
    error(msg);
    return { ok: false, error: msg };
  }
  if (gatesResult.skipped) {
    log(`No declared gates for ${fmt.slug(slug)} (${gatesResult.reason}).`);
  } else {
    log(`All ${gatesResult.count} declared gate(s) passed for ${fmt.slug(slug)}.`);
  }

  // Step 3 & 4: Backlog Transition and Commit
  log('Step 3 & 4: Transitioning and committing Backlog task to review...');

  const taskImplementer = forgejoUser;
  if (!backlog.transitionTask(slug, 'review', { implementer: taskImplementer, rootDir, log })) {
    const msg = `Could not transition task ${fmt.slug(slug)} to review.`;
    error(msg);
    return { ok: false, error: msg };
  }

  if (forgejoEnabled && token) {
    log('Pushing state change to Forgejo...');
    const reviewSettings = forgejo.resolveForgejoSettings(rootDir);
    const repoOwner = (reviewSettings.repo && reviewSettings.repo.split('/')[0]) || null;
    const ownerToken = repoOwner ? forgejo.readToken(repoOwner) : null;
    const pushUser = ownerToken && repoOwner ? repoOwner : (fallbackUser || forgejoUser);
    const pushToken = ownerToken || token;
    const remoteUrl = forgejo.authenticatedReviewUrl(pushUser, pushToken, rootDir);
    let pushLeaseArg = null;
    if (force) {
      const fetchArgs = ['-C', rootDir, 'fetch', remoteUrl, `+refs/heads/${branch}:refs/remotes/review/${branch}`];
      const fetchResult = git.git(fetchArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
      if (fetchResult.status !== 0) {
        const fetchError = (fetchResult.stderr || fetchResult.stdout || '').trim();
        const msg = `Failed to refresh Backlog transition lease for ${fmt.slug(slug)} before Forgejo push.`;
        error(`${msg}${fetchError ? ` ${fetchError}` : ''}`);
        return { ok: false, error: msg };
      }
      const tracking = forgejo.resolveTrackingBranchSha(branch || '', rootDir);
      if (!tracking.ok) {
        const msg = `Failed to resolve Backlog transition lease for ${fmt.slug(slug)} before Forgejo push.`;
        error(msg);
        return { ok: false, error: `${msg} ${tracking.error || ''}`.trim() };
      }
      pushLeaseArg = `--force-with-lease=refs/heads/${branch}:${String(tracking.sha || '')}`;
    }
    const pushArgs = ['-C', rootDir, 'push'];
    if (pushLeaseArg) {
      pushArgs.push(pushLeaseArg);
    }
    pushArgs.push(String(remoteUrl || ''), branch || '');
    const pushBacklogForgejo = git.git(pushArgs);
    if (pushBacklogForgejo.status !== 0) {
      const pushError = [pushBacklogForgejo.stderr, pushBacklogForgejo.stdout].filter(Boolean).join('\n');
      if (force && /non-fast-forward|stale info|fetch first/i.test(pushError || '')) {
        const forceArgs = ['-C', rootDir, 'push', '--force', String(remoteUrl || ''), branch || ''];
        const forceResult = git.git(forceArgs);
        if (forceResult.status === 0) {
          fmt.log.info(`Backlog transition for ${fmt.slug(slug)} required plain force after stale lease.`);
        } else {
          const forceError = (forceResult.stderr || forceResult.stdout || '').trim();
          const msg = `Failed to push Backlog transition for ${fmt.slug(slug)} to Forgejo.`;
          error(msg);
          return { ok: false, error: forceError ? `${msg} ${forceError}` : msg };
        }
        return { ok: true, gatekeeperPushedBack };
      }
      const msg = `Failed to push Backlog transition for ${fmt.slug(slug)} to Forgejo.`;
      error(msg);
      return { ok: false, error: msg };
    }
  }

  fmt.log.pass(`Mission ${fmt.slug(slug)} handed off successfully.`);
  return /** @type{{ok: boolean, gatekeeperPushedBack?: boolean}} */({ ok: true, gatekeeperPushedBack });
}

/**
 * Parse and execute declared gates from a mission's MISSION.md `## Gates` section.
 * Each gate line is treated as a shell command to be executed via spawnSync.
 * Returns { ok, skipped, count, reason } on success or { ok: false, gate, error, reason } on failure.
 */
/** @param {string} missionDir @param {string} rootDir @param {{log?: Function, error?: Function}} [options] */
function runDeclaredGates(missionDir, rootDir, options = {}) {
  const { log = fmt.log.plain } = /** @type {{log?: Function, error?: Function}} */ (options);
  const missionPath = path.join(missionDir, 'MISSION.md');
  if (!fs.existsSync(missionPath)) {
    return { ok: true, skipped: true, reason: 'no-mission-file' };
  }

  const content = fs.readFileSync(missionPath, 'utf8');

  // Extract the ## Gates section
  const gatesSectionMatch = content.match(/^## Gates\s*\n([\s\S]*?)(?=\n## |\n$)/m);
  if (!gatesSectionMatch) {
    return { ok: true, skipped: true, reason: 'no-gates-section' };
  }

  const gatesBlock = gatesSectionMatch[1];
  const gateLines = gatesBlock.split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('- [ ]') || line.startsWith('- [x]') || line.startsWith('- '));

  // Strip the checkbox prefix to get the command
  const commands = gateLines.map(line => {
    // Remove "- [ ] ", "- [x] ", or "- " prefix
    return line.replace(/^- \[[ x]\]\s*/, '').replace(/^- \s*/, '');
  }).filter(cmd => cmd.length > 0);

  if (commands.length === 0) {
    return { ok: true, skipped: true, reason: 'no-gates-declared' };
  }

  // Execute each gate command
  for (const cmd of commands) {
    log(`  Gate: ${cmd}`);
    const result = spawnSync('bash', ['-c', cmd], {
      cwd: rootDir,
      encoding: 'utf8',
      stdio: ['inherit', 'pipe', 'pipe']
    });

    if (result.status !== 0) {
      const stderr = (result.stderr || '').trim();
      return {
        ok: false,
        gate: cmd,
        reason: 'gate-failed',
        error: stderr || `Gate exited with status ${result.status}`
      };
    }
  }

  return { ok: true, skipped: false, count: commands.length, reason: 'all-gates-passed' };
}

/**
 * Build the content for an auto-generated CP-1.md checkpoint (task-1228).
 *
 * The generated file satisfies the minimum checkpoint integrity requirements
 * enforced in performHandoff: an `# CP-1:` h1 heading, a `## Goal Check`
 * section (matching the regex `^## Goal Check(?: Table)?\s*$`), and a 3-column
 * pipe table with at least one evidence row. It is explicitly marked as
 * auto-generated so a reviewer knows to replace it with real evidence.
 *
 * @param {string} slug - Mission slug, used for human-readable context.
 * @returns {string}
 */
function buildAutoCheckpointContent(slug) {
  return [
    `# CP-1: Auto-generated checkpoint (handoff remediation for ${slug})`,
    '',
    '> **Auto-generated by `node parallix handoff`** because no checkpoint document',
    '> was present in the mission directory at handoff time. This file provides the',
    '> minimum required structure so the handoff can proceed. A reviewer should',
    '> replace it with real implementation evidence.',
    '',
    '## Goal Check',
    '',
    '| Criterion | Evidence | Status |',
    '|-----------|----------|--------|',
    '| Auto-generated checkpoint CP-1.md present | handoff.js auto-remediation creates CP-1.md when checkpoints.length === 0 | PASS |',
    '| Mission contract exists for review | MISSION.md present in the mission directory | PASS |',
    '',
    'Next action: Reviewer to replace this placeholder with real implementation evidence before approval.',
    ''
  ].join('\n');
}

/**
  * Write a fallback summary (`## Fallback:` heading) into the backlog task file.
  * This is the in-scope equivalent of backlog.setTaskFinalSummary, implemented
  * inline here since modifying backlog.js is out of scope for this mission.
  * @param {string} slug - Mission slug
  * @param {string} summary - The fallback summary text (must contain ## Fallback)
  * @param {{rootDir?: string, log?: Function}} options
  * @returns {boolean}
  */
 function writeFallbackSummary(slug, summary, options = {}) {
   /** @type{{rootDir?: string, log?: Function}} */
   const opts = options;
   const rootDir = opts.rootDir || process.cwd();
   const log = opts.log || fmt.log.plain;
  const resolution = backlog.resolveTaskFile(slug, rootDir);
  if (!resolution.ok) {
    log(fmt.status('WARN', `Could not write fallback summary for ${fmt.slug(slug)}: ${resolution.reason}`));
    return false;
  }

  const taskFile = resolution.taskFile;
  if (!taskFile) {
    log(fmt.status('WARN', `Could not write fallback summary for ${fmt.slug(slug)}: task file not found.`));
    return false;
  }
  /** @type{string} */
  let content = fs.readFileSync(taskFile, 'utf8');

  // Already present — no-op
  if (content.includes('## Fallback:')) {
    return true;
  }

  // Insert after frontmatter block (first occurrence of "---" closing)
  const firstDash = content.indexOf('---');
  if (firstDash === -1) {
    content = summary + '\n\n' + content;
  } else {
    // Find the closing --- of frontmatter
    const closingDash = content.indexOf('---', firstDash + 3);
    if (closingDash === -1) {
      content = summary + '\n\n' + content;
    } else {
      const insertPos = closingDash + 3;
      content = content.slice(0, insertPos) + '\n\n' + summary + content.slice(insertPos);
    }
  }

  // Write the file
  fs.writeFileSync(taskFile, content, 'utf8');

  // Commit via the git module
  const gitResult = git.git(['add', taskFile]);
  if (gitResult.status !== 0) {
    log(fmt.status('WARN', `Failed to stage fallback summary for ${fmt.slug(slug)}`));
    return false;
  }

  const commitResult = git.git(['commit', '-m', `backlog(${slug}): set fallback summary`]);
  if (commitResult.status !== 0) {
    log(fmt.status('WARN', `Failed to commit fallback summary for ${fmt.slug(slug)}`));
    return false;
  }

  log(fmt.status('PASS', `Set fallback summary on ${fmt.slug(slug)}.`));
  return true;
}

/**
 * Capture NEL (Net Engineering Lines) at handoff time.
 *
 * Computes actual NEL from the merge diff (primary..HEAD), reads the predicted
 * bucket from the mission's Refinement Signals, resolves review rounds from
 * review-state.json, and persists a per-mission NEL record as `nel-record.json`.
 *
 * This is purely observational — no enforcement, gates, or blocks.
 *
 * @param {string} slug - Mission slug
 * @param {{ rootDir: string, missionDir: string, log: Function, error: Function }} options
 * @returns {{ ok: boolean, nel?: number, bucket?: string, error?: string }}
 */
function captureNelAtHandoff(slug, options) {
   const { rootDir, missionDir, error } = options;

  // 1. Determine primary branch for diff range
  let primaryBranch;
  try {
    primaryBranch = missionUtils.getPrimaryBranch(rootDir);
  } catch (_) {
    return { ok: false, error: 'could not detect primary branch for NEL diff range' };
  }

  if (!primaryBranch) {
    return { ok: false, error: 'primary branch is empty' };
  }

  // 2. Compute actual NEL from primary..HEAD
  let nelRecord;
  try {
    nelRecord = nels.computeNELRecord(`${primaryBranch}..HEAD`, { cwd: rootDir });
  } catch (_) {
    return { ok: false, error: 'NEL computation failed' };
  }

  const actualNel = nelRecord.nel;
  const actualBucket = nelRecord.bucket.label;

  // 3. Read predicted bucket from MISSION.md Refinement Signals
  const missionMdPath = path.join(missionDir, 'MISSION.md');
  let predictedBucket = 'Unknown';
  if (fs.existsSync(missionMdPath)) {
    const content = fs.readFileSync(missionMdPath, 'utf8');
    const predictedMatch = content.match(/Predicted NEL bucket:\s*(Small|Medium|Large)/i);
    if (predictedMatch) {
      predictedBucket = predictedMatch[1];
    }
  }

  // 4. Read review rounds from review-state.json
  let reviewRounds = 1;
  const reviewStatePath = path.join(missionDir, 'review-state.json');
  if (fs.existsSync(reviewStatePath)) {
    try {
      const rs = JSON.parse(fs.readFileSync(reviewStatePath, 'utf8'));
      reviewRounds = rs.round || 1;
    } catch (_) {
      // ignore parse errors
    }
  }

  // 5. Persist NEL record
  const nelRecordPath = path.join(missionDir, 'nel-record.json');
  const record = {
    slug,
    predictedBucket,
    actualNel,
    actualBucket,
    reviewRounds,
    capturedAt: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(nelRecordPath, JSON.stringify(record, null, 2) + '\n', 'utf8');
  } catch (err) {
    error(`Failed to write NEL record: ${err.message}`);
    return { ok: false, error: `failed to write NEL record: ${err.message}` };
  }

  return { ok: true, nel: actualNel, bucket: actualBucket };
}

/** @param {string[]} args */
async function handoffCommand(args) {
  const explicitSlug = args[0];
  const slug = missionUtils.inferSlug(explicitSlug);
  const skipGate = args.includes('--no-gate');
  const force = args.includes('--force');

  if (!slug) {
    fmt.log.fail('Usage: node parallix handoff [<slug>] [--no-gate] [--force]');
    process.exit(1);
  }

  const result = await _exports.performHandoff(slug, { skipGate, force });
  if (!result.ok) {
    process.exit(1);
  }
}

/** @type {{performHandoff: Function}} */
const _exports = {
  /** @returns {...} */
  get performHandoff() { return _handoffExport.performHandoff; }
};
/** @type {{verifyHandoff: typeof verifyHandoff, performHandoff: typeof performHandoff, gatekeeper: typeof gatekeeper, runDeclaredGates: typeof runDeclaredGates, captureNelAtHandoff: typeof captureNelAtHandoff}} */
const _namedExports = { verifyHandoff, performHandoff, gatekeeper, runDeclaredGates, captureNelAtHandoff };
/** @type {typeof handoffCommand & {verifyHandoff: typeof verifyHandoff, performHandoff: typeof performHandoff, gatekeeper: typeof gatekeeper, runDeclaredGates: typeof runDeclaredGates, captureNelAtHandoff: typeof captureNelAtHandoff}} */
const _handoffExport = Object.assign(handoffCommand, _namedExports);
export default _handoffExport;
export { _handoffExport as handoff, verifyHandoff, performHandoff, gatekeeper, runDeclaredGates, captureNelAtHandoff };

// CJS compat: ensure require() returns the function directly
declare const module: { exports: any } | undefined;
if (typeof module !== 'undefined') { module.exports = _handoffExport; }
