// @ts-nocheck
import type { DraftWorkflowPort, DraftWorkflowContext } from '../../../application/ports/cli-workflows.js';
import { DraftCommandUseCase } from '../../../application/draft-command-use-case.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import * as fmt from '../../../application/presentation/cli-format.js';
import { git, getWorktreeStatus } from '../../git/git.js';
import { startDraftAgent, selectAgent, readAgentConfigOrExit } from '../../agents/agents.js';
import { resolveTaskFile, reportTaskResolution, checkBacklogIntegrity, transitionTask, getTaskStatus, getTaskStorage, getTaskLabels, syncTaskLabelsToBaseWorktree } from '../../backlog/backlog.js';
import { findMissionArea, findMissionDir, inferSlug, getMissionYear, resolveMainRepo, conventionalWorktreePath, squashTrailingBacklogNoiseIntoPreviousMission, resolveWorktree, getPrimaryBranch, missionBranchName, missionDirForSlug, detectLaunchBaseBranch } from '../../filesystem/mission-utils.js';
import { transitionVirtual } from '../../config/state-map.js';
import * as stats from './stats.js';
import { formatVerificationCommand } from '../../verification/verification.js';
import { ensureStandaloneMissionBaseline, resolveAgentModel } from '../../config/product-config.js';
import { ensureWorkflowGitignore } from '../../filesystem/gitignore.js';
import { runtimeAssetStore } from '../../assets/runtime-assets.js';
import { unquoteGitStatusPath } from './active.js';
import { missionId } from '../../../domain/mission.js';

const SYNTHETIC_SLUG_PREFIX = 'adhoc-';

function slugifyDraftIntent(/** @type {string} */ value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^[./\\]+/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 64);
}

function syntheticTaskId(/** @type {string} */ slug, /** @type {string} */ seed) {
  const hash = crypto.createHash('sha1').update(String(seed || slug)).digest('hex').slice(0, 8).toUpperCase();
  const prefix = slug.startsWith(SYNTHETIC_SLUG_PREFIX) ? 'ADHOC' : 'TASK';
  const base = slug
    .replace(/^(task|adhoc)-/i, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .toUpperCase();
  return `${prefix}-${base}-${hash}`;
}

function resolveDraftTarget(/** @type {string} */ rawInput, cwd = process.cwd()) {
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

async function runDraftCommand(/** @type {string[]} */ args, {
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
  missionServicesFn,
  exitFn = process.exit,
  logFn = fmt.log.plain,
  errorFn = fmt.log.plainError
} = {}) {
  // Delegate to the use case/port. Injected dependencies are forwarded
  // through the adapter so characterization tests retain their seams.
  const deps = {
    inferSlugFn,
    resolveMainRepoFn,
    conventionalWorktreePathFn,
    ensureMissionBranchFn,
    ensureWorktreeFn,
    ensureGraphifyWorkspaceFn,
    ensureGraphifyIgnoreFn,
    ensureMissionFileFn,
    detectLaunchBaseBranchFn,
    ensureMissionBaseBranchRecordedFn,
    bootstrapBacklogTaskFn,
    ensureStandaloneMissionBaselineFn,
    ensureDraftRepoConfigCommittedFn,
    readAgentConfigOrExitFn,
    selectAgentFn,
    startDraftAgentFn,
    resolveTaskFileFn,
    reportTaskResolutionFn,
    checkBacklogIntegrityFn,
    ensureRepoExistsFn,
    transitionTaskFn,
    transitionVirtualFn,
    recordDraftImplementerFn,
    recordDraftStatsFn,
    enforceDraftCommitSafetyFn,
    validateDraftClassificationFn,
    normalizeDraftClassificationFn,
    restartDraftAgentFn,
    missionServicesFn,
    exitFn,
    logFn,
    errorFn,
  };
  const adapter = createDraftWorkflowAdapter(deps);
  const useCase = new DraftCommandUseCase(adapter);
  return useCase.execute(args, deps);

}

// @ts-expect-error implicit any on args/deps
async function draft(args, deps) {
  return runDraftCommand(args, deps);
}

async function recordDraftImplementer({
  // @ts-expect-error implicit any binding elements
  selected,
  // @ts-expect-error implicit any binding elements
  actual,
  // @ts-expect-error implicit any binding elements
  taskResolution,
  log = fmt.log.plain,
  transitionTaskFn = transitionTask,
  getTaskStatusFn = getTaskStatus,
  // @ts-expect-error implicit any binding elements
  slug,
  // @ts-expect-error implicit any binding elements
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

  const currentStatus = getTaskStatusFn(taskResolution.taskFile);
  if (!currentStatus || !await transitionTaskFn(slug, currentStatus, {
    implementer: actual,
    rootDir: worktree || resolveWorktree(slug) || process.cwd(),
    log,
    // Draft output is committed immediately after this bookkeeping step.
    // Defer the rebase until that clean boundary instead of racing dirty files.
    deferMissionRebase: true,
  })) {
    log(fmt.status('WARN', `Could not enforce draft agent ${fmt.agent(actual)} in backlog task.`));
  }
  return actual;
}

// @ts-expect-error implicit any on mainRepo/branchName
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
// @ts-expect-error implicit any on missionFile/baseBranch
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

// @ts-expect-error implicit any on mainRepo/targetWorktree/branchName
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
    } catch (_error) {
      // Ignore "already exists" style failures; the directory is already usable.
    }
    return;
  }

  try {
    gitFn(['-C', mainRepo, 'worktree', 'add', targetWorktree, branchName]);
    logFn(fmt.status('PASS', `Created worktree at ${fmt.path(targetWorktree)}.`));
  } catch (error) {
    errorFn(fmt.status('FAIL', `Could not create worktree: ${/** @type {any} */ (error).message}`));
    exitFn(1);
  }
}

