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
exports.gatekeeper = exports.handoff = void 0;
exports._evidenceCellHasVerifiableReference = evidenceCellHasVerifiableReference;
exports.verifyHandoff = verifyHandoff;
exports.performHandoff = performHandoff;
exports.runDeclaredGates = runDeclaredGates;
exports.captureNelAtHandoff = captureNelAtHandoff;
exports.validateDeclaredGates = validateDeclaredGates;
// @ts-nocheck
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const node_child_process_1 = require("node:child_process");
const git = __importStar(require("../core/git.js"));
const missionUtils = __importStar(require("../core/mission-utils.js"));
const backlog = __importStar(require("../tools/backlog.js"));
const forgejo = __importStar(require("../tools/forgejo.js"));
const review_state_js_1 = require("../review/review-state.js");
const setupReview = __importStar(require("../tools/setup-review.js"));
const gatekeeper = __importStar(require("../tools/gatekeeper.js"));
exports.gatekeeper = gatekeeper;
const fmt = __importStar(require("../core/fmt.js"));
const verification_js_1 = require("../core/verification.js");
const product_config_js_1 = require("../core/product-config.js");
const rebase_js_1 = require("../review/rebase.js");
const nels = __importStar(require("../core/nels.js"));
const storage_js_1 = require("../core/storage.js");
const active_js_1 = require("./active.js");
/**
  * Verifies that the current environment is ready for handoff.
  *
  * @param {string} slug - Mission slug
  * @param {{worktree?: string}} [options]
  * @returns {{ ok: boolean, error?: string, missionDir?: string, area?: string, branch?: string, rootDir?: string }}
  */
