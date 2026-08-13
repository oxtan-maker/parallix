import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { git, run } from '../../git/git.js';
import { resolveTaskFile, getTaskImplementer, transitionTask } from '../../backlog/backlog.js';
import { resolveForgejoUser, resolveForgejoHome, isForgejoPath } from '../../forgejo/forgejo.js';
import * as fmt from '../../../application/presentation/cli-format.js';

import { resolveWorktree, getConflictFiles, updateGraphifyKnowledgeGraph, getPrimaryWorktree, getPrimaryBranch, conventionalWorktreePath, isMissionArtifact, missionBranchName, resolveMissionBaseBranch } from '../../filesystem/mission-utils.js';
import stats from './stats.js';
import * as verification from '../../verification/verification.js';
const { formatVerificationCommand } = verification;
import * as postIntegrateHook from '../../process/post-integrate-hook.js';
import { readReviewState, writeReviewState, persistReviewStateOrThrow } from '../../review/review-state.js';
import { startAgent, selectAgent, workflowLauncherStatus } from '../../agents/agents.js';
import { applyAgentFallback } from '../../review/review-loop.js';
import { missionId } from '../../../domain/mission.js';
import { detectChangedAreas, isIntendedPayloadAtHead, parseFilesToAreas, orderIntegrationGates, gateMatchesChangedAreas, loadIntegrationConfig, getIntegrationGatePlan, printIntegrationGatePlan, buildIntegrationGateEnv, captureFinalIntegrationTree, resolveIntegrationVerificationWorktree, buildIntegrationVerificationInvocation, executeIntegrationGates } from './integrate-gates.js';
import { integrate, parseIntegrateArgs, buildIntegrationContext, evaluateTaskStatusForIntegration, promoteTaskForIntegrationIfNeeded, printIntegrationPreflight, VARIANT_B_AUTOMATION_SUMMARY } from './integrate-command.js';
export type { IntegrateFn } from './integrate-command.js';

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
const SYNC_MERGED_DIAGNOSTICS = [
  { symptom: 'sync-merged reports generic failure; PR still open', cause: 'allow_manual_merge disabled or drifted off in Forgejo settings', fix: 'Enable "Allow manual merge" in Forgejo PR settings and retry.' },
  { symptom: 'POST /pulls/N/merge returns 405 or 500', cause: 'Forgejo API conflict or stale PR state', fix: 'px review <slug> to check if actually merged.' },
  { symptom: 'git push rejects mission branch with "stale info" or "fetch first"', cause: 'Local review/<branch> tracking is stale while sync-merged updates the PR branch to the landed squash commit', fix: 'Automated: sync-merged fetches review/<branch>, retries --force-with-lease, then force-pushes only if stale-info persists.' },
  { symptom: 'curl: (7) Failed to connect to localhost port 3300', cause: 'Forgejo service not reachable from current runtime (sandbox/network)', fix: 'Ensure Forgejo is running (scripts/start-runner.sh) or use FORGEJO_URL override if external.' },
  { symptom: 'PR marked merged but remote branch still exists', cause: 'Remote branch deletion failed (permissions or network)', fix: 'px review <slug> --close (to trigger cleanup; identity resolves from review-state).' }
];

/** @extends{Error} */
export class IntegrationAbort extends Error {}

/** @param {{mission: string, implementer: string, pr_fix_rounds: string, classification: string, date: string}} row */
function formatRecordedStatsRow(row: any) {
  return `${row.mission}: implementer=${row.implementer}, pr_fix_rounds=${row.pr_fix_rounds}, classification=${row.classification}, date=${row.date}`;
}

/** @param {string} value */
function shellQuote(value: string) {
  return `"${String(value).replace(/(["\\$`])/g, '\\$1')}"`;
}

/** @param {string} rootDir @param {{commandRunner?: Function, log?: Function}} opts */
function maybeUpdateGraphifyOnPrimary(rootDir = getPrimaryWorktree(), opts: {commandRunner?: Function, log?: Function} = {}) {
  return updateGraphifyKnowledgeGraph({
    rootDir,
    commandRunner: opts.commandRunner || ((/** @type{string} */ command: string, /** @type{string[]} */ args: string[], /** @type{object} */ options: any) => run(command, args, options)),
    log: opts.log,
    startMessage: `Updating graphify knowledge graph on ${getPrimaryBranch(rootDir)}...`,
    failureHint: 'Continuing without blocking integration.'
  });
}

