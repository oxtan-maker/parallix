import fs from 'node:fs';
import { git } from '../../git/git.js';
import * as fmt from '../../../application/presentation/cli-format.js';
import { resolveTaskFile, getTaskImplementer, transitionTask } from '../../backlog/backlog.js';
import { resolveForgejoUser, resolveForgejoHome, isForgejoPath } from '../../forgejo/forgejo.js';
import { getPrimaryWorktree, conventionalWorktreePath, missionBranchName } from '../../filesystem/mission-utils.js';
import stats from './stats.js';
// SC2: re-export post-integration stats helpers defined in stats.ts
// (MISSION.md scope lists them as integrate-post exports; stats.ts is their home)
export {
  recordStageStats,
  accumulateStageStats,
  defaultPrFixRounds,
  recordIntegrationStats,
  recordActiveStats,
  recordReviewStats,
  telemetryToStatsFields,
} from './stats.js';
import * as postIntegrateHook from '../../process/post-integrate-hook.js';
import { readReviewState, writeReviewState, persistReviewStateOrThrow } from '../../review/review-state.js';
import { startAgent, selectAgent, workflowLauncherStatus } from '../../agents/agents.js';
import { applyAgentFallback } from '../../review/review-loop.js';
import { missionId } from '../../../domain/mission.js';

/**
 * Signals that integrate() must unwind to its abort path.
 *
 * Single class on purpose: integrate() branches on `error instanceof
 * IntegrationAbort`, so every thrower — here, in integrate-conflict.ts, and in
 * integrate.ts — must share this one declaration.
 *
 * @extends{Error}
 */
export class IntegrationAbort extends Error {}

/**
 * Classify git hook failure from command output.
 * Detects pre-commit, pre-push, post-commit, and generic hook failures.
 * Returns structured result for SC2/SC8.
 *
 * @param {string} output - Combined stdout+stderr from git command
 * @returns {{ isHookFailure: boolean, hookType: string | null }}
 */
export function classifyHookFailure(output: string): { isHookFailure: boolean; hookType: string | null } {
  if (!output) {
    return { isHookFailure: false, hookType: null };
  }
  const lower = output.toLowerCase();
  if (/pre-commit/i.test(lower)) {
    return { isHookFailure: true, hookType: 'pre-commit' };
  }
  if (/pre-push/i.test(lower)) {
    return { isHookFailure: true, hookType: 'pre-push' };
  }
  if (/post-commit/i.test(lower)) {
    return { isHookFailure: true, hookType: 'post-commit' };
  }
  // Generic hook keyword match — require failure phrasing to avoid
  // false positives from paths like "post-integrate-hook.ts"
  if (/hook.*(failed|failure|error)/i.test(lower)) {
    return { isHookFailure: true, hookType: 'hook' };
  }
  return { isHookFailure: false, hookType: null };
}

// Max retries for hook failure auto-bounce
const MAX_HOOK_RETRY = 2;

/**
 * Handle git hook failure with auto-bounce to implementer.
 * Mirrors handleGateFailureAutoBounce pattern. Used by integrate squash commit path.
 * Returns true if auto-bounced (caller should retry), false if stranded.
 *
 * @param {string} slug
 * @param {string} worktree
 * @param {string} hookOutput
 * @param {{ hookType: string | null }} classification
 * @param {{ startAgentFn?: Function, readReviewStateFn?: Function, writeReviewStateFn?: Function, transitionTaskFn?: Function, applyAgentFallbackFn?: Function, selectAgentFn?: Function, workflowLauncherStatusFn?: Function, missionStore?: any }} opts
 * @returns {Promise<boolean>} true if should retry, false if stranded
 */
