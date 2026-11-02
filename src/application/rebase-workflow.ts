import { rebaseImplementer, recordImplementerLaunch } from './rebase-identity.js';
import { replacementImplementer } from '../domain/rebase-policy.js';
/**
 * Rebase workflow policy (TASK-2332.12).
 *
 * Owns every decision the `px rebase` command used to make inline: selected
 * mission root, base-branch ancestry postcondition, conflict classification and
 * auto-resolution, git-hook failure rebounce, agent-assisted resolution, review
 * push, and the next-step hints. All external effects go through
 * `RebaseWorkflowPort`; this module imports no adapter.
 */
import * as fmt from './presentation/cli-format.js';
import type {
  GitCommandResult,
  GitRunner,
  MissionConflictClassification,
  RebaseWorkflowPort,
} from './ports/rebase-workflow.js';

// Hook detection lives in the shared application module (TASK-2369.17); the
// bounce itself is the rebound kernel's (TASK-2377.05).
import { classifyHookFailure } from './hook-failure-workflow.js';
export { classifyHookFailure };
import { autoResolveMissionConflicts, handleNonConflictRebaseFailure, type ContinueOutcome } from './rebase-continuation.js';
import { buildCurrentRebasePrompt } from './rebase-prompt.js';
export { buildRebasePrompt } from './rebase-prompt.js';
import { parseConflictFilesFromGitStatus, parseConflictFilesFromRebaseOutput } from './rebase-conflict-files.js';
export { parseConflictFilesFromGitStatus, parseConflictFilesFromRebaseOutput } from './rebase-conflict-files.js';
import { combineOutput, continueSucceeded, hasConflictMarkers, type RebaseContext } from './rebase-context.js';
import { recoverAgentRebaseCompletion } from './rebase-agent-completion.js';

/** Capture database identity before replay; uncomposed legacy seams support older callers. */
async function resolveRecordedImplementer(slug: string, executionRoot: string, port: RebaseWorkflowPort): Promise<string | null> {
  if (port.missionServices) {
    const { store } = await port.missionServices(executionRoot);
    return rebaseImplementer(store, slug);
  }
  let missionRecord: { implementer?: string | null } | null = null;
  try {
    missionRecord = await Promise.resolve(port.readReviewState(slug, executionRoot)) as { implementer?: string | null } | null;
  } catch (_) {
    // An unreadable mission record is local metadata unavailability, not an
    // infrastructure failure: fall back to the Backlog task file below.
    missionRecord = null;
  }
  const taskResolution = port.resolveTaskFile(slug, executionRoot);
  return (missionRecord?.implementer || '').trim()
    || (taskResolution.ok && taskResolution.taskFile ? port.getTaskImplementer(taskResolution.taskFile) : null)
    || null;
}

function reportRebaseAlreadyInProgress(existingRebase: ReturnType<RebaseWorkflowPort['detectRebaseState']>, branch: string, port: RebaseWorkflowPort): void {
  fmt.log.fail(`Rebase already in progress for ${fmt.branch(branch)}.`);
  if (existingRebase.rebaseHead) { fmt.log.info(`Current rebase head: ${existingRebase.rebaseHead}`); }
  if (existingRebase.unmergedFiles.length > 0) {
    fmt.log.info('Unmerged files:');
    existingRebase.unmergedFiles.forEach((file: string) => fmt.log.info(`  - ${file}`));
  }
  fmt.log.info('Recovery commands:');
  for (const command of ['git rebase --continue', 'git rebase --abort', 'git rebase --skip']) {
    fmt.log.info(`  ${fmt.command(command)}`);
  }
  port.exit(1);
}