// @ts-expect-error implicit any on targetWorktree/mainRepo
function ensureGraphifyWorkspace(targetWorktree, mainRepo, { logFn = fmt.log.plain } = {}) {
  const targetPath = path.join(targetWorktree, 'graphify-out');

  if (fs.existsSync(targetPath)) {
    try {
      if (fs.lstatSync(targetPath).isDirectory()) {
        logFn(fmt.status('PASS', `graphify-out directory already exists in the mission worktree at ${fmt.path(targetPath)}.`));
      } else {
        logFn(fmt.status('WARN', `${fmt.path(targetPath)} already exists and is not a directory. Leaving it unchanged.`));
        return false;
      }
    } catch (_) {
      logFn(fmt.status('WARN', `${fmt.path(targetPath)} already exists and is not a directory. Leaving it unchanged.`));
      return false;
    }
  } else {
    fs.mkdirSync(targetPath, { recursive: true });
    logFn(fmt.status('PASS', `Created independent graphify-out directory in the mission worktree at ${fmt.path(targetPath)}.`));

    // Copy graphify-out contents (graph.json, wiki/, etc.) from the primary worktree
    // so the draft agent has graph context from the start. Scoped to newly-created
    // directories so a re-run of px draft does not clobber a mission worktree's
    // fresher graph with the primary's staler one.
    if (mainRepo) {
      const sourcePath = path.join(mainRepo, 'graphify-out');
      try {
        if (fs.existsSync(sourcePath) && fs.lstatSync(sourcePath).isDirectory()) {
          fs.cpSync(sourcePath, targetPath, { recursive: true, force: true });
          logFn(fmt.status('PASS', `Copied graphify-out contents from primary worktree ${fmt.path(sourcePath)}.`));
        }
      } catch (_) {
        // Graceful degradation: graphify not installed, source unavailable, or copy failed.
        // The empty directory is still created and draft proceeds.
      }
    }
  }

  return true;
}

// @ts-expect-error implicit any on targetWorktree
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
    logFn(fmt.status('WARN', `Created .graphifyignore but could not commit: ${/** @type {any} */ (error).message}. It will be picked up by the draft safety harness.`));
  }

  return true;
}

// @ts-expect-error implicit any on targetWorktree/slug
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

  const template = runtimeAssetStore.readText('templates/mission-scaffold.md').replaceAll('{{slug}}', slug);
  fs.writeFileSync(missionFile, template);
  logFn(fmt.status('PASS', `Scaffolded MISSION.md at ${fmt.path(missionFile)}`));
  logFn(fmt.status('INFO', 'Note: Draft mode involves AI refinement. Use the draft prompt to complete the contract.'));
  return missionFile;
}

// @ts-expect-error implicit any on mainRepo
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

// @ts-expect-error implicit any on targetWorktree/mainRepo/slug
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
    const taskPath = path.join(tasksDir, `${slug} - ${slugifyDraftIntent(/** @type {any} */ (syntheticTask).title || slug) || 'mission'}.md`);
    const body = [
      '---',
      `id: ${/** @type {any} */ (syntheticTask).id || syntheticTaskId(slug, /** @type {any} */ (syntheticTask).intent || slug)}`,
      `title: ${/** @type {any} */ (syntheticTask).title || slug}`,
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
      /** @type {any} */ (syntheticTask).intent || `Synthetic task created for ${slug}.`,
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
      errorFn(fmt.status('FAIL', `Could not commit synthetic task: ${/** @type {any} */ (error).message}`));
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

  // @ts-expect-error mainResolution.taskFile may be undefined
  const relativePath = path.relative(mainRepo, mainResolution.taskFile);
  const targetPath = path.join(targetWorktree || '', relativePath);

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  // @ts-expect-error mainResolution.taskFile may be undefined
  fs.copyFileSync(mainResolution.taskFile, targetPath);

  logFn(fmt.status('PASS', `Bootstrapped ${fmt.path(relativePath)} from main repo.`));

  try {
    gitFn(['-C', targetWorktree, 'add', relativePath]);
    gitFn(['-C', targetWorktree, 'commit', '-m', `backlog(${slug}): bootstrap task from ${getPrimaryBranch()}`]);
    logFn(fmt.status('PASS', 'Committed bootstrapped task in worktree.'));
  } catch (error) {
    errorFn(fmt.status('FAIL', `Could not commit bootstrapped task: ${/** @type {any} */ (error).message}`));
    return false;
  }

  return true;
}

// @ts-expect-error implicit any on rootDir
function resolveVerifyCmd(rootDir) {
  return formatVerificationCommand(undefined, rootDir);
}

// @ts-expect-error implicit any on slug/promptRoot
function resolveTaskPath(slug, promptRoot) {
  const resolution = resolveTaskFile(slug, promptRoot);
  if (resolution && resolution.ok && resolution.taskFile) {
    return resolution.taskFile;
  }
  return path.join(promptRoot, 'backlog', 'tasks', `<${slug}>.md`);
}

