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
exports.getPrimaryBranch = getPrimaryBranch;
exports.resolveMainRepo = resolveMainRepo;
exports.getPrimaryWorktree = getPrimaryWorktree;
exports.conventionalWorktreePath = conventionalWorktreePath;
exports.conventionalBaseWorktreePath = conventionalBaseWorktreePath;
exports.detectLaunchBaseBranch = detectLaunchBaseBranch;
exports.parseBaseBranchLine = parseBaseBranchLine;
exports.readRecordedBaseBranch = readRecordedBaseBranch;
exports.resolveMissionBaseBranch = resolveMissionBaseBranch;
exports.resolveBaseWorktree = resolveBaseWorktree;
exports.resolveWorktree = resolveWorktree;
const fs = __importStar(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const product_config_js_1 = require("../product-config.js");
const gitModule = __importStar(require("../git.js"));
const paths_js_1 = require("./paths.js");
/** @param {string|Function} rootDirOrGitFn @param {Function|null} [maybeGitFn] */
function getPrimaryBranch(rootDirOrGitFn = process.cwd(), maybeGitFn = null) {
    const rootDir = typeof rootDirOrGitFn === 'function' ? process.cwd() : rootDirOrGitFn;
    /** @type {Function} */
    const runner = typeof rootDirOrGitFn === 'function' ? rootDirOrGitFn : (maybeGitFn || gitModule.git);
    const listLocalBranches = () => {
        const result = runner(['-C', rootDir, 'branch', '--list', '--format=%(refname:short)', 'main', 'master']);
        return (result.stdout || '').split('\n').map((b) => b.trim()).filter(Boolean);
    };
    try {
        const config = (0, product_config_js_1.loadAdapterConfig)(rootDir);
        const missions = config.missions || {};
        if (typeof missions.primaryBranch === 'string' && missions.primaryBranch.trim()) {
            const configured = missions.primaryBranch.trim();
            const branches = listLocalBranches();
            if (branches.includes(configured)) {
                return configured;
            }
            if (configured !== 'main' && configured !== 'master') {
                return configured;
            }
        }
    }
    catch (_) {
        // fall through to git-based detection
    }
    try {
        const branches = listLocalBranches();
        if (branches.includes('main')) {
            return 'main';
        }
        if (branches.includes('master')) {
            return 'master';
        }
    }
    catch (_) {
        // fall through
    }
    throw new Error("Could not detect primary branch. Neither 'main' nor 'master' exists as a local branch.");
}
function resolveMainRepo() {
    if (process.env.PRIMARY_WORKTREE) {
        return process.env.PRIMARY_WORKTREE;
    }
    const cwd = process.cwd();
    const primaryBranch = getPrimaryBranch(process.cwd(), gitModule.git);
    try {
        const lines = gitModule.git(['worktree', 'list', '--porcelain']).stdout.split('\n');
        const worktrees = [];
        let current = null;
        for (const line of lines) {
            if (line.startsWith('worktree ')) {
                if (current) {
                    worktrees.push(current);
                }
                current = { path: line.slice('worktree '.length).trim(), branch: null, bare: false };
                continue;
            }
            if (!current) {
                continue;
            }
            if (line.startsWith('branch ')) {
                current.branch = line.slice('branch '.length).trim();
            }
            else if (line === 'bare') {
                current.bare = true;
            }
            else if (line === '') {
                worktrees.push(current);
                current = null;
            }
        }
        if (current) {
            worktrees.push(current);
        }
        const primaryWorktree = worktrees.find(wt => !wt.bare && wt.branch === `refs/heads/${primaryBranch}`);
        if (primaryWorktree) {
            return primaryWorktree.path;
        }
    }
    catch (_) {
        // ignore git errors, fall through to error
    }
    try {
        const currentBranch = gitModule.getCurrentBranch(cwd);
        const toplevel = gitModule.git(['-C', cwd, 'rev-parse', '--show-toplevel']);
        const repoRoot = (toplevel.stdout || '').trim();
        if (toplevel.status === 0 && repoRoot) {
            if (currentBranch === primaryBranch) {
                return repoRoot;
            }
            if (node_path_1.default.resolve(repoRoot) === node_path_1.default.resolve(cwd) &&
                (0, product_config_js_1.isStandaloneWorkflowLayout)(repoRoot) &&
                !currentBranch) {
                return repoRoot;
            }
        }
    }
    catch (_) {
        // ignore git errors, fall through to error
    }
    throw new Error(`Could not resolve primary repository. No worktree on '${primaryBranch}' branch found and PRIMARY_WORKTREE is not set. ` +
        "Verify your worktree setup or set the PRIMARY_WORKTREE environment variable.");
}
function getPrimaryWorktree() {
    return resolveMainRepo();
}
/** @param {string} slug @param {string} [mainRepo] */
function conventionalWorktreePath(slug, mainRepo = getPrimaryWorktree()) {
    const projectName = node_path_1.default.basename(mainRepo);
    const pattern = (0, paths_js_1.resolveMissionAdapter)(mainRepo).worktreePattern;
    const rendered = pattern
        .replaceAll('<repo>', projectName)
        .replaceAll('<slug>', slug);
    return node_path_1.default.resolve(mainRepo, rendered);
}
/**
 * Conventional path for an auto-created *base* feature-branch worktree.
 *
 * Reuses the same mission `worktreePattern` so the path is discoverable and
 * removable with the existing tooling. The base branch name is slug-sanitised
 * (`/` → `-`) and prefixed with `base-` so it never collides with a mission
 * worktree (`mission/<slug>` → `<repo>-<slug>`).
 */
/** @param {string} baseBranch @param {string} [mainRepo] */
function conventionalBaseWorktreePath(baseBranch, mainRepo = getPrimaryWorktree()) {
    const safeName = String(baseBranch).replace(/[\\/]+/g, '-');
    return conventionalWorktreePath(`base-${safeName}`, mainRepo);
}
/**
 * Detect the branch HEAD is on at draft time, to be used as the mission base.
 *
 * Returns the current branch name. Returns `null` when HEAD is detached so the
 * caller falls back to `getPrimaryBranch()`. Throws when the current branch is
 * itself a mission branch (the `mission/*` prefix is reserved; nesting a mission
 * on a mission is refused).
 *
 * @param {string} [cwd]
 * @param {{ gitFn?: Function }} [options]
 * @returns {string|null}
 */
/** @param {string} [cwd] @param {{gitFn?: Function}} [options] */
function detectLaunchBaseBranch(cwd = process.cwd(), options = {}) {
    /** @type {Function} */
    const runner = options.gitFn || gitModule.git;
    const result = runner(['-C', cwd, 'branch', '--show-current']);
    const branch = ((result && result.stdout) || '').trim();
    if (!branch) {
        return null;
    }
    const prefix = (0, paths_js_1.missionBranchPrefix)(cwd);
    if (branch.startsWith(prefix)) {
        throw new Error(`Cannot launch a mission from mission branch '${branch}': the '${prefix}' prefix is reserved. ` +
            'Check out the feature branch or primary branch you want as the base before running draft.');
    }
    return branch;
}
/** @param {string} content */
function parseBaseBranchLine(content) {
    if (!content) {
        return null;
    }
    const match = content.match(/^Base-Branch:\s*(\S+)\s*$/m);
    return match ? match[1].trim() : null;
}
/**
 * Read the `Base-Branch:` line recorded in the mission's MISSION.md.
 *
 * Reads the on-disk MISSION.md first (present in the mission worktree); when it
 * is not on disk, falls back to reading it from the mission branch via
 * `git show <branch>:<path>`. Returns `null` when no `Base-Branch:` line exists
 * (every pre-existing mission), so callers fall back to the primary branch.
 */
/** @param {string} slug @param {string} [rootDir] @param {{gitFn?: Function}} [options] */
function readRecordedBaseBranch(slug, rootDir = process.cwd(), options = {}) {
    /** @type {Function | null} */
    const gitFn = options.gitFn ?? null;
    if (!slug) {
        return null;
    }
    const missionDir = (0, paths_js_1.findMissionDir)(slug, rootDir);
    if (missionDir) {
        const missionPath = node_path_1.default.join(missionDir, 'MISSION.md');
        if (fs.existsSync(missionPath)) {
            return parseBaseBranchLine(fs.readFileSync(missionPath, 'utf8'));
        }
    }
    const runner = gitFn || gitModule.git;
    const branch = (0, paths_js_1.missionBranchName)(slug, rootDir);
    const baseSlugMatch = slug.match(/^(task-\d+)/i);
    const baseSlug = baseSlugMatch ? baseSlugMatch[1].toLowerCase() : slug;
    const year = (0, paths_js_1.getMissionYear)(slug, rootDir);
    const adapterBaseDir = (node_path_1.default.relative(rootDir, (0, paths_js_1.missionBaseDir)(rootDir)) || '.').split(node_path_1.default.sep).join('/');
    const files = Array.from(new Set([
        node_path_1.default.posix.join(adapterBaseDir, year, slug, 'MISSION.md'),
        node_path_1.default.posix.join(adapterBaseDir, year, baseSlug, 'MISSION.md')
    ]));
    for (const f of files) {
        try {
            const res = runner(['-C', rootDir, 'show', `${branch}:${f}`]);
            if (res && res.status === 0) {
                const parsed = parseBaseBranchLine(res.stdout);
                if (parsed) {
                    return parsed;
                }
            }
        }
        catch (_) {
            // ignore and try the next candidate
        }
    }
    return null;
}
/**
 * Resolve the base branch a mission was drafted from.
 *
 * Returns the recorded `Base-Branch:` when present, otherwise `getPrimaryBranch()`
 * (the byte-identical legacy behaviour for every pre-existing mission).
 */
/** @param {string} slug @param {string} [rootDir] @param {{gitFn?: Function}} [options] */
function resolveMissionBaseBranch(slug, rootDir = process.cwd(), options = {}) {
    /** @type {Function | null} */
    const gitFn = options.gitFn ?? null;
    const recorded = readRecordedBaseBranch(slug, rootDir, { gitFn: gitFn });
    if (recorded) {
        return recorded;
    }
    return gitFn ? getPrimaryBranch(rootDir, gitFn) : getPrimaryBranch(rootDir);
}
/** @param {string} branchRef @param {Function} runner @param {string} mainRepo */
function findWorktreeForBranch(branchRef, runner, mainRepo) {
    const result = runner(['-C', mainRepo, 'worktree', 'list', '--porcelain']);
    const lines = ((result && result.stdout) || '').split('\n');
    let current = null;
    for (const line of lines) {
        if (line.startsWith('worktree ')) {
            current = { path: line.slice('worktree '.length).trim(), branch: null };
        }
        else if (!current) {
            continue;
        }
        else if (line.startsWith('branch ')) {
            current.branch = line.slice('branch '.length).trim();
        }
        else if (line === '') {
            if (current.branch === branchRef) {
                return current.path;
            }
            current = null;
        }
    }
    if (current && current.branch === branchRef) {
        return current.path;
    }
    return null;
}
/**
 * Resolve the worktree the mission integrates back into.
 *
 * When the resolved base equals the primary branch, delegates to
 * `getPrimaryWorktree()` (untouched legacy behaviour). Otherwise returns the
 * live worktree checked out on the base branch, auto-creating one at the
 * conventional pattern path when none exists. Throws a `base branch`-bearing
 * error when the recorded base does not exist locally.
 */
/** @param {string} slug @param {{rootDir?: string, gitFn?: Function}} [options] */
function resolveBaseWorktree(slug, options = {}) {
    const rootDir = options.rootDir || process.cwd();
    /** @type {Function | null} */
    const gitFn = options.gitFn ?? null;
    const runner = gitFn || gitModule.git;
    const base = resolveMissionBaseBranch(slug, rootDir, { gitFn: gitFn });
    const primary = gitFn ? getPrimaryBranch(rootDir, gitFn) : getPrimaryBranch(rootDir);
    if (base === primary) {
        return getPrimaryWorktree();
    }
    const mainRepo = getPrimaryWorktree();
    const baseRef = `refs/heads/${base}`;
    const existing = findWorktreeForBranch(baseRef, runner, mainRepo);
    if (existing) {
        return existing;
    }
    const branchExists = runner(['-C', mainRepo, 'show-ref', '--verify', '--quiet', baseRef]);
    if (!branchExists || branchExists.status !== 0) {
        throw new Error(`Mission ${slug} records base branch '${base}' but it does not exist locally. ` +
            `Create or fetch the '${base}' base branch before integrating.`);
    }
    const worktreePath = conventionalBaseWorktreePath(base, mainRepo);
    const addResult = runner(['-C', mainRepo, 'worktree', 'add', worktreePath, base]);
    if (!addResult || addResult.status !== 0) {
        const detail = addResult ? [addResult.stdout, addResult.stderr].filter(Boolean).join('\n').trim() : '';
        throw new Error(`Could not create base worktree for base branch '${base}' at ${worktreePath}${detail ? ': ' + detail : '.'}`);
    }
    return worktreePath;
}
/** @param {string} slug @param {{cwd?: string, gitFn?: Function}} [options] */
function resolveWorktree(slug, options = {}) {
    const cwd = options.cwd || process.cwd();
    /** @type {Function | null} */
    const gitFn = options.gitFn ?? null;
    const runGit = gitFn || gitModule.git;
    const branchRef = (0, paths_js_1.missionBranchRef)(slug, cwd);
    try {
        const lines = runGit(['worktree', 'list', '--porcelain']).stdout.split('\n');
        const matches = [];
        let current = null;
        for (const line of lines) {
            if (line.startsWith('worktree ')) {
                current = { path: line.slice('worktree '.length).trim(), branch: null, prunable: false };
                continue;
            }
            if (!current) {
                continue;
            }
            if (line.startsWith('branch ')) {
                current.branch = line.slice('branch '.length).trim();
            }
            else if (line.startsWith('prunable ')) {
                current.prunable = true;
            }
            else if (line === '') {
                if (current.branch === branchRef) {
                    matches.push(current);
                }
                current = null;
            }
        }
        if (current && current.branch === branchRef) {
            matches.push(current);
        }
        const liveMatches = matches.filter(m => !m.prunable);
        if (liveMatches.length > 0) {
            const cwdMatch = liveMatches.find(m => cwd === m.path || cwd.startsWith(m.path + '/'));
            if (cwdMatch) {
                return cwdMatch.path;
            }
            return liveMatches[0].path;
        }
    }
    catch (_) {
        // fall through to branch-based cwd fallback
    }
    try {
        if (gitModule.getCurrentBranch(cwd) === (0, paths_js_1.missionBranchName)(slug, cwd)) {
            return cwd;
        }
    }
    catch (_) {
        // fall through to null
    }
    return null;
}
