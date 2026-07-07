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
exports.DispatchAction = exports.FailureClass = void 0;
exports.getDispatchAction = getDispatchAction;
exports.classifyError = classifyError;
exports.repairHandoff = repairHandoff;
exports.isRelaunchableError = isRelaunchableError;
exports.buildRelaunchPrompt = buildRelaunchPrompt;
const git_js_1 = require("../core/git.js");
const missionUtils = __importStar(require("../core/mission-utils.js"));
const rebase_js_1 = __importDefault(require("./rebase.js"));
const fmt = __importStar(require("../core/fmt.js"));
// ── FailureClass: 8 classes from ADR 0048 ────────────────────────────────────
const FailureClass = {
    UnverifiableClaims: 'UnverifiableClaims',
    MalformedGates: 'MalformedGates',
    MissingArtifacts: 'MissingArtifacts',
    IncompleteEvidence: 'IncompleteEvidence',
    GitBlockers: 'GitBlockers',
    GateFailure: 'GateFailure',
    InfraBlocker: 'InfraBlocker',
    StateMachineViolation: 'StateMachineViolation',
};
exports.FailureClass = FailureClass;
// ── DispatchAction: 3 actions from ADR 0048 ──────────────────────────────────
const DispatchAction = {
    AutoRepair: 'AutoRepair',
    AutoSendBack: 'AutoSendBack',
    HumanOnly: 'HumanOnly',
};
exports.DispatchAction = DispatchAction;
// ── Dispatch table: maps each failure class to its prescribed action (ADR 0048) ─
const DISPATCH_TABLE = {
    [FailureClass.UnverifiableClaims]: DispatchAction.AutoSendBack,
    [FailureClass.MalformedGates]: DispatchAction.AutoRepair,
    [FailureClass.MissingArtifacts]: DispatchAction.AutoSendBack,
    [FailureClass.IncompleteEvidence]: DispatchAction.AutoSendBack,
    [FailureClass.GitBlockers]: DispatchAction.AutoRepair,
    [FailureClass.GateFailure]: DispatchAction.AutoSendBack,
    [FailureClass.InfraBlocker]: DispatchAction.HumanOnly,
    [FailureClass.StateMachineViolation]: DispatchAction.HumanOnly,
};
/**
 * Look up the dispatch action for a given failure class.
 *
 * @param failureClass - One of the 8 failure class values from ADR 0048
 * @returns The prescribed dispatch action, or null if unknown
 */
function getDispatchAction(failureClass) {
    return DISPATCH_TABLE[failureClass] ?? null;
}
/**
 * Classify an error message into one of the 8 failure classes from ADR 0048
 * and return the associated dispatch action.
 *
 * Patterns are checked in order of specificity to avoid collisions.
 * Returns a `reason` field for GitBlockers to distinguish dirty-artifact from behind-branch errors,
 * allowing callers to derive repair-strategy flags without duplicating pattern matching.
 *
 * @param errorMsg - The error message to classify
 * @returns Object with failureClass, dispatchAction, and (for GitBlockers) reason
 */