/** @param {string} rootDir @param {{gitRunner?: Function, tmpDir?: string}} opts */
function prepareNoisePatchForSquash(rootDir: string, opts: {gitRunner?: Function, tmpDir?: string} = {}) {
  const runner = (opts.gitRunner || git) as Function;
  const diffResult = runner(['-C', rootDir, 'diff', '--cached', '--binary']);
  if (diffResult.status !== 0) {
    return {
      ok: false,
      error: [diffResult.stdout, diffResult.stderr].filter(Boolean).join('\n').trim() || 'Could not capture staged backlog-noise patch.'
    };
  }

  const patch = diffResult.stdout || '';
  if (!patch.trim()) {
    return { ok: true, patchPath: null, cleanup: () => {} };
  }

  // mkdtemp gives this invocation an ownership-scoped cleanup target. Never
  // remove the supplied root: it may be an operator or concurrent process path.
  const patchDir = fs.mkdtempSync(path.join(opts.tmpDir || os.tmpdir(), 'parallix-integrate-noise-'));
  const patchPath = path.join(patchDir, 'backlog-noise.patch');
  const cleanup = () => fs.rmSync(patchDir, { recursive: true, force: true });
  fs.writeFileSync(patchPath, patch, 'utf8');

  const resetResult = runner(['-C', rootDir, 'reset', '--hard', 'HEAD']);
  if (resetResult.status !== 0) {
    cleanup();
    return {
      ok: false,
      error: [resetResult.stdout, resetResult.stderr].filter(Boolean).join('\n').trim() || 'Could not restore a clean checkout after capturing backlog-noise patch.'
    };
  }

  return {
    ok: true,
    patchPath,
    cleanup
  };
}

/** @param {string} rootDir @param {string|null} patchPath @param {{gitRunner?: Function}} opts */
export function restoreNoisePatchAfterSquash(rootDir: string, patchPath: string | null, opts: {gitRunner?: Function} = {}) {
  if (!patchPath) {return { ok: true };}
  const runner = (opts.gitRunner || git) as Function;
  const applyResult = runner(['-C', rootDir, 'apply', '--index', patchPath]);
  if (applyResult.status !== 0) {
    return {
      ok: false,
      error: [applyResult.stdout, applyResult.stderr].filter(Boolean).join('\n').trim() || 'Could not re-apply backlog-noise patch after squash merge.'
    };
  }
  return { ok: true };
}

