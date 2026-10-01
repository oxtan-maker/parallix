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
import { AGENT_COMMAND_COMPLETION_CONTRACT } from './agent-completion-contract.js';
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
import { rebound } from './rebound-kernel.js';

/**
 * Parse conflict file paths from git status --porcelain output
 * when a rebase is in progress. Handles all unmerged states:
 * UU (unmerged), DU/UD (modify/delete), AU/UA (add/add), AA (add/add).
 */
const UNMERGED_STATUSES = new Set(['UU', 'DU', 'UD', 'AU', 'UA', 'AA']);

/** Extract a conflict file path from one `git status --porcelain` line, or null when the line is blank, unparseable, outside the unmerged family, or resolves to an empty path. */
function conflictFileFromStatusLine(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed) { return null; }
  const match = trimmed.match(/^([A-Z]{2})\s+(.+)$/);
  if (!match || !UNMERGED_STATUSES.has(match[1])) { return null; }
  let file = match[2].trim();
  // Remove surrounding quotes if present
  if ((file.startsWith('"') && file.endsWith('"')) || (file.startsWith("'") && file.endsWith("'"))) {
    file = file.slice(1, -1);
  }
  return file || null;
}

export function parseConflictFilesFromGitStatus(worktreePath: string, gitFn: GitRunner): string[] {
  const statusResult = gitFn(['-C', worktreePath, 'status', '--porcelain']);
  const files: string[] = [];
  for (const line of (statusResult.stdout || '').split('\n')) {
    const file = conflictFileFromStatusLine(line);
    if (file) { files.push(file); }
  }
  return [...new Set(files)];
}

/**
 * Parse conflict file paths from git rebase output.
 * Similar to parseConflictFilesFromMergeOutput but handles rebase-specific output.
 */
export function parseConflictFilesFromRebaseOutput(output: string): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  for (const line of output.split('\n')) {
    if (!/CONFLICT|KONFLIKT/i.test(line)) {continue;}
    // Try each matcher in order; ordering is significant (the Swedish
    // modify/delete matcher must precede the generic colon fallback).
    const file =
      matchRebaseEnglishConflict(line)
      ?? matchRebaseSwedishConflict(line)
      ?? matchRebaseSwedishModDelConflict(line)
      ?? matchRebaseColonConflict(line);
    if (file && !seen.has(file)) { seen.add(file); files.push(file); }
  }
  return files;
}

// English: "Merge conflict in <file>"
function matchRebaseEnglishConflict(line: string): string | null {
  const inMatch = line.match(/Merge conflict in (.+)$/);
  if (!inMatch) {return null;}
  let f = inMatch[1].trim();
  // Strip modify/delete description (e.g. ": deleted by master, modified by HEAD")
  f = f.replace(/\s*:\s*(deleted|modified|added|removed|renamed|both|ours|yours|theirs|by\s*\w+,\s*(modified|deleted)\b).*$/i, '').trim();
  return f || null;
}

// Swedish: "Sammanslagningskonflikt i <file>"
function matchRebaseSwedishConflict(line: string): string | null {
  const svMatch = line.match(/Sammanslagningskonflikt\s+i\s+(.+)$/);
  if (!svMatch) {return null;}
  let f = svMatch[1].trim();
  // Strip modify/delete description (e.g. ": deleted/raderad av master, modified/ändrad av HEAD")
  f = f.replace(/\s*:\s*(deleted|modified|added|removed|renamed|both|ours|yours|theirs|raderad|ändrad|lagd till|borttagen|by|av|av\s*\w+,\s*(modified|ändrad|deleted|raderad)\b).*$/i, '').trim();
  return f || null;
}

