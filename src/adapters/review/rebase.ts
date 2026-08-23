/**
 * Rebase helpers for pre-review workflow.
 *
 * Extracted from review-loop.js to break the circular dependency:
 *   handoff.js -> review-loop.js -> handoff.js
 *
 * Both handoff.js and review-loop.js import from this module instead.
 */

import * as path from 'path';
import * as fmt from '../../application/presentation/cli-format.js';
import { git } from '../git/git.js';
import { resolveWorktree, isMissionArtifact, isWorkflowGeneratedArtifact } from '../filesystem/mission-utils.js';
import { isProviderEnabled } from './review-adapter.js';
import type {
  MissionConflictClassification,
  PreReviewRebaseGateEvidence,
  PreReviewRebaseHookEvidence,
  PreReviewRebaseResult,
  RebaseWorkflowPort,
} from '../../application/ports/rebase-workflow.js';
import type { RebaseCommandOptions } from '../rebase/rebase-workflow-adapter.js';

export type {
  PreReviewRebaseFailure,
  PreReviewRebaseGateEvidence,
  PreReviewRebaseHookEvidence,
  PreReviewRebaseOperation,
  PreReviewRebaseOutcome,
  PreReviewRebaseResult,
} from '../../application/ports/rebase-workflow.js';

/** Workflow seam: `runRebaseWorkflow` from `src/application/rebase-workflow.ts`. */
type RunRebaseWorkflowFn = (_args: string[], _port: RebaseWorkflowPort) => Promise<void>;
/** Port factory seam: `createRebaseWorkflowPort` from the rebase adapter. */
type CreateRebaseWorkflowPortFn = (_options?: RebaseCommandOptions) => RebaseWorkflowPort;

/**
 * Auto-commit safe mission artifacts before rebase.
 * Only touches mission-generated files and task files.
 * @param {string} slug
 * @param {string} worktree
 * @param {{taskFile?: string|null, gitFn?: Function, log?: Function, error?: Function, isMissionArtifactFn?: Function, isWorkflowGeneratedArtifactFn?: Function}} [options]
 * @returns {Promise<{ok: boolean, dirty: boolean, unsafe?: boolean, unsafeFiles?: string[], hookFailure?: boolean, hook?: string, output?: string}>}
 */
