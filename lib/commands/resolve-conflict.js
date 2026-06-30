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
const integrate_js_1 = __importDefault(require("./integrate.js"));
const mission_utils_js_1 = require("../core/mission-utils.js");
const agents_js_1 = require("../agents/agents.js");
const fmt = __importStar(require("../core/fmt.js"));
const verification_js_1 = require("../core/verification.js");
/** @param {string} value */
function shellQuote(value) {
    return `"${String(value).replace(/(["\\$`])/g, '\\$1')}"`;
}
/** @param {{slug: string, area: string, worktreePath: string, missionSpecificFiles: string[]}} opts */
function buildAgentResolutionPrompt({ slug, area, worktreePath, missionSpecificFiles }) {
    const fileCommands = missionSpecificFiles
        .map(f => `  git checkout --theirs "${f}" && git add "${f}"`)
        .join('\n');
    const quotedWorktreePath = shellQuote(worktreePath);
    return [
        'Mode: conflict-resolution.',
        '',
        `Mission: ${slug}`,
        `Mission worktree: ${worktreePath}`,
        '',
        `Conflicts detected between the mission branch and ${(0, mission_utils_js_1.getPrimaryBranch)()}.`,
        'All conflicts are in mission-specific files that can be resolved by keeping',
        'the mission branch version (--theirs). Execute these steps in order:',
        '',
        `  cd ${quotedWorktreePath}`,
        `  git rebase ${(0, mission_utils_js_1.getPrimaryBranch)()}`,
        '  # When the rebase pauses on conflicts, run for each file:',
        fileCommands,
        '  git rebase --continue',
        `  ${(0, verification_js_1.formatVerificationCommand)(area, worktreePath)}`,
        `  px integrate ${slug} --dry-run`,
        '',
        'Rules:',
        '- Take --theirs for every file listed above. Do not inspect or edit conflict content.',
        '- If the rebase pauses on a file NOT in the list above, stop immediately and',
        '  report the unexpected file. Do not guess the resolution.',
        '- If any command fails, stop immediately and report the failure.',
        '  Do not continue to the next step.',
    ].join('\n');
}
/** @param {string[]} args @param {{resolveConflictsFn?: Function, startAgentFn?: Function, exitFn?: Function}} opts */
async function resolveConflict(args, { resolveConflictsFn = /** @type {import('./integrate.js').IntegrateFn} */ (integrate_js_1.default).resolveConflictsForMission, startAgentFn = agents_js_1.startAgent, exitFn = ((code) => process.exit(code)), } = {}) {
    const explicitSlug = args[0];
    const slug = (0, mission_utils_js_1.inferSlug)(explicitSlug);
    if (!slug) {
        fmt.log.fail('Usage: px resolve-conflict [<slug>]');
        exitFn(1);
        return;
    }
    const missionDir = (0, mission_utils_js_1.findMissionDir)(slug);
    const area = missionDir ? (0, mission_utils_js_1.findMissionArea)(missionDir) : 'docs';
    const result = resolveConflictsFn(slug, area);
    // No conflicts — nothing to resolve.
    if (result.ok && result.conflictFiles.length === 0) {
        exitFn(0);
        return;
    }
    // Shared-file conflicts: the agent cannot guess the correct resolution.
    // Stop and require human intervention.
    if (!result.ok && result.error === 'shared-file-conflicts') {
        fmt.log.fail('Shared-file conflicts require human resolution. Agent cannot guess the correct merge outcome.');
        fmt.log.info(`Shared files: ${result.sharedFiles.map((f) => fmt.path(f)).join(', ')}`);
        fmt.log.info(`Resolve manually, then re-run: ${fmt.command(`px integrate ${slug} --dry-run`)}`);
        exitFn(1);
        return;
    }
    // Other errors (worktree missing, merge-failed, etc.) — already logged by resolveConflictsFn.
    if (!result.ok) {
        exitFn(1);
        return;
    }
    // All conflicts are mission-specific: launch an agent to execute the --theirs rebase.
    const prompt = buildAgentResolutionPrompt({
        slug,
        area,
        worktreePath: result.worktreePath,
        missionSpecificFiles: result.missionSpecificFiles,
    });
    fmt.log.info('Launching agent to execute mission-specific conflict resolution...');
    const { agent, result: agentResult } = await startAgentFn('conflict-resolution', {
        prompt,
        worktree: result.worktreePath,
    });
    if (agentResult.status !== 0) {
        fmt.log.fail(`Agent (${fmt.agent(agent)}) exited with status ${agentResult.status}.`);
        exitFn(agentResult.status || 1);
        return;
    }
    fmt.log.pass(`Agent (${fmt.agent(agent)}) completed conflict resolution.`);
    exitFn(0);
}
resolveConflict.buildAgentResolutionPrompt = buildAgentResolutionPrompt;
module.exports = resolveConflict;