// Swedish modify/delete: "KONFLIKT (ändra/radera): <file> raderad i <commit> ... och ändrad i HEAD"
function matchRebaseSwedishModDelConflict(line: string): string | null {
  const svModDelMatch = line.match(/^KONFLIKT\s+\(ändra\/radera\)\s*:\s*(.+)$/i);
  if (!svModDelMatch) {return null;}
  let f = svModDelMatch[1].trim();
  // Strip trailing "Versionen HEAD av <file> lämnad i trädet." sentence (real git output).
  // Must come before raderad/ändrad stripping since the trailing sentence contains "ändrad".
  f = f.replace(/\s+Versionen\s+HEAD[\s\S]*$/i, '').trim();
  // Strip "raderad i <commit> ... och ändrad i HEAD" (Swedish modify/delete description)
  f = f.replace(/\s+raderad\s+i\s+\S+(?:\s*\([^)]*\))?\s+(?:och|and)\s+ändrad\s+i\s+\S+\.?\s*$/i, '').trim();
  // Also handle "raderad i <commit> och ändrad i HEAD" without trailing period
  f = f.replace(/\s+raderad\s+i\s+\S+(?:\s*\([^)]*\))?\s+och\s+ändrad\s+i\s+\S+\s*$/i, '').trim();
  return f || null;
}

// Generic fallback: extract a file path from a colon-delimited rebase line.
// Handles the patterns the specific matchers miss:
//   "<file>: <description>"                          -> generic fallback
//   "CONFLICT (content): <file>: <description>"      -> nested colons
//   "CONFLICT (modify/delete): <file>: deleted by ..., modified by ..." -> modify/delete
//   "CONFLICT (modify/delete): <file>: ..."          -> modify/delete header
function matchRebaseColonConflict(line: string): string | null {
  const colonIdx = line.indexOf(':');
  if (colonIdx === -1) {return null;}
  const beforeColon = line.slice(0, colonIdx).trim();
  const afterColon = line.slice(colonIdx + 1).trim();
  const isNonPathPrefix = /^(CONFLICT|KONFLIKT|CONFLICTS|Merge conflict|Sammanslagningskonflikt|Automatic merge|Auto-merging|resolved|merged|deleted|added|changed|modified|rejected|skipped|dropped|superseded|discarded|kept|stashed|applied|already|would|both|ours|yours|their|his|her|its|your|my|us|we|they|he|she|it|a|an|the|but|and|or|for|nor|not|so|yet)\b/i.test(beforeColon);
  if (!isNonPathPrefix) {
    // Skip known advice/hint labels — the rest of the line is not a path.
    if (/^(tips|hint|note)\b/i.test(beforeColon)) {return null;}
    return beforeColon || null;
  }
  if (!afterColon) {return null;}
  // If there's a second colon, take the segment before it as the path.
  const secondColonIdx = afterColon.indexOf(':');
  if (secondColonIdx !== -1) {
    let f = afterColon.slice(0, secondColonIdx).trim();
    // Strip modify/delete description (e.g. ": deleted by master, modified by HEAD")
    f = f.replace(/\s*:\s*(deleted|modified|added|removed|renamed|both|ours|yours|theirs|raderad|ändrad|lagd till|borttagen|by|av|av\s*\w+,\s*(modified|ändrad|deleted|raderad)\b).*$/i, '');
    f = f.trim();
    return f || null;
  }
  // No second colon — take everything after the first colon as the path.
  return afterColon || null;
}

export interface RebasePromptRequest {
  slug: string;
  area: string;
  worktreePath: string;
  missionSpecificFiles: string[];
  sharedFiles: string[];
  /** Base branch the mission rebases onto; must not throw. */
  resolveBaseBranch: (_slug: string, _worktreePath: string) => string;
  formatVerificationCommand: (_area: string, _worktreePath: string) => string;
}

/** Build the prompt for the agent during shared-file conflict resolution. */
export function buildRebasePrompt({
  slug, area, worktreePath, missionSpecificFiles, sharedFiles, resolveBaseBranch, formatVerificationCommand,
}: RebasePromptRequest): string {
  const missionFileCommands = missionSpecificFiles
    .map(f => `  git checkout --theirs "${f}" && git add "${f}"`)
    .join('\n');
  const sharedFileList = sharedFiles.map(f => `  - ${f}`).join('\n');
  const primaryBranch = resolveBaseBranch(slug, worktreePath);

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
    '  git add "<file>"',
    '  git rebase --continue',
    '',
    'Step 4 — Repeat Steps 1-3 until rebase completes.',
    '',
    'Step 5 — Verify:',
    `  ${formatVerificationCommand(area, worktreePath)}`,
    `  px integrate ${slug} --dry-run`,
    '',
    'Rules:',
    AGENT_COMMAND_COMPLETION_CONTRACT,
    '- Take --theirs for every mission-specific file listed above.',
    '- For shared files, inspect the conflict markers and resolve sensibly.',
    '- If rebase pauses again, repeat the process.',
  ].join('\n');
}

