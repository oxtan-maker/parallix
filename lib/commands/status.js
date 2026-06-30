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
const git_js_1 = require("../core/git.js");
const backlog_js_1 = require("../tools/backlog.js");
const mission_utils_js_1 = require("../core/mission-utils.js");
const agents_js_1 = require("../agents/agents.js");
const forgejo_js_1 = require("../tools/forgejo.js");
const path = __importStar(require("node:path"));
const fmt = __importStar(require("../core/fmt.js"));
/** @param {string} porcelain */
function parseWorktreeList(porcelain) {
    const entries = [];
    /** @type{{path: string, branch: string | null} | null} */
    let current = null;
    for (const line of porcelain.split('\n')) {
        if (!line.trim()) {
            if (current) {
                entries.push(current);
                current = null;
            }
            continue;
        }
        if (line.startsWith('worktree ')) {
            if (current) {
                entries.push(current);
            }
            current = { path: line.slice('worktree '.length).trim(), branch: null };
            continue;
        }
        if (line.startsWith('branch ') && current) {
            current.branch = line.slice('branch '.length).trim();
        }
    }
    if (current) {
        entries.push(current);
    }
    return entries;
}
function findStaleMissionWorktrees({ gitRun = git_js_1.run, findTaskFileFn = backlog_js_1.findTaskFile, getTaskStatusFn = backlog_js_1.getTaskStatus, primaryWorktree = null } = {}) {
    const result = gitRun('git', ['worktree', 'list', '--porcelain']);
    if (result.status !== 0) {
        return [];
    }
    /** @type {string | null} */
    let resolvedPrimary = primaryWorktree;
    if (!resolvedPrimary) {
        try {
            resolvedPrimary = (0, mission_utils_js_1.getPrimaryWorktree)();
        }
        catch (_) {
            resolvedPrimary = null;
        }
    }
    return parseWorktreeList(result.stdout)
        .filter(entry => entry.path !== resolvedPrimary)
        .map(entry => {
        const branchRef = entry.branch || '';
        const prefix = (0, mission_utils_js_1.missionBranchPrefix)(resolvedPrimary || process.cwd());
        const normalizedRefPrefix = `refs/heads/${prefix}`;
        const match = branchRef.startsWith(normalizedRefPrefix)
            ? [branchRef, branchRef.slice(normalizedRefPrefix.length)]
            : null;
        if (!match) {
            return null;
        }
        const slug = match[1];
        const taskFile = findTaskFileFn(slug);
        const taskStatus = taskFile ? getTaskStatusFn(taskFile) : null;
        if (taskStatus !== 'done' && taskFile) {
            return null;
        }
        return {
            slug,
            path: entry.path,
            branch: branchRef,
            taskStatus: taskStatus || 'missing',
            cleanupCommand: taskStatus === 'done'
                ? `scripts/cleanup-mission-worktree.sh ${slug}`
                : `git worktree remove ${entry.path} && git branch -D ${(0, mission_utils_js_1.missionBranchName)(slug, resolvedPrimary || process.cwd())}`
        };
    })
        .filter(Boolean);
}
/** @param {string} ref */
function formatWorktreeBranch(ref) {
    if (!ref) {
        return '(detached HEAD)';
    }
    return ref.replace(/^refs\/heads\//, '');
}
/** @param {Function} log @param {string} label @param {{detached?: boolean, unmergedFiles: string[]}} rebaseState */
function logRebaseDiagnostics(log, label, rebaseState) {
    const detachedText = rebaseState.detached ? 'detached HEAD, ' : '';
    log(`${label}: ${detachedText}${rebaseState.unmergedFiles.length} unmerged file(s)`);
    rebaseState.unmergedFiles.forEach(file => {
        log(`  - ${file}`);
    });
}
/** @param {string[]} args @param {{exit?: Function, log?: Function, inferSlugFn?: Function, getCurrentBranchFn?: Function, findTaskFileFn?: Function, getTaskStatusFn?: Function, findMissionDirFn?: Function, findCheckpointsFn?: Function, getFirstLineFn?: Function, getPrStatusFn?: Function, findStaleMissionWorktreesFn?: Function, readAgentConfigOrExitFn?: Function, eligibleAgentsForStepFn?: Function, allWorkflowAgentNamesFn?: Function, workflowLauncherStatusFn?: Function, getLastThreeCommitsFn?: Function, getUncommittedCountFn?: Function, detectRebaseStateFn?: Function}} opts */
function status(args, opts) {
    const exit = opts.exit || process.exit;
    const log = opts.log || fmt.log.plain;
    const inferSlugFn = opts.inferSlugFn || mission_utils_js_1.inferSlug;
    const getCurrentBranchFn = opts.getCurrentBranchFn || git_js_1.getCurrentBranch;
    const findTaskFileFn = opts.findTaskFileFn || backlog_js_1.findTaskFile;
    const getTaskStatusFn = opts.getTaskStatusFn || backlog_js_1.getTaskStatus;
    const findMissionDirFn = opts.findMissionDirFn || mission_utils_js_1.findMissionDir;
    const findCheckpointsFn = opts.findCheckpointsFn || mission_utils_js_1.findCheckpoints;
    const getFirstLineFn = opts.getFirstLineFn || mission_utils_js_1.getFirstLine;
    const getPrStatusFn = opts.getPrStatusFn || forgejo_js_1.getPrStatus;
    const findStaleMissionWorktreesFn = opts.findStaleMissionWorktreesFn || findStaleMissionWorktrees;
    const readAgentConfigOrExitFn = opts.readAgentConfigOrExitFn || agents_js_1.readAgentConfigOrExit;
    const eligibleAgentsForStepFn = opts.eligibleAgentsForStepFn || agents_js_1.eligibleAgentsForStep;
    const allWorkflowAgentNamesFn = opts.allWorkflowAgentNamesFn || (() => agents_js_1.WORKFLOW_AGENT_NAMES);
    const workflowLauncherStatusFn = opts.workflowLauncherStatusFn || agents_js_1.workflowLauncherStatus;
    const getLastThreeCommitsFn = opts.getLastThreeCommitsFn || git_js_1.getLastThreeCommits;
    const getUncommittedCountFn = opts.getUncommittedCountFn || git_js_1.getUncommittedCount;
    const detectRebaseStateFn = opts.detectRebaseStateFn || git_js_1.detectRebaseState;
    const explicitSlug = args[0];
    const slug = inferSlugFn(explicitSlug);
    log(fmt.bold('--- Mission Status ---'));
    log(`Branch: ${fmt.branch(getCurrentBranchFn())}`);
    log(`Worktree: ${fmt.path(process.cwd())}`);
    try {
        const rebaseState = detectRebaseStateFn(process.cwd());
        if (rebaseState.inProgress && rebaseState.detached) {
            logRebaseDiagnostics(log, 'Detached HEAD: rebase in progress', rebaseState);
        }
    }
    catch (_) {
        // Ignore transient worktree/git-state failures in status output.
    }
    if (slug) {
        const taskFile = findTaskFileFn(slug);
        const taskStatus = getTaskStatusFn(taskFile);
        log(`Backlog status: ${taskStatus || 'unknown'}`);
        const missionDir = findMissionDirFn(slug);
        if (missionDir) {
            const checkpoints = findCheckpointsFn(missionDir);
            if (checkpoints.length > 0) {
                const lastCP = checkpoints[checkpoints.length - 1];
                const firstLine = getFirstLineFn(lastCP);
                log(`Last checkpoint: ${path.basename(lastCP)} - ${firstLine}`);
            }
            else {
                log('Last checkpoint: none');
            }
        }
        else {
            log('Last checkpoint: unknown');
        }
        // Forgejo PR state
        const pr = getPrStatusFn((0, mission_utils_js_1.missionBranchName)(slug));
        if (pr.exists) {
            log(`Forgejo PR: #${pr.number} (${pr.state})`);
        }
        else if (pr.raw) {
            log(`Forgejo PR: unavailable (${pr.raw})`);
        }
        else {
            log('Forgejo PR: none');
        }
    }
    if (!explicitSlug) {
        const staleWorktrees = findStaleMissionWorktreesFn();
        staleWorktrees.forEach((entry) => {
            log(`Stale worktree: ${fmt.path(entry.path)} (task: ${entry.taskStatus})`);
            try {
                const rebaseState = detectRebaseStateFn(entry.path);
                if (rebaseState.inProgress) {
                    logRebaseDiagnostics(log, `Rebase in progress on ${formatWorktreeBranch(entry.branch || '')}`, rebaseState);
                }
            }
            catch (_) {
                // Ignore stale worktrees that disappear during inspection.
            }
            log(`  Cleanup: ${fmt.command(entry.cleanupCommand || '')}`);
        });
    }
    // Agent eligibility matrix
    const config = readAgentConfigOrExitFn();
    const draftEligible = eligibleAgentsForStepFn('draft', { config });
    const activeEligible = eligibleAgentsForStepFn('active', { config });
    const baseAgents = allWorkflowAgentNamesFn();
    const allAgents = [...new Set([...baseAgents, ...draftEligible, ...activeEligible])].sort();
    const envOverride = process.env.WORKFLOW_AGENT;
    log('Agent launcher matrix:');
    for (const agent of allAgents) {
        const launcher = workflowLauncherStatusFn(agent);
        const support = launcher.supported ? 'supported' : 'blocked';
        const draftMark = draftEligible.includes(agent) ? 'draft' : '-';
        const activeMark = activeEligible.includes(agent) ? 'active' : '-';
        log(`  ${fmt.agent(agent)}: ${support} | eligible: ${draftMark},${activeMark}`);
    }
    if (envOverride) {
        log(`  (WORKFLOW_AGENT override: ${fmt.agent(envOverride)})`);
    }
    const lastThree = getLastThreeCommitsFn();
    log('Last 3 commits:');
    lastThree.forEach((c) => log(`  - ${c}`));
    log(`Uncommitted files: ${getUncommittedCountFn()}`);
    log(fmt.bold('----------------------'));
    exit(0);
}
status.parseWorktreeList = parseWorktreeList;
status.findStaleMissionWorktrees = findStaleMissionWorktrees;
module.exports = status;
