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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.transitionTask = void 0;
exports.findTaskFiles = findTaskFiles;
exports.findTaskFile = findTaskFile;
exports.resolveTaskFile = resolveTaskFile;
exports.reportTaskResolution = reportTaskResolution;
exports.checkBacklogIntegrity = checkBacklogIntegrity;
exports.pruneStaleBacklogDuplicates = pruneStaleBacklogDuplicates;
exports.getTaskStorage = getTaskStorage;
exports.getTaskStatus = getTaskStatus;
exports.setTaskStatus = setTaskStatus;
exports.resolveBacklogStateRoot = resolveBacklogStateRoot;
exports.transitionTaskOnIntegrationBranch = transitionTaskOnIntegrationBranch;
exports.commitTaskFileUpdate = commitTaskFileUpdate;
exports.completeTask = completeTask;
exports.getTaskAssignee = getTaskAssignee;
exports.getTaskImplementer = getTaskImplementer;
exports.getTaskFrontmatterValue = getTaskFrontmatterValue;
exports.getTaskClassification = getTaskClassification;
exports.getTaskLabels = getTaskLabels;
exports.hasBugLabel = hasBugLabel;
exports.setTaskAssignee = setTaskAssignee;
exports.setTaskImplementer = setTaskImplementer;
exports.enforceTaskAssignee = enforceTaskAssignee;
exports.getAcceptanceCriteria = getAcceptanceCriteria;
exports.parseAssigneeFamilies = parseAssigneeFamilies;
exports.clearTaskAgentAssignee = clearTaskAgentAssignee;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const git_js_1 = require("../core/git.js");
const agents_js_1 = require("../agents/agents.js");
const fmt = __importStar(require("../core/fmt.js"));
const product_config_js_1 = require("../core/product-config.js");
const mission_utils_js_1 = require("../core/mission-utils.js");
/** @returns {readonly string[]} */
function getSupportedAgents() {
    return agents_js_1.WORKFLOW_AGENT_NAMES;
}
/** @param {string} [rootDir] @returns {{tasksDir: string, completedDir: string, archiveTasksDir: string}} */
function getTaskStorage(rootDir = process.cwd()) {
    return (0, product_config_js_1.resolveTaskStorage)(rootDir);
}
/**
 * @param {string} slug
 * @param {string} [rootDir]
 * @returns {string[]}
 */
function findTaskFiles(slug, rootDir = process.cwd()) {
    const { tasksDir, completedDir, archiveTasksDir: archivedDir } = getTaskStorage(rootDir);
    const sortByBacklogState = (filePath) => {
        if (filePath.startsWith(tasksDir + path_1.default.sep)) {
            return 0;
        }
        if (filePath.startsWith(completedDir + path_1.default.sep)) {
            return 1;
        }
        if (filePath.startsWith(archivedDir + path_1.default.sep)) {
            return 2;
        }
        return 3;
    };
    /** @param {string} dir */
    const scan = (dir) => {
        if (!fs_1.default.existsSync(dir)) {
            return [];
        }
        const files = fs_1.default.readdirSync(dir);
        const normalizedSlug = slug.toLowerCase();
        return files
            .filter((f) => f.toLowerCase().startsWith(normalizedSlug))
            .map((f) => path_1.default.join(dir, f));
    };
    const matches = [...scan(tasksDir), ...scan(completedDir), ...scan(archivedDir)];
    return matches.sort((a, b) => sortByBacklogState(a) - sortByBacklogState(b) || a.localeCompare(b));
}
/**
 * @param {string} slug
 * @param {string} [rootDir]
 * @returns {{ok: boolean, taskFile?: string, matches: string[], reason?: string}}
 */