export async function handleHookFailureAutoBounce(
  slug: string,
  worktree: string,
  hookOutput: string,
  classification: { hookType: string | null },
  {
    startAgentFn = startAgent,
    readReviewStateFn = readReviewState,
    writeReviewStateFn = writeReviewState,
    transitionTaskFn = transitionTask,
    applyAgentFallbackFn = applyAgentFallback,
    selectAgentFn = selectAgent,
    workflowLauncherStatusFn = workflowLauncherStatus,
    missionStore = null,
  }: {
    startAgentFn?: Function;
    readReviewStateFn?: Function;
    writeReviewStateFn?: Function;
    transitionTaskFn?: Function;
    applyAgentFallbackFn?: Function;
    selectAgentFn?: Function;
    workflowLauncherStatusFn?: Function;
    missionStore?: any;
  } = {}
): Promise<boolean> {
  const persisted = await Promise.resolve(readReviewStateFn(slug, worktree, missionStore));
  const retryCount = persisted && persisted.metadata && typeof persisted.metadata === 'object'
    ? (Number((persisted.metadata as any).hookFailureRetryCount) || 0)
    : 0;

  if (retryCount >= MAX_HOOK_RETRY) {
    fmt.log.fail(`Hook failure: max retries exceeded (${MAX_HOOK_RETRY}). Mission stranded for ${slug}.`);
    fmt.log.fail(`Hook ${classification.hookType || 'failure'} failed ${retryCount} times. Human intervention required.`);
    fmt.log.fail(`Hook output:\n${hookOutput}`);
    return false;
  }

  const newRetryCount = retryCount + 1;

  const fixPrompt = [
    `GIT HOOK FAILURE — FIX REQUIRED`,
    ``,
    `Mission: ${slug}`,
    `Hook type: ${classification.hookType || 'unknown'}`,
    ``,
    `Hook output (use this to diagnose and fix):`,
    `---`,
    hookOutput,
    `---`,
    ``,
    `Retry attempt: ${newRetryCount}/${MAX_HOOK_RETRY}`,
    ``,
    `Fix the underlying issue so the git hook passes.`,
    `After fixing, the integration will be retried automatically.`,
  ].join('\n');

  const metadata = persisted && persisted.metadata && typeof persisted.metadata === 'object'
    ? { ...persisted.metadata }
    : {};
  metadata.hookFailureRetryCount = newRetryCount;

  try {
    if (persisted) {
      const updatedState = { ...persisted, metadata };
      await persistReviewStateOrThrow(writeReviewStateFn as any, slug, updatedState as any, worktree, missionStore);
    } else {
      await persistReviewStateOrThrow(writeReviewStateFn as any, slug, { metadata } as any, worktree, missionStore);
    }
  } catch (err: any) {
    fmt.log.fail(`Could not persist hook retry state: ${err.message || String(err)}. Falling back to manual recovery.`);
    return false;
  }

  // Resolve implementer
  const taskResolution = resolveTaskFile(slug, worktree);
  let implementer = taskResolution.ok && (taskResolution as any).task ? getTaskImplementer((taskResolution as any).task) : null;

  if (!implementer) {
    const status = workflowLauncherStatusFn?.() ?? { available: false, agent: null };
    if (status.available && status.agent) {
      implementer = selectAgentFn?.({ role: 'implementer' }) || status.agent;
    }
  }

  if (!implementer) {
    fmt.log.fail(`Could not determine implementer for ${slug}. Cannot auto-bounce.`);
    return false;
  }

  // Transition task back to active (implementer phase) without consuming reviewer cycle
  await transitionTaskFn(slug, 'active', { rootDir: worktree, log: fmt.log.plain });
  fmt.log.info(`Auto-bouncing to implementer (${implementer}) with hook fix prompt. Retry ${newRetryCount}/${MAX_HOOK_RETRY}.`);

  try {
    const launchResult = await startAgentFn('act-on-review', {
      agent: implementer,
      prompt: fixPrompt,
      worktree,
      slug,
      role: 'implementer',
      exclude: [],
    });

    // Apply any agent fallback if needed
    await applyAgentFallbackFn({
      role: 'implementer',
      original: implementer,
      launchResult,
      state: persisted || {},
      slug,
      worktree,
      taskResolution: { ok: taskResolution.ok, taskFile: taskResolution.taskFile },
      log: fmt.log.plain,
      writeReviewStateFn,
      missionStore,
    });

    if (launchResult.result && launchResult.result.status !== 0) {
      fmt.log.fail(`Implementer (${launchResult.agent}) exited with status ${launchResult.result.status}. Mission stranded.`);
      return false;
    }
  } catch (err: any) {
    fmt.log.fail(`Could not launch implementer for hook fix: ${err.message || String(err)}.`);
    return false;
  }

  return true;
}