function classifyError(errorMsg) {
    if (!errorMsg || typeof errorMsg !== 'string') {
        return { failureClass: FailureClass.InfraBlocker, dispatchAction: DispatchAction.HumanOnly };
    }
    // 1. IncompleteEvidence: goal-check table missing evidence rows (most specific — checked before generic gate patterns)
    if (errorMsg.includes('has a "## Goal Check" section but no evidence rows') &&
        errorMsg.includes('A goal-check table with real evidence is required before handoff')) {
        return { failureClass: FailureClass.IncompleteEvidence, dispatchAction: DispatchAction.AutoSendBack };
    }
    // 2. GitBlockers: dirty/uncommitted mission artifacts (mechanical git blocker — auto-repairable)
    if (errorMsg.includes('is modified but uncommitted') ||
        errorMsg.includes('Commit the mission contract before handoff') ||
        errorMsg.includes('Commit the implementation evidence before handoff')) {
        return { failureClass: FailureClass.GitBlockers, dispatchAction: DispatchAction.AutoRepair, reason: 'dirty' };
    }
    // 3. GitBlockers: branch behind primary / push rejected (mechanical git blocker — auto-repairable via rebase)
    if (errorMsg.includes('Updates were rejected') ||
        errorMsg.includes('fetch first') ||
        errorMsg.includes('non-fast-forward') ||
        errorMsg.includes('behind its remote') ||
        (errorMsg.includes('git push failed') && (errorMsg.includes('rejected') ||
            errorMsg.includes('remote contains work')))) {
        return { failureClass: FailureClass.GitBlockers, dispatchAction: DispatchAction.AutoRepair, reason: 'behind' };
    }
    // 4. GateFailure: verification gate failed
    if (/verification gate failed/i.test(errorMsg)) {
        return { failureClass: FailureClass.GateFailure, dispatchAction: DispatchAction.AutoSendBack };
    }
    // 5. GateFailure: declared gate failed
    if (/\bdeclared gate\b/i.test(errorMsg) && /\bfailed\b/i.test(errorMsg)) {
        return { failureClass: FailureClass.GateFailure, dispatchAction: DispatchAction.AutoSendBack };
    }
    // 6. UnverifiableClaims: test claims that cannot be verified
    if (/test(s?\s+)?passed/i.test(errorMsg) && /cannot\s+verify|unverifiable|proof\s+(not\s+)?found|stale\s+proof/i.test(errorMsg)) {
        return { failureClass: FailureClass.UnverifiableClaims, dispatchAction: DispatchAction.AutoSendBack };
    }
    // 7. MalformedGates: malformed or non-runnable declared gates
    if (/malformed\s+gate|invalid\s+gate\s+config|gate\s+command\s+(not\s+found|syntax\s+error|not\s+runnable)/i.test(errorMsg) ||
        (/gate/i.test(errorMsg) && /syntax\s+error|not\s+found|missing\s+(file|command)/i.test(errorMsg))) {
        return { failureClass: FailureClass.MalformedGates, dispatchAction: DispatchAction.AutoRepair };
    }
    // 8. MissingArtifacts: mandatory mission artifacts missing
    if (/mandatory\s+(artifact|file|document)|missing\s+(mission\s+)?(artifact|file|document)|required\s+(artifact|file|document)\s+(not\s+)?found/i.test(errorMsg) ||
        (/gatekeeper/i.test(errorMsg) && /missing\s+(artifact|file|document)/i.test(errorMsg))) {
        return { failureClass: FailureClass.MissingArtifacts, dispatchAction: DispatchAction.AutoSendBack };
    }
    // 9. StateMachineViolation: task state machine violations
    if (/state\s+violation|invalid\s+state|transition\s+not\s+allowed|cannot\s+(move|transition)\s+(from|to)\s+\w+\s+(to|from)/i.test(errorMsg) ||
        (/task\s+state/i.test(errorMsg) && /invalid|violation|incorrect/i.test(errorMsg))) {
        return { failureClass: FailureClass.StateMachineViolation, dispatchAction: DispatchAction.HumanOnly };
    }
    // 10. InfraBlocker: forgejo/infrastructure blockers
    if (/forgejo|infrastructure|authentication\s+failed|token\s+(expired|invalid|missing)|forbidden|unauthorized\s+(access|request)|rate\s+limit|connection\s+(refused|timed?\s*out)|network\s+error/i.test(errorMsg)) {
        return { failureClass: FailureClass.InfraBlocker, dispatchAction: DispatchAction.HumanOnly };
    }
    // Default: human-only for unrecognized errors
    return { failureClass: FailureClass.InfraBlocker, dispatchAction: DispatchAction.HumanOnly };
}
/**
 * Check if an error message indicates a relaunchable content error (missing/empty goal-check table).
 * Delegates to classifyError for backward-compatible classification.
 *
 * @param errorMsg - The error message to check
 * @returns True if the error is relaunchable (IncompleteEvidence or GateFailure)
 */