async function performPush(ctx: RebaseContext): Promise<boolean> {
  const { port, slug, branch, area, executionRoot, isPush, recordedImplementer } = ctx;
  if (!isPush) { return true; }
  if (!port.isForgejoReviewEnabled(executionRoot)) {
    fmt.log.info(`Skipping Forgejo push (review provider is not forgejo).`);
    return true;
  }
  fmt.log.info(`--push detected. Updating Forgejo PR for ${fmt.branch(branch)}...`);
  const actual = port.missionServices ? await resolveRecordedImplementer(slug, executionRoot, port) : recordedImplementer;
  const preferredUser = port.resolveForgejoUser(actual) || 'default';
  const { user: forgejoUser, token } = port.publicationCredentials?.(preferredUser, executionRoot)
    ?? { user: preferredUser, token: port.readToken(preferredUser) };
  if (!token) {
    fmt.log.fail(`No Forgejo token found for user "${fmt.agent(forgejoUser || 'default')}". Push failed.`);
    port.exit(1);
    return false;
  }
  // The push-time gate verifies the mission's area, the same one review preparation
  // verification ran and the gate evidence reports — never the configured
  // defaultArea createPr falls back to when no area is given.
  const result = port.createPr(branch, forgejoUser || 'default', token, { rootDir: executionRoot, forceWithLease: true, verificationArea: area });
  if (!result.ok) {
    fmt.log.fail(`Push to Forgejo failed: ${result.error}`);
    port.exit(1);
    return false;
  }
  fmt.log.pass(`Branch pushed and PR updated for ${fmt.branch(branch)}.`);
  return true;
}

/**
 * Postcondition shared by every success path: the resolved *local* base must be
 * an ancestor of the mission HEAD. Reporting a successful rebase without this
 * guarantee is a silent false success (architecture migration). Returns false
 * after emitting diagnostics and calling exit(1); callers must return at once.
 */
function verifyBaseAncestry(ctx: RebaseContext): boolean {
  const { gitFn, executionRoot, baseBranch, port } = ctx;
  if (gitFn(['-C', executionRoot, 'merge-base', '--is-ancestor', baseBranch, 'HEAD']).status === 0) { return true; }
  const headSha = (gitFn(['-C', executionRoot, 'rev-parse', 'HEAD']).stdout || '').trim() || '(unknown)';
  const output = [
    'Rebase postcondition failed: the local base branch is not an ancestor of the mission HEAD.',
    `Resolved local base branch: ${baseBranch}`,
    `Mission HEAD: ${headSha}`,
    'This is local-base ancestry, not origin/mission/* tracking divergence.',
    'Recovery: git rebase --abort',
  ].join('\n');
  port.onFailure?.({ kind: 'other', operation: 'rebase', output });
  fmt.log.fail(output);
  port.exit(1);
  return false;
}

/** The one success tail: verify ancestry, announce, push, then name what is next. */
async function finishRebase(ctx: RebaseContext, message: string): Promise<void> {
  const state = ctx.port.detectRebaseState(ctx.executionRoot);
  if (state.inProgress || state.unmergedFiles.length > 0) {
    fmt.log.fail('Rebase is unfinished. Skipping automatic push.');
    ctx.port.exit(1);
    return;
  }
  if (!verifyBaseAncestry(ctx)) { return; }
  // The branch just moved: record, at this moment, an approval it no longer
  // covers (TASK-2555). Recording is an audit fact; standing the approval down
  // stays an operator decision.
  if (ctx.port.recordBranchMove) {
    const moved = await ctx.port.recordBranchMove(ctx.slug, ctx.executionRoot, ctx.movedFrom);
    if (moved) { fmt.log.warn(moved); }
  }
  if (ctx.repairImplementer) { await ctx.port.resumeReviewAfterRepair?.(ctx.slug, ctx.executionRoot, ctx.repairImplementer); }
  fmt.log.pass(message);
  if (!await performPush(ctx)) { return; }
  fmt.log.info('Verification: the workflow handles integration checks.');
  fmt.log.info('Integration eligibility requires the lifecycle-authorized lane and current policy-authorized approval.');
  ctx.port.exit(0);
}

/**
 * Split the paused rebase's conflicts into mission-owned and shared. Returns
 * null once a diagnostic has been emitted and the process exit set. A null
 * output requests a refreshed index classification without predictive merge.
 */