function resolveTaskFile(slug, rootDir = process.cwd()) {
    let matches = findTaskFiles(slug, rootDir);
    const normalizedId = slug.toUpperCase();
    const { tasksDir, completedDir, archiveTasksDir: archivedDir } = getTaskStorage(rootDir);
    /** @param {string[]} candidateMatches */
    const preferSameTaskInHigherPriorityDir = (candidateMatches) => {
        if (candidateMatches.length < 2) {
            return null;
        }
        const [preferred, ...rest] = candidateMatches;
        return rest.every((match) => path_1.default.basename(match) === path_1.default.basename(preferred)) ? preferred : null;
    };
    /** @param {string[]} candidateFiles @param {string} targetId */
    const findById = (candidateFiles, targetId) => {
        return candidateFiles.filter((f) => {
            try {
                const content = fs_1.default.readFileSync(f, 'utf8');
                const idMatch = content.match(/^id:\s*([^\r\n]+)/m);
                return idMatch && idMatch[1].trim().toUpperCase() === targetId;
            }
            catch (_) {
                return false;
            }
        });
    };
    if (matches.length === 0) {
        // Hardening: If no prefix match, search ALL task files for an exact ID match
        const allFiles = [
            ...(fs_1.default.existsSync(tasksDir) ? fs_1.default.readdirSync(tasksDir).map(f => path_1.default.join(tasksDir, f)) : []),
            ...(fs_1.default.existsSync(completedDir) ? fs_1.default.readdirSync(completedDir).map(f => path_1.default.join(completedDir, f)) : []),
            ...(fs_1.default.existsSync(archivedDir) ? fs_1.default.readdirSync(archivedDir).map(f => path_1.default.join(archivedDir, f)) : []),
        ].filter(f => f.endsWith('.md'));
        const idMatches = findById(allFiles, normalizedId);
        if (idMatches.length === 1) {
            return { ok: true, taskFile: idMatches[0], matches: idMatches };
        }
        // Still no match? Try base task ID if slug has a suffix (e.g., task-1004-modern -> TASK-1004)
        const baseTaskMatch = slug.match(/^(task-\d+)/i);
        if (baseTaskMatch) {
            const baseId = baseTaskMatch[1].toUpperCase();
            const baseMatches = findById(allFiles, baseId);
            if (baseMatches.length === 1) {
                return { ok: true, taskFile: baseMatches[0], matches: baseMatches };
            }
            if (baseMatches.length > 1) {
                const preferred = preferSameTaskInHigherPriorityDir(baseMatches);
                if (preferred) {
                    return { ok: true, taskFile: preferred, matches: baseMatches };
                }
                return { ok: false, reason: 'ambiguous', matches: baseMatches };
            }
        }
        return { ok: false, reason: 'missing', matches: idMatches };
    }
    if (matches.length === 1) {
        // Even if one prefix match exists, verify it doesn't conflict with another ID match
        // or just return it if it's the only one.
        return { ok: true, taskFile: matches[0], matches };
    }
    // Preference 1: Exact frontmatter id: match (e.g., id: TASK-093)
    const idMatches = findById(matches, normalizedId);
    if (idMatches.length === 1) {
        return { ok: true, taskFile: idMatches[0], matches: idMatches };
    }
    if (idMatches.length > 1) {
        const preferred = preferSameTaskInHigherPriorityDir(idMatches);
        if (preferred) {
            return { ok: true, taskFile: preferred, matches: idMatches };
        }
        return { ok: false, reason: 'ambiguous', matches: idMatches };
    }
    // Fallback: If no ID matches but we have filename-prefix matches, 
    // we only allow it if it's unambiguous.
    return { ok: false, reason: 'ambiguous', matches };
}
/**
 * @param {string} slug
 * @param {string} [rootDir]
 * @returns {string|undefined|null}
 */
function findTaskFile(slug, rootDir = process.cwd()) {
    const result = resolveTaskFile(slug, rootDir);
    return result.ok ? result.taskFile : null;
}
/**
 * @param {{ok: boolean, taskFile?: string, matches: string[], reason?: string}} result
 * @param {string} slug
 * @param {Function} [log]
 */
function reportTaskResolution(result, slug, log = fmt.log.plain) {
    if (result.ok) {
        return;
    }
    const { tasksDir, completedDir } = getTaskStorage(process.cwd());
    const taskHint = path_1.default.relative(process.cwd(), tasksDir).split(path_1.default.sep).join('/');
    const completedHint = path_1.default.relative(process.cwd(), completedDir).split(path_1.default.sep).join('/');
    if (result.reason === 'ambiguous') {
        log(fmt.status('FAIL', `Backlog task resolution is ambiguous for slug: ${fmt.slug(slug)}`));
        log(fmt.status('INFO', 'Multiple candidates found:'));
        result.matches.forEach((m) => log(`  - ${m}`));
        log(fmt.status('INFO', 'Repair: Ensure only one task has the filename prefix or matching "id:" frontmatter.'));
    }
    else {
        log(fmt.status('FAIL', `Backlog task for ${fmt.slug(slug)} not found in ${fmt.path(taskHint)}/ or ${fmt.path(completedHint)}/.`));
        log(fmt.status('INFO', 'Create the task file first.'));
        log(fmt.status('INFO', 'Repair: create the task with your task adapter, or add a markdown task file manually.'));
        log(fmt.status('INFO', `Manual fallback: create ${fmt.path(`${taskHint}/${slug} - <title>.md`)} with frontmatter id ${fmt.bold(slug.toUpperCase())}.`));
    }
}
/** @param {string} file @returns {string|null} */
function taskIdFromFilename(file) {
    // Extract ID from filename prefix (e.g., task-093 or task-093.01)
    const filenameMatch = file.match(/^(task-\d+(?:\.\d+)?)/i);
    return filenameMatch ? filenameMatch[1].toUpperCase() : null;
}
/**
 * @param {string} [rootDir]
 * @param {string} [slug]
 * @returns {{file: string, type: string, taskId?: string, canonicalFile?: string}[]}
 */
