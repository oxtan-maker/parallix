import * as fs from 'node:fs';
import * as path from 'node:path';
import * as fmt from '../core/fmt.js';
import { getCurrentBranch, getLastCommit, git } from '../core/git.js';
import { resolveTaskFile, getTaskStatus, reportTaskResolution } from '../tools/backlog.js';
import { adapterChecklist, evaluateRepositoryReadiness } from '../core/product-config.js';
import { evaluateReviewSetup } from '../tools/setup-review.js';
import { toVirtual } from '../core/state-map.js';
import { findMissionDir, findCheckpoints, getFirstLine, inferSlug, getMissionYear, conventionalWorktreePath, resolveMissionBaseBranch, getPrimaryBranch } from '../core/mission-utils.js';
import { getPrStatus } from '../tools/forgejo.js';
import { isForgejoReviewEnabled } from '../core/product-config.js';
import stats from './stats.js';

/** @param {string[]} args @param {{log?: Function, error?: Function, cwdFn?: Function, getCurrentBranchFn?: Function, resolveTaskFileFn?: Function, getTaskStatusFn?: Function, toVirtualFn?: Function, findMissionDirFn?: Function, findCheckpointsFn?: Function, getFirstLineFn?: Function, inferSlugFn?: Function, getMissionYearFn?: Function, conventionalWorktreePathFn?: Function, getLastCommitFn?: Function, getPrStatusFn?: Function, evaluateRepositoryReadinessFn?: Function, evaluateReviewSetupFn?: Function, adapterChecklistFn?: Function, resolveMissionClassificationFn?: Function, isForgejoReviewEnabledFn?: Function, fsExistsSync?: Function, resolveMissionBaseBranchFn?: Function, getPrimaryBranchFn?: Function, gitFn?: Function, command?: string, returnResult?: boolean}} opts */
function missionStart(args: string[], opts: { log?: Function, error?: Function, cwdFn?: Function, getCurrentBranchFn?: Function, resolveTaskFileFn?: Function, getTaskStatusFn?: Function, toVirtualFn?: Function, findMissionDirFn?: Function, findCheckpointsFn?: Function, getFirstLineFn?: Function, inferSlugFn?: Function, getMissionYearFn?: Function, conventionalWorktreePathFn?: Function, getLastCommitFn?: Function, getPrStatusFn?: Function, evaluateRepositoryReadinessFn?: Function, evaluateReviewSetupFn?: Function, adapterChecklistFn?: Function, resolveMissionClassificationFn?: Function, isForgejoReviewEnabledFn?: Function, fsExistsSync?: Function, resolveMissionBaseBranchFn?: Function, getPrimaryBranchFn?: Function, gitFn?: Function, command?: string, returnResult?: boolean } = {}) {
  const log = opts.log || fmt.log.plain;
  const error = opts.error || fmt.log.plainError;
  const cwdFn = opts.cwdFn || (() => process.cwd());
  const getCurrentBranchFn = opts.getCurrentBranchFn || getCurrentBranch;
  const resolveTaskFileFn = opts.resolveTaskFileFn || resolveTaskFile;
  const getTaskStatusFn = opts.getTaskStatusFn || getTaskStatus;
  const toVirtualFn = opts.toVirtualFn || toVirtual;
  const findMissionDirFn = opts.findMissionDirFn || findMissionDir;
  const findCheckpointsFn = opts.findCheckpointsFn || findCheckpoints;
  const getFirstLineFn = opts.getFirstLineFn || getFirstLine;
  const inferSlugFn = opts.inferSlugFn || inferSlug;
  const getMissionYearFn = opts.getMissionYearFn || getMissionYear;
  const conventionalWorktreePathFn = opts.conventionalWorktreePathFn || conventionalWorktreePath;
  const getLastCommitFn = opts.getLastCommitFn || getLastCommit;
  const getPrStatusFn = opts.getPrStatusFn || getPrStatus;
  const evaluateRepositoryReadinessFn = opts.evaluateRepositoryReadinessFn || evaluateRepositoryReadiness;
  const evaluateReviewSetupFn = opts.evaluateReviewSetupFn || evaluateReviewSetup;
  const adapterChecklistFn = opts.adapterChecklistFn || adapterChecklist;
  const resolveMissionClassificationFn = opts.resolveMissionClassificationFn || (stats as any).resolveMissionClassification;
  const isForgejoReviewEnabledFn = opts.isForgejoReviewEnabledFn || isForgejoReviewEnabled;
  const fsExistsSync = opts.fsExistsSync || fs.existsSync;
  const resolveMissionBaseBranchFn = opts.resolveMissionBaseBranchFn || resolveMissionBaseBranch;
  const getPrimaryBranchFn = opts.getPrimaryBranchFn || getPrimaryBranch;
  const runFn = opts.gitFn || git;

  const explicitSlug = args[0];
  const slug = inferSlugFn(explicitSlug);
  const isVerifyOnly = opts.command === 'verify-env' || !slug;
  const returnResult = Boolean(opts.returnResult);

  if (isVerifyOnly) {
    log(fmt.status('INFO', 'Running environment diagnostics (verify-env)...'));
  } else {
    log(fmt.status('INFO', `Running mission startup preflight for: ${fmt.slug(slug)}`));
  }

  let overallFail = false;
  /** @type{string[]} */
  const remediationSteps: string[] = [];

  // Check 1: PWD
  const cwd = cwdFn();
  const reportReviewSetup = () => {
    const reviewSetup = evaluateReviewSetupFn(cwd);
    if (reviewSetup.required && reviewSetup.ok) {
      log(fmt.status('PASS', 'Forgejo review setup: token files, auth, and git remote are ready.'));
    } else if (reviewSetup.required && !reviewSetup.ok) {
      log(fmt.status('WARN', 'Forgejo review setup: review actions are not ready yet.'));
      for (const issue of reviewSetup.issues) {
        log(fmt.status('INFO', issue));
      }
      for (const step of reviewSetup.steps) {
        log(fmt.status('INFO', step));
      }
    }
  };

  const reportRepositoryReadiness = () => {
    const readiness = evaluateRepositoryReadinessFn(cwd);
    if (readiness.mode === 'default') {
      log(fmt.status('PASS', 'Workflow config: using built-in defaults (create workflow.config.json to override).'));
      reportReviewSetup();
      return;
    }
    if (readiness.mode === 'configured') {
      log(fmt.status('PASS', `Workflow config: ${readiness.configPath}`));
      log(fmt.status('PASS', 'Repository adapters: override sections are valid.'));
      reportReviewSetup();
      return;
    }

    // mode === 'invalid'
    log(fmt.status('FAIL', `Workflow config: ${readiness.configPath || 'workflow.config.json'}`));
    for (const issue of readiness.issues) {
      log(fmt.status('INFO', issue));
    }
    for (const step of adapterChecklistFn()) {
      log(fmt.status('INFO', step));
    }
    overallFail = true;
    remediationSteps.push('Fix workflow.config.json: ensure it is valid JSON and adapters is an object with valid subsections.');
  };

  if (isVerifyOnly) {
    log(fmt.status('PASS', `PWD: ${fmt.path(cwd)}`));
  } else {
    const expectedPath = conventionalWorktreePathFn(slug);
    if (cwd === expectedPath || cwd.endsWith(slug)) {
      log(fmt.status('PASS', `PWD: matches expected mission worktree path ${fmt.path(expectedPath)}`));
    } else {
      log(fmt.status('FAIL', `PWD: ${fmt.path(cwd)} does not match expected mission worktree path ${fmt.path(expectedPath)}`));
      overallFail = true;
    }
  }

  // Check 2: Branch
  const currentBranch = getCurrentBranchFn();
  if (isVerifyOnly) {
    log(fmt.status('PASS', `Branch: ${fmt.branch(currentBranch)}`));
  } else {
    const expectedBranch = `mission/${slug}`;
    if (currentBranch === expectedBranch) {
      log(fmt.status('PASS', `Branch: ${fmt.branch(currentBranch)}`));
    } else {
      log(fmt.status('FAIL', `Branch: ${fmt.branch(currentBranch)} does not match expected mission branch ${fmt.branch(expectedBranch)}`));
      overallFail = true;
    }
  }
  if (isVerifyOnly) {
    reportRepositoryReadiness();
  }
  // Check 3: Backlog task
  if (slug) {
    const taskResolution = resolveTaskFileFn(slug);
    if (taskResolution.ok) {
      const status = getTaskStatusFn(taskResolution.taskFile);
      const virtualStatus = toVirtualFn(status);
      
      if (!isVerifyOnly) {
        if (virtualStatus === 'ready' || virtualStatus === 'active' || virtualStatus === 'review') {
          log(fmt.status('PASS', `Backlog task status: ${status}`));
        } else if (virtualStatus === 'backlog' || virtualStatus === 'draft') {
          log(fmt.status('WARN', `Backlog task status: ${status} (expected 'ready', 'active', or 'review')`));
        } else {
          log(fmt.status('FAIL', `Backlog task status: ${status} (mission already complete)`));
          overallFail = true;
        }
      } else {
        log(fmt.status('PASS', `Backlog task status: ${status}`));
      }

      try {
        const { classification, error: classificationError } = resolveMissionClassificationFn(slug);
        if (!classification) {
          log(fmt.status('FAIL', `Backlog classification: ${classificationError || 'missing'}`));
          overallFail = true;
        } else {
          log(fmt.status('PASS', `Backlog classification: ${classification}`));
        }
      } catch (error) {
        log(fmt.status('FAIL', `Backlog classification: ${(error as Error).message}`));
        overallFail = true;
      }
    } else {
      if (taskResolution.reason === 'missing') {
        const fallbackClassification = resolveMissionClassificationFn(slug, cwd);
        log(fmt.status('WARN', `Backlog task: no task file found for ${fmt.slug(slug)}; continuing with classification ${fallbackClassification.classification}.`));
        log(fmt.status('PASS', `Backlog classification: ${fallbackClassification.classification}`));
      } else {
        reportTaskResolution(taskResolution, slug, log);
        overallFail = true;
      }
    }
  }

    // Check 4: Mission docs + base branch
    if (!isVerifyOnly) {
      const missionDir = findMissionDirFn(slug);
      if (missionDir) {
        const missionFile = path.join(missionDir, 'MISSION.md');
        if (fsExistsSync(missionFile)) {
          const checkpoints = findCheckpointsFn(missionDir);
          if (checkpoints.length > 0) {
            const lastCP = checkpoints[checkpoints.length - 1];
            const firstLine = getFirstLineFn(lastCP);
            log(fmt.status('PASS', `Mission doc: found MISSION.md. Most recent checkpoint: ${fmt.path(path.basename(lastCP))} (${firstLine})`));
          } else {
            log(fmt.status('WARN', `Mission doc: found MISSION.md but no checkpoints yet. Start from CP-1.`));
          }

          // Base branch validation: when a mission records a non-primary base,
          // verify the base branch exists locally so integrate won't fail silently.
          const primaryBranch = getPrimaryBranchFn();
          let recordedBase: string | null;
          try {
            recordedBase = resolveMissionBaseBranchFn(slug, process.cwd());
          } catch (_) {
            recordedBase = null;
          }
          if (recordedBase && recordedBase !== primaryBranch) {
            const checkResult = runFn(['-C', cwd, 'show-ref', '--verify', '--quiet', `refs/heads/${recordedBase}`], { cwd });
            if (!checkResult || checkResult.status !== 0) {
              log(fmt.status('FAIL', `Preflight: base branch '${recordedBase}' recorded in MISSION.md does not exist locally. Create or fetch the '${recordedBase}' base branch before starting this mission.`));
              overallFail = true;
            } else {
              log(fmt.status('PASS', `Preflight: base branch '${recordedBase}' exists locally.`));
            }
          }
        } else {
          log(fmt.status('FAIL', `Mission doc: found directory but MISSION.md is missing in ${fmt.path(missionDir)}`));
          overallFail = true;
        }
      } else {
        log(fmt.status('FAIL', `Mission doc: directory not found in docs/missions/${getMissionYearFn(slug)}/ for slug ${fmt.slug(slug)}`));
        overallFail = true;
      }
    }

  // Check 5: Last commit
  const lastCommit = getLastCommitFn();
  log(fmt.status('PASS', `Last commit: ${fmt.sha(lastCommit.sha.substring(0, 8))} - ${lastCommit.subject} (${lastCommit.date})`));

  // Check 6: Forgejo PR (skipped when review provider is not forgejo)
  if (!isVerifyOnly && isForgejoReviewEnabledFn(cwd)) {
    const pr = getPrStatusFn(`mission/${slug}`);
    if (!pr.exists) {
      log(fmt.status('PASS', `Forgejo PR: no PR found (ready for startup)`));
    } else if (pr.state === 'open') {
      log(fmt.status('PASS', `Forgejo PR: found OPEN PR (#${pr.number})`));
    } else {
      log(fmt.status('PASS', `Forgejo PR: found ${pr.state ? pr.state.toUpperCase() : 'UNKNOWN'} PR (#${pr.number})`));
    }
  }

  return completePreflightOrExit(overallFail, returnResult, { log, error, remediationSteps });
}

