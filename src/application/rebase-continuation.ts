import { recoverRebaseLock } from './rebase-lock-recovery.js';
import { recordImplementerLaunch } from './rebase-identity.js';
import { rebaseHookRecoveryEligible, replacementImplementer, preContinueAction, postContinueAction, continueBudgetExceeded } from '../domain/rebase-policy.js';
import * as fmt from './presentation/cli-format.js';
import { classifyHookFailure } from './hook-failure-workflow.js';
import { rebound } from './rebound-kernel.js';
import { combineOutput, continueSucceeded, hasConflictMarkers, type RebaseContext } from './rebase-context.js';
import type { GitCommandResult, MissionConflictClassification } from './ports/rebase-workflow.js';
import type { RebaseWorkflowPort } from './ports/rebase-workflow.js';
import { failureReason } from '../domain/failure-reason.js';
import { liveMissionExecutionContext } from './ports/mission-execution-context.js';

const REPLAY_PROOF_MAX_COMMITS = 256;
const REPLAY_PROOF_MAX_BYTES = 64 * 1024;
const GIT_OBJECT_ID = /^[0-9a-f]{40,64}$/;

type ReplayHistoryRow = [commit: string, parents: string, tree: string];
type ReplaySnapshot = {
  targetTree: string;
  originalTip: string;
  targetParent: string;
  rows: ReplayHistoryRow[];
};

function runReplayProof(ctx: RebaseContext, args: string[]): GitCommandResult {
  return ctx.gitFn(['-C', ctx.executionRoot, ...args], { maxBuffer: REPLAY_PROOF_MAX_BYTES });
}

function readReplayProof(ctx: RebaseContext, args: string[]): string {
  const result = runReplayProof(ctx, args);
  const value = result.status === 0 ? result.stdout.trim() : '';
  return value.length <= REPLAY_PROOF_MAX_BYTES ? value : '';
}

function parseLinearReplayRows(output: string, targetParent: string, originalTip: string): ReplayHistoryRow[] | null {
  const lines = output.trim().split('\n').filter(Boolean);
  if (lines.length === 0 || lines.length > REPLAY_PROOF_MAX_COMMITS) { return null; }
  const rawRows = lines.map(line => line.split('\t'));
  if (rawRows.some(row => row.length !== 3 || !GIT_OBJECT_ID.test(row[0] ?? '') || !GIT_OBJECT_ID.test(row[2] ?? ''))) {
    return null;
  }
  const rows = rawRows as ReplayHistoryRow[];
  if (rows[0]?.[0] !== originalTip) { return null; }
  for (let index = 0; index < rows.length; index++) {
    const parents = rows[index][1].split(' ').filter(Boolean);
    const expectedParent = index === rows.length - 1 ? targetParent : rows[index + 1][0];
    if (parents.length !== 1 || parents[0] !== expectedParent) { return null; }
  }
  return rows;
}

function readReplaySnapshot(ctx: RebaseContext, target: string): ReplaySnapshot | null {
  if (!GIT_OBJECT_ID.test(target)) { return null; }
  if (readReplayProof(ctx, ['rev-parse', '--is-shallow-repository']) !== 'false') { return null; }
  const targetTree = readReplayProof(ctx, ['rev-parse', '--verify', `${target}^{tree}`]);
  const originalTip = readReplayProof(ctx, ['rev-parse', '--verify', 'HEAD^{commit}']);
  if (!GIT_OBJECT_ID.test(targetTree) || !GIT_OBJECT_ID.test(originalTip)) { return null; }
  const targetLine = readReplayProof(ctx, ['rev-list', '--parents', '--max-count=1', target]).split(' ').filter(Boolean);
  const targetParent = targetLine[1] ?? '';
  if (targetLine.length !== 2 || targetLine[0] !== target || !GIT_OBJECT_ID.test(targetParent)) { return null; }
  if (runReplayProof(ctx, ['merge-base', '--is-ancestor', targetParent, originalTip]).status !== 0) { return null; }
  const historyResult = runReplayProof(ctx, ['log', '--first-parent', '--format=%H%x09%P%x09%T',
    `--max-count=${REPLAY_PROOF_MAX_COMMITS + 1}`, `${targetParent}..${originalTip}`]);
  if (historyResult.status !== 0 || historyResult.stdout.length > REPLAY_PROOF_MAX_BYTES) { return null; }
  const rows = parseLinearReplayRows(historyResult.stdout, targetParent, originalTip);
  return rows ? { targetTree, originalTip, targetParent, rows } : null;
}

