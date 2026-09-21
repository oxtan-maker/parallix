import * as fs from 'node:fs';
import * as path from 'node:path';
import * as fmt from '../../application/presentation/cli-format.js';
import { getCurrentBranch, getLastCommit, git } from '../git/git.js';
import { resolveTaskFile, getTaskStatus, reportTaskResolution } from '../backlog/backlog.js';
import { adapterChecklist, evaluateRepositoryReadiness } from '../config/product-config.js';
import { evaluateReviewSetup } from '../review/setup-review.js';
import { toVirtual } from '../config/state-map.js';
import { findMissionDir, findCheckpoints, getFirstLine, inferSlug, getMissionYear, conventionalWorktreePath, resolveMissionBaseBranch, getPrimaryBranch, resolveWorktree } from '../filesystem/mission-utils.js';
import { getPrStatus } from '../forgejo/forgejo.js';
import { isForgejoReviewEnabled } from '../config/product-config.js';
import stats from './commands/stats.js';

/** @param {string[]} args @param {{log?: Function, error?: Function, cwdFn?: Function, getCurrentBranchFn?: Function, resolveTaskFileFn?: Function, getTaskStatusFn?: Function, toVirtualFn?: Function, findMissionDirFn?: Function, findCheckpointsFn?: Function, getFirstLineFn?: Function, inferSlugFn?: Function, getMissionYearFn?: Function, conventionalWorktreePathFn?: Function, getLastCommitFn?: Function, getPrStatusFn?: Function, evaluateRepositoryReadinessFn?: Function, evaluateReviewSetupFn?: Function, adapterChecklistFn?: Function, resolveMissionClassificationFn?: Function, isForgejoReviewEnabledFn?: Function, fsExistsSync?: Function, resolveMissionBaseBranchFn?: Function, getPrimaryBranchFn?: Function, gitFn?: Function, command?: string, returnResult?: boolean, quiet?: boolean}} opts */
/** A failed check sets `fail`; only a check with an operator repair adds a step. */
type PreflightVerdict = { fail: boolean; remediationSteps: string[] };

/** Forgejo token files, auth and git remote. Never fatal: it only warns. */
function reportReviewSetup(cwd: string, evaluateReviewSetupFn: Function, log: Function): void {
  const reviewSetup = evaluateReviewSetupFn(cwd);
  if (!reviewSetup.required) { return; }
  if (reviewSetup.ok) {
    log(fmt.status('PASS', 'Forgejo review setup: token files, auth, and git remote are ready.'));
    return;
  }
  log(fmt.status('WARN', 'Forgejo review setup: review actions are not ready yet.'));
  for (const issue of reviewSetup.issues) { log(fmt.status('INFO', issue)); }
  for (const step of reviewSetup.steps) { log(fmt.status('INFO', step)); }
}

function reportRepositoryReadiness(cwd: string, deps: any, verdict: PreflightVerdict, log: Function): void {
  const { evaluateRepositoryReadinessFn, evaluateReviewSetupFn, adapterChecklistFn } = deps;
  const readiness = evaluateRepositoryReadinessFn(cwd);
  if (readiness.mode === 'default') {
    log(fmt.status('PASS', 'Workflow config: using built-in defaults (create workflow.config.json to override).'));
    reportReviewSetup(cwd, evaluateReviewSetupFn, log);
    return;
  }
  if (readiness.mode === 'configured') {
    log(fmt.status('PASS', `Workflow config: ${readiness.configPath}`));
    log(fmt.status('PASS', 'Repository adapters: override sections are valid.'));
    reportReviewSetup(cwd, evaluateReviewSetupFn, log);
    return;
  }
  // mode === 'invalid'
  log(fmt.status('FAIL', `Workflow config: ${readiness.configPath || 'workflow.config.json'}`));
  for (const issue of readiness.issues) { log(fmt.status('INFO', issue)); }
  for (const step of adapterChecklistFn()) { log(fmt.status('INFO', step)); }
  verdict.fail = true;
  verdict.remediationSteps.push('Fix workflow.config.json: ensure it is valid JSON and adapters is an object with valid subsections.');
}

