
import { performance } from 'node:perf_hooks';

import { type DraftAdapterDependencies } from './draft-adapter-types.js';

import type { DraftWorkflowContext } from '../../../application/ports/cli-workflows.js';
import * as path from 'node:path';
import * as fmt from '../../../application/presentation/cli-format.js';

import { resolveTaskFile, reportTaskResolution, checkBacklogIntegrity, getTaskStorage } from '../../backlog/backlog.js';
import { inferSlug, resolveMainRepo, conventionalWorktreePath, getPrimaryBranch, missionBranchName, detectLaunchBaseBranch } from '../../filesystem/mission-utils.js';

import { ensureStandaloneMissionBaseline } from '../../config/product-config.js';
import { ensureWorkflowGitignore } from '../../filesystem/gitignore.js';

import { allocateAdhocIdentity } from '../../sqlite/adhoc-counter.js';

import { resolveDraftTarget, ensureMissionBranch, ensureWorktree, ensureGraphifyWorkspace, ensureGraphifyIgnore, ensureMissionFile, ensureDraftRepoConfigCommitted, ensureRepoExists, bootstrapBacklogTask } from './draft-setup.js';
import { validateDraftClassification } from './draft-prompts.js';

import { runPreDraftHook } from '../../process/pre-draft-hook.js';

import { boundedFailureOutput, describePreparationTiming, flagValue, allocateAdhocDraftTarget, isDbOwnedMission, validateDraftTask } from './draft-workflow-support.js';
import { detailRows } from './draft-completion.js';

import type { DraftWorkflowEnvironment } from './draft-workflow-adapter.js';
export async function draftPreflight(environment: DraftWorkflowEnvironment, args: string[], options: Record<string, unknown> = {}): Promise<DraftWorkflowContext> {
  const { deps, exitFn, logFn, errorFn, exitedContext, safeExit } = environment;
  const merged: DraftAdapterDependencies = { ...deps, ...options };
  const { inferSlugFn, resolveMainRepoFn, ensureRepoExistsFn, ensureStandaloneMissionBaselineFn, ensureDraftRepoConfigCommittedFn, detectLaunchBaseBranchFn, resolveTaskFileFn, reportTaskResolutionFn, checkBacklogIntegrityFn, allocateAdhocIdentityFn } = preflightBindings(merged);
  const explicitInput = args[0];
  const draftTarget = resolveDraftTarget(explicitInput) || { slug: inferSlugFn(explicitInput), syntheticTask: null };
  let slug = draftTarget.slug;
  if (!slug) {
    errorFn(fmt.status('FAIL', 'Usage: px draft <slug> [--agent <family>]'));
    safeExit(1);
    return exitedContext({ slug: '', options });
  }

  let normalizedSlug = slug.toLowerCase();
  let syntheticTask = draftTarget.syntheticTask;

  const preselectedAgent = flagValue(args, '--agent', 'agent', errorFn, exitFn);
  environment.startedAtMs = Date.now();

  const mainRepo = resolveMainRepoFn(merged.configuration);
  if (ensureRepoExistsFn(mainRepo, exitFn, errorFn) === false) {
    return exitedContext({ slug: normalizedSlug, mainRepo, options });
  }

  // Free-text adhoc intake gets a DB-owned, repository-scoped identity
  // (task-2468): the `adhoc-<text>` slug is replaced by `px-<NNNN>`
  // minted from a per-repository counter, so slug, mission id, branch, and
  // worktree suffix stay one derivable identity with no content hash.
  // Re-entering an existing DB-owned identity (F6) skips allocation: the
  // counter is monotonic and repository-scoped, so a re-run reuses the
  // minted identity instead of minting a second mission/branch/worktree.
  const allocatedTarget = allocateAdhocDraftTarget(draftTarget, syntheticTask, slug, mainRepo, allocateAdhocIdentityFn, errorFn, exitFn);
  if (!allocatedTarget) { return exitedContext({ slug, mainRepo, options }); }
  slug = allocatedTarget.slug;
  normalizedSlug = slug.toLowerCase();
  syntheticTask = allocatedTarget.syntheticTask;

  // Announced only after adhoc allocation: free text drafts under a
  // placeholder slug and is then minted a repository-scoped identity, so
  // announcing earlier names a mission that never existed.
  logFn(fmt.bold(`Drafting mission ${fmt.slug(normalizedSlug)}`));

  if (!prepareDraftBaseline(mainRepo, { ensureStandaloneMissionBaselineFn, ensureDraftRepoConfigCommittedFn }, environment)) { return exitedContext({ slug: normalizedSlug, mainRepo, options }); }

  // Where the mission is launched *from*. The CLI means "the directory the
  // operator ran `px draft` in", which is how a feature-branch mission is
  // detected. A long-running board backend has no such intent: it may have
  // been started in any worktree, so it anchors to the primary checkout
  // rather than inheriting whatever directory the server happens to sit in.
  const launchContext = draftLaunchBranch(merged, mainRepo, detectLaunchBaseBranchFn, environment);
  if (!launchContext) { return exitedContext({ slug: normalizedSlug, mainRepo, options }); }
  const { launchDir, recordedBase } = launchContext;

  const taskLookupRoot = recordedBase ? launchDir : mainRepo;
  // Probe the operator store for an existing DB-owned mission before the
  // task-file gate. A web/board-created px-XXXX with persisted planning
  // fields has no Backlog task file by design; recognizing it here lets the
  // draft proceed under the same identity instead of bailing "not found".
  const dbOwned = await isDbOwnedMission(normalizedSlug, mainRepo, merged);
  if (!validateDraftTask(taskLookupRoot, normalizedSlug, syntheticTask, dbOwned, resolveTaskFileFn, reportTaskResolutionFn, checkBacklogIntegrityFn, errorFn, logFn)) {
    safeExit(1);
    return exitedContext({ slug: normalizedSlug, mainRepo, options });
  }

  return {
    exited: false,
    slug: normalizedSlug,
    mainRepo,
    targetWorktree: '',
    missionFile: '',
    recordedBase,
    syntheticTask,
    dbOwned,
    agent: preselectedAgent || '',
    actualAgent: null,
    agentResult: null,
    exitFn,
    logFn,
    errorFn,
    missionServicesFn: merged.missionServicesFn || (() => { throw new Error('draft command requires injected mission services'); }),
    options: merged,
  };
}