function replayRefsAreStable(ctx: RebaseContext, target: string, originalTip: string): boolean {
  return readReplayProof(ctx, ['rev-parse', '--verify', ctx.baseBranch]) === target
    && readReplayProof(ctx, ['rev-parse', '--verify', 'HEAD^{commit}']) === originalTip;
}

/**
 * Find the one supported narrower replay boundary: a complete linear range
 * from the pinned target's parent to HEAD containing exactly one commit whose
 * tree equals the pinned target. Unrelated older repository history is outside
 * that range. Any incomplete, ambiguous or failed observation declines to
 * select a boundary so the established ordinary rebase remains authoritative.
 */
function exactTreeReplayBoundary(ctx: RebaseContext, target: string): string | null {
  try {
    const snapshot = readReplaySnapshot(ctx, target);
    if (!snapshot) { return null; }
    const { targetTree, originalTip, targetParent, rows } = snapshot;
    const matches = rows.filter(row => row[2] === targetTree);
    if (matches.length !== 1 || matches[0][0] === originalTip) { return null; }
    const boundary = matches[0]?.[0] ?? '';
    const sharedBase = readReplayProof(ctx, ['merge-base', target, boundary]);
    if (sharedBase !== targetParent) { return null; }
    const targetAncestry = runReplayProof(ctx, ['merge-base', '--is-ancestor', target, originalTip]);
    const boundaryAncestry = runReplayProof(ctx, ['merge-base', '--is-ancestor', boundary, originalTip]);
    if (targetAncestry.status !== 1 || boundaryAncestry.status !== 0) { return null; }
    return replayRefsAreStable(ctx, target, originalTip) ? boundary : null;
  } catch {
    return null;
  }
}

/** Start one initial or resumed rebase round from the context's selected worktree. */
export function startRebaseRound(ctx: RebaseContext, resumeInPlace: boolean,
  existingRebase: ReturnType<RebaseWorkflowPort['detectRebaseState']>): GitCommandResult {
  if (resumeInPlace) {
    fmt.log.warn('Rebase already paused on conflicts. Re-classifying...');
    return { failureReason: failureReason('git-conflict', 'git'), status: 1, stdout: '', stderr: existingRebase.unmergedFiles
      .map(file => `CONFLICT (content): Merge conflict in ${file}`).join('\n') };
  }
  const base = ctx.gitFn(['-C', ctx.executionRoot, 'rev-parse', '--verify', ctx.baseBranch]);
  ctx.rebaseTargetRevision = base.status === 0 ? base.stdout.trim() || undefined : undefined;
  fmt.log.info(`Rebasing ${fmt.branch(ctx.branch)} onto local ${fmt.branch(ctx.baseBranch)}...`);
  const target = ctx.rebaseTargetRevision;
  const boundary = target ? exactTreeReplayBoundary(ctx, target) : null;
  if (boundary && target) {
    return ctx.gitFn(['-C', ctx.executionRoot, '-c', 'core.editor=true', '-c', 'merge.autoedit=no',
      'rebase', '--onto', target, boundary]);
  }
  return ctx.gitFn(['-C', ctx.executionRoot, '-c', 'core.editor=true', '-c', 'merge.autoedit=no', 'rebase', ctx.baseBranch]);
}