/** @type{{symptom: string, cause: string, fix: string}[]} */
export const SYNC_MERGED_DIAGNOSTICS = [
  { symptom: 'sync-merged reports generic failure; PR still open', cause: 'allow_manual_merge disabled or drifted off in Forgejo settings', fix: 'Enable "Allow manual merge" in Forgejo PR settings and retry.' },
  { symptom: 'POST /pulls/N/merge returns 405 or 500', cause: 'Forgejo API conflict or stale PR state', fix: 'px review <slug> to check if actually merged.' },
  { symptom: 'git push rejects mission branch with "stale info" or "fetch first"', cause: 'Local review/<branch> tracking is stale while sync-merged updates the PR branch to the landed squash commit', fix: 'Automated: sync-merged fetches review/<branch>, retries --force-with-lease, then force-pushes only if stale-info persists.' },
  { symptom: 'curl: (7) Failed to connect to localhost port 3300', cause: 'Forgejo service not reachable from current runtime (sandbox/network)', fix: 'Ensure Forgejo is running (scripts/start-runner.sh) or use FORGEJO_URL override if external.' },
  { symptom: 'PR marked merged but remote branch still exists', cause: 'Remote branch deletion failed (permissions or network)', fix: 'px review <slug> --close (to trigger cleanup; identity resolves from review-state).' }
];

export function printDiagnosticTable() {
  fmt.log.info('\n--- Node sync-merged Diagnostic Table ---');
  fmt.log.info('| Symptom | Root Cause | Fix Command |');
  fmt.log.info('| :--- | :--- | :--- |');
  SYNC_MERGED_DIAGNOSTICS.forEach(d => {
    fmt.log.info(`| ${d.symptom} | ${d.cause} | ${d.fix} |`);
  });
  fmt.log.info('------------------------------------\n');
}

/** @param {{statusCode?: number, error: string, raw?: string}} syncResult */
export function reportSyncMergedFailure(syncResult: any) {
  const detail = syncResult.statusCode ? ` (${syncResult.error}: ${syncResult.statusCode})` : ` (${syncResult.error})`;
  fmt.log.fail(`Forgejo sync-merged failed${detail}.`);
  if (syncResult.raw) {
    fmt.log.info('sync-merged raw output:');
    fmt.log.plainError(syncResult.raw);
  }
  printDiagnosticTable();
}

/** @param {{mission: string, implementer: string, pr_fix_rounds: string, classification: string, date: string}} row */
export function formatRecordedStatsRow(row: any) {
  return `${row.mission}: implementer=${row.implementer}, pr_fix_rounds=${row.pr_fix_rounds}, classification=${row.classification}, date=${row.date}`;
}

/** @param {string} value */
export function shellQuote(value: string) {
  return `"${String(value).replace(/(["\\$`])/g, '\\$1')}"`;
}

/** @param {string|null} taskAssignee */
export function resolveForgejoUserForIntegration(taskAssignee: string | null) {
  // If taskAssignee is set, use it directly as the Forgejo user identity.
  // This ensures that even non-agent assignees (e.g., human users) have their
  // identity properly propagated through all Forgejo operations.
  if (taskAssignee) {
    return {
      forgejoUser: taskAssignee,
      warning: null
    };
  }

  // Fall back to environment variable or default only when no assignee is available
  return {
    forgejoUser: resolveForgejoUser(""),
    warning: null
  };
}

/** @param{{stdout: string, stderr: string, status: number}} result */
export function isNoMergeToAbortResult(result: any) {
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
  return /MERGE_HEAD missing|There is no merge to abort/i.test(output);
}

/**
 * @param {string} slug
 * @param{{rootDir?: string, recordIntegrationStatsFn?: Function, missionStore?: import('../../../application/domain-ports.js').MissionStore|null}} options
 */
export async function recordPostIntegrationStats(
  slug: string,
  {
    rootDir = getPrimaryWorktree(),
    recordIntegrationStatsFn = (stats as any).recordIntegrationStats,
    missionStore = null,
  }: {
    rootDir?: string;
    recordIntegrationStatsFn?: Function;
    missionStore?: import('../../../application/domain-ports.js').MissionStore | null;
  } = {}
) {
  // Do NOT derive the closed row's date from `git log -1 --format=%cs`: the tip
  // commit that lands during integration can carry an older committer date than
  // the actual closeout day, silently pushing the completed row out of weekly
  // report windows even though the mission just closed (architecture migration). Every other
  // stats writer already defaults its `date` to "today"; omitting `date` here
  // lets recordIntegrationStats use that same default instead of a stale commit
  // timestamp.
  // architecture migration: the completed-mission row is persisted through the
  // measurement store (<PARALLIX_HOME>/parallix.db). Integration no longer
  // resolves a stats CSV path.
  const outcome = await recordIntegrationStatsFn({
    slug,
    rootDir,
    missionStore,
  });

  fmt.log.info(`Workflow stats recorded: ${formatRecordedStatsRow(outcome.row)}`);
  fmt.log.info('Workflow stats updated:');
  fmt.log.plain(outcome.report);

  const missionRows = outcome.data?.rows || [];
  const missionReport = (stats as any).renderMissionPhaseReport(missionRows, slug);
  const firstLine = missionReport.split('\n')[0];
  fmt.log.info(firstLine);
  fmt.log.plain(missionReport.split('\n').slice(1).join('\n'));

  return outcome;
}