export function draftSetup(environment: DraftWorkflowEnvironment, ctx: DraftWorkflowContext): DraftWorkflowContext {
  const { logFn, errorFn, debugFn, plumbingLogFn, exitedContext, safeExit } = environment;
  const merged = ctx.options as DraftAdapterDependencies;
  const ensureMissionBranchFn = merged.ensureMissionBranchFn || ensureMissionBranch;
  const ensureWorktreeFn = merged.ensureWorktreeFn || ensureWorktree;
  const ensureGraphifyWorkspaceFn = merged.ensureGraphifyWorkspaceFn || ensureGraphifyWorkspace;
  const ensureGraphifyIgnoreFn = merged.ensureGraphifyIgnoreFn || ensureGraphifyIgnore;
  const conventionalWorktreePathFn = merged.conventionalWorktreePathFn || conventionalWorktreePath;
  const missionBranchNameFn = missionBranchName;

  const branchName = missionBranchNameFn(ctx.slug, ctx.mainRepo);
  debugFn(fmt.bold(`Step 1: Setting up branch ${fmt.branch(branchName)}...`));
  ensureMissionBranchFn(ctx.mainRepo, branchName, { logFn: plumbingLogFn, baseBranch: ctx.recordedBase });

  const targetWorktree = conventionalWorktreePathFn(ctx.slug, ctx.mainRepo);
  // Branch and worktree are trust information: they tell the operator where
  // this mission is going to live before an agent touches anything. Four
  // numbered plumbing steps are not; they stay on DEBUG.
  logFn(detailRows([
    ['branch', fmt.branch(branchName)],
    ['worktree', fmt.path(targetWorktree)],
  ]));
  debugFn(fmt.bold(`Step 2: Ensuring dedicated worktree at ${fmt.path(targetWorktree)}...`));
  const prepareStartedAt = performance.now();
  ensureWorktreeFn(ctx.mainRepo, targetWorktree, branchName, { logFn: plumbingLogFn, errorFn });
  const worktreeMs = Math.round(performance.now() - prepareStartedAt);
  // Prepare the worktree before any agent or gate runs in it. A failure is
  // the environment's, not the implementer's: stop here instead of letting
  // every later gate fail on what the checkout never had.
  const hook = (merged.runPreDraftHookFn || runPreDraftHook)({ slug: ctx.slug, worktree: targetWorktree, logFn });
  if (hook.ran && !hook.ok) {
    if (hook.output) { errorFn(boundedFailureOutput(hook)); }
    errorFn(fmt.status('FAIL', `Environment failure: the pre-draft hook \`${hook.command}\` exited with status ${hook.exitCode} in ${fmt.path(targetWorktree)}.`));
    logFn('Repair: fix the worktree environment or adapters.draft.preDraftCommand in workflow.config.json, then re-run the draft. No agent was launched.');
    safeExit(1);
    return exitedContext({ ...ctx, targetWorktree, branchName });
  }
  if (hook.ran) {
    debugFn(fmt.status('PASS', `Pre-draft hook \`${hook.command}\` prepared ${fmt.path(targetWorktree)}.`));
    logFn(describePreparationTiming(worktreeMs, hook));
  }
  ensureGraphifyWorkspaceFn(targetWorktree, ctx.mainRepo, { logFn: plumbingLogFn });
  ensureGraphifyIgnoreFn(targetWorktree, { logFn: plumbingLogFn });

  const gitignoreResult = ensureWorkflowGitignore(targetWorktree, { logFn: plumbingLogFn });
  if (gitignoreResult.created) {
    debugFn(fmt.status('PASS', `Created .gitignore with ${gitignoreResult.appended} workflow entries in ${fmt.path(targetWorktree)}`));
  } else if (gitignoreResult.appended > 0) {
    debugFn(fmt.status('PASS', `Appended ${gitignoreResult.appended} workflow entries to .gitignore in ${fmt.path(targetWorktree)}`));
  } else if (gitignoreResult.skipped) {
    logFn(fmt.status('INFO', `.gitignore in ${fmt.path(targetWorktree)}: ${gitignoreResult.reason === 'symlink' ? 'symbolic link (skipped)' : 'not a git repo (skipped)'}`));
  } else {
    debugFn(fmt.status('PASS', `.gitignore in ${fmt.path(targetWorktree)} already contains all workflow entries`));
  }

  return { ...ctx, targetWorktree, branchName, missionFile: ctx.missionFile };
}

