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
Object.defineProperty(exports, "__esModule", { value: true });
exports.git = git;
exports.run = run;
exports.getCurrentBranch = getCurrentBranch;
exports.getWorktreeStatus = getWorktreeStatus;
exports.isDirty = isDirty;
exports.getUncommittedCount = getUncommittedCount;
exports.parseUnmergedFiles = parseUnmergedFiles;
exports.detectRebaseState = detectRebaseState;
exports.getLastCommit = getLastCommit;
exports.getLastThreeCommits = getLastThreeCommits;
const node_child_process_1 = require("node:child_process");
const fsMod = __importStar(require("node:fs"));
const pathMod = __importStar(require("node:path"));
function git(args, options = {}) {
    const spawnOptions = {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        ...options
    };
    const result = (0, node_child_process_1.spawnSync)('git', args, spawnOptions);
    if (result.error && result.status === null) {
        throw result.error;
    }
    return { status: result.status, signal: result.signal, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? ''), error: result.error };
}
function run(command, args, options = {}) {
    const spawnOptions = {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        ...options
    };
    const result = (0, node_child_process_1.spawnSync)(command, args, spawnOptions);
    if (result.error && result.status === null) {
        throw result.error;
    }
    return { status: result.status, signal: result.signal, stdout: String(result.stdout ?? ''), stderr: String(result.stderr ?? ''), error: result.error };
}
function getCurrentBranch(cwd = process.cwd()) {
    const result = git(['-C', cwd, 'branch', '--show-current']);
    return result.stdout.trim();
}
function getWorktreeStatus(cwd = process.cwd()) {
    const result = git(['-C', cwd, 'status', '--porcelain']);
    return result.stdout
        .split('\n')
        .map(line => line.trimEnd())
        .filter(Boolean);
}
function isDirty(cwd = process.cwd()) {
    const result = git(['-C', cwd, 'status', '--porcelain']);
    return result.stdout.trim().length > 0;
}
function getUncommittedCount(cwd = process.cwd()) {
    const result = git(['-C', cwd, 'status', '--porcelain']);
    if (!result.stdout.trim()) {
        return 0;
    }
    return result.stdout.trim().split('\n').length;
}
function parseUnmergedFiles(output = '') {
    return Array.from(new Set(output
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => line.split('\t')[1])
        .filter(Boolean)));
}
function detectRebaseState(cwd = process.cwd(), options = {}) {
    const { gitRunner = git, fsModule = fsMod, pathModule = pathMod } = options;
    const gitDirResult = gitRunner(['-C', cwd, 'rev-parse', '--git-dir']);
    const resolvedGitDir = gitDirResult.status === 0
        ? gitDirResult.stdout.trim()
        : '.git';
    const gitDir = pathModule.isAbsolute(resolvedGitDir)
        ? resolvedGitDir
        : pathModule.join(cwd, resolvedGitDir);
    const rebaseMergeDir = pathModule.join(gitDir, 'rebase-merge');
    const rebaseApplyDir = pathModule.join(gitDir, 'rebase-apply');
    const rebaseDir = fsModule.existsSync(rebaseMergeDir)
        ? rebaseMergeDir
        : (fsModule.existsSync(rebaseApplyDir) ? rebaseApplyDir : null);
    const headResult = gitRunner(['-C', cwd, 'symbolic-ref', '--quiet', '--short', 'HEAD']);
    const detached = headResult.status !== 0;
    const showCurrentResult = gitRunner(['-C', cwd, 'rebase', '--show-current']);
    const rebaseHead = showCurrentResult.status === 0 ? showCurrentResult.stdout.trim() : '';
    const unmergedResult = gitRunner(['-C', cwd, 'ls-files', '-u']);
    const unmergedFiles = unmergedResult.status === 0 ? parseUnmergedFiles(unmergedResult.stdout) : [];
    const inProgress = Boolean(rebaseDir || rebaseHead || unmergedFiles.length > 0);
    return {
        inProgress,
        rebaseHead,
        detached,
        unmergedFiles,
        rebaseDir
    };
}
function getLastCommit() {
    const result = git(['log', '-1', '--format=%H|%ad|%s']);
    const [sha, date, subject] = result.stdout.trim().split('|');
    return { sha, date, subject };
}
function getLastThreeCommits() {
    const result = git(['log', '-3', '--format=%s']);
    return result.stdout.trim().split('\n');
}
