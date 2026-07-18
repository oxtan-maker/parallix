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
exports.missionStart = missionStart;
exports.completePreflightOrExit = completePreflightOrExit;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const fmt = __importStar(require("../core/fmt.js"));
const git_js_1 = require("../core/git.js");
const backlog_js_1 = require("../tools/backlog.js");
const product_config_js_1 = require("../core/product-config.js");
const setup_review_js_1 = require("../tools/setup-review.js");
const state_map_js_1 = require("../core/state-map.js");
const mission_utils_js_1 = require("../core/mission-utils.js");
const forgejo_js_1 = require("../tools/forgejo.js");
const product_config_js_2 = require("../core/product-config.js");
const stats_js_1 = __importDefault(require("./stats.js"));
/** @param {string[]} args @param {{log?: Function, error?: Function, cwdFn?: Function, getCurrentBranchFn?: Function, resolveTaskFileFn?: Function, getTaskStatusFn?: Function, toVirtualFn?: Function, findMissionDirFn?: Function, findCheckpointsFn?: Function, getFirstLineFn?: Function, inferSlugFn?: Function, getMissionYearFn?: Function, conventionalWorktreePathFn?: Function, getLastCommitFn?: Function, getPrStatusFn?: Function, evaluateRepositoryReadinessFn?: Function, evaluateReviewSetupFn?: Function, adapterChecklistFn?: Function, resolveMissionClassificationFn?: Function, isForgejoReviewEnabledFn?: Function, fsExistsSync?: Function, resolveMissionBaseBranchFn?: Function, getPrimaryBranchFn?: Function, gitFn?: Function, command?: string, returnResult?: boolean}} opts */
function missionStart(args, opts = {}) {
    const log = opts.log || fmt.log.plain;
    const error = opts.error || fmt.log.plainError;
    const cwdFn = opts.cwdFn || (() => process.cwd());
    const getCurrentBranchFn = opts.getCurrentBranchFn || git_js_1.getCurrentBranch;
    const resolveTaskFileFn = opts.resolveTaskFileFn || backlog_js_1.resolveTaskFile;
    const getTaskStatusFn = opts.getTaskStatusFn || backlog_js_1.getTaskStatus;
    const toVirtualFn = opts.toVirtualFn || state_map_js_1.toVirtual;
    const findMissionDirFn = opts.findMissionDirFn || mission_utils_js_1.findMissionDir;
    const findCheckpointsFn = opts.findCheckpointsFn || mission_utils_js_1.findCheckpoints;
    const getFirstLineFn = opts.getFirstLineFn || mission_utils_js_1.getFirstLine;
    const inferSlugFn = opts.inferSlugFn || mission_utils_js_1.inferSlug;
    const getMissionYearFn = opts.getMissionYearFn || mission_utils_js_1.getMissionYear;
    const conventionalWorktreePathFn = opts.conventionalWorktreePathFn || mission_utils_js_1.conventionalWorktreePath;
    const getLastCommitFn = opts.getLastCommitFn || git_js_1.getLastCommit;
    const getPrStatusFn = opts.getPrStatusFn || forgejo_js_1.getPrStatus;
    const evaluateRepositoryReadinessFn = opts.evaluateRepositoryReadinessFn || product_config_js_1.evaluateRepositoryReadiness;
    const evaluateReviewSetupFn = opts.evaluateReviewSetupFn || setup_review_js_1.evaluateReviewSetup;
    const adapterChecklistFn = opts.adapterChecklistFn || product_config_js_1.adapterChecklist;
    const resolveMissionClassificationFn = opts.resolveMissionClassificationFn || stats_js_1.default.resolveMissionClassification;
    const isForgejoReviewEnabledFn = opts.isForgejoReviewEnabledFn || product_config_js_2.isForgejoReviewEnabled;
    const fsExistsSync = opts.fsExistsSync || fs.existsSync;
    const resolveMissionBaseBranchFn = opts.resolveMissionBaseBranchFn || mission_utils_js_1.resolveMissionBaseBranch;
    const getPrimaryBranchFn = opts.getPrimaryBranchFn || mission_utils_js_1.getPrimaryBranch;
    const runFn = opts.gitFn || git_js_1.git;
    const explicitSlug = args[0];
    const slug = inferSlugFn(explicitSlug);
    const isVerifyOnly = opts.command === 'verify-env' || !slug;
    const returnResult = Boolean(opts.returnResult);
    if (isVerifyOnly) {
        log(fmt.status('INFO', 'Running environment diagnostics (verify-env)...'));
    }
    else {
        log(fmt.status('INFO', `Running mission startup preflight for: ${fmt.slug(slug)}`));
    }
    let overallFail = false;
    /** @type{string[]} */
    const remediationSteps = [];
    // Check 1: PWD
    const cwd = cwdFn();
    const reportReviewSetup = () => {
        const reviewSetup = evaluateReviewSetupFn(cwd);
        if (reviewSetup.required && reviewSetup.ok) {
            log(fmt.status('PASS', 'Forgejo review setup: token files, auth, and git remote are ready.'));
        }
        else if (reviewSetup.required && !reviewSetup.ok) {
            log(fmt.status('WARN', 'Forgejo review setup: review actions are not ready yet.'));
            for (const issue of reviewSetup.issues) {
                log(fmt.status('INFO', issue));
            }
            for (const step of reviewSetup.steps) {
                log(fmt.status('INFO', step));
            }
        }
    };
    const reportRepositoryReadiness = () => {
        const readiness = evaluateRepositoryReadinessFn(cwd);
        if (readiness.mode === 'default') {
            log(fmt.status('PASS', 'Workflow config: using built-in defaults (create workflow.config.json to override).'));
            reportReviewSetup();
            return;
        }
        if (readiness.mode === 'configured') {
            log(fmt.status('PASS', `Workflow config: ${readiness.configPath}`));
            log(fmt.status('PASS', 'Repository adapters: override sections are valid.'));
            reportReviewSetup();
            return;
        }
        // mode === 'invalid'
        log(fmt.status('FAIL', `Workflow config: ${readiness.configPath || 'workflow.config.json'}`));
        for (const issue of readiness.issues) {
            log(fmt.status('INFO', issue));
        }
        for (const step of adapterChecklistFn()) {
            log(fmt.status('INFO', step));
        }
        overallFail = true;
        remediationSteps.push('Fix workflow.config.json: ensure it is valid JSON and adapters is an object with valid subsections.');
    };
    if (isVerifyOnly) {
        log(fmt.status('PASS', `PWD: ${fmt.path(cwd)}`));
    }
    else {
        const expectedPath = conventionalWorktreePathFn(slug);
        if (cwd === expectedPath || cwd.endsWith(slug)) {
            log(fmt.status('PASS', `PWD: matches expected mission worktree path ${fmt.path(expectedPath)}`));
        }
        else {
            log(fmt.status('FAIL', `PWD: ${fmt.path(cwd)} does not match expected mission worktree path ${fmt.path(expectedPath)}`));
            overallFail = true;
        }
    }
    // Check 2: Branch
    const currentBranch = getCurrentBranchFn();
    if (isVerifyOnly) {
        log(fmt.status('PASS', `Branch: ${fmt.branch(currentBranch)}`));
    }
    else {
        const expectedBranch = `mission/${slug}`;
        if (currentBranch === expectedBranch) {
            log(fmt.status('PASS', `Branch: ${fmt.branch(currentBranch)}`));
        }
        else {
            log(fmt.status('FAIL', `Branch: ${fmt.branch(currentBranch)} does not match expected mission branch ${fmt.branch(expectedBranch)}`));
            overallFail = true;
        }
    }
    if (isVerifyOnly) {
        reportRepositoryReadiness();
    }
    // Check 3: Backlog task
    if (slug) {
        const taskResolution = resolveTaskFileFn(slug, cwd);
        if (taskResolution.ok) {
            const status = getTaskStatusFn(taskResolution.taskFile);
            const virtualStatus = toVirtualFn(status);
            if (!isVerifyOnly) {
                if (virtualStatus === 'ready' || virtualStatus === 'active' || virtualStatus === 'review') {
                    log(fmt.status('PASS', `Backlog task status: ${status}`));
                }
                else if (virtualStatus === 'backlog' || virtualStatus === 'draft') {
                    log(fmt.status('WARN', `Backlog task status: ${status} (expected 'ready', 'active', or 'review')`));
                }
                else {
                    log(fmt.status('FAIL', `Backlog task status: ${status} (mission already complete)`));
                    overallFail = true;
                }
            }
            else {
                log(fmt.status('PASS', `Backlog task status: ${status}`));
            }
            try {
                const { classification, error: classificationError } = resolveMissionClassificationFn(slug, cwd);
                if (!classification) {
                    log(fmt.status('FAIL', `Backlog classification: ${classificationError || 'missing'}`));
                    overallFail = true;
                }
                else {
                    log(fmt.status('PASS', `Backlog classification: ${classification}`));
                }
            }
            catch (error) {
                log(fmt.status('FAIL', `Backlog classification: ${error.message}`));
                overallFail = true;
            }
        }
        else {
            if (taskResolution.reason === 'missing') {
                const fallbackClassification = resolveMissionClassificationFn(slug, cwd);
                log(fmt.status('WARN', `Backlog task: no task file found for ${fmt.slug(slug)}; continuing with classification ${fallbackClassification.classification}.`));
                log(fmt.status('PASS', `Backlog classification: ${fallbackClassification.classification}`));
            }
            else {
                (0, backlog_js_1.reportTaskResolution)(taskResolution, slug, log);
                overallFail = true;
            }
        }
    }
    // Check 4: Mission docs + base branch
    if (!isVerifyOnly) {
        const missionDir = findMissionDirFn(slug);
        if (missionDir) {
            const missionFile = path.join(missionDir, 'MISSION.md');
            if (fsExistsSync(missionFile)) {
                const checkpoints = findCheckpointsFn(missionDir);
                if (checkpoints.length > 0) {
                    const lastCP = checkpoints[checkpoints.length - 1];
                    const firstLine = getFirstLineFn(lastCP);
                    log(fmt.status('PASS', `Mission doc: found MISSION.md. Most recent checkpoint: ${fmt.path(path.basename(lastCP))} (${firstLine})`));
                }
                else {
                    log(fmt.status('WARN', `Mission doc: found MISSION.md but no checkpoints yet. Start from CP-1.`));
                }
                // Base branch validation: when a mission records a non-primary base,
                // verify the base branch exists locally so integrate won't fail silently.
                const primaryBranch = getPrimaryBranchFn();
                let recordedBase;
                try {
                    recordedBase = resolveMissionBaseBranchFn(slug, cwd);
                }
                catch (_) {
                    recordedBase = null;
                }
                if (recordedBase && recordedBase !== primaryBranch) {
                    const checkResult = runFn(['-C', cwd, 'show-ref', '--verify', '--quiet', `refs/heads/${recordedBase}`], { cwd });
                    if (!checkResult || checkResult.status !== 0) {
                        log(fmt.status('FAIL', `Preflight: base branch '${recordedBase}' recorded in MISSION.md does not exist locally. Create or fetch the '${recordedBase}' base branch before starting this mission.`));
                        overallFail = true;
                    }
                    else {
                        log(fmt.status('PASS', `Preflight: base branch '${recordedBase}' exists locally.`));
                    }
                }
            }
            else {
                log(fmt.status('FAIL', `Mission doc: found directory but MISSION.md is missing in ${fmt.path(missionDir)}`));
                overallFail = true;
            }
        }
        else {
            log(fmt.status('FAIL', `Mission doc: directory not found in docs/missions/${getMissionYearFn(slug)}/ for slug ${fmt.slug(slug)}`));
            overallFail = true;
        }
    }
    // Check 5: Last commit
    const lastCommit = getLastCommitFn();
    log(fmt.status('PASS', `Last commit: ${fmt.sha(lastCommit.sha.substring(0, 8))} - ${lastCommit.subject} (${lastCommit.date})`));
    // Check 6: Forgejo PR (skipped when review provider is not forgejo)
    if (!isVerifyOnly && isForgejoReviewEnabledFn(cwd)) {
        const pr = getPrStatusFn(`mission/${slug}`);
        if (!pr.exists) {
            log(fmt.status('PASS', `Forgejo PR: no PR found (ready for startup)`));
        }
        else if (pr.state === 'open') {
            log(fmt.status('PASS', `Forgejo PR: found OPEN PR (#${pr.number})`));
        }
        else {
            log(fmt.status('PASS', `Forgejo PR: found ${pr.state ? pr.state.toUpperCase() : 'UNKNOWN'} PR (#${pr.number})`));
        }
    }
    return completePreflightOrExit(overallFail, returnResult, { log, error, remediationSteps });
}
// Extracted so callers can test the returnResult path without live git dependencies.
/** @param {boolean} overallFail @param {boolean} returnResult @param {{error?: Function, log?: Function, remediationSteps?: string[]}} options */
function completePreflightOrExit(overallFail, returnResult, options = {}) {
    /** @type{{error?: Function, log?: Function, remediationSteps?: string[]}} */
    const opts = options;
    const error = opts.error || fmt.log.plainError;
    const log = opts.log || fmt.log.plain;
    const remediationSteps = opts.remediationSteps || [];
    if (overallFail) {
        let msg = '\n' + fmt.status('FAIL', 'Environment verdict: NOT USABLE');
        if (remediationSteps.length > 0) {
            msg += ' — remediation:';
            for (const step of remediationSteps) {
                msg += `\n  - ${step}`;
            }
        }
        else {
            msg += ' — fix blockers above before proceeding.';
        }
        error(msg);
        if (returnResult) {
            return { pass: false };
        }
        process.exit(1);
    }
    else {
        log('\n' + fmt.status('PASS', 'Environment verdict: USABLE — this repository is ready for workflow commands.'));
        if (returnResult) {
            return { pass: true };
        }
        process.exit(0);
    }
}
missionStart.completePreflightOrExit = completePreflightOrExit;
exports.default = missionStart;
if (typeof module !== 'undefined') {
    module.exports = missionStart;
}
