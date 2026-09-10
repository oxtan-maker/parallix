// @ts-nocheck
import type { DraftWorkflowPort, DraftWorkflowContext } from '../../../application/ports/cli-workflows.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as fmt from '../../../application/presentation/cli-format.js';
import { startDraftAgent, selectAgent, readAgentConfigOrExit, formatElapsed } from '../../agents/agents.js';
import { resolveTaskFile, reportTaskResolution, checkBacklogIntegrity, transitionTask, getTaskStatus, getTaskStorage, getTaskLabels } from '../../backlog/backlog.js';
import { inferSlug, resolveMainRepo, conventionalWorktreePath, resolveWorktree, getPrimaryBranch, missionBranchName, detectLaunchBaseBranch } from '../../filesystem/mission-utils.js';
import { transitionVirtual } from '../../config/state-map.js';
import * as stats from './stats.js';
import { ensureStandaloneMissionBaseline, resolveAgentModel } from '../../config/product-config.js';
import { ensureWorkflowGitignore } from '../../filesystem/gitignore.js';
import { missionId } from '../../../domain/mission.js';
import { allocateAdhocIdentity } from '../../sqlite/adhoc-counter.js';
import { resolveCanonicalRepositoryId } from '../../git/repository-identity.js';
import { resolveDraftTarget, ensureMissionBranch, ensureMissionBaseBranchRecorded, ensureWorktree, ensureGraphifyWorkspace, ensureGraphifyIgnore, ensureMissionFile, ensureDraftRepoConfigCommitted, ensureRepoExists, bootstrapBacklogTask } from './draft-setup.js';
import { buildDraftPrompt, buildRestartPrompt, validateDraftClassification, normalizeDraftClassification } from './draft-prompts.js';
import { enforceDraftCommitSafety } from './draft-conflicts.js';

/**
 * Read the human mission title from the `# Mission: <title>` heading the draft
 * agent writes at the top of MISSION.md. Falls back to the slug when the file is
 * absent or the heading is missing, so presentation never introduces a new
 * failure mode (mission stop rule).
 */
// @ts-expect-error implicit any on missionFile/fallback
function readMissionTitle(missionFile, fallback) {
  try {
    const firstLine = fs.readFileSync(missionFile, 'utf8').split('\n')[0] || '';
    const match = /^#\s*Mission:\s*(.*)$/i.exec(firstLine.trim());
    return (match && match[1].trim()) || fallback;
  } catch {
    return fallback;
  }
}

/**
 * Two-column detail rows for the draft header and summary. `fmt.table` pads its
 * final column, which leaves trailing whitespace on every line an operator
 * copies out of the terminal, so these rows pad only the label.
 */
function detailRows(rows: string[][]): string {
  const width = Math.max(...rows.map(([label]) => label.length));
  return rows.map(([label, value]) => `  ${fmt.dim(label.padEnd(width))}  ${value}`).join('\n');
}

/**
 * Digest of the drafted contract for the closing summary: the Goal section, and
 * how many criteria, checkpoints and gates the operator is about to hold an
 * implementer to. Presentation only — a malformed or missing mission file
 * yields an empty digest rather than a new failure mode (mission stop rule).
 */
// @ts-expect-error implicit any on missionFile
function readMissionDigest(missionFile) {
  try {
    const body = fs.readFileSync(missionFile, 'utf8');
    // Split on top-level headings rather than matching a lookahead: the last
    // section of the file has no following heading to anchor against.
    const sections = new Map();
    let current = '';
    for (const line of body.split('\n')) {
      const heading = /^##\s+(.+?)\s*$/.exec(line);
      if (heading) { current = heading[1].toLowerCase(); sections.set(current, []); continue; }
      if (current) { sections.get(current).push(line); }
    }
    // @ts-expect-error implicit any on heading
    const section = (heading) => (sections.get(heading.toLowerCase()) || []).join('\n').trim();
    // @ts-expect-error implicit any on text/pattern
    const count = (text, pattern) => text.split('\n').filter((line) => pattern.test(line.trim())).length;
    const checkpoints = section('Checkpoints').split(/^###\s/m)[0];
    const nel = /Predicted NEL bucket:\s*(Small|Medium|Large)[^\n)]*\)?/i.exec(body);
    return {
      goal: section('Goal').split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim(),
      // Contracts number their criteria or bullet them; both are one criterion
      // per line. The section's leading blockquote (the falsifiability rule the
      // scaffold carries) starts with `>` and is not counted.
      criteria: count(section('Success Criteria'), /^(?:\d+\.|[-*])\s/),
      checkpoints: count(checkpoints, /^[-*]\s/),
      gates: count(section('Gates'), /^-\s\[/),
      nel: nel ? nel[0].replace(/^Predicted NEL bucket:\s*/i, '') : '',
    };
  } catch {
    return { goal: '', criteria: 0, checkpoints: 0, gates: 0, nel: '' };
  }
}

