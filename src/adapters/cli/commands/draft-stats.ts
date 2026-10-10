import type { ParallixConfiguration } from "../../../application/ports/configuration.js";
import { draftMissionServices, type DraftAdapterDependencies, type DraftLog, type DraftExit, type DraftMissionServices } from './draft-adapter-types.js';
import type { SyntheticDraftTask, DraftTarget } from './draft-setup.js';
import type { MissionIntakeService } from '../../../application/mission-intake-service.js';
import type { StageStatsRequest } from '../../../application/stats-recording-use-case.js';

import type { DraftWorkflowPort, DraftWorkflowContext } from '../../../application/ports/cli-workflows.js';
import * as path from 'node:path';
import * as fmt from '../../../application/presentation/cli-format.js';
import { startDraftAgent, selectAgent, readAgentConfigOrExit, formatElapsed } from '../../agents/agents.js';
import { resolveTaskFile, reportTaskResolution, checkBacklogIntegrity, transitionTask, getTaskStatus, getTaskStorage, getTaskLabels } from '../../backlog/backlog.js';
import { inferSlug, resolveMainRepo, conventionalWorktreePath, resolveWorktree, getPrimaryBranch, missionBranchName, detectLaunchBaseBranch } from '../../filesystem/mission-utils.js';
import { transitionVirtual } from '../../config/state-map.js';
import * as stats from './stats.js';
import { ensureStandaloneMissionBaseline, resolveAgentModel } from '../../config/product-config.js';
import { ensureWorkflowGitignore } from '../../filesystem/gitignore.js';
import { missionLabels, missionId, isDbAdhocIdentity } from '../../../domain/mission.js';
import { allocateAdhocIdentity } from '../../sqlite/adhoc-counter.js';
import { resolveCanonicalRepositoryId } from '../../git/repository-identity.js';
import { resolveDraftTarget, ensureMissionBranch, ensureWorktree, ensureGraphifyWorkspace, ensureGraphifyIgnore, ensureMissionFile, ensureDraftRepoConfigCommitted, ensureRepoExists, bootstrapBacklogTask } from './draft-setup.js';
import { buildDraftPrompt, buildRestartPrompt, buildContractRepairPrompt, validateDraftClassification, normalizeDraftClassification } from './draft-prompts.js';
import { enforceDraftCommitSafety } from './draft-conflicts.js';
import { runPreDraftHook } from '../../process/pre-draft-hook.js';
import { getTaskFrontmatterValue } from '../../backlog/task-file-io.js';

const CLASSIFICATION_LABELS = new Set(['ai_sdlc', 'user_value', 'unknown']);

/** Authoritative post-draft classification check; null means use legacy fallback. */
async function validateStoredDraftClassification(ctx: DraftWorkflowContext) {
  try {
    const services = await draftMissionServices(ctx);
    const loaded = await services.store.load(missionId(ctx.slug));
    if (loaded.kind !== 'found') { return null; }
    const labels = loaded.mission.labels
      .map((label: string) => String(label).toLowerCase())
      .filter((label: string) => CLASSIFICATION_LABELS.has(label));
    return labels.length === 1
      ? { ok: true, classification: labels[0] }
      : { ok: false, reason: 'missing-classification' };
  } catch { return null; }
}

/**
 * Read the display title from the Backlog task mirror during draft setup.
 * Completed drafts use the recorded Mission title.
 */