// @ts-expect-error implicit any on taskPath
function resolveClassificationInstructions(taskPath) {
  if (taskPath && fs.existsSync(taskPath)) {
    const content = fs.readFileSync(taskPath, 'utf8');
    if (/^source:\s*synthetic\s*$/mi.test(content)) {
      return 'because this task was synthesized by the harness, preserve the `unknown` label unless you have concrete repo-specific evidence to replace it. Do not add a separate frontmatter field for mission type.';
    }
  }
  return 'set exactly one of `ai_sdlc` or `user_value` in the Backlog task labels — plus optionally `bug` for bug-fix missions. Use `ai_sdlc` for workflow, prompt, or agent-fix work; use `user_value` for everything else (including code tech debt). Do not add a separate frontmatter field for mission type.';
}

// @ts-expect-error implicit any on slug/rootDir/worktree
function buildDraftPrompt(slug, { rootDir = process.cwd(), worktree = null } = {}) {
  const template = runtimeAssetStore.readText('prompts/draft.md');
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

// @ts-expect-error implicit any on slug
function fallbackDraftCommitMessage(slug) {
  return `draft(${slug}): capture agent output`;
}

function resolveMissionClassificationResolver(resolveMissionClassificationFn) {
  if (typeof resolveMissionClassificationFn === 'function') {
    return resolveMissionClassificationFn;
  }
  if (typeof stats.resolveMissionClassification === 'function') {
    return stats.resolveMissionClassification;
  }
  throw new TypeError('resolveMissionClassificationFn is not a function');
}

// @ts-expect-error implicit any on slug/worktree
function validateDraftClassification(slug, worktree, {
  resolveMissionClassificationFn = stats.resolveMissionClassification,
  errorFn = fmt.log.plainError
} = {}) {
  try {
    const resolveClassification = resolveMissionClassificationResolver(resolveMissionClassificationFn);
    const { classification, error: classificationError } = resolveClassification(slug, worktree);
    if (!classification) {
      if (classificationError) {errorFn(fmt.status('FAIL', classificationError));}
      return { ok: true, classification: null };
    }
    return { ok: true, classification };
  } catch (error) {
    if (/** @type {any} */ (error).message.includes('Missing or invalid classification')) {
      return { ok: true, classification: null };
    }
    errorFn(fmt.status('FAIL', /** @type {any} */ (error).message));
    return { ok: false, reason: 'invalid-classification' };
  }
}

// @ts-expect-error implicit any on slug/worktree
function normalizeDraftClassification(slug, worktree, {
  resolveMissionClassificationFn = stats.resolveMissionClassification,
  errorFn = fmt.log.plainError
} = {}) {
  try {
    const resolveClassification = resolveMissionClassificationResolver(resolveMissionClassificationFn);
    const { classification, error: classificationError } = resolveClassification(slug, worktree);
    if (!classification) {
      if (classificationError) {errorFn(fmt.status('FAIL', classificationError));}
      return { ok: false, reason: 'missing-classification' };
    }
    return { ok: true, classification };
  } catch (error) {
    if (/** @type {any} */ (error).message.includes('Missing or invalid classification')) {
      return { ok: false, reason: 'missing-classification' };
    }
    errorFn(fmt.status('FAIL', /** @type {any} */ (error).message));
    return { ok: false, reason: 'invalid-classification' };
  }
}

// @ts-expect-error implicit any on slug/rootDir/worktree
function buildRestartPrompt(slug, { rootDir = process.cwd(), worktree = null } = {}) {
  return `${buildDraftPrompt(slug, { rootDir, worktree })}

Focused repair:
- update the backlog task so labels contain exactly one of \`ai_sdlc\` or \`user_value\` (plus optionally \`bug\` if this is a bug fix)
- use \`ai_sdlc\` for workflow, prompt, or agent-fix work; use \`user_value\` for everything else, including standard code tech debt
- do not add a separate frontmatter field for mission type
- if both classification labels are present, keep only the correct one
`;
}

// @ts-expect-error implicit any on slug/worktree
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
  // @ts-expect-error startDraftAgentFn accepts extra properties
  const { agent: actualAgent, result } = await startDraftAgentFn({ prompt, worktree, agent });
  logFn(`Restart draft agent family: ${fmt.agent(/** @type {any} */ (actualAgent))}`);

  if (result.error) {
    errorFn(fmt.status('FAIL', `Could not restart draft agent (${fmt.agent(/** @type {any} */ (actualAgent))}): ${/** @type {any} */ (result.error).message}`));
    return false;
  }

  if (typeof /** @type {any} */ (result).status === 'number' && /** @type {any} */ (result).status !== 0) {
    errorFn(fmt.status('FAIL', `Restart draft agent (${fmt.agent(/** @type {any} */ (actualAgent))}) exited with status ${/** @type {any} */ (result).status}.`));
    return false;
  }

  return true;
}

// @ts-expect-error implicit any on entry
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

// @ts-expect-error implicit any on status
function isUnmergedStatus(status) {
  return ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(status);
}

// @ts-expect-error implicit any on status
function isDeletedStatus(status) {
  return status.includes('D') && !isUnmergedStatus(status);
}

// @ts-expect-error implicit any on filePath/slug
function isMissionTaskPath(filePath, slug) {
  if (!filePath) {return false;}
  const taskPattern = new RegExp(`^backlog/(?:tasks|completed)/[^/]*${slug}(?:\\b|[^/]*$)`);
  return taskPattern.test(filePath);
}

