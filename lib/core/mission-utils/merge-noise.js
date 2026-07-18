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
exports.parseConflictFilesFromMergeOutput = parseConflictFilesFromMergeOutput;
exports.getConflictFiles = getConflictFiles;
exports.findLastNonNoiseCommit = findLastNonNoiseCommit;
exports.squashTrailingBacklogNoiseIntoPreviousMission = squashTrailingBacklogNoiseIntoPreviousMission;
exports.softResetTrailingBacklogNoise = softResetTrailingBacklogNoise;
exports.findMissionDocInBranches = findMissionDocInBranches;
exports.isMissionArtifact = isMissionArtifact;
exports.isWorkflowGeneratedArtifact = isWorkflowGeneratedArtifact;
const node_path_1 = __importDefault(require("node:path"));
const fmt = __importStar(require("../fmt.js"));
const product_config_js_1 = require("../product-config.js");
const gitModule = __importStar(require("../git.js"));
const paths_js_1 = require("./paths.js");
/**
 * Parse files with merge conflicts from the output of `git merge --no-commit --no-ff`.
 *
 * Git emits lines of the form:
 *   CONFLICT (content): Merge conflict in path/to/file
 *   CONFLICT (modify/delete): path/to/file deleted in HEAD.
 *   CONFLICT (add/add): Merge conflict in path/to/file
 *
 * Returns an array of relative file paths (deduped).
 */
/** @param {string} output */
function parseConflictFilesFromMergeOutput(output) {
    const seen = new Set();
    const files = [];
    for (const line of output.split('\n')) {
        if (!line.startsWith('CONFLICT')) {
            continue;
        }
        const inMatch = line.match(/Merge conflict in (.+)$/);
        if (inMatch) {
            const f = inMatch[1].trim();
            if (f && !seen.has(f)) {
                seen.add(f);
                files.push(f);
            }
            continue;
        }
        const colonIdx = line.indexOf(':');
        if (colonIdx !== -1) {
            const rest = line.slice(colonIdx + 1).trim();
            const f = rest.split(/\s+/)[0];
            if (f && !seen.has(f)) {
                seen.add(f);
                files.push(f);
            }
        }
    }
    return files;
}
/**
 * Identify files that would have merge conflicts when merging `branch` into `rootDir`.
 *
 * Performs a dry `git merge --no-commit --no-ff` in `rootDir`, collects conflict
 * file paths from the output, aborts the in-progress merge, and returns the list.
 *
 * @param {string} rootDir - Absolute path to the git worktree to test in.
 * @param {string} branch  - Branch (or ref) to attempt merging.
 * @param {{ gitRunner?: Function }} [options]
 * @returns {string[]} Relative paths of conflicting files (empty if no conflicts).
 */