function readTaskTitle(taskFile: string, fallback: string) {
  try {
    return getTaskFrontmatterValue(taskFile, 'title')?.trim() || fallback;
  } catch { return fallback; }
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
 * Digest of the drafted contract for the closing summary: the goal, and how
 * many success criteria, planned checkpoints and gates the operator is about to hold an implementer
 * to, read from the recorded Mission. Presentation only — an unreadable Mission
 * yields an empty digest rather than a new failure mode (mission stop rule).
 */
async function readMissionDigest(ctx: DraftWorkflowContext) {
  try {
    const services = await draftMissionServices(ctx);
    const loaded = await services.store.load(missionId(ctx.slug));
    if (loaded.kind !== 'found') { return { title: ctx.slug, goal: '', criteria: 0, checkpoints: 0, gates: 0, nel: '' }; }
    const { mission } = loaded;
    return {
      title: mission.title || ctx.slug,
      goal: mission.brief?.goal ?? '',
      criteria: (mission.successCriteria ?? []).length,
      checkpoints: mission.checkpoints.length,
      gates: (mission.declaredGates ?? []).length,
      nel: mission.predictedNelBucket ?? '',
    };
  } catch {
    return { title: ctx.slug, goal: '', criteria: 0, checkpoints: 0, gates: 0, nel: '' };
  }
}

function digestCount(value: number, singular: string, plural: string) {
  return value ? `${value} ${value === 1 ? singular : plural}` : '';
}

function logDraftDigest(digest: Awaited<ReturnType<typeof readMissionDigest>>, logFn: DraftLog) {
  if (digest.goal) {
    logFn('');
    logFn(fmt.bold('Goal'));
    const width = Math.max(40, Math.min((process.stdout.columns || 80) - 4, 96));
    for (const line of wrapIndented(digest.goal, width).slice(0, 6)) { logFn(line); }
    const counts = [
      digestCount(digest.criteria, 'success criterion', 'success criteria'),
      digestCount(digest.checkpoints, 'checkpoint', 'checkpoints'),
      digestCount(digest.gates, 'gate', 'gates'),
      digest.nel ? `NEL ${digest.nel}` : '',
    ].filter(Boolean);
    if (counts.length > 0) {
      logFn('');
      logFn(`  ${fmt.dim(counts.join(' · '))}`);
    }
  }
}

async function logDraftCompletion(ctx: DraftWorkflowContext, startedAtMs: number, logFn: DraftLog) {
  const digest = await readMissionDigest(ctx);
  const missionTitle = digest.title;
  logFn('');
  logFn(fmt.status('PASS', `Drafted ${fmt.slug(ctx.slug)} in ${formatElapsed(Date.now() - startedAtMs)}: ${fmt.bold(missionTitle)}`));
  logFn(detailRows([
    ['contract', fmt.command(`px status ${ctx.slug}`)],
    ['branch', fmt.branch(ctx.branchName || missionBranchName(ctx.slug, ctx.mainRepo))],
    ['agent', fmt.agent(ctx.actualAgent || ctx.agent || 'unknown')],
  ]));
  logDraftDigest(digest, logFn);
  logFn('');
  // The worktree is emitted as `Working directory:` rather than a detail row on
  // purpose: the `px` shell function from `px shell-init`
  // (`src/composition/create-cli.ts`) greps `[INFO] Next: cd ` and, failing that,
  // `[INFO] Working directory: ` to cd the operator into the mission worktree.
  // Changing this string silently breaks that shell integration for `px draft`.
  logFn(fmt.status('INFO', `Working directory: ${ctx.targetWorktree}`));
  logFn(fmt.status('INFO', `Next: ${fmt.command('px active')}`));
}

/** Wrap plain text to `width` columns, indented by two spaces. */
function wrapIndented(text: string, width: number) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && (line + ' ' + word).length > width) { lines.push(`  ${line}`); line = word; }
    else { line = line ? `${line} ${word}` : word; }
  }
  if (line) { lines.push(`  ${line}`); }
  return lines;
}

function flagValue(arr: string[], flag: string, name: string, errorFn: DraftLog, exitFn: DraftExit) {
  const i = arr.indexOf(flag);
  if (i === -1) { return null; }
  const value = arr[i + 1];
  if (!value || value.startsWith('--')) {
    errorFn(fmt.status('FAIL', `Missing value for --${name}. Usage: px draft <slug> --${name} <family>`));
    try { exitFn(1); } catch { /* exit may throw in tests */ }
    return null;
  }
  return value;
}