function checkBacklogIntegrity(rootDir = process.cwd(), slug = null) {
    const { tasksDir, completedDir, archiveTasksDir: archivedDir } = getTaskStorage(rootDir);
    const issues = [];
    const normalizedSlug = slug ? slug.toLowerCase() : null;
    // Track where each task id lives so we can detect the same id appearing in
    // both backlog/tasks/ and backlog/completed/ (or backlog/archive/) — the
    // reorder-recreates-completed-task defect (TASK-1343). The completed/archive
    // copy is canonical; a backlog/tasks/ copy alongside it is stale.
    const tasksLocations = new Map(); // id -> rel path in tasks/
    const canonicalLocations = new Map(); // id -> rel path in completed|archive
    /** @param {string} dir @param {{canonical?: boolean}} [opts] */
    const scan = (dir, { canonical = false } = {}) => {
        if (!fs_1.default.existsSync(dir)) {
            return;
        }
        const files = fs_1.default.readdirSync(dir).filter((f) => f.endsWith('.md'));
        for (const file of files) {
            if (normalizedSlug && !file.toLowerCase().startsWith(normalizedSlug)) {
                continue;
            }
            const filePath = path_1.default.join(dir, file);
            const filenameId = taskIdFromFilename(file);
            if (!filenameId) {
                continue;
            }
            const relPath = path_1.default.relative(rootDir, filePath);
            if (canonical) {
                if (!canonicalLocations.has(filenameId)) {
                    canonicalLocations.set(filenameId, relPath);
                }
            }
            else if (!tasksLocations.has(filenameId)) {
                tasksLocations.set(filenameId, relPath);
            }
            try {
                const content = fs_1.default.readFileSync(filePath, 'utf8');
                // Extract ID from frontmatter
                const idMatch = content.match(/^id:\s*([^\r\n]+)/m);
                if (idMatch) {
                    const frontmatterId = idMatch[1].trim().toUpperCase();
                    if (frontmatterId !== filenameId) {
                        issues.push({
                            file: relPath,
                            type: 'id-mismatch',
                            filenameId,
                            frontmatterId
                        });
                    }
                }
            }
            catch (_) {
                // ignore read errors
            }
        }
    };
    scan(tasksDir);
    scan(completedDir, { canonical: true });
    scan(archivedDir, { canonical: true });
    for (const [id, taskPath] of tasksLocations) {
        const canonicalPath = canonicalLocations.get(id);
        if (canonicalPath) {
            issues.push({
                file: taskPath,
                type: 'duplicate-completed',
                taskId: id,
                canonicalFile: canonicalPath
            });
        }
    }
    return issues;
}
/**
 * Drop backlog/tasks/ copies of task ids whose canonical record already lives
 * in backlog/completed/ or backlog/archive/. Used to make any board mutation
 * (reorder / ordinal write) completed- and archive-aware: the completed copy is
 * treated as canonical and the stale backlog/tasks/ copy is removed. Returns
 * the list of removed { taskId, file, canonicalFile } records. See TASK-1343.
 */
function pruneStaleBacklogDuplicates(rootDir = process.cwd()) {
    const removed = [];
    const duplicates = checkBacklogIntegrity(rootDir)
        .filter(issue => issue.type === 'duplicate-completed');
    for (const dup of duplicates) {
        const absPath = path_1.default.join(rootDir, dup.file);
        try {
            if (fs_1.default.existsSync(absPath)) {
                fs_1.default.rmSync(absPath);
                removed.push({ taskId: dup.taskId, file: dup.file, canonicalFile: dup.canonicalFile });
            }
        }
        catch (_) {
            // ignore removal errors; the integrity gate will still surface the duplicate
        }
    }
    return removed;
}
/** @param {string} taskFilePath @returns {string|null} */
function getTaskStatus(taskFilePath) {
    if (!taskFilePath || !fs_1.default.existsSync(taskFilePath)) {
        return null;
    }
    const content = fs_1.default.readFileSync(taskFilePath, 'utf8');
    // Try YAML first
    const yamlMatch = content.match(/^status:\s*([^\r\n]+)/m);
    if (yamlMatch) {
        return yamlMatch[1].trim().toLowerCase();
    }
    // Try rendered format
    const statusMatch = content.match(/^Status:\s*(.*)$/m);
    if (statusMatch) {
        return statusMatch[1].replace(/^[○●\(\)\s]+/, '').trim().toLowerCase();
    }
    return null;
}
/** @param {string} taskFilePath @param {string} newStatus @returns {boolean} */
function setTaskStatus(taskFilePath, newStatus) {
    if (!taskFilePath || !fs_1.default.existsSync(taskFilePath)) {
        return false;
    }
    let content = fs_1.default.readFileSync(taskFilePath, 'utf8');
    // Update YAML
    const yamlMatch = content.match(/^status:\s*([^\r\n]+)/m);
    if (yamlMatch) {
        content = content.replace(/^status:\s*.*$/m, `status: ${newStatus}`);
    }
    // Update rendered status line (e.g., "Status: ○ backlog")
    // Map internal status to display markers if needed, but for now just text update
    const statusMatch = content.match(/^Status:\s*(.*)$/m);
    if (statusMatch) {
        const original = statusMatch[1];
        // Keep markers like ○ if they exist
        const markerMatch = original.match(/^([○●\(\)\s]+)/);
        const marker = markerMatch ? markerMatch[1] : '';
        content = content.replace(/^Status:\s*.*$/m, `Status: ${marker}${newStatus}`);
    }
    fs_1.default.writeFileSync(taskFilePath, content, 'utf8');
    return true;
}
/**
 * @param {string} slug
 * @param {string} [rootDir]
 * @returns {boolean}
 */