function isRelaunchableError(errorMsg) {
    if (!errorMsg || typeof errorMsg !== 'string') {
        return false;
    }
    const { failureClass } = classifyError(errorMsg);
    // IncompleteEvidence and GateFailure are the only classes that were relaunchable under the old logic
    return failureClass === FailureClass.IncompleteEvidence
        || failureClass === FailureClass.GateFailure;
}
/**
 * Build a relaunch prompt for an agent to fix a relaunchable error.
 *
 * @param {string} errorMsg - The error message from the failed handoff
 * @param {string} slug - Mission slug
 * @param {string} worktree - Path to the mission worktree
 * @returns {string} The relaunch prompt
  */
function buildRelaunchPrompt(errorMsg, slug, worktree, gateOutput) {
    const { failureClass } = classifyError(errorMsg);
    if (failureClass === FailureClass.GateFailure) {
        return buildGateFailurePrompt(errorMsg, slug, worktree, gateOutput);
    }
    return buildGoalCheckRepairPrompt(errorMsg, slug, worktree, gateOutput);
}
/**
 * Build a state-aware fix prompt for a verification-gate/test failure: points the
 * agent at the captured failing-test output and asks for a code fix, not a
 * checkpoint edit.
 *
 * @param {string} errorMsg - The error message from the failed handoff
 * @param {string} slug - Mission slug
 * @param {string} worktree - Path to the mission worktree
 * @param {{stdout: string, stderr: string}} [gateOutput] - Captured verification gate output
 */
function buildGateFailurePrompt(errorMsg, slug, worktree, gateOutput) {
    let prompt = `Automated handoff failed for mission ${slug} because the verification gate reported failing tests: ${errorMsg}

` +
        `This is a verification/test failure, not missing checkpoint evidence. Do NOT edit the checkpoint's ` +
        `evidence table to work around this — fix the failing tests themselves.

` +
        `Steps:
` +
        `1. Review the captured gate output below to identify the failing test names and error/stack traces.
` +
        `2. Fix the code in ${worktree} so the failing verification tests pass.
` +
        `3. Re-run the verification gate locally to confirm it now passes.
` +
        `4. Commit the fix with a descriptive commit message.
` +
        `5. Re-run: node parallix review ${slug} --submit`;
    if (gateOutput && (gateOutput.stdout || gateOutput.stderr)) {
        const totalOutput = (gateOutput.stdout || '') + (gateOutput.stderr || '');
        const truncated = totalOutput.length > 16000
            ? `[truncated — total ${totalOutput.length} chars, showing last 8000]\n` + totalOutput.slice(-8000)
            : totalOutput;
        prompt += `\n\n--- Captured Gate Output ---\n${truncated}`;
    }
    return prompt;
}
/**
 * Build the incomplete-evidence repair prompt: instructs the agent to add a
 * Goal Check table with real evidence to the final checkpoint document.
 *
 * @param {string} errorMsg - The error message from the failed handoff
 * @param {string} slug - Mission slug
 * @param {string} worktree - Path to the mission worktree
 * @param {{stdout: string, stderr: string}} [gateOutput] - Captured verification gate output
 */
