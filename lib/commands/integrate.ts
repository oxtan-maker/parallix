import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import child_process from 'node:child_process';
import { detectRebaseState, git, getCurrentBranch, run } from '../core/git.js';
import { resolveTaskFile, getTaskStatus, setTaskStatus, completeTask, getTaskAssignee } from '../tools/backlog.js';
import { toVirtual, toActual } from '../core/state-map.js';
import { getPrStatus, getLatestReviewDecision, syncMerged, readToken, resolveTokenFile, resolveForgejoUser, resolveForgejoHome, isForgejoPath, listOpenPrsForSlug } from '../tools/forgejo.js';
import * as fmt from '../core/fmt.js';

import { buildAutonomousReviewMatrix, formatMatrixSummary } from '../core/runtime-matrix.js';
import { findMissionDir, resolveWorktree, findMissionArea, missionTitle, parseConflictFilesFromMergeOutput, getConflictFiles, inferSlug, updateGraphifyKnowledgeGraph, getPrimaryWorktree, getPrimaryBranch, conventionalWorktreePath, softResetTrailingBacklogNoise, findMissionDocInBranches, missionBranchName, missionDirForSlug, isMissionArtifact, resolveMissionBaseBranch, resolveBaseWorktree } from '../core/mission-utils.js';
// @ts-expect-error stats.js is still CJS, no declarations available
import stats from './stats.js';
import * as verification from '../core/verification.js';
const { formatVerificationCommand } = verification;
import { isForgejoReviewEnabled } from '../core/product-config.js';
import { readReviewState } from '../review/review-state.js';

const VARIANT_B_AUTOMATION_SUMMARY = 'Variant B automation: Backlog task closeout, worktree-path rewrite, squash commit with hook-enforced validation, Forgejo sync-merged, and mission worktree cleanup.';

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
    startMessage: `Updating graphify knowledge graph on ${getPrimaryBranch()}...`,
    failureHint: 'Continuing without blocking integration.'
  });
}