// @ts-expect-error implicit any on filePath/slug/worktree
function isExpectedDraftPath(filePath, slug, worktree) {
  const missionDir = findMissionDir(slug, worktree);
  const missionPrefix = missionDir
    ? `${path.relative(worktree, missionDir)}/`
    : path.relative(worktree, missionDirForSlug(worktree, slug)).split(path.sep).join('/') + '/';
  return filePath.startsWith(missionPrefix) || isMissionTaskPath(filePath, slug);
}

// @ts-expect-error implicit any on dirtyEntries/slug/worktree
function classifyDraftEntries(dirtyEntries, slug, worktree) {
  const parsedEntries = dirtyEntries.map(parseDirtyEntry);
  const conflictEntries = parsedEntries.filter((/** @type {any} */ entry) => isUnmergedStatus(entry.status));
  const stagedEntries = parsedEntries.filter((/** @type {any} */ entry) => !isUnmergedStatus(entry.status));
  const expectedEntries = stagedEntries.filter((/** @type {any} */ entry) => isExpectedDraftPath(entry.filePath, slug, worktree));
  const unexpectedEntries = stagedEntries.filter((/** @type {any} */ entry) => !isExpectedDraftPath(entry.filePath, slug, worktree));

  return { conflictEntries, expectedEntries, unexpectedEntries };
}

// @ts-expect-error implicit any on slug/worktree/conflictEntries
function resolveMissionSpecificDraftConflicts({ slug, worktree, conflictEntries, gitImpl = git, logFn = fmt.log.plain }) {
  const sharedConflicts = conflictEntries.filter((/** @type {any} */ entry) => !isExpectedDraftPath(entry.filePath, slug, worktree));
  if (sharedConflicts.length > 0) {
    const area = findMissionArea(findMissionDir(slug, worktree) || missionDirForSlug(worktree, slug));
    const sharedFiles = sharedConflicts.map((/** @type {any} */ entry) => entry.filePath);
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

// @ts-expect-error implicit any on slug/worktree/dirtyEntries
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
  // @ts-expect-error errorFn not in type
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

// @ts-expect-error implicit any on mainRepo
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
// @ts-expect-error implicit any on slug/rootDir/agentFamily/result
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
    log(fmt.status('WARN', `Could not record draft stats for ${slug}: ${/** @type {any} */ (err).message}`));
  }
}

/** @type {typeof draft & {draft: typeof draft, runDraftCommand: typeof runDraftCommand, recordDraftStats: typeof recordDraftStats, buildDraftPrompt: typeof buildDraftPrompt, recordDraftImplementer: typeof recordDraftImplementer, enforceDraftCommitSafety: typeof enforceDraftCommitSafety, fallbackDraftCommitMessage: typeof fallbackDraftCommitMessage, bootstrapBacklogTask: typeof bootstrapBacklogTask, ensureGraphifyWorkspace: typeof ensureGraphifyWorkspace, ensureGraphifyIgnore: typeof ensureGraphifyIgnore, ensureMissionBranch: typeof ensureMissionBranch, ensureMissionBaseBranchRecorded: typeof ensureMissionBaseBranchRecorded, ensureWorktree: typeof ensureWorktree, ensureMissionFile: typeof ensureMissionFile, ensureDraftRepoConfigCommitted: typeof ensureDraftRepoConfigCommitted, ensureRepoExists: typeof ensureRepoExists, classifyDraftEntries: typeof classifyDraftEntries, isUnmergedStatus: typeof isUnmergedStatus, isDeletedStatus: typeof isDeletedStatus, isMissionTaskPath: typeof isMissionTaskPath, isExpectedDraftPath: typeof isExpectedDraftPath, validateDraftClassification: typeof validateDraftClassification, normalizeDraftClassification: typeof normalizeDraftClassification, buildRestartPrompt: typeof buildRestartPrompt, restartDraftAgent: typeof restartDraftAgent}} */
/**
 * Create a DraftWorkflowPort implementation backed by the adapter's functions.
 * Each port method performs its actual workflow step using the adapter's helper
 * functions. Composition merges `missionServicesFn` into deps at call time.
 */