function buildGoalCheckRepairPrompt(errorMsg, slug, worktree, gateOutput) {
    const year = missionUtils.getMissionYear(slug, worktree);
    const missionDir = missionUtils.findMissionDir(slug, worktree) || missionUtils.missionDirForSlug(worktree, slug);
    let prompt = `Automated handoff failed for mission ${slug} with a repairable error: ${errorMsg}

` +
        `Please fix the final checkpoint document in ${missionDir} by adding a Goal Check table ` +
        `with real evidence rows (file:line references, test names). The Goal Check table must have ` +
        `a header row and at least one evidence row using pipe syntax (|).

` +
        `Steps:
` +
        `1. Open the final checkpoint document (CP-N.md) in ${missionDir}
` +
        `2. Add or update the "## Goal Check" section
` +
        `3. Create a markdown table with columns for: Goal Check description | Evidence | Status
` +
        `4. Add at least one evidence row with real file:line or test name references
` +
        `5. Commit the updated checkpoint with a descriptive commit message
` +
        `6. Re-run: node parallix review ${slug} --submit

` +
        `Example Goal Check table:
` +
        `| Goal Check | Evidence | Status |
` +
        `|---|---|---|
` +
        `| Final checkpoint has Goal Check section | docs/missions/${year}/${slug}/CP-1.md:15 | PASS |
` +
        `| Tests pass | npm test -- parallix/test/repair-handoff.test.js | PASS |

` +
        `Do NOT add placeholder or generic evidence. Each row must cite real, verifiable artifacts.`;
    // Append captured gate output if available (task-1387)
    if (gateOutput && (gateOutput.stdout || gateOutput.stderr)) {
        const totalOutput = (gateOutput.stdout || '') + (gateOutput.stderr || '');
        // Truncate if total output exceeds 16000 chars; keep last 8000 chars
        const truncated = totalOutput.length > 16000
            ? `[truncated — total ${totalOutput.length} chars, showing last 8000]\n` + totalOutput.slice(-8000)
            : totalOutput;
        prompt += `\n\n--- Captured Gate Output ---\n${truncated}`;
    }
    return prompt;
}
/**
 * Attempt to repair a failed automated handoff by auto-committing mission
 * artifacts or rebasing.
 *
 * @param {string} slug - Mission slug
 * @param {string} worktree - Path to the mission worktree
 * @param {string} errorMsg - The error message from the failed handoff
 * @param {object} [options]
 * @returns {Promise<{repaired: boolean, blocker: string|null}>} Result and optional blocker reason
  */