/** @param {string|null} taskAssignee */
function resolveForgejoUserForIntegration(taskAssignee: string | null) {
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

/** @param {string} rootDir @param {{gitRunner?: Function}} opts */
function getUnresolvedIndexConflicts(rootDir = getPrimaryWorktree(), opts: {gitRunner?: Function} = {}) {
  const runner = (opts.gitRunner || git) as Function;
  const result = runner(['-C', rootDir, 'ls-files', '-u']);
  if (result.status !== 0) {
    return {
      ok: false,
      files: [],
      error: [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
    };
  }

  const files = Array.from(new Set(
    result.stdout
      .split('\n')
      .map((line: string) => line.trim())
      .filter(Boolean)
      .map((line: string) => line.split('\t')[1])
      .filter(Boolean)
  ));

  return {
    ok: true,
    files
  };
}

/**
 * Check if all conflict files are under the backlog/ directory.
 * Uses the same noise-path pattern as softResetTrailingBacklogNoise and
 * findLastNonNoiseCommit. An empty list is treated as backlog-only
 * (no conflicts to classify).
 *
 * @param {string[]} conflictFiles - Relative file paths from parseConflictFilesFromMergeOutput
 * @returns {boolean} true if every file starts with 'backlog/'
 */
function areAllBacklogOnlyConflicts(conflictFiles: string[]): boolean {
  if (conflictFiles.length === 0) { return true; }
  return conflictFiles.every(f => f.startsWith('backlog/'));
}

function parseStashPopCollisionFiles(output = '') {
  return output
    .split('\n')
    .map(line => line.trim())
    .filter(line => /already exists, no checkout$/i.test(line))
    .map(line => line.replace(/\s+already exists, no checkout$/i, ''));
}

/**
 * @param {string} slug
 * @param {{stdout: string, stderr: string, status: number}} restoreResult
 * @param {{rootDir?: string, gitRunner?: Function, getUnresolvedIndexConflictsFn?: Function}} opts
 */
function reportStashPopFailure(slug: string, restoreResult: any, opts: {rootDir?: string, gitRunner?: Function, getUnresolvedIndexConflictsFn?: Function} = {}) {
  const output = [restoreResult.stdout, restoreResult.stderr].filter(Boolean).join('\n').trim();
  const runner = (opts.gitRunner || git) as Function;
  const rootDir = opts.rootDir || getPrimaryWorktree();
  const headResult = runner(['-C', rootDir, 'log', '-1', '--oneline']);
  const headLine = headResult.status === 0 ? headResult.stdout.trim() : '(unavailable)';
  const integrationLanded = headLine.includes(`${missionBranchName(slug, rootDir)}:`);
  const indexConflicts = (opts.getUnresolvedIndexConflictsFn || getUnresolvedIndexConflicts)(rootDir);
  const collisionFiles = parseStashPopCollisionFiles(output);

  fmt.log.fail('[RESTORE] Could not restore the temporarily stashed local integration checkout changes.');
  if (integrationLanded) {
    fmt.log.fail(`  Integration commit landed: ${headLine}`);
  } else {
    fmt.log.fail(`  Integration landing not confirmed by HEAD: ${headLine}`);
  }

  if (indexConflicts.ok && indexConflicts.files.length > 0) {
    fmt.log.fail('  Stash restore failure type: merge-conflict (unmerged index entries)');
    indexConflicts.files.forEach((file: string) => fmt.log.fail(`  Collision file: ${file}`));
    fmt.log.fail('  Recovery steps:');
    fmt.log.fail(`    1. cd ${rootDir}`);
    indexConflicts.files.forEach((file: string) => {
      fmt.log.fail(`    2. Resolve ${file}, then run git add "${file}" or git rm "${file}"`);
    });
    fmt.log.fail('    3. git status --short');
    fmt.log.fail('    4. git stash drop');
  } else {
    fmt.log.fail('  Stash restore failure type: file-collision');
    if (collisionFiles.length > 0) {
      collisionFiles.forEach((file: string) => fmt.log.fail(`  Collision file: ${file}`));
    }
    fmt.log.fail('  Recovery steps:');
    fmt.log.fail(`    1. git -C ${rootDir} stash show --name-only stash@{0}`);
    if (collisionFiles.length > 0) {
      collisionFiles.forEach((file: string) => {
        fmt.log.fail(`    2. mv ${path.join(rootDir, file)} ${path.join(rootDir, `${file}.pre-stash-pop`)}`);
      });
      fmt.log.fail(`    3. git -C ${rootDir} stash pop`);
    } else {
      fmt.log.fail(`    2. Inspect the latest stash-pop output and move or remove the colliding files in ${rootDir}`);
      fmt.log.fail(`    3. git -C ${rootDir} stash pop`);
    }
  }

  if (output) {
    fmt.log.fail('  Raw stash pop output:');
    output.split('\n').forEach((line: string) => fmt.log.fail(`    ${line}`));
  }
}

function printDiagnosticTable() {
  fmt.log.info('\n--- Node sync-merged Diagnostic Table ---');
  fmt.log.info('| Symptom | Root Cause | Fix Command |');
  fmt.log.info('| :--- | :--- | :--- |');
  SYNC_MERGED_DIAGNOSTICS.forEach(d => {
    fmt.log.info(`| ${d.symptom} | ${d.cause} | ${d.fix} |`);
  });
  fmt.log.info('------------------------------------\n');
}

/** @param {{statusCode?: number, error: string, raw?: string}} syncResult */
function reportSyncMergedFailure(syncResult: any) {
  const detail = syncResult.statusCode ? ` (${syncResult.error}: ${syncResult.statusCode})` : ` (${syncResult.error})`;
  fmt.log.fail(`Forgejo sync-merged failed${detail}.`);
  if (syncResult.raw) {
    fmt.log.info('sync-merged raw output:');
    fmt.log.plainError(syncResult.raw);
  }
  printDiagnosticTable();
}

function rewriteWorktreePaths(taskFilePath: string, slug: string, options: {rootDir?: string} = {}) {
  const rootDir = options.rootDir || getPrimaryWorktree();
  const before = fs.readFileSync(taskFilePath, 'utf8');
  const updated = before.replace(
    new RegExp(`${conventionalWorktreePath(slug, rootDir)}`, 'g'),
    rootDir
  );

  if (before !== updated) {
    fs.writeFileSync(taskFilePath, updated, 'utf8');
  }
}

/** @param{{slug: string, dirtyEntries?: string[], rootDir?: string, gitRunner?: Function}} params */
function stashMainCheckoutIfNeeded({
  slug,
  dirtyEntries = [],
  rootDir = getPrimaryWorktree(),
  gitRunner = git
}: {slug: string, dirtyEntries?: string[], rootDir?: string, gitRunner?: Function}) {
  if (dirtyEntries.length === 0) {
    return { created: false };
  }

  const message = `integrate:${slug}: temporary integration checkout stash`;
  fmt.log.info(`[STASH] Stashing unrelated local integration checkout changes before integration: ${message}`);
  const result = gitRunner([
    '-C',
    rootDir,
    'stash',
    'push',
    '--include-untracked',
    '-m',
    message
  ]);

  if (result.status !== 0) {
    fmt.log.fail('[STASH] Could not stash the unrelated local integration checkout changes.');
    throw new IntegrationAbort();
  }

  return {
    created: true,
    message,
    rootDir
  };
}

/** @param{{message: string, rootDir?: string, gitRunner?: Function}} params */
function restoreMainCheckoutStash({ message, rootDir = getPrimaryWorktree(), gitRunner = git }: {message: string, rootDir?: string, gitRunner?: Function}) {
  fmt.log.info(`[RESTORE] Restoring temporarily stashed local integration checkout changes: ${message}`);
  // Use --index for safer restore semantics: git attempts to reinstage the index
  // changes from the stash alongside the working-tree changes. Collisions are
  // left as merge conflicts rather than silently overwriting files.
  // Pass cwd explicitly so spawnSync does not inherit the process cwd, which may have been
  // deleted by worktree cleanup earlier in the same integrate run.
  return gitRunner(['-C', rootDir, 'stash', 'pop', '--index'], { cwd: rootDir });
}

/** @param{{stdout: string, stderr: string, status: number}} result */
function isNoMergeToAbortResult(result: any) {
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
  return /MERGE_HEAD missing|There is no merge to abort/i.test(output);
}

/**
 * @param {string} slug
 * @param{{rootDir?: string, recordIntegrationStatsFn?: Function, missionStore?: import('../../../application/domain-ports.js').MissionStore|null}} options
 */
async function recordPostIntegrationStats(
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
async function recordPostIntegrationStatsOrAbort(slug: string, options: {rootDir?: string, missionStore?: import('../../../application/domain-ports.js').MissionStore|null} = {}) {
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
 * @param{{rootDir?: string}} options
 */
async function persistLandedIntegrationOrAbort(slug: string, landedCommit: string, missionServices: any, { rootDir = process.cwd() }: { rootDir?: string } = {}) {
  let loaded = await missionServices.store.load(missionId(slug));
  if (loaded.kind !== 'found') {
    fmt.log.fail(`Mission ${missionId(slug)} is unavailable after landing; statistics will not run.`);
    throw new IntegrationAbort();
  }
  const landedAt = resolveLandedCommitTimestamp(landedCommit, rootDir);
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
function runPostIntegrateHookOrAbort(slug: string, {
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
function cleanupMissionWorktree(
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

/** @param {string} rootDir @param {string} slug */
function findExistingSquashCommit(rootDir: string, slug: string) {
  const result = git(['-C', rootDir, 'log', '--format=%H %s', '-50']);
  if (result.status !== 0) {return null;}
  const prefix = `${missionBranchName(slug, rootDir)}:`;
  for (const line of result.stdout.trim().split('\n')) {
    const spaceIdx = line.indexOf(' ');
    if (spaceIdx === -1) {continue;}
    const hash = line.slice(0, spaceIdx);
    const subject = line.slice(spaceIdx + 1);
    if (subject.startsWith(prefix)) {return hash;}
  }
  return null;
}

/**
 * Detect merge conflicts in the mission worktree and emit a bounded resolution plan.
 *
 * Categories:
 *   - Mission-specific: the adapter-resolved mission directory and backlog/{tasks,completed}/ files matching the slug.
 *     These can be resolved by taking the mission's own version (--theirs during rebase).
 *   - Shared: everything else — warn only, do not auto-skip.
 *
 * @param {string} slug - Backlog task key (e.g. "architecture migration")
 * @param {string} area - Mission gate area passed to the configured verification command
 * @param {{ getConflictFilesFn?: Function }} [options] - Overrides for testing
 * @returns {{ ok: boolean, conflictFiles: string[], sharedFiles: string[], missionSpecificFiles: string[], error?: string, worktreePath?: string }}
 */
/**
 * @param {string} slug
 * @param {string} area
 * @param{{getConflictFilesFn: Function, resolveWorktreeFn?: Function, worktreePathOverride?: string|null, rootDir?: string, baseBranch?: string|null}} options
 */
// @ts-expect-error resolveConflictsForMission options missing getConflictFilesFn
function resolveConflictsForMission(slug, area, { getConflictFilesFn, resolveWorktreeFn = resolveWorktree, worktreePathOverride = null, rootDir = getPrimaryWorktree(), baseBranch = null } = {}) {
  // Resolve the actual attached worktree dynamically; fall back to the conventional
  // path only when git worktree list has no entry for this mission branch.
  const conventionalPath = `${conventionalWorktreePath(slug, rootDir)}`;
  const resolvedPath = worktreePathOverride || resolveWorktreeFn(slug);
  const worktreePath = resolvedPath || conventionalPath;
  if (!resolvedPath) {
    fmt.log.warn(`No registered worktree found for ${missionBranchName(slug, rootDir)}; falling back to conventional path.`);
  }

  // Conflicts must be detected against the branch the mission integrates back
  // into. For a feature-branch mission that is the recorded base branch, not the
  // primary branch; for legacy missions resolveMissionBaseBranch returns primary.
  /** @type {string} */
  let targetBranch = /** @type {string} */ (baseBranch || getPrimaryBranch());
  if (!targetBranch) {
    try { targetBranch = resolveMissionBaseBranch(slug, rootDir); } catch (_) { targetBranch = getPrimaryBranch(); }
  }

  const detectFn = getConflictFilesFn || (() => getConflictFiles(worktreePath, targetBranch));

  if (!fs.existsSync(worktreePath)) {
    fmt.log.fail(`Mission worktree not found: ${worktreePath}`);
    fmt.log.info(`Expected path: ${worktreePath}`);
    return { ok: false, error: 'worktree-missing', conflictFiles: [], sharedFiles: [], missionSpecificFiles: [], worktreePath };
  }

  fmt.log.info(`Detecting conflicts in ${worktreePath} against ${targetBranch}...`);
  let conflictFiles;
  try {
    conflictFiles = detectFn(worktreePath, targetBranch);
  } catch (err: any) {
    fmt.log.fail('Merge check failed with a non-conflict error:');
    fmt.log.fail(err.message);
    return { ok: false, error: 'merge-failed', conflictFiles: [], sharedFiles: [], missionSpecificFiles: [], worktreePath };
  }

  if (conflictFiles.length === 0) {
    fmt.log.pass('No conflicts detected in mission worktree. Integration should proceed cleanly.');
    fmt.log.info(`Retry: px integrate ${slug} --dry-run`);
    return { ok: true, conflictFiles: [], sharedFiles: [], missionSpecificFiles: [], worktreePath };
  }

  fmt.log.info(`Conflicting files (${conflictFiles.length}):`);
  conflictFiles.forEach((f: string) => fmt.log.info(`  - ${f}`));

  // Derive the mission-doc directory prefix from the actual located mission dir
  // so the classification works for non-standard doc paths (e.g. renamed year dir).
  const taskPattern = new RegExp(`backlog/(?:tasks|completed)/[^/]*${slug}`);
  const missionSpecificFiles = conflictFiles.filter((f: string) =>
    isMissionArtifact(f, slug, worktreePath) || taskPattern.test(f)
  );
  const sharedFiles = conflictFiles.filter((f: string) => !missionSpecificFiles.includes(f));
  const quotedWorktreePath = shellQuote(worktreePath);

  if (sharedFiles.length > 0) {
    fmt.log.warn(`Conflicts in ${sharedFiles.length} shared file(s) require manual resolution:`);
    sharedFiles.forEach((f: string) => fmt.log.plain(`  - ${f}`));
    fmt.log.info('Manual resolution path:');
    fmt.log.info(`  cd ${quotedWorktreePath}`);
    fmt.log.info(`  git rebase ${targetBranch}`);
    fmt.log.info('  # resolve each shared file conflict manually');
    fmt.log.info('  git add <resolved-files>');
    fmt.log.info('  git rebase --continue');
    fmt.log.info(`  ${formatVerificationCommand(area, worktreePath)}`);
    fmt.log.info(`  px integrate ${slug} --dry-run`);
    return { ok: false, error: 'shared-file-conflicts', conflictFiles, sharedFiles, missionSpecificFiles, worktreePath };
  }

  fmt.log.info(`All ${missionSpecificFiles.length} conflict(s) are in mission-specific files.`);
  fmt.log.info('Skip-all-conflicts path (use --theirs to keep the mission version):');
  fmt.log.info(`  cd ${quotedWorktreePath}`);
  fmt.log.info(`  git rebase ${targetBranch}`);
  fmt.log.info('  # after the rebase pauses on conflicts:');
  missionSpecificFiles.forEach((f: string) => fmt.log.info(`  git checkout --theirs "${f}" && git add "${f}"`));
  fmt.log.info('  git rebase --continue');
  fmt.log.info(`  ${formatVerificationCommand(area, worktreePath)}`);
  fmt.log.info(`  px integrate ${slug} --dry-run`);

  return { ok: true, conflictFiles, sharedFiles: [], missionSpecificFiles, worktreePath };
}

/** @param{string} slug @param{string} area @param{{rootDir?: string, worktreePath?: string, baseBranch?: string|null}} options */
function buildConflictResolutionPrompt(slug: string = '<slug>', area: string = '<area>', options: {rootDir?: string, worktreePath?: string, baseBranch?: string|null} = {}) {
  const rootDir = options.rootDir || getPrimaryWorktree();
  const worktreePath = options.worktreePath || resolveWorktree(slug) || conventionalWorktreePath(slug, rootDir);
  const quotedWorktreePath = shellQuote(worktreePath);
  // Rebase guidance must target the branch the mission integrates back into: the
  // recorded base for feature-branch missions, the primary branch otherwise.
  let targetBranch = options.baseBranch;
  if (!targetBranch) {
    try { targetBranch = resolveMissionBaseBranch(slug, rootDir); } catch (_) { targetBranch = getPrimaryBranch(); }
  }
  return [
    'Conflict resolution options:',
    '',
    'Option A — Agent-assisted (recommended):',
    '  Copy/paste from the mission worktree:',
    `  cd ${quotedWorktreePath} && px resolve-conflict ${slug}`,
    '  (Detects conflict files, categorises mission-specific vs shared, and prints exact resolution commands.)',
    '',
    'Option B — Manual rebase path:',
    `  1. Stay in the mission worktree (${worktreePath}); do not resolve non-trivial conflicts inside ${rootDir}.`,
    `     cd ${quotedWorktreePath}`,
    '     git status --short',
    `  2. Rebase the mission branch onto the local ${targetBranch} branch:`,
    `     git fetch review ${targetBranch}`,
    `     git rebase ${targetBranch}`,
    `  3. Re-run the mission gate: ${formatVerificationCommand(area, worktreePath)}`,
    `  4. Retry the dry-run integration preflight: px integrate ${slug} --dry-run`
  ];
}

// Attach all named exports as properties of the default export (mirrors original CJS shape for CommonJS require compatibility)
(integrate as any).resolveConflictsForMission = resolveConflictsForMission;
(integrate as any).cleanupMissionWorktree = cleanupMissionWorktree;
(integrate as any).rewriteWorktreePaths = rewriteWorktreePaths;
(integrate as any).isNoMergeToAbortResult = isNoMergeToAbortResult;
(integrate as any).buildConflictResolutionPrompt = buildConflictResolutionPrompt;
(integrate as any).VARIANT_B_AUTOMATION_SUMMARY = VARIANT_B_AUTOMATION_SUMMARY;
(integrate as any).stashMainCheckoutIfNeeded = stashMainCheckoutIfNeeded;
(integrate as any).restoreMainCheckoutStash = restoreMainCheckoutStash;
(integrate as any).evaluateTaskStatusForIntegration = evaluateTaskStatusForIntegration;
(integrate as any).promoteTaskForIntegrationIfNeeded = promoteTaskForIntegrationIfNeeded;
(integrate as any).findExistingSquashCommit = findExistingSquashCommit;
(integrate as any).printIntegrationPreflight = printIntegrationPreflight;
(integrate as any).resolveForgejoUserForIntegration = resolveForgejoUserForIntegration;
(integrate as any).getUnresolvedIndexConflicts = getUnresolvedIndexConflicts;
(integrate as any).parseStashPopCollisionFiles = parseStashPopCollisionFiles;
(integrate as any).reportStashPopFailure = reportStashPopFailure;
(integrate as any).maybeUpdateGraphifyOnPrimary = maybeUpdateGraphifyOnPrimary;
(integrate as any).SYNC_MERGED_DIAGNOSTICS = SYNC_MERGED_DIAGNOSTICS;
(integrate as any).printDiagnosticTable = printDiagnosticTable;
(integrate as any).reportSyncMergedFailure = reportSyncMergedFailure;
(integrate as any).recordPostIntegrationStats = recordPostIntegrationStats;
(integrate as any).recordPostIntegrationStatsOrAbort = recordPostIntegrationStatsOrAbort;
(integrate as any).runPostIntegrateHookOrAbort = runPostIntegrateHookOrAbort;
(integrate as any).formatRecordedStatsRow = formatRecordedStatsRow;
(integrate as any).detectChangedAreas = detectChangedAreas;
(integrate as any).parseFilesToAreas = parseFilesToAreas;
(integrate as any).loadIntegrationConfig = loadIntegrationConfig;
(integrate as any).getIntegrationGatePlan = getIntegrationGatePlan;
(integrate as any).printIntegrationGatePlan = printIntegrationGatePlan;
(integrate as any).buildIntegrationGateEnv = buildIntegrationGateEnv;
(integrate as any).captureFinalIntegrationTree = captureFinalIntegrationTree;
(integrate as any).parseIntegrateArgs = parseIntegrateArgs;
(integrate as any).resolveIntegrationVerificationWorktree = resolveIntegrationVerificationWorktree;
(integrate as any).buildIntegrationVerificationInvocation = buildIntegrationVerificationInvocation;
(integrate as any).classifyHookFailure = classifyHookFailure;
(integrate as any).handleHookFailureAutoBounce = handleHookFailureAutoBounce;
(integrate as any).executeIntegrationGates = executeIntegrationGates;
(integrate as any).orderIntegrationGates = orderIntegrationGates;
(integrate as any).gateMatchesChangedAreas = gateMatchesChangedAreas;
(integrate as any).buildIntegrationContext = buildIntegrationContext;
(integrate as any).prepareNoisePatchForSquash = prepareNoisePatchForSquash;
(integrate as any).areAllBacklogOnlyConflicts = areAllBacklogOnlyConflicts;
// Re-export getPrimaryWorktree from mission-utils
(integrate as any).getPrimaryWorktree = getPrimaryWorktree;
export default integrate;
export { integrate, formatRecordedStatsRow, detectChangedAreas, parseFilesToAreas, loadIntegrationConfig, getIntegrationGatePlan, printIntegrationGatePlan, buildIntegrationGateEnv, captureFinalIntegrationTree, parseIntegrateArgs, resolveIntegrationVerificationWorktree, buildIntegrationVerificationInvocation, executeIntegrationGates, orderIntegrationGates, gateMatchesChangedAreas, buildIntegrationContext, getPrimaryWorktree, resolveConflictsForMission, cleanupMissionWorktree, rewriteWorktreePaths, isNoMergeToAbortResult, buildConflictResolutionPrompt, VARIANT_B_AUTOMATION_SUMMARY, stashMainCheckoutIfNeeded, restoreMainCheckoutStash, evaluateTaskStatusForIntegration, promoteTaskForIntegrationIfNeeded, findExistingSquashCommit, printIntegrationPreflight, resolveForgejoUserForIntegration, getUnresolvedIndexConflicts, parseStashPopCollisionFiles, reportStashPopFailure, maybeUpdateGraphifyOnPrimary, SYNC_MERGED_DIAGNOSTICS, printDiagnosticTable, recordPostIntegrationStats, recordPostIntegrationStatsOrAbort, persistLandedIntegrationOrAbort, reportSyncMergedFailure, runPostIntegrateHookOrAbort, prepareNoisePatchForSquash, areAllBacklogOnlyConflicts, isIntendedPayloadAtHead };