/** @param {string} slug @param{{rootDir?: string, missionStore?: import('../../../application/domain-ports.js').MissionStore|null}} options */
export async function recordPostIntegrationStatsOrAbort(slug: string, options: {rootDir?: string, missionStore?: import('../../../application/domain-ports.js').MissionStore|null} = {}) {
  try {
    return await recordPostIntegrationStats(slug, options);
  } catch (error: any) {
    const detail = error && error.message ? error.message : String(error);
    fmt.log.fail(`Post-integration workflow stats failed for ${slug}: ${detail}`);
    throw new IntegrationAbort();
  }
}

/**
 * The committer timestamp of the specific landed commit.
 *
 * Read with `show -s` against the supplied revision, never `log -1`/HEAD: the
 * resume path reconciles a squash commit that landed in an earlier run and can
 * sit well behind the current HEAD, and rolling-window statistics select
 * missions by this time. Returns null when the revision cannot be read, so the
 * caller can fall back loudly rather than silently backdating or aborting a
 * mission whose work has already landed.
 *
 * @param {string} landedCommit @param {string} rootDir
 */
function resolveLandedCommitTimestamp(landedCommit: string, rootDir: string) {
  const result = git(['-C', rootDir, 'show', '-s', '--format=%cI', landedCommit]);
  const timestamp = result.status === 0 ? String(result.stdout || '').trim() : '';
  if (!timestamp) {
    fmt.log.warn(`Could not read the landed commit timestamp for ${landedCommit}; recording completion at the current time.`);
    return null;
  }
  return timestamp;
}

/**
 * Persist the sole completion authority once the squash commit exists.
 *
 * One timestamp resolution serves every caller — normal integration, resume,
 * and partial-closeout recovery — so no path can record a retry time as the
 * delivery completion time.
 *
 * @param {string} slug @param {string} landedCommit @param {any} missionServices
 * @param{{rootDir?: string; landedAt?: string}} options
 */
export async function persistLandedIntegrationOrAbort(slug: string, landedCommit: string, missionServices: any, { rootDir = process.cwd(), landedAt: landedAtOpt }: { rootDir?: string; landedAt?: string } = {}) {
  let loaded = await missionServices.store.load(missionId(slug));
  if (loaded.kind !== 'found') {
    fmt.log.fail(`Mission ${missionId(slug)} is unavailable after landing; statistics will not run.`);
    throw new IntegrationAbort();
  }
  const landedAt = landedAtOpt ?? resolveLandedCommitTimestamp(landedCommit, rootDir);
  if (landedAt === null) {
    fmt.log.fail(`Cannot resolve landed commit timestamp for ${landedCommit}; aborting closeout to avoid recording a retry time as delivery completion.`);
    throw new IntegrationAbort();
  }
  if (loaded.mission.status !== 'done') {
    const result = await missionServices.integration.decideIntegration({
      operationId: `integrate-closeout:${slug}:${landedCommit}`,
      missionId: missionId(slug),
      expectedVersion: loaded.version,
      capabilities: new Set(['integration:decide']),
      idempotencyKey: `integrate:${slug}:${landedCommit}`,
      actor: loaded.mission.assignee ?? 'custom',
      // Delivery completion time. Distinct from the administrative `closedAt`
      // below, which records when the operator ran closeout: a mission resumed
      // two days later delivered on the landing day but was closed out on the
      // retry day, and only the delivery time may drive decision windows.
      occurredAt: landedAt,
      facts: {
        git: { source: 'git', status: 'fresh', value: { merged: true } },
        verification: { source: 'integration-gates', status: 'fresh', value: { passed: true } },
      },
    });
    if (result.status !== 'completed') {
      fmt.log.fail(`Mission completion failed after landing: ${result.error?.message || 'unknown'}.`);
      throw new IntegrationAbort();
    }
    loaded = await missionServices.store.load(missionId(slug));
    if (loaded.kind !== 'found') {
      fmt.log.fail(`Mission ${missionId(slug)} is unavailable for closure after landing.`);
      throw new IntegrationAbort();
    }
  }
  if (loaded.mission.closedAt !== null) { return; }
  const result = await missionServices.integration.close({
    operationId: `integrate-close:${slug}:${landedCommit}`,
    missionId: missionId(slug),
    expectedVersion: loaded.version,
    capabilities: new Set(['closure:record']),
    idempotencyKey: `close:${slug}:${landedCommit}`,
    actor: loaded.mission.assignee ?? 'custom',
    // Administrative closure time, deliberately the closeout/retry time rather
    // than the landed commit time: it records when the operator ended the last
    // lane dwell, not when the change was delivered.
    closedAt: new Date().toISOString(),
    integration: { source: 'git', status: 'fresh', value: { completed: true } },
  });
  if (result.status !== 'completed') {
    fmt.log.fail(`Mission closure failed after landing: ${result.error?.message || 'unknown'}.`);
    throw new IntegrationAbort();
  }
}