function classifyRebaseConflicts(ctx: RebaseContext, rebaseOutput: string | null, knownMissionFiles: readonly string[] = []): MissionConflictClassification | null {
  const { port, gitFn, slug, area, branch, executionRoot } = ctx;
  const output = rebaseOutput ?? '';
  const current = port.detectRebaseState(executionRoot);
  const currentFiles = current.unmergedFiles;
  const prefix = port.missionConflictPathPrefix(slug, executionRoot);
  // A paused index owns membership; retain known ownership only for paths still
  // present. Predictive merge is unsafe here.
  const owned = currentFiles.filter(file => knownMissionFiles.includes(file) || (!port.missionServices && file.startsWith(prefix)));
  const conflictResult: MissionConflictClassification = rebaseOutput === null || current.inProgress || currentFiles.length > 0
    ? { ok: true, conflictFiles: currentFiles, missionSpecificFiles: owned,
      sharedFiles: currentFiles.filter(file => !owned.includes(file)) }
    : port.resolveConflictsForMission(slug, area, { worktreePathOverride: executionRoot });

  // When rebase is in progress in the worktree, dry merge may fail. Fall back to
  // parsing the rebase output directly.
  if (conflictResult.ok === false && conflictResult.error === 'merge-failed') {
    fmt.log.info('Dry merge failed (rebase in progress). Parsing rebase output directly...');
    // Prefer git status --porcelain (authoritative index entries) over localized
    // rebase text, which can contain advice prefixes that parse as false paths.
    const statusFiles = parseConflictFilesFromGitStatus(executionRoot, gitFn);
    const conflictFiles = statusFiles.length > 0 ? statusFiles : parseConflictFilesFromRebaseOutput(output);
    const missionDocPrefix = port.missionConflictPathPrefix(slug, executionRoot);
    const taskPattern = new RegExp(`backlog/(?:tasks|completed)/[^/]*${slug}`);
    const missionSpecificFiles = conflictFiles.filter((f: string) => f.startsWith(missionDocPrefix) || taskPattern.test(f));
    Object.assign(conflictResult, {
      ok: true,
      conflictFiles,
      missionSpecificFiles,
      sharedFiles: conflictFiles.filter((f: string) => !missionSpecificFiles.includes(f)),
    });
  } else if (!conflictResult.ok) {
    if (conflictResult.error === 'worktree-missing') {
      fmt.log.fail(`Mission worktree not found: ${fmt.path(executionRoot)}`);
      fmt.log.info(`Ensure the worktree is registered: ${fmt.command(`git worktree add ${port.conventionalWorktreePath(slug, executionRoot)} ${branch}`)}`);
    } else {
      fmt.log.fail('Conflict detection failed.');
      fmt.log.info(`Check rebase state: ${fmt.command('git status')}`);
    }
    port.exit(1);
    return null;
  }

  // No conflicts detected by classification but rebase reported CONFLICT — fall
  // through to shared-file handling with whatever git reports.
  const conflictFiles = conflictResult.conflictFiles.length > 0
    ? conflictResult.conflictFiles
    : parseConflictFilesFromRebaseOutput(output);
  // Only treat unclassified conflict files as shared-file conflicts.
  if (conflictResult.sharedFiles.length === 0 && conflictFiles.length > 0) {
    const classified = new Set([...conflictResult.missionSpecificFiles]);
    const unclassified = conflictFiles.filter((f: string) => !classified.has(f));
    if (unclassified.length > 0) { conflictResult.sharedFiles = unclassified; }
  }
  return conflictResult;
}

async function finishMissionConflictPhase(ctx: RebaseContext, outcome: ContinueOutcome): Promise<void> {
  if (outcome === 'completed') {
    await finishRebase(ctx, 'Mission-specific conflicts resolved. Rebase completed.');
  } else if (outcome === 'recursed') {
    await runRebaseWorkflow(ctx.args, ctx.port, { resumeInPlace: true });
  }
}

/**
 * Select an eligible replacement implementer family when mission policy permits
 * substitution. Uses policy key `active` (the config/agents.json key that owns
 * implementation work) so configured eligibility is consulted rather than every
 * workflow family (F1), excluding the pinned/blocked implementer.
 * `selectAgent` throws on pool exhaustion/unavailability; that is treated as no
 * replacement so the caller reaches the reset-time diagnostic (F2).
 */
function selectReplacementFamily(ctx: RebaseContext, implementer: string): string | null {
  let selected: string | null;
  try {
    selected = ctx.port.selectAgent?.('active', { exclude: new Set([implementer]) }) ?? null;
  } catch {
    selected = null;
  }
  const candidate = replacementImplementer(selected, implementer, true);
  if (!candidate) { return null; }
  const status = ctx.port.workflowLauncherStatus?.(candidate) ?? { supported: false, agent: candidate };
  return replacementImplementer(candidate, implementer, status.supported, status.agent);
}

