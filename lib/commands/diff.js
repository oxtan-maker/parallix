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
const node_child_process_1 = __importDefault(require("node:child_process"));
const node_path_1 = __importDefault(require("node:path"));
const git_js_1 = require("../core/git.js");
const mission_utils_js_1 = require("../core/mission-utils.js");
const fmt = __importStar(require("../core/fmt.js"));
/** @param {string[]} args @param {{gitFn?: Function, spawnSyncFn?: Function, getPrimaryBranchFn?: Function, missionBranchNameFn?: Function, inferSlugFn?: Function, resolveWorktreeFn?: Function, exitFn?: Function, failFn?: Function}} opts */
async function diff(args, { gitFn = git_js_1.git, spawnSyncFn = node_child_process_1.default.spawnSync, getPrimaryBranchFn = mission_utils_js_1.getPrimaryBranch, missionBranchNameFn = mission_utils_js_1.missionBranchName, inferSlugFn = mission_utils_js_1.inferSlug, resolveWorktreeFn = mission_utils_js_1.resolveWorktree, exitFn = process.exit, failFn = fmt.log.fail, } = {}) {
    /** @param {string} a */
    const explicitSlug = args.filter((a) => !a.startsWith('--'))[0];
    const slug = inferSlugFn(explicitSlug);
    if (!slug) {
        failFn('Usage: node parallix diff [<slug>]');
        exitFn(1);
        return;
    }
    const worktree = resolveWorktreeFn(slug);
    if (!worktree) {
        failFn(`Mission worktree not found for ${fmt.slug(slug)}. Run this from the mission worktree or create it first.`);
        exitFn(1);
        return;
    }
    let primary;
    try {
        primary = getPrimaryBranchFn(worktree);
    }
    catch (err) {
        failFn(err.message);
        exitFn(1);
        return;
    }
    const branch = missionBranchNameFn(slug);
    const target = `${primary}..HEAD`;
    // Detect configured diff tool/pager
    /** @param {string} key */
    const getGitConfig = (key) => {
        const result = gitFn(['-C', worktree, 'config', '--get', key]);
        return result.status === 0 ? result.stdout.trim() : null;
    };
    /** @param {string} cmd */
    const isSpecializedTool = (cmd) => {
        if (!cmd) {
            return false;
        }
        const parts = cmd.split(/\s+/);
        // Handle cases like "LESS=FRX less" or "/usr/bin/delta"
        /** @param {string} p */
        const exePart = parts.find((p) => !p.includes('='));
        if (!exePart) {
            return false;
        }
        const exe = node_path_1.default.basename(exePart).toLowerCase();
        // Explicitly reject known default pagers
        if (['less', 'cat', 'more'].includes(exe)) {
            return false;
        }
        // Accept known specialized tools documented in review-tooling.md
        if (['delta', 'difft', 'diff-so-fancy'].includes(exe)) {
            return true;
        }
        // Fallback: if it's not a known default, and we have a value, treat it as specialized
        // for now to avoid breaking custom setups like "vimdiff", but we've rejected plain "less".
        return true;
    };
    /** @param {childProcess.SpawnSyncReturns<string>} result @param {string} toolName */
    const handleLaunchResult = (result, toolName) => {
        if (result.error) {
            failFn(`Failed to launch ${toolName}: ${result.error.message}`);
            exitFn(1);
            return;
        }
        if (result.signal) {
            failFn(`${toolName} terminated by signal: ${result.signal}`);
            exitFn(1);
            return;
        }
        if (result.status === null) {
            failFn(`${toolName} exited with unknown status.`);
            exitFn(1);
            return;
        }
        exitFn(result.status);
    };
    const diffTool = getGitConfig('diff.tool');
    if (diffTool) {
        fmt.log.info(`Launching ${fmt.command('git difftool')} for ${fmt.branch(branch)} (tool: ${fmt.bold(diffTool)})...`);
        const result = spawnSyncFn('git', ['difftool', '-d', '--no-prompt', target], { cwd: worktree, stdio: 'inherit' });
        handleLaunchResult(result, 'git difftool');
        return;
    }
    const pagerDiff = getGitConfig('pager.diff');
    if (isSpecializedTool(pagerDiff || '')) {
        fmt.log.info(`Launching ${fmt.command('git diff')} for ${fmt.branch(branch)} (pager: ${fmt.bold(pagerDiff || "")})...`);
        const result = spawnSyncFn('git', ['diff', target], { cwd: worktree, stdio: 'inherit' });
        handleLaunchResult(result, 'git diff');
        return;
    }
    const corePager = getGitConfig('core.pager');
    if (isSpecializedTool(corePager || '')) {
        fmt.log.info(`Launching ${fmt.command('git diff')} for ${fmt.branch(branch)} (core.pager: ${fmt.bold(corePager || "")})...`);
        const result = spawnSyncFn('git', ['diff', target], { cwd: worktree, stdio: 'inherit' });
        handleLaunchResult(result, 'git diff');
        return;
    }
    failFn('No specialized local diff tool (e.g., delta, difftastic) is configured in Git.');
    fmt.log.info('The workflow diff command requires an explicitly configured diff.tool or a non-default core.pager.');
    fmt.log.info(`Refer to ${fmt.path('docs/developer-setup/review-tooling.md')} for setup guidance.`);
    exitFn(1);
}
module.exports = diff;