async function repairHandoff(slug, worktree, errorMsg, options = {}) {
    /** @type {{gitFn?: Function, rebaseFn?: Function, log?: Function, error?: Function}} */
    const opts = options;
    const { gitFn = git_js_1.git, rebaseFn = rebase_js_1.default, log = fmt.log.plain, error = fmt.log.plainError } = opts;
    const rootDir = worktree || process.cwd();
    let repaired = false;
    let blocker = null;
    /** @param {string} line */
    function parsePorcelainPath(line) {
        const xy = line.slice(0, 2);
        const rawPath = line.slice(3).trim();
        const pathPart = rawPath.includes('->') ? (rawPath.split('->').pop() || '').trim() : rawPath;
        const cleanPath = (pathPart.startsWith('"') && pathPart.endsWith('"')) ? pathPart.slice(1, -1) : pathPart;
        return { xy, file: cleanPath };
    }
    // 0. Check if error is repairable via classifyError
    const classification = classifyError(errorMsg);
    const isGitBlocker = classification.failureClass === FailureClass.GitBlockers;
    // Derive isBehind from classification result (avoids duplicating classifyError's behind-branch patterns)
    const isBehind = classification.reason === 'behind';
    if (!isGitBlocker) {
        if (classification.failureClass === FailureClass.InfraBlocker) {
            blocker = `Infrastructure blocker detected: the handoff error is infrastructure-related (likely Forgejo credentials, connectivity, or rate limits). No agent relaunch will resolve this — the operator must check the Forgejo instance, verify credentials/token validity, and confirm network connectivity before retrying.`;
            log(blocker);
            return { repaired: false, blocker };
        }
        log(`Handoff error is not automatically repairable: ${errorMsg}`);
        return { repaired: false, blocker: null };
    }
    // 1. Auto-commit mission artifacts if uncommitted
    if (isGitBlocker) {
        const statusResult = gitFn(['-C', rootDir, 'status', '--porcelain']);
        if (statusResult.status === 0 && statusResult.stdout) {
            const dirtyLines = statusResult.stdout.split('\n')
                .filter((line) => line.trim().length > 0);
            const dirtyFilesWithStatus = dirtyLines.map(parsePorcelainPath);
            const unmerged = dirtyFilesWithStatus.filter((f) => ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'].includes(f.xy));
            if (unmerged.length > 0) {
                blocker = `Conflicted files detected:\n${unmerged.map((f) => `       - ${f.file}`).join('\n')}`;
                log(`Cannot auto-commit: ${blocker}`);
                return { repaired: false, blocker };
            }
            const dirtyFiles = dirtyFilesWithStatus.map((f) => f.file);
            const isSafeToCommit = (/** @type{string} */ file) => missionUtils.isWorkflowGeneratedArtifact(file)
                || missionUtils.isMissionArtifact(file, slug, rootDir);
            const safeFiles = dirtyFiles.filter(isSafeToCommit);
            const unsafeFiles = dirtyFiles.filter((f) => !isSafeToCommit(f));
            if (unsafeFiles.length > 0) {
                log(`Cannot auto-commit: dirty files include non-mission paths:`);
                unsafeFiles.forEach((f) => log(`       - ${f}`));
                blocker = `dirty files include non-mission paths: ${unsafeFiles.join(', ')}`;
                return { repaired: false, blocker };
            }
            else if (safeFiles.length > 0) {
                log(`Auto-committing mission artifacts:`);
                const stageFailures = [];
                safeFiles.forEach((f) => {
                    log(`       - ${f}`);
                    const addResult = gitFn(['-C', rootDir, 'add', '--', f]);
                    if (addResult.status === 0) {
                        return;
                    }
                    else {
                        const failureText = [addResult.stderr, addResult.stdout].filter(Boolean).join('\n').trim();
                        stageFailures.push(`${f}${failureText ? `: ${failureText}` : ''}`);
                    }
                });
                if (stageFailures.length > 0) {
                    blocker = `failed to stage mission artifacts: ${stageFailures.join(', ')}`;
                    error(fmt.status('FAIL', blocker));
                    return { repaired: false, blocker };
                }
                const commitRes = gitFn(['-C', rootDir, 'commit', '-m', `workflow(${slug}): auto-commit mission artifacts before handoff`]);
                if (commitRes.status === 0) {
                    log(fmt.status('PASS', 'Mission artifacts committed.'));
                    repaired = true;
                }
                else {
                    error(fmt.status('WARN', `Failed to commit mission artifacts: ${commitRes.stderr}`));
                    blocker = `failed to commit mission artifacts: ${commitRes.stderr}`;
                    return { repaired: false, blocker };
                }
            }
        }
    }
    // 2. Auto-rebase if branch is behind
    if (isBehind) {
        log('Branch appears behind primary branch. Calling rebase...');
        let rebaseSuccess = false;
        let rebaseError = null;
        try {
            await rebaseFn([slug], {
                gitFn: (args, opts) => gitFn(args, { ...opts, cwd: rootDir }),
                getCurrentBranchFn: () => (0, git_js_1.getCurrentBranch)(rootDir),
                exitFn: (code) => {
                    if (code === 0) {
                        rebaseSuccess = true;
                    }
                    else {
                        rebaseError = `rebase exited with code ${code}`;
                    }
                }
            });
        }
        catch (err) {
            rebaseError = (err instanceof Error) ? err.message : String(err);
        }
        if (!rebaseSuccess) {
            const msg = rebaseError || 'unknown rebase failure';
            error(fmt.status('WARN', `Auto-rebase failed: ${msg}`));
            blocker = `Auto-rebase failed: ${msg}`;
            repaired = false; // Reset repaired if rebase fails, even if auto-commit succeeded
        }
        else {
            repaired = true;
        }
    }
    return { repaired, blocker };
}
repairHandoff.isRelaunchableError = isRelaunchableError;
repairHandoff.buildRelaunchPrompt = buildRelaunchPrompt;
repairHandoff.classifyError = classifyError;
repairHandoff.getDispatchAction = getDispatchAction;
repairHandoff.FailureClass = FailureClass;
repairHandoff.DispatchAction = DispatchAction;
exports.default = repairHandoff;
if (typeof module !== 'undefined') {
    module.exports = repairHandoff;
}