export function rebaseBaseFreshness(ctx: RebaseContext):
  | { kind: 'current' | 'invalid' }
  | { kind: 'advanced'; from: string; to: string } {
  const ancestry = ctx.gitFn(['-C', ctx.executionRoot, 'merge-base', '--is-ancestor', ctx.baseBranch, 'HEAD']);
  if (ancestry.status === 0) { return { kind: 'current' }; }
  const from = ctx.rebaseTargetRevision;
  if (!from) { return { kind: 'invalid' }; }
  const current = ctx.gitFn(['-C', ctx.executionRoot, 'rev-parse', ctx.baseBranch]);
  const to = current.status === 0 ? current.stdout.trim() : '';
  if (!to || to === from) { return { kind: 'invalid' }; }
  const advanced = ctx.gitFn(['-C', ctx.executionRoot, 'merge-base', '--is-ancestor', from, to]);
  return advanced.status === 0 ? { kind: 'advanced', from, to } : { kind: 'invalid' };
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
  return replacementImplementer(selected, ctx.recordedImplementer ?? '', status.supported, status.agent);
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
      applyAgentFallback: async ({ launchResult, original }) => {
        if (port.missionServices) {
          const services = await port.missionServices(executionRoot);
          const actual = launchResult?.agent || original;
          await recordImplementerLaunch(slug, actual, services.store, services.lifecycle);
          return actual;
        }
        const live = liveMissionExecutionContext(slug, port.resolveExecutionContext(slug, executionRoot));
        if (!live.ok) { throw new Error(live.reason); }
        return await port.applyAgentFallback({
          role: 'implementer', original, launchResult, state: {}, slug, executionContext: live.context,
          log: fmt.log.plain, writeReviewStateFn: port.writeReviewState,
        }) || original;
      },
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
export async function handleNonConflictRebaseFailure(ctx: RebaseContext, rebaseResult: GitCommandResult, rebaseOutput: string): Promise<boolean> {
  const { port } = ctx;
  port.onFailure?.({ kind: 'other', operation: 'rebase', output: rebaseOutput || 'Rebase failed with a non-conflict error.' });
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
    return false;
  }

  const classification = classifyHookFailure(rebaseResult);
  if (classification.isHookFailure && (typeof port.missionServices === 'function' || Boolean(port.onHookFailure))) {
    const bounce = await reboundHookFailure(ctx, rebaseOutput, classification, () => continueRebaseCommand(ctx));
    if (bounce.outcome === 'fixed') {
      return true;
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
  return false;
}

function continueRebaseCommand(ctx: RebaseContext, opts: { stdio?: string } = {}): GitCommandResult {
  return ctx.gitFn(['-C', ctx.executionRoot, '-c', 'core.editor=true', '-c', 'merge.autoedit=no', 'rebase', '--continue'], opts);
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
  if (classifyHookFailure(result).isHookFailure) {
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

/**
 * True while the execution worktree still holds rebase state (TASK-2828).
 *
 * Replaces `git rebase --show-current`, which git prefix-matches to
 * `--show-current-patch`: that probe buffered the whole current commit patch and
 * failed with ENOBUFS on a large change, and its stdout was never a branch name.
 * The rebase-state owner answers the same question from fixed-size metadata.
 */
function rebaseStillInProgress(ctx: RebaseContext): boolean {
  return ctx.port.detectRebaseState(ctx.executionRoot).inProgress;
}

/** Branch label for diagnostics; empty while HEAD is detached mid-rebase. */
function rebaseDiagnosticBranch(ctx: RebaseContext): string {
  return ctx.port.getCurrentBranch(ctx.executionRoot);
}

/**
 * One kernel call, no loop: the kernel owns the retry budget and re-runs this
 * site's own `rebase --continue` as its verify (TASK-2377.05).
 */
async function recoverHookFailureFromContinue(ctx: RebaseContext, driver: ContinueDriver, result: GitCommandResult): Promise<{ result: GitCommandResult; stranded: boolean }> {
  if (result.status === 0) { return { result, stranded: false }; }
  const output = combineOutput(result);
  const classification = classifyHookFailure(result);
  if (!rebaseHookRecoveryEligible(result.status, classification.isHookFailure, typeof ctx.port.missionServices === 'function' || Boolean(ctx.port.onHookFailure))) { return { result, stranded: false }; }
  // Direct callers without composed mission services retain the legacy
  // hint-and-exit path; the production CLI always supplies this seam.
  const bounce = await reboundHookFailure(ctx, output, classification, () => driver.run());
  if (bounce.outcome === 'fixed' && bounce.result) { return { result: bounce.result, stranded: false }; }
  return { result: bounce.result ?? result, stranded: true };
}

export type ContinueOutcome = 'completed' | 'exited' | 'recursed' | 'unfinished';

/** Spend one budgeted `--continue`, bouncing a hook failure once. */
async function attemptContinue(ctx: RebaseContext, driver: ContinueDriver): Promise<{ result: GitCommandResult } | { outcome: 'exited' }> {
  if (continueBudgetExceeded(driver.attempts, driver.max)) {
    failContinueBudget(ctx, driver, rebaseDiagnosticBranch(ctx));
    return { outcome: 'exited' };
  }
  const result = await recoverRebaseLock(ctx, driver.run(), ['-C', ctx.executionRoot, 'rebase', '--continue']);
  if (!result) { return { outcome: 'exited' }; }
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
  // Preserve observation order: terminal results never query staged/rebase state.
  let action = preContinueAction(result.status, hasConflictMarkers(result), false, true);
  if (action === 'completed') { return { action }; }
  if (action === 'recursed') {
    fmt.log.info('More conflicts found. Re-running classification...');
    return { action };
  }
  const staged = Boolean(ctx.gitFn(['-C', ctx.executionRoot, 'status', '--porcelain']).stdout.trim());
  action = preContinueAction(result.status, false, staged, staged ? true : rebaseStillInProgress(ctx));
  if (action === 'completed') { return { action }; }
  if (staged) {
    fmt.log.info('More changes detected. Continuing rebase...');
    ctx.gitFn(['-C', ctx.executionRoot, 'add', '-A']);
  } else {
    fmt.log.info('No unresolved conflicts; rebase still in progress. Retrying --continue (hook/empty-pick)...');
  }
  return { action: 'retry', staged };
}

/**
 * Classify the state after a spent `--continue`: done, back to retry, or a
 * terminal failure. Staged work that still will not continue is a real failure;
 * an empty pick is not, so only the latter walks on to the next commit.
 */
function classifyPostContinue(ctx: RebaseContext, driver: ContinueDriver, result: GitCommandResult, staged: boolean): DriveClassification {
  const conflicts = hasConflictMarkers(result);
  const stillRebasing = result.status === 0 || conflicts ? false : rebaseStillInProgress(ctx);
  const action = postContinueAction(result.status, conflicts, stillRebasing, driver.attempts, driver.max, staged);
  if (action === 'completed') { return { action }; }
  if (action === 'budget-exhausted') {
    failContinueBudget(ctx, driver, stillRebasing ? rebaseDiagnosticBranch(ctx) : '');
    return { action: 'exited' };
  }
  if (action === 'staged-failure') {
    reportContinueFailure(result);
    ctx.port.exit(1);
    return { action: 'exited' };
  }
  if (!conflicts) { fmt.log.info('Empty pick detected; continuing to next commit...'); }
  return { action: 'retry', staged };
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
    return pre.action;
  }
}

/** Stage every mission-owned conflict with `--theirs`, then finish the rebase. */
export async function autoResolveMissionConflicts(ctx: RebaseContext, conflictResult: MissionConflictClassification): Promise<ContinueOutcome> {
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
  const first = await recoverRebaseLock(ctx, driver.run(), ['-C', executionRoot, 'rebase', '--continue']);
  if (!first) { return 'exited'; }
  const recovery = await recoverHookFailureFromContinue(ctx, driver, first);
  if (recovery.stranded) { return 'exited'; }
  return await driveRebaseToCompletion(ctx, driver, recovery.result);
}