/**
 * Conflict resolution is implementation work owned by the mission's recorded
 * implementer (TASK-2294.01), so the family is pinned. A usage block on that
 * family may substitute an eligible replacement; it is never reported as an
 * infrastructure or Forgejo failure.
 */
async function launchConflictResolver(ctx: RebaseContext, implementer: string, prompt: () => Promise<string>): Promise<import('./ports/rebase-workflow.js').AgentLaunchResult | null> {
  const { port, executionRoot, slug } = ctx;
  const launchOptions = { worktree: executionRoot, slug, role: 'implementer', sessionPolicy: 'fresh-ephemeral' as const,
    onLaunch: async ({ agent }: { agent: string }) => {
      if (port.missionServices) {
        const services = await port.missionServices(executionRoot);
        await recordImplementerLaunch(slug, agent, services.store, services.lifecycle);
      }
    },
  };
  let task: string;
  try {
    task = await prompt();
  } catch (err) {
    fmt.log.fail(`Cannot construct conflict-resolution task: ${String(err)}`);
    port.exit(1);
    return null;
  }
  if (typeof port.missionServices === 'function') {
    try {
      await port.transitionTask(slug, 'active', { rootDir: executionRoot, log: fmt.log.plain });
      ctx.repairImplementer = implementer;
    } catch (err) {
      fmt.log.fail(`Cannot activate mission for conflict resolution: ${String(err)}`);
      port.exit(1);
      return null;
    }
  }
  try {
    return await port.startAgent('conflict-resolution', { ...launchOptions, prompt: task, agent: implementer, pinnedAgent: true });
  } catch (err) {
    const message = (err as { message?: string } | null)?.message || String(err);
    if (!/usage\s+limit|blocked\s+until|usage\s+limit\s+hit/i.test(message)) {
      fmt.log.fail(`Implementer ${fmt.agent(implementer)} cannot run conflict resolution: ${message}`);
      fmt.log.info(`You may need to abort the rebase: ${fmt.command('git rebase --abort')}`);
      port.exit(1);
      return null;
    }
    // `startAgent` recorded the block via updateAgentBlock and refused a family
    // fallback, because pinned work has no fallback.
    const replacement = selectReplacementFamily(ctx, implementer);
    if (replacement) {
      fmt.log.info(`Implementer ${fmt.agent(implementer)} hit an agent usage limit; substituting ${fmt.agent(replacement)} for conflict resolution.`);
      try { task = await prompt(); }
      catch (error) {
        fmt.log.fail(`Cannot construct conflict-resolution task: ${String(error)}`);
        port.exit(1);
        return null;
      }
      try { return await port.startAgent('conflict-resolution', { ...launchOptions, prompt: task, agent: replacement }); }
      catch (error) {
        fmt.log.fail(`Implementer ${fmt.agent(replacement)} cannot run conflict resolution: ${String(error)}`);
        port.exit(1);
        return null;
      }
    }
    const resetMatch = /blocked[ \t]+until[ \t]+/i.exec(message);
    const resetTail = resetMatch ? message.slice(resetMatch.index + resetMatch[0].length) : '';
    const resetTime = /[\r\n]/.test(resetTail) ? null : resetTail.trim() || null;
    fmt.log.fail(`Implementer ${fmt.agent(implementer)} hit an agent usage limit${resetTime ? ` (resets ${resetTime})` : ''}.`);
    fmt.log.info('No eligible replacement family is available under the current mission policy, so the rebase cannot continue automatically.');
    fmt.log.info(`Recovery: ${fmt.command('git rebase --abort')}`);
    port.exit(1);
    return null;
  }
}

