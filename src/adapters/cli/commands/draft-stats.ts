// @ts-nocheck
import type { DraftWorkflowPort, DraftWorkflowContext } from '../../../application/ports/cli-workflows.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as fmt from '../../../application/presentation/cli-format.js';
import { startDraftAgent, selectAgent, readAgentConfigOrExit } from '../../agents/agents.js';
import { resolveTaskFile, reportTaskResolution, checkBacklogIntegrity, transitionTask, getTaskStatus, getTaskStorage, getTaskLabels, syncTaskLabelsToBaseWorktree } from '../../backlog/backlog.js';
import { inferSlug, resolveMainRepo, conventionalWorktreePath, resolveWorktree, getPrimaryBranch, missionBranchName, detectLaunchBaseBranch } from '../../filesystem/mission-utils.js';
import { transitionVirtual } from '../../config/state-map.js';
import * as stats from './stats.js';
import { ensureStandaloneMissionBaseline, resolveAgentModel } from '../../config/product-config.js';
import { ensureWorkflowGitignore } from '../../filesystem/gitignore.js';
import { missionId } from '../../../domain/mission.js';
import { resolveDraftTarget, ensureMissionBranch, ensureMissionBaseBranchRecorded, ensureWorktree, ensureGraphifyWorkspace, ensureGraphifyIgnore, ensureMissionFile, ensureDraftRepoConfigCommitted, ensureRepoExists, bootstrapBacklogTask } from './draft-setup.js';
import { buildDraftPrompt, buildRestartPrompt, validateDraftClassification, normalizeDraftClassification } from './draft-prompts.js';
import { enforceDraftCommitSafety } from './draft-conflicts.js';

async function recordDraftImplementer({
  // @ts-expect-error implicit any binding elements
  selected,
  // @ts-expect-error implicit any binding elements
  actual,
  // @ts-expect-error implicit any binding elements
  taskResolution,
  log = fmt.log.plain,
  transitionTaskFn = transitionTask,
  getTaskStatusFn = getTaskStatus,
  // @ts-expect-error implicit any binding elements
  slug,
  // @ts-expect-error implicit any binding elements
  worktree
}) {
  if (!taskResolution || !taskResolution.ok || !actual) {
    return actual || selected;
  }

  if (selected && actual !== selected) {
    log(fmt.status('INFO', `Draft agent fell back from ${fmt.agent(selected)} to ${fmt.agent(actual)}; enforcing backlog assignee.`));
  } else {
    log(fmt.status('INFO', `Enforcing draft agent ${fmt.agent(actual)} as assignee...`));
  }

  const currentStatus = getTaskStatusFn(taskResolution.taskFile);
  if (!currentStatus || !await transitionTaskFn(slug, currentStatus, {
    implementer: actual,
    rootDir: worktree || resolveWorktree(slug) || process.cwd(),
    log,
  })) {
    log(fmt.status('WARN', `Could not enforce draft agent ${fmt.agent(actual)} in backlog task.`));
  }
  return actual;
}

/**
 * Record a draft-stage stats row after the draft agent completes. Token/usage
 * columns come from the agent result's telemetry (currently Codex only); other
 * families record honest zeros with provider/model set to the family name.
 * Best-effort: a failure here must never fail the draft.
 */
// @ts-expect-error implicit any on slug/rootDir/agentFamily/result
function recordDraftStats({ slug, rootDir, agentFamily, result, log = fmt.log.plain }) {
  if (!result) {return;}
  let durationMinutes = 0;
  if (result.startedAt && result.endedAt) {
    durationMinutes = (Date.parse(result.endedAt) - Date.parse(result.startedAt)) / 60000;
  }
  try {
    const { row } = stats.recordStageStats({
      slug,
      stage: 'draft',
      rootDir,
      implementer: agentFamily,
      model: resolveAgentModel(agentFamily, rootDir),
      telemetry: result.telemetry || null,
      durationMinutes,
    });
    log(fmt.status('INFO', `Draft stats recorded: ${slug} stage=draft provider=${row.provider} model=${row.model} input_tokens=${row.input_tokens} tool_calls=${row.tool_calls}`));
  } catch (err) {
    // Best-effort: never escalate to the fatal `error` channel.
    log(fmt.status('WARN', `Could not record draft stats for ${slug}: ${/** @type {any} */ (err).message}`));
  }
}