function allocateAdhocDraftTarget(draftTarget: Pick<DraftTarget, "syntheticTask" | "existingAdhocIdentity">, syntheticTask: SyntheticDraftTask | null, slug: string, mainRepo: string, allocateAdhocIdentityFn: NonNullable<DraftAdapterDependencies['allocateAdhocIdentityFn']>, errorFn: DraftLog, exitFn: DraftExit) {
  if (!syntheticTask || draftTarget.existingAdhocIdentity) { return { slug, syntheticTask }; }
  try {
    const allocated = allocateAdhocIdentityFn(resolveCanonicalRepositoryId(mainRepo));
    return {
      slug: allocated.slug,
      syntheticTask: { ...syntheticTask, id: allocated.taskId, source: 'adhoc-db-identity' },
    };
  } catch (allocError) {
    errorFn(fmt.status('FAIL', `Could not allocate adhoc mission identity: ${(allocError instanceof Error ? allocError.message : String(allocError))}`));
    try { exitFn(1); } catch { /* exit may throw in tests */ }
    return null;
  }
}

/**
 * Whether a mission with this slug already exists in the operator store with
 * persisted planning fields (a web/board-created DB-owned mission). Such a
 * mission has no Backlog task file by design and must draft under its existing
 * identity without allocation or a Backlog mirror.
 *
 * Best-effort: an unavailable store (or any error) is treated as "not
 * DB-owned" so a store hiccup never silently drops the Backlog task-file
 * requirement for a real Backlog-backed mission.
 */
async function isDbOwnedMission(slug: string, mainRepo: string, merged: DraftAdapterDependencies): Promise<boolean> {
  try {
    // Restrict to a DB-owned adhoc identity: a web/board-created `px-<NNNN>`
    // with no Backlog task file. A Backlog-backed `task-<NNNN>` mission already
    // in the store (imported or previously drafted) must keep its Backlog
    // validation, so a bare `store.load` 'found' result is not enough.
    if (!isDbAdhocIdentity(slug)) { return false; }
    if (typeof merged.missionServicesFn !== 'function') { return false; }
    const services = await (merged.missionServicesFn as (_rootDir: string) => Promise<DraftMissionServices>)(mainRepo);
    const loaded = await services.store.load(missionId(slug));
    return loaded.kind === 'found';
  } catch {
    return false;
  }
}

function reportBacklogIntegrityIssues(issues: ReturnType<typeof checkBacklogIntegrity>, normalizedSlug: string, errorFn: DraftLog, logFn: DraftLog) {
  errorFn(fmt.status('FAIL', `Backlog integrity issues detected for ${normalizedSlug}:`));
  for (const issue of issues) {
    if (issue.type === 'duplicate-completed') {
      logFn(`  - ${fmt.path(issue.file)}: task ${fmt.bold(issue.taskId)} already has a canonical copy in ${fmt.path(issue.canonicalFile)}; this backlog/tasks copy is stale.`);
    } else {
      logFn(`  - ${fmt.path(issue.file)}: filename ID (${fmt.bold(issue.filenameId)}) does not match frontmatter ID (${fmt.bold(issue.frontmatterId)})`);
    }
  }
  logFn('Repair: Fix filename/id mismatch, or remove the stale backlog/tasks copy of a completed/archived task, before drafting.');
}

function validateDraftTask(taskLookupRoot: string, normalizedSlug: string, syntheticTask: SyntheticDraftTask | null, dbOwned: boolean, resolveTaskFileFn: typeof resolveTaskFile, reportTaskResolutionFn: typeof reportTaskResolution, checkBacklogIntegrityFn: typeof checkBacklogIntegrity, errorFn: DraftLog, logFn: DraftLog) {
  // A DB-owned mission (a web/board-created px-XXXX with persisted planning
  // fields but no Backlog task file) is DB-authoritative. Like a synthetic
  // adhoc identity, it never had a Backlog task file, so a missing resolution
  // is not a failure and there are no stale files to flag. A Backlog-backed
  // mission still requires its task file.
  if (dbOwned) {
    return true;
  }
  const resolution = resolveTaskFileFn(normalizedSlug, taskLookupRoot);
  if (!resolution.ok && !syntheticTask) {
    reportTaskResolutionFn(resolution, normalizedSlug, errorFn);
    return false;
  }
  const issues = syntheticTask ? [] : checkBacklogIntegrityFn(taskLookupRoot, normalizedSlug);
  if (issues.length > 0) {
    reportBacklogIntegrityIssues(issues, normalizedSlug, errorFn, logFn);
    return false;
  }
  return true;
}