/** Hand the shared-file conflicts to the mission implementer. */
async function resolveSharedConflicts(ctx: RebaseContext, conflictResult: MissionConflictClassification): Promise<void> {
  const { port, slug, executionRoot, recordedImplementer } = ctx;
  fmt.log.info(`${conflictResult.sharedFiles.length} shared file(s) require agent-assisted resolution:`);
  conflictResult.sharedFiles.forEach((f: string) => fmt.log.info(`  - ${fmt.path(f)}`));

  let launchConflicts = conflictResult;
  let firstLaunch = true;
  const prompt = async (completionDiagnostic?: string) => {
    // Preserve the workflow's ownership split for the first task; refresh later
    // launches from the index. Completion recovery always uses current Git state.
    const current = firstLaunch && completionDiagnostic === undefined ? conflictResult : classifyRebaseConflicts(ctx, null, launchConflicts.missionSpecificFiles);
    firstLaunch = false;
    if (!current) { throw new Error('Cannot read current rebase conflicts'); }
    if (completionDiagnostic !== undefined) {
      return buildCurrentRebasePrompt(ctx, current, completionDiagnostic || 'Git completion checks now pass. Verify the current checkout before making changes.');
    }
    if (current.conflictFiles.length) { launchConflicts = current; }
    return buildCurrentRebasePrompt(ctx, launchConflicts);
  };

  if (!recordedImplementer) {
    fmt.log.fail(`No recorded implementer for ${fmt.slug(slug)}; cannot launch conflict resolution.`);
    fmt.log.info('Conflict resolution runs as the mission implementer. Assign the Mission to a configured agent, then re-run.');
    fmt.log.info(`Recovery: ${fmt.command('git rebase --abort')}`);
    port.exit(1);
    return;
  }

  fmt.log.info(`Launching implementer (${fmt.agent(recordedImplementer)}) for conflict resolution...`);
  const launch = await launchConflictResolver(ctx, recordedImplementer, prompt);
  if (!launch) { return; }
  const { agent, result: agentResult } = launch;

  const completion = await recoverAgentRebaseCompletion(port, slug, executionRoot, ctx.branch, agent, prompt);
  if (!completion) { return; }
  if (agentResult.status !== 0) {
    fmt.log.fail(`Agent (${fmt.agent(agent)}) exited with status ${agentResult.status}.`);
    fmt.log.info(`You may need to abort the rebase: ${fmt.command('git rebase --abort')}`);
    port.exit(agentResult.status || 1);
    return;
  }
  if (completion.repaired || ctx.repairImplementer) { ctx.repairImplementer = completion.implementer; }
  await finishRebase(ctx, `Agent (${fmt.agent(agent)}) completed conflict resolution.`);
}

