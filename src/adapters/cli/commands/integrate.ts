import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import child_process from 'node:child_process';
import { detectRebaseState, git, getCurrentBranch, run } from '../../git/git.js';
import { resolveTaskFile, getTaskStatus, setTaskStatus, completeTask, getTaskAssignee, getTaskClassification, getTaskImplementer, transitionTask } from '../../backlog/backlog.js';
import { toVirtual, toActual } from '../../config/state-map.js';
import { getPrStatus, getLatestReviewDecision, syncMerged, readToken, resolveTokenFile, resolveForgejoUser, resolveForgejoHome, isForgejoPath, listOpenPrsForSlug } from '../../forgejo/forgejo.js';
import * as fmt from '../../../application/presentation/cli-format.js';

import { buildAutonomousReviewMatrix, formatMatrixSummary } from '../../agents/runtime-matrix.js';
import { findMissionDir, resolveWorktree, findMissionArea, missionTitle, parseConflictFilesFromMergeOutput, getConflictFiles, inferSlug, updateGraphifyKnowledgeGraph, getPrimaryWorktree, getPrimaryBranch, conventionalWorktreePath, softResetTrailingBacklogNoise, findMissionDocInBranches, missionBranchName, missionDirForSlug, isMissionArtifact, resolveMissionBaseBranch, resolveBaseWorktree } from '../../filesystem/mission-utils.js';
import stats from './stats.js';
import * as verification from '../../verification/verification.js';
const { formatVerificationCommand } = verification;
import * as postIntegrateHook from '../../process/post-integrate-hook.js';
import { isForgejoReviewEnabled } from '../../config/product-config.js';
import { readReviewState, writeReviewState, persistReviewStateOrThrow } from '../../review/review-state.js';
import { startAgent, selectAgent, workflowLauncherStatus } from '../../agents/agents.js';
import { applyAgentFallback } from '../../review/review-loop.js';
import { missionId } from '../../../domain/mission.js';
import { detectChangedAreas, isIntendedPayloadAtHead, parseFilesToAreas, orderIntegrationGates, gateMatchesChangedAreas, loadIntegrationConfig, getIntegrationGatePlan, printIntegrationGatePlan, buildIntegrationGateEnv, captureFinalIntegrationTree, resolveIntegrationVerificationWorktree, buildIntegrationVerificationInvocation, executeIntegrationGates } from './integrate-gates.js';