function checkWorktreePath(cwd: string, slug: string, isVerifyOnly: boolean, verdict: PreflightVerdict, conventionalWorktreePathFn: Function, log: Function): void {
  if (isVerifyOnly) { log(fmt.status('PASS', `PWD: ${fmt.path(cwd)}`)); return; }
  const expectedPath = conventionalWorktreePathFn(slug);
  if (cwd === expectedPath || cwd.endsWith(slug)) {
    log(fmt.status('PASS', `PWD: matches expected mission worktree path ${fmt.path(expectedPath)}`));
    return;
  }
  log(fmt.status('FAIL', `PWD: ${fmt.path(cwd)} does not match expected mission worktree path ${fmt.path(expectedPath)}`));
  verdict.fail = true;
}

function checkMissionBranch(currentBranch: string, slug: string, isVerifyOnly: boolean, verdict: PreflightVerdict, log: Function): void {
  const expectedBranch = `mission/${slug}`;
  if (isVerifyOnly || currentBranch === expectedBranch) {
    log(fmt.status('PASS', `Branch: ${fmt.branch(currentBranch)}`));
    return;
  }
  log(fmt.status('FAIL', `Branch: ${fmt.branch(currentBranch)} does not match expected mission branch ${fmt.branch(expectedBranch)}`));
  verdict.fail = true;
}

/** A mission may only start from a status that has not already completed. */
function reportBacklogTaskStatus(status: string, virtualStatus: string, isVerifyOnly: boolean, verdict: PreflightVerdict, log: Function): void {
  if (isVerifyOnly || ['ready', 'active', 'review'].includes(virtualStatus)) {
    log(fmt.status('PASS', `Backlog task status: ${status}`));
    return;
  }
  if (virtualStatus === 'backlog' || virtualStatus === 'draft') {
    log(fmt.status('WARN', `Backlog task status: ${status} (expected 'ready', 'active', or 'review')`));
    return;
  }
  log(fmt.status('FAIL', `Backlog task status: ${status} (mission already complete)`));
  verdict.fail = true;
}

function reportBacklogClassification(slug: string, cwd: string, resolveMissionClassificationFn: Function, verdict: PreflightVerdict, log: Function): void {
  try {
    const { classification, error: classificationError } = resolveMissionClassificationFn(slug, cwd);
    if (classification) { log(fmt.status('PASS', `Backlog classification: ${classification}`)); return; }
    log(fmt.status('FAIL', `Backlog classification: ${classificationError || 'missing'}`));
  } catch (error) {
    log(fmt.status('FAIL', `Backlog classification: ${(error as Error).message}`));
  }
  verdict.fail = true;
}

function checkBacklogTask(slug: string, cwd: string, isVerifyOnly: boolean, verdict: PreflightVerdict, deps: any, log: Function): void {
  const { resolveTaskFileFn, getTaskStatusFn, toVirtualFn, resolveMissionClassificationFn } = deps;
  const taskResolution = resolveTaskFileFn(slug, cwd);
  if (taskResolution.ok) {
    const status = getTaskStatusFn(taskResolution.taskFile);
    reportBacklogTaskStatus(status, toVirtualFn(status), isVerifyOnly, verdict, log);
    reportBacklogClassification(slug, cwd, resolveMissionClassificationFn, verdict, log);
    return;
  }
  if (taskResolution.reason !== 'missing') {
    reportTaskResolution(taskResolution, slug, log);
    verdict.fail = true;
    return;
  }
  // An adhoc mission has no Backlog backing; its classification still resolves.
  const fallback = resolveMissionClassificationFn(slug, cwd);
  log(fmt.status('WARN', `Backlog task: no task file found for ${fmt.slug(slug)}; continuing with classification ${fallback.classification}.`));
  log(fmt.status('PASS', `Backlog classification: ${fallback.classification}`));
}

