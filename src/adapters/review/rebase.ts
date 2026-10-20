import { commitDirtyFiles } from '../git/commit-dirty-files.js';
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
  const resolvedTaskFile = taskFile ? path.relative(rootDir, taskFile) : null;
  const blockers: string[] = [];
  const result = commitDirtyFiles(rootDir, slug, gitFn, log, message => blockers.push(message), {
    accepts: file => isWorkflowGeneratedArtifactFn(file)
      || isMissionArtifactFn(file, slug, rootDir)
      || !!(resolvedTaskFile && file === resolvedTaskFile),
    message: `workflow(${slug}): auto-commit mission artifacts before pre-review rebase`,
  });
  // An unreadable status leaves nothing to commit; the rebase reports the Git error itself.
  if (result.blocker && result.operation !== 'status') { blockers.forEach(message => error(message)); }
  return cleanupOutcome(result, error);
}

function cleanupOutcome(result: ReturnType<typeof commitDirtyFiles>, error: (_msg: string) => void): Awaited<ReturnType<typeof commitSafeMissionArtifacts>> {
  if (result.conflicts) {
    error(fmt.status('FAIL', `Cannot auto-commit: unmerged/conflicting files detected:\n${result.conflicts.map(file => `       - ${file}`).join('\n')}`));
    return { ok: false, dirty: true, unsafe: true, unsafeFiles: result.conflicts };
  }
  if (result.operation === 'status') { return { ok: true, dirty: false }; }
  if (result.blocker && result.operation === 'commit') {
    error(fmt.status('FAIL', `Failed to commit mission artifacts: ${result.output}`));
    return { ok: false, dirty: true, hookFailure: true, hook: 'pre-commit', output: result.output };
  }
  if (result.blocker) { return { ok: false, dirty: result.dirty ?? false }; }
  return { ok: true, dirty: result.repaired || !!result.dirty };
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
type PreReviewRebaseOptions = {
  /** @deprecated Accepted and ignored: the pre-review rebase no longer spawns a CLI. */
  runFn?: unknown;
  gitFn?: typeof git;
  taskFile?: string | null;
  worktree?: string;
  log?: (_msg: string) => void;
  error?: (_msg: string) => void;
  verbose?: boolean;
  isReviewProviderEnabledFn?: ((_wt: string) => boolean) | undefined | null;
  legacyIsForgejoReviewEnabledFn?: ((_wt: string) => boolean) | null;
  isForgejoReviewEnabledFn?: ((_wt: string) => boolean) | null;
  rebaseWorkflowOptions?: RebaseCommandOptions;
  missionIdentityServices?: NonNullable<RebaseWorkflowPort['missionServices']>;
  runRebaseWorkflowFn?: RunRebaseWorkflowFn | null;
  createRebaseWorkflowPortFn?: CreateRebaseWorkflowPortFn | null;
};

export async function rebaseBeforeReviewRound(slug: string, options: PreReviewRebaseOptions = {}): Promise<PreReviewRebaseResult> {
  const { gitFn, taskFile, worktree, log, error, verbose, isReviewProviderEnabledFn, legacyIsForgejoReviewEnabledFn, isForgejoReviewEnabledFn, rebaseWorkflowOptions, runRebaseWorkflowFn, createRebaseWorkflowPortFn } = preReviewRebaseBindings(slug, options);
  const cleanup = await commitSafeMissionArtifacts(slug, worktree, { taskFile, gitFn, log, error });
  const cleanupFailure = preReviewCleanupFailure(cleanup, error);
  if (cleanupFailure) { return cleanupFailure; }

  const forgejoEnabledFn = isReviewProviderEnabledFn
    || legacyIsForgejoReviewEnabledFn
    || isForgejoReviewEnabledFn
    || isProviderEnabled;
  const forgejoEnabled = forgejoEnabledFn(worktree);
  if (!forgejoEnabled) {
    // Provider plumbing: shown unless the caller explicitly opts out with
    // `verbose = false`. The review loop passes `verbose` at its call sites so
    // the default review start stays quiet; handoff/standalone callers keep the
    // pre-mission visibility.
    if (verbose) {
      log(fmt.status('INFO', `Review provider disabled; committed worktree state and skipping pre-review rebase for ${fmt.branch(`mission/${slug}`)}.`));
    }
    return { ok: true, sharedFileConflicts: false, hookFailure: false };
  }

  const runWorkflow: RunRebaseWorkflowFn = runRebaseWorkflowFn
    // Loaded lazily: the rebase adapter reaches back into review-loop.js, and a
    // static import here would restore the import cycle this module exists to break.
    || (await import('../../application/rebase-workflow.js')).runRebaseWorkflow;
  const createPort: CreateRebaseWorkflowPortFn = createRebaseWorkflowPortFn
    || (await import('../rebase/rebase-workflow-adapter.js')).createRebaseWorkflowPort;

  // Every observation below is a structural seam on the port, not a text match.
  const observed: PreReviewRebaseObservations = {
    exitCode: null, hookEvidence: null, hookBounceRequests: 0, pushFailureOutput: null,
    publicationAttempted: false, pushGate: null, credentialFailure: null, conflictClassification: null,
  };

  const port = createPort({ ...rebaseWorkflowOptions, missionIdentityServices: options.missionIdentityServices, gitFn });
  if (options.missionIdentityServices) { port.missionServices = options.missionIdentityServices; }

  observePreReviewRebase(port, observed, worktree, forgejoEnabledFn);

  log(`Rebasing ${fmt.branch(`mission/${slug}`)} onto the latest primary branch before reviewer launch...`);

  await runWorkflow([slug, '--push'], port);

  return preReviewRebaseOutcome(slug, observed, log, error);
}

function preReviewRebaseOutcome(slug: string, observed: PreReviewRebaseObservations, log: (_msg: string) => void, error: (_msg: string) => void): PreReviewRebaseResult {
  const { exitCode: finalExitCode, hookEvidence: finalHook, pushFailureOutput: finalPushOutput, conflictClassification: finalConflicts, publicationAttempted, hookBounceRequests, pushGate, credentialFailure } = observed;

  if (finalExitCode === null || finalExitCode === 0) {
    log(fmt.status('PASS', `Pre-review rebase completed for ${fmt.branch(`mission/${slug}`)}.`));
    return { ok: true, sharedFileConflicts: false, hookFailure: false };
  }

  const sharedFiles = publicationAttempted ? [] : finalConflicts?.sharedFiles || [];
  const sharedFileConflicts = sharedFiles.length > 0;

  if (finalHook) {
    const hook = finalHook;
    if (hook.output) { error(hook.output); }
    error(fmt.status('FAIL', `Git hook failure (${hook.hook}) detected during pre-review rebase.`));
    return {
      ok: false, sharedFileConflicts, hookFailure: true, hookOutput: hook.output,
      failure: { kind: 'hook', operation: 'rebase', hook, bounceRequests: hookBounceRequests },
    };
  }

  if (pushGate !== null) {
    // The push-time check is the verification gate the pre-push hook runs. The
    // failure class follows that inner check, never the enclosing hook name —
    // gate output mentioning `pre-push` stays a gate failure (ADR 0048).
    const gate = pushGate;
    error(gate.stderr);
    error(fmt.status('FAIL', `Pre-review push gate failed for area "${gate.area}" (exit ${gate.exitCode}).`));
    return {
      ok: false, sharedFileConflicts, hookFailure: false,
      failure: { kind: 'gate', operation: 'push', gate },
    };
  }

  if (publicationAttempted) {
    const output = finalPushOutput ?? credentialFailure ?? `publication exited with status ${finalExitCode}`;
    error(fmt.status('FAIL', `Pre-review publication failed: ${output}`));
    return {
      ok: false, sharedFileConflicts: false, hookFailure: false,
      failure: { kind: 'other', operation: 'push', output }
    };
  }

  if (sharedFileConflicts) {
    error(fmt.status('FAIL', 'Shared-file rebase conflicts detected. Autonomous review loop cannot continue safely.'));
    // F8: emit the repair instruction at WARN, not INFO, so it reaches the
    // operator through `px active`'s operator-critical filter without relying
    // on the sentence containing a keyword like "conflict" (SC5).
    log(fmt.status('WARN', `Resolve the conflicts in the worktree, then re-run: px review ${slug} --start`));
    return {
      ok: false, sharedFileConflicts: true, hookFailure: false,
      failure: { kind: 'conflict', operation: 'rebase', sharedFiles },
    };
  }

  error(fmt.status('FAIL', `Rebase failed before launching reviewer for ${fmt.branch(`mission/${slug}`)}.`));
  return {
    ok: false, sharedFileConflicts: false, hookFailure: false,
    failure: { kind: 'other', operation: 'rebase', output: `rebase workflow exited with status ${finalExitCode}` },
  };
}

interface PreReviewRebaseObservations {
  exitCode: number | null; hookEvidence: PreReviewRebaseHookEvidence | null; hookBounceRequests: number;
  pushFailureOutput: string | null; publicationAttempted: boolean; pushGate: PreReviewRebaseGateEvidence | null;
  credentialFailure: string | null; conflictClassification: MissionConflictClassification | null;
}
function observePreReviewRebase(port: RebaseWorkflowPort, observed: PreReviewRebaseObservations, worktree: string, forgejoEnabledFn: (_wt: string) => boolean): void {
  // The seams below are installed on the port itself rather than passed to the
  // factory, so they hold for any port implementation the caller supplies.
  port.cwd = () => worktree;
  port.isForgejoReviewEnabled = (root: string) => forgejoEnabledFn(root);
  // Exit-capturing seam: `runRebaseWorkflow` signals every outcome through
  // `port.exit()` and returns immediately after, so capturing the code here
  // keeps the review-loop process alive without rewriting its control flow.
  port.exit = (code: number) => { if (observed.exitCode === null) { observed.exitCode = code; } };
  // Single hook-retry budget consumer: record the hook identity the workflow
  // classified from the failing git operation and refuse the in-child bounce.
  // The caller (review loop) owns the budget and the fix prompt.
  port.onHookFailure = (classification: { hookType: string | null }, hookOutput: string) => {
    observed.hookBounceRequests += 1;
    observed.hookEvidence = { hook: classification?.hookType || 'hook', output: hookOutput || '' };
    return false;
  };
  const innerReadToken = port.readToken;
  port.readToken = (user) => {
    observed.publicationAttempted = true;
    const token = innerReadToken(user);
    if (!token) { observed.credentialFailure = `No Forgejo token found for user "${user}". Push failed.`; }
    return token;
  };
  const innerPublicationCredentials = port.publicationCredentials;
  if (innerPublicationCredentials) {
    port.publicationCredentials = (user, root) => {
      observed.publicationAttempted = true;
      const credentials = innerPublicationCredentials(user, root);
      if (!credentials.token) {
        observed.credentialFailure = `No Forgejo token found for user "${credentials.user}". Push failed.`;
      }
      return credentials;
    };
  }
  const innerCreatePr = port.createPr;
  port.createPr = (branch, user, token, options) => {
    observed.publicationAttempted = true;
    const pushResult = innerCreatePr(branch, user, token, options);
    if (!pushResult.ok) {
      observed.pushFailureOutput = pushResult.error || 'push rejected';
      const gate = pushResult.gateFailure;
      observed.pushGate = gate ?? null;
    }
    return pushResult;
  };
  const innerResolveConflicts = port.resolveConflictsForMission;
  port.resolveConflictsForMission = (conflictSlug, area, options) => {
    // The workflow mutates this object in place while reclassifying, so the
    // retained reference reports the final shared-file set.
    observed.conflictClassification = innerResolveConflicts(conflictSlug, area, options);
    return observed.conflictClassification;
  };

}

function preReviewRebaseBindings(slug: string, options: PreReviewRebaseOptions) {
  const {
    gitFn = git,
    taskFile = null,
    worktree = resolveWorktree(slug) || process.cwd(),
    log = fmt.log.plain,
    error = fmt.log.plainError,
    // TASK-2477/F3: defaults to `true` so the pre-review rebase skip line stays
    // visible for callers that do not thread a `verbose` flag (the handoff use
    // case and standalone rebase). The review loop always passes `verbose` at its
    // own call sites, so the provider=none happy path is still demoted there.
    verbose = true,
    isReviewProviderEnabledFn = undefined,
    legacyIsForgejoReviewEnabledFn = null,
    isForgejoReviewEnabledFn = null,
    rebaseWorkflowOptions = {},
    runRebaseWorkflowFn = null,
    createRebaseWorkflowPortFn = null,
  } = options;
  return { gitFn, taskFile, worktree, log, error, verbose, isReviewProviderEnabledFn, legacyIsForgejoReviewEnabledFn, isForgejoReviewEnabledFn, rebaseWorkflowOptions, runRebaseWorkflowFn, createRebaseWorkflowPortFn };
}
function preReviewCleanupFailure(cleanup: Awaited<ReturnType<typeof commitSafeMissionArtifacts>>, error: (_msg: string) => void): PreReviewRebaseResult | null {
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

  return null;
}