export function draftScaffold(environment: DraftWorkflowEnvironment, ctx: DraftWorkflowContext): DraftWorkflowContext {
  const { logFn, errorFn, debugFn, plumbingLogFn, exitedContext, safeExit } = environment;
  const merged = ctx.options as DraftAdapterDependencies;
  const ensureMissionFileFn = merged.ensureMissionFileFn || ensureMissionFile;
  const bootstrapBacklogTaskFn = merged.bootstrapBacklogTaskFn || bootstrapBacklogTask;

  debugFn(fmt.bold('Step 3: Preparing typed mission contract...'));
  const missionFile = ensureMissionFileFn(ctx.targetWorktree, ctx.slug, { logFn: plumbingLogFn });

  // A DB-owned (web/board-created) mission has no Backlog task file by
  // design and is DB-authoritative, so skip the Backlog mirror bootstrap
  // entirely rather than creating or bootstrapping one.
  if (ctx.dbOwned) {
    debugFn(fmt.status('PASS', 'DB-owned mission: no Backlog task file; lifecycle is DB-authoritative.'));
    return { ...ctx, missionFile };
  }

  debugFn(fmt.bold('Step 4: Ensuring Backlog task exists in worktree...'));
  if (!bootstrapBacklogTaskFn(ctx.targetWorktree, ctx.mainRepo, ctx.slug, { logFn: plumbingLogFn, errorFn, syntheticTask: ctx.syntheticTask })) {
    const { tasksDir } = getTaskStorage(ctx.targetWorktree);
    const taskDirHint = path.relative(ctx.targetWorktree, tasksDir).split(path.sep).join('/');
    errorFn(fmt.status('FAIL', `Backlog task for ${ctx.slug} could not be prepared in the mission worktree.`));
    logFn(`Repair: create the task with your task adapter, or add ${fmt.path(`${taskDirHint}/${ctx.slug} - <title>.md`)} manually.`);
    safeExit(1);
    return exitedContext({ ...ctx, missionFile });
  }

  // Validate classification after task is bootstrapped in worktree.
  // At draft start the classification is intentionally unset (the draft
  // prompt instructs the agent to set it), so a missing classification must
  // not surface a [FAIL] status line here. The hard gate runs later in
  // postProcess via normalizeDraftClassification (ADR 0048). Suppress only
  // the premature missing-classification status; any other errorFn output
  // (e.g. an invalid-classification throw, which returns ok:false) still
  // surfaces before the scaffold safeExits.
  const suppressDraftStartClassificationFail = (message: string) => {
    if (/Missing or invalid classification|Mission .* is absent from the px database/i.test(message)) {
      return;
    }
    errorFn(message);
  };
  const validateDraftClassificationFn = merged.validateDraftClassificationFn || validateDraftClassification;
  const classificationCheck = validateDraftClassificationFn(ctx.slug, ctx.targetWorktree, {
    configuration: merged.configuration,
    errorFn: suppressDraftStartClassificationFail
  });
  if (!classificationCheck.ok) {
    safeExit(1);
    return exitedContext({ ...ctx, missionFile });
  }

  debugFn('\n' + fmt.status('PASS', 'Draft setup complete.'));
  debugFn(`Worktree: ${fmt.path(ctx.targetWorktree)}`);
  debugFn(`Contract: ${fmt.command(`px status ${ctx.slug}`)}`);

  return { ...ctx, missionFile };
}