// @ts-expect-error return type matches DraftWorkflowPort
function createDraftWorkflowAdapter(deps: Record<string, unknown> = {}) {
  const exitFn = (deps.exitFn || process.exit) as (_code?: number) => never;
  const logFn = (deps.logFn || fmt.log.plain) as (_msg: string) => void;
  const errorFn = (deps.errorFn || fmt.log.plainError) as (_msg: string) => void;

  // Helper to create an "exited" context when a step needs to abort
  function exitedContext(partial: Partial<DraftWorkflowContext>): DraftWorkflowContext {
    return {
      exited: true,
      slug: partial.slug || '',
      mainRepo: partial.mainRepo || '',
      targetWorktree: partial.targetWorktree || '',
      missionFile: partial.missionFile || '',
      recordedBase: partial.recordedBase || null,
      syntheticTask: partial.syntheticTask || null,
      agent: partial.agent || '',
      actualAgent: partial.actualAgent || null,
      agentResult: null,
      exitFn,
      logFn,
      errorFn,
      missionServicesFn: partial.missionServicesFn || ((() => {}) as Function),
      options: partial.options || {},
    } as DraftWorkflowContext;
  }

  // Helper: safe exit — call exitFn but return (for testability)
  function safeExit(code: number): boolean {
    try { exitFn(code); } catch { /* exit may throw in tests */ }
    return true;
  }

  return {
    // Preflight: resolve slug, validate repo, baseline, config, task resolution, classification
    preflight: (args: string[], options: Record<string, unknown> = {}): DraftWorkflowContext => {
      const merged = { ...deps, ...options };
      const inferSlugFn = merged.inferSlugFn || inferSlug;
      const resolveMainRepoFn = merged.resolveMainRepoFn || resolveMainRepo;
      const ensureRepoExistsFn = merged.ensureRepoExistsFn || ensureRepoExists;
      const ensureStandaloneMissionBaselineFn = merged.ensureStandaloneMissionBaselineFn || ensureStandaloneMissionBaseline;
      const ensureDraftRepoConfigCommittedFn = merged.ensureDraftRepoConfigCommittedFn || ensureDraftRepoConfigCommitted;
      const detectLaunchBaseBranchFn = merged.detectLaunchBaseBranchFn || detectLaunchBaseBranch;
      const resolveTaskFileFn = merged.resolveTaskFileFn || resolveTaskFile;
      const reportTaskResolutionFn = merged.reportTaskResolutionFn || reportTaskResolution;
      const checkBacklogIntegrityFn = merged.checkBacklogIntegrityFn || checkBacklogIntegrity;

      const explicitInput = args[0];
      const draftTarget = resolveDraftTarget(explicitInput) || { slug: inferSlugFn(explicitInput), syntheticTask: null };
      const slug = draftTarget.slug;
      if (!slug) {
        errorFn(fmt.status('FAIL', 'Usage: px draft <slug> [--agent <family>]'));
        safeExit(1);
        return exitedContext({ slug: '', options });
      }

      const normalizedSlug = slug.toLowerCase();
      const syntheticTask = draftTarget.syntheticTask;

      // Allow operators to pin the agent family via CLI flag
      function flagValue(arr: string[], flag: string, name: string) {
        const i = arr.indexOf(flag);
        if (i === -1) { return null; }
        const v = arr[i + 1];
        if (!v || v.startsWith('--')) {
          errorFn(fmt.status('FAIL', `Missing value for --${name}. Usage: px draft <slug> --${name} <family>`));
          safeExit(1);
          return null;
        }
        return v;
      }
      const preselectedAgent = flagValue(args, '--agent', 'agent');
      logFn(fmt.bold(`Starting mission draft automation for: ${fmt.slug(normalizedSlug)}`));

      const mainRepo = resolveMainRepoFn();
      if (ensureRepoExistsFn(mainRepo, exitFn, errorFn) === false) {
        return exitedContext({ slug: normalizedSlug, mainRepo, options });
      }

      const baselineResult = ensureStandaloneMissionBaselineFn(mainRepo);
      if (baselineResult && baselineResult.failed) {
        errorFn(fmt.status('FAIL', `Standalone mission baseline: ${baselineResult.message}`));
        safeExit(1);
        return exitedContext({ slug: normalizedSlug, mainRepo, options });
      }
      if (baselineResult && baselineResult.committed) {
        logFn(fmt.status('PASS', 'Standalone mission baseline committed in the primary checkout.'));
      }

      if (!ensureDraftRepoConfigCommittedFn(mainRepo, { errorFn })) {
        safeExit(1);
        return exitedContext({ slug: normalizedSlug, mainRepo, options });
      }

      let launchBase: string | null = null;
      try {
        launchBase = detectLaunchBaseBranchFn(process.cwd());
      } catch (error) {
        errorFn(fmt.status('FAIL', /** @type {any} */ (error).message));
        safeExit(1);
        return exitedContext({ slug: normalizedSlug, mainRepo, options });
      }
      let recordedBase: string | null = null;
      if (launchBase && launchBase !== getPrimaryBranch(mainRepo)) {
        recordedBase = launchBase;
        logFn(fmt.status('INFO', `Feature-branch mission: base branch detected as ${fmt.branch(recordedBase)}.`));
      }

      const taskLookupRoot = recordedBase ? process.cwd() : mainRepo;
      const mainResolution = resolveTaskFileFn(normalizedSlug, taskLookupRoot);
      if (!mainResolution.ok && !syntheticTask) {
        reportTaskResolutionFn(mainResolution, normalizedSlug, errorFn);
        safeExit(1);
        return exitedContext({ slug: normalizedSlug, mainRepo, options });
      }

      const relevantIssues = syntheticTask ? [] : checkBacklogIntegrityFn(taskLookupRoot, normalizedSlug);
      if (relevantIssues.length > 0) {
        errorFn(fmt.status('FAIL', `Backlog integrity issues detected for ${normalizedSlug}:`));
        relevantIssues.forEach((issue: any) => {
          if (issue.type === 'duplicate-completed') {
            logFn(`  - ${fmt.path(issue.file)}: task ${fmt.bold(issue.taskId)} already has a canonical copy in ${fmt.path(issue.canonicalFile)}; this backlog/tasks copy is stale.`);
          } else {
            logFn(`  - ${fmt.path(issue.file)}: filename ID (${fmt.bold(issue.filenameId)}) does not match frontmatter ID (${fmt.bold(issue.frontmatterId)})`);
          }
        });
        logFn('Repair: Fix filename/id mismatch, or remove the stale backlog/tasks copy of a completed/archived task, before drafting.');
        safeExit(1);
        return exitedContext({ slug: normalizedSlug, mainRepo, options });
      }

      return {
        exited: false,
        slug: normalizedSlug,
        mainRepo,
        targetWorktree: '',
        missionFile: '',
        recordedBase,
        syntheticTask,
        agent: preselectedAgent || '',
        actualAgent: null,
        agentResult: null,
        exitFn,
        logFn,
        errorFn,
        missionServicesFn: merged.missionServicesFn || ((() => {}) as Function),
        options: merged,
      } as DraftWorkflowContext;
    },

    // Setup: create branch, worktree, graphify workspace, gitignore
    setup: (ctx: DraftWorkflowContext): DraftWorkflowContext => {
      const merged = ctx.options as Record<string, unknown>;
      const ensureMissionBranchFn = merged.ensureMissionBranchFn || ensureMissionBranch;
      const ensureWorktreeFn = merged.ensureWorktreeFn || ensureWorktree;
      const ensureGraphifyWorkspaceFn = merged.ensureGraphifyWorkspaceFn || ensureGraphifyWorkspace;
      const ensureGraphifyIgnoreFn = merged.ensureGraphifyIgnoreFn || ensureGraphifyIgnore;
      const conventionalWorktreePathFn = merged.conventionalWorktreePathFn || conventionalWorktreePath;
      const missionBranchNameFn = missionBranchName;

      const branchName = missionBranchNameFn(ctx.slug, ctx.mainRepo);
      logFn(fmt.bold(`Step 1: Setting up branch ${fmt.branch(branchName)}...`));
      ensureMissionBranchFn(ctx.mainRepo, branchName, { logFn, baseBranch: ctx.recordedBase });

      const targetWorktree = conventionalWorktreePathFn(ctx.slug, ctx.mainRepo);
      logFn(fmt.bold(`Step 2: Ensuring dedicated worktree at ${fmt.path(targetWorktree)}...`));
      ensureWorktreeFn(ctx.mainRepo, targetWorktree, branchName, { logFn, errorFn });
      ensureGraphifyWorkspaceFn(targetWorktree, ctx.mainRepo, { logFn });
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

      return { ...ctx, targetWorktree, missionFile: ctx.missionFile };
    },

    // Scaffold: MISSION.md, base branch record, backlog bootstrap
    scaffold: (ctx: DraftWorkflowContext): DraftWorkflowContext => {
      const merged = ctx.options as Record<string, unknown>;
      const ensureMissionFileFn = merged.ensureMissionFileFn || ensureMissionFile;
      const ensureMissionBaseBranchRecordedFn = merged.ensureMissionBaseBranchRecordedFn || ensureMissionBaseBranchRecorded;
      const bootstrapBacklogTaskFn = merged.bootstrapBacklogTaskFn || bootstrapBacklogTask;

      logFn(fmt.bold('Step 3: Scaffolding MISSION.md...'));
      const missionFile = ensureMissionFileFn(ctx.targetWorktree, ctx.slug, { logFn });
      ensureMissionBaseBranchRecordedFn(missionFile, ctx.recordedBase, { logFn });

      logFn(fmt.bold('Step 4: Ensuring Backlog task exists in worktree...'));
      if (!bootstrapBacklogTaskFn(ctx.targetWorktree, ctx.mainRepo, ctx.slug, { logFn, errorFn, syntheticTask: ctx.syntheticTask })) {
        const { tasksDir } = getTaskStorage(ctx.targetWorktree);
        const taskDirHint = path.relative(ctx.targetWorktree, tasksDir).split(path.sep).join('/');
        errorFn(fmt.status('FAIL', `Backlog task for ${ctx.slug} could not be prepared in the mission worktree.`));
        logFn(`Repair: create the task with your task adapter, or add ${fmt.path(`${taskDirHint}/${ctx.slug} - <title>.md`)} manually.`);
        safeExit(1);
        return exitedContext({ ...ctx, missionFile });
      }

      // Validate classification after task is bootstrapped in worktree
      const validateDraftClassificationFn = merged.validateDraftClassificationFn || validateDraftClassification;
      const classificationCheck = validateDraftClassificationFn(ctx.slug, ctx.targetWorktree, {
        errorFn
      });
      if (!classificationCheck.ok) {
        safeExit(1);
        return exitedContext({ ...ctx, missionFile });
      }

      logFn('\n' + fmt.status('PASS', 'Draft setup complete.'));
      logFn(`Worktree: ${fmt.path(ctx.targetWorktree)}`);
      logFn(`Mission doc: ${fmt.path(missionFile)}`);

      return { ...ctx, missionFile };
    },

    // Intake: materialize mission in SQLite
    intake: async (ctx: DraftWorkflowContext): Promise<DraftWorkflowContext> => {
      const resolveTaskFileFn = (ctx.options as any).resolveTaskFileFn || resolveTaskFile;
      const getTaskLabelsFn = getTaskLabels;

      let missionTitle = ctx.slug;
      try {
        const firstLine = fs.readFileSync(ctx.missionFile, 'utf8').split('\n')[0] || '';
        missionTitle = firstLine.replace(/^#\s*Mission:\s*/i, '').trim() || ctx.slug;
      } catch {
        missionTitle = ctx.slug;
      }
      let taskLabels: string[] = [];
      try {
        const taskResolution = resolveTaskFileFn(ctx.slug, ctx.targetWorktree);
        taskLabels = taskResolution?.ok && taskResolution?.taskFile
          ? getTaskLabelsFn(taskResolution.taskFile)
          : [];
      } catch {
        taskLabels = [];
      }

      let intakeOutcome: any;
      try {
        if (typeof ctx.missionServicesFn !== 'function') { throw new Error('draft command requires injected mission services'); }
        const missionServices = await ctx.missionServicesFn(ctx.targetWorktree);
        intakeOutcome = await missionServices.intake.execute({
          operationId: `draft-intake-${ctx.slug}`,
          missionId: missionId(ctx.slug),
          repositoryId: missionServices.repositoryId,
          title: missionTitle,
          labels: taskLabels,
          rawStatus: 'backlog',
          externalTaskRef: null,
          capabilities: new Set(['mission:intake']),
        });
      } catch (intakeError) {
        errorFn(fmt.status('FAIL', `Mission intake to SQLite failed for ${ctx.slug}: ${/** @type {any} */ (intakeError).message}`));
        logFn('Repair: ensure the operator-local database is reachable, then re-run the draft. The Backlog task was not transitioned.');
        safeExit(1);
        return exitedContext({ ...ctx });
      }

      if (intakeOutcome.status === 'completed') {
        logFn(fmt.status('PASS', `Mission materialized in SQLite (v${intakeOutcome.value.version})`));
      } else if (intakeOutcome.error?.kind === 'conflict') {
        logFn(fmt.status('INFO', `Mission already recorded in SQLite: ${intakeOutcome.error.message}`));
      } else {
        errorFn(fmt.status('FAIL', `Mission intake to SQLite failed for ${ctx.slug}: ${intakeOutcome.error?.message || 'unknown error'}`));
        logFn('Repair: resolve the intake failure above, then re-run the draft. The Backlog task was not transitioned.');
        safeExit(1);
        return exitedContext({ ...ctx });
      }

      return ctx;
    },

    // Transition: backlog task to target status
    transition: async (ctx: DraftWorkflowContext): Promise<DraftWorkflowContext> => {
      const transitionTaskFn = (ctx.options as any).transitionTaskFn || transitionTask;

      if (!await transitionTaskFn(ctx.slug, 'backlog', { rootDir: ctx.targetWorktree, log: ctx.logFn })) {
        errorFn(fmt.status('FAIL', `Could not transition task ${ctx.slug} to backlog status.`));
        safeExit(1);
        return exitedContext({ ...ctx });
      }

      return ctx;
    },

    // Launch agent: read config, select, launch, record
    launchAgent: async (ctx: DraftWorkflowContext): Promise<DraftWorkflowContext> => {
      const merged = ctx.options as Record<string, unknown>;
      const readAgentConfigOrExitFn = merged.readAgentConfigOrExitFn || readAgentConfigOrExit;
      const selectAgentFn = merged.selectAgentFn || selectAgent;
      const startDraftAgentFn = merged.startDraftAgentFn || startDraftAgent;
      const resolveTaskFileFn = merged.resolveTaskFileFn || resolveTaskFile;
      const recordDraftImplementerFn = merged.recordDraftImplementerFn || recordDraftImplementer;
      const recordDraftStatsFn = merged.recordDraftStatsFn || recordDraftStats;

      const agentConfig = readAgentConfigOrExitFn();
      const agent = ctx.agent || selectAgentFn('draft', { config: agentConfig });

      // @ts-expect-error buildDraftPrompt type mismatch
      const prompt = buildDraftPrompt(ctx.slug, { rootDir: ctx.mainRepo, worktree: ctx.targetWorktree || '' });
      logFn('Launching draft agent...');
      const { agent: actualAgent, result } = await startDraftAgentFn({
        prompt,
        // @ts-expect-error worktree not in type
        worktree: ctx.targetWorktree,
        agent
      });
      logFn(`Draft agent family: ${fmt.agent(/** @type {any} */ (actualAgent))}`);

      if (result.error) {
        errorFn(fmt.status('FAIL', `Could not start draft agent (${fmt.agent(/** @type {any} */ (actualAgent))}): ${/** @type {any} */ (result.error).message}`));
        safeExit(1);
        return exitedContext({ ...ctx, agent, actualAgent: actualAgent, agentResult: result });
      }

      if (typeof /** @type {any} */ (result).status === 'number' && /** @type {any} */ (result).status !== 0) {
        errorFn(fmt.status('FAIL', `Draft agent (${fmt.agent(/** @type {any} */ (actualAgent))}) exited with status ${/** @type {any} */ (result).status}.`));
        safeExit(result.status || 1);
        return exitedContext({ ...ctx, agent, actualAgent: actualAgent, agentResult: result });
      }

      const taskResolutionAfter = resolveTaskFileFn(ctx.slug, ctx.targetWorktree);
      recordDraftImplementerFn({
        selected: agent,
        actual: actualAgent,
        taskResolution: taskResolutionAfter,
        slug: ctx.slug,
        worktree: ctx.targetWorktree
      });

      recordDraftStatsFn({
        slug: ctx.slug,
        rootDir: ctx.targetWorktree,
        agentFamily: actualAgent,
        result,
        log: logFn,
        // @ts-expect-error reportTaskResolutionFn accepts extra properties
        error: errorFn
      });

      return { ...ctx, agent, actualAgent: actualAgent, agentResult: result };
    },

    // Post-process: classification normalize, label sync, re-assert base
    postProcess: async (ctx: DraftWorkflowContext): Promise<DraftWorkflowContext> => {
      const merged = ctx.options as Record<string, unknown>;
      const normalizeDraftClassificationFn = merged.normalizeDraftClassificationFn || normalizeDraftClassification;
      const restartDraftAgentFn = merged.restartDraftAgentFn || restartDraftAgent;
      const resolveTaskFileFn = merged.resolveTaskFileFn || resolveTaskFile;
      const ensureMissionBaseBranchRecordedFn = merged.ensureMissionBaseBranchRecordedFn || ensureMissionBaseBranchRecorded;

      const normalizationResult = normalizeDraftClassificationFn(ctx.slug, ctx.targetWorktree, {
        errorFn
      });
      if (!normalizationResult.ok) {
        logFn(fmt.status('WARN', `Post-draft mission type labels are not valid (${normalizationResult.reason}). Relaunching draft agent to repair them.`));
        const restartOk = await restartDraftAgentFn(ctx.slug, ctx.targetWorktree, {
          logFn,
          errorFn,
          // @ts-expect-error restartDraftAgentFn accepts extra properties
          exitFn
        });
        if (!restartOk) {
          safeExit(1);
          return exitedContext({ ...ctx });
        }
        const postRestartNorm = normalizeDraftClassificationFn(ctx.slug, ctx.targetWorktree, {
          errorFn
        });
        if (!postRestartNorm.ok) {
          errorFn(fmt.status('FAIL', `Post-draft mission type labels are still invalid after restart (${postRestartNorm.reason}).`));
          safeExit(1);
          return exitedContext({ ...ctx });
        } else {
          logFn(fmt.status('PASS', `Post-draft mission type labels validated after restart: ${postRestartNorm.classification}`));
        }
      } else {
        logFn(fmt.status('PASS', `Post-draft mission type labels validated: ${normalizationResult.classification}`));
      }

      // Label sync
      try {
        const missionTaskResolution = resolveTaskFileFn(ctx.slug, ctx.targetWorktree);
        if (missionTaskResolution.ok && missionTaskResolution.taskFile) {
          const missionLabels = getTaskLabels(missionTaskResolution.taskFile);
          if (missionLabels.length > 0) {
            const syncOk = syncTaskLabelsToBaseWorktree(ctx.slug, ctx.targetWorktree);
            if (syncOk) {
              logFn(fmt.status('PASS', `Classification labels synced to base worktree: [${missionLabels.join(', ')}]`));
            } else {
              logFn(fmt.status('WARN', `Could not sync labels to base worktree for ${ctx.slug}. Labels remain valid on mission worktree.`));
            }
          }
        }
      } catch (labelSyncError) {
        logFn(fmt.status('WARN', `Label sync skipped: ${/** @type {any} */ (labelSyncError).message}`));
      }

      // Re-assert base branch
      ensureMissionBaseBranchRecordedFn(ctx.missionFile, ctx.recordedBase, { logFn });

      return ctx;
    },

    // Commit safety: capture uncommitted changes
    commitSafety: (ctx: DraftWorkflowContext): DraftWorkflowContext => {
      const enforceDraftCommitSafetyFn = (ctx.options as any).enforceDraftCommitSafetyFn || enforceDraftCommitSafety;

      try {
        enforceDraftCommitSafetyFn({ slug: ctx.slug, worktree: ctx.targetWorktree, logFn, errorFn });
      } catch (error) {
        errorFn(fmt.status('FAIL', /** @type {any} */ (error).message));
        safeExit(1);
        return exitedContext({ ...ctx });
      }

      return ctx;
    },

    // Final transition to 'ready'
    finalTransition: async (ctx: DraftWorkflowContext): Promise<void> => {
      const transitionTaskFn = (ctx.options as any).transitionTaskFn || transitionTask;
      const transitionVirtualFn = (ctx.options as any).transitionVirtualFn || transitionVirtual;

      if (!(await transitionVirtualFn(transitionTaskFn, ctx.slug, 'ready', /** @type {{ rootDir: string, log: Function }} */ ({ rootDir: ctx.targetWorktree, log: ctx.logFn })))) {
        errorFn(fmt.status('FAIL', `Could not transition task ${ctx.slug} to ready status.`));
        safeExit(1);
        return;
      }

      logFn('\n' + fmt.status('INFO', `Next: ${fmt.command(`cd ${ctx.targetWorktree}`)}`));
    },
  } as DraftWorkflowPort;
}

const _draftExport = Object.assign(draft, { draft, runDraftCommand, recordDraftStats, buildDraftPrompt, recordDraftImplementer, enforceDraftCommitSafety, fallbackDraftCommitMessage, bootstrapBacklogTask, ensureGraphifyWorkspace, ensureGraphifyIgnore, ensureMissionBranch, ensureMissionBaseBranchRecorded, ensureWorktree, ensureMissionFile, ensureDraftRepoConfigCommitted, ensureRepoExists, classifyDraftEntries, isUnmergedStatus, isDeletedStatus, isMissionTaskPath, isExpectedDraftPath, validateDraftClassification, normalizeDraftClassification, buildRestartPrompt, restartDraftAgent, createDraftWorkflowAdapter });
export default _draftExport;
export { _draftExport as draft, runDraftCommand, recordDraftStats, buildDraftPrompt, recordDraftImplementer, enforceDraftCommitSafety, fallbackDraftCommitMessage, bootstrapBacklogTask, ensureGraphifyWorkspace, ensureGraphifyIgnore, ensureMissionBranch, ensureMissionBaseBranchRecorded, ensureWorktree, ensureMissionFile, ensureDraftRepoConfigCommitted, ensureRepoExists, classifyDraftEntries, isUnmergedStatus, isDeletedStatus, isMissionTaskPath, isExpectedDraftPath, validateDraftClassification, normalizeDraftClassification, buildRestartPrompt, restartDraftAgent, createDraftWorkflowAdapter };