export async function runRebaseWorkflow(
  args: string[],
  port: RebaseWorkflowPort,
  opts?: { resumeInPlace?: boolean },
): Promise<void> {
  const gitFn: GitRunner = port.git;
  const flags = args.filter(a => a.startsWith('--'));
  const params = args.filter(a => !a.startsWith('--'));
  const explicitSlug = params[0];
  const slug = port.inferSlug(explicitSlug);
  if (!slug) {
    fmt.log.fail('Usage: px rebase [<slug>] [--push]');
    port.exit(1);
    return;
  }

  // Select the mission root exactly once at the command boundary. All later
  // lifecycle, Git, proof, and publication calls use this value explicitly.
  const launchRoot = port.cwd();
  const executionRoot = port.resolveWorktree(slug, { cwd: launchRoot }) || launchRoot;
  const missionDir = port.findMissionDir(slug, executionRoot);
  const branch = port.missionBranchName(slug, executionRoot);

  const existingRebase = port.detectRebaseState(executionRoot);
  // A rebase already in progress is a blocker only on the initial entry: a
  // re-entrant `resumeInPlace` call is resuming the rebase this command started,
  // so it re-classifies the new conflicts instead of bailing (TASK-2668.02).
  if (blocksRebaseStart(opts, existingRebase)) {
    reportRebaseAlreadyInProgress(existingRebase, branch, port);
    return;
  }

  // Verify we are on the correct branch.
  const currentBranch = port.getCurrentBranch(executionRoot);
  if (currentBranch !== branch) {
    fmt.log.fail(`Expected branch ${fmt.branch(branch)}, found ${fmt.branch(currentBranch)}`);
    fmt.log.info(`Switch to the mission branch first: ${fmt.command(`git checkout ${branch}`)}`);
    port.exit(1);
    return;
  }

  const ctx = await prepareRebaseContext(args, port, slug, branch, executionRoot, missionDir, flags, gitFn);

  let rebaseResult: GitCommandResult;
  if (opts?.resumeInPlace) {
    // The rebase is already paused on a conflict discovered by a prior
    // `--continue`. Re-classify the current state; a fresh `git rebase` would
    // fail with "rebase in progress" (TASK-2668.02).
    fmt.log.warn('Rebase already paused on conflicts. Re-classifying...');
    rebaseResult = { status: 1, stdout: '', stderr: existingRebase.unmergedFiles
      .map(file => `CONFLICT (content): Merge conflict in ${file}`).join('\n') };
  } else {
    fmt.log.info(`Rebasing ${fmt.branch(branch)} onto local ${fmt.branch(ctx.baseBranch)}...`);
    rebaseResult = gitFn(['-C', executionRoot, '-c', 'core.editor=true', '-c', 'merge.autoedit=no', 'rebase', ctx.baseBranch]);
  }

  // Rebase succeeded (status 0) or was already up to date.
  if (continueSucceeded(rebaseResult)) {
    // TASK-2828: the rebase-state owner answers this with metadata only. The previous
    // `rebase --show-current` probe is git's prefix match for `--show-current-patch`,
    // which buffers the whole current commit patch and fails past the default buffer.
    // REBASE_HEAD is the commit identity that patch was being read to obtain; git keeps it
    // resolvable after a `--continue` finishes, so it only means "mid-replay" together with
    // live rebase state.
    const postRoundState = port.detectRebaseState(executionRoot);
    if (postRoundState.inProgress && postRoundState.rebaseHead) {
      // The round reported success but the worktree still holds rebase state — incomplete.
      fmt.log.pass('Rebase round completed.');
      fmt.log.warn('Rebase is still in progress. Skipping automatic push.');
      fmt.log.info('Verification: the workflow handles integration checks.');
      fmt.log.info(`Next: ${fmt.command('git rebase --continue')}`);
      port.exit(0);
      return;
    }
    await finishRebase(ctx, 'Rebase completed cleanly.');
    return;
  }

  // Rebase paused on conflicts — classify and resolve.
  const rebaseOutput = combineOutput(rebaseResult);
  if (!hasConflictMarkers(rebaseOutput)) {
    if (await handleNonConflictRebaseFailure(ctx, rebaseResult, rebaseOutput)) {
      await finishRebase(ctx, 'Rebase completed after hook fix.');
    }
    return;
  }

  fmt.log.warn('Rebase paused on conflicts. Classifying...');
  const conflictResult = classifyRebaseConflicts(ctx, rebaseOutput);
  if (!conflictResult) { return; }

  // All conflicts are mission-specific — auto-resolve with --theirs.
  if (conflictResult.sharedFiles.length === 0) {
    const outcome = await autoResolveMissionConflicts(ctx, conflictResult);
    if (outcome !== 'unfinished') {
      await finishMissionConflictPhase(ctx, outcome);
      return;
    }
  }

  await resolveSharedConflicts(ctx, conflictResult);
}

async function prepareRebaseContext(args: string[], port: RebaseWorkflowPort, slug: string, branch: string, executionRoot: string, missionDir: ReturnType<RebaseWorkflowPort['findMissionDir']>, flags: string[], gitFn: GitRunner): Promise<RebaseContext> {
  return {
    args,
    port,
    gitFn,
    slug,
    branch,
    area: missionDir ? port.findMissionArea(missionDir) : 'docs',
    executionRoot,
    // Honor the mission's recorded base branch (a feature-branch mission rebases
    // onto its base, e.g. skunkworks — not the primary branch). Falls back to
    // the primary branch for every mission without a recorded Base-Branch.
    baseBranch: port.resolveMissionBaseBranch(slug, executionRoot, { gitFn }),
    isPush: flags.includes('--push'),
    recordedImplementer: await resolveRecordedImplementer(slug, executionRoot, port),
    movedFrom: port.recordBranchMove ? (gitFn(['-C', executionRoot, 'rev-parse', 'HEAD']).stdout || '').trim() || null : null,
  };

}

function blocksRebaseStart(opts: { resumeInPlace?: boolean } | undefined, state: ReturnType<RebaseWorkflowPort['detectRebaseState']>): boolean { return !opts?.resumeInPlace && state.inProgress; }