function preflightBindings(merged: DraftAdapterDependencies) {
  const inferSlugFn = merged.inferSlugFn || inferSlug;
  const resolveMainRepoFn = merged.resolveMainRepoFn || resolveMainRepo;
  const ensureRepoExistsFn = merged.ensureRepoExistsFn || ensureRepoExists;
  const ensureStandaloneMissionBaselineFn = merged.ensureStandaloneMissionBaselineFn || ensureStandaloneMissionBaseline;
  const ensureDraftRepoConfigCommittedFn = merged.ensureDraftRepoConfigCommittedFn || ensureDraftRepoConfigCommitted;
  const detectLaunchBaseBranchFn = merged.detectLaunchBaseBranchFn || detectLaunchBaseBranch;
  const resolveTaskFileFn = merged.resolveTaskFileFn || resolveTaskFile;
  const reportTaskResolutionFn = merged.reportTaskResolutionFn || reportTaskResolution;
  const checkBacklogIntegrityFn = merged.checkBacklogIntegrityFn || checkBacklogIntegrity;
  const allocateAdhocIdentityFn = merged.allocateAdhocIdentityFn || ((repositoryId: string) => allocateAdhocIdentity(repositoryId, { configuration: merged.configuration }));

  return { inferSlugFn, resolveMainRepoFn, ensureRepoExistsFn, ensureStandaloneMissionBaselineFn, ensureDraftRepoConfigCommittedFn, detectLaunchBaseBranchFn, resolveTaskFileFn, reportTaskResolutionFn, checkBacklogIntegrityFn, allocateAdhocIdentityFn };
}

function prepareDraftBaseline(mainRepo: string, bindings: Pick<ReturnType<typeof preflightBindings>, 'ensureStandaloneMissionBaselineFn' | 'ensureDraftRepoConfigCommittedFn'>, environment: DraftWorkflowEnvironment): boolean {
  const { ensureStandaloneMissionBaselineFn, ensureDraftRepoConfigCommittedFn } = bindings;
  const { errorFn, debugFn, safeExit } = environment;
  const baselineResult = ensureStandaloneMissionBaselineFn(mainRepo);
  if (baselineResult && baselineResult.failed) {
    errorFn(fmt.status('FAIL', `Standalone mission baseline: ${baselineResult.message}`));
    safeExit(1);
    return false;
  }
  if (baselineResult && baselineResult.committed) {
    debugFn(fmt.status('PASS', 'Standalone mission baseline committed in the primary checkout.'));
  }

  if (!ensureDraftRepoConfigCommittedFn(mainRepo, { errorFn })) {
    safeExit(1);
    return false;
  }

  return true;
}

function draftLaunchBranch(merged: DraftAdapterDependencies, mainRepo: string, detectLaunchBaseBranchFn: typeof detectLaunchBaseBranch, environment: DraftWorkflowEnvironment) {
  const { errorFn, safeExit, logFn } = environment;
  const cwdFn = merged.cwdFn || (() => process.cwd());
  const launchDir = merged.anchorLaunchDirToMainRepo ? mainRepo : cwdFn();

  let launchBase: string | null = null;
  try {
    launchBase = detectLaunchBaseBranchFn(launchDir);
  } catch (error) {
    errorFn(fmt.status('FAIL', (error instanceof Error ? error.message : String(error))));
    safeExit(1);
    return null;
  }
  let recordedBase: string | null = null;
  if (launchBase && launchBase !== getPrimaryBranch(mainRepo)) {
    recordedBase = launchBase;
    logFn(fmt.status('INFO', `Feature-branch mission: base branch detected as ${fmt.branch(recordedBase)}.`));
  }

  return { launchDir, recordedBase };
}