/** @param {string} rootDir @param {string} branch @param {{gitRunner?: Function}} [options] */
function getConflictFiles(rootDir, branch, options = {}) {
    const runner = options.gitRunner || gitModule.git;
    const merge = runner(['-C', rootDir, 'merge', '--no-commit', '--no-ff', branch]);
    runner(['-C', rootDir, 'merge', '--abort']);
    if (merge.status === 0) {
        return [];
    }
    const output = [merge.stdout, merge.stderr].filter(Boolean).join('\n');
    const conflictFiles = parseConflictFilesFromMergeOutput(output);
    if (conflictFiles.length === 0) {
        const summary = output.slice(0, 500) || '(no output)';
        throw new Error(`git merge exited ${merge.status} with no CONFLICT lines — raw output:\n${summary}`);
    }
    return conflictFiles;
}
/** @param {string} rootDir @param {Function} [gitRunner] */
function findLastNonNoiseCommit(rootDir, gitRunner) {
    const runner = gitRunner || gitModule.git;
    const currentFullRef = runner(['-C', rootDir, 'rev-parse', '--symbolic-full-name', 'HEAD'], { stdio: 'pipe' }).stdout.trim();
    let commit = 'HEAD';
    for (let i = 0; i < 100; i++) {
        const commitSha = runner(['-C', rootDir, 'rev-parse', commit], { stdio: 'pipe' }).stdout.trim();
        const branchesContaining = runner(['-C', rootDir, 'branch', '-a', '--contains', commitSha, '--format=%(refname)'], { stdio: 'pipe' })
            .stdout.trim().split('\n').filter(Boolean);
        const isShared = branchesContaining.some((b) => b.startsWith('refs/remotes/'));
        if (isShared) {
            return null;
        }
        const otherLocalBranches = branchesContaining.filter((b) => b !== currentFullRef && b.startsWith('refs/heads/'));
        if (otherLocalBranches.length > 0) {
            return null;
        }
        const logResult = runner(['-C', rootDir, 'log', '-1', '--format=%s', commit], { stdio: 'pipe' });
        if (logResult.status !== 0) {
            return null;
        }
        const msg = logResult.stdout.trim();
        const diffResult = runner(['-C', rootDir, 'diff-tree', '--no-commit-id', '--name-only', '-r', commit], { stdio: 'pipe' });
        if (diffResult.status !== 0) {
            return null;
        }
        const files = diffResult.stdout.trim().split('\n').filter(Boolean);
        if (files.length > 0) {
            let isNoiseFiles = true;
            for (const file of files) {
                if (!file.startsWith('backlog/') && !file.endsWith('agents.local.json')) {
                    isNoiseFiles = false;
                    break;
                }
            }
            const isNoiseMsg = /^(Create task|Update task|backlog|assign|fixes|backlig|housekeeping|Archive task|fixing tasks|new mission|added new backlog task|docs: move|mission changes|random changes|new\/updated mission|task updates)/i.test(msg);
            if (!isNoiseFiles || !isNoiseMsg) {
                return commit;
            }
        }
        else {
            return commit;
        }
        commit = `${commit}^`;
    }
    return null;
}
/** @param {string} rootDir @param {Function} [gitRunner] */
function squashTrailingBacklogNoiseIntoPreviousMission(rootDir, gitRunner) {
    const runner = gitRunner || gitModule.git;
    const status = runner(['-C', rootDir, 'status', '--porcelain']).stdout.trim();
    if (status) {
        fmt.log.warn(`Skipping noise squash in ${rootDir}: worktree is not clean.`);
        return false;
    }
    const nonNoiseCommit = findLastNonNoiseCommit(rootDir, runner);
    if (!nonNoiseCommit) {
        return false;
    }
    const headSha = runner(['-C', rootDir, 'rev-parse', 'HEAD']).stdout.trim();
    const baseSha = runner(['-C', rootDir, 'rev-parse', nonNoiseCommit]).stdout.trim();
    if (headSha !== baseSha) {
        fmt.log.info(`Squashing trailing backlog noise into ${baseSha.substring(0, 7)}...`);
        const date = runner(['-C', rootDir, 'log', '-1', '--format=%aD', baseSha]).stdout.trim();
        const resetResult = runner(['-C', rootDir, 'reset', '--soft', baseSha]);
        if (resetResult.status !== 0) {
            fmt.log.fail(`Failed to reset to ${baseSha}: ${resetResult.stderr}`);
            return false;
        }
        const commitResult = runner(['-C', rootDir, 'commit', '--amend', '--no-edit', '--date', date]);
        if (commitResult.status !== 0) {
            fmt.log.fail(`Failed to amend commit: ${commitResult.stderr}`);
            return false;
        }
        return true;
    }
    return false;
}
/** @param {string} rootDir @param {Function} [gitRunner] */
function softResetTrailingBacklogNoise(rootDir, gitRunner) {
    const runner = gitRunner || gitModule.git;
    const status = runner(['-C', rootDir, 'status', '--porcelain']).stdout.trim();
    if (status) {
        fmt.log.warn(`Skipping noise reset in ${rootDir}: worktree is not clean.`);
        return false;
    }
    const nonNoiseCommit = findLastNonNoiseCommit(rootDir, runner);
    if (!nonNoiseCommit) {
        return false;
    }
    const headSha = runner(['-C', rootDir, 'rev-parse', 'HEAD']).stdout.trim();
    const baseSha = runner(['-C', rootDir, 'rev-parse', nonNoiseCommit]).stdout.trim();
    if (headSha !== baseSha) {
        fmt.log.info(`Resetting trailing backlog noise back to ${baseSha.substring(0, 7)} to include in the integration...`);
        const resetResult = runner(['-C', rootDir, 'reset', '--soft', baseSha]);
        if (resetResult.status !== 0) {
            fmt.log.fail(`Failed to reset to ${baseSha}: ${resetResult.stderr}`);
            return false;
        }
        return true;
    }
    return false;
}
/** @param {string} slug @param {string} [rootDir] @param {Function|null} [gitRunner] */
function findMissionDocInBranches(slug, rootDir = process.cwd(), gitRunner) {
    const runner = gitRunner || gitModule.git;
    const candidates = [];
    const baseSlugMatch = slug.match(/^(task-\d+)/i);
    const baseSlug = baseSlugMatch ? baseSlugMatch[1].toLowerCase() : slug;
    const files = [
        node_path_1.default.relative(rootDir, (0, paths_js_1.missionPathForSlug)(rootDir, slug)).split(node_path_1.default.sep).join('/'),
        node_path_1.default.relative(rootDir, (0, paths_js_1.missionPathForSlug)(rootDir, baseSlug)).split(node_path_1.default.sep).join('/')
    ];
    const uniquePaths = Array.from(new Set(files));
    let branchResult;
    try {
        branchResult = runner(['-C', rootDir, 'branch', '-a', '--format=%(refname:short)']);
        if (branchResult.status !== 0) {
            return candidates;
        }
    }
    catch (_e) {
        return candidates;
    }
    const branches = branchResult.stdout.trim().split('\n')
        .filter(Boolean)
        .filter((b) => !b.includes('HEAD'))
        .filter((b) => b.endsWith(baseSlug) || b.includes(`/${baseSlug}-`) || b.includes(`/${baseSlug}/`));
    for (const branch of branches) {
        for (const f of uniquePaths) {
            try {
                const lsResult = runner(['-C', rootDir, 'ls-tree', '--name-only', branch, f]);
                if (lsResult.status === 0 && lsResult.stdout.trim() === f) {
                    candidates.push({ branch, path: f });
                    break;
                }
            }
            catch (_err) {
                // ignore
            }
        }
    }
    return candidates;
}
/**
 * Check if a file path is a mission artifact for a specific slug.
 * Mission artifacts include:
 * - missions/<slug>/* by default, or the adapter-configured legacy path
 * - the adapter-configured task storage path for active tasks
 * - the adapter-configured task storage path for completed tasks
 *
 * @param {string} file - Relative file path
 * @param {string} slug - Mission slug (e.g. task-1107)
 * @param {string} rootDir - Workspace root
 * @returns {boolean}
 */
