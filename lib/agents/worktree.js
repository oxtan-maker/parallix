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
exports.getMainWorktreePath = getMainWorktreePath;
exports.getGitPath = getGitPath;
exports.parseWorktreePaths = parseWorktreePaths;
exports.detectMainWorktreePath = detectMainWorktreePath;
const node_path_1 = __importDefault(require("node:path"));
const node_child_process_1 = require("node:child_process");
const fmt = __importStar(require("../core/fmt.js"));
// Cached per git common directory to avoid repeated subprocess calls without
// leaking a temp-repo answer into later tests or nested workflow invocations.
const MainWorktreeDetector = {
    byCommonDir: new Map()
};
function getGitPath(cwd, args) {
    const result = (0, node_child_process_1.spawnSync)('git', ['-C', cwd, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 1000
    });
    if (result.status !== 0) {
        return null;
    }
    return result.stdout.trim() || null;
}
function parseWorktreePaths(lines) {
    return lines
        .filter((line) => line.startsWith('worktree '))
        .map((line) => line.slice('worktree '.length).trim())
        .filter(Boolean);
}
function detectMainWorktreePath(lines, cwd, commonDir) {
    const worktrees = parseWorktreePaths(lines);
    if (worktrees.length === 0) {
        return null;
    }
    const resolvedCommonDir = commonDir ? node_path_1.default.resolve(commonDir) : null;
    for (const wt of worktrees) {
        const gitDir = getGitPath(wt, ['rev-parse', '--absolute-git-dir']);
        const wtCommonDir = getGitPath(wt, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
        if (gitDir &&
            wtCommonDir &&
            node_path_1.default.resolve(gitDir) === node_path_1.default.resolve(wtCommonDir) &&
            (!resolvedCommonDir || node_path_1.default.resolve(wtCommonDir) === resolvedCommonDir)) {
            return wt;
        }
    }
    const currentTopLevel = getGitPath(cwd, ['rev-parse', '--show-toplevel']);
    if (currentTopLevel && worktrees.length === 1 && node_path_1.default.resolve(worktrees[0]) === node_path_1.default.resolve(currentTopLevel)) {
        return worktrees[0];
    }
    return null;
}
function getMainWorktreePath(options = {}) {
    const { cwd = process.cwd(), warn = fmt.log.warn } = options;
    try {
        const commonDir = getGitPath(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
        if (commonDir && MainWorktreeDetector.byCommonDir.has(commonDir)) {
            return MainWorktreeDetector.byCommonDir.get(commonDir);
        }
        if (!commonDir) {
            return null;
        }
        const result = (0, node_child_process_1.spawnSync)('git', ['-C', cwd, 'worktree', 'list', '--porcelain'], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
            timeout: 1000
        });
        if (result.status !== 0) {
            warn(`Could not inspect git worktrees while looking for main-worktree agents.local.json; ` +
                `skipping that lookup (git exited with status ${result.status}).`);
            return null;
        }
        const lines = result.stdout.split('\n');
        const mainWorktreePath = detectMainWorktreePath(lines, cwd, commonDir);
        if (mainWorktreePath) {
            MainWorktreeDetector.byCommonDir.set(commonDir, mainWorktreePath);
            return mainWorktreePath;
        }
        let i = 0;
        while (i < lines.length) {
            if (lines[i].startsWith('worktree ')) {
                const wt = lines[i].slice('worktree '.length).trim();
                const branchLineIdx = i + 1;
                if (branchLineIdx < lines.length && lines[branchLineIdx].startsWith('branch refs/heads/main')) {
                    MainWorktreeDetector.byCommonDir.set(commonDir, wt);
                    return wt;
                }
            }
            i++;
        }
        for (i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('worktree ')) {
                const wt = lines[i].slice('worktree '.length).trim();
                if (wt !== cwd) {
                    MainWorktreeDetector.byCommonDir.set(commonDir, wt);
                    return wt;
                }
            }
        }
    }
    catch (err) {
        const e = err;
        const detail = e && (e.code || e.message) ? (e.code || e.message) : 'unknown error';
        warn(`Could not inspect git worktrees while looking for main-worktree agents.local.json; ` +
            `skipping that lookup (${detail}).`);
        return null;
    }
    warn('Could not determine the main worktree from `git worktree list --porcelain`; ' +
        'skipping main-worktree agents.local.json lookup.');
    return null;
}