function verifyHandoff(slug, options = {}) {
    /** @type{{worktree?: string}} */
    const opts = options;
    const rootDir = opts.worktree || process.cwd();
    const missionDir = missionUtils.findMissionDir(slug, rootDir);
    if (!missionDir) {
        return { ok: false, error: `Mission directory not found for slug: ${slug}` };
    }
    const area = missionUtils.findMissionArea(missionDir);
    const branch = missionUtils.missionBranchName(slug, rootDir);
    const current = git.getCurrentBranch(rootDir);
    if (current !== branch) {
        return { ok: false, error: `Not on mission branch. Current: ${current}, Expected: ${branch}` };
    }
    const missionMdPath = path.join(missionDir, 'MISSION.md');
    if (!fs.existsSync(missionMdPath)) {
        return { ok: false, error: `MISSION.md not found at ${missionMdPath}. The mission contract must exist before handoff.` };
    }
    return { ok: true, missionDir, area, branch, rootDir };
}
function collectGoalCheckEvidenceRows(afterHeader) {
    const separatorPattern = /^\|(?:\s*:?-+:?\s*\|)+$/;
    const headerPattern = /^\| .+\| .+\| .+\|$/;
    const evidenceLinePattern = /^\| .+\| .+\| .+\|$/;
    const linesAfterHeader = afterHeader.split('\n');
    const evidenceRows = [];
    let pastHeader = false;
    for (const line of linesAfterHeader) {
        const trimmed = line.trim();
        if (trimmed === '') {
            continue;
        }
        if (!pastHeader && headerPattern.test(trimmed)) {
            pastHeader = true;
            continue;
        }
        if (separatorPattern.test(trimmed)) {
            continue;
        }
        if (pastHeader && evidenceLinePattern.test(trimmed)) {
            evidenceRows.push(trimmed);
            continue;
        }
        break;
    }
    return evidenceRows;
}
function collectRepoTestNames(rootDir) {
    const names = new Set();
    const testRoot = path.join(rootDir, 'test');
    if (!fs.existsSync(testRoot)) {
        return names;
    }
    const queue = [testRoot];
    while (queue.length > 0) {
        const current = queue.pop();
        let entries = [];
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const entry of entries) {
            const fullPath = path.join(current, entry.name);
            if (entry.isDirectory()) {
                queue.push(fullPath);
                continue;
            }
            if (!entry.isFile() || !/\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(entry.name)) {
                continue;
            }
            const content = fs.readFileSync(fullPath, 'utf8');
            const testNamePattern = /\b(?:test|it)(?:\.\w+)?\s*\(\s*(['"`])([^'"`]+)\1/g;
            let match;
            while ((match = testNamePattern.exec(content)) !== null) {
                names.add(match[2]);
            }
        }
    }
    return names;
}
function evidenceCellHasVerifiableReference(cell, rootDir, knownTestNames) {
    const normalized = cell.replace(/\[[^\]]+\]\(([^)]+)\)/g, '$1');
    const fileLinePattern = /(?:^|[\s(`])((?:\/|\.\/)?[\w./-]+\.[\w-]+):(\d+)(?:-\d+)?/g;
    let fileLineMatch;
    while ((fileLineMatch = fileLinePattern.exec(normalized)) !== null) {
        const candidatePath = fileLineMatch[1];
        const resolved = path.isAbsolute(candidatePath)
            ? candidatePath
            : path.join(rootDir, candidatePath.replace(/^\.\//, ''));
        if (fs.existsSync(resolved)) {
            return true;
        }
    }
    const adrPattern = /\bADR\s+(\d{4})\b/g;
    let adrMatch;
    while ((adrMatch = adrPattern.exec(normalized)) !== null) {
        const prefix = `${adrMatch[1]}-`;
        const adrDir = path.join(rootDir, 'docs', 'adr');
        if (fs.existsSync(adrDir) && fs.readdirSync(adrDir).some(name => name.startsWith(prefix) && name.endsWith('.md'))) {
            return true;
        }
    }
    const quotedPattern = /(['"`])([^'"`]+)\1/g;
    let quotedMatch;
    while ((quotedMatch = quotedPattern.exec(normalized)) !== null) {
        if (knownTestNames.has(quotedMatch[2])) {
            return true;
        }
    }
    const testFilePattern = /(?:^|[\s(`])((?:\/|\.\/)?[\w./-]+\.(?:test|spec)\.[cm]?[jt]sx?)(?=$|[\s),`])/g;
    while (testFilePattern.exec(normalized) !== null) {
        return true;
    }
    const inlineCommandPattern = /`([^`]+)`/g;
    let commandMatch;
    while ((commandMatch = inlineCommandPattern.exec(cell)) !== null) {
        const command = commandMatch[1].trim();
        if (/^(npm|npx|node|git|px)\s+/i.test(command)) {
            return true;
        }
        // Common shell commands followed by a file argument (e.g. `bash hello.sh`,
        // `cat output.txt`). The file path is checked against rootDir.
        if (/^(bash|sh|cat|head|tail|diff|grep|sed|awk|xxd|od|wc|sort|uniq)\s+/i.test(command)) {
            const args = command.split(/\s+/).slice(1);
            for (const arg of args) {
                // Skip flags like -n, --context, etc.
                if (arg.startsWith('-')) {
                    continue;
                }
                const candidatePath = arg.replace(/^\.\//, '');
                if (fs.existsSync(path.join(rootDir, candidatePath))) {
                    return true;
                }
            }
        }
        if (command.startsWith('./')) {
            const commandPath = command.split(/\s+/)[0];
            if (fs.existsSync(path.join(rootDir, commandPath.replace(/^\.\//, '')))) {
                return true;
            }
        }
    }
    return false;
}
function findUnverifiableGoalCheckRow(evidenceRows, rootDir) {
    const knownTestNames = collectRepoTestNames(rootDir);
    for (const row of evidenceRows) {
        const columns = row.split('|').slice(1, -1).map(part => part.trim()).filter(Boolean);
        if (columns.some(cell => evidenceCellHasVerifiableReference(cell, rootDir, knownTestNames))) {
            continue;
        }
        return row;
    }
    return null;
}
/**
  * Performs the handoff process for a mission:
  * 1. Runs the verification gate.
  * 2. Syncs primary branch and pushes the mission branch to Forgejo, creating or updating the PR.
  * 3. Transitions Backlog task to 'review'.
  * 4. Commits and pushes the Backlog state change to Forgejo.
  *
  * @param {string} slug - Mission slug
  * @param {{skipGate?: boolean, worktree?: string|null, force?: boolean, forceWithLease?: boolean, log?: Function, error?: Function, rebaseFn?: Function, isForgejoReviewEnabledFn?: Function, captureNelFn?: Function}} [options]
  * @returns {Promise<{ ok: boolean, error?: string, gatekeeperPushedBack?: boolean }>}
  */
async function performHandoff(slug, options = {}) {
    /** @type{{skipGate?: boolean, worktree?: string|null, force?: boolean, forceWithLease?: boolean, log?: Function, error?: Function, rebaseFn?: Function, isForgejoReviewEnabledFn?: Function, runVerificationGateFn?: Function, maxAttempts?: number, attemptAgentRelaunchFn?: Function, remainingRetries?: number, runGatekeeperFn?: Function, captureNelFn?: Function}} */
    const opts = options;
    const { skipGate = false, worktree = null, force = false, forceWithLease = true, log = fmt.log.info, error = fmt.log.fail, rebaseFn = rebase_js_1.rebaseBeforeReviewRound, runVerificationGateFn = verification_js_1.runVerificationGate, maxAttempts, attemptAgentRelaunchFn = active_js_1.attemptAgentRelaunch, remainingRetries, runGatekeeperFn = gatekeeper.runGatekeeper, captureNelFn = captureNelAtHandoff } = opts;
    // Recursion guard: prevent infinite retry loops when gatekeeper pushback
    // persists across relaunch attempts. Hard limit of 3 total handoff invocations.
    const currentAttempt = maxAttempts || 1;
    if (currentAttempt > 3) {
        const msg = `Handoff exceeded maximum attempts (3). Manual intervention required.`;
        error(msg);
        return { ok: false, error: msg };
    }
    // Global retry budget: controls total relaunch attempts across all recursive calls.
    // Default is 2 (one initial + one retry). Decremented with each relaunch.
    let retriesLeft = remainingRetries !== undefined ? remainingRetries : 2;
    const verification = verifyHandoff(slug, { worktree: worktree || undefined });
    if (!verification.ok) {
        error(verification.error);
        return { ok: false, error: verification.error };
    }
    const { area, branch, missionDir } = verification;
    const rootDir = /** @type {string} */ (verification.rootDir);
    const missionDirPath = /** @type {string} */ (missionDir);
    // Step 0: Resolve Backlog task for identity derivation
    const taskResolution = backlog.resolveTaskFile(slug, rootDir);
    if (!taskResolution.ok) {
        const msg = `Backlog task file for ${fmt.slug(slug)} not found or ambiguous: ${taskResolution.reason}.`;
        error(msg);
        return { ok: false, error: msg };
    }
    // Pre-handoff Content Integrity Check
    const relativeMissionPath = path.relative(rootDir, path.join(missionDirPath, 'MISSION.md'));
    const dirtyFiles = git.getWorktreeStatus(rootDir);
    let checkpoints = missionUtils.findCheckpoints(missionDirPath);
    if (dirtyFiles.some(line => line.endsWith(relativeMissionPath))) {
        const msg = `${fmt.path('MISSION.md')} is modified but uncommitted at ${fmt.path(relativeMissionPath)}. Commit the mission contract before handoff.`;
        error(msg);
        return { ok: false, error: msg };
    }
    if (checkpoints.length === 0) {
        // Auto-remediation (task-1228): rather than hard-failing when no checkpoint
        // document exists, generate a minimal default CP-1.md with a valid Goal Check
        // table so the handoff can proceed without manual intervention. The generated
        // file is clearly marked as auto-generated for reviewer awareness, then we
        // re-scan to confirm it is discoverable via findCheckpoints().
        const autoCheckpointPath = path.join(missionDirPath, 'CP-1.md');
        fs.writeFileSync(autoCheckpointPath, buildAutoCheckpointContent(slug), 'utf8');
        log(fmt.status('WARN', `No checkpoint documents found — auto-generated ${fmt.path('CP-1.md')} in ${fmt.path(missionDirPath)}.`));
        checkpoints = missionUtils.findCheckpoints(missionDirPath);
        if (checkpoints.length === 0) {
            const msg = `No checkpoint documents found in ${fmt.path(missionDirPath)} even after auto-remediation. Implementation evidence is mandatory for review.`;
            error(msg);
            return { ok: false, error: msg };
        }
        // Commit the auto-generated checkpoint so it is included in the handoff push
        // and does not trip the uncommitted-checkpoint check below.
        git.git(['-C', rootDir, 'add', autoCheckpointPath]);
        const commitRes = git.git(['-C', rootDir, 'commit', '-m', `docs(${slug}): auto-generate CP-1.md checkpoint (handoff remediation)`]);
        if (commitRes.status !== 0) {
            log(fmt.status('WARN', `Could not commit auto-generated CP-1.md for ${fmt.slug(slug)}; continuing handoff.`));
        }
    }
    /** @type {string} */
    const finalCheckpoint = checkpoints[checkpoints.length - 1];
    const relativeCheckpointPath = path.relative(rootDir, finalCheckpoint);
    if (dirtyFiles.some(line => line.endsWith(relativeCheckpointPath))) {
        const msg = `The latest checkpoint document is modified but uncommitted at ${fmt.path(relativeCheckpointPath)}. Commit the implementation evidence before handoff.`;
        error(msg);
        return { ok: false, error: msg };
    }
    // Pre-handoff Content Integrity Check: final checkpoint must contain a Goal Check table
    // with real evidence. Per review.md step 5, a missing or empty goal-check table
    // means the checkpoint has not satisfied the mission's evidence requirement.
    // Accept both `## Goal Check` and `## Goal Check Table` heading variants used across repo artifacts.
    const checkpointContent = fs.readFileSync(finalCheckpoint, 'utf8');
    const goalCheckMatch = checkpointContent.match(/^## Goal Check(?: Table)?\s*$/m);
    if (!goalCheckMatch) {
        const msg = `The final checkpoint at ${fmt.path(relativeCheckpointPath)} is missing a "## Goal Check" section. Review requires a goal-check table with real evidence before handoff.`;
        error(msg);
        return { ok: false, error: msg };
    }
    // Verify the goal-check table has at least one row of evidence (table row after header).
    // Must exclude table separator rows (|---|---|---|) and the header row itself —
    // only real evidence rows (with pipe-separated content that is not all dashes) count.
    const goalCheckMatchIndex = goalCheckMatch.index ?? 0;
    const afterHeader = checkpointContent.slice(goalCheckMatchIndex + goalCheckMatch[0].length);
    const evidenceRows = collectGoalCheckEvidenceRows(afterHeader);
    if (evidenceRows.length === 0) {
        const msg = `The final checkpoint at ${fmt.path(relativeCheckpointPath)} has a "## Goal Check" section but no evidence rows. A goal-check table with real evidence is required before handoff.`;
        error(msg);
        return { ok: false, error: msg };
    }
    const unverifiableRow = findUnverifiableGoalCheckRow(evidenceRows, rootDir);
    if (unverifiableRow) {
        const msg = `The final checkpoint at ${fmt.path(relativeCheckpointPath)} has a "## Goal Check" section but no evidence rows that cite a verifiable reference such as a file:line, ADR, test reference, or recognized repo command/path. A goal-check table with real evidence is required before handoff. Offending row: ${unverifiableRow}`;
        error(msg);
        return { ok: false, error: msg };
    }
    const isForgejoReviewEnabledFn = opts.isForgejoReviewEnabledFn || product_config_js_1.isForgejoReviewEnabled;
    const forgejoEnabled = isForgejoReviewEnabledFn(rootDir);
    const { forgejoUser: reviewStateUser } = (0, review_state_js_1.resolveReviewIdentity)(slug, rootDir, {});
    const forgejoUser = reviewStateUser || backlog.getTaskImplementer(/** @type {string} */ (taskResolution.taskFile));
    if (!forgejoUser) {
        error('forgejoUser is required for performHandoff. Ensure review-state.json or the Backlog task has an agent family assigned.');
        return { ok: false, error: 'forgejoUser is required' };
    }
    log(`Starting handoff for mission ${fmt.slug(slug)}...`);
    // Step 1: Final Gate Run
    if (skipGate) {
        fmt.log.warn('Step 1: Skipping final verification gate (--no-gate)');
    }
    else {
        const verificationCommand = (0, verification_js_1.formatVerificationCommand)(area || 'docs', rootDir);
        // Bind a reusable proof to the inputs that existed before execution. A
        // successful process exit alone must not certify a tree changed mid-gate.
        const beforeGateProof = (0, verification_js_1.createVerificationProofIdentity)(verificationCommand, rootDir);
        log(`Step 1: Running final verification gate for area: ${fmt.bold(area || 'docs')}...`);
        const verifyResult = runVerificationGateFn(area || 'docs', {
            rootDir,
            stdio: 'pipe',
            runFn: git.run
        });
        if (verifyResult.status !== 0) {
            const stdout = (verifyResult.stdout || '').trim();
            const stderr = (verifyResult.stderr || '').trim();
            const msg = 'Final verification gate failed. Fix errors before submitting or use --no-gate if appropriate.';
            error(msg);
            return { ok: false, error: msg, gateOutput: { stdout, stderr } };
        }
        const proofResult = beforeGateProof.ok
            ? (0, verification_js_1.writeReusableVerificationProof)(verificationCommand, rootDir, { expectedIdentity: beforeGateProof.identity })
            : beforeGateProof;
        if (proofResult.ok) {
            log(`Step 1: Gate executed; stored proof ${proofResult.identity}.`);
        }
        else {
            log(`Step 1: Gate executed; proof unavailable (${proofResult.error}). Later boundaries will execute independently.`);
        }
    }
    // Step 1.5: Rebase mission branch onto latest primary before PR creation
    log('Step 1.5: Rebasing onto primary branch before handoff...');
    const rebaseResult = await rebaseFn(slug, {
        worktree: worktree || undefined,
        log,
        error,
        isForgejoReviewEnabledFn: isForgejoReviewEnabledFn,
    });
    if (!rebaseResult.ok) {
        if (rebaseResult.sharedFileConflicts) {
            const msg = 'Rebase encountered shared-file conflicts. Resolve the conflicts in the worktree, then re-run handoff.';
            error(msg);
            return { ok: false, error: msg };
        }
        else {
            const msg = 'Rebase failed before handoff. Ensure the mission branch can be rebased onto the latest primary branch.';
            error(msg);
            return { ok: false, error: msg };
        }
    }
    // Step 1.7: NEL capture — compute actual NEL from merge diff and persist record
    log('Step 1.7: Capturing Net Engineering Lines (NEL) at handoff...');
    const nelResult = captureNelFn(slug, { rootDir, missionDir: missionDirPath, log, error });
    if (nelResult.ok) {
        // The NEL record is durable mission state.  It is written after the initial
        // cleanliness check, so commit it before transitionTask rebases this
        // worktree onto the branch that owns Backlog state.  Otherwise the rebase
        // correctly refuses the uncommitted nel-record.json and handoff stalls
        // after the Backlog transition has already been committed.
        const nelRecordPath = path.join(missionDirPath, 'nel-record.json');
        const relativeNelRecordPath = path.relative(rootDir, nelRecordPath);
        // Stage the explicit durable artifact and inspect the index.  Do not infer
        // whether it changed from porcelain output: this check must not leave the
        // record behind for transitionTask's immediately following rebase.
        const stageNelRecord = git.git(['-C', rootDir, 'add', '--', relativeNelRecordPath]);
        if (stageNelRecord.status !== 0) {
            const msg = `Could not stage NEL record before handoff: ${(stageNelRecord.stderr || stageNelRecord.stdout || 'unknown git error').trim()}`;
            error(msg);
            return { ok: false, error: msg };
        }
        const nelRecordIsStaged = git.git(['-C', rootDir, 'diff', '--quiet', '--cached', '--', relativeNelRecordPath]).status === 1;
        if (nelRecordIsStaged) {
            const commitNelRecord = git.git(['-C', rootDir, 'commit', '-m', `chore(${slug}): capture handoff NEL`]);
            if (commitNelRecord.status !== 0) {
                const msg = `Could not commit NEL record before handoff: ${(commitNelRecord.stderr || commitNelRecord.stdout || 'unknown git error').trim()}`;
                error(msg);
                return { ok: false, error: msg };
            }
        }
        log(fmt.status('PASS', `NEL captured: ${nelResult.nel} NEL (${nelResult.bucket.label} bucket)`));
    }
    else if (nelResult.persistenceFailed) {
        const msg = `NEL persistence failed; handoff stopped before review state advanced: ${nelResult.error}`;
        error(msg);
        return { ok: false, error: msg };
    }
    else {
        log(fmt.status('WARN', `NEL capture skipped: ${nelResult.error}`));
    }
    // Step 2: Forgejo PR Update/Create (optional mirror when Forgejo is enabled)
    let token = null;
    let fallbackUser = null;
    let bootstrapFailureReason = null;
    if (forgejoEnabled) {
        log(`Step 2: Updating/Creating Forgejo PR as user ${fmt.agent(forgejoUser)}...`);
        token = forgejo.readToken(forgejoUser);
        if (!token) {
            // Token missing for the agent user — attempt non-interactive bootstrap
            error(`Token not found for ${fmt.agent(forgejoUser)}. Attempting non-interactive bootstrap...`);
            const reviewSettings = forgejo.resolveForgejoSettings(rootDir);
            const bootstrapSetup = {
                baseUrl: reviewSettings.url,
                repo: reviewSettings.repo,
                ownerLogin: 'human',
                ownerPassword: '',
                agentPasswords: [{ user: forgejoUser, password: '' }],
            };
            const bootstrapResult = await setupReview.bootstrapReviewSurface(rootDir, bootstrapSetup, {
                interactive: false,
                requestFn: setupReview.apiRequest,
                log,
            });
            if (bootstrapResult.ok) {
                log(fmt.status('PASS', `Bootstrap succeeded for ${fmt.agent(forgejoUser)}.`));
                token = forgejo.readToken(forgejoUser);
                if (!token) {
                    bootstrapFailureReason = 'bootstrap completed but token file for the agent user was not found';
                    error('Bootstrap completed but token file for the agent user was not found. Falling back to default user.');
                }
            }
            else {
                bootstrapFailureReason = bootstrapResult.error || 'unknown';
                error(`Bootstrap for ${fmt.agent(forgejoUser)} failed: ${bootstrapFailureReason}. Falling back to default user.`);
            }
            // Handle bootstrap result that may not have error property
            /** @type{{error?: string}} */
            const br = bootstrapResult;
            // Magnus fallback if bootstrap didn't produce a token
            if (!token) {
                token = forgejo.readToken('human');
                if (token) {
                    fallbackUser = 'human';
                    log(`Token not found for ${fmt.agent(forgejoUser)} and bootstrap did not succeed. Falling back to PR creation as ${fmt.agent(fallbackUser)}.`);
                }
                else {
                    const msg = `No Forgejo token found for user "${fmt.agent(forgejoUser)}", bootstrap failed (${br.error || 'unknown'}), and no fallback token available for "${fmt.agent('human')}". Manual action required: create a token manually or run \`node parallix setup-review\` first.`;
                    error(msg);
                    return { ok: false, error: msg };
                }
            }
        }
        // Persist durable fallback summary when we fell back to the default user
        if (fallbackUser === 'human') {
            const reason = bootstrapFailureReason || 'agent token was missing and bootstrap did not provide a replacement token';
            const fallbackSummary = `## Fallback: PR submitted as ${fmt.agent(fallbackUser)}\n\nOriginal user: ${fmt.agent(forgejoUser)}\nBootstrap failure reason: ${reason}`;
            if (!writeFallbackSummary(slug, fallbackSummary, { rootDir, log })) {
                log(fmt.status('WARN', `Could not persist fallback summary for ${fmt.slug(slug)}`));
            }
        }
        const prResult = forgejo.createPr(branch || '', String(fallbackUser || forgejoUser || 'default'), String(token || ''), {
            rootDir,
            log,
            forceWithLease
        });
        if (!prResult.ok) {
            const msg = `Forgejo PR creation/update failed: ${prResult.error}`;
            error(msg);
            return { ok: false, error: msg };
        }
    }
    else {
        log('Step 2: Skipping Forgejo PR (review provider is not forgejo).');
    }
    // Step 2.5: Gatekeeper pre-review validation
    // Run before transitioning Backlog to 'review' so missing artifacts are
    // flagged as a request-changes review instead of consuming a reviewer cycle.
    log('Step 2.5: Running gatekeeper pre-review validation...');
    const gatekeeperResult = runGatekeeperFn(slug, { rootDir, log });
    let gatekeeperPushedBack = false;
    if (!gatekeeperResult.ok && gatekeeperResult.posted) {
        fmt.log.warn(`Gatekeeper posted pushback for ${fmt.slug(slug)}: missing ${gatekeeperResult.missing.join(', ')}.`);
        gatekeeperPushedBack = true;
        log(`Keeping task ${fmt.slug(slug)} in active — not transitioning to review while artifacts are missing.`);
    }
    else if (!gatekeeperResult.ok && (gatekeeperResult.skipped || !gatekeeperResult.posted)) {
        fmt.log.fail(`Gatekeeper detected missing artifacts for ${fmt.slug(slug)} but could not post pushback: skipped=${gatekeeperResult.skipped}, posted=${gatekeeperResult.posted}. Blocking handoff — task remains in active until artifacts are present.`);
        error(`Missing mandatory artifacts: ${gatekeeperResult.missing.join(', ')}.`);
        return { ok: false, error: `Gatekeeper detected missing artifacts but could not post pushback (skipped=${gatekeeperResult.skipped}, posted=${gatekeeperResult.posted}). Fix missing artifacts before handoff: ${gatekeeperResult.missing.join(', ')}.` };
    }
    else {
        log('Gatekeeper: all mandatory artifacts present.');
    }
    if (gatekeeperPushedBack) {
        log(`Gatekeeper pushback posted for ${fmt.slug(slug)} — attempting automated artifact remediation...`);
        // Build a prompt listing every missing artifact with explicit creation instructions
        const missingItems = gatekeeperResult.missing;
        const relaunchPrompt = [
            `Gatekeeper pushback: missing mandatory artifacts for \`${slug}\`.`,
            '',
            'The following files are required before a reviewer engages:',
            '',
            ...missingItems.map(item => `- ${item}`),
            '',
            '**Action: create the missing artifacts so the handoff can proceed.**',
            '',
            ...missingItems
                .filter(item => item.includes('MISSION.md'))
                .map(() => '- **create** `MISSION.md` with the standard mission contract template (title, goal, scope, checkpoints, gates).'),
            ...missingItems
                .filter(item => item.includes('CP-'))
                .map(() => '- **create** at least one checkpoint document (e.g. `CP-1.md`) with a `## Goal Check` table containing real evidence (file:line, test names).'),
            ...missingItems
                .filter(item => item.includes('backlog/tasks') || item.includes('backlog/task'))
                .map(() => '- **create** a backlog task file at `backlog/tasks/<slug> - <title>.md` with YAML frontmatter (id, title, status, labels) and a description section.'),
            '',
            'After creating the missing artifacts, re-run the handoff (`px handoff ${slug}`).',
        ].join('\n');
        // Bounded retry: attempt agent relaunch using global retry budget
        const initialBudget = retriesLeft;
        while (retriesLeft > 0) {
            log(`Attempting agent relaunch (${initialBudget - retriesLeft + 1}/${initialBudget}) to create missing artifacts...`);
            const { relaunched, error: relaunchErr } = await attemptAgentRelaunchFn(slug, rootDir, `Gatekeeper pushback: missing artifacts for ${slug}: ${missingItems.join(', ')}`, forgejoUser, { log, error, promptOverride: relaunchPrompt });
            if (relaunched) {
                log('Agent relaunched successfully. Waiting for artifact creation...');
                // Re-run handoff with decremented retry budget
                const retryResult = await performHandoff(slug, {
                    worktree,
                    force: true,
                    isForgejoReviewEnabledFn: isForgejoReviewEnabledFn,
                    rebaseFn: rebaseFn,
                    runVerificationGateFn: runVerificationGateFn,
                    runGatekeeperFn: runGatekeeperFn,
                    attemptAgentRelaunchFn: attemptAgentRelaunchFn,
                    log,
                    error,
                    maxAttempts: currentAttempt + 1,
                    remainingRetries: retriesLeft - 1,
                });
                if (retryResult.ok) {
                    log('Handoff succeeded after agent relaunch.');
                    return { ...retryResult, gatekeeperPushedBack: true };
                }
                // Handoff still failed after relaunch — the recursive call already consumed
                // one retry attempt (via remainingRetries), so we break here rather than
                // continuing the parent's while loop.
                log(`Handoff still failed after relaunch: ${retryResult.error || 'unknown'}`);
                break;
            }
            else {
                log(`Agent relaunch failed: ${relaunchErr || 'unknown error'}`);
                break;
            }
        }
        // Retry budget exhausted
        const msg = `Gatekeeper pushback persisted after ${initialBudget} relaunch attempts. Manual intervention required to create: ${missingItems.join(', ')}.`;
        error(msg);
        return /** @type{{ok: boolean, gatekeeperPushedBack: boolean, error: string}} */ ({ ok: false, gatekeeperPushedBack: true, error: msg });
    }
    // Step 2.6: Generic ## Gates runner — execute any gates declared in MISSION.md
    log('Step 2.6: Running declared gates from MISSION.md...');
    const gatesResult = runDeclaredGates(verification.missionDir || '', rootDir, { log, error });
    if (!gatesResult.ok) {
        const msg = `Declared gate "${gatesResult.gate}" failed for ${fmt.slug(slug)}: ${gatesResult.error || gatesResult.reason}. Blocking handoff — task remains in active.`;
        error(msg);
        return {
            ok: false,
            error: msg,
            reason: gatesResult.reason,
            gateOutput: { stdout: (gatesResult.stdout || ''), stderr: (gatesResult.stderr || '') }
        };
    }
    if (gatesResult.skipped) {
        log(`No declared gates for ${fmt.slug(slug)} (${gatesResult.reason}).`);
    }
    else {
        log(`All ${gatesResult.count} declared gate(s) passed for ${fmt.slug(slug)}.`);
    }
    // Step 3 & 4: Backlog Transition and Commit
    log('Step 3 & 4: Transitioning and committing Backlog task to review...');
    const taskImplementer = forgejoUser;
    if (!backlog.transitionTask(slug, 'review', { implementer: taskImplementer, rootDir, log })) {
        const msg = `Could not transition task ${fmt.slug(slug)} to review.`;
        error(msg);
        return { ok: false, error: msg };
    }
    if (forgejoEnabled && token) {
        log('Pushing state change to Forgejo...');
        const reviewSettings = forgejo.resolveForgejoSettings(rootDir);
        const repoOwner = (reviewSettings.repo && reviewSettings.repo.split('/')[0]) || null;
        const ownerToken = repoOwner ? forgejo.readToken(repoOwner) : null;
        const pushUser = ownerToken && repoOwner ? repoOwner : (fallbackUser || forgejoUser);
        const pushToken = ownerToken || token;
        const remoteUrl = forgejo.authenticatedReviewUrl(pushUser, pushToken, rootDir);
        // transitionTask commits the Backlog state on its integration branch, then
        // rebases this mission branch onto that new commit. Step 2 has already
        // published the pre-transition tip to create/update the PR, so this push
        // is necessarily non-fast-forward even during an ordinary handoff. Use a
        // lease to update that known PR tip without overwriting a concurrent push.
        let pushLeaseArg = null;
        {
            const fetchArgs = ['-C', rootDir, 'fetch', remoteUrl, `+refs/heads/${branch}:refs/remotes/review/${branch}`];
            const fetchResult = git.git(fetchArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
            if (fetchResult.status !== 0) {
                const fetchError = (fetchResult.stderr || fetchResult.stdout || '').trim();
                const msg = `Failed to refresh Backlog transition lease for ${fmt.slug(slug)} before Forgejo push.`;
                error(`${msg}${fetchError ? ` ${fetchError}` : ''}`);
                return { ok: false, error: msg };
            }
            const tracking = forgejo.resolveTrackingBranchSha(branch || '', rootDir);
            if (!tracking.ok) {
                const msg = `Failed to resolve Backlog transition lease for ${fmt.slug(slug)} before Forgejo push.`;
                error(msg);
                return { ok: false, error: `${msg} ${tracking.error || ''}`.trim() };
            }
            pushLeaseArg = `--force-with-lease=refs/heads/${branch}:${String(tracking.sha || '')}`;
        }
        const pushArgs = ['-C', rootDir, 'push'];
        if (pushLeaseArg) {
            pushArgs.push(pushLeaseArg);
        }
        pushArgs.push(String(remoteUrl || ''), branch || '');
        const pushBacklogForgejo = git.git(pushArgs);
        if (pushBacklogForgejo.status !== 0) {
            const pushError = [pushBacklogForgejo.stderr, pushBacklogForgejo.stdout].filter(Boolean).join('\n');
            if (force && /non-fast-forward|stale info|fetch first/i.test(pushError || '')) {
                const forceArgs = ['-C', rootDir, 'push', '--force', String(remoteUrl || ''), branch || ''];
                const forceResult = git.git(forceArgs);
                if (forceResult.status === 0) {
                    fmt.log.info(`Backlog transition for ${fmt.slug(slug)} required plain force after stale lease.`);
                }
                else {
                    const forceError = (forceResult.stderr || forceResult.stdout || '').trim();
                    const msg = `Failed to push Backlog transition for ${fmt.slug(slug)} to Forgejo.`;
                    error(msg);
                    return { ok: false, error: forceError ? `${msg} ${forceError}` : msg };
                }
                return { ok: true, gatekeeperPushedBack };
            }
            const msg = `Failed to push Backlog transition for ${fmt.slug(slug)} to Forgejo.`;
            error(msg);
            return { ok: false, error: pushError.trim() ? `${msg} ${pushError.trim()}` : msg };
        }
    }
    fmt.log.pass(`Mission ${fmt.slug(slug)} handed off successfully.`);
    return /** @type{{ok: boolean, gatekeeperPushedBack?: boolean}} */ ({ ok: true, gatekeeperPushedBack });
}
/**
 * Validate declared gate commands for file existence and basic syntax before execution.
 * Checks that file paths in commands exist relative to rootDir, and detects obvious syntax errors.
 * Returns { ok, reason, error?, gate? } - ok is false when validation fails with reason 'validation-failed'.
 * @param {string[]} commands - Array of gate command strings
 * @param {string} rootDir - Root directory for file existence checks
 * @returns {{ ok: boolean, reason: string, error?: string, gate?: string }}
 */
function validateDeclaredGates(commands, rootDir) {
    for (const cmd of commands) {
        // A Markdown code span followed by words is documentation, not an exact
        // command. Keep the original declaration intact so the operator can fix
        // the offending MISSION.md line instead of seeing a downstream Bash error.
        const markdownCommandWithSuffix = /^`[^`\r\n]+`\s+\S/.test(cmd);
        // Ignore quoted arguments while looking for outcome-language suffixes.
        // This preserves commands such as `echo "all checks pass"`, pipelines,
        // redirects, and compound commands while rejecting declarations such as
        // `./scripts/verify-local.sh all passes on the final tree`.
        let unquoted = '';
        let proseSingleQuote = false;
        let proseDoubleQuote = false;
        for (let ci = 0; ci < cmd.length; ci++) {
            const ch = cmd[ci];
            if (ch === '\\' && proseDoubleQuote) {
                unquoted += '  ';
                ci++;
                continue;
            }
            if (ch === '\'' && !proseDoubleQuote) {
                proseSingleQuote = !proseSingleQuote;
                unquoted += ' ';
                continue;
            }
            if (ch === '"' && !proseSingleQuote) {
                proseDoubleQuote = !proseDoubleQuote;
                unquoted += ' ';
                continue;
            }
            unquoted += proseSingleQuote || proseDoubleQuote ? ' ' : ch;
        }
        const hasDescriptionSeparator = /\s(?:—|–|-–)\s+\S/.test(unquoted);
        const hasOutcomeSuffix = /\s(?:passes?|passed|succeeds?|succeeded|completes?|completed)(?:\s+(?:on|in|with|without|after|before|for|the|a|an|successfully|cleanly)\b[^;&|]*)?[.!]?\s*$/i.test(unquoted);
        if (markdownCommandWithSuffix || hasDescriptionSeparator || hasOutcomeSuffix) {
            return {
                ok: false,
                reason: 'validation-failed',
                error: `Gate declaration must contain an exact runnable command only. Replace "${cmd}" with the command and move trailing prose or outcome expectations to Success Criteria or checkpoint documentation.`,
                gate: cmd
            };
        }
        // Check for unclosed quotes — respect quote context so apostrophes
        // inside double-quoted strings (and vice-versa) are not flagged.
        // Only flag genuinely unmatched quotes (e.g. echo 'unclosed).
        let inSingleQuote = false;
        let inDoubleQuote = false;
        for (let ci = 0; ci < cmd.length; ci++) {
            const ch = cmd[ci];
            if (ch === '\\' && inDoubleQuote) {
                ci++; // skip escaped character inside double quotes
                continue;
            }
            if (ch === '\'' && !inDoubleQuote) {
                inSingleQuote = !inSingleQuote;
                continue;
            }
            if (ch === '"' && !inSingleQuote) {
                inDoubleQuote = !inDoubleQuote;
                continue;
            }
        }
        if (inSingleQuote || inDoubleQuote) {
            const quoteType = inSingleQuote ? 'single' : 'double';
            return {
                ok: false,
                reason: 'validation-failed',
                error: `Gate command has unclosed ${quoteType} quotes: "${cmd}"`,
                gate: cmd
            };
        }
        // Check for unmatched parentheses
        const openParens = (cmd.match(/\(/g) || []).length;
        const closeParens = (cmd.match(/\)/g) || []).length;
        if (openParens !== closeParens) {
            return {
                ok: false,
                reason: 'validation-failed',
                error: `Gate command has unmatched parentheses: "${cmd}"`,
                gate: cmd
            };
        }
        // Check for unmatched braces
        const openBraces = (cmd.match(/\{/g) || []).length;
        const closeBraces = (cmd.match(/\}/g) || []).length;
        if (openBraces !== closeBraces) {
            return {
                ok: false,
                reason: 'validation-failed',
                error: `Gate command has unmatched braces: "${cmd}"`,
                gate: cmd
            };
        }
        // Check for unmatched brackets
        const openBrackets = (cmd.match(/\[/g) || []).length;
        const closeBrackets = (cmd.match(/\]/g) || []).length;
        if (openBrackets !== closeBrackets) {
            return {
                ok: false,
                reason: 'validation-failed',
                error: `Gate command has unmatched brackets: "${cmd}"`,
                gate: cmd
            };
        }
        // Extract file paths from the command and check their existence.
        // Split on whitespace first, then classify whole tokens — this avoids
        // the regex matching mid-token (e.g. turning "lib/agents/" into "/agents/").
        // Only check tokens that clearly look like file paths:
        //   - start with ./ or ../  (relative paths)
        //   - start with /           (absolute paths)
        //   - contain /              (paths with intermediate segments)
        // This avoids false positives on bare words, flags, URLs, and glob patterns.
        const tokens = cmd.split(/\s+/);
        for (const token of tokens) {
            // Skip if it looks like a URL
            if (/^https?:\/\//i.test(token) || token.includes('://')) {
                continue;
            }
            // Skip flags
            if (token.startsWith('-')) {
                continue;
            }
            // Strip leading/trailing quote characters (', ", `) before checking
            // so that 'lib/agents/' becomes lib/agents/ and `path` becomes path
            let cleaned = token.replace(/^['"`]|['"`]$/g, '');
            // Skip glob patterns (contain *, ?, [, ]) — not literal file paths
            if (/[?*[\]]/.test(cleaned)) {
                continue;
            }
            // Check if token looks like a file path
            const looksLikePath = cleaned.startsWith('./') ||
                cleaned.startsWith('../') ||
                cleaned.startsWith('/') ||
                cleaned.includes('/');
            if (!looksLikePath) {
                continue;
            }
            // Resolve the path relative to rootDir and check existence
            const absolutePath = path.resolve(rootDir, cleaned);
            if (!fs.existsSync(absolutePath)) {
                return {
                    ok: false,
                    reason: 'validation-failed',
                    error: `Gate command references non-existent file: "${token}" in command "${cmd}"`,
                    gate: cmd
                };
            }
        }
    }
    return { ok: true, reason: 'all-gates-valid' };
}
/**
 * Parse and execute declared gates from a mission's MISSION.md `## Gates` section.
 * Each gate line is treated as a shell command to be executed via spawnSync.
 * Returns { ok, skipped, count, reason } on success or { ok: false, gate, error, reason } on failure.
 */
/** @param {string} missionDir @param {string} rootDir @param {{log?: Function, error?: Function}} [options] */
function runDeclaredGates(missionDir, rootDir, options = {}) {
    const { log = fmt.log.plain } = /** @type {{log?: Function, error?: Function}} */ (options);
    const missionPath = path.join(missionDir, 'MISSION.md');
    if (!fs.existsSync(missionPath)) {
        return { ok: true, skipped: true, reason: 'no-mission-file' };
    }
    const content = fs.readFileSync(missionPath, 'utf8');
    // Extract the ## Gates section
    const gatesSectionMatch = content.match(/^## Gates\s*\n([\s\S]*?)(?=\n## |\n$)/m);
    if (!gatesSectionMatch) {
        return { ok: true, skipped: true, reason: 'no-gates-section' };
    }
    const gatesBlock = gatesSectionMatch[1];
    const gateLines = gatesBlock.split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('- [ ]') || line.startsWith('- [x]') || line.startsWith('- '));
    // Strip the checkbox prefix to get the command
    const commands = gateLines.map(line => {
        // Remove "- [ ] ", "- [x] ", or "- " prefix
        let cmd = line.replace(/^- \[[ x]\]\s*/, '').replace(/^- \s*/, '');
        // Reject gate entries that contain an explanatory dash separator
        // (em-dash, en-dash, or hyphen+en-dash followed by prose) before any
        // further processing, so validateDeclaredGates never sees a silently
        // sanitized command.
        if (/\s+(—|–|-–)\s+\S/.test(cmd)) {
            return { _reject: true, cmd };
        }
        // Strip surrounding backticks (e.g., "`npm run typecheck`")
        cmd = cmd.replace(/^`(.+)`$/, '$1').trim();
        return cmd;
    }).filter(cmd => cmd && (!cmd._reject || cmd.cmd.length > 0));
    // Check for any rejected entries (dash-suffix gates)
    const rejected = commands.find(cmd => cmd && cmd._reject);
    if (rejected) {
        return {
            ok: false,
            reason: 'validation-failed',
            error: `Gate declaration must contain an exact runnable command only. Replace "${rejected.cmd}" with the command and move trailing prose or outcome expectations to Success Criteria or checkpoint documentation.`,
            gate: rejected.cmd
        };
    }
    const cleanCommands = commands.map(cmd => cmd.cmd || cmd);
    if (cleanCommands.length === 0) {
        return { ok: true, skipped: true, reason: 'no-gates-declared' };
    }
    // Pre-validate all gate commands before execution
    const validationResult = validateDeclaredGates(cleanCommands, rootDir);
    if (!validationResult.ok) {
        return validationResult;
    }
    // Execute each gate command
    for (const cmd of cleanCommands) {
        const reusableProof = (0, verification_js_1.readReusableVerificationProof)(cmd, rootDir);
        if (reusableProof.ok) {
            log(`  Gate reused proof ${reusableProof.identity}: ${cmd}`);
            continue;
        }
        log(`  Gate: ${cmd}`);
        const result = (0, node_child_process_1.spawnSync)('bash', ['-c', cmd], {
            cwd: rootDir,
            encoding: 'utf8',
            stdio: 'pipe'
        });
        if (result.status !== 0) {
            const stdout = (result.stdout || '').trim();
            const stderr = (result.stderr || '').trim();
            return {
                ok: false,
                gate: cmd,
                reason: 'gate-failed',
                error: stderr || `Gate exited with status ${result.status}`,
                stdout,
                stderr
            };
        }
        const proofResult = (0, verification_js_1.writeReusableVerificationProof)(cmd, rootDir);
        if (proofResult.ok) {
            log(`  Gate executed; stored proof ${proofResult.identity}: ${cmd}`);
        }
        else {
            log(`  Gate executed; proof unavailable (${proofResult.error}): ${cmd}`);
        }
    }
    return { ok: true, skipped: false, count: cleanCommands.length, reason: 'all-gates-passed' };
}
/**
 * Build the content for an auto-generated CP-1.md checkpoint (task-1228).
 *
 * The generated file satisfies the minimum checkpoint integrity requirements
 * enforced in performHandoff: an `# CP-1:` h1 heading, a `## Goal Check`
 * section (matching the regex `^## Goal Check(?: Table)?\s*$`), and a 3-column
 * pipe table with at least one evidence row. It is explicitly marked as
 * auto-generated so a reviewer knows to replace it with real evidence.
 *
 * @param {string} slug - Mission slug, used for human-readable context.
 * @returns {string}
 */
function buildAutoCheckpointContent(slug) {
    return [
        `# CP-1: Auto-generated checkpoint (handoff remediation for ${slug})`,
        '',
        '> **Auto-generated by `node parallix handoff`** because no checkpoint document',
        '> was present in the mission directory at handoff time. This file provides the',
        '> minimum required structure so the handoff can proceed. A reviewer should',
        '> replace it with real implementation evidence.',
        '',
        '## Goal Check',
        '',
        '| Criterion | Evidence | Status |',
        '|-----------|----------|--------|',
        '| Auto-generated checkpoint CP-1.md present | lib/commands/handoff.ts:262 — auto-remediation writes CP-1.md when no checkpoints exist | PASS |',
        '| Mission contract exists for review | lib/commands/handoff.ts:47 — verifyHandoff requires MISSION.md in the mission directory | PASS |',
        '',
        'Next action: Reviewer to replace this placeholder with real implementation evidence before approval.',
        ''
    ].join('\n');
}
/**
  * Write a fallback summary (`## Fallback:` heading) into the backlog task file.
  * This is the in-scope equivalent of backlog.setTaskFinalSummary, implemented
  * inline here since modifying backlog.js is out of scope for this mission.
  * @param {string} slug - Mission slug
  * @param {string} summary - The fallback summary text (must contain ## Fallback)
  * @param {{rootDir?: string, log?: Function}} options
  * @returns {boolean}
  */
function writeFallbackSummary(slug, summary, options = {}) {
    /** @type{{rootDir?: string, log?: Function}} */
    const opts = options;
    const rootDir = opts.rootDir || process.cwd();
    const log = opts.log || fmt.log.plain;
    const resolution = backlog.resolveTaskFile(slug, rootDir);
    if (!resolution.ok) {
        log(fmt.status('WARN', `Could not write fallback summary for ${fmt.slug(slug)}: ${resolution.reason}`));
        return false;
    }
    const taskFile = resolution.taskFile;
    if (!taskFile) {
        log(fmt.status('WARN', `Could not write fallback summary for ${fmt.slug(slug)}: task file not found.`));
        return false;
    }
    /** @type{string} */
    let content = fs.readFileSync(taskFile, 'utf8');
    // Already present — no-op
    if (content.includes('## Fallback:')) {
        return true;
    }
    // Insert after frontmatter block (first occurrence of "---" closing)
    const firstDash = content.indexOf('---');
    if (firstDash === -1) {
        content = summary + '\n\n' + content;
    }
    else {
        // Find the closing --- of frontmatter
        const closingDash = content.indexOf('---', firstDash + 3);
        if (closingDash === -1) {
            content = summary + '\n\n' + content;
        }
        else {
            const insertPos = closingDash + 3;
            content = content.slice(0, insertPos) + '\n\n' + summary + content.slice(insertPos);
        }
    }
    // Write the file
    fs.writeFileSync(taskFile, content, 'utf8');
    // Commit via the git module
    const gitResult = git.git(['add', taskFile]);
    if (gitResult.status !== 0) {
        log(fmt.status('WARN', `Failed to stage fallback summary for ${fmt.slug(slug)}`));
        return false;
    }
    const commitResult = git.git(['commit', '-m', `backlog(${slug}): set fallback summary`]);
    if (commitResult.status !== 0) {
        log(fmt.status('WARN', `Failed to commit fallback summary for ${fmt.slug(slug)}`));
        return false;
    }
    log(fmt.status('PASS', `Set fallback summary on ${fmt.slug(slug)}.`));
    return true;
}
/**
 * Capture NEL (Net Engineering Lines) at handoff time.
 *
 * Computes actual NEL from the merge diff (primary..HEAD), reads the predicted
 * bucket from the mission's Refinement Signals, resolves review rounds from
 * review-state.json, and persists a per-mission NEL record as `nel-record.json`.
 *
 * NEL values remain observational; failure to durably persist a computed value is fatal to handoff.
 *
 * @param {string} slug - Mission slug
 * @param {{ rootDir: string, missionDir: string, log: Function, error: Function, writeJsonFn?: typeof writeJson }} options
 * @returns {{ ok: boolean, nel?: number, bucket?: string, persistenceFailed?: boolean, error?: string }}
 */
function captureNelAtHandoff(slug, options) {
    const { rootDir, missionDir, error, writeJsonFn = storage_js_1.writeJson } = options;
    // 1. Determine primary branch for diff range
    let primaryBranch;
    try {
        primaryBranch = missionUtils.getPrimaryBranch(rootDir);
    }
    catch (_) {
        return { ok: false, error: 'could not detect primary branch for NEL diff range' };
    }
    if (!primaryBranch) {
        return { ok: false, error: 'primary branch is empty' };
    }
    // 2. Compute actual NEL from primary..HEAD
    let nelRecord;
    try {
        nelRecord = nels.computeNELRecord(`${primaryBranch}..HEAD`, { cwd: rootDir });
    }
    catch (_) {
        return { ok: false, error: 'NEL computation failed' };
    }
    const actualNel = nelRecord.nel;
    const actualBucket = nelRecord.bucket.label;
    // 3. Read predicted bucket from MISSION.md Refinement Signals
    const missionMdPath = path.join(missionDir, 'MISSION.md');
    let predictedBucket = 'Unknown';
    if (fs.existsSync(missionMdPath)) {
        const content = fs.readFileSync(missionMdPath, 'utf8');
        const predictedMatch = content.match(/Predicted NEL bucket:\s*(Small|Medium|Large)/i);
        if (predictedMatch) {
            predictedBucket = predictedMatch[1];
        }
    }
    // 4. Read review rounds from review-state.json
    let reviewRounds = 1;
    const reviewStatePath = path.join(missionDir, 'review-state.json');
    if (fs.existsSync(reviewStatePath)) {
        try {
            const rs = JSON.parse(fs.readFileSync(reviewStatePath, 'utf8'));
            reviewRounds = rs.round || 1;
        }
        catch (_) {
            // ignore parse errors
        }
    }
    // 5. Persist NEL record
    const nelRecordPath = path.join(missionDir, 'nel-record.json');
    const record = {
        slug,
        predictedBucket,
        actualNel,
        actualBucket,
        reviewRounds,
        capturedAt: new Date().toISOString(),
    };
    try {
        writeJsonFn(nelRecordPath, record);
    }
    catch (err) {
        error(`Failed to write NEL record: ${err.message}`);
        return { ok: false, persistenceFailed: true, error: `failed to write NEL record: ${err.message}` };
    }
    return { ok: true, nel: actualNel, bucket: actualBucket };
}
/** @param {string[]} args */
async function handoffCommand(args) {
    const explicitSlug = args[0];
    const slug = missionUtils.inferSlug(explicitSlug);
    const skipGate = args.includes('--no-gate');
    const force = args.includes('--force');
    if (!slug) {
        fmt.log.fail('Usage: node parallix handoff [<slug>] [--no-gate] [--force]');
        process.exit(1);
    }
    const result = await _exports.performHandoff(slug, { skipGate, force });
    if (!result.ok) {
        process.exit(1);
    }
}
/** @type {{performHandoff: Function}} */
const _exports = {
    /** @returns {...} */
    get performHandoff() { return _handoffExport.performHandoff; }
};
/** @type {{verifyHandoff: typeof verifyHandoff, performHandoff: typeof performHandoff, gatekeeper: typeof gatekeeper, runDeclaredGates: typeof runDeclaredGates, captureNelAtHandoff: typeof captureNelAtHandoff, validateDeclaredGates: typeof validateDeclaredGates, _buildAutoCheckpointContent: typeof buildAutoCheckpointContent, _findUnverifiableGoalCheckRow: typeof findUnverifiableGoalCheckRow, _collectGoalCheckEvidenceRows: typeof collectGoalCheckEvidenceRows}} */
const _namedExports = {
    verifyHandoff,
    performHandoff,
    gatekeeper,
    runDeclaredGates,
    captureNelAtHandoff,
    validateDeclaredGates,
    // Test seams (task-2215): expose the auto-checkpoint template and the
    // goal-check evidence validator so tests can verify the generated CP-1.md
    // passes the same validation performHandoff applies.
    _buildAutoCheckpointContent: buildAutoCheckpointContent,
    _findUnverifiableGoalCheckRow: findUnverifiableGoalCheckRow,
    _collectGoalCheckEvidenceRows: collectGoalCheckEvidenceRows
};
/** @type {typeof handoffCommand & {verifyHandoff: typeof verifyHandoff, performHandoff: typeof performHandoff, gatekeeper: typeof gatekeeper, runDeclaredGates: typeof runDeclaredGates, captureNelAtHandoff: typeof captureNelAtHandoff, validateDeclaredGates: typeof validateDeclaredGates}} */
const _handoffExport = Object.assign(handoffCommand, _namedExports);
exports.handoff = _handoffExport;
exports.default = _handoffExport;
if (typeof module !== 'undefined') {
    module.exports = _handoffExport;
}
