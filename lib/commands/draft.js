const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const fmt = require('../core/fmt');
const { git, getWorktreeStatus } = require('../core/git');
const { startDraftAgent, selectAgent, readAgentConfigOrExit } = require('../agents/agents');
const { resolveTaskFile, enforceTaskAssignee, reportTaskResolution, checkBacklogIntegrity, transitionTask, getTaskStorage } = require('../tools/backlog');
const { findMissionArea, findMissionDir, inferSlug, getMissionYear, resolveMainRepo, conventionalWorktreePath, squashTrailingBacklogNoiseIntoPreviousMission, resolveWorktree, getPrimaryBranch, missionBranchName, missionDirForSlug, detectLaunchBaseBranch } = require('../core/mission-utils');
const { transitionVirtual } = require('../core/state-map');
const stats = require('./stats');
const { formatVerificationCommand } = require('../core/verification');
const { ensureStandaloneMissionBaseline, resolveAgentModel } = require('../core/product-config');
const { ensureWorkflowGitignore } = require('../core/gitignore');
const { unquoteGitStatusPath } = require('./active');

const DRAFT_PROMPT_PATH = path.join(__dirname, '..', '..', 'prompts', 'draft.md');
const MISSION_SCAFFOLD_PATH = path.join(__dirname, '..', '..', 'templates', 'mission-scaffold.md');
const SYNTHETIC_SLUG_PREFIX = 'adhoc-';

function slugifyDraftIntent(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^[./\\]+/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 64);
}