/** @param {string} rootDir @param {{gitRunner?: Function}} opts */
function prepareNoisePatchForSquash(rootDir: string, opts: {gitRunner?: Function} = {}) {
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

  const patchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'parallix-integrate-noise-'));
  const patchPath = path.join(patchDir, 'backlog-noise.patch');
  fs.writeFileSync(patchPath, patch, 'utf8');

  const resetResult = runner(['-C', rootDir, 'reset', '--hard', 'HEAD']);
  if (resetResult.status !== 0) {
    return {
      ok: false,
      patchPath,
      error: [resetResult.stdout, resetResult.stderr].filter(Boolean).join('\n').trim() || 'Could not restore a clean checkout after capturing backlog-noise patch.'
    };
  }

  return {
    ok: true,
    patchPath,
    cleanup: () => fs.rmSync(patchDir, { recursive: true, force: true })
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

  fmt.log.fail('Could not restore the temporarily stashed local integration checkout changes.');
  if (integrationLanded) {
    fmt.log.fail(`Integration commit landed: ${headLine}`);
  } else {
    fmt.log.fail(`Integration landing not confirmed by HEAD: ${headLine}`);
  }

  if (indexConflicts.ok && indexConflicts.files.length > 0) {
    fmt.log.fail('Stash restore failure type: merge-conflict');
    indexConflicts.files.forEach((file: string) => fmt.log.fail(`  - ${file}`));
    fmt.log.fail('Recovery steps:');
    fmt.log.fail(`  1. cd ${rootDir}`);
    indexConflicts.files.forEach((file: string) => {
      fmt.log.fail(`  2. Resolve ${file}, then run git add "${file}" or git rm "${file}"`);
    });
    fmt.log.fail('  3. git status --short');
    fmt.log.fail('  4. git stash drop');
  } else {
    fmt.log.fail('Stash restore failure type: file-collision');
    if (collisionFiles.length > 0) {
      collisionFiles.forEach((file: string) => fmt.log.fail(`  - ${file}`));
    }
    fmt.log.fail('Recovery steps:');
    fmt.log.fail(`  1. git -C ${rootDir} stash show --name-only stash@{0}`);
    if (collisionFiles.length > 0) {
      collisionFiles.forEach((file: string) => {
        fmt.log.fail(`  2. mv ${path.join(rootDir, file)} ${path.join(rootDir, `${file}.pre-stash-pop`)}`);
      });
      fmt.log.fail(`  3. git -C ${rootDir} stash pop`);
    } else {
      fmt.log.fail(`  2. Inspect the latest stash-pop output and move or remove the colliding files in ${rootDir}`);
      fmt.log.fail(`  3. git -C ${rootDir} stash pop`);
    }
  }

  if (output) {
    fmt.log.fail('stash pop output:');
    fmt.log.fail(output);
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

// Integration gates support
const INTEGRATION_CONFIG_PATH = path.join(getPrimaryWorktree(), 'config', 'integration-pipelines.json');

/**
 * Detect which top-level areas have been modified in the mission branch vs primary branch
 * Returns an array of area names (e.g., ['server', 'auth-server', 'web-client'])
 */
/** @param {string} slug @param {{gitRunner?: Function, rootDir?: string, baseBranch?: string|null}} opts */
function detectChangedAreas(slug: string, opts: {gitRunner?: Function, rootDir?: string, baseBranch?: string | null} = {}) {
  const primaryBranch = opts.baseBranch || getPrimaryBranch();
  const branch = `mission/${slug}`;
  const runner = (opts.gitRunner || git) as Function;

  // Get changed files between primary branch and mission branch
  const diffResult = runner(['-C', opts.rootDir || getPrimaryWorktree(), 'diff', '--name-only', primaryBranch, branch, '--']);
  
  if (diffResult.status !== 0 && !diffResult.stdout.trim()) {
    // No changes or error - fall back to checking against HEAD in the worktree
    const worktree = resolveWorktree(slug) || conventionalWorktreePath(slug, opts.rootDir);
    if (fs.existsSync(worktree)) {
      const worktreeDiff = runner(['-C', worktree, 'diff', '--name-only', primaryBranch, 'HEAD', '--']);
      if (worktreeDiff.status === 0 && worktreeDiff.stdout.trim()) {
        return parseFilesToAreas(worktreeDiff.stdout);
      }
    }
    return [];
  }
  
  return parseFilesToAreas(diffResult.stdout);
}

/**
 * Parse a list of files (one per line) and extract the top-level area directories
 */
/** @param {string} filesOutput */
function parseFilesToAreas(filesOutput: string) {
  const areas = new Set();
  const knownAreas = ['lib', 'server', 'auth-server', 'web-client', 'docs', 'workflow', 'android', 'kubernetes'];
  
  filesOutput.split('\n').forEach((file: string) => {
    file = file.trim();
    if (!file) {return;}
    const topDir = file.split('/')[0];
    if (knownAreas.includes(topDir)) {
      areas.add(topDir);
    }
  });
  
  return Array.from(areas);
}

/**
 * Load integration pipelines config from repo-side file
 */
/** @param {{configPath?: string}} opts */
function loadIntegrationConfig(opts: {configPath?: string} = {}) {
  const configPath = opts.configPath || INTEGRATION_CONFIG_PATH;
  if (!fs.existsSync(configPath) || !fs.statSync(configPath).size) {
    return { ok: false, error: 'no config present' };
  }
  
  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(content);
    return { ok: true, config };
  } catch (/** @type{any} */ error: any) {
    return { ok: false, error: `invalid JSON: ${error.message}` };
  }
}

/**
 * Get the integration gate plan for changed areas
 * Returns { gates: [{key, command, run_last}], changedAreas: [...] }
 */
/** @param {string} slug @param {{runIntegrationGates?: boolean, gitRunner?: Function, dryRun?: boolean, configPath?: string}} opts */
function getIntegrationGatePlan(slug: string, opts: {runIntegrationGates?: boolean, gitRunner?: Function, dryRun?: boolean, configPath?: string} = {}) {
  // Check config
  const configResult = loadIntegrationConfig(opts);
  if (!configResult.ok) {
    if (opts.runIntegrationGates) {
      fmt.log.info(`integration-gates: ${configResult.error}, skipping`);
    }
    return { gates: [], changedAreas: [], configError: configResult.error };
  }
  
  const config = configResult.config;
  if (!config.gates || Object.keys(config.gates).length === 0) {
    if (opts.runIntegrationGates) {
      fmt.log.info('integration-gates: no gates defined in config, skipping');
    }
    return { gates: [], changedAreas: [], configError: 'no gates defined' };
  }
  
  // Detect changed areas (always detect for dry-run; for real run, detect only if runIntegrationGates)
  const changedAreas = (opts.runIntegrationGates || opts.dryRun) ? detectChangedAreas(slug, opts) : [];
  
  if (opts.runIntegrationGates && !opts.dryRun && changedAreas.length === 0) {
    fmt.log.info('integration-gates: no area changes detected, skipping');
    return { gates: [], changedAreas: [], configError: null };
  }
  
  // Build list of gates to run, preserving order with run_last handling
  const gateEntries = Object.entries(config.gates);
  const gates = gateEntries
    .map(([key, value]: [string, any]) => ({
      key,
      command: value.command,
      order: value.order || 0,
      run_last: value.run_last || false
    }));
  
  // Separate into run_last and non-run_last, sort each by order
  const nonRunLast = gates.filter(g => !g.run_last).sort((a, b) => a.order - b.order);
  const runLastGates = gates.filter(g => g.run_last).sort((a, b) => a.order - b.order);
  
  // Combine: non-run_last first (by order), then run_last (by order)
  const orderedGates = [...nonRunLast, ...runLastGates];
  
  // Filter to only relevant gates (based on changed areas)
  const relevantGates = [];
  for (const gate of orderedGates) {
    // Always include web-e2e if web-client changed
    if (gate.key === 'web-e2e') {
      if (changedAreas.includes('web-client') || changedAreas.length === 0) {
        relevantGates.push(gate);
      }
    } else if (changedAreas.includes(gate.key) || changedAreas.length === 0) {
      relevantGates.push(gate);
    }
  }
  
  return { gates: relevantGates, changedAreas, configError: null };
}

/**
 * Print the integration gate plan (for --dry-run)
 */
/** @param{{key: string, command: string, order: number, run_last: boolean}[]} gates */
function printIntegrationGatePlan(gates: any) {
  fmt.log.info('Integration gate plan:');
  for (const gate of gates) {
    fmt.log.info(`  ${gate.key}: ${gate.command}`);
  }
}

/**
 * @param {string} slug
 * @param {{dryRun?: boolean, processEnv?: NodeJS.ProcessEnv, gitRunner?: Function, baseBranch?: string|null, baseWorktree?: string|null}} opts
 */
function buildIntegrationGateEnv(slug: string, opts: {dryRun?: boolean, processEnv?: NodeJS.ProcessEnv, gitRunner?: Function, baseBranch?: string | null, baseWorktree?: string | null} = {}) {
  /** @type {{[key: string]: string | undefined}} */
  const env = /** @type {{[key: string]: string | undefined}} */ ({
    ...opts.processEnv,
    INTEGRATE_DRY_RUN: opts.dryRun ? 'true' : 'false',
    INTEGRATE_CHANGED_AREAS: detectChangedAreas(slug, {
      gitRunner: opts.gitRunner,
      baseBranch: opts.baseBranch,
      ...(opts.baseWorktree ? { rootDir: opts.baseWorktree } : {})
    }).join(' ')
  });

  // Integration must always use the repo-side config, but the changed-area set
  // should be the one resolved for this mission branch, not rediscovered later.
  delete (env as any).INTEGRATION_CONFIG_PATH;
  return env;
}

/**
 * @param {string} slug
 * @param {{baseWorktree?: string, resolveWorktreeFn?: Function, conventionalWorktreePathFn?: Function}} opts
 */
function resolveIntegrationVerificationWorktree(slug: string, opts: {baseWorktree?: string, resolveWorktreeFn?: Function, conventionalWorktreePathFn?: Function} = {}) {
  const resolveFn = (opts.resolveWorktreeFn || resolveWorktree) as Function;
  const convFn = (opts.conventionalWorktreePathFn || conventionalWorktreePath) as Function;
  return resolveFn(slug, { cwd: opts.baseWorktree })
    || convFn(slug, opts.baseWorktree);
}

/**
 * @param {string} slug
 * @param {{baseWorktree?: string, resolveWorktreeFn?: Function, conventionalWorktreePathFn?: Function, formatVerificationCommandFn?: Function}} opts
 */
function buildIntegrationVerificationInvocation(slug: string, opts: {baseWorktree?: string, resolveWorktreeFn?: Function, conventionalWorktreePathFn?: Function, formatVerificationCommandFn?: Function} = {}) {
  const cwd = resolveIntegrationVerificationWorktree(slug, opts);
  const fmtFn = (opts.formatVerificationCommandFn || formatVerificationCommand) as Function;
  return {
    command: fmtFn('integrate', cwd),
    cwd
  };
}

/**
 * Execute integration gates, aborting on first failure
 * Returns { ok: boolean, failedGate: string|null, error: string|null }
 */
/**
 * @param {{key: string, command: string, order: number, run_last: boolean}[]} gates
 * @param {{commandRunner?: Function, rootDir?: string}} opts
 */
async function executeIntegrationGates(gates: any, opts: {commandRunner?: Function, rootDir?: string} = {}) {
  const runner = (opts.commandRunner || ((/** @type{string} */ cmd: string) => child_process.spawnSync(cmd, {
      shell: true,
      cwd: opts.rootDir || getPrimaryWorktree(),
      stdio: 'inherit'
    }))) as Function;
  
  for (const gate of gates) {
    fmt.log.info(`Running integration gate: ${gate.key}...`);
    fmt.log.info(`  Command: ${gate.command}`);
    
    // Execute the command using the injected runner
    const result = runner(gate.command, [], { cwd: opts.rootDir, stdio: 'inherit' });
    
    if (result.status !== 0) {
      fmt.log.fail(`Integration gate failed: ${gate.key}`);
      fmt.log.fail(`  Command: ${gate.command}`);
      fmt.log.fail(`  Exit code: ${result.status}`);
      return { ok: false, failedGate: gate.key, error: `Command exited with code ${result.status}` };
    }
    
    fmt.log.pass(`Integration gate passed: ${gate.key}`);
  }
  
  return { ok: true, failedGate: null, error: null };
}

interface IntegrateFn extends Function {
  resolveConflictsForMission: typeof resolveConflictsForMission;
  cleanupMissionWorktree: typeof cleanupMissionWorktree;
  rewriteWorktreePaths: typeof rewriteWorktreePaths;
  finalizeVariantACloseout: typeof finalizeVariantACloseout;
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
  formatRecordedStatsRow: typeof formatRecordedStatsRow;
  detectChangedAreas: typeof detectChangedAreas;
  parseFilesToAreas: typeof parseFilesToAreas;
  loadIntegrationConfig: typeof loadIntegrationConfig;
  getIntegrationGatePlan: typeof getIntegrationGatePlan;
  printIntegrationGatePlan: typeof printIntegrationGatePlan;
  buildIntegrationGateEnv: typeof buildIntegrationGateEnv;
  resolveIntegrationVerificationWorktree: typeof resolveIntegrationVerificationWorktree;
  buildIntegrationVerificationInvocation: typeof buildIntegrationVerificationInvocation;
  executeIntegrationGates: typeof executeIntegrationGates;
  buildIntegrationContext: typeof buildIntegrationContext;
  getPrimaryWorktree: typeof getPrimaryWorktree;
}

/** @param {string[]} args */
async function integrate(args: string[]) {
  let exitCode = 0;
  /** @type{{created?: boolean, message?: string, rootDir?: string}|null} */
  let temporaryStash = null;
  let nextActionMessage = null;
  const flags = args.filter((arg: string) => arg.startsWith('--'));
  const params = args.filter((arg: string) => !arg.startsWith('--'));
  const explicitSlug = params[0];
  const slug = inferSlug(explicitSlug);
  const dryRun = flags.includes('--dry-run');
  const noIntegrationGates = flags.includes('--no-integration-gates');

  /** @type {{slug: string, branch: string, currentBranch: string, missionDir?: string, area: string, task: {ok: boolean, taskFile?: string, reason?: string, matches?: string[]}, taskStatus?: string, taskAssignee?: string|null, forgejoUser?: string|null, forgejoToken?: string|null, taskAssigneeWarning?: string|null, pr: {exists?: boolean, state?: string, number?: number, merged?: boolean, raw?: string}, siblingPrs: any[], approval: {ok?: boolean, error?: string, reviewState?: string, defaultUserApproved?: boolean, source?: string}, baseBranch?: string, baseWorktree?: string, mainBranch: string, mainDirtyEntries: string[], mainDirty: boolean}} */
  let context;

  if (process.env.FORGEJO_USER === 'gemini' || process.env.WORKFLOW_AGENT === 'gemini') {
    fmt.log.fail('Gemini is not authorized to run integrate. Post a handoff comment on the PR and stop.');
    process.exit(1);
  }

  if (!slug) {
    fmt.log.fail('Usage: px integrate [<slug>] [--dry-run] [--no-integration-gates]');
    process.exit(1);
  }

    if (flags.includes('--no-gate')) {
      fmt.log.warn('integrate ignores --no-gate. The landed squash commit relies on the local git hooks for validation.');
    }

    try {
      const executionDir = process.cwd();
      context = buildIntegrationContext(slug);
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
        const env = buildIntegrationGateEnv(slug, { dryRun, baseBranch, baseWorktree });
        
        if (dryRun) {
          fmt.log.info('Running integration gates (dry-run)...');
        } else {
          fmt.log.info('Running integration gates...');
        }
        
        const result = child_process.spawnSync('bash', ['-lc', verification.command], {
          cwd: verification.cwd,
          env,
          stdio: 'inherit'
        });
        
        if (result.status !== 0) {
          fmt.log.fail(`\nIntegration gates failed with exit code ${result.status}`);
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
        promoteTaskForIntegrationIfNeeded(context, { dryRun: true });
        fmt.log.pass('\nDry run complete. Integration preflight passed.');
        return;
      }

      promoteTaskForIntegrationIfNeeded(context);

      temporaryStash = stashMainCheckoutIfNeeded({
        slug,
        dirtyEntries: context.mainDirtyEntries as string[],
        rootDir: /** @type{string} */(baseWorktree) as string
      });

      if (dryRun) {
      promoteTaskForIntegrationIfNeeded(context, { dryRun: true });
      fmt.log.pass('\nDry run complete. Integration preflight passed.');
      return;
    }

    promoteTaskForIntegrationIfNeeded(context);

    temporaryStash = stashMainCheckoutIfNeeded({
      slug,
      dirtyEntries: context.mainDirtyEntries as string[],
      rootDir: baseWorktree as string
    });

    // End-context check: if we are in the worktree that is about to be deleted,
    // move the Node process to the base worktree to avoid being left in a ghost directory.
    const missionWorktree = conventionalWorktreePath(slug);
    if (process.cwd() === missionWorktree || process.cwd().startsWith(missionWorktree + '/')) {
      fmt.log.info(`Moving process directory to ${baseWorktree} before mission worktree deletion.`);
      process.chdir(baseWorktree as string);
    }

    // Variant Selection
    const branch = missionBranchName(slug, baseWorktree);
    const mainTitle = missionTitle(slug) || slug;
    const summary = mainTitle.replace(/\s+/g, ' ').trim();
    const mainTaskFile = (context.task.taskFile as string).replace(executionDir, baseWorktree as string);
    const useVariantA = context.pr.merged;
    fmt.log.info(`Selecting integration variant: ${useVariantA ? 'Variant A (fast-path)' : 'Variant B (full squash-merge)'}`);

    if (useVariantA) {
      fmt.log.info(`Variant A: already merged on Forgejo; syncing local ${baseBranch} in base worktree ${baseWorktree} for closeout.`);
      const closeoutResult = finalizeVariantACloseout({
        slug,
        summary,
        mainTaskFile,
        rootDir: baseWorktree,
        baseBranch
      });
      if (!closeoutResult.ok) {
        fmt.log.fail(`Variant A closeout failed (${closeoutResult.error}).`);
        if (closeoutResult.detail) {
          fmt.log.fail(closeoutResult.detail);
        }
        if (closeoutResult.error === 'commit-failed') {
          fmt.log.info(`The closeout commit runs the repo git hooks. Fix the reported hook failure in ${baseWorktree} and retry integrate.`);
          fmt.log.info(`For this mission, the relevant verification command is ${formatVerificationCommand(context.area, baseWorktree)}`);
        }
        throw new IntegrationAbort();
      }
      if (fs.existsSync(baseWorktree)) {
        nextActionMessage = `Next: cd ${baseWorktree}`;
      }
      recordPostIntegrationStatsOrAbort(slug, { rootDir: baseWorktree });
      if (!cleanupMissionWorktree(slug)) {
        fmt.log.fail('Mission worktree cleanup failed for Variant A.');
        throw new IntegrationAbort();
      }
      maybeUpdateGraphifyOnPrimary(baseWorktree);
      fmt.log.pass('Variant A integration completed.');
    } else {
      fmt.log.info(`\nStep 1: Using base worktree ${baseWorktree} on ${baseBranch} as the squash-merge target...`);

      fmt.log.info(`Step 2: Checking merge conflicts against local ${baseBranch} in the base worktree...`);
      const dryMerge = git(['-C', baseWorktree, 'merge', '--no-commit', '--no-ff', branch]);
      const abortResult = git(['-C', baseWorktree, 'merge', '--abort']);
      if (abortResult.status !== 0 && !isNoMergeToAbortResult(abortResult)) {
        fmt.log.fail('Dry-run merge could not be aborted cleanly. Inspect the local integration checkout before retrying integrate.');
        throw new IntegrationAbort();
      }
      if (dryMerge.status !== 0) {
        // Before failing, check if a squash commit for this mission already landed on the primary branch
        // from a previous partial integration run (e.g. sync-merged failed after the commit was created).
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
          recordPostIntegrationStatsOrAbort(slug, { rootDir: baseWorktree });
          fmt.log.info('Step 7 (resume): Cleaning up the local mission worktree...');
          if (!cleanupMissionWorktree(slug)) {
            fmt.log.fail('Mission worktree cleanup failed.');
            throw new IntegrationAbort();
          }
          maybeUpdateGraphifyOnPrimary(baseWorktree);
          fmt.log.pass('Integration completed successfully (resumed from partial state).');
        } else {
          fmt.log.fail('Merge conflicts detected. Rebase the mission branch before integrating.');
          const conflictOutput = [/** @type {any} */ (dryMerge).stdout, /** @type {any} */ (dryMerge).stderr].filter(Boolean).join('\n');
          const conflictFiles = parseConflictFilesFromMergeOutput(conflictOutput);
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

        fmt.log.info('Step 4: Final closeout checks in the local integration checkout...');
        if (fs.existsSync(mainTaskFile)) {
          completeTask(slug, baseWorktree);
          // Re-resolve because it moved
          const updatedResolution = resolveTaskFile(slug, baseWorktree);
          if (updatedResolution.ok) {
            rewriteWorktreePaths(updatedResolution.taskFile as string, slug, { rootDir: baseWorktree });
          }
        }

        git(['-C', baseWorktree, 'add', '-A']);
        fmt.log.info('Step 5: Creating the landed squash commit in the local integration checkout...');
        const commitResult = git([
          '-C',
          /** @type {string} */ (baseWorktree),
          'commit',
          '-m',
          `${branch}: ${summary}`
        ]);
        if (commitResult.status !== 0) {
          const output = [commitResult.stdout, commitResult.stderr].filter(Boolean).join('\n').trim();
          fmt.log.fail('Could not create the squash commit in the local integration checkout.');
          if (output) {
            fmt.log.fail(output);
          }
          fmt.log.info(`The squash commit runs the repo git hooks. Fix the reported hook failure in ${baseWorktree} and retry integrate.`);
          fmt.log.info(`For this mission, the relevant verification command is ${formatVerificationCommand(context.area, baseWorktree)}`);
          throw new IntegrationAbort();
        }
        const proofResult = verification.captureVerifiedTreeProof(context.area, baseWorktree, {
          gitRunner: git,
          runFn: /** @type {Function} */ (child_process.spawnSync)
        });
        if (!/** @type {any} */ (proofResult).ok) {
          fmt.log.fail(`Could not verify the exact tree being published: ${/** @type {any} */ (proofResult).error}`);
          throw new IntegrationAbort();
        }
        const proof = /** @type {any} */ (proofResult).proof;
        const mergedCommit = git(['-C', baseWorktree, 'rev-parse', 'HEAD']).stdout.trim();
        const proofCheck = verification.assertVerifiedTreeProof(proof!, baseWorktree, { gitRunner: git });
        if (!proofCheck.ok) {
          fmt.log.fail(`Verification proof is stale for the publish tree: ${/** @type {any} */ (proofCheck).error}`);
          throw new IntegrationAbort();
        }

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
        recordPostIntegrationStatsOrAbort(slug, { rootDir: baseWorktree });
        fmt.log.info('Step 7: Cleaning up the local mission worktree...');
        if (!cleanupMissionWorktree(slug)) {
          fmt.log.fail('Mission worktree cleanup failed.');
          throw new IntegrationAbort();
        }

        maybeUpdateGraphifyOnPrimary(baseWorktree);
        fmt.log.pass('Integration completed successfully.');
      }
    }
  } catch (error) {
    if (error instanceof IntegrationAbort) {
      exitCode = 1;
    } else {
      throw /** @type {any} */ (error);
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
function buildIntegrationContext(slug: string, {
  baseBranch = null,
  baseWorktree = null,
  isForgejoReviewEnabledFn = isForgejoReviewEnabled
}: {baseBranch?: string | null, baseWorktree?: string | null, isForgejoReviewEnabledFn?: Function} = {}) {
  const branch = `mission/${slug}`;
  const currentBranch = getCurrentBranch();
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
  let task = resolveTaskFile(slug);
  if (!task.ok) {
    const worktree = resolveWorktree(slug);
    if (worktree) {task = resolveTaskFile(slug, worktree);}
  }
  let taskStatus = task.ok ? getTaskStatus(task.taskFile as string) : null;
  if (task.ok && taskStatus === 'backlog') {
    const worktree = resolveWorktree(slug);
    if (worktree) {
      const wtTask = resolveTaskFile(slug, worktree);
      if (wtTask.ok) {
        const wtStatus = getTaskStatus(wtTask.taskFile as string);
        if (wtStatus && wtStatus !== 'backlog') {
          task = wtTask;
          taskStatus = wtStatus;
        }
      }
    }
  }
  const taskAssignee = task.ok ? getTaskAssignee(task.taskFile as string) : null;
  const forgejoEnabled = isForgejoReviewEnabledFn(/** @type {string} */ (resolvedBaseWorktree));
  
  let forgejoIdentity: {forgejoUser: string | null, warning: string | null} = { forgejoUser: null, warning: null };
  let forgejoToken: string | null = null;
  let pr: any = { exists: false };
  /** @type{any[]} */ let siblingPrs: any[] = [];
  let approval: any = { ok: false, error: 'forgejo-off', reviewState: null };

  if (forgejoEnabled) {
    forgejoIdentity = resolveForgejoUserForIntegration(taskAssignee);
    forgejoToken = readToken(/** @type {any} */ (forgejoIdentity.forgejoUser || 'default'));
    pr = /** @type {any} */ (getPrStatus(branch, process.cwd(), {
      forgejoUser: /** @type {any} */ (forgejoIdentity.forgejoUser),
      token: forgejoToken
    }));
    
    if (pr.exists && slug) {
      const baseSlugMatch = slug.match(/^(task-\d+)/i);
      const baseSlug = baseSlugMatch ? baseSlugMatch[1].toLowerCase() : slug;
      if (forgejoToken) {
        const allOpen = listOpenPrsForSlug(baseSlug, forgejoToken);
        siblingPrs = allOpen.filter(p => p.head !== branch);
      }
    }

    approval = pr.exists ? /** @type {any} */ (getLatestReviewDecision(branch, {
      forgejoUser: /** @type {any} */ (forgejoIdentity.forgejoUser),
      token: /** @type {any} */ (forgejoToken)
    })) : /** @type {any} */ ({ ok: false, error: 'pr-missing', reviewState: undefined });
  }

  // Local review-state fallback: when forgejo token/API is unavailable but the
  // mission's review-state.json shows approved, populate approval from local state
  // so that integrate can proceed without a live Forgejo connection.
  // Only applies when Forgejo was enabled but approval could not be obtained.
  if (forgejoEnabled && !approval.ok) {
    const localStateFallback = readReviewState(slug, /** @type {string} */ (resolvedBaseWorktree));
    if (localStateFallback && localStateFallback.phase === 'approved' && localStateFallback.disposition === 'APPROVED') {
      approval = /** @type {any} */ ({ ok: true, reviewState: 'APPROVED', source: 'local-review-state' });
    }
  }
  
  const mainBranchResult = git(['-C', /** @type {string} */ (resolvedBaseWorktree), 'branch', '--show-current']);
  const mainBranch = mainBranchResult.stdout.trim();
  const mainStatus = git(['-C', /** @type {string} */ (resolvedBaseWorktree), 'status', '--short']);

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
  const reviewCanProceed = context.taskStatus === 'review' && (context.pr?.merged || reviewApproved || localApproved);
  const defaultUserOverride = context.taskStatus === 'review' && context.pr?.merged === false && defaultUserApproved && context.approval.reviewState !== 'APPROVED';

  if (reviewCanProceed) {
    let reason;
    if (context.pr?.merged) {
      reason = 'Forgejo PR already merged';
    } else if (localApproved) {
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
    message: `Backlog status: expected approved, or review with an approved/merged Forgejo PR; found ${toVirtual(context.taskStatus, stateMapOptions)}`
  };
}

/** @param {{slug: string, branch: string, currentBranch: string, missionDir?: string, area: string, task: {ok: boolean, taskFile?: string, reason?: string, matches?: string[]}, taskStatus?: string, taskAssignee?: string|null, forgejoUser?: string|null, forgejoToken?: string|null, taskAssigneeWarning?: string|null, pr: {exists?: boolean, state?: string, number?: number, merged?: boolean, raw?: string}, siblingPrs: any[], approval: {ok?: boolean, error?: string, reviewState?: string, defaultUserApproved?: boolean, source?: string}, baseBranch?: string, baseWorktree?: string, mainBranch: string, mainDirtyEntries: string[], mainDirty: boolean}} context */
function promoteTaskForIntegrationIfNeeded(context: any, { dryRun = false } = {}) {
  const taskStatusCheck = evaluateTaskStatusForIntegration(context);
  const needsPromotion = context.task?.ok && context.taskStatus === 'review' && taskStatusCheck.ok;

  if (!needsPromotion) {
    return { changed: false, dryRun: false };
  }

  if (dryRun) {
    fmt.log.info('Dry run: integration would promote Backlog status from review to approved because review is already fulfilled.');
    return { changed: false, dryRun: true };
  }

  const stateMapOptions = { rootDir: /** @type {string} */ (context.baseWorktree) };
  const approvedStatus = toActual('approved', stateMapOptions) || 'approved';
  if (!setTaskStatus(/** @type {string} */ (context.task.taskFile || ''), approvedStatus)) {
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
    // Use the base slug (e.g. task-1054) for the canonical path even when the
    // working slug carries a suffix (e.g. task-1054-modern).
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
      const { classification, error: classificationError } = stats.resolveMissionClassification(context.slug);
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
    // @ts-expect-error context.task.matches may be undefined
    context.task.matches.forEach((/** @type{string} */ match) => log(`  - ${match}`));
  } else {
    log(fmt.status('WARN', `Backlog task: no task file found for ${context.slug}; continuing with synthetic/unknown task metadata.`));
    log(fmt.status('PASS', 'Backlog classification: unknown'));
  }

  if (isForgejoReviewEnabledFn(baseWorktree)) {
    const localApproved = context.approval?.source === 'local-review-state';
    const localApprovalFallback = localApproved;

    if (context.pr.exists && context.pr.state === 'open' && !context.pr.merged) {
      log(fmt.status('PASS', `Forgejo PR: PR #${context.pr.number} open`));
      if (localApprovalFallback) {
        log(fmt.status('INFO', `Forgejo approval: token unavailable, approval sourced from local review-state.json (phase=approved)`));
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
    } else if (context.pr.exists && context.pr.merged) {
      warnings.push('pr-merged');
      log(fmt.status('WARN', `Forgejo PR: PR #${context.pr.number} is already marked merged`));
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

    const tokenPath = resolveTokenFileFn(/** @type {string} */ (context.forgejoUser));
    const token = readTokenFn(/** @type {string} */ (context.forgejoUser));
    if (token) {
      log(fmt.status('PASS', `Forgejo token: resolved for ${context.forgejoUser} (${tokenPath || 'env:FORGEJO_TOKEN'})`));
    } else if (localApprovalFallback) {
      log(fmt.status('INFO', `Forgejo token: no token file found for ${context.forgejoUser} (approval sourced from local review-state.json)`));
    } else {
      failures.push('forgejo-token');
      log(fmt.status('FAIL', `Forgejo token: no token file found for ${context.forgejoUser}`));
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
    warnings.push('main-dirty');
    log(fmt.status('WARN', `Integration checkout dirty: ${baseWorktree} has uncommitted changes that will be stashed temporarily`));
    context.mainDirtyEntries.forEach((entry: string) => log(fmt.status('INFO', `  - ${entry}`)));
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
  fmt.log.info(`Stashing unrelated local integration checkout changes before integration: ${message}`);
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
    fmt.log.fail('Could not stash the unrelated local integration checkout changes.');
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
  fmt.log.info(`Restoring temporarily stashed local integration checkout changes: ${message}`);
  // Pass cwd explicitly so spawnSync does not inherit the process cwd, which may have been
  // deleted by worktree cleanup earlier in the same integrate run.
  return gitRunner(['-C', rootDir, 'stash', 'pop'], { cwd: rootDir });
}

/** @param{{stdout: string, stderr: string, status: number}} result */
function isNoMergeToAbortResult(result: any) {
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
  return /MERGE_HEAD missing|There is no merge to abort/i.test(output);
}

/**
 * @param {string} slug
 * @param{{rootDir?: string, gitRunner?: Function, recordIntegrationStatsFn?: Function}} options
 */
function recordPostIntegrationStats(
  slug: string,
  {
    rootDir = getPrimaryWorktree(),
    gitRunner = git,
    recordIntegrationStatsFn = stats.recordIntegrationStats,
  } = {}
) {
  const dateResult = gitRunner(['-C', rootDir, 'log', '-1', '--format=%cs']);
  if (dateResult.status !== 0) {
    throw new Error(`Could not determine integration date for ${slug}.`);
  }

  const statsCsvPath = stats.resolveStatsFilePath(rootDir);

  const outcome = recordIntegrationStatsFn({
    slug,
    rootDir,
    filePath: statsCsvPath,
    date: dateResult.stdout.trim(),
  });

  fmt.log.info(`Workflow stats recorded: ${formatRecordedStatsRow(outcome.row)}`);
  fmt.log.info('Workflow stats updated:');
  fmt.log.plain(outcome.report);

  const missionRows = outcome.data?.rows || [];
  const missionReport = stats.renderMissionPhaseReport(missionRows, slug);
  const firstLine = missionReport.split('\n')[0];
  fmt.log.info(firstLine);
  fmt.log.plain(missionReport.split('\n').slice(1).join('\n'));

  return outcome;
}

/** @param {string} slug @param{{rootDir?: string}} options */
function recordPostIntegrationStatsOrAbort(slug: string, options: {rootDir?: string} = {}) {
  try {
    return recordPostIntegrationStats(slug, options);
  } catch (error: any) {
    const detail = error && error.message ? error.message : String(error);
    fmt.log.fail(`Post-integration workflow stats failed for ${slug}: ${detail}`);
    throw new IntegrationAbort();
  }
}

/** @param{{slug: string, summary: string, mainTaskFile?: string, rootDir?: string, gitRunner?: Function, baseBranch?: string|null, verificationArea?: string|null, captureVerifiedTreeProofFn?: Function, assertVerifiedTreeProofFn?: Function}} params */
function finalizeVariantACloseout({
  slug,
  summary,
  mainTaskFile,
  rootDir = getPrimaryWorktree(),
  gitRunner = git,
  baseBranch = null,
  verificationArea = null,
  captureVerifiedTreeProofFn = verification.captureVerifiedTreeProof,
  assertVerifiedTreeProofFn = verification.assertVerifiedTreeProof
}: {slug: string, summary: string, mainTaskFile?: string, rootDir?: string, gitRunner?: Function, baseBranch?: string|null, verificationArea?: string|null, captureVerifiedTreeProofFn?: Function, assertVerifiedTreeProofFn?: Function}) {
  softResetTrailingBacklogNoise(rootDir, gitRunner);

  if (mainTaskFile && fs.existsSync(mainTaskFile)) {
    completeTask(slug, rootDir);
    // Re-resolve because it moved
    const updatedResolution = resolveTaskFile(slug, rootDir);
    if (updatedResolution.ok) {
      rewriteWorktreePaths(updatedResolution.taskFile || '', slug, { rootDir });
    }
  }

  gitRunner(['-C', rootDir, 'add', '-A']);

  const stagedDiff = gitRunner(['-C', rootDir, 'diff', '--cached', '--quiet']);
  if (stagedDiff.status === 0) {
    return { ok: true, changed: false };
  }

  const commitResult = gitRunner([
    '-C',
    rootDir,
    'commit',
    '-m',
    `${missionBranchName(slug, rootDir)}: ${summary} integration closeout`
  ]);
  if (commitResult.status !== 0) {
    return {
      ok: false,
      error: 'commit-failed',
      detail: [commitResult.stdout, commitResult.stderr].filter(Boolean).join('\n').trim()
    };
  }

  const resolvedVerificationArea = verificationArea || verification.resolveVerificationAdapter(rootDir).defaultArea;
  const proofResult = captureVerifiedTreeProofFn(resolvedVerificationArea, rootDir, {
    gitRunner,
    runFn: child_process.spawnSync
  });
  if (!proofResult.ok) {
    return {
      ok: false,
      error: 'verification-failed',
      detail: proofResult.error || 'failed to verify published tree'
    };
  }

  const proofCheck = assertVerifiedTreeProofFn(proofResult.proof, rootDir, { gitRunner });
  if (!proofCheck.ok) {
    return {
      ok: false,
      error: 'verification-proof-mismatch',
      detail: proofCheck.error || 'verification proof does not match the tree being published'
    };
  }

  const pushTarget = baseBranch || getPrimaryBranch(gitRunner);
  const pushResult = gitRunner(['-C', rootDir, 'push', 'review', pushTarget]);
  if (pushResult.status !== 0) {
    return {
      ok: false,
      error: 'push-primary-failed',
      detail: [pushResult.stdout, pushResult.stderr].filter(Boolean).join('\n').trim()
    };
  }

  return { ok: true, changed: true };
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
 * @param {string} slug - Backlog task key (e.g. "task-108")
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
(integrate as any).finalizeVariantACloseout = finalizeVariantACloseout;
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
(integrate as any).formatRecordedStatsRow = formatRecordedStatsRow;
(integrate as any).detectChangedAreas = detectChangedAreas;
(integrate as any).parseFilesToAreas = parseFilesToAreas;
(integrate as any).loadIntegrationConfig = loadIntegrationConfig;
(integrate as any).getIntegrationGatePlan = getIntegrationGatePlan;
(integrate as any).printIntegrationGatePlan = printIntegrationGatePlan;
(integrate as any).buildIntegrationGateEnv = buildIntegrationGateEnv;
(integrate as any).resolveIntegrationVerificationWorktree = resolveIntegrationVerificationWorktree;
(integrate as any).buildIntegrationVerificationInvocation = buildIntegrationVerificationInvocation;
(integrate as any).executeIntegrationGates = executeIntegrationGates;
(integrate as any).buildIntegrationContext = buildIntegrationContext;
// Re-export getPrimaryWorktree from mission-utils
(integrate as any).getPrimaryWorktree = getPrimaryWorktree;
export = /** @type {any} */ (integrate) as unknown as IntegrateFn;