/** Wrap plain text to `width` columns, indented by two spaces. */
// @ts-expect-error implicit any on text/width
function wrapIndented(text, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && (line + ' ' + word).length > width) { lines.push(`  ${line}`); line = word; }
    else { line = line ? `${line} ${word}` : word; }
  }
  if (line) { lines.push(`  ${line}`); }
  return lines;
}

async function recordDraftImplementer({
  // @ts-expect-error implicit any binding elements
  selected,
  // @ts-expect-error implicit any binding elements
  actual,
  // @ts-expect-error implicit any binding elements
  taskResolution,
  log = fmt.log.plain,
  plumbingLog = log,
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
    plumbingLog(fmt.status('INFO', `Enforcing draft agent ${fmt.agent(actual)} as assignee...`));
  }

  const currentStatus = getTaskStatusFn(taskResolution.taskFile);
  if (!currentStatus || !await transitionTaskFn(slug, currentStatus, {
    implementer: actual,
    rootDir: worktree || resolveWorktree(slug) || process.cwd(),
    log: plumbingLog,
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

  // Internal plumbing (branch/worktree/graphify/.gitignore/SQLite/label/stats
  // bookkeeping) is not the mission result a first-time operator came for, so
  // it is demoted behind the existing DEBUG env gate that `fmt.log.debug` uses.
  // The message text and call order are unchanged; only the transport is gated,
  // so `DEBUG=1` reproduces the pre-change default output verbatim.
  const debugFn = (msg: string): void => { if (process.env.DEBUG) { logFn(msg); } };
  // Wall-clock for the whole draft, reported in the closing summary: a draft is
  // a minutes-long agent run, and how long it took is the first thing an
  // operator asks once it lands.
  let startedAtMs = Date.now();

  // Setup helpers in `draft-setup.ts` emit both success plumbing and genuine
  // WARN/FAIL conditions through the single `logFn` they are handed. Routing
  // them through this splitter demotes only the success lines and keeps every
  // exceptional line on the default path.
  // ponytail: marker-based split on the rendered status tag; the alternative is
  // threading a second log channel through every draft-setup helper signature.
  const plumbingLogFn = (msg: string): void => {
    if (/\[(WARN|FAIL)\]/.test(fmt.stripAnsi(String(msg)))) { logFn(msg); return; }
    debugFn(msg);
  };

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
      const allocateAdhocIdentityFn = merged.allocateAdhocIdentityFn || allocateAdhocIdentity;

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
      startedAtMs = Date.now();

      const mainRepo = resolveMainRepoFn();
      if (ensureRepoExistsFn(mainRepo, exitFn, errorFn) === false) {
        return exitedContext({ slug: normalizedSlug, mainRepo, options });
      }

      // Free-text adhoc intake gets a DB-owned, repository-scoped identity
      // (task-2468): the `adhoc-<text>` slug is replaced by `parallix-adhoc-<NNNN>`
      // minted from a per-repository counter, so slug, mission id, branch, and
      // worktree suffix stay one derivable identity with no content hash.
      // Re-entering an existing DB-owned identity (F6) skips allocation: the
      // counter is monotonic and repository-scoped, so a re-run reuses the
      // minted identity instead of minting a second mission/branch/worktree.
      if (syntheticTask && !draftTarget.existingAdhocIdentity) {
        try {
          const allocated = allocateAdhocIdentityFn(resolveCanonicalRepositoryId(mainRepo));
          slug = allocated.slug;
          normalizedSlug = slug.toLowerCase();
          syntheticTask = { ...syntheticTask, id: allocated.taskId, source: 'adhoc-db-identity' };
        } catch (allocError) {
          errorFn(fmt.status('FAIL', `Could not allocate adhoc mission identity: ${/** @type {any} */ (allocError).message}`));
          safeExit(1);
          return exitedContext({ slug, mainRepo, options });
        }
      }

      // Announced only after adhoc allocation: free text drafts under a
      // placeholder slug and is then minted a repository-scoped identity, so
      // announcing earlier names a mission that never existed.
      logFn(fmt.bold(`Drafting mission ${fmt.slug(normalizedSlug)}`));

      const baselineResult = ensureStandaloneMissionBaselineFn(mainRepo);
      if (baselineResult && baselineResult.failed) {
        errorFn(fmt.status('FAIL', `Standalone mission baseline: ${baselineResult.message}`));
        safeExit(1);
        return exitedContext({ slug: normalizedSlug, mainRepo, options });
      }
      if (baselineResult && baselineResult.committed) {
        debugFn(fmt.status('PASS', 'Standalone mission baseline committed in the primary checkout.'));
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
      ensureWorktreeFn(ctx.mainRepo, targetWorktree, branchName, { logFn: plumbingLogFn, errorFn });
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
    },

    // Scaffold: MISSION.md, base branch record, backlog bootstrap
    scaffold: (ctx: DraftWorkflowContext): DraftWorkflowContext => {
      const merged = ctx.options as Record<string, unknown>;
      const ensureMissionFileFn = merged.ensureMissionFileFn || ensureMissionFile;
      const ensureMissionBaseBranchRecordedFn = merged.ensureMissionBaseBranchRecordedFn || ensureMissionBaseBranchRecorded;
      const bootstrapBacklogTaskFn = merged.bootstrapBacklogTaskFn || bootstrapBacklogTask;

      debugFn(fmt.bold('Step 3: Scaffolding MISSION.md...'));
      const missionFile = ensureMissionFileFn(ctx.targetWorktree, ctx.slug, { logFn: plumbingLogFn });
      ensureMissionBaseBranchRecordedFn(missionFile, ctx.recordedBase, { logFn: plumbingLogFn });

      debugFn(fmt.bold('Step 4: Ensuring Backlog task exists in worktree...'));
      if (!bootstrapBacklogTaskFn(ctx.targetWorktree, ctx.mainRepo, ctx.slug, { logFn: plumbingLogFn, errorFn, syntheticTask: ctx.syntheticTask })) {
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

      debugFn('\n' + fmt.status('PASS', 'Draft setup complete.'));
      debugFn(`Worktree: ${fmt.path(ctx.targetWorktree)}`);
      debugFn(`Mission doc: ${fmt.path(missionFile)}`);

      return { ...ctx, missionFile };
    },

    // Intake: materialize mission in SQLite
    intake: async (ctx: DraftWorkflowContext): Promise<DraftWorkflowContext> => {
      const resolveTaskFileFn = (ctx.options as any).resolveTaskFileFn || resolveTaskFile;
      const getTaskLabelsFn = getTaskLabels;

      const missionTitle = readMissionTitle(ctx.missionFile, ctx.slug);
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
        debugFn(fmt.status('PASS', `Mission materialized in SQLite (v${intakeOutcome.value.version})`));
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

      const transitionOk = await transitionTaskFn(ctx.slug, 'backlog', { rootDir: ctx.targetWorktree, log: plumbingLogFn });
      // Backlog-backed missions keep the strict contract: a task-file transition
      // failure is fatal. A synthetic (adhoc) intake has no Backlog backing in an
      // adhoc-only repository, so its lifecycle is DB-authoritative and the
      // missing task-file transition is a best-effort no-op, not a failure.
      if (!transitionOk && !ctx.syntheticTask) {
        errorFn(fmt.status('FAIL', `Could not transition task ${ctx.slug} to backlog status.`));
        safeExit(1);
        return exitedContext({ ...ctx });
      }
      if (!transitionOk && ctx.syntheticTask) {
        logFn(fmt.status('WARN', `No Backlog task file to transition for ${ctx.slug}; lifecycle is DB-authoritative.`));
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
      logFn('');
      logFn(fmt.bold(`Running ${fmt.agent(agent)} to write the mission contract...`));
      const { agent: actualAgent, result } = await startDraftAgentFn({
        prompt,
        // @ts-expect-error worktree not in type
        worktree: ctx.targetWorktree,
        agent
      });
      debugFn(`Draft agent family: ${fmt.agent(/** @type {any} */ (actualAgent))}`);

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
        worktree: ctx.targetWorktree,
        // An agent fallback stays on the default path; the assignee bookkeeping
        // it performs afterwards does not.
        log: logFn,
        plumbingLog: plumbingLogFn
      });

      recordDraftStatsFn({
        slug: ctx.slug,
        rootDir: ctx.targetWorktree,
        agentFamily: actualAgent,
        result,
        log: plumbingLogFn,
        // @ts-expect-error reportTaskResolutionFn accepts extra properties
        error: errorFn
      });

      return { ...ctx, agent, actualAgent: actualAgent, agentResult: result };
    },

    // Post-process: classification normalize and re-assert base
    postProcess: async (ctx: DraftWorkflowContext): Promise<DraftWorkflowContext> => {
      const merged = ctx.options as Record<string, unknown>;
      const normalizeDraftClassificationFn = merged.normalizeDraftClassificationFn || normalizeDraftClassification;
      const restartDraftAgentFn = merged.restartDraftAgentFn || restartDraftAgent;
      const readAgentConfigOrExitFn = merged.readAgentConfigOrExitFn || readAgentConfigOrExit;
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
          errorFn(fmt.status('FAIL', `Classification validation failed after recovery (${postRestartNorm.reason}).`));
          safeExit(1);
          return exitedContext({ ...ctx });
        } else {
          debugFn(fmt.status('PASS', `Post-draft mission type labels validated after restart: ${postRestartNorm.classification}`));
        }
      } else {
        debugFn(fmt.status('PASS', `Post-draft mission type labels validated: ${normalizationResult.classification}`));
      }

      // Re-assert base branch
      ensureMissionBaseBranchRecordedFn(ctx.missionFile, ctx.recordedBase, { logFn: plumbingLogFn });

      return ctx;
    },

    // Commit safety: capture uncommitted changes
    commitSafety: (ctx: DraftWorkflowContext): DraftWorkflowContext => {
      const enforceDraftCommitSafetyFn = (ctx.options as any).enforceDraftCommitSafetyFn || enforceDraftCommitSafety;

      try {
        enforceDraftCommitSafetyFn({ slug: ctx.slug, worktree: ctx.targetWorktree, logFn, plumbingLogFn, errorFn });
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

      const readyOk = await transitionVirtualFn(transitionTaskFn, ctx.slug, 'ready', /** @type {{ rootDir: string, log: Function }} */ ({ rootDir: ctx.targetWorktree, log: plumbingLogFn }));
      // Best-effort mirror for synthetic (adhoc) intakes: the DB authority
      // records the refinement above, so a missing Backlog task-file transition
      // in an adhoc-only repository is a no-op, not a failure.
      if (!readyOk && !ctx.syntheticTask) {
        errorFn(fmt.status('FAIL', `Could not transition task ${ctx.slug} to ready status.`));
        safeExit(1);
        return;
      }
      if (!readyOk && ctx.syntheticTask) {
        logFn(fmt.status('WARN', `No Backlog task file transition for ${ctx.slug}; lifecycle is DB-authoritative.`));
      }

      // Mission-oriented close-out: what was drafted, how long it took, where
      // to read it, and the one next command. The title is re-read here because
      // the draft agent rewrites MISSION.md after intake captured it.
      const missionTitle = readMissionTitle(ctx.missionFile, ctx.slug);
      logFn('');
      logFn(fmt.status('PASS', `Drafted ${fmt.slug(ctx.slug)} in ${formatElapsed(Date.now() - startedAtMs)}: ${fmt.bold(missionTitle)}`));
      logFn(detailRows([
        ['contract', fmt.path(ctx.missionFile)],
        ['branch', fmt.branch(ctx.branchName || missionBranchName(ctx.slug, ctx.mainRepo))],
        ['agent', fmt.agent(/** @type {any} */ (ctx.actualAgent || ctx.agent || 'unknown'))],
      ]));
      // The contract itself, so the operator does not need a pager to learn what
      // the implementer will be held to. The Goal's first paragraph plus the
      // counts answer that; the full document is one path away, printed above.
      const digest = readMissionDigest(ctx.missionFile);
      if (digest.goal) {
        logFn('');
        logFn(fmt.bold('Goal'));
        const width = Math.max(40, Math.min((process.stdout.columns || 80) - 4, 96));
        for (const line of wrapIndented(digest.goal, width).slice(0, 6)) { logFn(line); }
        const counts = [
          digest.criteria ? `${digest.criteria} success ${digest.criteria === 1 ? 'criterion' : 'criteria'}` : '',
          digest.checkpoints ? `${digest.checkpoints} checkpoint${digest.checkpoints === 1 ? '' : 's'}` : '',
          digest.gates ? `${digest.gates} gate${digest.gates === 1 ? '' : 's'}` : '',
          digest.nel ? `NEL ${digest.nel}` : '',
        ].filter(Boolean);
        if (counts.length > 0) {
          logFn('');
          logFn(`  ${fmt.dim(counts.join(' · '))}`);
        }
      }

      logFn('');
      // The worktree is emitted as `Working directory:` rather than a detail row
      // on purpose: the `px` shell function from `px shell-init`
      // (`src/composition/create-cli.ts`) greps `[INFO] Next: cd ` and, failing
      // that, `[INFO] Working directory: ` to cd the operator into the mission
      // worktree. Dropping the old `Next: cd <worktree>` line without this would
      // silently break that shell integration for `px draft`.
      logFn(fmt.status('INFO', `Working directory: ${ctx.targetWorktree}`));
      logFn(fmt.status('INFO', `Next: ${fmt.command('px active')}`));
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
