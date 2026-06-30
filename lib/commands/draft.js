"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
// @ts-nocheck
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const crypto = __importStar(require("node:crypto"));
const fmt = __importStar(require("../core/fmt.js"));
const git_js_1 = require("../core/git.js");
const agents_js_1 = require("../agents/agents.js");
const backlog_js_1 = require("../tools/backlog.js");
const mission_utils_js_1 = require("../core/mission-utils.js");
const state_map_js_1 = require("../core/state-map.js");
const stats = __importStar(require("./stats.js"));
const verification_js_1 = require("../core/verification.js");
const product_config_js_1 = require("../core/product-config.js");
const gitignore_js_1 = require("../core/gitignore.js");
const active_js_1 = require("./active.js");
const DRAFT_PROMPT_PATH = path.join(__dirname, '..', '..', 'prompts', 'draft.md');
const MISSION_SCAFFOLD_PATH = path.join(__dirname, '..', '..', 'templates', 'mission-scaffold.md');
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
    if (!explicit) {
        return null;
    }
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
async function runDraftCommand(/** @type {string[]} */ args, { inferSlugFn = mission_utils_js_1.inferSlug, resolveMainRepoFn = mission_utils_js_1.resolveMainRepo, conventionalWorktreePathFn = mission_utils_js_1.conventionalWorktreePath, ensureMissionBranchFn = ensureMissionBranch, ensureWorktreeFn = ensureWorktree, ensureGraphifyWorkspaceFn = ensureGraphifyWorkspace, ensureGraphifyIgnoreFn = ensureGraphifyIgnore, ensureMissionFileFn = ensureMissionFile, detectLaunchBaseBranchFn = mission_utils_js_1.detectLaunchBaseBranch, ensureMissionBaseBranchRecordedFn = ensureMissionBaseBranchRecorded, bootstrapBacklogTaskFn = bootstrapBacklogTask, ensureStandaloneMissionBaselineFn = product_config_js_1.ensureStandaloneMissionBaseline, ensureDraftRepoConfigCommittedFn = ensureDraftRepoConfigCommitted, readAgentConfigOrExitFn = agents_js_1.readAgentConfigOrExit, selectAgentFn = agents_js_1.selectAgent, startDraftAgentFn = agents_js_1.startDraftAgent, resolveTaskFileFn = backlog_js_1.resolveTaskFile, reportTaskResolutionFn = backlog_js_1.reportTaskResolution, checkBacklogIntegrityFn = backlog_js_1.checkBacklogIntegrity, ensureRepoExistsFn = ensureRepoExists, transitionTaskFn = backlog_js_1.transitionTask, transitionVirtualFn = state_map_js_1.transitionVirtual, recordDraftImplementerFn = recordDraftImplementer, recordDraftStatsFn = recordDraftStats, enforceDraftCommitSafetyFn = enforceDraftCommitSafety, validateDraftClassificationFn = validateDraftClassification, normalizeDraftClassificationFn = normalizeDraftClassification, restartDraftAgentFn = restartDraftAgent, exitFn = process.exit, logFn = fmt.log.plain, errorFn = fmt.log.plainError } = {}) {
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
    function flagValue(/** @type {string[]} */ arr, /** @type {string} */ flag, /** @type {string} */ name) {
        const i = arr.indexOf(flag);
        if (i === -1) {
            return null;
        }
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
    }
    catch (error) {
        errorFn(fmt.status('FAIL', /** @type {any} */ (error).message));
        exitFn(1);
        return;
    }
    let recordedBase = null;
    if (launchBase && launchBase !== (0, mission_utils_js_1.getPrimaryBranch)(mainRepo)) {
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
                logFn(`  - ${fmt.path(/** @type {any} */ (issue).file)}: task ${fmt.bold(/** @type {any} */ (issue).taskId)} already has a canonical copy in ${fmt.path(/** @type {any} */ (issue).canonicalFile)}; this backlog/tasks copy is stale.`);
            }
            else {
                logFn(`  - ${fmt.path(/** @type {any} */ (issue).file)}: filename ID (${fmt.bold(/** @type {any} */ (issue).filenameId)}) does not match frontmatter ID (${fmt.bold(/** @type {any} */ (issue).frontmatterId)})`);
            }
        });
        logFn('Repair: Fix filename/id mismatch, or remove the stale backlog/tasks copy of a completed/archived task, before drafting.');
        exitFn(1);
        return;
    }
    const branchName = (0, mission_utils_js_1.missionBranchName)(normalizedSlug, mainRepo);
    logFn(fmt.bold(`Step 1: Setting up branch ${fmt.branch(branchName)}...`));
    ensureMissionBranchFn(mainRepo, branchName, { logFn, baseBranch: recordedBase });
    const targetWorktree = conventionalWorktreePathFn(normalizedSlug, mainRepo);
    logFn(fmt.bold(`Step 2: Ensuring dedicated worktree at ${fmt.path(targetWorktree)}...`));
    ensureWorktreeFn(mainRepo, targetWorktree, branchName, { logFn, errorFn });
    ensureGraphifyWorkspaceFn(targetWorktree, { logFn });
    ensureGraphifyIgnoreFn(targetWorktree, { logFn });
    const gitignoreResult = (0, gitignore_js_1.ensureWorkflowGitignore)(targetWorktree, { logFn });
    if (gitignoreResult.created) {
        logFn(fmt.status('PASS', `Created .gitignore with ${gitignoreResult.appended} workflow entries in ${fmt.path(targetWorktree)}`));
    }
    else if (gitignoreResult.appended > 0) {
        logFn(fmt.status('PASS', `Appended ${gitignoreResult.appended} workflow entries to .gitignore in ${fmt.path(targetWorktree)}`));
    }
    else if (gitignoreResult.skipped) {
        logFn(fmt.status('INFO', `.gitignore in ${fmt.path(targetWorktree)}: ${gitignoreResult.reason === 'symlink' ? 'symbolic link (skipped)' : 'not a git repo (skipped)'}`));
    }
    else {
        logFn(fmt.status('PASS', `.gitignore in ${fmt.path(targetWorktree)} already contains all workflow entries`));
    }
    logFn(fmt.bold('Step 3: Scaffolding MISSION.md...'));
    const missionFile = ensureMissionFileFn(targetWorktree, normalizedSlug, { logFn });
    ensureMissionBaseBranchRecordedFn(missionFile, recordedBase, { logFn });
    logFn(fmt.bold('Step 4: Ensuring Backlog task exists in worktree...'));
    if (!bootstrapBacklogTaskFn(targetWorktree, mainRepo, normalizedSlug, { logFn, errorFn, syntheticTask: /** @type {null | undefined} */ (syntheticTask) })) {
        const { tasksDir } = (0, backlog_js_1.getTaskStorage)(targetWorktree);
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
    // @ts-expect-error buildDraftPrompt type mismatch
    const prompt = buildDraftPrompt(normalizedSlug, { rootDir: mainRepo, worktree: targetWorktree || '' });
    logFn('Launching draft agent...');
    const { agent: actualAgent, result } = await startDraftAgentFn({
        prompt,
        // @ts-expect-error worktree not in type
        worktree: targetWorktree,
        agent
    });
    logFn(`Draft agent family: ${fmt.agent(/** @type {any} */ (actualAgent))}`);
    if (result.error) {
        errorFn(fmt.status('FAIL', `Could not start draft agent (${fmt.agent(/** @type {any} */ (actualAgent))}): ${ /** @type {any} */(result.error).message}`));
        exitFn(1);
        return;
    }
    if (typeof /** @type {any} */ (result).status === 'number' && /** @type {any} */ (result).status !== 0) {
        errorFn(fmt.status('FAIL', `Draft agent (${fmt.agent(/** @type {any} */ (actualAgent))}) exited with status ${ /** @type {any} */(result).status}.`));
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
        // @ts-expect-error reportTaskResolutionFn accepts extra properties
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
            // @ts-expect-error restartDraftAgentFn accepts extra properties
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
        }
        else {
            logFn(fmt.status('PASS', `Post-draft mission type labels validated after restart: ${postRestartNorm.classification}`));
        }
    }
    else {
        logFn(fmt.status('PASS', `Post-draft mission type labels validated: ${normalizationResult.classification}`));
    }
    // Re-assert the Base-Branch record after the agent runs so a full MISSION.md
    // rewrite cannot drop it; the safety-harness commit below captures the change.
    ensureMissionBaseBranchRecordedFn(missionFile, recordedBase, { logFn });
    try {
        enforceDraftCommitSafetyFn({ slug: normalizedSlug, worktree: targetWorktree, logFn, errorFn });
    }
    catch (error) {
        errorFn(fmt.status('FAIL', /** @type {any} */ (error).message));
        exitFn(1);
        return;
    }
    if (!transitionVirtualFn(transitionTaskFn, normalizedSlug, 'ready', /** @type {{ rootDir: string, log: Function }} */ ({ rootDir: targetWorktree, log: logFn }))) {
        errorFn(fmt.status('FAIL', `Could not transition task ${normalizedSlug} to ready status.`));
        exitFn(1);
        return;
    }
    logFn('\n' + fmt.status('INFO', `Next: ${fmt.command(`cd ${targetWorktree}`)}`));
}
// @ts-expect-error implicit any on args/deps
async function draft(args, deps) {
    return runDraftCommand(args, deps);
}
function recordDraftImplementer({ 
// @ts-expect-error implicit any binding elements
selected, 
// @ts-expect-error implicit any binding elements
actual, 
// @ts-expect-error implicit any binding elements
taskResolution, log = fmt.log.plain, enforceTaskAssigneeFn = backlog_js_1.enforceTaskAssignee, gitFn = git_js_1.git, 
// @ts-expect-error implicit any binding elements
slug, 
// @ts-expect-error implicit any binding elements
worktree }) {
    if (!taskResolution || !taskResolution.ok || !actual) {
        return actual || selected;
    }
    if (selected && actual !== selected) {
        log(fmt.status('INFO', `Draft agent fell back from ${fmt.agent(selected)} to ${fmt.agent(actual)}; enforcing backlog assignee.`));
    }
    else {
        log(fmt.status('INFO', `Enforcing draft agent ${fmt.agent(actual)} as assignee...`));
    }
    if (enforceTaskAssigneeFn(taskResolution.taskFile, actual)) {
        // Ensure we commit the fallback/recording to the mission branch so it is shared.
        const effectiveWorktree = worktree || (0, mission_utils_js_1.resolveWorktree)(slug) || process.cwd();
        const relativeTaskPath = path.relative(effectiveWorktree, taskResolution.taskFile);
        gitFn(['-C', effectiveWorktree, 'add', relativeTaskPath]);
        const commitResult = gitFn(['-C', effectiveWorktree, 'commit', '-m', `backlog(${slug}): enforce implementer=${actual}`]);
        if (commitResult.status !== 0) {
            log(fmt.status('WARN', `Failed to commit implementer recording: ${commitResult.stderr}`));
        }
    }
    else {
        log(fmt.status('WARN', `Could not enforce draft agent ${fmt.agent(actual)} in backlog task.`));
    }
    return actual;
}
// @ts-expect-error implicit any on mainRepo/branchName
function ensureMissionBranch(mainRepo, branchName, { gitFn = git_js_1.git, logFn = fmt.log.plain, squashTrailingBacklogNoiseIntoPreviousMissionFn = mission_utils_js_1.squashTrailingBacklogNoiseIntoPreviousMission, baseBranch = null } = {}) {
    const branches = gitFn(['-C', mainRepo, 'branch', '--list', branchName]).stdout.trim();
    if (branches) {
        logFn(fmt.status('PASS', `Branch ${fmt.branch(branchName)} already exists.`));
        return;
    }
    squashTrailingBacklogNoiseIntoPreviousMissionFn(mainRepo, gitFn);
    // The base is whatever HEAD pointed at when draft ran (a feature branch); when
    // none was recorded it falls back to the primary branch — byte-identical to
    // the legacy single-branch behaviour.
    const startPoint = baseBranch || (0, mission_utils_js_1.getPrimaryBranch)();
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
    }
    else {
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
function ensureWorktree(mainRepo, targetWorktree, branchName, { existsFn = fs.existsSync, gitFn = git_js_1.git, logFn = fmt.log.plain, errorFn = fmt.log.plainError, exitFn = process.exit } = {}) {
    if (existsFn(targetWorktree)) {
        logFn(fmt.status('PASS', `Worktree directory ${fmt.path(targetWorktree)} already exists.`));
        try {
            gitFn(['-C', mainRepo, 'worktree', 'add', targetWorktree, branchName]);
        }
        catch (error) {
            // Ignore "already exists" style failures; the directory is already usable.
        }
        return;
    }
    try {
        gitFn(['-C', mainRepo, 'worktree', 'add', targetWorktree, branchName]);
        logFn(fmt.status('PASS', `Created worktree at ${fmt.path(targetWorktree)}.`));
    }
    catch (error) {
        errorFn(fmt.status('FAIL', `Could not create worktree: ${ /** @type {any} */(error).message}`));
        exitFn(1);
    }
}
// @ts-expect-error implicit any on targetWorktree
function ensureGraphifyWorkspace(targetWorktree, { logFn = fmt.log.plain } = {}) {
    const targetPath = path.join(targetWorktree, 'graphify-out');
    if (fs.existsSync(targetPath)) {
        try {
            if (fs.lstatSync(targetPath).isDirectory()) {
                logFn(fmt.status('PASS', `graphify-out directory already exists in the mission worktree at ${fmt.path(targetPath)}.`));
                return true;
            }
        }
        catch (_) {
            // Fall through to the generic warning below.
        }
        logFn(fmt.status('WARN', `${fmt.path(targetPath)} already exists and is not a directory. Leaving it unchanged.`));
        return false;
    }
    fs.mkdirSync(targetPath, { recursive: true });
    logFn(fmt.status('PASS', `Created independent graphify-out directory in the mission worktree at ${fmt.path(targetPath)}.`));
    return true;
}
// @ts-expect-error implicit any on targetWorktree
function ensureGraphifyIgnore(targetWorktree, { gitFn = git_js_1.git, logFn = fmt.log.plain } = {}) {
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
    fs.writeFileSync(targetPath, '# Files owned by the workflow toolkit — not part of the project codebase.\n' +
        '# Prevents graphify from extracting session logs, agent state, and tool caches.\n' +
        '.workflow/\n', { encoding: 'utf-8' });
    try {
        const gitRoot = targetWorktree;
        gitFn(['-C', gitRoot, 'add', '.graphifyignore']);
        gitFn(['-C', gitRoot, 'commit', '-m', 'workflow: add .graphifyignore to exclude .workflow/ from graphify']);
        logFn(fmt.status('PASS', `Created and committed .graphifyignore in ${fmt.path(gitRoot)}.`));
    }
    catch (error) {
        logFn(fmt.status('WARN', `Created .graphifyignore but could not commit: ${ /** @type {any} */(error).message}. It will be picked up by the draft safety harness.`));
    }
    return true;
}
// @ts-expect-error implicit any on targetWorktree/slug
function ensureMissionFile(targetWorktree, slug, { logFn = fmt.log.plain } = {}) {
    const missionDir = (0, mission_utils_js_1.missionDirForSlug)(targetWorktree, slug);
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
// @ts-expect-error implicit any on mainRepo
function ensureDraftRepoConfigCommitted(mainRepo, { getWorktreeStatusFn = git_js_1.getWorktreeStatus, errorFn = fmt.log.plainError } = {}) {
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
function bootstrapBacklogTask(targetWorktree, mainRepo, slug, { resolveTaskFileFn = backlog_js_1.resolveTaskFile, reportTaskResolutionFn = backlog_js_1.reportTaskResolution, gitFn = git_js_1.git, logFn = fmt.log.plain, errorFn = fmt.log.plainError, syntheticTask = null } = {}) {
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
        const { tasksDir } = (0, backlog_js_1.getTaskStorage)(targetWorktree);
        const taskPath = path.join(tasksDir, `${slug} - ${slugifyDraftIntent(/** @type {any} */ (syntheticTask).title || slug) || 'mission'}.md`);
        const body = [
            '---',
            `id: ${ /** @type {any} */(syntheticTask).id || syntheticTaskId(slug, /** @type {any} */ (syntheticTask).intent || slug)}`,
            `title: ${ /** @type {any} */(syntheticTask).title || slug}`,
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
        }
        catch (error) {
            errorFn(fmt.status('FAIL', `Could not commit synthetic task: ${ /** @type {any} */(error).message}`));
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
        gitFn(['-C', targetWorktree, 'commit', '-m', `backlog(${slug}): bootstrap task from ${(0, mission_utils_js_1.getPrimaryBranch)()}`]);
        logFn(fmt.status('PASS', 'Committed bootstrapped task in worktree.'));
    }
    catch (error) {
        errorFn(fmt.status('FAIL', `Could not commit bootstrapped task: ${ /** @type {any} */(error).message}`));
        return false;
    }
    return true;
}
// @ts-expect-error implicit any on rootDir
function resolveVerifyCmd(rootDir) {
    return (0, verification_js_1.formatVerificationCommand)(undefined, rootDir);
}
// @ts-expect-error implicit any on slug/promptRoot
function resolveTaskPath(slug, promptRoot) {
    const resolution = (0, backlog_js_1.resolveTaskFile)(slug, promptRoot);
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
    const template = fs.readFileSync(DRAFT_PROMPT_PATH, 'utf8');
    const promptRoot = worktree || rootDir;
    const year = (0, mission_utils_js_1.getMissionYear)(slug, promptRoot) || String(new Date().getFullYear());
    const missionPath = path.join((0, mission_utils_js_1.missionDirForSlug)(promptRoot, slug), 'MISSION.md');
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
// @ts-expect-error implicit any on slug/worktree
function validateDraftClassification(slug, worktree, { resolveMissionClassificationFn = stats.resolveMissionClassification, errorFn = fmt.log.plainError } = {}) {
    try {
        const { classification, error: classificationError } = resolveMissionClassificationFn(slug, worktree);
        if (!classification) {
            if (classificationError) {
                errorFn(fmt.status('FAIL', classificationError));
            }
            return { ok: true, classification: null };
        }
        return { ok: true, classification };
    }
    catch (error) {
        if ( /** @type {any} */(error).message.includes('Missing or invalid classification')) {
            return { ok: true, classification: null };
        }
        errorFn(fmt.status('FAIL', /** @type {any} */ (error).message));
        return { ok: false, reason: 'invalid-classification' };
    }
}
// @ts-expect-error implicit any on slug/worktree
function normalizeDraftClassification(slug, worktree, { resolveMissionClassificationFn = stats.resolveMissionClassification, errorFn = fmt.log.plainError } = {}) {
    try {
        const { classification, error: classificationError } = resolveMissionClassificationFn(slug, worktree);
        if (!classification) {
            if (classificationError) {
                errorFn(fmt.status('FAIL', classificationError));
            }
            return { ok: false, reason: 'missing-classification' };
        }
        return { ok: true, classification };
    }
    catch (error) {
        if ( /** @type {any} */(error).message.includes('Missing or invalid classification')) {
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
async function restartDraftAgent(slug, worktree, { selectAgentFn = agents_js_1.selectAgent, startDraftAgentFn = agents_js_1.startDraftAgent, readAgentConfigOrExitFn = agents_js_1.readAgentConfigOrExit, logFn = fmt.log.plain, errorFn = fmt.log.plainError } = {}) {
    const agentConfig = readAgentConfigOrExitFn();
    const agent = selectAgentFn('draft', { config: agentConfig });
    const prompt = buildRestartPrompt(slug, { rootDir: worktree, worktree });
    logFn('Relaunching draft agent to repair mission type labels...');
    // @ts-expect-error startDraftAgentFn accepts extra properties
    const { agent: actualAgent, result } = await startDraftAgentFn({ prompt, worktree, agent });
    logFn(`Restart draft agent family: ${fmt.agent(/** @type {any} */ (actualAgent))}`);
    if (result.error) {
        errorFn(fmt.status('FAIL', `Could not restart draft agent (${fmt.agent(/** @type {any} */ (actualAgent))}): ${ /** @type {any} */(result.error).message}`));
        return false;
    }
    if (typeof /** @type {any} */ (result).status === 'number' && /** @type {any} */ (result).status !== 0) {
        errorFn(fmt.status('FAIL', `Restart draft agent (${fmt.agent(/** @type {any} */ (actualAgent))}) exited with status ${ /** @type {any} */(result).status}.`));
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
    const sourcePath = renameParts ? (0, active_js_1.unquoteGitStatusPath)(renameParts[0].trim()) : null;
    const filePath = (0, active_js_1.unquoteGitStatusPath)(renameParts ? renameParts[renameParts.length - 1].trim() : rawPath);
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
    if (!filePath) {
        return false;
    }
    const taskPattern = new RegExp(`^backlog/(?:tasks|completed)/[^/]*${slug}(?:\\b|[^/]*$)`);
    return taskPattern.test(filePath);
}
// @ts-expect-error implicit any on filePath/slug/worktree
function isExpectedDraftPath(filePath, slug, worktree) {
    const missionDir = (0, mission_utils_js_1.findMissionDir)(slug, worktree);
    const missionPrefix = missionDir
        ? `${path.relative(worktree, missionDir)}/`
        : path.relative(worktree, (0, mission_utils_js_1.missionDirForSlug)(worktree, slug)).split(path.sep).join('/') + '/';
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
function resolveMissionSpecificDraftConflicts({ slug, worktree, conflictEntries, gitImpl = git_js_1.git, logFn = fmt.log.plain }) {
    const sharedConflicts = conflictEntries.filter((/** @type {any} */ entry) => !isExpectedDraftPath(entry.filePath, slug, worktree));
    if (sharedConflicts.length > 0) {
        const area = (0, mission_utils_js_1.findMissionArea)((0, mission_utils_js_1.findMissionDir)(slug, worktree) || (0, mission_utils_js_1.missionDirForSlug)(worktree, slug));
        const sharedFiles = sharedConflicts.map((/** @type {any} */ entry) => entry.filePath);
        throw new Error(`Draft safety harness found shared-file conflicts: ${sharedFiles.join(', ')}. ` +
            `Run "px resolve-conflict ${slug}" from ${worktree}, then re-run ${(0, verification_js_1.formatVerificationCommand)(area, worktree)}.`);
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
function enforceDraftCommitSafety({ slug, worktree, dirtyEntries = (0, git_js_1.getWorktreeStatus)(worktree), gitImpl = git_js_1.git, logFn = fmt.log.plain, errorFn = fmt.log.plainError }) {
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
    const deletedTaskEntries = [...expectedEntries, ...unexpectedEntries].filter(entry => isMissionTaskPath(entry.filePath, slug) && isDeletedStatus(entry.status));
    if (deletedTaskEntries.length > 0) {
        throw new Error(`Draft safety harness found deletion of the mission backlog task: ${deletedTaskEntries.map(entry => entry.filePath).join(', ')}. ` +
            'Restore the task file and re-run the draft.');
    }
    const renamedTaskEntries = [...expectedEntries, ...unexpectedEntries].filter(entry => entry.sourcePath &&
        isMissionTaskPath(entry.sourcePath, slug) &&
        entry.filePath !== entry.sourcePath);
    if (renamedTaskEntries.length > 0) {
        throw new Error(`Draft safety harness found rename/move of the mission backlog task: ${renamedTaskEntries.map(entry => `${entry.sourcePath} -> ${entry.filePath}`).join(', ')}. ` +
            'Restore the task file path and re-run the draft.');
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
    if (!result) {
        return;
    }
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
            model: (0, product_config_js_1.resolveAgentModel)(agentFamily, rootDir),
            telemetry: result.telemetry || null,
            durationMinutes,
        });
        log(fmt.status('INFO', `Draft stats recorded: ${slug} stage=draft provider=${row.provider} model=${row.model} input_tokens=${row.input_tokens} tool_calls=${row.tool_calls}`));
    }
    catch (err) {
        // Best-effort: never escalate to the fatal `error` channel.
        log(fmt.status('WARN', `Could not record draft stats for ${slug}: ${ /** @type {any} */(err).message}`));
    }
}
/** @type {typeof draft & {draft: typeof draft, runDraftCommand: typeof runDraftCommand, recordDraftStats: typeof recordDraftStats, buildDraftPrompt: typeof buildDraftPrompt, recordDraftImplementer: typeof recordDraftImplementer, enforceDraftCommitSafety: typeof enforceDraftCommitSafety, fallbackDraftCommitMessage: typeof fallbackDraftCommitMessage, bootstrapBacklogTask: typeof bootstrapBacklogTask, ensureGraphifyWorkspace: typeof ensureGraphifyWorkspace, ensureGraphifyIgnore: typeof ensureGraphifyIgnore, ensureMissionBranch: typeof ensureMissionBranch, ensureMissionBaseBranchRecorded: typeof ensureMissionBaseBranchRecorded, ensureWorktree: typeof ensureWorktree, ensureMissionFile: typeof ensureMissionFile, ensureDraftRepoConfigCommitted: typeof ensureDraftRepoConfigCommitted, ensureRepoExists: typeof ensureRepoExists, classifyDraftEntries: typeof classifyDraftEntries, isUnmergedStatus: typeof isUnmergedStatus, isDeletedStatus: typeof isDeletedStatus, isMissionTaskPath: typeof isMissionTaskPath, isExpectedDraftPath: typeof isExpectedDraftPath, validateDraftClassification: typeof validateDraftClassification, normalizeDraftClassification: typeof normalizeDraftClassification, buildRestartPrompt: typeof buildRestartPrompt, restartDraftAgent: typeof restartDraftAgent}} */
const _draftExport = Object.assign(draft, { draft, runDraftCommand, recordDraftStats, buildDraftPrompt, recordDraftImplementer, enforceDraftCommitSafety, fallbackDraftCommitMessage, bootstrapBacklogTask, ensureGraphifyWorkspace, ensureGraphifyIgnore, ensureMissionBranch, ensureMissionBaseBranchRecorded, ensureWorktree, ensureMissionFile, ensureDraftRepoConfigCommitted, ensureRepoExists, classifyDraftEntries, isUnmergedStatus, isDeletedStatus, isMissionTaskPath, isExpectedDraftPath, validateDraftClassification, normalizeDraftClassification, buildRestartPrompt, restartDraftAgent });
module.exports = _draftExport;