/**
 * When a mission records a non-primary base, verify that base branch exists
 * locally so `px integrate` does not fail silently at landing time.
 */
function checkRecordedBaseBranch(slug: string, cwd: string, verdict: PreflightVerdict, deps: any, log: Function): void {
  const { resolveMissionBaseBranchFn, getPrimaryBranchFn, runFn } = deps;
  const primaryBranch = getPrimaryBranchFn();
  let recordedBase: string | null;
  try { recordedBase = resolveMissionBaseBranchFn(slug, cwd); } catch (_) { recordedBase = null; }
  if (!recordedBase || recordedBase === primaryBranch) { return; }
  const checkResult = runFn(['-C', cwd, 'show-ref', '--verify', '--quiet', `refs/heads/${recordedBase}`], { cwd });
  if (checkResult && checkResult.status === 0) {
    log(fmt.status('PASS', `Preflight: base branch '${recordedBase}' exists locally.`));
    return;
  }
  log(fmt.status('FAIL', `Preflight: base branch '${recordedBase}' recorded in MISSION.md does not exist locally. Create or fetch the '${recordedBase}' base branch before starting this mission.`));
  verdict.fail = true;
}

function checkMissionDocs(slug: string, cwd: string, verdict: PreflightVerdict, deps: any, log: Function): void {
  const { findMissionDirFn, findCheckpointsFn, getFirstLineFn, getMissionYearFn, fsExistsSync } = deps;
  const missionDir = findMissionDirFn(slug, cwd);
  if (!missionDir) {
    log(fmt.status('FAIL', `Mission doc: directory not found in docs/missions/${getMissionYearFn(slug)}/ for slug ${fmt.slug(slug)}`));
    verdict.fail = true;
    return;
  }
  if (!fsExistsSync(path.join(missionDir, 'MISSION.md'))) {
    log(fmt.status('FAIL', `Mission doc: found directory but MISSION.md is missing in ${fmt.path(missionDir)}`));
    verdict.fail = true;
    return;
  }
  const checkpoints = findCheckpointsFn(missionDir);
  if (checkpoints.length > 0) {
    const lastCP = checkpoints[checkpoints.length - 1];
    log(fmt.status('PASS', `Mission doc: found MISSION.md. Most recent checkpoint: ${fmt.path(path.basename(lastCP))} (${getFirstLineFn(lastCP)})`));
  } else {
    log(fmt.status('WARN', `Mission doc: found MISSION.md but no checkpoints yet. Start from CP-1.`));
  }
  checkRecordedBaseBranch(slug, cwd, verdict, deps, log);
}

/** Informational only: any PR state is a usable startup state. */
function reportForgejoPr(pr: any, log: Function): void {
  if (!pr.exists) { log(fmt.status('PASS', `Forgejo PR: no PR found (ready for startup)`)); return; }
  if (pr.state === 'open') { log(fmt.status('PASS', `Forgejo PR: found OPEN PR (#${pr.number})`)); return; }
  log(fmt.status('PASS', `Forgejo PR: found ${pr.state ? pr.state.toUpperCase() : 'UNKNOWN'} PR (#${pr.number})`));
}