async function recordDraftImplementer({
  selected,
  actual,
  taskResolution,
  log = fmt.log.plain,
  plumbingLog = log,
  transitionTaskFn = transitionTask,
  getTaskStatusFn = getTaskStatus,
  slug,
  worktree
}: { selected: string; actual: string; taskResolution?: ReturnType<typeof resolveTaskFile>; slug: string; worktree: string; log?: DraftLog; plumbingLog?: DraftLog; transitionTaskFn?: typeof transitionTask; getTaskStatusFn?: typeof getTaskStatus }) {
  if (!taskResolution || !taskResolution.ok || !taskResolution.taskFile || !actual) {
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
 * How many times an incomplete mission contract is sent back to the drafting
 * agent before the draft fails. Each attempt relaunches the agent with the
 * exact missing parts; the parts it already recorded stay in Mission state.
 */
const DRAFT_CONTRACT_REPAIR_ATTEMPTS = 2;

/**
 * Record refinement on the Mission aggregate. `contractIncomplete` is a domain
 * rule rejection (the agent did not record every required part), which the
 * agent can repair; anything else is an infrastructure failure it cannot.
 */
async function recordDraftRefinement(ctx: DraftWorkflowContext): Promise<{ ok: true } | { ok: false; contractIncomplete: boolean; message: string }> {
  try {
    if (typeof ctx.missionServicesFn !== 'function') { throw new Error('draft command requires injected mission services'); }
    const services = await draftMissionServices(ctx);
    const result = await services.lifecycle.transition({
      operationId: `draft-refine-${ctx.slug}`,
      missionId: missionId(ctx.slug), capabilities: new Set(['mission:transition']),
      command: { type: 'refine' }, actor: 'draft', occurredAt: new Date().toISOString(), idempotencyKey: `${ctx.slug}:refine`,
    });
    if (result.status === 'completed') { return { ok: true }; }
    const message = result.error?.message || 'unknown error';
    return { ok: false, contractIncomplete: result.error?.kind === 'validation' && /mission contract is incomplete/.test(message), message };
  } catch (error) {
    return { ok: false, contractIncomplete: false, message: (error instanceof Error ? error.message : String(error)) };
  }
}

/**
 * Send an incomplete contract back to the agent that drafted it. The same
 * family is relaunched with the refusal verbatim, so it records only what is
 * missing instead of starting the contract over.
 */
async function repairDraftContract(slug: string, worktree: string, agent: string, refusal: string, {
  startDraftAgentFn = startDraftAgent,
  logFn = fmt.log.plain,
  errorFn = fmt.log.plainError,
}: Pick<DraftAdapterDependencies, "startDraftAgentFn" | "logFn" | "errorFn"> = {}) {
  const prompt = buildContractRepairPrompt(slug, { rootDir: worktree, worktree, refusal });
  const { agent: actualAgent, result } = await startDraftAgentFn({ prompt, worktree, agent });
  if (result.error) {
    errorFn(fmt.status('FAIL', `Could not relaunch draft agent (${fmt.agent(actualAgent)}): ${result.error.message}`));
    return false;
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    errorFn(fmt.status('FAIL', `Relaunched draft agent (${fmt.agent(actualAgent)}) exited with status ${result.status}.`));
    return false;
  }
  logFn(fmt.status('INFO', `Draft agent ${fmt.agent(actualAgent)} finished the contract repair.`));
  return true;
}

/**
 * Record a draft-stage stats row after the draft agent completes. Token/usage
 * columns come from the agent result's telemetry (currently Codex only); other
 * families record honest zeros with provider/model set to the family name.
 * Best-effort: a failure here must never fail the draft.
 */
function recordDraftStats({ configuration, slug, rootDir, agentFamily, result, log = fmt.log.plain }: { configuration?: ParallixConfiguration; slug: string; rootDir: string; agentFamily: string; result?: { startedAt?: string; endedAt?: string; telemetry?: StageStatsRequest['telemetry'] } | null; log?: DraftLog; error?: DraftLog }) {
  if (!result) {return;}
  let durationMinutes = 0;
  if (result.startedAt && result.endedAt) {
    durationMinutes = (Date.parse(result.endedAt) - Date.parse(result.startedAt)) / 60000;
  }
  try {
    const { row } = stats.recordStageStats({
      configuration, slug,
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
    log(fmt.status('WARN', `Could not record draft stats for ${slug}: ${(err instanceof Error ? err.message : String(err))}`));
  }
}

/**
 * Create a DraftWorkflowPort implementation backed by the adapter's functions.
 * Each port method performs its actual workflow step using the adapter's helper
 * functions. Composition merges `missionServicesFn` into deps at call time.
 */
function createDraftWorkflowAdapter(deps: DraftAdapterDependencies = {}): DraftWorkflowPort {
  const exitFn = (deps.exitFn || process.exit) as (_code?: number) => never;
  const logFn = (deps.logFn || fmt.log.plain) as (_msg: string) => void;
  const errorFn = (deps.errorFn || fmt.log.plainError) as (_msg: string) => void;

  // Internal plumbing (branch/worktree/graphify/.gitignore/SQLite/label/stats
  // bookkeeping) is not the mission result a first-time operator came for, so
  // it is demoted behind the existing DEBUG env gate that `fmt.log.debug` uses.
  // The message text and call order are unchanged; only the transport is gated,
  // so `DEBUG=1` reproduces the pre-change default output verbatim.
  const debugFn = (msg: string): void => { if ((deps.configuration as ParallixConfiguration | undefined)?.runtime.debug) { logFn(msg); } };
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
      missionServicesFn: partial.missionServicesFn || (() => { throw new Error('draft command requires injected mission services'); }),
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
    preflight: async (args: string[], options: Record<string, unknown> = {}): Promise<DraftWorkflowContext> => {
      const merged: DraftAdapterDependencies = { ...deps, ...options };
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
      startedAtMs = Date.now();

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
        errorFn(fmt.status('FAIL', (error instanceof Error ? error.message : String(error))));
        safeExit(1);
        return exitedContext({ slug: normalizedSlug, mainRepo, options });
      }
      let recordedBase: string | null = null;
      if (launchBase && launchBase !== getPrimaryBranch(mainRepo)) {
        recordedBase = launchBase;
        logFn(fmt.status('INFO', `Feature-branch mission: base branch detected as ${fmt.branch(recordedBase)}.`));
      }

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
      } as DraftWorkflowContext;
    },

    // Setup: create branch, worktree, graphify workspace, gitignore
    setup: (ctx: DraftWorkflowContext): DraftWorkflowContext => {
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
      ensureWorktreeFn(ctx.mainRepo, targetWorktree, branchName, { logFn: plumbingLogFn, errorFn });
      // Prepare the worktree before any agent or gate runs in it. A failure is
      // the environment's, not the implementer's: stop here instead of letting
      // every later gate fail on what the checkout never had.
      const hook = (merged.runPreDraftHookFn || runPreDraftHook)({ slug: ctx.slug, worktree: targetWorktree });
      if (hook.ran && !hook.ok) {
        if (hook.output) { errorFn(hook.output); }
        errorFn(fmt.status('FAIL', `Environment failure: the pre-draft hook \`${hook.command}\` exited with status ${hook.exitCode} in ${fmt.path(targetWorktree)}.`));
        logFn('Repair: fix the worktree environment or adapters.draft.preDraftCommand in workflow.config.json, then re-run the draft. No agent was launched.');
        safeExit(1);
        return exitedContext({ ...ctx, targetWorktree, branchName });
      }
      if (hook.ran) { debugFn(fmt.status('PASS', `Pre-draft hook \`${hook.command}\` prepared ${fmt.path(targetWorktree)}.`)); }
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

    // Prepare typed mission state and the Backlog mirror.
    scaffold: (ctx: DraftWorkflowContext): DraftWorkflowContext => {
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
      if (!bootstrapBacklogTaskFn(ctx.targetWorktree, ctx.mainRepo, ctx.slug, { logFn: plumbingLogFn, errorFn, syntheticTask: ctx.syntheticTask as SyntheticDraftTask | null })) {
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
    },

    // Intake: materialize mission in SQLite
    intake: async (ctx: DraftWorkflowContext): Promise<DraftWorkflowContext> => {
      const resolveTaskFileFn = (ctx.options as DraftAdapterDependencies).resolveTaskFileFn || resolveTaskFile;
      const getTaskLabelsFn = getTaskLabels;

      let missionTitle = (ctx.syntheticTask as SyntheticDraftTask | null)?.title || ctx.slug;
      let taskLabels: string[] = [];
      try {
        const taskResolution = resolveTaskFileFn(ctx.slug, ctx.targetWorktree);
        taskLabels = taskResolution?.ok && taskResolution?.taskFile
          ? getTaskLabelsFn(taskResolution.taskFile)
          : [];
        if (taskResolution?.ok && taskResolution?.taskFile) {
          missionTitle = readTaskTitle(taskResolution.taskFile, missionTitle);
        }
      } catch {
        taskLabels = [];
      }

      let intakeOutcome: Awaited<ReturnType<MissionIntakeService['execute']>>;
      try {
        if (typeof ctx.missionServicesFn !== 'function') { throw new Error('draft command requires injected mission services'); }
        const missionServices = await draftMissionServices(ctx);
        intakeOutcome = await missionServices.intake.execute({
          operationId: `draft-intake-${ctx.slug}`,
          missionId: missionId(ctx.slug),
          repositoryId: missionServices.repositoryId,
          title: missionTitle,
          labels: missionLabels(taskLabels),
          rawStatus: 'backlog',
          externalTaskRef: null,
          capabilities: new Set(['mission:intake']),
        });
      } catch (intakeError) {
        errorFn(fmt.status('FAIL', `Mission intake to SQLite failed for ${ctx.slug}: ${(intakeError instanceof Error ? intakeError.message : String(intakeError))}`));
        logFn('Repair: ensure the operator-local database is reachable, then re-run the draft. The Backlog task was not transitioned.');
        safeExit(1);
        return exitedContext({ ...ctx });
      }

      if (intakeOutcome.status === 'completed') {
        debugFn(fmt.status('PASS', `Mission materialized in SQLite (v${intakeOutcome.value?.version})`));
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
      const transitionTaskFn = (ctx.options as DraftAdapterDependencies).transitionTaskFn || transitionTask;

      const transitionOk = await transitionTaskFn(ctx.slug, 'backlog', { rootDir: ctx.targetWorktree, log: plumbingLogFn });
      // Backlog-backed missions keep the strict contract: a task-file transition
      // failure is fatal. A synthetic (adhoc) intake has no Backlog backing in an
      // adhoc-only repository, so its lifecycle is DB-authoritative and the
      // missing task-file transition is a best-effort no-op, not a failure. A
      // DB-owned (web/board-created) mission is the same: no Backlog file, DB
      // authority, best-effort no-op transition.
      if (!transitionOk && !ctx.syntheticTask && !ctx.dbOwned) {
        errorFn(fmt.status('FAIL', `Could not transition task ${ctx.slug} to backlog status.`));
        safeExit(1);
        return exitedContext({ ...ctx });
      }
      if (!transitionOk && (ctx.syntheticTask || ctx.dbOwned)) {
        logFn(fmt.status('WARN', `No Backlog task file to transition for ${ctx.slug}; lifecycle is DB-authoritative.`));
      }

      return ctx;
    },

    // Launch agent: read config, select, launch, record
    launchAgent: async (ctx: DraftWorkflowContext): Promise<DraftWorkflowContext> => {
      const merged = ctx.options as DraftAdapterDependencies;
      const readAgentConfigOrExitFn = merged.readAgentConfigOrExitFn || readAgentConfigOrExit;
      const selectAgentFn = merged.selectAgentFn || selectAgent;
      const startDraftAgentFn = merged.startDraftAgentFn || startDraftAgent;
      const resolveTaskFileFn = merged.resolveTaskFileFn || resolveTaskFile;
      const recordDraftImplementerFn = merged.recordDraftImplementerFn || recordDraftImplementer;
      const recordDraftStatsFn = merged.recordDraftStatsFn || recordDraftStats;

      const agentConfig = readAgentConfigOrExitFn(undefined, { configuration: merged.configuration });
      const agent = ctx.agent || selectAgentFn('draft', { config: agentConfig, configuration: merged.configuration });
      const prompt = buildDraftPrompt(ctx.slug, { rootDir: ctx.mainRepo, worktree: ctx.targetWorktree || '' });
      logFn('');
      logFn(fmt.bold(`Running ${fmt.agent(agent)} to write the mission contract...`));
      const { agent: actualAgent, result } = await startDraftAgentFn({
        configuration: merged.configuration,
        prompt,
        worktree: ctx.targetWorktree,
        agent
      });
      debugFn(`Draft agent family: ${fmt.agent(actualAgent)}`);

      if (result.error) {
        errorFn(fmt.status('FAIL', `Could not start draft agent (${fmt.agent(actualAgent)}): ${result.error.message}`));
        safeExit(1);
        return exitedContext({ ...ctx, agent, actualAgent: actualAgent, agentResult: result });
      }

      if (typeof result.status === 'number' && result.status !== 0) {
        errorFn(fmt.status('FAIL', `Draft agent (${fmt.agent(actualAgent)}) exited with status ${result.status}.`));
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
        configuration: merged.configuration,
        slug: ctx.slug,
        rootDir: ctx.targetWorktree,
        agentFamily: actualAgent,
        result,
        log: plumbingLogFn,
        error: errorFn
      });

      return { ...ctx, agent, actualAgent: actualAgent, agentResult: result };
    },

    // Post-process: classification normalize and re-assert base
    postProcess: async (ctx: DraftWorkflowContext): Promise<DraftWorkflowContext> => {
      const merged = ctx.options as DraftAdapterDependencies;
      const normalizeDraftClassificationFn = merged.normalizeDraftClassificationFn || normalizeDraftClassification;
      const restartDraftAgentFn = merged.restartDraftAgentFn || restartDraftAgent;
      const readAgentConfigOrExitFn = merged.readAgentConfigOrExitFn || readAgentConfigOrExit;

      const normalizationResult = await validateStoredDraftClassification(ctx) ?? normalizeDraftClassificationFn(ctx.slug, ctx.targetWorktree, {
        configuration: merged.configuration,
        errorFn
      });
      if (!normalizationResult.ok) {
        logFn(fmt.status('WARN', `Post-draft mission type labels are not valid (${normalizationResult.reason}). Relaunching draft agent to repair them.`));
        const restartOk = await restartDraftAgentFn(ctx.slug, ctx.targetWorktree, {
          logFn,
          errorFn,
          exitFn,
          readAgentConfigOrExitFn,
        });
        if (!restartOk) {
          safeExit(1);
          return exitedContext({ ...ctx });
        }
        const postRestartNorm = await validateStoredDraftClassification(ctx) ?? normalizeDraftClassificationFn(ctx.slug, ctx.targetWorktree, {
          configuration: merged.configuration,
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

      return ctx;
    },

    // Commit safety: capture uncommitted changes
    commitSafety: (ctx: DraftWorkflowContext): DraftWorkflowContext => {
      const enforceDraftCommitSafetyFn = (ctx.options as DraftAdapterDependencies).enforceDraftCommitSafetyFn || enforceDraftCommitSafety;

      try {
        enforceDraftCommitSafetyFn({ slug: ctx.slug, worktree: ctx.targetWorktree, logFn, plumbingLogFn });
      } catch (error) {
        errorFn(fmt.status('FAIL', (error instanceof Error ? error.message : String(error))));
        safeExit(1);
        return exitedContext({ ...ctx });
      }

      return ctx;
    },

    // Final transition to 'ready'
    finalTransition: async (ctx: DraftWorkflowContext): Promise<void> => {
      const transitionTaskFn = (ctx.options as DraftAdapterDependencies).transitionTaskFn || transitionTask;
      const transitionVirtualFn = (ctx.options as DraftAdapterDependencies).transitionVirtualFn || transitionVirtual;

      // Record refinement on the Mission aggregate before the Backlog task
      // moves to ready. Activation demands `refined`, and intake materializes
      // every mission as `backlog`, so without this the persisted aggregate
      // would never leave the backlog and `px active` could not run. Ordering
      // it first keeps the failure story the same as intake's: a database
      // failure leaves the Backlog task where it was.
      const merged = ctx.options as DraftAdapterDependencies;
      const repairDraftContractFn = merged.repairDraftContractFn || repairDraftContract;
      const enforceDraftCommitSafetyFn = merged.enforceDraftCommitSafetyFn || enforceDraftCommitSafety;
      let refined = await recordDraftRefinement(ctx);
      for (let attempt = 1; refined.ok === false && refined.contractIncomplete && attempt <= DRAFT_CONTRACT_REPAIR_ATTEMPTS; attempt += 1) {
        logFn(fmt.status('WARN', `${refined.message} Sending it back to the draft agent (attempt ${attempt}/${DRAFT_CONTRACT_REPAIR_ATTEMPTS}).`));
        const repaired = await repairDraftContractFn(ctx.slug, ctx.targetWorktree, ctx.actualAgent || ctx.agent, refined.message, { logFn, errorFn });
        if (!repaired) { break; }
        try {
          enforceDraftCommitSafetyFn({ slug: ctx.slug, worktree: ctx.targetWorktree, logFn, plumbingLogFn });
        } catch (error) {
          errorFn(fmt.status('FAIL', (error instanceof Error ? error.message : String(error))));
          safeExit(1);
          return;
        }
        refined = await recordDraftRefinement(ctx);
      }
      if (refined.ok === false) {
        errorFn(fmt.status('FAIL', `Recording refinement for ${ctx.slug} failed: ${refined.message}`));
        logFn(refined.contractIncomplete
          ? `Repair: the draft agent did not record the missing parts. Record them from ${ctx.targetWorktree} with the commands named above, read them back with \`px status ${ctx.slug}\`, then re-run \`px draft ${ctx.slug}\`. The Backlog task was not transitioned to ready.`
          : 'Repair: ensure the operator-local database is reachable, then re-run the draft. The Backlog task was not transitioned to ready.');
        safeExit(1);
        return;
      }

      const transitionOptions = { rootDir: ctx.targetWorktree, log: plumbingLogFn };
      const readyOk = await transitionVirtualFn(transitionTaskFn, ctx.slug, 'ready', transitionOptions);
      // Best-effort mirror for synthetic (adhoc) intakes and DB-owned
      // (web/board-created) intakes: the DB authority records the refinement
      // above, so a missing Backlog task-file transition in an adhoc-only
      // repository is a no-op, not a failure.
      if (!readyOk && !ctx.syntheticTask && !ctx.dbOwned) {
        errorFn(fmt.status('FAIL', `Could not transition task ${ctx.slug} to ready status.`));
        safeExit(1);
        return;
      }
      if (!readyOk && (ctx.syntheticTask || ctx.dbOwned)) {
        logFn(fmt.status('WARN', `No Backlog task file transition for ${ctx.slug}; lifecycle is DB-authoritative.`));
      }

      await logDraftCompletion(ctx, startedAtMs, logFn);
    },
  };
}
async function restartDraftAgent(slug: string, worktree: string, {
  configuration,
  selectAgentFn = selectAgent,
  startDraftAgentFn = startDraftAgent,
  readAgentConfigOrExitFn = readAgentConfigOrExit,
  logFn = fmt.log.plain,
  errorFn = fmt.log.plainError
}: Pick<DraftAdapterDependencies, "selectAgentFn" | "startDraftAgentFn" | "readAgentConfigOrExitFn" | "logFn" | "errorFn" | "exitFn" | "configuration"> = {}) {
  const agentConfig = readAgentConfigOrExitFn(undefined, { configuration: configuration });
  const agent = selectAgentFn('draft', { config: agentConfig, configuration: configuration });

  const prompt = buildRestartPrompt(slug, { rootDir: worktree, worktree });
  logFn('Relaunching draft agent to repair mission type labels...');
  const { agent: actualAgent, result } = await startDraftAgentFn({ configuration, prompt, worktree, agent });
  logFn(`Restart draft agent family: ${fmt.agent(actualAgent)}`);

  if (result.error) {
    errorFn(fmt.status('FAIL', `Could not restart draft agent (${fmt.agent(actualAgent)}): ${result.error.message}`));
    return false;
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    errorFn(fmt.status('FAIL', `Restart draft agent (${fmt.agent(actualAgent)}) exited with status ${result.status}.`));
    return false;
  }

  return true;
}

export { recordDraftStats, recordDraftImplementer, restartDraftAgent, repairDraftContract, DRAFT_CONTRACT_REPAIR_ATTEMPTS, createDraftWorkflowAdapter };
