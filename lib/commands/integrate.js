const fs = require('fs');
const os = require('os');
const path = require('path');
const child_process = require('child_process');
const { detectRebaseState, git, getCurrentBranch } = require('../core/git');
const { resolveTaskFile, getTaskStatus, setTaskStatus, completeTask, getTaskAssignee } = require('../tools/backlog');
const { toVirtual, toActual } = require('../core/state-map');
const { getPrStatus, getLatestReviewDecision, syncMerged, readToken, resolveTokenFile, resolveForgejoUser, resolveForgejoHome, isForgejoPath, listOpenPrsForSlug } = require('../tools/forgejo');
const fmt = require('../core/fmt');
const { KNOWN_AGENT_NAMES } = require('../agents/agents');
const { buildAutonomousReviewMatrix, formatMatrixSummary } = require('../core/runtime-matrix');
const { findMissionDir, resolveWorktree, findMissionArea, missionTitle, parseConflictFilesFromMergeOutput, getConflictFiles, inferSlug, updateGraphifyKnowledgeGraph, resolveMainRepo, getPrimaryWorktree, getPrimaryBranch, conventionalWorktreePath, getMissionYear, softResetTrailingBacklogNoise, findMissionDocInBranches, missionBranchName, missionBaseDir, missionDirForSlug, isMissionArtifact, resolveMissionBaseBranch, resolveBaseWorktree } = require('../core/mission-utils');
const stats = require('./stats');
const verification = require('../core/verification');
const { formatVerificationCommand } = verification;
const { isForgejoReviewEnabled } = require('../core/product-config');
const { readReviewState } = require('../review/review-state');

const VARIANT_B_AUTOMATION_SUMMARY = 'Variant B automation: Backlog task closeout, worktree-path rewrite, squash commit with hook-enforced validation, Forgejo sync-merged, and mission worktree cleanup.';

const SYNC_MERGED_DIAGNOSTICS = [
  { symptom: 'sync-merged reports generic failure; PR still open', cause: 'allow_manual_merge disabled or drifted off in Forgejo settings', fix: 'Enable "Allow manual merge" in Forgejo PR settings and retry.' },
  { symptom: 'POST /pulls/N/merge returns 405 or 500', cause: 'Forgejo API conflict or stale PR state', fix: 'px review <slug> to check if actually merged.' },
  { symptom: 'git push rejects mission branch with "stale info" or "fetch first"', cause: 'Local review/<branch> tracking is stale while sync-merged updates the PR branch to the landed squash commit', fix: 'Automated: sync-merged fetches review/<branch>, retries --force-with-lease, then force-pushes only if stale-info persists.' },
  { symptom: 'curl: (7) Failed to connect to localhost port 3300', cause: 'Forgejo service not reachable from current runtime (sandbox/network)', fix: 'Ensure Forgejo is running (scripts/start-runner.sh) or use FORGEJO_URL override if external.' },
  { symptom: 'PR marked merged but remote branch still exists', cause: 'Remote branch deletion failed (permissions or network)', fix: 'px review <slug> --close (to trigger cleanup; identity resolves from review-state).' }
];

class IntegrationAbort extends Error {}

function formatRecordedStatsRow(row) {
  return `${row.mission}: implementer=${row.implementer}, pr_fix_rounds=${row.pr_fix_rounds}, classification=${row.classification}, date=${row.date}`;
}

function shellQuote(value) {
  return `"${String(value).replace(/(["\\$`])/g, '\\$1')}"`;
}

function maybeUpdateGraphifyOnPrimary(rootDir = getPrimaryWorktree(), { commandRunner = null, log = fmt.log.plain } = {}) {
  return updateGraphifyKnowledgeGraph({
    rootDir,
    commandRunner: commandRunner || ((command, args, options) => require('../core/git').run(command, args, options)),
    log,
    startMessage: `Updating graphify knowledge graph on ${getPrimaryBranch()}...`,
    failureHint: 'Continuing without blocking integration.'
  });
}