function syntheticTaskId(slug, seed) {
  const hash = crypto.createHash('sha1').update(String(seed || slug)).digest('hex').slice(0, 8).toUpperCase();
  const prefix = slug.startsWith(SYNTHETIC_SLUG_PREFIX) ? 'ADHOC' : 'TASK';
  const base = slug
    .replace(/^(task|adhoc)-/i, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .toUpperCase();
  return `${prefix}-${base}-${hash}`;
}

function resolveDraftTarget(rawInput, cwd = process.cwd()) {
  const explicit = String(rawInput || '').trim();
  if (!explicit) {return null;}

  if (explicit.toLowerCase().startsWith('task-')) {
    return {
      slug: explicit.toLowerCase(),
      syntheticTask: null,
    };
  }

  if (explicit.toLowerCase().startsWith(SYNTHETIC_SLUG_PREFIX)) {
    return {
      slug: explicit.toLowerCase(),
      syntheticTask: {
        title: explicit,
        intent: explicit,
        id: syntheticTaskId(explicit.toLowerCase(), explicit),
        source: 'synthetic-explicit-slug',
      },
    };
  }

  const absoluteCandidate = path.resolve(cwd, explicit);
  if (fs.existsSync(absoluteCandidate) && fs.statSync(absoluteCandidate).isDirectory()) {
    const baseName = path.basename(absoluteCandidate);
    const normalizedBase = slugifyDraftIntent(baseName) || 'project';
    const slug = `${SYNTHETIC_SLUG_PREFIX}${normalizedBase}`;
    return {
      slug,
      syntheticTask: {
        title: `Draft mission for ${baseName}`,
        intent: `Directory input: ${explicit}`,
        id: syntheticTaskId(slug, absoluteCandidate),
        source: 'synthetic-directory',
      },
    };
  }

  const normalized = slugifyDraftIntent(explicit) || 'mission';
  const slug = normalized.startsWith(SYNTHETIC_SLUG_PREFIX) ? normalized : `${SYNTHETIC_SLUG_PREFIX}${normalized}`;
  return {
    slug,
    syntheticTask: {
      title: explicit,
      intent: explicit,
      id: syntheticTaskId(slug, explicit),
      source: 'synthetic-free-text',
    },
  };
}

async function runDraftCommand(args, {
  inferSlugFn = inferSlug,
  resolveMainRepoFn = resolveMainRepo,
  conventionalWorktreePathFn = conventionalWorktreePath,
  ensureMissionBranchFn = ensureMissionBranch,
  ensureWorktreeFn = ensureWorktree,
  ensureGraphifyWorkspaceFn = ensureGraphifyWorkspace,
  ensureGraphifyIgnoreFn = ensureGraphifyIgnore,
  ensureMissionFileFn = ensureMissionFile,
  detectLaunchBaseBranchFn = detectLaunchBaseBranch,
  ensureMissionBaseBranchRecordedFn = ensureMissionBaseBranchRecorded,
  bootstrapBacklogTaskFn = bootstrapBacklogTask,
  ensureStandaloneMissionBaselineFn = ensureStandaloneMissionBaseline,
  ensureDraftRepoConfigCommittedFn = ensureDraftRepoConfigCommitted,
  readAgentConfigOrExitFn = readAgentConfigOrExit,
  selectAgentFn = selectAgent,
  startDraftAgentFn = startDraftAgent,
  resolveTaskFileFn = resolveTaskFile,
  reportTaskResolutionFn = reportTaskResolution,
  checkBacklogIntegrityFn = checkBacklogIntegrity,
  ensureRepoExistsFn = ensureRepoExists,
  transitionTaskFn = transitionTask,
  transitionVirtualFn = transitionVirtual,
  recordDraftImplementerFn = recordDraftImplementer,
  recordDraftStatsFn = recordDraftStats,
  enforceDraftCommitSafetyFn = enforceDraftCommitSafety,
  validateDraftClassificationFn = validateDraftClassification,
  normalizeDraftClassificationFn = normalizeDraftClassification,
  restartDraftAgentFn = restartDraftAgent,
  exitFn = process.exit,
  logFn = fmt.log.plain,
  errorFn = fmt.log.plainError
} = {}) {
  const explicitInput = args[0];
  const draftTarget = resolveDraftTarget(explicitInput) || { slug: inferSlugFn(explicitInput), syntheticTask: null };
  const slug = draftTarget.slug;
  if (!slug) {
    errorFn(fmt.status('FAIL', 'Usage: px draft <slug> [--agent <family>]'));
    exitFn(1);
    return;
  }

  const normalizedSlug = slug.toLowerCase();
  const syntheticTask = draftTarget.syntheticTask;

  // Allow operators to pin the agent family via CLI flag instead of WORKFLOW_AGENT env var.
  function flagValue(arr, flag, name) {
    const i = arr.indexOf(flag);
    if (i === -1) {return null;}
    const v = arr[i + 1];
    if (!v || v.startsWith('--')) {
      errorFn(fmt.status('FAIL', `Missing value for --${name}. Usage: px draft <slug> --${name} <family>`));
      exitFn(1);
      return null;
    }
    return v;
  }
  const preselectedAgent = flagValue(args, '--agent', 'agent');
  logFn(fmt.bold(`Starting mission draft automation for: ${fmt.slug(normalizedSlug)}`));

  const mainRepo = resolveMainRepoFn();
  if (ensureRepoExistsFn(mainRepo, exitFn, errorFn) === false) {
    return;
  }

  const baselineResult = ensureStandaloneMissionBaselineFn(mainRepo);
  if (baselineResult && baselineResult.failed) {
    errorFn(fmt.status('FAIL', `Standalone mission baseline: ${baselineResult.message}`));
    exitFn(1);
    return;
  }
  if (baselineResult && baselineResult.committed) {
    logFn(fmt.status('PASS', 'Standalone mission baseline committed in the primary checkout.'));
  }

  if (!ensureDraftRepoConfigCommittedFn(mainRepo, { errorFn })) {
    exitFn(1);
    return;
  }

  // Detect the branch HEAD is on at draft time (where the human stands). This is
  // the single source of truth for the mission's base. A non-primary feature
  // branch is recorded as the mission base; the primary branch (or a detached
  // HEAD) leaves no record and keeps the byte-identical legacy behaviour.
  let launchBase = null;
  try {
    launchBase = detectLaunchBaseBranchFn(process.cwd());
  } catch (error) {
    errorFn(fmt.status('FAIL', error.message));
    exitFn(1);
    return;
  }
  let recordedBase = null;
  if (launchBase && launchBase !== getPrimaryBranch(mainRepo)) {
    recordedBase = launchBase;
    logFn(fmt.status('INFO', `Feature-branch mission: base branch detected as ${fmt.branch(recordedBase)}.`));
  }

  // A feature-branch mission may reference a task that was only committed on that
  // feature branch, so it is absent from the primary checkout (mainRepo). In that
  // case the task lives in the current worktree (where HEAD is on the feature
  // branch), which the mission branch is cut from. Resolve preflight checks there.
  const taskLookupRoot = recordedBase ? process.cwd() : mainRepo;

  // Preflight: Ensure Backlog task exists and is unambiguous before side effects
  const mainResolution = resolveTaskFileFn(normalizedSlug, taskLookupRoot);
  if (!mainResolution.ok && !syntheticTask) {
    reportTaskResolutionFn(mainResolution, normalizedSlug, errorFn);
    exitFn(1);
    return;
  }

  // Preflight: Backlog integrity check (filename vs frontmatter ID)
  const relevantIssues = syntheticTask ? [] : checkBacklogIntegrityFn(taskLookupRoot, normalizedSlug);
  if (relevantIssues.length > 0) {
    errorFn(fmt.status('FAIL', `Backlog integrity issues detected for ${normalizedSlug}:`));
    relevantIssues.forEach(issue => {
      if (issue.type === 'duplicate-completed') {
        logFn(`  - ${fmt.path(issue.file)}: task ${fmt.bold(issue.taskId)} already has a canonical copy in ${fmt.path(issue.canonicalFile)}; this backlog/tasks copy is stale.`);
      } else {
        logFn(`  - ${fmt.path(issue.file)}: filename ID (${fmt.bold(issue.filenameId)}) does not match frontmatter ID (${fmt.bold(issue.frontmatterId)})`);
      }
    });
    logFn('Repair: Fix filename/id mismatch, or remove the stale backlog/tasks copy of a completed/archived task, before drafting.');
    exitFn(1);
    return;
  }

  const branchName = missionBranchName(normalizedSlug, mainRepo);
  logFn(fmt.bold(`Step 1: Setting up branch ${fmt.branch(branchName)}...`));
  ensureMissionBranchFn(mainRepo, branchName, { logFn, baseBranch: recordedBase });

  const targetWorktree = conventionalWorktreePathFn(normalizedSlug, mainRepo);
  logFn(fmt.bold(`Step 2: Ensuring dedicated worktree at ${fmt.path(targetWorktree)}...`));
  ensureWorktreeFn(mainRepo, targetWorktree, branchName, { logFn, errorFn });
  ensureGraphifyWorkspaceFn(targetWorktree, { logFn });
  ensureGraphifyIgnoreFn(targetWorktree, { logFn });

  const gitignoreResult = ensureWorkflowGitignore(targetWorktree, { logFn });
  if (gitignoreResult.created) {
    logFn(fmt.status('PASS', `Created .gitignore with ${gitignoreResult.appended} workflow entries in ${fmt.path(targetWorktree)}`));
  } else if (gitignoreResult.appended > 0) {
    logFn(fmt.status('PASS', `Appended ${gitignoreResult.appended} workflow entries to .gitignore in ${fmt.path(targetWorktree)}`));
  } else if (gitignoreResult.skipped) {
    logFn(fmt.status('INFO', `.gitignore in ${fmt.path(targetWorktree)}: ${gitignoreResult.reason === 'symlink' ? 'symbolic link (skipped)' : 'not a git repo (skipped)'}`));
  } else {
    logFn(fmt.status('PASS', `.gitignore in ${fmt.path(targetWorktree)} already contains all workflow entries`));
  }

  logFn(fmt.bold('Step 3: Scaffolding MISSION.md...'));
  const missionFile = ensureMissionFileFn(targetWorktree, normalizedSlug, { logFn });
  ensureMissionBaseBranchRecordedFn(missionFile, recordedBase, { logFn });

  logFn(fmt.bold('Step 4: Ensuring Backlog task exists in worktree...'));
  if (!bootstrapBacklogTaskFn(targetWorktree, mainRepo, normalizedSlug, { logFn, errorFn, syntheticTask })) {
    const { tasksDir } = getTaskStorage(targetWorktree);
    const taskDirHint = path.relative(targetWorktree, tasksDir).split(path.sep).join('/');
    errorFn(fmt.status('FAIL', `Backlog task for ${normalizedSlug} could not be prepared in the mission worktree.`));
    logFn(`Repair: create the task with your task adapter, or add ${fmt.path(`${taskDirHint}/${normalizedSlug} - <title>.md`)} manually.`);
    exitFn(1);
    return;
  }

  const classificationCheck = validateDraftClassificationFn(normalizedSlug, targetWorktree, {
    errorFn
  });
  if (!classificationCheck.ok) {
    exitFn(1);
    return;
  }

  logFn('\n' + fmt.status('PASS', 'Draft setup complete.'));
  logFn(`Worktree: ${fmt.path(targetWorktree)}`);
  logFn(`Mission doc: ${fmt.path(missionFile)}`);

  if (!transitionTaskFn(normalizedSlug, 'backlog', { rootDir: targetWorktree, log: logFn })) {
    errorFn(fmt.status('FAIL', `Could not transition task ${normalizedSlug} to backlog status.`));
    exitFn(1);
    return;
  }

  // Pre-select the initial family; bookkeeping commit is deferred until after the
  // launch settles so a failed launch cannot leave a stale assignee commit behind.
  const agentConfig = readAgentConfigOrExitFn();
  const agent = preselectedAgent || selectAgentFn('draft', { config: agentConfig });

  const prompt = buildDraftPrompt(normalizedSlug, { rootDir: mainRepo, worktree: targetWorktree });
  logFn('Launching draft agent...');
  const { agent: actualAgent, result } = await startDraftAgentFn({
    prompt,
    worktree: targetWorktree,
    agent
  });
  logFn(`Draft agent family: ${fmt.agent(actualAgent)}`);

  if (result.error) {
    errorFn(fmt.status('FAIL', `Could not start draft agent (${fmt.agent(actualAgent)}): ${result.error.message}`));
    exitFn(1);
    return;
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    errorFn(fmt.status('FAIL', `Draft agent (${fmt.agent(actualAgent)}) exited with status ${result.status}.`));
    exitFn(result.status || 1);
    return;
  }

  const taskResolutionAfter = resolveTaskFileFn(normalizedSlug, targetWorktree);
  recordDraftImplementerFn({
    selected: agent,
    actual: actualAgent,
    taskResolution: taskResolutionAfter,
    slug: normalizedSlug,
    worktree: targetWorktree
  });

  // Record stats from the mission worktree, where the backlog task always lives
  // (a feature-branch task is absent from mainRepo/the primary checkout). This
  // matches how the review and active stages record stats (rootDir: worktree).
  recordDraftStatsFn({
    slug: normalizedSlug,
    rootDir: targetWorktree,
    agentFamily: actualAgent,
    result,
    log: logFn,
    error: errorFn
  });

  // Post-draft mission type repair: if the agent did not produce valid labels,
  // relaunch it once with a targeted fix prompt and validate again.
  const normalizationResult = normalizeDraftClassificationFn(normalizedSlug, targetWorktree, {
    errorFn
  });
  if (!normalizationResult.ok) {
    logFn(fmt.status('WARN', `Post-draft mission type labels are not valid (${normalizationResult.reason}). Relaunching draft agent to repair them.`));
    const restartOk = await restartDraftAgentFn(normalizedSlug, targetWorktree, {
      logFn,
      errorFn,
      exitFn
    });
    if (!restartOk) {
      exitFn(1);
      return;
    }
    const postRestartNorm = normalizeDraftClassificationFn(normalizedSlug, targetWorktree, {
      errorFn
    });
    if (!postRestartNorm.ok) {
      errorFn(fmt.status('FAIL', `Post-draft mission type labels are still invalid after restart (${postRestartNorm.reason}).`));
      exitFn(1);
      return;
    } else {
      logFn(fmt.status('PASS', `Post-draft mission type labels validated after restart: ${postRestartNorm.classification}`));
    }
  } else {
    logFn(fmt.status('PASS', `Post-draft mission type labels validated: ${normalizationResult.classification}`));
  }

  // Re-assert the Base-Branch record after the agent runs so a full MISSION.md
  // rewrite cannot drop it; the safety-harness commit below captures the change.
  ensureMissionBaseBranchRecordedFn(missionFile, recordedBase, { logFn });

  try {
    enforceDraftCommitSafetyFn({ slug: normalizedSlug, worktree: targetWorktree, logFn, errorFn });
  } catch (error) {
    errorFn(fmt.status('FAIL', error.message));
    exitFn(1);
    return;
  }

  if (!transitionVirtualFn(transitionTaskFn, normalizedSlug, 'ready', { rootDir: targetWorktree, log: logFn })) {
    errorFn(fmt.status('FAIL', `Could not transition task ${normalizedSlug} to ready status.`));
    exitFn(1);
    return;
  }

  logFn('\n' + fmt.status('INFO', `Next: ${fmt.command(`cd ${targetWorktree}`)}`));
}

async function draft(args, deps) {
  return runDraftCommand(args, deps);
}

function recordDraftImplementer({
  selected,
  actual,
  taskResolution,
  log = fmt.log.plain,
  enforceTaskAssigneeFn = enforceTaskAssignee,
  gitFn = git,
  slug,
  worktree
}) {
  if (!taskResolution || !taskResolution.ok || !actual) {
    return actual || selected;
  }

  if (selected && actual !== selected) {
    log(fmt.status('INFO', `Draft agent fell back from ${fmt.agent(selected)} to ${fmt.agent(actual)}; enforcing backlog assignee.`));
  } else {
    log(fmt.status('INFO', `Enforcing draft agent ${fmt.agent(actual)} as assignee...`));
  }

  if (enforceTaskAssigneeFn(taskResolution.taskFile, actual)) {
    // Ensure we commit the fallback/recording to the mission branch so it is shared.
    const effectiveWorktree = worktree || resolveWorktree(slug) || process.cwd();
    const relativeTaskPath = path.relative(effectiveWorktree, taskResolution.taskFile);
    gitFn(['-C', effectiveWorktree, 'add', relativeTaskPath]);
    const commitResult = gitFn(['-C', effectiveWorktree, 'commit', '-m', `backlog(${slug}): enforce implementer=${actual}`]);
    if (commitResult.status !== 0) {
      log(fmt.status('WARN', `Failed to commit implementer recording: ${commitResult.stderr}`));
    }
  } else {
    log(fmt.status('WARN', `Could not enforce draft agent ${fmt.agent(actual)} in backlog task.`));
  }
  return actual;
}

function ensureMissionBranch(mainRepo, branchName, {
  gitFn = git,
  logFn = fmt.log.plain,
  squashTrailingBacklogNoiseIntoPreviousMissionFn = squashTrailingBacklogNoiseIntoPreviousMission,
  baseBranch = null
} = {}) {
  const branches = gitFn(['-C', mainRepo, 'branch', '--list', branchName]).stdout.trim();
  if (branches) {
    logFn(fmt.status('PASS', `Branch ${fmt.branch(branchName)} already exists.`));
    return;
  }

  squashTrailingBacklogNoiseIntoPreviousMissionFn(mainRepo, gitFn);

  // The base is whatever HEAD pointed at when draft ran (a feature branch); when
  // none was recorded it falls back to the primary branch — byte-identical to
  // the legacy single-branch behaviour.
  const startPoint = baseBranch || getPrimaryBranch();
  gitFn(['-C', mainRepo, 'branch', branchName, startPoint]);
  logFn(fmt.status('PASS', `Created branch ${fmt.branch(branchName)} from ${fmt.branch(startPoint)}.`));
}

/**
 * Persist the resolved mission base as a single machine-readable `Base-Branch:`
 * line in MISSION.md. Idempotent: a no-op when `baseBranch` is falsy (primary or
 * detached-HEAD launch) or when the correct line is already present. Replaces a
 * stale line in place, otherwise inserts the line just under the title.
 */
function ensureMissionBaseBranchRecorded(missionFile, baseBranch, { logFn = fmt.log.plain } = {}) {
  if (!baseBranch || !missionFile || !fs.existsSync(missionFile)) {
    return false;
  }

  const content = fs.readFileSync(missionFile, 'utf8');
  const line = `Base-Branch: ${baseBranch}`;
  const existing = content.match(/^Base-Branch:\s*(\S+)\s*$/m);
  if (existing && existing[1] === baseBranch) {
    return false;
  }

  let updated;
  if (existing) {
    updated = content.replace(/^Base-Branch:\s*\S+\s*$/m, line);
  } else {
    const lines = content.split('\n');
    const insertAt = lines.length > 0 ? 1 : 0;
    lines.splice(insertAt, 0, '', line);
    updated = lines.join('\n');
  }

  fs.writeFileSync(missionFile, updated);
  logFn(fmt.status('PASS', `Recorded ${line} in ${fmt.path(missionFile)}`));
  return true;
}

function ensureWorktree(mainRepo, targetWorktree, branchName, {
  existsFn = fs.existsSync,
  gitFn = git,
  logFn = fmt.log.plain,
  errorFn = fmt.log.plainError,
  exitFn = process.exit
} = {}) {
  if (existsFn(targetWorktree)) {
    logFn(fmt.status('PASS', `Worktree directory ${fmt.path(targetWorktree)} already exists.`));
    try {
      gitFn(['-C', mainRepo, 'worktree', 'add', targetWorktree, branchName]);
    } catch (error) {
      // Ignore "already exists" style failures; the directory is already usable.
    }
    return;
  }

  try {
    gitFn(['-C', mainRepo, 'worktree', 'add', targetWorktree, branchName]);
    logFn(fmt.status('PASS', `Created worktree at ${fmt.path(targetWorktree)}.`));
  } catch (error) {
    errorFn(fmt.status('FAIL', `Could not create worktree: ${error.message}`));
    exitFn(1);
  }
}

function ensureGraphifyWorkspace(targetWorktree, { logFn = fmt.log.plain } = {}) {
  const targetPath = path.join(targetWorktree, 'graphify-out');

  if (fs.existsSync(targetPath)) {
    try {
      if (fs.lstatSync(targetPath).isDirectory()) {
        logFn(fmt.status('PASS', `graphify-out directory already exists in the mission worktree at ${fmt.path(targetPath)}.`));
        return true;
      }
    } catch (_) {
      // Fall through to the generic warning below.
    }

    logFn(fmt.status('WARN', `${fmt.path(targetPath)} already exists and is not a directory. Leaving it unchanged.`));
    return false;
  }

  fs.mkdirSync(targetPath, { recursive: true });
  logFn(fmt.status('PASS', `Created independent graphify-out directory in the mission worktree at ${fmt.path(targetPath)}.`));
  return true;
}

function ensureGraphifyIgnore(targetWorktree, { gitFn = git, logFn = fmt.log.plain } = {}) {
  const targetPath = path.join(targetWorktree, '.graphifyignore');

  if (fs.existsSync(targetPath) || fs.existsSync(path.join(targetWorktree, '.gitignore'))) {
    logFn(fmt.status('PASS', '.graphifyignore or .gitignore already exists. Leaving unchanged.'));
    return true;
  }

  if (!fs.existsSync(targetWorktree)) {
    logFn(fmt.status('PASS', `Worktree ${fmt.path(targetWorktree)} does not exist yet. .graphifyignore will be created by the draft agent.`));
    return true;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath,
    '# Files owned by the workflow toolkit — not part of the project codebase.\n' +
    '# Prevents graphify from extracting session logs, agent state, and tool caches.\n' +
    '.workflow/\n',
    { encoding: 'utf-8' }
  );

  try {
    const gitRoot = targetWorktree;
    gitFn(['-C', gitRoot, 'add', '.graphifyignore']);
    gitFn(['-C', gitRoot, 'commit', '-m', 'workflow: add .graphifyignore to exclude .workflow/ from graphify']);
    logFn(fmt.status('PASS', `Created and committed .graphifyignore in ${fmt.path(gitRoot)}.`));
  } catch (error) {
    logFn(fmt.status('WARN', `Created .graphifyignore but could not commit: ${error.message}. It will be picked up by the draft safety harness.`));
  }

  return true;
}

function ensureMissionFile(targetWorktree, slug, { logFn = fmt.log.plain } = {}) {
  const missionDir = missionDirForSlug(targetWorktree, slug);
  if (!fs.existsSync(missionDir)) {
    fs.mkdirSync(missionDir, { recursive: true });
  }

  const missionFile = path.join(missionDir, 'MISSION.md');
  if (fs.existsSync(missionFile)) {
    logFn(fmt.status('PASS', `MISSION.md already exists at ${fmt.path(missionFile)}`));
    return missionFile;
  }

  const template = fs.readFileSync(MISSION_SCAFFOLD_PATH, 'utf8').replaceAll('{{slug}}', slug);
  fs.writeFileSync(missionFile, template);
  logFn(fmt.status('PASS', `Scaffolded MISSION.md at ${fmt.path(missionFile)}`));
  logFn(fmt.status('INFO', 'Note: Draft mode involves AI refinement. Use the draft prompt to complete the contract.'));
  return missionFile;
}

function ensureDraftRepoConfigCommitted(mainRepo, {
  getWorktreeStatusFn = getWorktreeStatus,
  errorFn = fmt.log.plainError
} = {}) {
  const dirtyEntries = getWorktreeStatusFn(mainRepo);
  if (!dirtyEntries || dirtyEntries.length === 0) {
    return true;
  }

  const configPaths = new Set([
    'workflow.config.json',
    'backlog/config.yml',
    'config/state-map.json'
  ]);
  const dirtyConfigEntries = dirtyEntries
    .map(parseDirtyEntry)
    .filter(entry => configPaths.has(entry.filePath));

  if (dirtyConfigEntries.length === 0) {
    return true;
  }

  errorFn(fmt.status('FAIL', `Draft preflight: repo-state config that affects mission layout is uncommitted in ${fmt.path(mainRepo)}.`));
  for (const entry of dirtyConfigEntries) {
    errorFn(`  ${entry.status} ${entry.filePath}`);
  }
  errorFn('Commit these repo-state config changes before running draft. Mission worktrees are created from HEAD, so uncommitted config would produce a stale layout.');
  return false;
}

function bootstrapBacklogTask(targetWorktree, mainRepo, slug, {
  resolveTaskFileFn = resolveTaskFile,
  reportTaskResolutionFn = reportTaskResolution,
  gitFn = git,
  logFn = fmt.log.plain,
  errorFn = fmt.log.plainError,
  syntheticTask = null
} = {}) {
  const taskResolution = resolveTaskFileFn(slug, targetWorktree);
  if (taskResolution.ok) {
    logFn(fmt.status('PASS', `Backlog task for ${fmt.slug(slug)} already exists in worktree.`));
    return true;
  }

  if (taskResolution.reason === 'ambiguous') {
    reportTaskResolutionFn(taskResolution, slug, errorFn);
    return false;
  }

  if (syntheticTask) {
    const { tasksDir } = getTaskStorage(targetWorktree);
    const taskPath = path.join(tasksDir, `${slug} - ${slugifyDraftIntent(syntheticTask.title || slug) || 'mission'}.md`);
    const body = [
      '---',
      `id: ${syntheticTask.id || syntheticTaskId(slug, syntheticTask.intent || slug)}`,
      `title: ${syntheticTask.title || slug}`,
      'status: backlog',
      'assignee: []',
      "created_date: '" + new Date().toISOString().slice(0, 16).replace('T', ' ') + "'",
      'labels: [unknown]',
      'dependencies: []',
      'source: synthetic',
      '---',
      '',
      '## Description',
      '',
      syntheticTask.intent || `Synthetic task created for ${slug}.`,
      ''
    ].join('\n');

    fs.mkdirSync(path.dirname(taskPath), { recursive: true });
    fs.writeFileSync(taskPath, body, 'utf8');
    logFn(fmt.status('PASS', `Created synthetic backlog task at ${fmt.path(path.relative(targetWorktree, taskPath))}.`));

    try {
      const relativePath = path.relative(targetWorktree, taskPath);
      gitFn(['-C', targetWorktree, 'add', relativePath]);
      gitFn(['-C', targetWorktree, 'commit', '-m', `backlog(${slug}): create synthetic task`]);
      logFn(fmt.status('PASS', 'Committed synthetic task in worktree.'));
    } catch (error) {
      errorFn(fmt.status('FAIL', `Could not commit synthetic task: ${error.message}`));
      return false;
    }
    return true;
  }

  logFn(fmt.status('INFO', `Backlog task for ${fmt.slug(slug)} not found in worktree. Attempting to bootstrap from ${fmt.path(mainRepo)}...`));
  const mainResolution = resolveTaskFileFn(slug, mainRepo);
  if (!mainResolution.ok) {
    reportTaskResolutionFn(mainResolution, slug, errorFn);
    return false;
  }

  const relativePath = path.relative(mainRepo, mainResolution.taskFile);
  const targetPath = path.join(targetWorktree, relativePath);

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.copyFileSync(mainResolution.taskFile, targetPath);

  logFn(fmt.status('PASS', `Bootstrapped ${fmt.path(relativePath)} from main repo.`));

  try {
    gitFn(['-C', targetWorktree, 'add', relativePath]);
    gitFn(['-C', targetWorktree, 'commit', '-m', `backlog(${slug}): bootstrap task from ${getPrimaryBranch()}`]);
    logFn(fmt.status('PASS', 'Committed bootstrapped task in worktree.'));
  } catch (error) {
    errorFn(fmt.status('FAIL', `Could not commit bootstrapped task: ${error.message}`));
    return false;
  }

  return true;
}

function resolveVerifyCmd(rootDir) {
  return formatVerificationCommand(null, rootDir);
}

function resolveTaskPath(slug, promptRoot) {
  const resolution = resolveTaskFile(slug, promptRoot);
  if (resolution && resolution.ok && resolution.taskFile) {
    return resolution.taskFile;
  }
  return path.join(promptRoot, 'backlog', 'tasks', `<${slug}>.md`);
}

function resolveClassificationInstructions(taskPath) {
  if (taskPath && fs.existsSync(taskPath)) {
    const content = fs.readFileSync(taskPath, 'utf8');
    if (/^source:\s*synthetic\s*$/mi.test(content)) {
      return 'because this task was synthesized by the harness, preserve the `unknown` label unless you have concrete repo-specific evidence to replace it. Do not add a separate frontmatter field for mission type.';
    }
  }
  return 'set exactly one of `ai_sdlc` or `user_value` in the Backlog task labels — plus optionally `bug` for bug-fix missions. Use `ai_sdlc` for workflow, prompt, or agent-fix work; use `user_value` for everything else (including code tech debt). Do not add a separate frontmatter field for mission type.';
}

function buildDraftPrompt(slug, { rootDir = process.cwd(), worktree = null } = {}) {
  const template = fs.readFileSync(DRAFT_PROMPT_PATH, 'utf8');
  const promptRoot = worktree || rootDir;
  const year = getMissionYear(slug, promptRoot) || String(new Date().getFullYear());
  const missionPath = path.join(missionDirForSlug(promptRoot, slug), 'MISSION.md');
  const missionDir = path.dirname(missionPath);
  const taskPath = resolveTaskPath(slug, promptRoot);
  return template
    .replaceAll('{{slug}}', slug)
    .replaceAll('{{year}}', year)
    .replaceAll('{{missionPath}}', missionPath)
    .replaceAll('{{missionDir}}', missionDir)
    .replaceAll('{{taskPath}}', taskPath)
    .replaceAll('{{classificationInstructions}}', resolveClassificationInstructions(taskPath))
    .replaceAll('{{verifyCmd}}', resolveVerifyCmd(promptRoot));
}

function fallbackDraftCommitMessage(slug) {
  return `draft(${slug}): capture agent output`;
}

function validateDraftClassification(slug, worktree, {
  resolveMissionClassificationFn = stats.resolveMissionClassification,
  errorFn = fmt.log.plainError
} = {}) {
  try {
    const { classification, error: classificationError } = resolveMissionClassificationFn(slug, worktree);
    if (!classification) {
      if (classificationError) {errorFn(fmt.status('FAIL', classificationError));}
      return { ok: true, classification: null };
    }
    return { ok: true, classification };
  } catch (error) {
    if (error.message.includes('Missing or invalid classification')) {
      return { ok: true, classification: null };
    }
    errorFn(fmt.status('FAIL', error.message));
    return { ok: false, reason: 'invalid-classification' };
  }
}

function normalizeDraftClassification(slug, worktree, {
  resolveMissionClassificationFn = stats.resolveMissionClassification,
  errorFn = fmt.log.plainError
} = {}) {
  try {
    const { classification, error: classificationError } = resolveMissionClassificationFn(slug, worktree);
    if (!classification) {
      if (classificationError) {errorFn(fmt.status('FAIL', classificationError));}
      return { ok: false, reason: 'missing-classification' };
    }
    return { ok: true, classification };
  } catch (error) {
    if (error.message.includes('Missing or invalid classification')) {
      return { ok: false, reason: 'missing-classification' };
    }
    errorFn(fmt.status('FAIL', error.message));
    return { ok: false, reason: 'invalid-classification' };
  }
}

function buildRestartPrompt(slug, { rootDir = process.cwd(), worktree = null } = {}) {
  return `${buildDraftPrompt(slug, { rootDir, worktree })}

Focused repair:
- update the backlog task so labels contain exactly one of \`ai_sdlc\` or \`user_value\` (plus optionally \`bug\` if this is a bug fix)
- use \`ai_sdlc\` for workflow, prompt, or agent-fix work; use \`user_value\` for everything else, including standard code tech debt
- do not add a separate frontmatter field for mission type
- if both classification labels are present, keep only the correct one
`;
}

async function restartDraftAgent(slug, worktree, {
  selectAgentFn = selectAgent,
  startDraftAgentFn = startDraftAgent,
  readAgentConfigOrExitFn = readAgentConfigOrExit,
  logFn = fmt.log.plain,
  errorFn = fmt.log.plainError
} = {}) {
  const agentConfig = readAgentConfigOrExitFn();
  const agent = selectAgentFn('draft', { config: agentConfig });

  const prompt = buildRestartPrompt(slug, { rootDir: worktree, worktree });
  logFn('Relaunching draft agent to repair mission type labels...');
  const { agent: actualAgent, result } = await startDraftAgentFn({ prompt, worktree, agent });
  logFn(`Restart draft agent family: ${fmt.agent(actualAgent)}`);

  if (result.error) {
    errorFn(fmt.status('FAIL', `Could not restart draft agent (${fmt.agent(actualAgent)}): ${result.error.message}`));
    return false;
  }

  if (typeof result.status === 'number' && result.status !== 0) {
    errorFn(fmt.status('FAIL', `Restart draft agent (${fmt.agent(actualAgent)}) exited with status ${result.status}.`));
    return false;
  }

  return true;
}

function parseDirtyEntry(entry) {
  const match = entry.match(/^(.{1,2})\s+(.*)$/);
  const status = (match ? match[1] : entry.slice(0, 2)).padEnd(2, ' ');
  const rawPath = (match ? match[2] : entry.slice(2)).trim();
  // For renames git reports `<old> -> <new>`; each side is independently quoted
  // and the ` -> ` separator is always literal, so split before unquoting. Both
  // sides must be decoded because git C-escapes any path with a space or unusual
  // byte under core.quotePath — otherwise `git add --` is handed a quote-wrapped
  // pathspec that matches no file and the fallback commit aborts.
  const renameParts = rawPath.includes(' -> ') ? rawPath.split(' -> ') : null;
  const sourcePath = renameParts ? unquoteGitStatusPath(renameParts[0].trim()) : null;
  const filePath = unquoteGitStatusPath(
    renameParts ? renameParts[renameParts.length - 1].trim() : rawPath
  );
  return { status, filePath, sourcePath };
}

function isUnmergedStatus(status) {
  return ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(status);
}

function isDeletedStatus(status) {
  return status.includes('D') && !isUnmergedStatus(status);
}

function isMissionTaskPath(filePath, slug) {
  if (!filePath) {return false;}
  const taskPattern = new RegExp(`^backlog/(?:tasks|completed)/[^/]*${slug}(?:\\b|[^/]*$)`);
  return taskPattern.test(filePath);
}

function isExpectedDraftPath(filePath, slug, worktree) {
  const missionDir = findMissionDir(slug, worktree);
  const missionPrefix = missionDir
    ? `${path.relative(worktree, missionDir)}/`
    : path.relative(worktree, missionDirForSlug(worktree, slug)).split(path.sep).join('/') + '/';
  return filePath.startsWith(missionPrefix) || isMissionTaskPath(filePath, slug);
}

function classifyDraftEntries(dirtyEntries, slug, worktree) {
  const parsedEntries = dirtyEntries.map(parseDirtyEntry);
  const conflictEntries = parsedEntries.filter(entry => isUnmergedStatus(entry.status));
  const stagedEntries = parsedEntries.filter(entry => !isUnmergedStatus(entry.status));
  const expectedEntries = stagedEntries.filter(entry => isExpectedDraftPath(entry.filePath, slug, worktree));
  const unexpectedEntries = stagedEntries.filter(entry => !isExpectedDraftPath(entry.filePath, slug, worktree));

  return { conflictEntries, expectedEntries, unexpectedEntries };
}

function resolveMissionSpecificDraftConflicts({ slug, worktree, conflictEntries, gitImpl = git, logFn = fmt.log.plain }) {
  const sharedConflicts = conflictEntries.filter(entry => !isExpectedDraftPath(entry.filePath, slug, worktree));
  if (sharedConflicts.length > 0) {
    const area = findMissionArea(findMissionDir(slug, worktree) || missionDirForSlug(worktree, slug));
    const sharedFiles = sharedConflicts.map(entry => entry.filePath);
    throw new Error(
      `Draft safety harness found shared-file conflicts: ${sharedFiles.join(', ')}. ` +
      `Run "px resolve-conflict ${slug}" from ${worktree}, then re-run ${formatVerificationCommand(area, worktree)}.`
    );
  }

  if (conflictEntries.length === 0) {
    return;
  }

  logFn(fmt.status('WARN', 'Draft safety harness found mission-specific merge conflicts. Auto-resolving with --theirs:'));
  for (const entry of conflictEntries) {
    logFn(`  ${entry.filePath}`);
    gitImpl(['-C', worktree, 'checkout', '--theirs', '--', entry.filePath]);
    gitImpl(['-C', worktree, 'add', '--', entry.filePath]);
  }
}

function enforceDraftCommitSafety({ slug, worktree, dirtyEntries = getWorktreeStatus(worktree), gitImpl = git, logFn = fmt.log.plain, errorFn = fmt.log.plainError }) {
  if (dirtyEntries.length === 0) {
    logFn(fmt.status('PASS', 'Draft safety harness: no uncommitted changes left behind.'));
    return false;
  }

  logFn(fmt.status('WARN', 'Draft safety harness: draft agent left uncommitted changes. Creating fallback commit.'));
  for (const entry of dirtyEntries) {
    logFn(`  ${entry}`);
  }

  const { conflictEntries, expectedEntries, unexpectedEntries } = classifyDraftEntries(dirtyEntries, slug, worktree);
  resolveMissionSpecificDraftConflicts({ slug, worktree, conflictEntries, gitImpl, logFn, errorFn });

  const deletedTaskEntries = [...expectedEntries, ...unexpectedEntries].filter(entry =>
    isMissionTaskPath(entry.filePath, slug) && isDeletedStatus(entry.status)
  );
  if (deletedTaskEntries.length > 0) {
    throw new Error(
      `Draft safety harness found deletion of the mission backlog task: ${deletedTaskEntries.map(entry => entry.filePath).join(', ')}. ` +
      'Restore the task file and re-run the draft.'
    );
  }

  const renamedTaskEntries = [...expectedEntries, ...unexpectedEntries].filter(entry =>
    entry.sourcePath &&
    isMissionTaskPath(entry.sourcePath, slug) &&
    entry.filePath !== entry.sourcePath
  );
  if (renamedTaskEntries.length > 0) {
    throw new Error(
      `Draft safety harness found rename/move of the mission backlog task: ${renamedTaskEntries.map(entry => `${entry.sourcePath} -> ${entry.filePath}`).join(', ')}. ` +
      'Restore the task file path and re-run the draft.'
    );
  }

  const stagePaths = [...expectedEntries, ...unexpectedEntries].map(entry => entry.filePath);
  if (unexpectedEntries.length > 0) {
    logFn(fmt.status('WARN', 'Draft safety harness: capturing unexpected dirty files alongside mission artifacts:'));
    for (const entry of unexpectedEntries) {
      logFn(`  ${entry.status} ${entry.filePath}`);
    }
  }

  if (stagePaths.length > 0) {
    gitImpl(['-C', worktree, 'add', '--', ...stagePaths]);
  }
  const commitMessage = fallbackDraftCommitMessage(slug);
  const commitResult = gitImpl([
    '-C',
    worktree,
    'commit',
    '-m',
    commitMessage,
    '-m',
    'Safety harness: capture draft worktree changes left uncommitted by the agent.'
  ]);

  if (commitResult.status !== 0) {
    throw new Error('Draft safety harness could not create fallback commit.');
  }

  logFn(fmt.status('PASS', `Draft safety harness committed remaining changes with "${commitMessage}".`));
  return true;
}

function ensureRepoExists(mainRepo, exitFn = process.exit, errorFn = fmt.log.fail) {
  if (!fs.existsSync(mainRepo)) {
    errorFn(`Main repository not found at ${mainRepo}. Please ensure it exists or set PRIMARY_WORKTREE.`);
    exitFn(1);
    return false;
  }
  return true;
}

/**
 * Record a draft-stage stats row after the draft agent completes. Token/usage
 * columns come from the agent result's telemetry (currently Codex only); other
 * families record honest zeros with provider/model set to the family name.
 * Best-effort: a failure here must never fail the draft.
 */
function recordDraftStats({ slug, rootDir, agentFamily, result, log = fmt.log.plain }) {
  if (!result) {return;}
  let durationMinutes = 0;
  if (result.startedAt && result.endedAt) {
    durationMinutes = (Date.parse(result.endedAt) - Date.parse(result.startedAt)) / 60000;
  }
  try {
    const { row } = stats.recordStageStats({
      slug,
      stage: 'draft',
      rootDir,
      implementer: agentFamily,
      model: resolveAgentModel(agentFamily, rootDir),
      telemetry: result.telemetry || null,
      durationMinutes,
    });
    log(fmt.status('INFO', `Draft stats recorded: ${slug} stage=draft provider=${row.provider} model=${row.model} input_tokens=${row.input_tokens} tool_calls=${row.tool_calls}`));
  } catch (err) {
    // Best-effort: never escalate to the fatal `error` channel.
    log(fmt.status('WARN', `Could not record draft stats for ${slug}: ${err.message}`));
  }
}

module.exports = draft;
module.exports.draft = draft;
module.exports.runDraftCommand = runDraftCommand;
module.exports.recordDraftStats = recordDraftStats;
module.exports.buildDraftPrompt = buildDraftPrompt;
module.exports.recordDraftImplementer = recordDraftImplementer;
module.exports.enforceDraftCommitSafety = enforceDraftCommitSafety;
module.exports.fallbackDraftCommitMessage = fallbackDraftCommitMessage;
module.exports.bootstrapBacklogTask = bootstrapBacklogTask;
module.exports.ensureGraphifyWorkspace = ensureGraphifyWorkspace;
module.exports.ensureGraphifyIgnore = ensureGraphifyIgnore;
module.exports.ensureMissionBranch = ensureMissionBranch;
module.exports.ensureMissionBaseBranchRecorded = ensureMissionBaseBranchRecorded;
module.exports.ensureWorktree = ensureWorktree;
module.exports.ensureMissionFile = ensureMissionFile;
module.exports.ensureDraftRepoConfigCommitted = ensureDraftRepoConfigCommitted;
module.exports.ensureRepoExists = ensureRepoExists;
module.exports.classifyDraftEntries = classifyDraftEntries;
module.exports.isUnmergedStatus = isUnmergedStatus;
module.exports.isDeletedStatus = isDeletedStatus;
module.exports.isMissionTaskPath = isMissionTaskPath;
module.exports.isExpectedDraftPath = isExpectedDraftPath;
module.exports.validateDraftClassification = validateDraftClassification;
module.exports.normalizeDraftClassification = normalizeDraftClassification;
module.exports.buildRestartPrompt = buildRestartPrompt;
module.exports.restartDraftAgent = restartDraftAgent;