function startupPreflight(args: string[], opts: { log?: Function, error?: Function, cwdFn?: Function, getCurrentBranchFn?: Function, resolveTaskFileFn?: Function, getTaskStatusFn?: Function, toVirtualFn?: Function, findMissionDirFn?: Function, findCheckpointsFn?: Function, getFirstLineFn?: Function, inferSlugFn?: Function, getMissionYearFn?: Function, conventionalWorktreePathFn?: Function, getLastCommitFn?: Function, getPrStatusFn?: Function, evaluateRepositoryReadinessFn?: Function, evaluateReviewSetupFn?: Function, adapterChecklistFn?: Function, resolveMissionClassificationFn?: Function, isForgejoReviewEnabledFn?: Function, fsExistsSync?: Function, resolveMissionBaseBranchFn?: Function, getPrimaryBranchFn?: Function, gitFn?: Function, command?: string, returnResult?: boolean, quiet?: boolean } = {}) {
  const baseLog = opts.log || fmt.log.plain;
  // `quiet` suppresses routine PASS diagnostics and the preflight header while
  // keeping every FAIL/WARN line. The NOT-USABLE verdict survives (it is a
  // FAIL); the routine PASS USABLE verdict is dropped with other PASS lines
  // (SC4), which is why the assertion below checks it is absent, not present. The
  // `active` command opts in so its normal path leads with the operator story
  // (mission -> implementer -> live work) instead of a PWD/branch/backlog dump;
  // draft, review and verify-env keep the full diagnostic preflight.
  const quiet = Boolean(opts.quiet);
  const log = quiet
    ? ((msg: unknown) => {
      // Some lines (the final verdict) are prefixed with a newline, so allow
      // leading whitespace before the status tag.
      if (/^\s*\[PASS\]/.test(fmt.stripAnsi(String(msg)))) {return;}
      baseLog(msg);
    })
    : baseLog;
  const error = opts.error || fmt.log.plainError;
  const explicitBranchFn = opts.getCurrentBranchFn;
  let branchRoot: string | null = null;
  const resolveCwd = (): string => {
    if (opts.cwdFn) {return opts.cwdFn();}
    // Execute preflight validates the checked-out mission worktree, so resolve
    // it from the slug here instead of the caller passing it: this keeps the
    // injected resolveWorktree seam untriggered (the use case resolves the
    // worktree itself after preflight) and drops the direct git import.
    if (!isVerifyOnly && slug) {
      const resolved = resolveWorktree(slug);
      if (resolved) {
        branchRoot = resolved;
        return resolved;
      }
    }
    return process.cwd();
  };
  const getCurrentBranchFn = explicitBranchFn ?? (() => getCurrentBranch(branchRoot ?? process.cwd()));
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
  } else if (!quiet) {
    log(fmt.status('INFO', `Running mission startup preflight for: ${fmt.slug(slug)}`));
  }

  const verdict: PreflightVerdict = { fail: false, remediationSteps: [] };

  // Check 1: PWD
  const cwd = resolveCwd();
  checkWorktreePath(cwd, slug, isVerifyOnly, verdict, conventionalWorktreePathFn, log);

  // Check 2: Branch
  checkMissionBranch(getCurrentBranchFn(), slug, isVerifyOnly, verdict, log);

  if (isVerifyOnly) {
    reportRepositoryReadiness(cwd, { evaluateRepositoryReadinessFn, evaluateReviewSetupFn, adapterChecklistFn }, verdict, log);
  }

  // Check 3: Backlog task
  if (slug) {
    checkBacklogTask(slug, cwd, isVerifyOnly, verdict, { resolveTaskFileFn, getTaskStatusFn, toVirtualFn, resolveMissionClassificationFn }, log);
  }

  // Check 4: Mission docs + base branch
  if (!isVerifyOnly) {
    checkMissionDocs(slug, cwd, verdict, {
      findMissionDirFn, findCheckpointsFn, getFirstLineFn, getMissionYearFn, fsExistsSync,
      resolveMissionBaseBranchFn, getPrimaryBranchFn, runFn,
    }, log);
  }

  // Check 5: Last commit
  const lastCommit = getLastCommitFn();
  log(fmt.status('PASS', `Last commit: ${fmt.sha(lastCommit.sha.substring(0, 8))} - ${lastCommit.subject} (${lastCommit.date})`));

  // Check 6: Forgejo PR (skipped when review provider is not forgejo)
  if (!isVerifyOnly && isForgejoReviewEnabledFn(cwd)) {
    reportForgejoPr(getPrStatusFn(`mission/${slug}`), log);
  }

  const overallFail = verdict.fail;
  const remediationSteps = verdict.remediationSteps;
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

(startupPreflight as any).completePreflightOrExit = completePreflightOrExit;

export default startupPreflight;
export { startupPreflight, completePreflightOrExit };