function completeTask(slug, rootDir = process.cwd()) {
    const resolution = resolveTaskFile(slug, rootDir);
    if (!resolution.ok) {
        return false;
    }
    const taskFilePath = /** @type {string} */ (resolution.taskFile);
    if (!taskFilePath) {
        return false;
    }
    const fileName = path_1.default.basename(taskFilePath);
    const { tasksDir, completedDir } = getTaskStorage(rootDir);
    if (!taskFilePath.includes(tasksDir)) {
        // Already in completed or somewhere else
        setTaskStatus(taskFilePath, 'done');
        return true;
    }
    if (!fs_1.default.existsSync(completedDir)) {
        fs_1.default.mkdirSync(completedDir, { recursive: true });
    }
    const targetPath = path_1.default.join(completedDir, fileName);
    // Set status before moving
    setTaskStatus(taskFilePath, 'done');
    fs_1.default.renameSync(taskFilePath, targetPath);
    return true;
}
/**
 * Internal helper to parse assignee families from YAML frontmatter content.
 * Supports inline array, simple inline, and block formats.
 */
/**
 * @param {string} content
 * @returns {{matched: boolean, families: string[]}}
 */
function parseAssigneeFamilies(content) {
    let families = /** @type {string[]} */ ([]);
    let matched = false;
    const lineMatch = content.match(/^assignee:[ \t]*(.*)$/m);
    if (lineMatch) {
        const rest = lineMatch[1].trim();
        if (rest) {
            matched = true;
            // It's some kind of inline form
            const rawValues = rest.startsWith('[') && rest.endsWith(']')
                ? rest.slice(1, -1)
                : rest;
            families = rawValues.split(',')
                .map((s) => s.trim().replace(/^['"]|['"]$/g, '').replace(/^@/, ''))
                .filter((s) => s.length > 0);
        }
    }
    if (!matched) {
        // Try block form
        const blockMatch = content.match(/^assignee:[ \t]*[\r\n]+((?:\s+-\s+.+[\r\n]*)+)/m);
        if (blockMatch) {
            matched = true;
            families = blockMatch[1].split(/[\r\n]+/)
                .map((line) => line.trim())
                .filter((line) => line.startsWith('-'))
                .map((line) => line.substring(1).trim().replace(/^['"]|['"]$/g, '').replace(/^@/, ''))
                .filter((s) => s.length > 0);
        }
    }
    return { matched, families };
}
/**
 * @param {string} taskFilePath
 * @param {string} message
 * @param {string} [rootDir]
 * @returns {boolean|null|void}
 */
function commitTaskFileUpdate(taskFilePath, message, rootDir = process.cwd()) {
    if (!taskFilePath || !fs_1.default.existsSync(taskFilePath)) {
        return;
    }
    // Run `git add/commit` against the worktree the caller intended (rootDir),
    // not whichever branch process.cwd() happens to have checked out. All
    // worktrees share one git object store, so the only thing that pins the
    // commit to the correct mission branch is the `-C <rootDir>` working dir.
    // Fall back to the task file's directory if rootDir isn't supplied or the
    // task file lives outside it (defensive: keeps the add/commit consistent).
    const gitDir = (rootDir && taskFilePath.startsWith(path_1.default.resolve(rootDir) + path_1.default.sep))
        ? rootDir
        : path_1.default.dirname(taskFilePath);
    const relativeTaskPath = path_1.default.relative(gitDir, taskFilePath);
    try {
        (0, git_js_1.git)(['-C', gitDir, 'add', relativeTaskPath]);
        const result = (0, git_js_1.git)(['-C', gitDir, 'commit', '-m', message]);
        if (result.status !== 0) {
            // If there's nothing to commit (e.g. no change), git commit exits with status 1
            // but we should check if it was really a failure or just no-op.
            const statusResult = (0, git_js_1.git)(['-C', gitDir, 'status', '--porcelain', relativeTaskPath]);
            if (statusResult.stdout.trim() === '') {
                return true; // No-op is success
            }
            fmt.log.warn(`Failed to commit task update: ${result.stderr}`);
            return false;
        }
        return true;
    }
    catch ( /** @type {unknown} */e) {
        fmt.log.fail(`Git error during task update: ${e.message}`);
        return false;
    }
}
/** @param {string} taskFilePath @returns {boolean} */
function clearTaskAgentAssignee(taskFilePath) {
    if (!taskFilePath || !fs_1.default.existsSync(taskFilePath)) {
        return false;
    }
    let content = fs_1.default.readFileSync(taskFilePath, 'utf8');
    if (!content.match(/^assignee:/m)) {
        return false;
    }
    const { families } = parseAssigneeFamilies(content);
    const supportedAgents = getSupportedAgents();
    // Separate agent families from human assignees
    const agentFamilies = families.filter((f) => supportedAgents.includes(f.toLowerCase()));
    const humanFamilies = families.filter((f) => !supportedAgents.includes(f.toLowerCase()));
    // If there are no agent families to clear, nothing to do — preserve human assignees
    if (agentFamilies.length === 0) {
        // Write back the human-only assignee list
        if (humanFamilies.length > 0) {
            const hasBlockForm = content.match(/^assignee:[ \t]*[\r\n]+/);
            if (humanFamilies.length === families.length) {
                // All families were human; no change needed
                return false;
            }
            // Remove agent families and write back human-only
            let newAssigneeLine;
            if (hasBlockForm) {
                newAssigneeLine = 'assignee:\n' + humanFamilies.map((f) => `  - ${f}`).join('\n') + '\n';
            }
            else {
                newAssigneeLine = `assignee: [${humanFamilies.join(', ')}]`;
            }
            if (content.match(/^assignee:\s*\[.*?\]/m)) {
                content = content.replace(/^assignee:\s*\[.*?\]/m, newAssigneeLine);
            }
            else if (content.match(/^assignee:[ \t]*[\r\n]+((?:[ \t]+-[ \t]+.+[\r\n]*)+)/m)) {
                content = content.replace(/^assignee:[ \t]*[\r\n]+((?:[ \t]+-[ \t]+.+[\r\n]*)+)/m, newAssigneeLine);
            }
            else {
                content = content.replace(/^assignee:[ \t]*.*$/m, newAssigneeLine);
            }
            fs_1.default.writeFileSync(taskFilePath, content, 'utf8');
            return true;
        }
        return false;
    }
    const hasBlockForm = content.match(/^assignee:\s*\n((?:\s+-\s+.+\r?\n?)+)/m);
    if (!hasBlockForm) {
        // Inline array form: replace with human-only agents
        const newAssignee = humanFamilies.length > 0 ? `[${humanFamilies.join(', ')}]` : '[]';
        content = content.replace(/^assignee:\s*\[.*?\]/m, `assignee: ${newAssignee}`);
    }
    else {
        // Block form: remove agent lines, keep human lines
        let newBlock = content.replace(/^assignee:[ \t]*[\r\n]+/m, 'assignee:\n');
        const blockLines = newBlock.match(/^assignee:\n((?:\s+-\s+.+\n?)*)/m);
        if (blockLines) {
            const keptLines = blockLines[1].split('\n').filter(line => {
                const m = line.match(/^\s+-\s+(.+)/);
                if (!m) {
                    return line.trim() === '';
                }
                const family = m[1].trim().replace(/^['"]|['"]$/g, '');
                return !supportedAgents.includes(family.toLowerCase());
            }).join('\n');
            newBlock = newBlock.replace(/^assignee:\n((?:\s+-\s+.+\n?)*)/m, 'assignee:\n' + keptLines);
            if (newBlock.endsWith('assignee:\n') || newBlock.endsWith('assignee: \n') || newBlock.endsWith('assignee:\n\n')) {
                newBlock = newBlock.replace(/assignee:\s*\n\s*$/, 'assignee: []\n');
            }
            content = newBlock;
        }
        else {
            content = content.replace(/^assignee:\s*\[.*?\]/m, `assignee: []`);
        }
    }
    fs_1.default.writeFileSync(taskFilePath, content, 'utf8');
    return true;
}
/**
 * Transition a task to a new status, optionally enforcing an implementer,
 * restoring a prior assignee, or clearing agent assignees,
 * and commit the change to the mission branch.
 */
/**
 * @param {string} slug
 * @param {string} newStatus
 * @param {{implementer?: string|null, clearAssignee?: boolean, rootDir?: string, log?: Function}} [opts]
 * @returns {boolean}
 */
function transitionTaskLocal(slug, newStatus, { implementer = null, clearAssignee = false, rootDir = process.cwd(), log = fmt.log.plain } = {}) {
    const resolution = resolveTaskFile(slug, rootDir);
    if (!resolution.ok) {
        log(fmt.status('WARN', `Could not transition task ${fmt.slug(slug)}: ${resolution.reason}`));
        return false;
    }
    const taskFile = resolution.taskFile;
    // Guard: reject suffixed slugs (e.g. "task-1048-regress") to prevent
    // resolveTaskFile's base-ID fallback from silently committing to the
    // wrong task file when the slug's base ID does not match the resolved
    // file's frontmatter id.  See TASK-1265 for the original incident.
    const slugHasSuffix = /^(task-\d+)-/i.test(slug);
    if (slugHasSuffix) {
        log(fmt.status('WARN', `Task ${fmt.slug(slug)} rejected: slug "${slug}" has a suffix; ` +
            'use the exact task id instead to avoid committing to the wrong file.'));
        return false;
    }
    let changed = false;
    if (implementer) {
        if (enforceTaskAssignee(taskFile, implementer)) {
            changed = true;
        }
    }
    else if (clearAssignee) {
        if (clearTaskAgentAssignee(taskFile)) {
            changed = true;
        }
    }
    const currentStatus = getTaskStatus(taskFile);
    if (currentStatus !== newStatus) {
        if (setTaskStatus(taskFile, newStatus)) {
            changed = true;
        }
    }
    if (changed) {
        let msg = `backlog(${slug}): transition to ${newStatus}`;
        if (implementer) {
            msg += ` and implementer=${implementer}`;
        }
        if (commitTaskFileUpdate(taskFile, msg, rootDir)) {
            log(fmt.status('PASS', `Task ${fmt.slug(slug)} transitioned to ${newStatus}${implementer ? ' (assignee=' + fmt.agent(implementer) + ')' : ''} and committed.`));
            return true;
        }
        return false;
    }
    return true; // Already in the desired state
}
/**
 * Resolve the checkout that owns a mission's durable Backlog state.  The
 * recorded feature base wins; missions without one retain main's legacy role.
 */
function resolveBacklogStateRoot(slug, missionRoot = process.cwd()) {
    const currentBranch = (0, git_js_1.git)(['-C', missionRoot, 'branch', '--show-current']);
    if (currentBranch.status === 0 && currentBranch.stdout.trim() && !currentBranch.stdout.trim().startsWith('mission/')) {
        return missionRoot;
    }
    return (0, mission_utils_js_1.resolveBaseWorktree)(slug, { rootDir: missionRoot });
}
/**
 * Apply a mission lifecycle transition where Backlog is authoritative, then
 * bring the mission worktree forward to the branch that received the update.
 * This deliberately composes the established worktree and git abstractions;
 * callers must not write a mission-worktree copy of backlog.md directly.
 */
function transitionTaskOnIntegrationBranch(slug, newStatus, { implementer = null, clearAssignee = false, rootDir = process.cwd(), log = fmt.log.plain } = {}) {
    let stateRoot;
    try {
        stateRoot = resolveBacklogStateRoot(slug, rootDir);
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        log(fmt.status('WARN', `Could not resolve integration branch for ${fmt.slug(slug)}: ${detail}`));
        return false;
    }
    if (!transitionTaskLocal(slug, newStatus, { implementer, clearAssignee, rootDir: stateRoot, log })) {
        return false;
    }
    const missionWorktree = (0, mission_utils_js_1.resolveWorktree)(slug, { cwd: rootDir });
    if (!missionWorktree || missionWorktree === stateRoot) {
        return true;
    }
    const baseBranch = (0, mission_utils_js_1.resolveMissionBaseBranch)(slug, missionWorktree);
    const result = (0, git_js_1.git)(['-C', missionWorktree, 'rebase', baseBranch]);
    if (result.status !== 0) {
        const detail = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
        const abort = (0, git_js_1.git)(['-C', missionWorktree, 'rebase', '--abort']);
        const abortDetail = abort.status === 0
            ? ' Rebase aborted; the mission worktree was restored to its pre-rebase state.'
            : ` Rebase abort also failed${[abort.stdout, abort.stderr].filter(Boolean).join('\n').trim() ? ': ' + [abort.stdout, abort.stderr].filter(Boolean).join('\n').trim() : '.'}`;
        log(fmt.status('WARN', `Backlog state updated on integration branch, but mission/${slug} could not rebase onto ${baseBranch}${detail ? ': ' + detail : '.'}${abortDetail}`));
        return false;
    }
    log(fmt.status('PASS', `Rebased mission/${slug} onto ${baseBranch} after Backlog state update.`));
    return true;
}
// Public lifecycle seam. Existing command injection and mocks retain this name,
// while every production caller now receives integration-branch behavior.
const transitionTask = transitionTaskOnIntegrationBranch;
exports.transitionTask = transitionTask;
/** @param {string} taskFilePath @returns {string|null} */
function getTaskAssignee(taskFilePath) {
    if (!taskFilePath || !fs_1.default.existsSync(taskFilePath)) {
        return null;
    }
    const content = fs_1.default.readFileSync(taskFilePath, 'utf8');
    const { families } = parseAssigneeFamilies(content);
    return families.length > 0 ? families[0] : null;
}
/** @param {string} taskFilePath @returns {string|null} */
function getTaskImplementer(taskFilePath) {
    if (!taskFilePath || !fs_1.default.existsSync(taskFilePath)) {
        return null;
    }
    const content = fs_1.default.readFileSync(taskFilePath, 'utf8');
    const { families } = parseAssigneeFamilies(content);
    const normalizedFamilies = families.map((f) => f.toLowerCase());
    const supportedAgents = getSupportedAgents();
    return normalizedFamilies.find((f) => supportedAgents.includes(f)) || null;
}
/** @param {string} taskFilePath @param {string} field @returns {string|null} */
function getTaskFrontmatterValue(taskFilePath, field) {
    if (!taskFilePath || !fs_1.default.existsSync(taskFilePath)) {
        return null;
    }
    const content = fs_1.default.readFileSync(taskFilePath, 'utf8');
    const pattern = new RegExp(`^${field}:\\s*([^\\r\\n]+)`, 'mi');
    const match = content.match(pattern);
    if (!match) {
        return null;
    }
    const value = match[1].trim().replace(/^['"]|['"]$/g, '');
    return value || null;
}
const CLASSIFICATION_LABELS = new Set(['ai_sdlc', 'user_value', 'unknown']);
/**
 * Parse all labels from a task file's frontmatter, supporting both block
 * and inline YAML formats. Returns a lowercased array of label strings.
 * When both formats are present, block labels take precedence (inline is
 * treated as a fallback when no block labels are found).
 */
/** @param {string} taskFilePath */
function getTaskLabels(taskFilePath) {
    if (!taskFilePath || !fs_1.default.existsSync(taskFilePath)) {
        return [];
    }
    const content = fs_1.default.readFileSync(taskFilePath, 'utf8');
    const blockMatch = content.match(/^labels:[ \t]*[\r\n]+((?:\s+-\s+.+[\r\n]*)+)/m);
    if (blockMatch) {
        return blockMatch[1].split(/[\r\n]+/)
            .map(line => line.trim())
            .filter(line => line.startsWith('-'))
            .map(line => line.substring(1).trim().replace(/^['"]|['"]$/g, ''))
            .map(s => s.toLowerCase())
            .filter(s => s.length > 0);
    }
    const inlineMatch = content.match(/^labels:[ \t]*\[(.*?)\]/m);
    if (inlineMatch) {
        return inlineMatch[1].split(',')
            .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
            .map(s => s.toLowerCase())
            .filter(s => s.length > 0);
    }
    return [];
}
/** @param {string} taskFilePath */
function getTaskClassification(taskFilePath) {
    if (!taskFilePath || !fs_1.default.existsSync(taskFilePath)) {
        return null;
    }
    const labels = getTaskLabels(taskFilePath);
    const matches = new Set();
    for (const label of labels) {
        if (CLASSIFICATION_LABELS.has(label)) {
            matches.add(label);
        }
    }
    return matches.size === 1 ? [...matches][0] : null;
}
/** @param {string} taskFilePath */
function hasBugLabel(taskFilePath) {
    const labels = getTaskLabels(taskFilePath);
    return labels.includes('bug');
}
/**
 * @param {string} taskFilePath
 * @param {string} agentFamily
 * @param {{promote?: boolean}} [opts]
 * @returns {boolean}
 */
function setTaskAssignee(taskFilePath, agentFamily, { promote = true } = {}) {
    if (!taskFilePath || !fs_1.default.existsSync(taskFilePath)) {
        return false;
    }
    let content = fs_1.default.readFileSync(taskFilePath, 'utf8');
    const { matched, families } = parseAssigneeFamilies(content);
    if (matched) {
        const lowerAgentFamily = agentFamily.toLowerCase();
        const existingIndex = families.findIndex((f) => f.toLowerCase() === lowerAgentFamily);
        if (existingIndex !== 0) {
            if (existingIndex !== -1) {
                if (!promote) {
                    return false;
                } // Already in the list, and we don't want to move it
                // Remove existing to promote to first
                families.splice(existingIndex, 1);
            }
            if (promote) {
                families.unshift(agentFamily);
            }
            else {
                families.push(agentFamily);
            }
            const newAssignees = `assignee: [${families.join(', ')}]`;
            // Replace whatever form was there with a normalized inline array form
            if (content.match(/^assignee:\s*\[.*?\]/m)) {
                content = content.replace(/^assignee:\s*\[.*?\]/m, newAssignees);
            }
            else if (content.match(/^assignee:\s*\n((?:\s+-\s+.+\r?\n?)+)/m)) {
                content = content.replace(/^assignee:\s*\n((?:\s+-\s+.+\r?\n?)+)/m, newAssignees + '\n');
            }
            else {
                // Fallback for simple form
                content = content.replace(/^assignee:\s*.*$/m, newAssignees);
            }
            fs_1.default.writeFileSync(taskFilePath, content, 'utf8');
            return true;
        }
        return false; // Already authoritative (at index 0)
    }
    // No assignee line exists — insert one after the id frontmatter line
    const insertMatch = content.match(/^(id:.*)/m);
    if (insertMatch && insertMatch.index !== undefined) {
        const insertPos = insertMatch.index + insertMatch[0].length;
        const newLine = '\nassignee: [' + agentFamily + ']';
        content = content.slice(0, insertPos) + newLine + content.slice(insertPos);
        fs_1.default.writeFileSync(taskFilePath, content, 'utf8');
        return true;
    }
    return false;
}
/** @param {string} taskFilePath @param {string} agentFamily @returns {boolean} */
function setTaskImplementer(taskFilePath, agentFamily) {
    if (!taskFilePath || !fs_1.default.existsSync(taskFilePath)) {
        return false;
    }
    let content = fs_1.default.readFileSync(taskFilePath, 'utf8');
    const { matched, families } = parseAssigneeFamilies(content);
    // Separate humans from recognized agents
    const supportedAgents = getSupportedAgents();
    const preservedFamilies = families.filter(f => !supportedAgents.includes(f.toLowerCase()));
    // To ensure the new implementer is authoritative for getTaskImplementer(),
    // it MUST be the first recognized agent in the list.
    const nextFamilies = [agentFamily, ...preservedFamilies];
    if (matched) {
        const normalizedCurrent = families.map((f) => f.toLowerCase());
        const normalizedNext = nextFamilies.map((f) => f.toLowerCase());
        // Check if the first agent is already the one we want to set
        if (normalizedCurrent.length > 0 && normalizedCurrent[0] === agentFamily.toLowerCase()) {
            // If the rest of the list is also the same, it's a no-op
            if (normalizedCurrent.length === normalizedNext.length &&
                normalizedCurrent.every((f, /** @type {number} */ i) => f === normalizedNext[i])) {
                return false;
            }
        }
        const newAssignees = `assignee: [${nextFamilies.join(', ')}]`;
        if (content.match(/^assignee:\s*\[.*?\]/m)) {
            content = content.replace(/^assignee:\s*\[.*?\]/m, newAssignees);
        }
        else if (content.match(/^assignee:\s*\n((?:\s+-\s+.+\r?\n?)+)/m)) {
            content = content.replace(/^assignee:\s*\n((?:\s+-\s+.+\r?\n?)+)/m, newAssignees + '\n');
        }
        else {
            content = content.replace(/^assignee:\s*.*$/m, newAssignees);
        }
        fs_1.default.writeFileSync(taskFilePath, content, 'utf8');
        return true;
    }
    const insertMatch = content.match(/^(id:.*)/m);
    if (insertMatch && insertMatch.index !== undefined) {
        const insertPos = insertMatch.index + insertMatch[0].length;
        const newLine = '\nassignee: [' + agentFamily + ']';
        content = content.slice(0, insertPos) + newLine + content.slice(insertPos);
        fs_1.default.writeFileSync(taskFilePath, content, 'utf8');
        return true;
    }
    return false;
}
/** @param {string} taskFilePath @param {string} agentFamily @returns {boolean} */
function enforceTaskAssignee(taskFilePath, agentFamily) {
    if (!taskFilePath || !fs_1.default.existsSync(taskFilePath)) {
        return false;
    }
    let content = fs_1.default.readFileSync(taskFilePath, 'utf8');
    const { families } = parseAssigneeFamilies(content);
    if (families.length === 1 && families[0] === agentFamily) {
        return true;
    }
    const newAssignee = `assignee: [${agentFamily}]`;
    if (content.match(/^assignee:[ \t]*[\r\n]+((?:[ \t]+-[ \t]+.+[\r\n]*)+)/m)) {
        content = content.replace(/^assignee:[ \t]*[\r\n]+((?:[ \t]+-[ \t]+.+[\r\n]*)+)/m, newAssignee + '\n');
    }
    else if (content.match(/^assignee:[ \t]*.*$/m)) {
        content = content.replace(/^assignee:[ \t]*.*$/m, newAssignee);
    }
    else {
        const insertMatch = content.match(/^(id:.*)/m);
        if (!insertMatch || insertMatch.index === undefined) {
            return false;
        }
        const insertPos = insertMatch.index + insertMatch[0].length;
        content = content.slice(0, insertPos) + '\n' + newAssignee + content.slice(insertPos);
    }
    fs_1.default.writeFileSync(taskFilePath, content, 'utf8');
    return true;
}
/** @param {string} taskFilePath @returns {string[]} */
function getAcceptanceCriteria(taskFilePath) {
    if (!taskFilePath || !fs_1.default.existsSync(taskFilePath)) {
        return [];
    }
    const content = fs_1.default.readFileSync(taskFilePath, 'utf8');
    const sectionMatch = content.match(/## Acceptance Criteria\s*\n([\s\S]*?)(?:\n## |\nDefinition of Done:|\n---\n|$)/);
    if (!sectionMatch) {
        return [];
    }
    return sectionMatch[1]
        .split('\n')
        .map(line => line.trim())
        .filter(line => /^- \[[ xX]\]/.test(line));
}
;