function prepareNoisePatchForSquash(rootDir, { gitRunner = git } = {}) {
  const diffResult = gitRunner(['-C', rootDir, 'diff', '--cached', '--binary']);
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

  const resetResult = gitRunner(['-C', rootDir, 'reset', '--hard', 'HEAD']);
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

function restoreNoisePatchAfterSquash(rootDir, patchPath, { gitRunner = git } = {}) {
  if (!patchPath) return { ok: true };
  const applyResult = gitRunner(['-C', rootDir, 'apply', '--index', patchPath]);
  if (applyResult.status !== 0) {
    return {
      ok: false,
      error: [applyResult.stdout, applyResult.stderr].filter(Boolean).join('\n').trim() || 'Could not re-apply backlog-noise patch after squash merge.'
    };
  }
  return { ok: true };
}

function resolveForgejoUserForIntegration(taskAssignee) {
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
    forgejoUser: resolveForgejoUser(),
    warning: null
  };
}

function getUnresolvedIndexConflicts(rootDir = getPrimaryWorktree(), { gitRunner = git } = {}) {
  const result = gitRunner(['-C', rootDir, 'ls-files', '-u']);
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
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => line.split('\t')[1])
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

function reportStashPopFailure(
  slug,
  restoreResult,
  {
    rootDir = getPrimaryWorktree(),
    gitRunner = git,
    getUnresolvedIndexConflictsFn = targetRootDir => getUnresolvedIndexConflicts(targetRootDir, { gitRunner })
  } = {}
) {
  const output = [restoreResult.stdout, restoreResult.stderr].filter(Boolean).join('\n').trim();
  const headResult = gitRunner(['-C', rootDir, 'log', '-1', '--oneline']);
  const headLine = headResult.status === 0 ? headResult.stdout.trim() : '(unavailable)';
  const integrationLanded = headLine.includes(`${missionBranchName(slug, rootDir)}:`);
  const indexConflicts = getUnresolvedIndexConflictsFn(rootDir);
  const collisionFiles = parseStashPopCollisionFiles(output);

  fmt.log.fail('Could not restore the temporarily stashed local integration checkout changes.');
  if (integrationLanded) {
    fmt.log.fail(`Integration commit landed: ${headLine}`);
  } else {
    fmt.log.fail(`Integration landing not confirmed by HEAD: ${headLine}`);
  }

  if (indexConflicts.ok && indexConflicts.files.length > 0) {
    fmt.log.fail('Stash restore failure type: merge-conflict');
    indexConflicts.files.forEach(file => fmt.log.fail(`  - ${file}`));
    fmt.log.fail('Recovery steps:');
    fmt.log.fail(`  1. cd ${rootDir}`);
    indexConflicts.files.forEach(file => {
      fmt.log.fail(`  2. Resolve ${file}, then run git add "${file}" or git rm "${file}"`);
    });
    fmt.log.fail('  3. git status --short');
    fmt.log.fail('  4. git stash drop');
  } else {
    fmt.log.fail('Stash restore failure type: file-collision');
    if (collisionFiles.length > 0) {
      collisionFiles.forEach(file => fmt.log.fail(`  - ${file}`));
    }
    fmt.log.fail('Recovery steps:');
    fmt.log.fail(`  1. git -C ${rootDir} stash show --name-only stash@{0}`);
    if (collisionFiles.length > 0) {
      collisionFiles.forEach(file => {
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

function reportSyncMergedFailure(syncResult) {
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
function detectChangedAreas(slug, { gitRunner = git, rootDir = getPrimaryWorktree(), baseBranch = null } = {}) {
  const primaryBranch = baseBranch || getPrimaryBranch();
  const branch = `mission/${slug}`;
  
  // Get changed files between primary branch and mission branch
  const diffResult = gitRunner(['-C', rootDir, 'diff', '--name-only', primaryBranch, branch, '--']);
  
  if (diffResult.status !== 0 && !diffResult.stdout.trim()) {
    // No changes or error - fall back to checking against HEAD in the worktree
    const worktree = resolveWorktree(slug) || conventionalWorktreePath(slug, rootDir);
    if (fs.existsSync(worktree)) {
      const worktreeDiff = gitRunner(['-C', worktree, 'diff', '--name-only', primaryBranch, 'HEAD', '--']);
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
function parseFilesToAreas(filesOutput) {
  const areas = new Set();
  const knownAreas = ['server', 'auth-server', 'web-client', 'docs', 'workflow', 'android', 'kubernetes'];
  
  filesOutput.split('\n').forEach(file => {
    file = file.trim();
    if (!file) return;
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
function loadIntegrationConfig({ configPath = INTEGRATION_CONFIG_PATH } = {}) {
  if (!fs.existsSync(configPath) || !fs.statSync(configPath).size) {
    return { ok: false, error: 'no config present' };
  }
  
  try {
    const content = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(content);
    return { ok: true, config };
  } catch (error) {
    return { ok: false, error: `invalid JSON: ${error.message}` };
  }
}

/**
 * Get the integration gate plan for changed areas
 * Returns { gates: [{key, command, run_last}], changedAreas: [...] }
 */
function getIntegrationGatePlan(slug, { runIntegrationGates = true, gitRunner = git, dryRun = false, configPath = INTEGRATION_CONFIG_PATH } = {}) {
  // Check config
  const configResult = loadIntegrationConfig({ configPath });
  if (!configResult.ok) {
    if (runIntegrationGates) {
      fmt.log.info(`integration-gates: ${configResult.error}, skipping`);
    }
    return { gates: [], changedAreas: [], configError: configResult.error };
  }
  
  const config = configResult.config;
  if (!config.gates || Object.keys(config.gates).length === 0) {
    if (runIntegrationGates) {
      fmt.log.info('integration-gates: no gates defined in config, skipping');
    }
    return { gates: [], changedAreas: [], configError: 'no gates defined' };
  }
  
  // Detect changed areas (always detect for dry-run; for real run, detect only if runIntegrationGates)
  const changedAreas = (runIntegrationGates || dryRun) ? detectChangedAreas(slug, { gitRunner }) : [];
  
  if (runIntegrationGates && !dryRun && changedAreas.length === 0) {
    fmt.log.info('integration-gates: no area changes detected, skipping');
    return { gates: [], changedAreas: [], configError: null };
  }
  
  // Build list of gates to run, preserving order with run_last handling
  const gateEntries = Object.entries(config.gates);
  const gates = gateEntries
    .map(([key, value]) => ({
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
function printIntegrationGatePlan(gates) {
  fmt.log.info('Integration gate plan:');
  for (const gate of gates) {
    fmt.log.info(`  ${gate.key}: ${gate.command}`);
  }
}

function buildIntegrationGateEnv(slug, {
  dryRun = false,
  processEnv = process.env,
  gitRunner = git,
  baseBranch = null,
  baseWorktree = null
} = {}) {
  const env = {
    ...processEnv,
    INTEGRATE_DRY_RUN: dryRun ? 'true' : 'false',
    INTEGRATE_CHANGED_AREAS: detectChangedAreas(slug, {
      gitRunner,
      baseBranch,
      ...(baseWorktree ? { rootDir: baseWorktree } : {})
    }).join(' ')
  };

  // Integration must always use the repo-side config, but the changed-area set
  // should be the one resolved for this mission branch, not rediscovered later.
  delete env.INTEGRATION_CONFIG_PATH;
  return env;
}

function resolveIntegrationVerificationWorktree(slug, {
  baseWorktree = getPrimaryWorktree(),
  resolveWorktreeFn = resolveWorktree,
  conventionalWorktreePathFn = conventionalWorktreePath
} = {}) {
  return resolveWorktreeFn(slug, { cwd: baseWorktree })
    || conventionalWorktreePathFn(slug, baseWorktree);
}

function buildIntegrationVerificationInvocation(slug, {
  baseWorktree = getPrimaryWorktree(),
  resolveWorktreeFn = resolveWorktree,
  conventionalWorktreePathFn = conventionalWorktreePath,
  formatVerificationCommandFn = formatVerificationCommand
} = {}) {
  const cwd = resolveIntegrationVerificationWorktree(slug, {
    baseWorktree,
    resolveWorktreeFn,
    conventionalWorktreePathFn
  });
  return {
    command: formatVerificationCommandFn('integrate', cwd),
    cwd
  };
}

/**
 * Execute integration gates, aborting on first failure
 * Returns { ok: boolean, failedGate: string|null, error: string|null }
 */
async function executeIntegrationGates(gates, { commandRunner = null, rootDir = getPrimaryWorktree() } = {}) {
  const runner = commandRunner || ((cmd, args, options) => require('child_process').spawnSync(cmd, {
      shell: true,
      cwd: rootDir,
      stdio: 'inherit'
    }));
  
  for (const gate of gates) {
    fmt.log.info(`Running integration gate: ${gate.key}...`);
    fmt.log.info(`  Command: ${gate.command}`);
    
    // Execute the command using the injected runner
    const result = runner(gate.command, [], { cwd: rootDir, stdio: 'inherit' });
    
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

async function integrate(args) {
  let exitCode = 0;
  let temporaryStash = null;
  let nextActionMessage = null;
  const flags = args.filter(arg => arg.startsWith('--'));
  const params = args.filter(arg => !arg.startsWith('--'));
  const explicitSlug = params[0];
  const slug = inferSlug(explicitSlug);
  const dryRun = flags.includes('--dry-run');
  const noIntegrationGates = flags.includes('--no-integration-gates');

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
    const context = buildIntegrationContext(slug);
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
      dirtyEntries: context.mainDirtyEntries,
      rootDir: baseWorktree
    });

    // End-context check: if we are in the worktree that is about to be deleted,
    // move the Node process to the base worktree to avoid being left in a ghost directory.
    const missionWorktree = conventionalWorktreePath(slug);
    if (process.cwd() === missionWorktree || process.cwd().startsWith(missionWorktree + '/')) {
      fmt.log.info(`Moving process directory to ${baseWorktree} before mission worktree deletion.`);
      process.chdir(baseWorktree);
    }

    // Variant Selection
    const branch = missionBranchName(slug, baseWorktree);
    const mainTitle = missionTitle(slug) || slug;
    const summary = mainTitle.replace(/\s+/g, ' ').trim();
    const mainTaskFile = context.task.taskFile.replace(executionDir, baseWorktree);
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
      nextActionMessage = `Next: cd ${baseWorktree}`;
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
              token: context.forgejoToken
            });
            if (!syncResult.ok) {
              reportSyncMergedFailure(syncResult);
              throw new IntegrationAbort();
            }
          } else {
            fmt.log.info('Step 6 (resume): Skipping Forgejo sync (review provider is not forgejo).');
          }
          nextActionMessage = `Next: cd ${baseWorktree}`;
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
          const conflictOutput = [dryMerge.stdout, dryMerge.stderr].filter(Boolean).join('\n');
          const conflictFiles = parseConflictFilesFromMergeOutput(conflictOutput);
          if (conflictFiles.length > 0) {
            fmt.log.info(`Conflicting files (${conflictFiles.length}):`);
            conflictFiles.forEach(f => fmt.log.info(`  - ${f}`));
          }
          fmt.log.info('Conflict helper path:');
          for (const line of formatMatrixSummary(buildAutonomousReviewMatrix())) {
            fmt.log.info(line);
          }
          for (const line of buildConflictResolutionPrompt(slug, context.area, { baseBranch: context.baseBranch })) {
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
          const restoreNoiseResult = restoreNoisePatchAfterSquash(baseWorktree, noisePatchState.patchPath, { gitRunner: git });
          noisePatchState.cleanup();
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
            rewriteWorktreePaths(updatedResolution.taskFile, slug, { rootDir: baseWorktree });
          }
        }

        git(['-C', baseWorktree, 'add', '-A']);
        fmt.log.info('Step 5: Creating the landed squash commit in the local integration checkout...');
        const commitResult = git([
          '-C',
          baseWorktree,
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
          runFn: child_process.spawnSync
        });
        if (!proofResult.ok) {
          fmt.log.fail(`Could not verify the exact tree being published: ${proofResult.error}`);
          throw new IntegrationAbort();
        }
        const proof = proofResult.proof;
        const mergedCommit = git(['-C', baseWorktree, 'rev-parse', 'HEAD']).stdout.trim();
        const proofCheck = verification.assertVerifiedTreeProof(proof, baseWorktree, { gitRunner: git });
        if (!proofCheck.ok) {
          fmt.log.fail(`Verification proof is stale for the publish tree: ${proofCheck.error}`);
          throw new IntegrationAbort();
        }

        if (isForgejoReviewEnabled(baseWorktree)) {
          fmt.log.info('Step 6: Syncing merged state to Forgejo...');
          const syncResult = syncMerged(branch, mergedCommit, {
            rootDir: baseWorktree,
            forgejoUser: context.forgejoUser,
            token: context.forgejoToken
          });
          if (!syncResult.ok) {
            reportSyncMergedFailure(syncResult);
            throw new IntegrationAbort();
          }
        } else {
          fmt.log.info('Step 6: Skipping Forgejo sync (review provider is not forgejo).');
        }

        nextActionMessage = `Next: cd ${baseWorktree}`;
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
      throw error;
    }
  } finally {
    if (temporaryStash?.created) {
      const restoreResult = restoreMainCheckoutStash(temporaryStash);
      if (restoreResult.status !== 0) {
        reportStashPopFailure(slug, restoreResult, { rootDir: temporaryStash.rootDir });
        exitCode = 1;
      }
    }

    if (nextActionMessage) {
      fmt.log.info(`\n${nextActionMessage}`);
    }
    process.exit(exitCode);
  }
}

function buildIntegrationContext(slug, {
  baseBranch = null,
  baseWorktree = null,
  isForgejoReviewEnabledFn = isForgejoReviewEnabled
} = {}) {
  const branch = `mission/${slug}`;
  const currentBranch = getCurrentBranch();
  const missionDir = findMissionDir(slug);
  const area = missionDir ? findMissionArea(missionDir) : 'docs';

  // The mission integrates back into its recorded base branch/worktree. When no
  // base was recorded (every legacy mission) these resolve to the primary
  // branch/worktree, so the rest of integration is byte-identical to today.
  let resolvedBaseBranch = baseBranch;
  if (!resolvedBaseBranch) {
    try { resolvedBaseBranch = resolveMissionBaseBranch(slug, process.cwd()); } catch (_) { resolvedBaseBranch = getPrimaryBranch(); }
  }
  let resolvedBaseWorktree = baseWorktree;
  if (!resolvedBaseWorktree) {
    try { resolvedBaseWorktree = resolveBaseWorktree(slug, { rootDir: process.cwd() }); } catch (_) { resolvedBaseWorktree = getPrimaryWorktree(); }
  }
  let task = resolveTaskFile(slug);
  if (!task.ok) {
    const worktree = resolveWorktree(slug);
    if (worktree) task = resolveTaskFile(slug, worktree);
  }
  let taskStatus = task.ok ? getTaskStatus(task.taskFile) : null;
  if (task.ok && taskStatus === 'backlog') {
    const worktree = resolveWorktree(slug);
    if (worktree) {
      const wtTask = resolveTaskFile(slug, worktree);
      if (wtTask.ok) {
        const wtStatus = getTaskStatus(wtTask.taskFile);
        if (wtStatus && wtStatus !== 'backlog') {
          task = wtTask;
          taskStatus = wtStatus;
        }
      }
    }
  }
  const taskAssignee = task.ok ? getTaskAssignee(task.taskFile) : null;
  const forgejoEnabled = isForgejoReviewEnabledFn(resolvedBaseWorktree);
  
  let forgejoIdentity = { forgejoUser: null, warning: null };
  let forgejoToken = null;
  let pr = { exists: false };
  let siblingPrs = [];
  let approval = { ok: false, error: 'forgejo-off', reviewState: null };

  if (forgejoEnabled) {
    forgejoIdentity = resolveForgejoUserForIntegration(taskAssignee);
    forgejoToken = readToken(forgejoIdentity.forgejoUser);
    pr = getPrStatus(branch, process.cwd(), {
      forgejoUser: forgejoIdentity.forgejoUser,
      token: forgejoToken
    });
    
    if (pr.exists && slug) {
      const baseSlugMatch = slug.match(/^(task-\d+)/i);
      const baseSlug = baseSlugMatch ? baseSlugMatch[1].toLowerCase() : slug;
      if (forgejoToken) {
        const allOpen = listOpenPrsForSlug(baseSlug, forgejoToken);
        siblingPrs = allOpen.filter(p => p.head !== branch);
      }
    }

    approval = pr.exists ? getLatestReviewDecision(branch, {
      forgejoUser: forgejoIdentity.forgejoUser,
      token: forgejoToken
    }) : { ok: false, error: 'pr-missing', reviewState: null };
  }

  // Local review-state fallback: when forgejo token/API is unavailable but the
  // mission's review-state.json shows approved, populate approval from local state
  // so that integrate can proceed without a live Forgejo connection.
  // Only applies when Forgejo was enabled but approval could not be obtained.
  if (forgejoEnabled && !approval.ok) {
    const localStateFallback = readReviewState(slug, resolvedBaseWorktree);
    if (localStateFallback && localStateFallback.phase === 'approved' && localStateFallback.disposition === 'APPROVED') {
      approval = { ok: true, reviewState: 'APPROVED', source: 'local-review-state' };
    }
  }
  
  const mainBranchResult = git(['-C', resolvedBaseWorktree, 'branch', '--show-current']);
  const mainBranch = mainBranchResult.stdout.trim();
  const mainStatus = git(['-C', resolvedBaseWorktree, 'status', '--short']);

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

function evaluateTaskStatusForIntegration(context) {
  const stateMapOptions = { rootDir: context.baseWorktree };
  if (toVirtual(context.taskStatus, stateMapOptions) === 'approved') {
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

function promoteTaskForIntegrationIfNeeded(context, { dryRun = false } = {}) {
  const taskStatusCheck = evaluateTaskStatusForIntegration(context);
  const needsPromotion = context.task?.ok && context.taskStatus === 'review' && taskStatusCheck.ok;

  if (!needsPromotion) {
    return { changed: false, dryRun: false };
  }

  if (dryRun) {
    fmt.log.info('Dry run: integration would promote Backlog status from review to approved because review is already fulfilled.');
    return { changed: false, dryRun: true };
  }

  const stateMapOptions = { rootDir: context.baseWorktree };
  if (!setTaskStatus(context.task.taskFile, toActual('approved', stateMapOptions))) {
    fmt.log.fail('Could not promote the Backlog task to approved before integration.');
    throw new IntegrationAbort();
  }

  context.taskStatus = toActual('approved', stateMapOptions);
  fmt.log.info('Promoted Backlog status from review to approved because review is already fulfilled.');
  return { changed: true, dryRun: false };
}

function printIntegrationPreflight(
  context,
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
  if (context.currentBranch === context.branch || context.currentBranch.startsWith(`${branchPrefix}-`)) {
    log(fmt.status('PASS', `Mission branch: ${context.currentBranch}`));
  } else {
    failures.push('branch');
    log(fmt.status('FAIL', `Mission branch: current branch is ${context.currentBranch}, expected ${context.branch} (or a branch with a suffix)`));
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
    log(fmt.status('PASS', `Backlog task: ${path.basename(context.task.taskFile)} (${context.taskStatus})`));
    
    try {
      const { classification, error: classificationError } = stats.resolveMissionClassification(context.slug);
      if (!classification) {
        failures.push('classification');
        log(fmt.status('FAIL', `Backlog classification: ${classificationError || 'missing'}`));
      } else {
        log(fmt.status('PASS', `Backlog classification: ${classification}`));
      }
    } catch (error) {
      failures.push('classification');
      log(fmt.status('FAIL', `Backlog classification: ${error.message}`));
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
    context.task.matches.forEach(match => log(`  - ${match}`));
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
      context.siblingPrs.forEach(p => {
        log(fmt.status('INFO', `  - PR #${p.number} (${p.head}): ${p.html_url}`));
      });
    }

    const tokenPath = resolveTokenFileFn(context.forgejoUser);
    const token = readTokenFn(context.forgejoUser);
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
    context.mainDirtyEntries.forEach(entry => log(fmt.status('INFO', `  - ${entry}`)));
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

function rewriteWorktreePaths(taskFilePath, slug, options = {}) {
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

function stashMainCheckoutIfNeeded({
  slug,
  dirtyEntries = [],
  rootDir = getPrimaryWorktree(),
  gitRunner = git
}) {
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

function restoreMainCheckoutStash({ message, rootDir = getPrimaryWorktree(), gitRunner = git }) {
  fmt.log.info(`Restoring temporarily stashed local integration checkout changes: ${message}`);
  // Pass cwd explicitly so spawnSync does not inherit the process cwd, which may have been
  // deleted by worktree cleanup earlier in the same integrate run.
  return gitRunner(['-C', rootDir, 'stash', 'pop'], { cwd: rootDir });
}

function isNoMergeToAbortResult(result) {
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
  return /MERGE_HEAD missing|There is no merge to abort/i.test(output);
}

function recordPostIntegrationStats(
  slug,
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
  return outcome;
}

function recordPostIntegrationStatsOrAbort(slug, options = {}) {
  try {
    return recordPostIntegrationStats(slug, options);
  } catch (error) {
    const detail = error && error.message ? error.message : String(error);
    fmt.log.fail(`Post-integration workflow stats failed for ${slug}: ${detail}`);
    throw new IntegrationAbort();
  }
}

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
}) {
  softResetTrailingBacklogNoise(rootDir, gitRunner);

  if (mainTaskFile && fs.existsSync(mainTaskFile)) {
    completeTask(slug, rootDir);
    // Re-resolve because it moved
    const updatedResolution = resolveTaskFile(slug, rootDir);
    if (updatedResolution.ok) {
      rewriteWorktreePaths(updatedResolution.taskFile, slug, { rootDir });
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

function cleanupMissionWorktree(
  slug,
  {
    rootDir = getPrimaryWorktree(),
    gitRunner = git,
    removeDir = target => {
      if (isForgejoPath(target, { forgejoHome: resolveForgejoHome() })) {
        throw new Error(`CRITICAL SAFETY VIOLATION: cleanupMissionWorktree attempted to delete Forgejo home: ${target}`);
      }
      return fs.rmSync(target, { recursive: true, force: true });
    },
    existsSync = fs.existsSync
  } = {}
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
  const isRegistered = worktreeList.split('\n').some(line => line.trim() === `worktree ${worktreePath}`);

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

function findExistingSquashCommit(rootDir, slug) {
  const result = git(['-C', rootDir, 'log', '--format=%H %s', '-50']);
  if (result.status !== 0) return null;
  const prefix = `${missionBranchName(slug, rootDir)}:`;
  for (const line of result.stdout.trim().split('\n')) {
    const spaceIdx = line.indexOf(' ');
    if (spaceIdx === -1) continue;
    const hash = line.slice(0, spaceIdx);
    const subject = line.slice(spaceIdx + 1);
    if (subject.startsWith(prefix)) return hash;
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
 * @returns {{ ok: boolean, conflictFiles: string[], sharedFiles: string[], missionSpecificFiles: string[] }}
 */
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
  let targetBranch = baseBranch;
  if (!targetBranch) {
    try { targetBranch = resolveMissionBaseBranch(slug, rootDir); } catch (_) { targetBranch = getPrimaryBranch(); }
  }

  const detectFn = getConflictFilesFn || ((_rootDir, _branch) => getConflictFiles(worktreePath, targetBranch));

  if (!fs.existsSync(worktreePath)) {
    fmt.log.fail(`Mission worktree not found: ${worktreePath}`);
    fmt.log.info(`Expected path: ${worktreePath}`);
    return { ok: false, error: 'worktree-missing', conflictFiles: [], sharedFiles: [], missionSpecificFiles: [], worktreePath };
  }

  fmt.log.info(`Detecting conflicts in ${worktreePath} against ${targetBranch}...`);
  let conflictFiles;
  try {
    conflictFiles = detectFn(worktreePath, targetBranch);
  } catch (err) {
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
  conflictFiles.forEach(f => fmt.log.info(`  - ${f}`));

  // Derive the mission-doc directory prefix from the actual located mission dir
  // so the classification works for non-standard doc paths (e.g. renamed year dir).
  const taskPattern = new RegExp(`backlog/(?:tasks|completed)/[^/]*${slug}`);
  const missionSpecificFiles = conflictFiles.filter(f =>
    isMissionArtifact(f, slug, worktreePath) || taskPattern.test(f)
  );
  const sharedFiles = conflictFiles.filter(f => !missionSpecificFiles.includes(f));
  const quotedWorktreePath = shellQuote(worktreePath);

  if (sharedFiles.length > 0) {
    fmt.log.warn(`Conflicts in ${sharedFiles.length} shared file(s) require manual resolution:`);
    sharedFiles.forEach(f => fmt.log.plain(`  - ${f}`));
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
  missionSpecificFiles.forEach(f => fmt.log.info(`  git checkout --theirs "${f}" && git add "${f}"`));
  fmt.log.info('  git rebase --continue');
  fmt.log.info(`  ${formatVerificationCommand(area, worktreePath)}`);
  fmt.log.info(`  px integrate ${slug} --dry-run`);

  return { ok: true, conflictFiles, sharedFiles: [], missionSpecificFiles, worktreePath };
}

function buildConflictResolutionPrompt(slug = '<slug>', area = '<area>', options = {}) {
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

module.exports = integrate;
module.exports.resolveConflictsForMission = resolveConflictsForMission;
module.exports.cleanupMissionWorktree = cleanupMissionWorktree;
module.exports.rewriteWorktreePaths = rewriteWorktreePaths;
module.exports.finalizeVariantACloseout = finalizeVariantACloseout;
module.exports.isNoMergeToAbortResult = isNoMergeToAbortResult;
module.exports.buildConflictResolutionPrompt = buildConflictResolutionPrompt;
module.exports.VARIANT_B_AUTOMATION_SUMMARY = VARIANT_B_AUTOMATION_SUMMARY;
module.exports.stashMainCheckoutIfNeeded = stashMainCheckoutIfNeeded;
module.exports.restoreMainCheckoutStash = restoreMainCheckoutStash;
module.exports.getPrimaryWorktree = getPrimaryWorktree;
module.exports.evaluateTaskStatusForIntegration = evaluateTaskStatusForIntegration;
module.exports.promoteTaskForIntegrationIfNeeded = promoteTaskForIntegrationIfNeeded;
module.exports.findExistingSquashCommit = findExistingSquashCommit;
module.exports.printIntegrationPreflight = printIntegrationPreflight;
module.exports.resolveForgejoUserForIntegration = resolveForgejoUserForIntegration;
module.exports.getUnresolvedIndexConflicts = getUnresolvedIndexConflicts;
module.exports.parseStashPopCollisionFiles = parseStashPopCollisionFiles;
module.exports.reportStashPopFailure = reportStashPopFailure;
module.exports.maybeUpdateGraphifyOnPrimary = maybeUpdateGraphifyOnPrimary;
module.exports.SYNC_MERGED_DIAGNOSTICS = SYNC_MERGED_DIAGNOSTICS;
module.exports.printDiagnosticTable = printDiagnosticTable;
module.exports.reportSyncMergedFailure = reportSyncMergedFailure;
module.exports.recordPostIntegrationStats = recordPostIntegrationStats;
module.exports.recordPostIntegrationStatsOrAbort = recordPostIntegrationStatsOrAbort;
module.exports.formatRecordedStatsRow = formatRecordedStatsRow;

// Integration gates exports
module.exports.detectChangedAreas = detectChangedAreas;
module.exports.parseFilesToAreas = parseFilesToAreas;
module.exports.loadIntegrationConfig = loadIntegrationConfig;
module.exports.getIntegrationGatePlan = getIntegrationGatePlan;
module.exports.printIntegrationGatePlan = printIntegrationGatePlan;
module.exports.buildIntegrationGateEnv = buildIntegrationGateEnv;
module.exports.resolveIntegrationVerificationWorktree = resolveIntegrationVerificationWorktree;
module.exports.buildIntegrationVerificationInvocation = buildIntegrationVerificationInvocation;
module.exports.executeIntegrationGates = executeIntegrationGates;
module.exports.buildIntegrationContext = buildIntegrationContext;