// Extracted so callers can test the returnResult path without live git dependencies.
/** @param {boolean} overallFail @param {boolean} returnResult @param {{error?: Function, log?: Function, remediationSteps?: string[]}} options */
function completePreflightOrExit(overallFail: boolean, returnResult: boolean, options: { error?: Function, log?: Function, remediationSteps?: string[] } = {}) {
  /** @type{{error?: Function, log?: Function, remediationSteps?: string[]}} */
  const opts = options;
  const error = opts.error || fmt.log.plainError;
  const log = opts.log || fmt.log.plain;
  const remediationSteps = opts.remediationSteps || [];
  if (overallFail) {
    let msg = '\n' + fmt.status('FAIL', 'Environment verdict: NOT USABLE');
    if (remediationSteps.length > 0) {
      msg += ' — remediation:';
      for (const step of remediationSteps) {
        msg += `\n  - ${step}`;
      }
    } else {
      msg += ' — fix blockers above before proceeding.';
    }
    error(msg);
    if (returnResult) {return { pass: false };}
    process.exit(1);
  } else {
    log('\n' + fmt.status('PASS', 'Environment verdict: USABLE — this repository is ready for workflow commands.'));
    if (returnResult) {return { pass: true };}
    process.exit(0);
  }
}

(missionStart as any).completePreflightOrExit = completePreflightOrExit;

export default missionStart;
export { missionStart, completePreflightOrExit };

// CJS compat: ensure require() returns the function directly
declare const module: { exports: any } | undefined;
if (typeof module !== 'undefined') { module.exports = missionStart; }