const VARIANT_B_AUTOMATION_SUMMARY = 'Variant B automation: Backlog task closeout, worktree-path rewrite, squash commit with hook-enforced validation, Forgejo sync-merged, and mission worktree cleanup.';

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
class IntegrationAbort extends Error {}

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
function restoreNoisePatchAfterSquash(rootDir: string, patchPath: string | null, opts: {gitRunner?: Function} = {}) {
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

const REAL_AGENT_OPTION = '--real-agent';
const REAL_AGENT_MODEL_OPTION = '--real-agent-model';
const INTEGRATE_VALUE_OPTIONS = new Set([REAL_AGENT_OPTION, REAL_AGENT_MODEL_OPTION]);
const CODEX_REAL_AGENT_MODEL = 'gpt-5.6-luna';

/** Parse only the public integrate flags before any preflight or gate work. */
function parseIntegrateArgs(args: string[]) {
  const params: string[] = [];
  let dryRun = false;
  let noIntegrationGates = false;
  let noGate = false;
  let realAgent: string | null = null;
  let realAgentModel: string | null = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (INTEGRATE_VALUE_OPTIONS.has(arg)) {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} requires a value.`);
      }
      if (arg === REAL_AGENT_OPTION) {
        if (realAgent !== null) {throw new Error('--real-agent may be supplied only once.');}
        realAgent = value;
      } else {
        if (realAgentModel !== null) {throw new Error('--real-agent-model may be supplied only once.');}
        realAgentModel = value;
      }
      index += 1;
      continue;
    }
    if (arg === '--dry-run') { dryRun = true; continue; }
    if (arg === '--no-integration-gates') { noIntegrationGates = true; continue; }
    if (arg === '--no-gate') { noGate = true; continue; }
    if (arg.startsWith('--')) {throw new Error(`Unknown integrate option: ${arg}`);}
    params.push(arg);
  }

  if ((realAgent === null) !== (realAgentModel === null)) {
    throw new Error('--real-agent and --real-agent-model must be supplied together.');
  }
  if (realAgent !== null && realAgent !== 'codex') {
    throw new Error(`Unsupported real agent "${realAgent}". Supported value: codex.`);
  }
  if (realAgent === 'codex' && realAgentModel !== CODEX_REAL_AGENT_MODEL) {
    throw new Error(`Unsupported Codex real-agent model "${realAgentModel}". Supported value: ${CODEX_REAL_AGENT_MODEL}.`);
  }
  if (noIntegrationGates && process.env.PARALLIX_TEST_ALLOW_INTEGRATION_GATE_BYPASS !== '1') {
    throw new Error('--no-integration-gates is rejected: final integration gates are mandatory.');
  }
  return { explicitSlug: params[0], dryRun, noIntegrationGates, noGate, realAgent, realAgentModel };
}

export interface IntegrateFn extends Function {
  resolveConflictsForMission: typeof resolveConflictsForMission;
  cleanupMissionWorktree: typeof cleanupMissionWorktree;
  rewriteWorktreePaths: typeof rewriteWorktreePaths;
  isNoMergeToAbortResult: typeof isNoMergeToAbortResult;
  buildConflictResolutionPrompt: typeof buildConflictResolutionPrompt;
  VARIANT_B_AUTOMATION_SUMMARY: typeof VARIANT_B_AUTOMATION_SUMMARY;
  stashMainCheckoutIfNeeded: typeof stashMainCheckoutIfNeeded;
  restoreMainCheckoutStash: typeof restoreMainCheckoutStash;
  evaluateTaskStatusForIntegration: typeof evaluateTaskStatusForIntegration;
  promoteTaskForIntegrationIfNeeded: typeof promoteTaskForIntegrationIfNeeded;
  findExistingSquashCommit: typeof findExistingSquashCommit;
  printIntegrationPreflight: typeof printIntegrationPreflight;
  resolveForgejoUserForIntegration: typeof resolveForgejoUserForIntegration;
  getUnresolvedIndexConflicts: typeof getUnresolvedIndexConflicts;
  parseStashPopCollisionFiles: typeof parseStashPopCollisionFiles;
  reportStashPopFailure: typeof reportStashPopFailure;
  maybeUpdateGraphifyOnPrimary: typeof maybeUpdateGraphifyOnPrimary;
  SYNC_MERGED_DIAGNOSTICS: typeof SYNC_MERGED_DIAGNOSTICS;
  printDiagnosticTable: typeof printDiagnosticTable;
  reportSyncMergedFailure: typeof reportSyncMergedFailure;
  recordPostIntegrationStats: typeof recordPostIntegrationStats;
  recordPostIntegrationStatsOrAbort: typeof recordPostIntegrationStatsOrAbort;
  runPostIntegrateHookOrAbort: typeof runPostIntegrateHookOrAbort;
  formatRecordedStatsRow: typeof formatRecordedStatsRow;
  detectChangedAreas: typeof detectChangedAreas;
  parseFilesToAreas: typeof parseFilesToAreas;
  loadIntegrationConfig: typeof loadIntegrationConfig;
  getIntegrationGatePlan: typeof getIntegrationGatePlan;
  printIntegrationGatePlan: typeof printIntegrationGatePlan;
  buildIntegrationGateEnv: typeof buildIntegrationGateEnv;
  captureFinalIntegrationTree: typeof captureFinalIntegrationTree;
  parseIntegrateArgs: typeof parseIntegrateArgs;
  resolveIntegrationVerificationWorktree: typeof resolveIntegrationVerificationWorktree;
  buildIntegrationVerificationInvocation: typeof buildIntegrationVerificationInvocation;
  classifyHookFailure: typeof classifyHookFailure;
  handleHookFailureAutoBounce: typeof handleHookFailureAutoBounce;
  executeIntegrationGates: typeof executeIntegrationGates;
  orderIntegrationGates: typeof orderIntegrationGates;
  gateMatchesChangedAreas: typeof gateMatchesChangedAreas;
  buildIntegrationContext: typeof buildIntegrationContext;
  areAllBacklogOnlyConflicts: typeof areAllBacklogOnlyConflicts;
  getPrimaryWorktree: typeof getPrimaryWorktree;
}

/** @param {string[]} args */
async function integrate(args: string[], options: { missionServicesFn?: Function } = {}) {
  const missionServicesFn = options.missionServicesFn;
  let exitCode = 0;
  /** @type{{created?: boolean, message?: string, rootDir?: string}|null} */
  let temporaryStash = null;
  let nextActionMessage = null;
  let parsedArgs;
  try {
    parsedArgs = parseIntegrateArgs(args);
  } catch (error: any) {
    fmt.log.fail(error.message);
    process.exit(1);
    return;
  }
  const { explicitSlug, dryRun, noIntegrationGates, noGate, realAgent, realAgentModel } = parsedArgs;
  const slug = inferSlug(explicitSlug);

  /** @type {{slug: string, branch: string, currentBranch: string, missionDir?: string, area: string, task: {ok: boolean, taskFile?: string, reason?: string, matches?: string[]}, taskStatus?: string, taskAssignee?: string|null, forgejoUser?: string|null, forgejoToken?: string|null, taskAssigneeWarning?: string|null, pr: {exists?: boolean, state?: string, number?: number, merged?: boolean, raw?: string}, siblingPrs: any[], approval: {ok?: boolean, error?: string, reviewState?: string, defaultUserApproved?: boolean, source?: string}, baseBranch?: string, baseWorktree?: string, mainBranch: string, mainDirtyEntries: string[], mainDirty: boolean}} */
  let context;

  if (process.env.FORGEJO_USER === 'gemini' || process.env.WORKFLOW_AGENT === 'gemini') {
    fmt.log.fail('Gemini is not authorized to run integrate. Post a handoff comment on the PR and stop.');
    process.exit(1);
    return;
  }

  if (!slug) {
    fmt.log.fail('Usage: px integrate [<slug>] [--dry-run] [--no-integration-gates]');
    process.exit(1);
    return;
  }

    if (noGate) {
      fmt.log.warn('integrate ignores --no-gate. The landed squash commit relies on the local git hooks for validation.');
    }

    try {
      const executionDir = process.cwd();
      context = await buildIntegrationContext(slug);

      // architecture invariant/architecture invariant: Read authoritative Mission state from SqliteMissionStore.
      // Database unavailability fails the operation (architecture invariant: fail-closed).
      if (typeof missionServicesFn !== 'function') { throw new Error('integrate command requires injected mission services'); }
      const missionServices = await missionServicesFn(context.baseWorktree || process.cwd());
      const missionLoad = await missionServices.store.load(missionId(slug));
      if (missionLoad.kind === 'unavailable') {
        fmt.log.fail(`Mission store unavailable: ${missionLoad.reason}. Integration cannot proceed on legacy files.`);
        throw new IntegrationAbort();
      }
      if (missionLoad.kind === 'missing') {
        fmt.log.fail(`Mission ${missionId(slug)} not found in SQLite. Materialize through the intake boundary before integration.`);
        throw new IntegrationAbort();
      }
      if (missionLoad.kind === 'found') {
        const missionContext = /** @type {Record<string, unknown>} */ (context as Record<string, unknown>);
        missionContext.missionStatus = missionLoad.mission.status;
        missionContext.missionReview = missionLoad.mission.review;
        missionContext.missionVersion = missionLoad.version;
        // architecture invariant: Use Mission store review as approval source when Forgejo is unavailable.
        if (context.approval.ok !== true && missionLoad.mission.review) {
          const lastRound = missionLoad.mission.review.rounds[missionLoad.mission.review.rounds.length - 1];
          if (lastRound?.decision?.kind === 'approved') {
            context.approval = { ok: true, reviewState: 'APPROVED', source: 'mission-store' };
          }
        }
      }

      // The integration target is the mission's recorded base worktree/branch.
      // For legacy missions these resolve to the primary worktree/branch, keeping
      // the merge/commit/sync path byte-identical to today.
      const baseWorktree = context.baseWorktree;
      const baseBranch = context.baseBranch;
      const { failures } = printIntegrationPreflight(context);

      if (failures.length > 0) {
        fmt.log.fail('\nIntegration preflight failed. Resolve the blockers above before running integrate.');
        throw new IntegrationAbort();
      }

      if (!noIntegrationGates) {
        const verification = buildIntegrationVerificationInvocation(slug, { baseWorktree });
        const finalTree = captureFinalIntegrationTree(verification.cwd);
        if (!finalTree.ok) {
          fmt.log.fail(`Integration gates cannot start for ${slug}: ${finalTree.error}`);
          throw new IntegrationAbort();
        }
        const env = buildIntegrationGateEnv(slug, { dryRun, baseBranch, baseWorktree: finalTree.rootDir, realAgent, realAgentModel });
        
        if (dryRun) {
          fmt.log.info('Running integration gates (dry-run)...');
        } else {
          fmt.log.info('Running integration gates...');
        }
        
        // Gate commands are project commands, not interactive login commands.
        // A login shell can replace PATH or source a broken user profile.
        fmt.log.info(`Integration gate target: slug=${slug} root=${finalTree.rootDir} commit=${finalTree.commit} tree=${finalTree.tree}`);
        const result = child_process.spawnSync('bash', ['-c', verification.command], {
          cwd: verification.cwd,
          env,
          stdio: 'inherit'
        });
        
        if (result.status !== 0) {
          fmt.log.fail(`\nIntegration gates failed for ${slug} (root=${finalTree.rootDir}, commit=${finalTree.commit}, tree=${finalTree.tree}) with exit code ${result.status}`);
          fmt.log.fail('Aborting before merge.');
          throw new IntegrationAbort();
        }
        
        if (!dryRun) {
          fmt.log.pass('All integration gates passed.');
        }
      } else {
        fmt.log.info('Integration gates skipped via --no-integration-gates flag');
      }

      if (dryRun) {
        await promoteTaskForIntegrationIfNeeded(context, { dryRun: true, missionServicesFn });
        fmt.log.pass('\nDry run complete. Integration preflight passed.');
        return;
      }

      temporaryStash = stashMainCheckoutIfNeeded({
        slug,
        dirtyEntries: context.mainDirtyEntries as string[],
        rootDir: /** @type{string} */(baseWorktree) as string
      });

    // End-context check: if we are in the worktree that is about to be deleted,
    // move the Node process to the base worktree to avoid being left in a ghost directory.
    const missionWorktree = conventionalWorktreePath(slug);
    if (process.cwd() === missionWorktree || process.cwd().startsWith(missionWorktree + '/')) {
      fmt.log.info(`Moving process directory to ${baseWorktree} before mission worktree deletion.`);
      process.chdir(baseWorktree as string);
    }

    const branch = missionBranchName(slug, baseWorktree);
    const mainTitle = missionTitle(slug) || slug;
    const summary = mainTitle.replace(/\s+/g, ' ').trim();
    const mainTaskFile = ((context.task as any).taskFile as string).replace(executionDir, baseWorktree as string);
    fmt.log.info('Selecting integration variant: Variant B (local squash-merge)');
    fmt.log.info(`\nStep 1: Using base worktree ${baseWorktree} on ${baseBranch} as the squash-merge target...`);

    fmt.log.info(`Step 2: Checking merge conflicts against local ${baseBranch} in the base worktree...`);
    const dryMerge = git(['-C', baseWorktree, 'merge', '--no-commit', '--no-ff', branch]);
    const abortResult = git(['-C', baseWorktree, 'merge', '--abort']);

    let proceedToSquash = false;

    // Check abort failure for the success path (merge was clean but abort didn't).
    // When dryMerge.status === 0, the abort restores the worktree after a clean
    // probe — if it fails the base may be left in a dirty merge state.
    let abortFailed = abortResult.status !== 0 && !isNoMergeToAbortResult(abortResult);

    if (dryMerge.status === 0 && abortFailed) {
      fmt.log.fail('Dry-run merge could not be aborted cleanly. Inspect the local integration checkout before retrying integrate.');
      throw new IntegrationAbort();
    }

    if (dryMerge.status !== 0) {
      // Classify conflicts BEFORE deciding on abort failure.
      // This allows backlog-only classification to rescue unabortable merges.
      // (architecture invariant / architecture migration)
      const conflictOutput = [/** @type {any} */ (dryMerge).stdout, /** @type {any} */ (dryMerge).stderr].filter(Boolean).join('\n');
      const conflictFiles = parseConflictFilesFromMergeOutput(conflictOutput);
      const backlogOnly = areAllBacklogOnlyConflicts(conflictFiles) && conflictFiles.length > 0;

      if (backlogOnly) {
        fmt.log.info('Backlog-only conflicts detected — refreshing base branch and retrying probe merge...');

        // Safe cleanup: if abort failed, use reset --hard to clear stale merge state.
        // After successful reset, clear abortFailed so the fallback path after retry
        // uses the normal conflict-resolution flow (not the generic abort-failure path).
        if (abortFailed) {
          const resetResult = git(['-C', baseWorktree, 'reset', '--hard', 'HEAD']);
          if (resetResult.status !== 0) {
            fmt.log.fail('[RETRY] Could not clean up after backlog-only conflict merge.');
            throw new IntegrationAbort();
          }
          abortFailed = false;
        }

        // Fetch and advance local base branch to the latest remote ref.
        // Either failure aborts the integration — retrying against an unrefreshed
        // base would violate the mission's requirement to retry against updated base.
        const fetchResult = git(['-C', baseWorktree, 'fetch', '--all', '--prune']);
        if (fetchResult.status !== 0) {
          fmt.log.fail('[RETRY] Could not fetch remote refs — aborting integration.');
          throw new IntegrationAbort();
        }
        const pullResult = git(['-C', baseWorktree, 'pull', '--ff-only']);
        if (pullResult.status !== 0) {
          fmt.log.fail(`[RETRY] Could not fast-forward ${baseBranch} — aborting integration.`);
          throw new IntegrationAbort();
        }
        fmt.log.info(`Base branch ${baseBranch} refreshed via fast-forward.`);

        // Retry probe merge against the refreshed base.
        const retryMerge = git(['-C', baseWorktree, 'merge', '--no-commit', '--no-ff', branch]);
        const retryAbort = git(['-C', baseWorktree, 'merge', '--abort']);
        if (retryAbort.status !== 0 && !isNoMergeToAbortResult(retryAbort)) {
          abortFailed = true;
          fmt.log.fail('[RETRY] Dry-run merge retry could not be aborted cleanly.');
        } else if (retryMerge.status === 0) {
          fmt.log.pass('Probe merge retry succeeded — proceeding to squash-merge.');
          proceedToSquash = true;
        }
      }

      if (proceedToSquash) {
        // Retry resolved drift — fall through to Step 3 (squash-merge) below.
      } else if (!abortFailed) {
        // Abort succeeded; check for existing squash or fail with conflict details.
        const existingSquash = findExistingSquashCommit(baseWorktree, slug);
        if (existingSquash) {
          fmt.log.warn(`Squash commit already exists on local ${baseBranch} from a previous partial integration (${existingSquash.slice(0, 12)}). Resuming from sync-merged step.`);
          const mergedCommit = existingSquash;
          if (isForgejoReviewEnabled(baseWorktree)) {
            fmt.log.info('Step 6 (resume): Syncing merged state to Forgejo...');
            const syncResult = syncMerged(branch, mergedCommit, {
              rootDir: baseWorktree,
              forgejoUser: context.forgejoUser,
              token: context.forgejoToken,
              baseBranch: context.baseBranch
            });
            if (!syncResult.ok) {
              reportSyncMergedFailure(syncResult);
              throw new IntegrationAbort();
            }
          } else {
            fmt.log.info('Step 6 (resume): Skipping Forgejo sync (review provider is not forgejo).');
          }
          if (fs.existsSync(baseWorktree)) {
            nextActionMessage = `Next: cd ${baseWorktree}`;
          }
          await persistLandedIntegrationOrAbort(slug, mergedCommit, missionServices, { rootDir: baseWorktree as string });
          await (recordPostIntegrationStatsOrAbort as any)(slug, { rootDir: baseWorktree, missionStore: missionServices.store });
          fmt.log.info('Step 7 (resume): Cleaning up the local mission worktree...');
          if (!cleanupMissionWorktree(slug)) {
            fmt.log.fail('Mission worktree cleanup failed.');
            throw new IntegrationAbort();
          }
          maybeUpdateGraphifyOnPrimary(baseWorktree);
          runPostIntegrateHookOrAbort(slug, { baseWorktree: baseWorktree as string, baseBranch: baseBranch as string, variant: 'variant-b-resumed' });
          fmt.log.pass('Integration completed successfully (resumed from partial state).');
        } else {
          fmt.log.fail('Merge conflicts detected. Rebase the mission branch before integrating.');
          if (conflictFiles.length > 0) {
            fmt.log.info(`Conflicting files (${conflictFiles.length}):`);
            conflictFiles.forEach(f => fmt.log.info(`  - ${f}`));
          }
          fmt.log.info('Conflict helper path:');
          for (const line of formatMatrixSummary(buildAutonomousReviewMatrix())) {
            fmt.log.info(line);
          }
          for (const line of buildConflictResolutionPrompt(slug, context.area, { baseBranch: context.baseBranch || '' })) {
            fmt.log.info(line);
          }
          throw new IntegrationAbort();
        }
      } else {
        // Abort failed and not backlog-only (or retry failed): fail closed.
        fmt.log.fail('Dry-run merge could not be aborted cleanly. Inspect the local integration checkout before retrying integrate.');
        throw new IntegrationAbort();
      }
    }

    if (dryMerge.status === 0 || proceedToSquash) {
      fmt.log.info('Step 3: Squash-merging the mission branch...');
      let noisePatchState = null;
      if (softResetTrailingBacklogNoise(baseWorktree, git)) {
        noisePatchState = prepareNoisePatchForSquash(baseWorktree, { gitRunner: git });
        if (!noisePatchState.ok) {
          fmt.log.fail('Could not preserve trailing backlog noise before squash merge.');
          if (noisePatchState.error) {
            fmt.log.fail(noisePatchState.error);
          }
          throw new IntegrationAbort();
        }
      }
      const squashResult = git(['-C', baseWorktree, 'merge', '--squash', branch]);
      if (squashResult.status !== 0) {
        noisePatchState?.cleanup?.();
        fmt.log.fail('Squash merge failed.');
        throw new IntegrationAbort();
      }
      if (noisePatchState?.patchPath) {
        const restoreNoiseResult = restoreNoisePatchAfterSquash(/** @type {string} */ (baseWorktree), noisePatchState.patchPath, { gitRunner: git });
        (noisePatchState.cleanup as Function)();
        if (!restoreNoiseResult.ok) {
          fmt.log.fail('Could not restore trailing backlog noise after squash merge.');
          if (restoreNoiseResult.error) {
            fmt.log.fail(restoreNoiseResult.error);
          }
          throw new IntegrationAbort();
        }
      }

      // Capture the squash payload before closeout changes the checkout. The
      // final commit names this set, so a concurrent bare board commit never
      // inherits ambient index entries from an earlier `git add -A`.
      const intendedPayloadPaths = new Set(
        git(['-C', baseWorktree, 'diff', '--cached', '--name-only', '--']).stdout
          .split('\n')
          .map(file => file.trim())
          .filter(Boolean)
      );

      fmt.log.info('Step 4: Final closeout checks in the local integration checkout...');
      // Do not dirty the primary checkout before the probe merge and squash have
      // completed. The task file is commonly part of the mission branch, so an
      // early promotion can make `merge --abort` fail and leave index conflicts.
      await promoteTaskForIntegrationIfNeeded(context, { missionServicesFn });
      if (fs.existsSync(mainTaskFile)) {
        completeTask(slug, baseWorktree);
        const originalTaskPath = path.relative(baseWorktree as string, mainTaskFile);
        intendedPayloadPaths.add(originalTaskPath);
        // Re-resolve because it moved
        const updatedResolution = resolveTaskFile(slug, baseWorktree);
        if (updatedResolution.ok) {
          const completedTaskPath = path.relative(baseWorktree as string, updatedResolution.taskFile as string);
          intendedPayloadPaths.add(completedTaskPath);
          rewriteWorktreePaths(updatedResolution.taskFile as string, slug, { rootDir: baseWorktree });
          const stageCloseout = git(['-C', baseWorktree, 'add', '-A', '--', originalTaskPath, completedTaskPath]);
          if (stageCloseout.status !== 0) {
            fmt.log.fail('Could not stage backlog closeout for the landed squash commit.');
            throw new IntegrationAbort();
          }
        }
      }

      fmt.log.info('Step 5: Creating the landed squash commit in the local integration checkout...');
      let commitResult = git([
        '-C',
        /** @type {string} */ (baseWorktree),
        'commit',
        '--only',
        '-m',
        `${branch}: ${summary}`,
        '--',
        ...intendedPayloadPaths
      ]);
      let retriedCommit = false;
      while (commitResult.status !== 0) {
        const output = [commitResult.stdout, commitResult.stderr].filter(Boolean).join('\n').trim();
        if (isIntendedPayloadAtHead(baseWorktree as string, intendedPayloadPaths, { gitRunner: git })) {
          const carryingCommit = git(['-C', baseWorktree, 'rev-parse', 'HEAD']).stdout.trim();
          fmt.log.pass(`Integration payload already landed in commit ${carryingCommit}.`);
          break;
        }
        fmt.log.fail('Could not create the squash commit in the local integration checkout.');
        if (output) {
          fmt.log.fail(output);
        }

        // SC2/SC4: Classify hook failure and auto-bounce to implementer
        const hookClassification = classifyHookFailure(output);
        if (hookClassification.isHookFailure) {
          const shouldRetry = await handleHookFailureAutoBounce(slug, baseWorktree, output, hookClassification, { missionStore: missionServices.store });
          if (shouldRetry) {
            fmt.log.info('Retrying squash commit after implementer hook fix...');
            retriedCommit = true;
            commitResult = git([
              '-C',
              /** @type {string} */ (baseWorktree),
              'commit',
              '--only',
              '-m',
              `${branch}: ${summary}`,
              '--',
              ...intendedPayloadPaths
            ]);
            continue;
          } else {
            // Stranded - max retries exceeded or agent failed
            fmt.log.info(`The squash commit runs the repo git hooks. Fix the reported hook failure in ${baseWorktree} and retry integrate.`);
            throw new IntegrationAbort();
          }
        } else {
          fmt.log.info(`The squash commit runs the repo git hooks. Fix the reported hook failure in ${baseWorktree} and retry integrate.`);
          fmt.log.info(`For this mission, the relevant verification command is ${formatVerificationCommand(context.area, baseWorktree)}`);
          throw new IntegrationAbort();
        }
      }
      if (retriedCommit) {
        fmt.log.pass('Squash commit created after hook fix.');
      }
      const mergedCommit = git(['-C', baseWorktree, 'rev-parse', 'HEAD']).stdout.trim();

      if (isForgejoReviewEnabled(baseWorktree)) {
        fmt.log.info('Step 6: Syncing merged state to Forgejo...');
        const syncResult = syncMerged(branch, mergedCommit, {
          rootDir: baseWorktree,
          forgejoUser: context.forgejoUser,
          token: context.forgejoToken,
          baseBranch: context.baseBranch
        });
        if (!syncResult.ok) {
          reportSyncMergedFailure(syncResult);
          throw new IntegrationAbort();
        }
      } else {
        fmt.log.info('Step 6: Skipping Forgejo sync (review provider is not forgejo).');
      }

      if (fs.existsSync(baseWorktree)) {
        nextActionMessage = `Next: cd ${baseWorktree}`;
      }
      await persistLandedIntegrationOrAbort(slug, mergedCommit, missionServices, { rootDir: baseWorktree as string });
      await (recordPostIntegrationStatsOrAbort as any)(slug, { rootDir: baseWorktree, missionStore: missionServices.store });
      fmt.log.info('Step 7: Cleaning up the local mission worktree...');
      if (!cleanupMissionWorktree(slug)) {
        fmt.log.fail('Mission worktree cleanup failed.');
        throw new IntegrationAbort();
      }

      maybeUpdateGraphifyOnPrimary(baseWorktree);
      runPostIntegrateHookOrAbort(slug, { baseWorktree: baseWorktree as string, baseBranch: baseBranch as string, variant: 'variant-b' });

      // Proof capture after post-integrate hook so it represents the
      // freshly rebuilt tree that will actually be published (architecture migration).
      const proofResult = verification.captureVerifiedTreeProof(context.area, baseWorktree, {
        gitRunner: git,
        runFn: /** @type {Function} */ (child_process.spawnSync)
      });
      if (!/** @type {any} */ (proofResult).ok) {
        fmt.log.fail(`Could not verify the exact tree being published: ${/** @type {any} */ (proofResult).error}`);
        throw new IntegrationAbort();
      }
      const proof = /** @type {any} */ (proofResult).proof;
      const proofCheck = verification.assertVerifiedTreeProof(proof!, baseWorktree, { gitRunner: git });
      if (!proofCheck.ok) {
        fmt.log.fail(`Verification proof is stale for the publish tree: ${/** @type {any} */ (proofCheck).error}`);
        throw new IntegrationAbort();
      }

      fmt.log.pass('Integration completed successfully.');
    }
  } catch (error) {
    if (error instanceof IntegrationAbort) {
      exitCode = 1;
    } else {
      // Report and fail. Rethrowing here is swallowed by the `process.exit()`
      // below, which would end the run with a success code and no output at
      // all — the operator would see integrate "succeed" while doing nothing.
      fmt.log.fail(`Integration failed: ${(error as any)?.message || String(error)}`);
      if ((error as any)?.stack) {
        fmt.log.fail(String((error as any).stack));
      }
      exitCode = 1;
    }
  } finally {
    if (temporaryStash?.created) {
        const restoreResult = restoreMainCheckoutStash(temporaryStash as any);
      if (restoreResult.status !== 0) {
        reportStashPopFailure(slug, restoreResult, { rootDir: /** @type {any} */ (temporaryStash).rootDir });
        exitCode = 1;
      }
    }

    if (nextActionMessage) {
      fmt.log.info(`\n${nextActionMessage}`);
    }
    process.exit(exitCode);
  }
}

/** @param {string} slug @param{{baseBranch?: string|null, baseWorktree?: string|null, isForgejoReviewEnabledFn?: Function}} opts */
async function buildIntegrationContext(slug: string, {
  baseBranch = null,
  baseWorktree = null,
  isForgejoReviewEnabledFn = isForgejoReviewEnabled,
  getCurrentBranchFn = getCurrentBranch,
  readTokenFn = readToken,
  getPrStatusFn = getPrStatus,
  getLatestReviewDecisionFn = getLatestReviewDecision,
  readReviewStateFn = readReviewState,
  gitFn = git
}: {
  baseBranch?: string | null,
  baseWorktree?: string | null,
  isForgejoReviewEnabledFn?: Function,
  getCurrentBranchFn?: Function,
  readTokenFn?: Function,
  getPrStatusFn?: Function,
  getLatestReviewDecisionFn?: Function,
  readReviewStateFn?: Function,
  gitFn?: Function
} = {}) {
  if (!slug) {
    throw new Error('buildIntegrationContext requires a non-null mission slug.');
  }
  const branch = `mission/${slug}`;
  const currentBranch = getCurrentBranchFn();
  const missionDir = findMissionDir(slug);
  const area = missionDir ? findMissionArea(missionDir) : 'docs';

  // The mission integrates back into its recorded base branch/worktree. When no
  // base was recorded (every legacy mission) these resolve to the primary
  // branch/worktree, so the rest of integration is byte-identical to today.
  let resolvedBaseBranch: string | null = baseBranch;
  if (!resolvedBaseBranch) {
    try { resolvedBaseBranch = resolveMissionBaseBranch(slug, process.cwd()); } catch (_) { resolvedBaseBranch = getPrimaryBranch(); }
  }
  let resolvedBaseWorktree: string | null = baseWorktree;
  if (!resolvedBaseWorktree) {
    try { resolvedBaseWorktree = resolveBaseWorktree(slug, { rootDir: process.cwd() }); } catch (_) { resolvedBaseWorktree = getPrimaryWorktree(); }
  }
  // The primary integration checkout owns all authoritative Backlog task
  // metadata (task file, status, assignee). Mission worktrees can retain an
  // earlier status after primary records review approval, and Backlog.md is
  // unreliable at picking up worktree copies, so integration reads the base
  // worktree task file only — never the mission worktree as a fallback. If the
  // base worktree cannot supply the task, resolution fails rather than silently
  // trusting a stale mission copy.
  /** @type {ReturnType<typeof resolveTaskFile>} */
  const task = resolveTaskFile(slug, /** @type {string} */ (resolvedBaseWorktree));
  const taskStatus = task.ok ? getTaskStatus(task.taskFile as string) : null;
  const taskAssignee = task.ok ? getTaskAssignee(task.taskFile as string) : null;
  const forgejoEnabled = isForgejoReviewEnabledFn(/** @type {string} */ (resolvedBaseWorktree));
  
  let forgejoIdentity: {forgejoUser: string | null, warning: string | null} = { forgejoUser: null, warning: null };
  let forgejoToken: string | null = null;
  let pr: any = { exists: false };
  /** @type{any[]} */ let siblingPrs: any[] = [];
  let approval: any = { ok: false, error: 'forgejo-off', reviewState: null };

  if (forgejoEnabled) {
    forgejoIdentity = resolveForgejoUserForIntegration(taskAssignee);
    forgejoToken = readTokenFn(/** @type {any} */ (forgejoIdentity.forgejoUser || 'default'));
    pr = /** @type {any} */ (getPrStatusFn(branch, process.cwd(), {
      forgejoUser: /** @type {any} */ (forgejoIdentity.forgejoUser),
      token: forgejoToken
    }));
    if (pr.exists && pr.merged === true) {
      pr = { ...pr, state: 'merged' };
    }
    
    if (pr.exists && slug) {
      const baseSlugMatch = slug.match(/^(task-\d+)/i);
      const baseSlug = baseSlugMatch ? baseSlugMatch[1].toLowerCase() : slug;
      if (forgejoToken) {
        const allOpen = listOpenPrsForSlug(baseSlug, forgejoToken);
        siblingPrs = allOpen.filter(p => p.head !== branch);
      }
    }

    approval = pr.exists ? /** @type {any} */ (getLatestReviewDecisionFn(branch, {
      forgejoUser: /** @type {any} */ (forgejoIdentity.forgejoUser),
      token: /** @type {any} */ (forgejoToken)
    })) : /** @type {any} */ ({ ok: false, error: 'pr-missing', reviewState: undefined });
  }

  // Local review-state fallback: when forgejo token/API is unavailable but the
  // mission's Review shows approved, populate approval from local state
  // so that integrate can proceed without a live Forgejo connection.
  // Only applies when Forgejo was enabled but approval could not be obtained.
  if (forgejoEnabled && !approval.ok) {
    const localStateFallback = await Promise.resolve(readReviewStateFn(slug, /** @type {string} */ (resolvedBaseWorktree)));
    if (localStateFallback && localStateFallback.phase === 'approved' && localStateFallback.disposition === 'APPROVED') {
      approval = /** @type {any} */ ({ ok: true, reviewState: 'APPROVED', source: 'local-review-state' });
    }
  }
  
  const mainBranchResult = gitFn(['-C', /** @type {string} */ (resolvedBaseWorktree), 'branch', '--show-current']);
  const mainBranch = mainBranchResult.stdout.trim();
  const mainStatus = gitFn(['-C', /** @type {string} */ (resolvedBaseWorktree), 'status', '--short']);

  return {
    slug,
    branch,
    currentBranch,
    missionDir,
    area,
    task,
    taskStatus,
    taskAssignee,
    forgejoUser: forgejoIdentity.forgejoUser,
    forgejoToken,
    taskAssigneeWarning: forgejoIdentity.warning,
    pr,
    siblingPrs,
    approval,
    baseBranch: resolvedBaseBranch,
    baseWorktree: resolvedBaseWorktree,
    mainBranch,
    mainDirtyEntries: mainStatus.stdout.trim().length > 0
      ? mainStatus.stdout.trim().split('\n').filter(Boolean)
      : [],
    mainDirty: mainStatus.stdout.trim().length > 0
  };
}

/** @param {{slug: string, branch: string, currentBranch: string, missionDir?: string, area: string, task: {ok: boolean, taskFile?: string, reason?: string, matches?: string[]}, taskStatus?: string, taskAssignee?: string|null, forgejoUser?: string|null, forgejoToken?: string|null, taskAssigneeWarning?: string|null, pr: {exists?: boolean, state?: string, number?: number, merged?: boolean, raw?: string}, siblingPrs: any[], approval: {ok?: boolean, error?: string, reviewState?: string, defaultUserApproved?: boolean, source?: string}, baseBranch?: string, baseWorktree?: string, mainBranch: string, mainDirtyEntries: string[], mainDirty: boolean}} context */
function evaluateTaskStatusForIntegration(context: any) {
  const stateMapOptions = { rootDir: /** @type {string} */ (context.baseWorktree) };
  if (toVirtual(context.taskStatus, /** @type {any} */ (stateMapOptions)) === 'approved') {
    return {
      ok: true,
      level: 'pass',
      message: `Backlog status: approved`
    };
  }

  const reviewApproved = context.approval?.ok && context.approval.reviewState === 'APPROVED';
  const defaultUserApproved = context.approval?.ok && context.approval.defaultUserApproved === true;
  const localApproved = context.approval?.source === 'local-review-state';
  const prAlreadyMerged = context.pr?.state === 'merged';
  const reviewCanProceed = context.taskStatus === 'review' && (reviewApproved || localApproved);
  const defaultUserOverride = context.taskStatus === 'review' && !prAlreadyMerged && defaultUserApproved && context.approval.reviewState !== 'APPROVED';

  if (reviewCanProceed) {
    let reason;
    if (localApproved) {
      reason = 'local review-state: approved';
    } else {
      reason = `latest formal review state is ${context.approval.reviewState}`;
    }
    return {
      ok: true,
      level: 'warn',
      message: `Backlog status: review accepted for integration because ${reason}`
    };
  }

  if (defaultUserOverride) {
    return {
      ok: true,
      level: 'warn',
      message: `Backlog status: default user approved for integration despite ${context.approval.reviewState}`
    };
  }

  return {
    ok: false,
    level: 'fail',
    message: `Backlog status: expected approved, or review with an approved Forgejo PR; found ${toVirtual(context.taskStatus, stateMapOptions)}`
  };
}

/** @param {Function} log @param {string} slug @param {string} baseWorktree @param {string} baseBranch */
function printMergedPrRecoveryGuidance(log: Function, slug: string, baseWorktree: string, baseBranch: string) {
  log(fmt.status('INFO', 'Recovery: re-sync the local base branch, confirm the landed commit locally, then retry integrate.'));
  log(fmt.status('INFO', `  git -C ${baseWorktree} fetch --all --prune`));
  log(fmt.status('INFO', `  git -C ${baseWorktree} checkout ${baseBranch}`));
  log(fmt.status('INFO', `  git -C ${baseWorktree} pull --ff-only`));
  log(fmt.status('INFO', `  px integrate ${slug} --dry-run`));
}

/** @param {{slug: string, branch: string, currentBranch: string, missionDir?: string, area: string, task: {ok: boolean, taskFile?: string, reason?: string, matches?: string[]}, taskStatus?: string, taskAssignee?: string|null, forgejoUser?: string|null, forgejoToken?: string|null, taskAssigneeWarning?: string|null, pr: {exists?: boolean, state?: string, number?: number, merged?: boolean, raw?: string}, siblingPrs: any[], approval: {ok?: boolean, error?: string, reviewState?: string, defaultUserApproved?: boolean, source?: string}, baseBranch?: string, baseWorktree?: string, mainBranch: string, mainDirtyEntries: string[], mainDirty: boolean}} context */
async function promoteTaskForIntegrationIfNeeded(
  context: any,
  { dryRun = false, missionServicesFn }: { dryRun?: boolean, missionServicesFn?: Function } = {},
) {
  const taskStatusCheck = evaluateTaskStatusForIntegration(context);
  const needsPromotion = context.task?.ok && context.taskStatus === 'review' && taskStatusCheck.ok;

  if (!needsPromotion) {
    return { changed: false, dryRun: false };
  }

  if (dryRun) {
    fmt.log.info('Dry run: integration would promote Backlog status from review to approved because review is already fulfilled.');
    return { changed: false, dryRun: true };
  }

  // Promotion owns the Backlog representation only. It must NOT complete the
  // Mission: `integrate` maps `review -> done` in the state machine, and this
  // runs at Step 4, before the squash commit exists — so completing here made a
  // failed landing leave a `done` Mission (TASK-2369 defect 1). The single
  // completion owner is persistLandedIntegrationOrAbort(), after landing.
  //
  // The Mission is still read first, and fail-closed: an unreachable or missing
  // aggregate refuses the external Backlog effect rather than mutating a file
  // whose durable counterpart cannot be confirmed (architecture invariant).
  if (typeof missionServicesFn !== 'function') { throw new Error('integration promotion requires injected mission services'); }
  const missionServices = await missionServicesFn(context.baseWorktree || process.cwd());
  const missionLoad = await missionServices.store.load(missionId(context.slug));
  if (missionLoad.kind === 'unavailable') {
    fmt.log.fail(`Mission store unavailable: ${missionLoad.reason}. Refusing to promote the Backlog task.`);
    throw new IntegrationAbort();
  }
  if (missionLoad.kind === 'missing') {
    fmt.log.fail(`Mission ${missionId(context.slug)} not found in SQLite. Refusing to promote the Backlog task — file-only lifecycle state is not permitted after cutover.`);
    throw new IntegrationAbort();
  }

  // External boundary effect (Backlog promotion) after the durable state read.
  const stateMapOptions = { rootDir: /** @type {string} */ (context.baseWorktree) };
  const approvedStatus = toActual('approved', stateMapOptions) || 'approved';
  const baseTask = context.slug && context.baseWorktree
    ? resolveTaskFile(context.slug, context.baseWorktree)
    : context.task;
  if (!baseTask?.ok || !setTaskStatus(/** @type {string} */ (baseTask.taskFile || ''), approvedStatus)) {
    fmt.log.fail('Could not promote the Backlog task to approved before integration.');
    throw new IntegrationAbort();
  }

  context.taskStatus = toActual('approved', stateMapOptions);
  fmt.log.info('Promoted Backlog status from review to approved because review is already fulfilled.');

  return { changed: true, dryRun: false };
}

/**
 * @param{{slug: string, branch: string, missionDir?: string, area: string, task: {ok: boolean, taskFile?: string, reason?: string, matches?: string[]}, taskStatus?: string, taskAssignee?: string|null, forgejoUser?: string|null, forgejoToken?: string|null, taskAssigneeWarning?: string|null, pr: {exists?: boolean, state?: string, number?: number, merged?: boolean, raw?: string}, siblingPrs: any[], approval: {ok?: boolean, error?: string, reviewState?: string, defaultUserApproved?: boolean, source?: string}, baseBranch?: string, baseWorktree?: string, mainBranch: string, mainDirtyEntries: string[], mainDirty: boolean}} context
 */
function printIntegrationPreflight(
  context: any,
  {
    readTokenFn = readToken,
    resolveTokenFileFn = resolveTokenFile,
    detectRebaseStateFn = detectRebaseState,
    getUnresolvedIndexConflictsFn = getUnresolvedIndexConflicts,
    findMissionDocInBranchesFn = findMissionDocInBranches,
    isForgejoReviewEnabledFn = isForgejoReviewEnabled,
    log = fmt.log.plain
  } = {}
) {
  // A null/undefined slug means the caller failed to resolve a real mission
  // before building preflight context. Fail loudly here instead of letting
  // "null" leak into operator-facing branch/path expectations below.
  if (!context.slug) {
    throw new Error('printIntegrationPreflight requires a context with a non-null mission slug.');
  }

  const failures = [];
  const warnings = [];

  // The integration "checkout" is the mission's base worktree on its base branch.
  // For legacy missions these fall back to the primary worktree/branch, so the
  // preflight output and checks are byte-identical to today.
  const baseWorktree = context.baseWorktree || getPrimaryWorktree();
  const baseBranch = context.baseBranch || getPrimaryBranch();

  log(fmt.status('INFO', `Integration preflight for ${context.slug}`));

  const branchPrefix = missionBranchName(context.slug, baseWorktree);
  if ((/** @type {any} */ context).currentBranch === context.branch || (/** @type {any} */ context).currentBranch.startsWith(`${branchPrefix}-`)) {
    log(fmt.status('PASS', `Mission branch: ${(/** @type {any} */ context).currentBranch}`));
  } else {
    failures.push('branch');
    log(fmt.status('FAIL', `Mission branch: current branch is ${(/** @type {any} */ context).currentBranch}, expected ${context.branch} (or a branch with a suffix)`));
  }

  if (context.missionDir) {
    log(fmt.status('PASS', `Mission doc: ${path.join(context.missionDir, 'MISSION.md')}`));
  } else {
    failures.push('mission-doc');
    // Use the base slug (e.g. architecture migration) for the canonical path even when the
    // working slug carries a suffix (e.g. architecture migration-modern).
    const baseSlugMatch = context.slug.match(/^(task-\d+)/i);
    const canonicalSlug = baseSlugMatch ? baseSlugMatch[1].toLowerCase() : context.slug;
    const canonicalPath = path.relative(
      baseWorktree,
      path.join(missionDirForSlug(baseWorktree, canonicalSlug), 'MISSION.md')
    ).split(path.sep).join('/');
    log(fmt.status('FAIL', `Mission doc: ${canonicalPath} not found`));

    const candidates = findMissionDocInBranchesFn(context.slug, baseWorktree);
    if (candidates && candidates.length > 0) {
      log(fmt.status('INFO', `Found mission doc candidates on other branches. To recover, run:`));
      candidates.forEach(c => {
        log(fmt.status('INFO', `  git show ${c.branch}:${c.path} > ${canonicalPath}`));
      });
    }
  }

  if (context.task.ok) {
    log(fmt.status('PASS', `Backlog task: ${path.basename(/** @type {string} */ (context.task.taskFile))} (${context.taskStatus})`));
    
    try {
      const classification = getTaskClassification(/** @type {string} */ (context.task.taskFile));
      const classificationError = classification
        ? null
        : `Missing or invalid classification for ${context.slug}; expected exactly one of ai_sdlc, user_value, or unknown in the labels of ${context.task.taskFile}. Fix: add exactly one of those labels and do not use a separate frontmatter field for mission type.`;
      if (!classification) {
        failures.push('classification');
        log(fmt.status('FAIL', `Backlog classification: ${classificationError || 'missing'}`));
      } else {
        log(fmt.status('PASS', `Backlog classification: ${classification}`));
      }
    } catch (/** @type{any} */ error) {
      failures.push('classification');
      log(fmt.status('FAIL', `Backlog classification: ${(error as Error).message || String(error)}`));
    }

    const taskStatusCheck = evaluateTaskStatusForIntegration(context);
    if (!taskStatusCheck.ok) {
      failures.push('task-status');
      log(fmt.status('FAIL', `${taskStatusCheck.message}`));
    } else if (taskStatusCheck.level === 'warn') {
      warnings.push('task-status-review-approved');
      log(fmt.status('WARN', `${taskStatusCheck.message}`));
    } else {
      log(fmt.status('PASS', `${taskStatusCheck.message}`));
    }
  } else if (context.task.reason === 'ambiguous') {
    failures.push('task-ambiguity');
    log(fmt.status('FAIL', `Backlog task: ambiguous slug ${context.slug}`));
    if (context.task.matches) {
      context.task.matches.forEach((match: string) => log(`  - ${match}`));
    }
  } else {
    log(fmt.status('WARN', `Backlog task: no task file found for ${context.slug}; continuing with synthetic/unknown task metadata.`));
    log(fmt.status('PASS', 'Backlog classification: unknown'));
  }

  if (isForgejoReviewEnabledFn(baseWorktree)) {
    const localApproved = context.approval?.source === 'local-review-state';
    const localApprovalFallback = localApproved;

    if (context.pr.exists && context.pr.state === 'open') {
      log(fmt.status('PASS', `Forgejo PR: PR #${context.pr.number} open`));
      if (localApprovalFallback) {
        log(fmt.status('INFO', `Forgejo approval: token unavailable, approval sourced from the local Review (phase=approved)`));
      } else if (!context.approval.ok) {
        failures.push('pr-approval');
        log(fmt.status('FAIL', `Forgejo approval: could not verify an approved review (${context.approval.error})`));
      } else if (context.approval.reviewState !== 'APPROVED' && context.approval.defaultUserApproved !== true) {
        failures.push('pr-approval');
        log(fmt.status('FAIL', `Forgejo approval: latest formal review state is ${context.approval.reviewState || 'missing'}, expected APPROVED`));
      } else if (context.approval.reviewState !== 'APPROVED' && context.approval.defaultUserApproved === true) {
        warnings.push('pr-approval-default-user-override');
        log(fmt.status('WARN', `Forgejo approval: default user approved despite latest review state being ${context.approval.reviewState}`));
      } else {
        log(fmt.status('PASS', `Forgejo approval: latest formal review state is ${context.approval.reviewState}`));
      }
    } else if (context.pr.exists && context.pr.state === 'merged') {
      failures.push('pr-merged');
      log(fmt.status('FAIL', `Forgejo PR: PR #${context.pr.number} is already marked merged`));
      printMergedPrRecoveryGuidance(log, context.slug, baseWorktree, baseBranch);
    } else if (context.pr.exists) {
      failures.push('pr-state');
      log(fmt.status('FAIL', `Forgejo PR: unexpected state '${context.pr.state}'`));
    } else {
      failures.push('pr-missing');
      log(fmt.status('FAIL', `Forgejo PR: ${context.pr.raw || 'no PR found'}`));
    }

    if (context.siblingPrs && context.siblingPrs.length > 0) {
      warnings.push('sibling-prs');
      const baseSlugMatch = context.slug.match(/^(task-\d+)/i);
      const baseSlug = baseSlugMatch ? baseSlugMatch[1].toLowerCase() : context.slug;
      log(fmt.status('WARN', `Multiple open PRs detected for ${baseSlug}. Close stale PRs before integrating:`));
      context.siblingPrs.forEach((p: any) => {
        log(fmt.status('INFO', `  - PR #${p.number} (${p.head}): ${p.html_url}`));
      });
    }

    if (context.forgejoUser) {
      const tokenPath = resolveTokenFileFn(/** @type {string} */ (context.forgejoUser));
      const token = readTokenFn(/** @type {string} */ (context.forgejoUser));
      if (token) {
        log(fmt.status('PASS', `Forgejo token: resolved for ${context.forgejoUser} (${tokenPath || 'env:FORGEJO_TOKEN'})`));
      } else if (localApprovalFallback) {
        log(fmt.status('INFO', `Forgejo token: no token file found for ${context.forgejoUser} (approval sourced from the local Review)`));
      } else {
        failures.push('forgejo-token');
        log(fmt.status('FAIL', `Forgejo token: no token file found for ${context.forgejoUser}`));
      }
    } else if (!localApprovalFallback) {
      failures.push('forgejo-token');
      log(fmt.status('FAIL', 'Forgejo token: no forgejoUser configured'));
    }
  } else {
    log(fmt.status('INFO', 'Forgejo PR/approval checks skipped (review provider is not forgejo).'));
  }

  if (context.taskAssigneeWarning) {
    warnings.push('task-assignee');
    log(fmt.status('WARN', `${context.taskAssigneeWarning}`));
  }

  const expectedPrimaryBranch = baseBranch;
  if (context.mainBranch === expectedPrimaryBranch) {
    log(fmt.status('PASS', `Integration checkout branch: ${baseWorktree} is on ${expectedPrimaryBranch}`));
  } else {
    failures.push('main-branch');
    const branchLabel = context.mainBranch || '(detached HEAD)';
    log(fmt.status('FAIL', `Integration checkout branch: expected ${expectedPrimaryBranch}, found ${branchLabel}`));
    log(fmt.status('INFO', `Retry with: git -C ${baseWorktree} checkout ${expectedPrimaryBranch}`));
  }

  const rebaseState = detectRebaseStateFn(baseWorktree);
  if (rebaseState.inProgress) {
    failures.push('rebase-in-progress');
    log(fmt.status('FAIL', `Integration checkout rebase: rebase in progress in ${baseWorktree}`));
    if (rebaseState.rebaseHead) {
      log(fmt.status('INFO', `Current rebase head: ${rebaseState.rebaseHead}`));
    }
    if (rebaseState.unmergedFiles.length > 0) {
      rebaseState.unmergedFiles.forEach(file => log(fmt.status('INFO', `  - ${file}`)));
    }
    log(fmt.status('INFO', 'Finish or abort the existing rebase before retrying:'));
    log(fmt.status('INFO', `  git -C ${baseWorktree} rebase --continue`));
    log(fmt.status('INFO', `  git -C ${baseWorktree} rebase --abort`));
    log(fmt.status('INFO', `  git -C ${baseWorktree} rebase --skip`));
    log(fmt.status('INFO', `Retry with: px integrate ${context.slug} --dry-run`));
  }

  const indexConflicts = getUnresolvedIndexConflictsFn(baseWorktree);
  if (!indexConflicts.ok) {
    failures.push('main-index-conflict-check');
    log(fmt.status('FAIL', `Integration checkout conflict scan: could not inspect ${baseWorktree} (${indexConflicts.error || 'unknown error'})`));
  } else if (indexConflicts.files.length > 0) {
    failures.push('main-index-conflicts');
    log(fmt.status('FAIL', `Integration checkout conflicts: unresolved merge entries detected in ${baseWorktree}`));
    indexConflicts.files.forEach(file => log(fmt.status('INFO', `  - ${file}`)));
    log(fmt.status('INFO', 'Resolve each conflicted path, then drop the stale stash entry before retrying:'));
    indexConflicts.files.forEach(file => {
      log(fmt.status('INFO', `  git -C ${baseWorktree} rm "${file}"`));
      log(fmt.status('INFO', `  git -C ${baseWorktree} add "${file}"`));
    });
    log(fmt.status('INFO', `  git -C ${baseWorktree} stash drop`));
    log(fmt.status('INFO', `Retry with: px integrate ${context.slug} --dry-run`));
  } else {
    log(fmt.status('PASS', 'Integration checkout conflicts: no unresolved merge entries in the git index'));
  }

  if (context.mainDirty) {
    // Detect dirty paths that overlap with files integrate mutates during closeout.
    // Broad overlap set: any dirty path under backlog/tasks/ or backlog/completed/
    // triggers FAIL, because closeout logic (completeTask, reorder/ordinal writes)
    // can touch backlog files beyond the current mission's own slug.
    // Editor swap files, .env, etc. are excluded by the path prefix check.
    // Mission doc paths remain scoped to the current mission's slug.
    const overlapPaths: string[] = [];
    if (context.missionDir) {
      const relMissionPath = path.relative(baseWorktree, context.missionDir);
      overlapPaths.push(relMissionPath);
    }
    overlapPaths.push(`missions/${context.slug}`);

    const overlappingEntries: string[] = [];
    const nonOverlappingEntries: string[] = [];

    context.mainDirtyEntries.forEach((entry: string) => {
      // Extract the file path from git status --porcelain format (columns 3+)
      const filePath = entry.slice(3).trim();
      if (!filePath) {
        return;
      }

      let isOverlap = false;

      // Any dirty path under backlog/tasks/ or backlog/completed/ overlaps
      // with files integrate mutates during closeout (completeTask, reorder).
      if (/^backlog\/(tasks|completed)\//.test(filePath)) {
        isOverlap = true;
      }

      // Check against mission doc paths (scoped to current mission)
      if (!isOverlap) {
        for (const mp of overlapPaths) {
          if (mp && (filePath === mp || filePath.startsWith(mp + path.sep) || filePath.startsWith(mp + '/'))) {
            isOverlap = true;
            break;
          }
        }
      }

      if (isOverlap) {
        overlappingEntries.push(entry);
      } else {
        nonOverlappingEntries.push(entry);
      }
    });

    if (overlappingEntries.length > 0) {
      // Upgrade to FAIL — overlapping dirty paths will collide with closeout mutations
      failures.push('main-dirty-overlap');
      fmt.log.fail(`[STASH] Integration checkout dirty: overlapping paths detected that collide with integrate closeout.`);
      overlappingEntries.forEach((entry: string) => log(fmt.status('WARN', `  - ${entry}`)));
      fmt.log.fail('Recovery steps:');
      fmt.log.fail(`  1. Commit or discard the overlapping changes in ${baseWorktree}`);
      fmt.log.fail(`     git -C ${baseWorktree} add ${overlappingEntries.map(e => `"${e.slice(3).trim()}"`).join(' ')}`);
      fmt.log.fail(`  2. Retry: px integrate ${context.slug} --dry-run`);
    } else if (nonOverlappingEntries.length > 0) {
      // Non-overlapping dirty paths are safe to stash and restore
      warnings.push('main-dirty');
      fmt.log.warn(`[STASH] Integration checkout dirty: ${baseWorktree} has uncommitted changes that will be stashed temporarily`);
      nonOverlappingEntries.forEach((entry: string) => log(fmt.status('INFO', `  - ${entry}`)));
    } else {
      log(fmt.status('PASS', 'Integration checkout dirty state: clean'));
    }
  } else {
    log(fmt.status('PASS', 'Integration checkout dirty state: clean'));
  }

  const gitDir = path.join(process.cwd(), '.git');
  const isMainRepo = fs.existsSync(gitDir) && !fs.lstatSync(gitDir).isSymbolicLink();
  const isCorrectPath = process.cwd() === baseWorktree;
  if (isMainRepo && isCorrectPath) {
    log(fmt.status('PASS', 'Backlog context: resolves to main repository'));
  } else {
    warnings.push('backlog-context');
    log(fmt.status('WARN', `Backlog context: does not resolve to ${baseWorktree}. (Ignore if running from worktree to test dry-run; post-squash closeout still requires the local integration checkout).`));
  }

  log(fmt.status('INFO', 'Forgejo configuration: allow_manual_merge assumed enabled'));

  if (warnings.length > 0) {
    log(fmt.status('WARN', `Integration warnings: ${warnings.join(', ')}`));
  }

  log(fmt.status('INFO', `${VARIANT_B_AUTOMATION_SUMMARY}`));

  return { failures, warnings };
}

/** @param {string} taskFilePath @param {string} slug @param{{rootDir?: string}} options */
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