/**
 * Rebase a mission branch onto its local base branch, auto-resolving
 * mission-specific conflicts and launching an agent for shared-file conflicts.
 *
 * Usage: px rebase [<slug>] [--push]
 */
/** Everything the rebase phases share, resolved once at the command boundary. */
interface RebaseContext {
  repairImplementer?: string;
  readonly args: string[];
  readonly port: RebaseWorkflowPort;
  readonly gitFn: GitRunner;
  readonly slug: string;
  readonly branch: string;
  readonly area: string;
  readonly executionRoot: string;
  readonly baseBranch: string;
  readonly isPush: boolean;
  readonly recordedImplementer: string | null;
  /** Mission HEAD before the rebase, when the port records branch moves. */
  readonly movedFrom: string | null;
}

const combineOutput = (result: GitCommandResult) =>
  [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
const continueSucceeded = (result: GitCommandResult) =>
  result.status === 0 || /up to date|Already up to date/i.test((result.stdout || '') + (result.stderr || ''));
const hasConflictMarkers = (output: string) => /CONFLICT|KONFLIKT/i.test(output);

/**
 * The implementer identity, captured before Git rewrites history. The mission
 * record is the pre-replay authority — it lives outside the history being
 * replayed, so a stale mission branch cannot expose an older assignee through
 * it (TASK-2503). The Backlog task file, which is replayed content, is only the
 * fallback. Both are local mission metadata: when neither resolves, the
 * condition is a local workflow one, never a Forgejo or network blocker.
 */
async function resolveRecordedImplementer(slug: string, executionRoot: string, port: RebaseWorkflowPort): Promise<string | null> {
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

function reportRebaseAlreadyInProgress(existingRebase: any, branch: string, port: RebaseWorkflowPort): void {
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

async function performPush(ctx: RebaseContext): Promise<void> {
  const { port, slug, branch, area, executionRoot, isPush, recordedImplementer } = ctx;
  if (!isPush) { return; }
  if (!port.isForgejoReviewEnabled(executionRoot)) {
    fmt.log.info(`Skipping Forgejo push (review provider is not forgejo).`);
    return;
  }
  fmt.log.info(`--push detected. Updating Forgejo PR for ${fmt.branch(branch)}...`);
  const reviewIdentity = port.resolveReviewIdentity(slug, executionRoot);
  const forgejoUser = port.resolveForgejoUser(reviewIdentity.forgejoUser || recordedImplementer || null);
  const token = port.readToken(forgejoUser || 'default');
  if (!token) {
    fmt.log.fail(`No Forgejo token found for user "${fmt.agent(forgejoUser || 'default')}". Push failed.`);
    port.exit(1);
    return;
  }
  // The push-time gate verifies the mission's area, the same one handoff
  // verification ran and the gate evidence reports — never the configured
  // defaultArea createPr falls back to when no area is given.
  const result = port.createPr(branch, forgejoUser || 'default', token, { rootDir: executionRoot, forceWithLease: true, verificationArea: area });
  if (!result.ok) {
    fmt.log.fail(`Push to Forgejo failed: ${result.error}`);
    port.exit(1);
    return;
  }
  fmt.log.pass(`Branch pushed and PR updated for ${fmt.branch(branch)}.`);
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
  fmt.log.fail('Rebase postcondition failed: the local base branch is not an ancestor of the mission HEAD.');
  fmt.log.fail(`Resolved local base branch: ${baseBranch}`);
  fmt.log.fail(`Mission HEAD: ${headSha}`);
  fmt.log.fail('This is local-base ancestry, not origin/mission/* tracking divergence.');
  fmt.log.fail(`Recovery: ${fmt.command('git rebase --abort')}`);
  port.exit(1);
  return false;
}

/** The one success tail: verify ancestry, announce, push, then name what is next. */
async function finishRebase(ctx: RebaseContext, message: string): Promise<void> {
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
  await performPush(ctx);
  fmt.log.info(`Next: ${fmt.command(ctx.port.formatVerificationCommand(ctx.area, ctx.executionRoot))}`);
  fmt.log.info(`Next: ${fmt.command(`px integrate ${ctx.slug} --dry-run`)}`);
  ctx.port.exit(0);
}

/**
 * Implementer that owns a hook fix: the recorded assignee, else a launcher
 * selection probed with the real launcher-status contract. Select an agent
 * first, then probe *that* agent — the production `workflowLauncherStatus`
 * dereferences its required `agent` argument, so probing with none throws.
 */
function resolveBounceImplementer(ctx: RebaseContext): string | null {
  if (ctx.recordedImplementer) { return ctx.recordedImplementer; }
  // The production `selectAgent` contract is `selectAgent(step, options)`;
  // `active` is the policy key that owns implementation work.
  const selected = ctx.port.selectAgent?.('active', {}) ?? null;
  if (!selected) { return null; }
  const status = ctx.port.workflowLauncherStatus?.(selected) ?? { supported: false, agent: selected };
  return status.supported ? (status.agent ?? selected) : null;
}

type HookBounce = { outcome: 'declined' | 'fixed' | 'stranded'; result: GitCommandResult | null };

/**
 * Bounce one hook failure through the kernel. `retryContinue` is the exact
 * `rebase --continue` invocation of the failing site, so the verify re-runs the
 * check that failed rather than probing rebase state. Every hook failure on this
 * command runs through the one rebound kernel (TASK-2377.05); the kernel keeps
 * its per-occurrence budget in memory and nothing is persisted.
 */
async function reboundHookFailure(
  ctx: RebaseContext,
  hookOutput: string,
  classification: { hookType: string | null },
  retryContinue: () => GitCommandResult,
): Promise<HookBounce> {
  const { port, gitFn, slug, executionRoot } = ctx;
  // Interception seam: the pre-review path records the hook evidence and
  // declines the in-child bounce because it owns the budget itself.
  if (port.onHookFailure && !(await port.onHookFailure(classification, hookOutput))) {
    return { outcome: 'declined', result: null };
  }
  const implementer = resolveBounceImplementer(ctx);
  if (!implementer) {
    fmt.log.fail(`Could not determine implementer for ${fmt.slug(slug)}. Cannot bounce the hook failure.`);
    return { outcome: 'declined', result: null };
  }
  let lastResult: GitCommandResult | null = null;
  const outcome = await rebound(
    { kind: 'hook-failure', hook: classification.hookType, operation: 'rebase --continue', output: hookOutput },
    {
      slug,
      worktree: executionRoot,
      implementer,
      startAgent: port.startAgent,
      readHead: () => {
        const result = gitFn(['-C', executionRoot, 'rev-parse', 'HEAD']);
        return result.status === 0 ? result.stdout.trim() : null;
      },
      transitionToImplementer: (bounceSlug: string) =>
        port.transitionTask(bounceSlug, 'active', { rootDir: executionRoot, log: fmt.log.plain }),
      applyAgentFallback: async ({ launchResult, original }) =>
        await port.applyAgentFallback({
          role: 'implementer', original, launchResult, state: {}, slug, worktree: executionRoot,
          log: fmt.log.plain, writeReviewStateFn: port.writeReviewState,
        }) as string || original,
      verify: () => {
        gitFn(['-C', executionRoot, 'add', '-A']);
        lastResult = retryContinue();
        return { ok: continueSucceeded(lastResult), diagnostic: combineOutput(lastResult) };
      },
    },
  );
  if (outcome.outcome === 'fixed') { await port.resumeReviewAfterRepair?.(slug, executionRoot, outcome.implementer); }
  return { outcome: outcome.outcome === 'fixed' ? 'fixed' : 'stranded', result: lastResult };
}

/**
 * A rebase that stopped for something other than a conflict. A hook failure is
 * bounced through the kernel, whose verify re-runs `rebase --continue`, so
 * `fixed` means the rebase actually advanced — not merely that an agent ran.
 */
async function handleNonConflictRebaseFailure(ctx: RebaseContext, rebaseResult: GitCommandResult, rebaseOutput: string): Promise<void> {
  const { port } = ctx;
  fmt.log.fail('Rebase failed with a non-conflict error.');
  if (rebaseOutput) {
    fmt.log.fail('--- Git Output ---');
    fmt.log.fail(rebaseOutput);
    fmt.log.fail('------------------');
  }
  if (rebaseResult.status === 128) {
    fmt.log.fail('Hint: This might be a repository lock or an invalid upstream branch.');
    fmt.log.fail(`Recovery: ${fmt.command('git rebase --abort')}`);
    port.exit(1);
    return;
  }

  const classification = classifyHookFailure(rebaseOutput);
  if (classification.isHookFailure && typeof port.missionServices === 'function') {
    const bounce = await reboundHookFailure(ctx, rebaseOutput, classification, () => continueRebaseCommand(ctx));
    if (bounce.outcome === 'fixed') {
      await finishRebase(ctx, 'Rebase completed after hook fix.');
      return;
    }
    if (bounce.outcome === 'stranded') {
      fmt.log.fail('Rebase still failed after implementer hook fix. Manual intervention required.');
    }
  } else if (classification.isHookFailure) {
    // Keep the established diagnostic for direct callers that have not composed
    // the mission persistence services required for rebounce.
    fmt.log.fail('Hint: A git hook failed. Fix the issues reported above.');
  }
  fmt.log.fail(`Recovery: ${fmt.command('git rebase --abort')}`);
  port.exit(1);
}

function continueRebaseCommand(ctx: RebaseContext, opts: { stdio?: string } = {}): GitCommandResult {
  return ctx.gitFn(['-C', ctx.executionRoot, '-c', 'core.editor=true', '-c', 'merge.autoedit=no', 'rebase', '--continue'], opts);
}

/**
 * Split the paused rebase's conflicts into mission-owned and shared. Returns
 * null once a diagnostic has been emitted and the process exit set.
 */
function classifyRebaseConflicts(ctx: RebaseContext, rebaseOutput: string): MissionConflictClassification | null {
  const { port, gitFn, slug, area, branch, executionRoot } = ctx;
  const conflictResult = port.resolveConflictsForMission(slug, area, { worktreePathOverride: executionRoot }) as MissionConflictClassification;

  // When rebase is in progress in the worktree, dry merge may fail. Fall back to
  // parsing the rebase output directly.
  if (conflictResult.ok === false && conflictResult.error === 'merge-failed') {
    fmt.log.info('Dry merge failed (rebase in progress). Parsing rebase output directly...');
    // Prefer git status --porcelain (authoritative index entries) over localized
    // rebase text, which can contain advice prefixes that parse as false paths.
    const statusFiles = parseConflictFilesFromGitStatus(executionRoot, gitFn);
    const conflictFiles = statusFiles.length > 0 ? statusFiles : parseConflictFilesFromRebaseOutput(rebaseOutput);
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
    : parseConflictFilesFromRebaseOutput(rebaseOutput);
  // Only treat unclassified conflict files as shared-file conflicts.
  if (conflictResult.sharedFiles.length === 0 && conflictFiles.length > 0) {
    const classified = new Set([...conflictResult.missionSpecificFiles]);
    const unclassified = conflictFiles.filter((f: string) => !classified.has(f));
    if (unclassified.length > 0) { conflictResult.sharedFiles = unclassified; }
  }
  return conflictResult;
}

/** Bookkeeping for the bounded `rebase --continue` budget. */
interface ContinueDriver {
  attempts: number;
  readonly max: number;
  run: (_opts?: { stdio?: string }) => GitCommandResult;
}

function reportContinueFailure(result: GitCommandResult): void {
  const output = combineOutput(result);
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
}

function failContinueBudget(ctx: RebaseContext, driver: ContinueDriver, branchName: string): void {
  fmt.log.fail(`Rebase still in progress on branch ${fmt.branch(branchName || ctx.slug)} after ${driver.attempts} failed --continue attempt(s).`);
  fmt.log.fail(`Check rebase state: ${fmt.command('git status')}`);
  fmt.log.fail(`Next: ${fmt.command('git rebase --continue')}`);
  fmt.log.fail(`If the current commit is empty: ${fmt.command('git rebase --skip')}`);
  fmt.log.fail(`If recovery is needed: ${fmt.command('git rebase --abort')}`);
  ctx.port.exit(1);
}

/** The branch a rebase is currently stopped on, or '' when none is in progress. */
function rebaseInProgressBranch(ctx: RebaseContext): string {
  return ctx.gitFn(['-C', ctx.executionRoot, 'rebase', '--show-current']).stdout.trim();
}

/**
 * One kernel call, no loop: the kernel owns the retry budget and re-runs this
 * site's own `rebase --continue` as its verify (TASK-2377.05).
 */
async function recoverHookFailureFromContinue(ctx: RebaseContext, driver: ContinueDriver, result: GitCommandResult): Promise<{ result: GitCommandResult; stranded: boolean }> {
  if (result.status === 0) { return { result, stranded: false }; }
  const output = combineOutput(result);
  const classification = classifyHookFailure(output);
  if (!classification.isHookFailure) { return { result, stranded: false }; }
  // Direct callers without composed mission services retain the legacy
  // hint-and-exit path; the production CLI always supplies this seam.
  if (typeof ctx.port.missionServices !== 'function') { return { result, stranded: false }; }
  const bounce = await reboundHookFailure(ctx, output, classification, () => driver.run());
  if (bounce.outcome === 'fixed' && bounce.result) { return { result: bounce.result, stranded: false }; }
  return { result: bounce.result ?? result, stranded: true };
}

type ContinueOutcome = 'completed' | 'exited' | 'recursed' | 'unfinished';

/** Spend one budgeted `--continue`, bouncing a hook failure once. */
async function attemptContinue(ctx: RebaseContext, driver: ContinueDriver): Promise<{ result: GitCommandResult } | { outcome: 'exited' }> {
  if (driver.attempts >= driver.max) {
    failContinueBudget(ctx, driver, rebaseInProgressBranch(ctx));
    return { outcome: 'exited' };
  }
  const result = driver.run();
  if (result.status === 0) { return { result }; }
  const recovery = await recoverHookFailureFromContinue(ctx, driver, result);
  if (recovery.stranded) { return { outcome: 'exited' }; }
  return { result: recovery.result };
}

type DriveClassification =
  | { action: 'completed' | 'recursed' | 'exited' }
  | { action: 'retry'; staged: boolean };

/**
 * Classify the state before a budgeted `--continue`: done, new conflicts, or
 * retry with the worktree's staged state. The worktree, not the --continue
 * output, shows which of editor/hook/empty-pick caused the stop.
 */
function classifyPreContinue(ctx: RebaseContext, result: GitCommandResult): DriveClassification {
  if (result.status === 0) { return { action: 'completed' }; }
  if (hasConflictMarkers(combineOutput(result))) {
    fmt.log.info('More conflicts found. Re-running classification...');
    return { action: 'recursed' };
  }
  const staged = Boolean(ctx.gitFn(['-C', ctx.executionRoot, 'status', '--porcelain']).stdout.trim());
  if (staged) {
    fmt.log.info('More changes detected. Continuing rebase...');
    ctx.gitFn(['-C', ctx.executionRoot, 'add', '-A']);
    return { action: 'retry', staged: true };
  }
  if (!rebaseInProgressBranch(ctx)) {
    // Nothing staged and no rebase left: the earlier --continue finished it.
    return { action: 'completed' };
  }
  fmt.log.info('No unresolved conflicts; rebase still in progress. Retrying --continue (hook/empty-pick)...');
  return { action: 'retry', staged: false };
}

/**
 * Classify the state after a spent `--continue`: done, back to retry, or a
 * terminal failure. Staged work that still will not continue is a real failure;
 * an empty pick is not, so only the latter walks on to the next commit.
 */
function classifyPostContinue(ctx: RebaseContext, driver: ContinueDriver, result: GitCommandResult, staged: boolean): DriveClassification {
  if (result.status === 0) { return { action: 'completed' }; }
  if (hasConflictMarkers(combineOutput(result))) { return { action: 'retry', staged }; }
  const stillRebasing = rebaseInProgressBranch(ctx);
  if (!stillRebasing) { return { action: 'completed' }; }
  if (driver.attempts >= driver.max) {
    failContinueBudget(ctx, driver, stillRebasing);
    return { action: 'exited' };
  }
  if (staged) {
    reportContinueFailure(result);
    ctx.port.exit(1);
    return { action: 'exited' };
  }
  fmt.log.info('Empty pick detected; continuing to next commit...');
  return { action: 'retry', staged: false };
}

/**
 * Drive `rebase --continue` after the mission-owned conflicts were staged. New
 * conflicts re-enter the whole workflow; an empty pick or a hook retries within
 * the budget; anything else reports and exits.
 */
async function driveRebaseToCompletion(ctx: RebaseContext, driver: ContinueDriver, first: GitCommandResult): Promise<ContinueOutcome> {
  let result = first;
  for (;;) {
    const pre = classifyPreContinue(ctx, result);
    if (pre.action === 'retry') {
      const attempt = await attemptContinue(ctx, driver);
      if ('outcome' in attempt) { return 'exited'; }
      result = attempt.result;
      const post = classifyPostContinue(ctx, driver, result, pre.staged);
      if (post.action === 'retry') { continue; }
      return post.action;
    }
    if (pre.action === 'recursed') {
      // Recurse once more for chained conflicts, preserving flags and ports.
      await runRebaseWorkflow(ctx.args, ctx.port);
      return 'recursed';
    }
    return pre.action;
  }
}

/** Stage every mission-owned conflict with `--theirs`, then finish the rebase. */
async function autoResolveMissionConflicts(ctx: RebaseContext, conflictResult: MissionConflictClassification): Promise<ContinueOutcome> {
  const { gitFn, executionRoot } = ctx;
  fmt.log.info(`All ${conflictResult.missionSpecificFiles.length} conflict(s) are mission-specific. Auto-resolving...`);
  const driver: ContinueDriver = {
    attempts: 0,
    max: 3,
    run: (opts = {}) => { driver.attempts += 1; return continueRebaseCommand(ctx, opts); },
  };

  for (const file of conflictResult.missionSpecificFiles) {
    fmt.log.info(`Resolving: ${fmt.path(file)}`);
    if (gitFn(['-C', executionRoot, 'checkout', '--theirs', file]).status !== 0) {
      // Try add as fallback (the file may have been added or deleted).
      gitFn(['-C', executionRoot, 'add', file]);
    }
    if (gitFn(['-C', executionRoot, 'add', file]).status !== 0) {
      fmt.log.warn(`Could not add ${fmt.path(file)} for rebase continue.`);
    }
  }

  fmt.log.info('Continuing rebase...');
  const first = driver.run();
  const recovery = await recoverHookFailureFromContinue(ctx, driver, first);
  if (recovery.stranded) { return 'exited'; }
  return await driveRebaseToCompletion(ctx, driver, recovery.result);
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
  if (!selected || selected === implementer) { return null; }
  const status = ctx.port.workflowLauncherStatus?.(selected) ?? { supported: false, agent: selected };
  return status.supported ? (status.agent ?? selected) : null;
}

/**
 * Conflict resolution is implementation work owned by the mission's recorded
 * implementer (TASK-2294.01), so the family is pinned. A usage block on that
 * family may substitute an eligible replacement; it is never reported as an
 * infrastructure or Forgejo failure.
 */
async function launchConflictResolver(ctx: RebaseContext, implementer: string, prompt: string): Promise<{ agent: string; result: { status: number } } | null> {
  const { port, executionRoot, slug } = ctx;
  const launchOptions = { prompt, worktree: executionRoot, slug, role: 'implementer' };
  try {
    if (typeof port.missionServices === 'function') {
      await port.transitionTask(slug, 'active', { rootDir: executionRoot, log: fmt.log.plain });
      ctx.repairImplementer = implementer;
    }
    return await port.startAgent('conflict-resolution', { ...launchOptions, agent: implementer, pinnedAgent: true });
  } catch (err: any) {
    const message = err?.message || String(err);
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
      return await port.startAgent('conflict-resolution', { ...launchOptions, agent: replacement });
    }
    const resetMatch = /blocked[ \t]+until[ \t]+/i.exec(message);
    const resetTail = resetMatch ? message.slice(resetMatch.index + resetMatch[0].length) : '';
    const resetTime = resetTail.includes('\n') || resetTail.includes('\r') ? null : resetTail.trim() || null;
    fmt.log.fail(`Implementer ${fmt.agent(implementer)} hit an agent usage limit${resetTime ? ` (resets ${resetTime})` : ''}.`);
    fmt.log.info('No eligible replacement family is available under the current mission policy, so the rebase cannot continue automatically.');
    fmt.log.info(`Recovery: ${fmt.command('git rebase --abort')}`);
    port.exit(1);
    return null;
  }
}

/** Hand the shared-file conflicts to the mission implementer. */
async function resolveSharedConflicts(ctx: RebaseContext, conflictResult: MissionConflictClassification): Promise<void> {
  const { port, gitFn, slug, area, executionRoot, recordedImplementer } = ctx;
  fmt.log.info(`${conflictResult.sharedFiles.length} shared file(s) require agent-assisted resolution:`);
  conflictResult.sharedFiles.forEach((f: string) => fmt.log.info(`  - ${fmt.path(f)}`));

  const prompt = buildRebasePrompt({
    slug,
    area,
    worktreePath: executionRoot,
    missionSpecificFiles: conflictResult.missionSpecificFiles,
    sharedFiles: conflictResult.sharedFiles,
    resolveBaseBranch: (promptSlug, promptRoot) => port.resolvePromptBaseBranch(promptSlug, promptRoot, gitFn),
    formatVerificationCommand: (promptArea, promptRoot) => port.formatVerificationCommand(promptArea, promptRoot),
  });

  if (!recordedImplementer) {
    fmt.log.fail(`No recorded implementer for ${fmt.slug(slug)}; cannot launch conflict resolution.`);
    fmt.log.info('Conflict resolution runs as the mission implementer. Set the task assignee to a supported agent family, then re-run.');
    fmt.log.info(`Recovery: ${fmt.command('git rebase --abort')}`);
    port.exit(1);
    return;
  }

  fmt.log.info(`Launching implementer (${fmt.agent(recordedImplementer)}) for conflict resolution...`);
  const launch = await launchConflictResolver(ctx, recordedImplementer, prompt);
  if (!launch) { return; }
  const { agent, result: agentResult } = launch;

  if (agentResult.status !== 0) {
    fmt.log.fail(`Agent (${fmt.agent(agent)}) exited with status ${agentResult.status}.`);
    fmt.log.info(`You may need to abort the rebase: ${fmt.command('git rebase --abort')}`);
    port.exit(agentResult.status || 1);
    return;
  }

  // Verify rebase is actually complete before pushing.
  if (rebaseInProgressBranch(ctx)) {
    fmt.log.pass(`Agent (${fmt.agent(agent)}) completed their round.`);
    fmt.log.warn('Rebase is still in progress. Skipping automatic push.');
    fmt.log.info('Next: Resolve remaining conflicts or continue rebase.');
    port.exit(0);
    return;
  }
  await finishRebase(ctx, `Agent (${fmt.agent(agent)}) completed conflict resolution.`);
}

export async function runRebaseWorkflow(args: string[], port: RebaseWorkflowPort): Promise<void> {
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
  if (existingRebase.inProgress) {
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

  const ctx: RebaseContext = {
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

  fmt.log.info(`Rebasing ${fmt.branch(branch)} onto local ${fmt.branch(ctx.baseBranch)}...`);
  const rebaseResult = gitFn(['-C', executionRoot, '-c', 'core.editor=true', '-c', 'merge.autoedit=no', 'rebase', ctx.baseBranch]);

  // Rebase succeeded (status 0) or was already up to date.
  if (continueSucceeded(rebaseResult)) {
    if (rebaseInProgressBranch(ctx)) {
      // `rebase --show-current` returned something but status was 0 — incomplete.
      fmt.log.pass('Rebase round completed.');
      fmt.log.warn('Rebase is still in progress (non-empty --show-current). Skipping automatic push.');
      fmt.log.info(`Next: ${fmt.command(port.formatVerificationCommand(ctx.area, executionRoot))}`);
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
    await handleNonConflictRebaseFailure(ctx, rebaseResult, rebaseOutput);
    return;
  }

  fmt.log.warn('Rebase paused on conflicts. Classifying...');
  const conflictResult = classifyRebaseConflicts(ctx, rebaseOutput);
  if (!conflictResult) { return; }

  // All conflicts are mission-specific — auto-resolve with --theirs.
  if (conflictResult.sharedFiles.length === 0) {
    const outcome = await autoResolveMissionConflicts(ctx, conflictResult);
    if (outcome !== 'unfinished') {
      if (outcome === 'completed') {
        await finishRebase(ctx, 'Mission-specific conflicts resolved. Rebase completed.');
      }
      return;
    }
  }

  await resolveSharedConflicts(ctx, conflictResult);
}