export async function commitSafeMissionArtifacts(slug: string, worktree: string, {
  taskFile = null,
  gitFn = git,
  log = fmt.log.plain,
  error = fmt.log.plainError,
  isMissionArtifactFn = isMissionArtifact,
  isWorkflowGeneratedArtifactFn = isWorkflowGeneratedArtifact,
}: {
  taskFile?: string | null;
  gitFn?: typeof git;
  log?: (_msg: string) => void;
  error?: (_msg: string) => void;
  isMissionArtifactFn?: (_file: string, _slug: string, _rootDir: string) => boolean;
  isWorkflowGeneratedArtifactFn?: (_file: string) => boolean;
} = {}): Promise<{ ok: boolean; dirty: boolean; unsafe?: boolean; unsafeFiles?: string[]; hookFailure?: boolean; hook?: string; output?: string }> {
  const rootDir = worktree || process.cwd();
  const statusResult = gitFn(['-C', rootDir, 'status', '--porcelain=v1', '-z']);
  if (statusResult.status !== 0 || !statusResult.stdout) {
    return { ok: true, dirty: false };
  }

  const parsePorcelainZ = (stdout: string | Buffer) => {
    const entries = String(stdout).split('\0').filter(Boolean);
    const dirty: { xy: string; file: string; paths: string[]; source?: string }[] = [];
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      const xy = entry.slice(0, 2);
      const file = entry.slice(3);
      const record: { xy: string; file: string; paths: string[]; source?: string } = { xy, file, paths: [file] };
      if ((xy[0] === 'R' || xy[0] === 'C') && i + 1 < entries.length) {
        const source = entries[i + 1];
        record.source = source;
        record.paths.push(source);
        i += 1;
      }
      dirty.push(record);
    }
    return dirty;
  };

  const dirtyFiles = parsePorcelainZ(statusResult.stdout);

  const unmerged = dirtyFiles.filter(f => ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(f.xy));
  if (unmerged.length > 0) {
    error(fmt.status('FAIL', `Cannot auto-commit: unmerged/conflicting files detected:\n${unmerged.map((f: { file: string }) => `       - ${f.file}`).join('\n')}`));
    return { ok: false, dirty: true, unsafe: true, unsafeFiles: unmerged.map((f: { file: string }) => f.file) };
  }

  // architecture migration: there is no stats CSV to auto-commit any more — measurements
  // live in the operator-local database, outside every repository.
  const resolvedTaskFile = taskFile ? path.relative(rootDir, taskFile) : null;
  const isSafeToCommit = (file: string) =>
    isWorkflowGeneratedArtifactFn(file)
    || isMissionArtifactFn(file, slug, rootDir)
    || !!(resolvedTaskFile && file === resolvedTaskFile);

  const unsafeFiles = dirtyFiles
    .flatMap((f: { paths: string[] }) => f.paths)
    .filter((file: string) => !isSafeToCommit(file));
  if (unsafeFiles.length > 0) {
    error(fmt.status('FAIL', `Cannot auto-commit: dirty files include non-mission paths:`));
    unsafeFiles.forEach((file: string) => error(`       - ${file}`));
    return { ok: false, dirty: true, unsafe: true, unsafeFiles };
  }

  log(`Auto-committing safe mission artifacts for ${fmt.branch(`mission/${slug}`)} before rebase...`);
  dirtyFiles.forEach((f: { file: string }) => {
    log(`       - ${f.file}`);
    gitFn(['-C', rootDir, 'add', '--', f.file]);
  });

  const commitRes = gitFn(['-C', rootDir, 'commit', '-m', `workflow(${slug}): auto-commit mission artifacts before pre-review rebase`]);
  if (commitRes.status === 0) {
    log(fmt.status('PASS', 'Mission artifacts committed.'));
    return { ok: true, dirty: true };
  } else {
    const failureMsg = [commitRes.stderr, commitRes.stdout].filter(Boolean).join('\n').trim();
    error(fmt.status('FAIL', `Failed to commit mission artifacts: ${failureMsg}`));
    // The index was just staged from a vetted safe-file list, so a non-zero
    // `git commit` here is the commit hook rejecting the tree. Hook identity
    // follows the failing git operation (commit -> pre-commit); no classifier
    // regex reads the output (TASK-2377.02).
    return { ok: false, dirty: true, hookFailure: true, hook: 'pre-commit', output: failureMsg };
  }
}

/**
 * Rebase the mission branch onto the latest primary/main branch before launching a reviewer.
 *
 * Runs the rebase workflow **in-process** through `RebaseWorkflowPort` — there is
 * no nested `px rebase` subprocess and therefore no combined-output text for a
 * classifier regex to read (TASK-2377.02). Failure class follows the failing git
 * operation: a push-time failure is the verification gate, a commit/rebase hook
 * rejection is a hook failure, and the hook-retry budget is left entirely to the
 * caller so exactly one process spends it.
 *
 * @param {string} slug
 * @returns {Promise<PreReviewRebaseResult>}
 */