/** @type {typeof draft & {draft: typeof draft, runDraftCommand: typeof runDraftCommand, recordDraftStats: typeof recordDraftStats, buildDraftPrompt: typeof buildDraftPrompt, recordDraftImplementer: typeof recordDraftImplementer, enforceDraftCommitSafety: typeof enforceDraftCommitSafety, fallbackDraftCommitMessage: typeof fallbackDraftCommitMessage, bootstrapBacklogTask: typeof bootstrapBacklogTask, ensureGraphifyWorkspace: typeof ensureGraphifyWorkspace, ensureGraphifyIgnore: typeof ensureGraphifyIgnore, ensureMissionBranch: typeof ensureMissionBranch, ensureMissionBaseBranchRecorded: typeof ensureMissionBaseBranchRecorded, ensureWorktree: typeof ensureWorktree, ensureMissionFile: typeof ensureMissionFile, ensureDraftRepoConfigCommitted: typeof ensureDraftRepoConfigCommitted, ensureRepoExists: typeof ensureRepoExists, classifyDraftEntries: typeof classifyDraftEntries, isUnmergedStatus: typeof isUnmergedStatus, isDeletedStatus: typeof isDeletedStatus, isMissionTaskPath: typeof isMissionTaskPath, isExpectedDraftPath: typeof isExpectedDraftPath, validateDraftClassification: typeof validateDraftClassification, normalizeDraftClassification: typeof normalizeDraftClassification, buildRestartPrompt: typeof buildRestartPrompt, restartDraftAgent: typeof restartDraftAgent}} */
/**
 * Create a DraftWorkflowPort implementation backed by the adapter's functions.
 * Each port method performs its actual workflow step using the adapter's helper
 * functions. Composition merges `missionServicesFn` into deps at call time.
 */