/** @param {string} file @param {string} slug @param {string} [rootDir] */
function isMissionArtifact(file, slug, rootDir = process.cwd()) {
    if (!file || !slug) {
        return false;
    }
    const missionDir = `${node_path_1.default.relative(rootDir, (0, paths_js_1.missionDirForSlug)(rootDir, slug)).split(node_path_1.default.sep).join('/')}/`;
    if (file.startsWith(missionDir)) {
        return true;
    }
    const legacyMissionDir = `docs/missions/${(0, paths_js_1.getMissionYear)(slug, rootDir)}/${slug}/`;
    if (file.startsWith(legacyMissionDir)) {
        return true;
    }
    const escapedSlug = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const taskStorage = (0, product_config_js_1.resolveTaskStorage)(rootDir);
    const taskDirs = [taskStorage.tasksDir, taskStorage.completedDir]
        .map(dir => node_path_1.default.relative(rootDir, dir).split(node_path_1.default.sep).join('/'))
        .map(dir => dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const taskPattern = new RegExp(`^(?:${taskDirs.join('|')})/${escapedSlug}(?:\\s+-\\s+[^/]+\\.md|\\.md)$`, 'i');
    if (taskPattern.test(file)) {
        return true;
    }
    return false;
}
/** @param {string} [file] */
function isWorkflowGeneratedArtifact(file) {
    if (!file) {
        return false;
    }
    return file.startsWith('.workflow/')
        || file.startsWith('.sessions/')
        || file.startsWith('.forgejo-local/')
        || file === 'graphify-out'
        || file.startsWith('graphify-out/');
}