export async function rebaseBeforeReviewRound(slug: string, {
  gitFn = git,
  taskFile = null,
  worktree = resolveWorktree(slug) || process.cwd(),
  log = fmt.log.plain,
  error = fmt.log.plainError,
  isReviewProviderEnabledFn = undefined,
  legacyIsForgejoReviewEnabledFn = null,
  isForgejoReviewEnabledFn = null,
  rebaseWorkflowOptions = {},
  runRebaseWorkflowFn = null,
  createRebaseWorkflowPortFn = null,
}: {
  /** @deprecated Accepted and ignored: the pre-review rebase no longer spawns a CLI. */
  runFn?: unknown;
  gitFn?: typeof git;
  taskFile?: string | null;
  worktree?: string;
  log?: (_msg: string) => void;
  error?: (_msg: string) => void;
  isReviewProviderEnabledFn?: ((_wt: string) => boolean) | undefined | null;
  legacyIsForgejoReviewEnabledFn?: ((_wt: string) => boolean) | null;
  isForgejoReviewEnabledFn?: ((_wt: string) => boolean) | null;
  rebaseWorkflowOptions?: RebaseCommandOptions;
  runRebaseWorkflowFn?: RunRebaseWorkflowFn | null;
  createRebaseWorkflowPortFn?: CreateRebaseWorkflowPortFn | null;
} = {}): Promise<PreReviewRebaseResult> {
  const cleanup = await commitSafeMissionArtifacts(slug, worktree, { taskFile, gitFn, log, error });
  if (!cleanup.ok) {
    error(fmt.status('WARN', 'Worktree is dirty with unsafe or conflicted files. Rebase may fail.'));
    if (cleanup.hookFailure) {
      const hook: PreReviewRebaseHookEvidence = { hook: cleanup.hook || 'pre-commit', output: cleanup.output || '' };
      return {
        ok: false, sharedFileConflicts: false, hookFailure: true, hookOutput: hook.output,
        failure: { kind: 'hook', operation: 'commit', hook, bounceRequests: 0 },
      };
    }
    return {
      ok: false, sharedFileConflicts: false, hookFailure: false,
      failure: { kind: 'unsafe-worktree', operation: 'commit', unsafeFiles: cleanup.unsafeFiles || [] },
    };
  }

  const forgejoEnabledFn = isReviewProviderEnabledFn
    || legacyIsForgejoReviewEnabledFn
    || isForgejoReviewEnabledFn
    || isProviderEnabled;
  const forgejoEnabled = forgejoEnabledFn(worktree);
  if (!forgejoEnabled) {
    log(fmt.status('INFO', `Review provider disabled; committed worktree state and skipping pre-review rebase for ${fmt.branch(`mission/${slug}`)}.`));
    return { ok: true, sharedFileConflicts: false, hookFailure: false };
  }

  const runWorkflow: RunRebaseWorkflowFn = runRebaseWorkflowFn
    // Loaded lazily: the rebase adapter reaches back into review-loop.js, and a
    // static import here would restore the import cycle this module exists to break.
    || (await import('../../application/rebase-workflow.js')).runRebaseWorkflow;
  const createPort: CreateRebaseWorkflowPortFn = createRebaseWorkflowPortFn
    || (await import('../rebase/rebase-workflow-adapter.js')).createRebaseWorkflowPort;

  // Every observation below is a structural seam on the port, not a text match.
  let exitCode: number | null = null;
  let hookEvidence: PreReviewRebaseHookEvidence | null = null;
  let hookBounceRequests = 0;
  let pushFailureOutput: string | null = null;
  let pushAttempted = false;
  let conflictClassification: MissionConflictClassification | null = null;
  let conflictAgentLaunched = false;

  const port = createPort({ ...rebaseWorkflowOptions, gitFn });

  // The seams below are installed on the port itself rather than passed to the
  // factory, so they hold for any port implementation the caller supplies.
  port.cwd = () => worktree;
  port.isForgejoReviewEnabled = (root: string) => forgejoEnabledFn(root);
  // Exit-capturing seam: `runRebaseWorkflow` signals every outcome through
  // `port.exit()` and returns immediately after, so capturing the code here
  // keeps the review-loop process alive without rewriting its control flow.
  port.exit = (code: number) => { if (exitCode === null) { exitCode = code; } };
  // Single hook-retry budget consumer: record the hook identity the workflow
  // classified from the failing git operation and refuse the in-child bounce.
  // The caller (review loop) owns the budget and the fix prompt.
  port.onHookFailure = (classification: { hookType: string | null }, hookOutput: string) => {
    hookBounceRequests += 1;
    hookEvidence = { hook: classification?.hookType || 'hook', output: hookOutput || '' };
    return false;
  };
  // Present so the workflow routes hook failures into the seam above rather
  // than the legacy hint-and-exit path; the recording seam ignores the store.
  port.missionServices = async () => ({ store: null });
  const innerCreatePr = port.createPr;
  port.createPr = (branch, user, token, options) => {
    pushAttempted = true;
    const pushResult = innerCreatePr(branch, user, token, options);
    if (!pushResult.ok) { pushFailureOutput = pushResult.error || 'push rejected'; }
    return pushResult;
  };
  const innerResolveConflicts = port.resolveConflictsForMission;
  port.resolveConflictsForMission = (conflictSlug, area, options) => {
    // The workflow mutates this object in place while reclassifying, so the
    // retained reference reports the final shared-file set.
    conflictClassification = innerResolveConflicts(conflictSlug, area, options);
    return conflictClassification;
  };
  const innerStartAgent = port.startAgent;
  port.startAgent = (step, options) => {
    if (step === 'conflict-resolution') { conflictAgentLaunched = true; }
    return innerStartAgent(step, options);
  };

  log(`Rebasing ${fmt.branch(`mission/${slug}`)} onto the latest primary branch before reviewer launch...`);

  await runWorkflow([slug, '--push'], port);

  // Re-annotated reads: these are written from port callbacks, which the
  // compiler's flow analysis does not track.
  const finalExitCode = exitCode as number | null;
  const finalHook = hookEvidence as PreReviewRebaseHookEvidence | null;
  const finalPushOutput = pushFailureOutput as string | null;
  const finalConflicts = conflictClassification as MissionConflictClassification | null;

  if (finalExitCode === null || finalExitCode === 0) {
    log(fmt.status('PASS', `Pre-review rebase completed for ${fmt.branch(`mission/${slug}`)}.`));
    return { ok: true, sharedFileConflicts: false, hookFailure: false };
  }

  const sharedFiles = finalConflicts?.sharedFiles || [];
  const sharedFileConflicts = sharedFiles.length > 0 || conflictAgentLaunched;

  if (finalHook) {
    const hook = finalHook;
    if (hook.output) { error(hook.output); }
    error(fmt.status('FAIL', `Git hook failure (${hook.hook}) detected during pre-review rebase.`));
    return {
      ok: false, sharedFileConflicts, hookFailure: true, hookOutput: hook.output,
      failure: { kind: 'hook', operation: 'rebase', hook, bounceRequests: hookBounceRequests },
    };
  }

  if (finalPushOutput !== null) {
    // The push-time check is the verification gate the pre-push hook runs. The
    // failure class follows that inner check, never the enclosing hook name —
    // gate output mentioning `pre-push` stays a gate failure (ADR 0048).
    const gate = buildPushGateEvidence(port, slug, worktree, finalExitCode, finalPushOutput);
    error(gate.stderr);
    error(fmt.status('FAIL', `Pre-review push gate failed for area "${gate.area}" (exit ${gate.exitCode}).`));
    return {
      ok: false, sharedFileConflicts, hookFailure: false,
      failure: { kind: 'gate', operation: 'push', gate },
    };
  }

  if (sharedFileConflicts) {
    error(fmt.status('FAIL', 'Shared-file rebase conflicts detected. Autonomous review loop cannot continue safely.'));
    log(fmt.status('INFO', `Resolve the conflicts in the worktree, then re-run: px review ${slug} --start`));
    return {
      ok: false, sharedFileConflicts: true, hookFailure: false,
      failure: { kind: 'conflict', operation: 'rebase', sharedFiles },
    };
  }

  error(fmt.status('FAIL', `Rebase failed before launching reviewer for ${fmt.branch(`mission/${slug}`)}.`));
  return {
    ok: false, sharedFileConflicts: false, hookFailure: false,
    failure: { kind: 'other', operation: pushAttempted ? 'push' : 'rebase', output: `rebase workflow exited with status ${finalExitCode}` },
  };
}

/**
 * Gate evidence for a push-time failure. Area and command are resolved through
 * the same port methods the rebase workflow itself uses, so the reported command
 * is the mission's real verification command.
 */
function buildPushGateEvidence(
  port: RebaseWorkflowPort,
  slug: string,
  worktree: string,
  exitCode: number,
  output: string,
): PreReviewRebaseGateEvidence {
  let area = 'docs';
  let command = `px rebase ${slug} --push`;
  try {
    const missionDir = port.findMissionDir(slug, worktree);
    if (missionDir) { area = port.findMissionArea(missionDir) || area; }
    command = port.formatVerificationCommand(area, worktree) || command;
  } catch (_) {
    // Fall back to the push command itself; evidence must never throw.
  }
  return {
    area,
    command,
    exitCode: exitCode || 1,
    stdout: output,
    stderr: output,
    error: `Pre-review push-time verification gate failed for area "${area}"`,
  };
}