/**
 * Runs the repo-configured post-integrate hook (adapters.integrate.postIntegrateCommand)
 * exactly once from the base checkout, after a successful non-dry-run integrate closeout.
 * A repo with no hook configured is a silent no-op, so integrate's behavior is unchanged.
 * @param {string} slug
 * @param{{baseWorktree: string, baseBranch: string, variant: string, runPostIntegrateHookFn?: Function}} opts
 */
export function runPostIntegrateHookOrAbort(slug: string, {
  baseWorktree,
  baseBranch,
  variant,
  runPostIntegrateHookFn = postIntegrateHook.runPostIntegrateHook
}: {baseWorktree: string, baseBranch: string, variant: string, runPostIntegrateHookFn?: Function}) {
  const result = runPostIntegrateHookFn({ slug, baseWorktree, baseBranch, variant });
  if (!result.ran) {
    return result;
  }

  if (!result.ok) {
    fmt.log.fail(`Post-integrate hook failed (exit code ${result.exitCode}): ${result.command}`);
    if (result.output) {
      fmt.log.fail(result.output);
    }
    throw new IntegrationAbort();
  }

  fmt.log.pass(`Post-integrate hook completed: ${result.command}`);
  if (result.output) {
    fmt.log.plain(result.output);
  }
  return result;
}

/**
 * @param {string} slug
 * @param{{rootDir?: string, gitRunner?: Function, removeDir?: Function, existsSync?: Function}} options
 */
export function cleanupMissionWorktree(
  slug: string,
  {
    rootDir = getPrimaryWorktree(),
    gitRunner = git,
    removeDir = (target: string) => {
      if (isForgejoPath(target, { forgejoHome: resolveForgejoHome() })) {
        throw new Error(`CRITICAL SAFETY VIOLATION: cleanupMissionWorktree attempted to delete Forgejo home: ${target}`);
      }
      return fs.rmSync(target, { recursive: true, force: true });
    },
    existsSync = fs.existsSync
  }: {rootDir?: string, gitRunner?: Function, removeDir?: Function, existsSync?: Function} = {}
) {
  const branch = missionBranchName(slug, rootDir);
  const worktreePath = `${conventionalWorktreePath(slug, rootDir)}`;
  const currentBranch = gitRunner(['-C', rootDir, 'branch', '--show-current']).stdout.trim();
  if (currentBranch === branch) {
    return false;
  }

  const branchExists = gitRunner(['-C', rootDir, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
  if (branchExists.status !== 0) {
    return false;
  }

  const worktreeList = gitRunner(['-C', rootDir, 'worktree', 'list', '--porcelain']).stdout;
  const isRegistered = worktreeList.split('\n').some((line: string) => line.trim() === `worktree ${worktreePath}`);

  if (existsSync(worktreePath) && isRegistered) {
    let removeResult = gitRunner(['-C', rootDir, 'worktree', 'remove', worktreePath]);
    if (removeResult.status !== 0) {
      removeResult = gitRunner(['-C', rootDir, 'worktree', 'remove', '--force', worktreePath]);
      if (removeResult.status !== 0) {
        return false;
      }
    }
  }

  if (existsSync(worktreePath)) {
    removeDir(worktreePath);
  }

  // Prune stale prunable worktrees — e.g. leftover registrations at near-match
  // paths like ${getPrimaryWorktree()}-<n> for the same mission branch —
  // before attempting branch deletion. Otherwise `git branch -D` refuses because
  // git still thinks the branch is checked out somewhere.
  gitRunner(['-C', rootDir, 'worktree', 'prune']);

  const deleteBranchResult = gitRunner(['-C', rootDir, 'branch', '-D', branch]);
  if (deleteBranchResult.status !== 0) {
    return false;
  }

  return !existsSync(worktreePath);
}