// @ts-expect-error return type matches DraftWorkflowPort
function createDraftWorkflowAdapter(deps: Record<string, unknown> = {}) {
  const exitFn = (deps.exitFn || process.exit) as (_code?: number) => never;
  const logFn = (deps.logFn || fmt.log.plain) as (_msg: string) => void;
  const errorFn = (deps.errorFn || fmt.log.plainError) as (_msg: string) => void;

  // Helper to create an "exited" context when a step needs to abort
  function exitedContext(partial: Partial<DraftWorkflowContext>): DraftWorkflowContext {
    return {
      exited: true,
      slug: partial.slug || '',
      mainRepo: partial.mainRepo || '',
      targetWorktree: partial.targetWorktree || '',
      missionFile: partial.missionFile || '',
      recordedBase: partial.recordedBase || null,
      syntheticTask: partial.syntheticTask || null,
      agent: partial.agent || '',
      actualAgent: partial.actualAgent || null,
      agentResult: null,
      exitFn,
      logFn,
      errorFn,
      missionServicesFn: partial.missionServicesFn || ((() => {}) as Function),
      options: partial.options || {},
    } as DraftWorkflowContext;
  }

  // Helper: safe exit — call exitFn but return (for testability)
  function safeExit(code: number): boolean {
    try { exitFn(code); } catch { /* exit may throw in tests */ }
    return true;
  }

  return {
    // Preflight: resolve slug, validate repo, baseline, config, task resolution, classification
    preflight: (args: string[], options: Record<string, unknown> = {}): DraftWorkflowContext => {
      const merged = { ...deps, ...options };
      const inferSlugFn = merged.inferSlugFn || inferSlug;
      const resolveMainRepoFn = merged.resolveMainRepoFn || resolveMainRepo;
      const ensureRepoExistsFn = merged.ensureRepoExistsFn || ensureRepoExists;
      const ensureStandaloneMissionBaselineFn = merged.ensureStandaloneMissionBaselineFn || ensureStandaloneMissionBaseline;
      const ensureDraftRepoConfigCommittedFn = merged.ensureDraftRepoConfigCommittedFn || ensureDraftRepoConfigCommitted;
      const detectLaunchBaseBranchFn = merged.detectLaunchBaseBranchFn || detectLaunchBaseBranch;
      const resolveTaskFileFn = merged.resolveTaskFileFn || resolveTaskFile;
      const reportTaskResolutionFn = merged.reportTaskResolutionFn || reportTaskResolution;
      const checkBacklogIntegrityFn = merged.checkBacklogIntegrityFn || checkBacklogIntegrity;

      const explicitInput = args[0];
      const draftTarget = resolveDraftTarget(explicitInput) || { slug: inferSlugFn(explicitInput), syntheticTask: null };
      const slug = draftTarget.slug;
      if (!slug) {
        errorFn(fmt.status('FAIL', 'Usage: px draft <slug> [--agent <family>]'));
        safeExit(1);
        return exitedContext({ slug: '', options });
      }

      const normalizedSlug = slug.toLowerCase();
      const syntheticTask = draftTarget.syntheticTask;

      // Allow operators to pin the agent family via CLI flag
      function flagValue(arr: string[], flag: string, name: string) {
        const i = arr.indexOf(flag);
        if (i === -1) { return null; }
        const v = arr[i + 1];
        if (!v || v.startsWith('--')) {
          errorFn(fmt.status('FAIL', `Missing value for --${name}. Usage: px draft <slug> --${name} <family>`));
          safeExit(1);
          return null;
        }
        return v;
      }
      const preselectedAgent = flagValue(args, '--agent', 'agent');
      logFn(fmt.bold(`Starting mission draft automation for: ${fmt.slug(normalizedSlug)}`));

      const mainRepo = resolveMainRepoFn();
      if (ensureRepoExistsFn(mainRepo, exitFn, errorFn) === false) {
        return exitedContext({ slug: normalizedSlug, mainRepo, options });
      }

      const baselineResult = ensureStandaloneMissionBaselineFn(mainRepo);
      if (baselineResult && baselineResult.failed) {
        errorFn(fmt.status('FAIL', `Standalone mission baseline: ${baselineResult.message}`));
        safeExit(1);
        return exitedContext({ slug: normalizedSlug, mainRepo, options });
      }
      if (baselineResult && baselineResult.committed) {
        logFn(fmt.status('PASS', 'Standalone mission baseline committed in the primary checkout.'));
      }

      if (!ensureDraftRepoConfigCommittedFn(mainRepo, { errorFn })) {
        safeExit(1);
        return exitedContext({ slug: normalizedSlug, mainRepo, options });
      }

      // Where the mission is launched *from*. The CLI means "the directory the
      // operator ran `px draft` in", which is how a feature-branch mission is
      // detected. A long-running board backend has no such intent: it may have
      // been started in any worktree, so it anchors to the primary checkout
      // rather than inheriting whatever directory the server happens to sit in.
      const cwdFn = (merged.cwdFn || (() => process.cwd())) as () => string;
      const launchDir = merged.anchorLaunchDirToMainRepo ? mainRepo : cwdFn();

      let launchBase: string | null = null;
      try {
        launchBase = detectLaunchBaseBranchFn(launchDir);
      } catch (error) {
        errorFn(fmt.status('FAIL', /** @type {any} */ (error).message));
        safeExit(1);
        return exitedContext({ slug: normalizedSlug, mainRepo, options });
      }
      let recordedBase: string | null = null;
      if (launchBase && launchBase !== getPrimaryBranch(mainRepo)) {
        recordedBase = launchBase;
        logFn(fmt.status('INFO', `Feature-branch mission: base branch detected as ${fmt.branch(recordedBase)}.`));
      }

      const taskLookupRoot = recordedBase ? launchDir : mainRepo;
      const mainResolution = resolveTaskFileFn(normalizedSlug, taskLookupRoot);
      if (!mainResolution.ok && !syntheticTask) {
        reportTaskResolutionFn(mainResolution, normalizedSlug, errorFn);
        safeExit(1);
        return exitedContext({ slug: normalizedSlug, mainRepo, options });
      }

      const relevantIssues = syntheticTask ? [] : checkBacklogIntegrityFn(taskLookupRoot, normalizedSlug);
      if (relevantIssues.length > 0) {
        errorFn(fmt.status('FAIL', `Backlog integrity issues detected for ${normalizedSlug}:`));
        relevantIssues.forEach((issue: any) => {
          if (issue.type === 'duplicate-completed') {
            logFn(`  - ${fmt.path(issue.file)}: task ${fmt.bold(issue.taskId)} already has a canonical copy in ${fmt.path(issue.canonicalFile)}; this backlog/tasks copy is stale.`);
          } else {
            logFn(`  - ${fmt.path(issue.file)}: filename ID (${fmt.bold(issue.filenameId)}) does not match frontmatter ID (${fmt.bold(issue.frontmatterId)})`);
          }
        });
        logFn('Repair: Fix filename/id mismatch, or remove the stale backlog/tasks copy of a completed/archived task, before drafting.');
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
        agent: preselectedAgent || '',
        actualAgent: null,
        agentResult: null,
        exitFn,
        logFn,
        errorFn,
        missionServicesFn: merged.missionServicesFn || ((() => {}) as Function),
        options: merged,
      } as DraftWorkflowContext;
    },

    // Setup: create branch, worktree, graphify workspace, gitignore
    setup: (ctx: DraftWorkflowContext): DraftWorkflowContext => {
      const merged = ctx.options as Record<string, unknown>;
      const ensureMissionBranchFn = merged.ensureMissionBranchFn || ensureMissionBranch;
      const ensureWorktreeFn = merged.ensureWorktreeFn || ensureWorktree;
      const ensureGraphifyWorkspaceFn = merged.ensureGraphifyWorkspaceFn || ensureGraphifyWorkspace;
      const ensureGraphifyIgnoreFn = merged.ensureGraphifyIgnoreFn || ensureGraphifyIgnore;
      const conventionalWorktreePathFn = merged.conventionalWorktreePathFn || conventionalWorktreePath;
      const missionBranchNameFn = missionBranchName;

      const branchName = missionBranchNameFn(ctx.slug, ctx.mainRepo);
      logFn(fmt.bold(`Step 1: Setting up branch ${fmt.branch(branchName)}...`));
      ensureMissionBranchFn(ctx.mainRepo, branchName, { logFn, baseBranch: ctx.recordedBase });

      const targetWorktree = conventionalWorktreePathFn(ctx.slug, ctx.mainRepo);
      logFn(fmt.bold(`Step 2: Ensuring dedicated worktree at ${fmt.path(targetWorktree)}...`));
      ensureWorktreeFn(ctx.mainRepo, targetWorktree, branchName, { logFn, errorFn });
      ensureGraphifyWorkspaceFn(targetWorktree, ctx.mainRepo, { logFn });
      ensureGraphifyIgnoreFn(targetWorktree, { logFn });

      const gitignoreResult = ensureWorkflowGitignore(targetWorktree, { logFn });
      if (gitignoreResult.created) {
        logFn(fmt.status('PASS', `Created .gitignore with ${gitignoreResult.appended} workflow entries in ${fmt.path(targetWorktree)}`));
      } else if (gitignoreResult.appended > 0) {
        logFn(fmt.status('PASS', `Appended ${gitignoreResult.appended} workflow entries to .gitignore in ${fmt.path(targetWorktree)}`));
      } else if (gitignoreResult.skipped) {
        logFn(fmt.status('INFO', `.gitignore in ${fmt.path(targetWorktree)}: ${gitignoreResult.reason === 'symlink' ? 'symbolic link (skipped)' : 'not a git repo (skipped)'}`));
      } else {
        logFn(fmt.status('PASS', `.gitignore in ${fmt.path(targetWorktree)} already contains all workflow entries`));
      }

      return { ...ctx, targetWorktree, missionFile: ctx.missionFile };
    },

    // Scaffold: MISSION.md, base branch record, backlog bootstrap
    scaffold: (ctx: DraftWorkflowContext): DraftWorkflowContext => {
      const merged = ctx.options as Record<string, unknown>;
      const ensureMissionFileFn = merged.ensureMissionFileFn || ensureMissionFile;
      const ensureMissionBaseBranchRecordedFn = merged.ensureMissionBaseBranchRecordedFn || ensureMissionBaseBranchRecorded;
      const bootstrapBacklogTaskFn = merged.bootstrapBacklogTaskFn || bootstrapBacklogTask;

      logFn(fmt.bold('Step 3: Scaffolding MISSION.md...'));
      const missionFile = ensureMissionFileFn(ctx.targetWorktree, ctx.slug, { logFn });
      ensureMissionBaseBranchRecordedFn(missionFile, ctx.recordedBase, { logFn });

      logFn(fmt.bold('Step 4: Ensuring Backlog task exists in worktree...'));
      if (!bootstrapBacklogTaskFn(ctx.targetWorktree, ctx.mainRepo, ctx.slug, { logFn, errorFn, syntheticTask: ctx.syntheticTask })) {
        const { tasksDir } = getTaskStorage(ctx.targetWorktree);
        const taskDirHint = path.relative(ctx.targetWorktree, tasksDir).split(path.sep).join('/');
        errorFn(fmt.status('FAIL', `Backlog task for ${ctx.slug} could not be prepared in the mission worktree.`));
        logFn(`Repair: create the task with your task adapter, or add ${fmt.path(`${taskDirHint}/${ctx.slug} - <title>.md`)} manually.`);
        safeExit(1);
        return exitedContext({ ...ctx, missionFile });
      }

      // Validate classification after task is bootstrapped in worktree
      const validateDraftClassificationFn = merged.validateDraftClassificationFn || validateDraftClassification;
      const classificationCheck = validateDraftClassificationFn(ctx.slug, ctx.targetWorktree, {
        errorFn
      });
      if (!classificationCheck.ok) {
        safeExit(1);
        return exitedContext({ ...ctx, missionFile });
      }

      logFn('\n' + fmt.status('PASS', 'Draft setup complete.'));
      logFn(`Worktree: ${fmt.path(ctx.targetWorktree)}`);
      logFn(`Mission doc: ${fmt.path(missionFile)}`);

      return { ...ctx, missionFile };
    },

    // Intake: materialize mission in SQLite
    intake: async (ctx: DraftWorkflowContext): Promise<DraftWorkflowContext> => {
      const resolveTaskFileFn = (ctx.options as any).resolveTaskFileFn || resolveTaskFile;
      const getTaskLabelsFn = getTaskLabels;

      let missionTitle = ctx.slug;
      try {
        const firstLine = fs.readFileSync(ctx.missionFile, 'utf8').split('\n')[0] || '';
        missionTitle = firstLine.replace(/^#\s*Mission:\s*/i, '').trim() || ctx.slug;
      } catch {
        missionTitle = ctx.slug;
      }
      let taskLabels: string[] = [];
      try {
        const taskResolution = resolveTaskFileFn(ctx.slug, ctx.targetWorktree);
        taskLabels = taskResolution?.ok && taskResolution?.taskFile
          ? getTaskLabelsFn(taskResolution.taskFile)
          : [];
      } catch {
        taskLabels = [];
      }

      let intakeOutcome: any;
      try {
        if (typeof ctx.missionServicesFn !== 'function') { throw new Error('draft command requires injected mission services'); }
        const missionServices = await ctx.missionServicesFn(ctx.targetWorktree);
        intakeOutcome = await missionServices.intake.execute({
          operationId: `draft-intake-${ctx.slug}`,
          missionId: missionId(ctx.slug),
          repositoryId: missionServices.repositoryId,
          title: missionTitle,
          labels: taskLabels,
          rawStatus: 'backlog',
          externalTaskRef: null,
          capabilities: new Set(['mission:intake']),
        });
      } catch (intakeError) {
        errorFn(fmt.status('FAIL', `Mission intake to SQLite failed for ${ctx.slug}: ${/** @type {any} */ (intakeError).message}`));
        logFn('Repair: ensure the operator-local database is reachable, then re-run the draft. The Backlog task was not transitioned.');
        safeExit(1);
        return exitedContext({ ...ctx });
      }

      if (intakeOutcome.status === 'completed') {
        logFn(fmt.status('PASS', `Mission materialized in SQLite (v${intakeOutcome.value.version})`));
      } else if (intakeOutcome.error?.kind === 'conflict') {
        logFn(fmt.status('INFO', `Mission already recorded in SQLite: ${intakeOutcome.error.message}`));
      } else {
        errorFn(fmt.status('FAIL', `Mission intake to SQLite failed for ${ctx.slug}: ${intakeOutcome.error?.message || 'unknown error'}`));
        logFn('Repair: resolve the intake failure above, then re-run the draft. The Backlog task was not transitioned.');
        safeExit(1);
        return exitedContext({ ...ctx });
      }

      return ctx;
    },

    // Transition: backlog task to target status
    transition: async (ctx: DraftWorkflowContext): Promise<DraftWorkflowContext> => {
      const transitionTaskFn = (ctx.options as any).transitionTaskFn || transitionTask;

      if (!await transitionTaskFn(ctx.slug, 'backlog', { rootDir: ctx.targetWorktree, log: ctx.logFn })) {
        errorFn(fmt.status('FAIL', `Could not transition task ${ctx.slug} to backlog status.`));
        safeExit(1);
        return exitedContext({ ...ctx });
      }

      return ctx;
    },

    // Launch agent: read config, select, launch, record
    launchAgent: async (ctx: DraftWorkflowContext): Promise<DraftWorkflowContext> => {
      const merged = ctx.options as Record<string, unknown>;
      const readAgentConfigOrExitFn = merged.readAgentConfigOrExitFn || readAgentConfigOrExit;
      const selectAgentFn = merged.selectAgentFn || selectAgent;
      const startDraftAgentFn = merged.startDraftAgentFn || startDraftAgent;
      const resolveTaskFileFn = merged.resolveTaskFileFn || resolveTaskFile;
      const recordDraftImplementerFn = merged.recordDraftImplementerFn || recordDraftImplementer;
      const recordDraftStatsFn = merged.recordDraftStatsFn || recordDraftStats;

      const agentConfig = readAgentConfigOrExitFn();
      const agent = ctx.agent || selectAgentFn('draft', { config: agentConfig });

      // @ts-expect-error buildDraftPrompt type mismatch
      const prompt = buildDraftPrompt(ctx.slug, { rootDir: ctx.mainRepo, worktree: ctx.targetWorktree || '' });
      logFn('Launching draft agent...');
      const { agent: actualAgent, result } = await startDraftAgentFn({
        prompt,
        // @ts-expect-error worktree not in type
        worktree: ctx.targetWorktree,
        agent
      });
      logFn(`Draft agent family: ${fmt.agent(/** @type {any} */ (actualAgent))}`);

      if (result.error) {
        errorFn(fmt.status('FAIL', `Could not start draft agent (${fmt.agent(/** @type {any} */ (actualAgent))}): ${/** @type {any} */ (result.error).message}`));
        safeExit(1);
        return exitedContext({ ...ctx, agent, actualAgent: actualAgent, agentResult: result });
      }

      if (typeof /** @type {any} */ (result).status === 'number' && /** @type {any} */ (result).status !== 0) {
        errorFn(fmt.status('FAIL', `Draft agent (${fmt.agent(/** @type {any} */ (actualAgent))}) exited with status ${/** @type {any} */ (result).status}.`));
        safeExit(result.status || 1);
        return exitedContext({ ...ctx, agent, actualAgent: actualAgent, agentResult: result });
      }

      const taskResolutionAfter = resolveTaskFileFn(ctx.slug, ctx.targetWorktree);
      recordDraftImplementerFn({
        selected: agent,
        actual: actualAgent,
        taskResolution: taskResolutionAfter,
        slug: ctx.slug,
        worktree: ctx.targetWorktree
      });

      recordDraftStatsFn({
        slug: ctx.slug,
        rootDir: ctx.targetWorktree,
        agentFamily: actualAgent,
        result,
        log: logFn,
        // @ts-expect-error reportTaskResolutionFn accepts extra properties
        error: errorFn
      });

      return { ...ctx, agent, actualAgent: actualAgent, agentResult: result };
    },

    // Post-process: classification normalize, label sync, re-assert base
    postProcess: async (ctx: DraftWorkflowContext): Promise<DraftWorkflowContext> => {
      const merged = ctx.options as Record<string, unknown>;
      const normalizeDraftClassificationFn = merged.normalizeDraftClassificationFn || normalizeDraftClassification;
      const restartDraftAgentFn = merged.restartDraftAgentFn || restartDraftAgent;
      const readAgentConfigOrExitFn = merged.readAgentConfigOrExitFn || readAgentConfigOrExit;
      const resolveTaskFileFn = merged.resolveTaskFileFn || resolveTaskFile;
      const ensureMissionBaseBranchRecordedFn = merged.ensureMissionBaseBranchRecordedFn || ensureMissionBaseBranchRecorded;

      const normalizationResult = normalizeDraftClassificationFn(ctx.slug, ctx.targetWorktree, {
        errorFn
      });
      if (!normalizationResult.ok) {
        logFn(fmt.status('WARN', `Post-draft mission type labels are not valid (${normalizationResult.reason}). Relaunching draft agent to repair them.`));
        const restartOk = await restartDraftAgentFn(ctx.slug, ctx.targetWorktree, {
          logFn,
          errorFn,
          // @ts-expect-error restartDraftAgentFn accepts extra properties
          exitFn,
          readAgentConfigOrExitFn,
        });
        if (!restartOk) {
          safeExit(1);
          return exitedContext({ ...ctx });
        }
        const postRestartNorm = normalizeDraftClassificationFn(ctx.slug, ctx.targetWorktree, {
          errorFn
        });
        if (!postRestartNorm.ok) {
          errorFn(fmt.status('FAIL', `Post-draft mission type labels are still invalid after restart (${postRestartNorm.reason}).`));
          safeExit(1);
          return exitedContext({ ...ctx });
        } else {
          logFn(fmt.status('PASS', `Post-draft mission type labels validated after restart: ${postRestartNorm.classification}`));
        }
      } else {
        logFn(fmt.status('PASS', `Post-draft mission type labels validated: ${normalizationResult.classification}`));
      }

      // Label sync
      try {
        const missionTaskResolution = resolveTaskFileFn(ctx.slug, ctx.targetWorktree);
        if (missionTaskResolution.ok && missionTaskResolution.taskFile) {
          const missionLabels = getTaskLabels(missionTaskResolution.taskFile);
          if (missionLabels.length > 0) {
            const syncOk = syncTaskLabelsToBaseWorktree(ctx.slug, ctx.targetWorktree);
            if (syncOk) {
              logFn(fmt.status('PASS', `Classification labels synced to base worktree: [${missionLabels.join(', ')}]`));
            } else {
              logFn(fmt.status('WARN', `Could not sync labels to base worktree for ${ctx.slug}. Labels remain valid on mission worktree.`));
            }
          }
        }
      } catch (labelSyncError) {
        logFn(fmt.status('WARN', `Label sync skipped: ${/** @type {any} */ (labelSyncError).message}`));
      }

      // Re-assert base branch
      ensureMissionBaseBranchRecordedFn(ctx.missionFile, ctx.recordedBase, { logFn });

      return ctx;
    },

    // Commit safety: capture uncommitted changes
    commitSafety: (ctx: DraftWorkflowContext): DraftWorkflowContext => {
      const enforceDraftCommitSafetyFn = (ctx.options as any).enforceDraftCommitSafetyFn || enforceDraftCommitSafety;

      try {
        enforceDraftCommitSafetyFn({ slug: ctx.slug, worktree: ctx.targetWorktree, logFn, errorFn });
      } catch (error) {
        errorFn(fmt.status('FAIL', /** @type {any} */ (error).message));
        safeExit(1);
        return exitedContext({ ...ctx });
      }

      return ctx;
    },

    // Final transition to 'ready'
    finalTransition: async (ctx: DraftWorkflowContext): Promise<void> => {
      const transitionTaskFn = (ctx.options as any).transitionTaskFn || transitionTask;
      const transitionVirtualFn = (ctx.options as any).transitionVirtualFn || transitionVirtual;

      // Record refinement on the Mission aggregate before the Backlog task
      // moves to ready. Activation demands `refined`, and intake materializes
      // every mission as `backlog`, so without this the persisted aggregate
      // would never leave the backlog and `px active` could not run. Ordering
      // it first keeps the failure story the same as intake's: a database
      // failure leaves the Backlog task where it was.
      try {
        if (typeof ctx.missionServicesFn !== 'function') { throw new Error('draft command requires injected mission services'); }
        const missionServices = await ctx.missionServicesFn(ctx.targetWorktree);
        const refined = await missionServices.lifecycle.transition({
          operationId: `draft-refine-${ctx.slug}`,
          missionId: missionId(ctx.slug),
          capabilities: new Set(['mission:transition']),
          command: { type: 'refine' },
          actor: 'draft',
          occurredAt: new Date().toISOString(),
          idempotencyKey: `${ctx.slug}:refine`,
        });
        if (refined.status !== 'completed') {
          throw new Error(refined.error?.message || 'unknown error');
        }
      } catch (refineError) {
        errorFn(fmt.status('FAIL', `Recording refinement for ${ctx.slug} failed: ${/** @type {any} */ (refineError).message}`));
        logFn('Repair: ensure the operator-local database is reachable, then re-run the draft. The Backlog task was not transitioned to ready.');
        safeExit(1);
        return;
      }

      if (!(await transitionVirtualFn(transitionTaskFn, ctx.slug, 'ready', /** @type {{ rootDir: string, log: Function }} */ ({ rootDir: ctx.targetWorktree, log: ctx.logFn })))) {
        errorFn(fmt.status('FAIL', `Could not transition task ${ctx.slug} to ready status.`));
        safeExit(1);
        return;
      }

      logFn('\n' + fmt.status('INFO', `Next: ${fmt.command(`cd ${ctx.targetWorktree}`)}`));
    },
  } as DraftWorkflowPort;
}



// @ts-expect-error implicit any on slug/worktree
async function restartDraftAgent(slug, worktree, {
  selectAgentFn = selectAgent,
  startDraftAgentFn = startDraftAgent,
  readAgentConfigOrExitFn = readAgentConfigOrExit,
  logFn = fmt.log.plain,
  errorFn = fmt.log.plainError
} = {}) {
  const agentConfig = readAgentConfigOrExitFn();
  const agent = selectAgentFn('draft', { config: agentConfig });

  const prompt = buildRestartPrompt(slug, { rootDir: worktree, worktree });
  logFn('Relaunching draft agent to repair mission type labels...');
  // @ts-expect-error startDraftAgentFn accepts extra properties
  const { agent: actualAgent, result } = await startDraftAgentFn({ prompt, worktree, agent });
  logFn(`Restart draft agent family: ${fmt.agent(/** @type {any} */ (actualAgent))}`);

  if (result.error) {
    errorFn(fmt.status('FAIL', `Could not restart draft agent (${fmt.agent(/** @type {any} */ (actualAgent))}): ${/** @type {any} */ (result.error).message}`));
    return false;
  }

  if (typeof /** @type {any} */ (result).status === 'number' && /** @type {any} */ (result).status !== 0) {
    errorFn(fmt.status('FAIL', `Restart draft agent (${fmt.agent(/** @type {any} */ (actualAgent))}) exited with status ${/** @type {any} */ (result).status}.`));
    return false;
  }

  return true;
}



export { recordDraftStats, recordDraftImplementer, restartDraftAgent, createDraftWorkflowAdapter };
