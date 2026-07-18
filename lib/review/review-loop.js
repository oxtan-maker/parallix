"use strict";
/**
 * Review Loop Module
 * Extracted from parallix/lib/review.js for task-1201
 * Handles autonomous review loop orchestration.
 */
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
exports.rebaseBeforeReviewRound = exports.commitSafeMissionArtifacts = void 0;
exports.recordStageStatsSafe = recordStageStatsSafe;
exports.maybeUpdateGraphifyBeforeReview = maybeUpdateGraphifyBeforeReview;
exports.applyAgentFallback = applyAgentFallback;
exports.persistNormalizedPhaseRepair = persistNormalizedPhaseRepair;
exports.stageLaunchSinceMs = stageLaunchSinceMs;
exports.classifyGateFailure = classifyGateFailure;
exports.runPreReviewGate = runPreReviewGate;
exports.handleGateFailureAutoBounce = handleGateFailureAutoBounce;
exports.startReviewLoop = startReviewLoop;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const fmt = __importStar(require("../core/fmt.js"));
const git_js_1 = require("../core/git.js");
const mission_utils_js_1 = require("../core/mission-utils.js");
const verification_js_1 = require("../core/verification.js");
const backlog_js_1 = require("../tools/backlog.js");
const state_map_js_1 = require("../core/state-map.js");
const review_adapter_js_1 = require("./review-adapter.js");
const runtime_matrix_js_1 = require("../core/runtime-matrix.js");
const review_prompts_js_1 = require("./review-prompts.js");
const review_state_js_1 = require("./review-state.js");
const agents_js_1 = require("../agents/agents.js");
const rebase_js_1 = require("./rebase.js");
Object.defineProperty(exports, "commitSafeMissionArtifacts", { enumerable: true, get: function () { return rebase_js_1.commitSafeMissionArtifacts; } });
Object.defineProperty(exports, "rebaseBeforeReviewRound", { enumerable: true, get: function () { return rebase_js_1.rebaseBeforeReviewRound; } });
const package_root_js_1 = require("../core/package-root.js");
const product_config_js_1 = require("../core/product-config.js");
const review_polling_js_1 = require("./review-polling.js");
const review_artifacts_js_1 = require("./review-artifacts.js");
const stage_telemetry_js_1 = require("../agents/stage-telemetry.js");
/** Lazily loaded stats module — loaded on first use to avoid circular dependency. */
let _stats = null;
function getStats() {
    if (!_stats) {
        _stats = _require('../commands/stats.js');
    }
    return _stats;
}
/** Lazily loaded handoff module. */
let _handoff = null;
function getHandoff() {
    if (!_handoff) {
        _handoff = _require('../commands/handoff.js');
    }
    return _handoff;
}
// Stage telemetry recording is best-effort: a failure must never break the
// review loop. Token columns are populated only for the codex role (the C2 rule
// guarantees at most one of implementer/reviewer is codex); other families
// record honest zeros (task-1251).
//
// Codex writes a fresh-counter rollout per launch, so we sum total_token_usage
// across every rollout since the FIRST launch for this stored mission phase and
// agent family. For non-Codex families we accumulate launcher-attached telemetry
// one launch at a time, de-duped via review-state metadata, so Claude/custom rows
// are cumulative too. A family switch creates a separate row instead of mixing
// agents in one record.
function stageLaunchFingerprint(agentFamily, result) {
    return [
        String(agentFamily || '').trim().toLowerCase(),
        result && result.sessionId ? String(result.sessionId) : '',
        result && result.startedAt ? String(result.startedAt) : '',
        result && result.endedAt ? String(result.endedAt) : '',
        result && result.status !== undefined && result.status !== null ? String(result.status) : '',
    ].join('|');
}
function markStageLaunchRecorded(state, opts) {
    const { stage, agentFamily, result, slug, worktree, writeReviewStateFn = review_state_js_1.writeReviewState } = opts || {};
    if (!state || !agentFamily) {
        return true;
    }
    const key = stageWindowKey(stage, agentFamily);
    const fingerprint = stageLaunchFingerprint(agentFamily, result || null);
    const recordedStageLaunches = state.metadata && typeof state.metadata === 'object'
        ? (state.metadata.recordedStageLaunches || {})
        : {};
    const recorded = Array.isArray(recordedStageLaunches[key]) ? recordedStageLaunches[key] : [];
    if (recorded.includes(fingerprint)) {
        return false;
    }
    if (!state.metadata || typeof state.metadata !== 'object') {
        state.metadata = {};
    }
    state.metadata.recordedStageLaunches = {
        ...(state.metadata.recordedStageLaunches || {}),
        [key]: [...recorded, fingerprint].slice(-20),
    };
    (0, review_state_js_1.persistReviewStateOrThrow)(writeReviewStateFn, slug, state, worktree || process.cwd());
    return true;
}
function recordStageStatsSafe(kind, opts) {
    const { stage, slug, rootDir, worktree, implementer, reviewer, result, sinceMs, log, state, writeReviewStateFn = review_state_js_1.writeReviewState, model = null } = opts;
    let durationMinutes = 0;
    if (result && result.startedAt && result.endedAt) {
        durationMinutes = (Date.parse(result.endedAt) - Date.parse(result.startedAt)) / 60000;
    }
    const telemetry = (0, stage_telemetry_js_1.resolveStageTelemetry)({ worktree: worktree || '', result: result || {}, sinceMs: sinceMs || 0 });
    try {
        const actorFamily = kind === 'review' ? reviewer : implementer;
        if (state && actorFamily && !markStageLaunchRecorded(state, {
            stage,
            agentFamily: actorFamily,
            result,
            slug,
            worktree,
            writeReviewStateFn
        })) {
            return;
        }
        try {
            getStats().accumulateStageStats({ stage, slug, rootDir, implementer, reviewer, telemetry, durationMinutes, model });
        }
        catch { /* best-effort */ }
    }
    catch (err) {
        log?.(fmt.status('WARN', `Could not record ${kind} stats for ${slug}: ${err.message}`));
    }
}
const DEFAULT_MAX_ATTEMPTS = 5;
const CONTINUE_SKIP_CHECK_TIMEOUT_MS = 10_000;
function strictlyLaterIso(earlierIso, nowMs = Date.now()) {
    const earlierMs = Date.parse(earlierIso);
    if (!Number.isFinite(earlierMs)) {
        return new Date(nowMs).toISOString();
    }
    return new Date(Math.max(nowMs, earlierMs + 1)).toISOString();
}
// ============================================================================
// Pre-review Setup Functions
// ============================================================================
const node_module_1 = require("node:module");
const _require = (0, node_module_1.createRequire)(__filename);
function maybeUpdateGraphifyBeforeReview(rootDir, { commandRunner = git_js_1.run, log = fmt.log.plain } = {}) {
    // Lazy require to break circular dependency with core/mission-utils
    const { updateGraphifyKnowledgeGraph } = _require('../core/mission-utils.js');
    return updateGraphifyKnowledgeGraph({
        rootDir,
        commandRunner,
        log,
        startMessage: 'Updating graphify knowledge graph...',
        failureHint: 'Continuing without blocking review start.'
    });
}
// ============================================================================
// Agent Fallback Handling
// ============================================================================
// If startAgent fell back to a different family after a limit hit, the comments
// that gate the loop (review outcome / disposition) will be authored by the
// fallback identity selected by the launcher.
// This helper detects the fallback, persists the new identity to review state
// and the Backlog assignee, and returns the identity that should be polled for.
function applyAgentFallback(opts) {
    const { role, original, launchResult, state, slug, worktree, taskResolution, log = fmt.log.plain, writeReviewStateFn = review_state_js_1.writeReviewState, enforceTaskAssigneeFn } = opts;
    if (!launchResult || !launchResult.agent || launchResult.agent === original) {
        return original;
    }
    const fallback = launchResult.agent;
    log(fmt.status('INFO', `${role} fell back from ${original} to ${fallback}; updating identity before polling.`));
    if (role === 'reviewer') {
        state.reviewer = fallback;
    }
    else {
        state.implementer = fallback;
    }
    (0, review_state_js_1.persistReviewStateOrThrow)(writeReviewStateFn, slug, state, worktree || process.cwd());
    if (role === 'implementer' && taskResolution && taskResolution.ok) {
        if (enforceTaskAssigneeFn && !enforceTaskAssigneeFn(taskResolution.taskFile, fallback)) {
            log(fmt.status('WARN', `Could not enforce fallback implementer ${fallback} in backlog task.`));
        }
    }
    return fallback;
}
function persistNormalizedPhaseRepair(slug, state, worktree, { log = fmt.log.plain, writeReviewStateFn = review_state_js_1.writeReviewState } = {}) {
    if (!state || !state.phaseOriginal || review_state_js_1.VALID_PHASES.includes(state.phaseOriginal)) {
        return;
    }
    log(fmt.status('WARN', `Persisted review phase "${state.phaseOriginal}" is invalid. Repairing to "${state.phase}".`));
    (0, review_state_js_1.persistReviewStateOrThrow)(writeReviewStateFn, slug, state, worktree);
    state.phaseOriginal = null;
}
function stageWindowKey(stage, agentFamily) {
    const normalizedStage = String(stage || 'default').trim().toLowerCase() || 'default';
    const normalizedAgent = String(agentFamily || '').trim().toLowerCase();
    return `${normalizedStage}:${normalizedAgent}`;
}
// Window the Codex telemetry read to the CURRENT launch's start so each round
// contributes only its own rollouts. Earlier rounds' rollouts have an mtime
// strictly before this launch's startedAt and are excluded, so the per-round
// deltas accumulate (via accumulateStageStats) to the family's true total
// instead of re-summing a cumulative-since-first-launch window every round.
// Resume-idempotency is provided separately by the launch fingerprint in
// markStageLaunchRecorded, so the window itself does not need to persist.
function stageLaunchSinceMs(result) {
    const startedAt = result && result.startedAt ? String(result.startedAt) : '';
    const startedMs = startedAt ? Date.parse(startedAt) : NaN;
    return Number.isFinite(startedMs) ? startedMs : 0;
}
// ============================================================================
// Pre-review Gate Enforcement (ADR 0048 Control C1 / TASK-1385)
// ============================================================================
function classifyGateFailure(output) {
    const rep = _require('../commands/repair-handoff.js');
    const { failureClass, dispatchAction } = rep.classifyError(output);
    return {
        classification: failureClass,
        action: dispatchAction,
        isRelaunchable: dispatchAction !== 'HumanOnly',
    };
}
/**
 * Run the verification gate with the mission area before a review round.
 * Captures stdout/stderr for use in auto-bounce fix prompts.
 */
async function runPreReviewGate(slug, worktree, opts = {}) {
    const { resolveEffectiveAreaFn = verification_js_1.resolveEffectiveArea, findMissionAreaFn, runFn: runFnOverride = git_js_1.run, log = fmt.log.plain, error = fmt.log.plainError, } = opts;
    const missionDir = (0, mission_utils_js_1.findMissionDir)(slug, worktree);
    // findMissionAreaFn remains injectable for existing callers/tests. Normal
    // runtime selection is diff-scoped through resolveEffectiveArea.
    const area = findMissionAreaFn && missionDir
        ? findMissionAreaFn(missionDir)
        : resolveEffectiveAreaFn(undefined, worktree, missionDir);
    const command = (0, verification_js_1.formatVerificationCommand)(area, worktree, missionDir);
    if (command === NO_GATE_NOTICE_ALIAS) {
        log(fmt.status('INFO', `No verification gate configured for area ${area}; skipping pre-review gate check.`));
        return { ok: true, area, command, exitCode: 0, stdout: '', stderr: '' };
    }
    log(fmt.status('INFO', `Pre-review gate for area "${area}": ${fmt.command(command)}`));
    // Run with pipe mode to capture output for auto-bounce fix prompts.
    const result = runFnOverride('bash', ['-lc', command], {
        cwd: worktree,
        stdio: 'pipe',
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });
    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    const stderr = typeof result.stderr === 'string' ? result.stderr : '';
    if (result.status !== 0) {
        error(fmt.status('FAIL', `Pre-review gate failed for area "${area}" (exit ${result.status}).`));
        if (stderr) {
            error(`  stderr: ${stderr.split('\n').slice(0, 10).join('\n  ')}`);
        }
        return {
            ok: false,
            area,
            command,
            exitCode: result.status,
            stdout,
            stderr,
            error: `verification gate failed with exit code ${result.status}`,
        };
    }
    log(fmt.status('PASS', `Pre-review gate passed for area "${area}".`));
    return { ok: true, area, command, exitCode: 0, stdout, stderr };
}
const NO_GATE_NOTICE_ALIAS = ': # no verification gate configured (set adapters.verification.command)';
/**
 * Handle a pre-review gate failure by auto-bouncing to the implementer.
 * Does NOT consume a reviewer cycle or transition the task out of review status.
 * Tracks retry count in review state metadata.
 * Returns true if bounced, false if retry limit exceeded (mission strands).
 */
async function handleGateFailureAutoBounce(slug, worktree, gateResult, implementer, opts = {}) {
    const { startAgentFn = agents_js_1.startAgent, writeReviewStateFn = review_state_js_1.writeReviewState, readReviewStateFn = review_state_js_1.readReviewState, transitionTaskFn = backlog_js_1.transitionTask, applyAgentFallbackFn = applyAgentFallback, taskResolution, enforceTaskAssigneeFn, log = fmt.log.plain, error = fmt.log.plainError, sleepFn: _sleepFn = review_polling_js_1.delay, buildCompactActOnReviewPromptFn: _buildCompactActOnReviewPromptFn = review_prompts_js_1.buildCompactActOnReviewPrompt, isForgejoReviewEnabledFn: _isForgejoReviewEnabledFn, isReviewProviderEnabledFn: _isReviewProviderEnabledFn, legacyIsForgejoReviewEnabledFn: _legacyIsForgejoReviewEnabledFn, exit: _exit = process.exit, } = opts;
    const MAX_GATE_RETRY = 2;
    // Read persisted state to get current retry count
    const persisted = readReviewStateFn(slug, worktree);
    const retryCount = persisted && persisted.metadata && typeof persisted.metadata === 'object'
        ? (Number(persisted.metadata.gateFailureRetryCount) || 0)
        : 0;
    if (retryCount >= MAX_GATE_RETRY) {
        error(fmt.status('FAIL', `Pre-review gate failure: max retries exceeded (${MAX_GATE_RETRY}). Mission stranded for ${slug}.`));
        error(fmt.status('FAIL', `Area "${gateResult.area}" verification failed ${retryCount} times. Human intervention required.`));
        error(fmt.status('FAIL', `Gate output:\n${gateResult.stdout || gateResult.stderr || '(no output)'}\n`));
        return { bounced: false, stranded: true };
    }
    // Classify the failure
    const diagnosticOutput = [gateResult.stdout, gateResult.stderr].filter(Boolean).join('\n');
    const diagnosticClassification = classifyGateFailure(diagnosticOutput);
    // A non-zero gate exit is authoritative evidence of a genuine verification
    // failure. Arbitrary test/linter diagnostics have no classifier keyword and
    // default to InfraBlocker, which used to strand a repairable mission. Keep
    // the ADR's genuine human-only exceptions, however: a recognized provider,
    // network, authentication, or state-machine diagnostic must not be hidden
    // by the generic gate-failure marker.
    const hasExplicitHumanOnlyDiagnostic = diagnosticClassification.action === 'HumanOnly'
        && /state\s+violation|invalid\s+state|transition\s+not\s+allowed|cannot\s+(move|transition)\s+(from|to)\s+\w+\s+(to|from)|forgejo|infrastructure|authentication\s+failed|token\s+(expired|invalid|missing)|forbidden|unauthorized\s+(access|request)|rate\s+limit|connection\s+(refused|timed?\s*out)|network\s+error/i.test(diagnosticOutput);
    const combinedOutput = [
        gateResult.error || `verification gate failed with exit code ${gateResult.exitCode}`,
        diagnosticOutput,
    ].filter(Boolean).join('\n');
    const classification = hasExplicitHumanOnlyDiagnostic
        ? diagnosticClassification
        : classifyGateFailure(combinedOutput);
    log(fmt.status('WARN', `Pre-review gate failed for area "${gateResult.area}" (exit ${gateResult.exitCode}). Classification: ${classification.classification}.`));
    // ADR 0048 C6: InfraBlocker and StateMachineViolation are HumanOnly — do not
    // auto-bounce to implementer; surface for human intervention.
    if (!classification.isRelaunchable) {
        error(fmt.status('FAIL', `Pre-review gate failure: ${classification.classification} (${classification.action}). Human intervention required — not auto-bouncing.`));
        error(fmt.status('FAIL', `Gate output:\n${gateResult.stdout || gateResult.stderr || '(no output)'}\n`));
        return { bounced: false, stranded: true };
    }
    // Build fix prompt with captured gate output
    const fixPrompt = [
        `PRE-REVIEW GATE FAILURE — FIX REQUIRED`,
        ``,
        `Mission: ${slug}`,
        `Area: ${gateResult.area}`,
        `Gate command: ${gateResult.command}`,
        `Exit code: ${gateResult.exitCode}`,
        ``,
        `Gate output (use this to diagnose and fix):`,
        `---`,
        gateResult.stdout || '(no stdout)',
        `---`,
        gateResult.stderr || '(no stderr)',
        `---`,
        ``,
        `Classification: ${classification.classification} — ${classification.action}`,
        `Retry attempt: ${retryCount + 1}/${MAX_GATE_RETRY}`,
        ``,
        `Fix the underlying issue so the verification gate passes for area "${gateResult.area}".`,
        `After fixing, restart the review loop; it will re-run the gate before the next review round.`,
    ].join('\n');
    // Increment retry count in metadata
    if (!persisted || !persisted.metadata || typeof persisted.metadata !== 'object') {
        // Create new metadata
    }
    const metadata = persisted && persisted.metadata && typeof persisted.metadata === 'object'
        ? { ...persisted.metadata }
        : {};
    metadata.gateFailureRetryCount = retryCount + 1;
    // Update review state with incremented retry count
    if (persisted) {
        const updatedState = { ...persisted, metadata };
        (0, review_state_js_1.persistReviewStateOrThrow)(writeReviewStateFn, slug, updatedState, worktree);
    }
    else {
        (0, review_state_js_1.persistReviewStateOrThrow)(writeReviewStateFn, slug, { metadata }, worktree);
    }
    // Transition task back to active (implementer phase) without consuming reviewer cycle
    transitionTaskFn(slug, 'active', { rootDir: worktree, log });
    log(fmt.status('INFO', `Auto-bouncing to implementer (${implementer}) with fix prompt. Retry ${retryCount + 1}/${MAX_GATE_RETRY}.`));
    // Launch implementer with the fix prompt
    try {
        const launchResult = await startAgentFn('act-on-review', {
            agent: implementer,
            prompt: (_actualImplementer) => fixPrompt,
            worktree,
            slug,
            role: 'implementer',
            exclude: [],
        });
        // Apply any agent fallback if needed
        implementer = applyAgentFallbackFn({
            role: 'implementer',
            original: implementer,
            launchResult,
            state: persisted || {},
            slug,
            worktree,
            taskResolution,
            log,
            writeReviewStateFn,
            enforceTaskAssigneeFn,
        });
    }
    catch (err) {
        error(fmt.status('FAIL', `Could not relaunch implementer (${implementer}) for gate failure auto-bounce: ${err.message}`));
        return { bounced: false, stranded: true };
    }
    log(fmt.status('INFO', `Implementer (${implementer}) relaunched with gate failure fix prompt.`));
    return { bounced: true, stranded: false };
}
// ============================================================================
// Main Review Loop
// ============================================================================
async function startReviewLoop(slug, opts = {}) {
    let { implementer, reviewer, focus = 'all', maxAttempts = DEFAULT_MAX_ATTEMPTS, dryRun = false, reset = false, continue: continueFlag = false, isContinue = false, verbose = false, pollTimeoutSeconds = null, worktree: callerWorktree, missionPath, runPreReviewGateFn = runPreReviewGate, handleGateFailureAutoBounceFn = handleGateFailureAutoBounce, resetReviewStateFn = review_state_js_1.resetReviewState, maybeUpdateGraphifyBeforeReviewFn = maybeUpdateGraphifyBeforeReview, readReviewStateFn = review_state_js_1.readReviewState, resolveTaskFileFn = backlog_js_1.resolveTaskFile, getTaskImplementerFn = backlog_js_1.getTaskImplementer, getTaskStatusFn = backlog_js_1.getTaskStatus, transitionTaskFn = backlog_js_1.transitionTask, toVirtualFn = state_map_js_1.toVirtual, transitionVirtualFn = state_map_js_1.transitionVirtual, workflowLauncherStatusFn = agents_js_1.workflowLauncherStatus, buildAutonomousReviewMatrixFn = runtime_matrix_js_1.buildAutonomousReviewMatrix, formatMatrixSummaryFn = runtime_matrix_js_1.formatMatrixSummary, selectAgentFn = agents_js_1.selectAgent, providerAvailableFn = undefined, runFn = git_js_1.run, getPrStatusFn = review_adapter_js_1.getPrStatus, enforceTaskAssigneeFn = backlog_js_1.enforceTaskAssignee, resolveReviewUserFn = undefined, forgejoAvailableFn = null, resolveForgejoUserFn = null, readTokenFn = review_adapter_js_1.readToken, getCommentsFn = review_adapter_js_1.getComments, postCommentFn = review_adapter_js_1.postComment, postReviewFn = review_adapter_js_1.postReview, writeReviewStateFn = review_state_js_1.writeReviewState, startAgentFn = agents_js_1.startAgent, pollForReviewFn = review_polling_js_1.pollForReview, pollForDispositionFn = review_polling_js_1.pollForDisposition, applyAgentFallbackFn = applyAgentFallback, buildReviewPromptFn = review_prompts_js_1.buildReviewPrompt, buildActOnReviewPromptFn = review_prompts_js_1.buildActOnReviewPrompt, buildCompactReviewPromptFn = review_prompts_js_1.buildCompactReviewPrompt, buildCompactActOnReviewPromptFn = review_prompts_js_1.buildCompactActOnReviewPrompt, consumeReviewerArtifactsFn = review_artifacts_js_1.consumeReviewerArtifacts, consumeImplementerArtifactsFn = review_artifacts_js_1.consumeImplementerArtifacts, rebaseBeforeReviewRoundFn = rebase_js_1.rebaseBeforeReviewRound, eligibleAgentsForStepFn = agents_js_1.eligibleAgentsForStep, log = fmt.log.plain, error = fmt.log.plainError, getLatestReviewForPrFn = review_adapter_js_1.getLatestReviewForPr, getLatestDispositionForPrFn = review_adapter_js_1.getLatestDispositionForPr, sleepFn = review_polling_js_1.delay, exit = process.exit, gitFn = git_js_1.git, isReviewProviderEnabledFn = undefined, legacyIsForgejoReviewEnabledFn = null, isForgejoReviewEnabledFn = null, recordStageStatsSafeFn = () => { } } = opts;
    const performHandoffFn = opts.performHandoffFn || (await getHandoff()).performHandoff;
    let prNumber = null;
    isContinue = Boolean(isContinue || continueFlag);
    const pollIntervalMs = (0, review_polling_js_1.resolvePollIntervalMs)();
    const pollTimeoutMs = (0, review_polling_js_1.resolvePollTimeoutMs)(pollTimeoutSeconds || 0);
    const worktree = callerWorktree || (0, mission_utils_js_1.resolveWorktree)(slug) || process.cwd();
    const resolvedProviderAvailableFn = providerAvailableFn || forgejoAvailableFn || review_adapter_js_1.providerAvailable;
    const resolvedReviewUserFn = resolveReviewUserFn || resolveForgejoUserFn || review_adapter_js_1.resolveReviewUser;
    const branch = (0, mission_utils_js_1.missionBranchName)(slug, worktree);
    // Resolve the artifact directory once so reviewer/implementer artifact reads
    // and writes use the adapter-configured location instead of os.tmpdir().
    const artifactDir = (0, review_artifacts_js_1.resolveArtifactDir)(worktree);
    // `--mission <path>` override (task-1272 SC7): when the caller points the
    // review loop at a mission contract in a non-standard location, resolve the
    // mission directory via the override and thread the contract file path into
    // the reviewer/implementer prompts so launched agents read it (not the
    // slug-derived default). Absent the flag, `effectiveMissionPath` stays
    // undefined and the prompts fall back to the standard slug-derived path.
    const missionDir = (0, mission_utils_js_1.findMissionDir)(slug, worktree, { missionPath });
    let effectiveMissionPath = null;
    if (missionPath && fs.existsSync(missionPath)) {
        effectiveMissionPath = fs.statSync(missionPath).isDirectory()
            ? path.join(missionPath, 'MISSION.md')
            : missionPath;
        log(fmt.status('INFO', `Using mission contract from --mission override: ${effectiveMissionPath}`));
    }
    else if (missionPath) {
        log(fmt.status('WARN', `--mission path not found: ${missionPath}; falling back to slug-derived mission location${missionDir ? ` (${missionDir})` : ''}.`));
    }
    const taskResolution = resolveTaskFileFn(slug, worktree);
    if (!dryRun) {
        await maybeUpdateGraphifyBeforeReviewFn(worktree, { commandRunner: runFn, log });
    }
    // --reset: clear persisted state before starting
    if (reset) {
        const resetResult = resetReviewStateFn(slug, worktree);
        (0, review_state_js_1.assertReviewStatePersisted)(resetResult, { slug, phase: 'reset', round: null });
        if (resetResult.outcome === 'committed') {
            log(fmt.status('INFO', `Review state reset for ${slug}.`));
        }
    }
    const agents = eligibleAgentsForStepFn('review');
    const persisted = readReviewStateFn(slug, worktree);
    if (!implementer) {
        // Try to resume from persisted state
        if (persisted) {
            implementer = persisted.implementer;
            log(fmt.status('INFO', `Resuming persisted implementer: ${implementer}`));
        }
        else {
            // Try to resolve from backlog task
            if (taskResolution.ok) {
                implementer = (getTaskImplementerFn(taskResolution.taskFile) || undefined);
                if (implementer) {
                    log(fmt.status('INFO', `Auto-derived implementer from backlog task: ${implementer}`));
                }
            }
        }
    }
    if (!implementer) {
        implementer = 'autonomous';
        log(fmt.status('WARN', `No implementer identity resolved for ${slug}; defaulting to "autonomous"`));
    }
    if (!taskResolution.ok) {
        (0, backlog_js_1.reportTaskResolution)(taskResolution, slug, error);
        exit(1);
        return;
    }
    // Validate remote review state only when a review provider is enabled.
    const forgejoEnabledFn = isReviewProviderEnabledFn
        || legacyIsForgejoReviewEnabledFn
        || isForgejoReviewEnabledFn
        || review_adapter_js_1.isProviderEnabled;
    const forgejoEnabled = forgejoEnabledFn(worktree);
    if (!dryRun && forgejoEnabled) {
        const forgejoUrl = process.env.FORGEJO_URL || 'http://localhost:3300';
        const bootstrapScript = path.join((0, package_root_js_1.packageRoot)(__dirname), 'scripts', 'bootstrap.sh');
        log(fmt.status('INFO', `Checking review-provider availability at ${forgejoUrl}...`));
        if (!await resolvedProviderAvailableFn(forgejoUrl)) {
            error(fmt.status('FAIL', `Review provider not reachable at ${forgejoUrl}`));
            error('       Attempting to bootstrap provider containers...');
            const bootstrapResult = runFn('bash', [bootstrapScript], { stdio: 'inherit' });
            if (bootstrapResult.status === 0) {
                log(fmt.status('INFO', 'Bootstrap succeeded. Continuing with review loop.'));
            }
            else {
                error(fmt.status('FAIL', 'Bootstrap failed. Please run \'scripts/bootstrap.sh\' manually and retry.'));
                exit(1);
                return;
            }
        }
        else {
            log(fmt.status('INFO', `Review provider is running and reachable at ${forgejoUrl}.`));
        }
        const pr = getPrStatusFn(branch, worktree);
        if (!pr.exists || pr.state !== 'open') {
            // Check task status to detect pre-review (implementation) phase
            const taskStatus = taskResolution.ok ? getTaskStatusFn(taskResolution.taskFile) : null;
            const virtualStatus = taskStatus ? toVirtualFn(taskStatus) : null;
            // Implementation phase states: 'active' or any virtual state mapping to it
            const isImplementationPhase = taskStatus === 'active' || virtualStatus === 'active';
            if (isImplementationPhase) {
                // Task is still in implementation phase - provide guidance, don't hard-fail
                log(fmt.status('INFO', `PR not found for ${branch}. Task is in ${taskStatus} — create the PR first: px review ${slug} --push`));
                return;
            }
            // Task is in a post-implementation state (review/approved/ready-for-integration)
            // or the status is ambiguous, yet no open PR exists. Rather than dead-ending
            // with manual guidance, self-heal: run the canonical handoff (push branch +
            // create PR, reliable since task-1317), re-check, and continue the loop once a
            // PR exists. Only fall back to guidance when self-heal cannot yield an open PR.
            // Emits `--push` (the command self-heal attempts and the correct manual
            // equivalent) — never the old, frequently-wrong `--submit`.
            const fallbackGuidance = (reason) => {
                error(fmt.status('FAIL', `No open review PR found for ${branch}. Create the PR before starting the review loop.`));
                if (reason) {
                    error(`       Handoff failure: ${reason}`);
                }
                error(`       Run: px review ${slug} --push`);
            };
            if (dryRun) {
                // Dry-run never self-heals (no agents/side effects); emit guidance and exit.
                fallbackGuidance(null);
                exit(1);
                return;
            }
            log(fmt.status('INFO', `No open review PR for ${branch} (task in ${taskStatus}) — attempting automatic handoff (px review ${slug} --push)...`));
            const handoff = await performHandoffFn(slug, { forgejoUser: implementer, worktree });
            if (handoff && handoff.gatekeeperPushedBack) {
                // Mandatory artifacts are missing: don't spin the loop. The gatekeeper
                // kept the task in its current state; surface that and stop.
                error(fmt.status('FAIL', `Handoff blocked for ${branch}: mandatory mission artifacts are missing. Task stays in ${taskStatus}; supply the required artifacts and retry.`));
                exit(1);
                return;
            }
            if (!handoff || !handoff.ok) {
                // Auto-bounce for declared-gate validation failures: transition back to
                // active and relaunch the implementer with a fix prompt, so the mission
                // is not stranded waiting for manual intervention.
                const handoffObj = handoff || {};
                if (handoffObj.reason === 'validation-failed') {
                    transitionTaskFn(slug, 'active', { rootDir: worktree, log });
                    log(fmt.status('INFO', `Auto-bounced ${slug} to active: declared-gate validation failure. Fix the gate in MISSION.md and retry.`));
                    // Persist rejection reason for follow-up action
                    const persisted = readReviewStateFn(slug, worktree);
                    const metadata = persisted && persisted.metadata && typeof persisted.metadata === 'object'
                        ? { ...persisted.metadata }
                        : {};
                    metadata.gateFailureReason = 'validation-failed';
                    metadata.gateFailureError = handoffObj.error;
                    (0, review_state_js_1.persistReviewStateOrThrow)(writeReviewStateFn, slug, { ...(persisted || {}), metadata }, worktree);
                    exit(1);
                    return;
                }
                fallbackGuidance(handoff && handoff.error ? String(handoff.error) : null);
                exit(1);
                return;
            }
            // Handoff succeeded — re-check whether an open PR now exists.
            const healedPr = getPrStatusFn(branch, worktree);
            if (!healedPr.exists || healedPr.state !== 'open') {
                fallbackGuidance(null);
                exit(1);
                return;
            }
            log(fmt.status('INFO', `Self-heal succeeded: review PR #${healedPr.number} confirmed open for ${branch}. Continuing review loop.`));
            prNumber = healedPr.number;
            // Fall through into the normal loop with the recovered PR number.
        }
        else {
            log(fmt.status('INFO', `Review PR #${pr.number} confirmed open for ${branch}.`));
            prNumber = pr.number;
        }
    }
    else if (!dryRun && !forgejoEnabled) {
        log(fmt.status('INFO', 'Forgejo validation skipped (review provider is not forgejo). Using workflow-owned review surfaces.'));
    }
    // Note: The implementer may not be in the agents list (eligible for review step)
    // if its launcher is unavailable. This is OK - we'll use fallback logic for the reviewer.
    // The strict implementer eligibility check was removed to allow fallback reviewer selection (SC 4).
    // Resolve reviewer after the no-PR/self-heal gate so implementation-phase
    // guidance does not depend on workstation launcher availability.
    let reviewerSource = 'explicit';
    const persistedContinueReviewer = isContinue && persisted && persisted.reviewer
        ? persisted.reviewer
        : null;
    let selectErr = null;
    if (!reviewer) {
        if (persisted && persisted.reviewer) {
            reviewer = persisted.reviewer;
            reviewerSource = 'persisted';
            log(fmt.status('INFO', `Resuming persisted reviewer: ${reviewer} (round ${persisted.round})`));
        }
        else {
            try {
                reviewer = selectAgentFn('review', { exclude: new Set([implementer]) });
            }
            catch (err) {
                selectErr = err;
                reviewer = undefined;
            }
            reviewerSource = 'auto-derived';
        }
    }
    if (!reviewer) {
        const anyDifferentFamilyRunnable = agents.some((a) => a !== implementer && workflowLauncherStatusFn(a).supported);
        const implementerRunnable = agents.includes(implementer) && workflowLauncherStatusFn(implementer).supported;
        if (!anyDifferentFamilyRunnable && implementerRunnable) {
            log(fmt.status('WARN', `No supported different-family reviewer found for implementer "${implementer}".`));
            log(fmt.status('WARN', `Single-family fallback: reviewer="${implementer}" (same as implementer) — no different-family agent is runnable or unblocked on this workstation.`));
            reviewer = implementer;
            reviewerSource = 'single-family-fallback';
        }
        else if (!anyDifferentFamilyRunnable) {
            if (!forgejoEnabled) {
                const detail = selectErr ? `: ${selectErr.message}` : '';
                reviewer = 'autonomous';
                reviewerSource = 'fallback';
                log(fmt.status('WARN', `No reviewer could be auto-derived${detail}; defaulting to "autonomous"`));
                // Provider=none mode can complete the loop with workflow-owned artifacts only.
                // Do not hard-fail just because no local reviewer launcher is runnable.
                log(fmt.status('INFO', 'Review provider disabled and no runnable reviewer route available; using autonomous workflow-owned review surfaces.'));
            }
            else {
                const reason = selectErr ? `: ${selectErr.message}` : '';
                error(fmt.status('FAIL', `No reviewer could be auto-derived${reason}.`));
                error('\n' + fmt.status('INFO', 'Full runtime matrix:'));
                formatMatrixSummaryFn(buildAutonomousReviewMatrixFn()).forEach((line) => error(`  ${line}`));
                error('\n' + fmt.status('FAIL', `No runnable reviewer route for implementer "${implementer}".`));
                exit(1);
                return;
            }
        }
        else {
            const detail = selectErr ? `: ${selectErr.message}` : '';
            reviewer = 'autonomous';
            reviewerSource = 'fallback';
            log(fmt.status('WARN', `No reviewer could be auto-derived${detail}; defaulting to "autonomous"`));
        }
    }
    const willLaunchRounds = maxAttempts >= ((persisted && persisted.round) || 1);
    const resumesInFixingPhase = persisted && persisted.phase === 'fixing' && !dryRun;
    const maybeFallbackToPersistedContinueReviewer = () => {
        if (!persistedContinueReviewer || reviewer === persistedContinueReviewer) {
            return false;
        }
        log(fmt.status('WARN', `Unsupported explicit reviewer "${reviewer}" while resuming ${slug}; falling back to persisted reviewer "${persistedContinueReviewer}" for the in-flight round.`));
        reviewer = persistedContinueReviewer;
        reviewerSource = 'persisted-continue-fallback';
        return true;
    };
    // Dry-run validates the reviewer identity but only explicit reviewers bypass
    // launcher support checks; auto-derived/persisted reviewers still exercise
    // fallback routing so dry-run logs reflect the real selection path.
    if (reviewerSource === 'fallback') {
        log(fmt.status('INFO', `Reviewer identity defaulted to autonomous; skipping launcher availability check.`));
    }
    else if (resumesInFixingPhase) {
        log(fmt.status('INFO', `Resuming in fixing phase with reviewer "${reviewer}"; skipping launcher availability check until a new review launch is needed.`));
    }
    else if (dryRun && reviewerSource === 'explicit') {
        const reviewerStatus = workflowLauncherStatusFn(reviewer);
        const hasInjectedLauncherStatus = workflowLauncherStatusFn !== agents_js_1.workflowLauncherStatus;
        if (!agents.includes(reviewer) || (hasInjectedLauncherStatus && !reviewerStatus.supported)) {
            if (maybeFallbackToPersistedContinueReviewer()) {
                log(fmt.status('INFO', `Resuming persisted reviewer "${reviewer}" for continue-mode validation.`));
            }
            else {
                const reason = !agents.includes(reviewer) ? 'blocked or unsupported' : 'launcher is not available';
                error(fmt.status('FAIL', `Unsupported reviewer: "${reviewer}" (${reason}).`));
                if (reason === 'launcher is not available' && reviewerStatus.detail) {
                    error(`       Looked for: ${reviewerStatus.detail}`);
                }
                error('\n' + fmt.status('INFO', 'Full runtime matrix:'));
                formatMatrixSummaryFn(buildAutonomousReviewMatrixFn()).forEach((line) => error(`  ${line}`));
                error('\n' + fmt.status('FAIL', `No runnable reviewer route for implementer "${implementer}".`));
                exit(1);
                return;
            }
        }
    }
    else if (!willLaunchRounds) {
        if (!agents.includes(reviewer)) {
            if (maybeFallbackToPersistedContinueReviewer()) {
                log(fmt.status('INFO', `Resuming persisted reviewer "${reviewer}" for continue-mode validation.`));
            }
            else {
                error(fmt.status('FAIL', `Unsupported reviewer: "${reviewer}" (blocked or unsupported).`));
                error('\n' + fmt.status('INFO', 'Full runtime matrix:'));
                formatMatrixSummaryFn(buildAutonomousReviewMatrixFn()).forEach((line) => error(`  ${line}`));
                error('\n' + fmt.status('FAIL', `No runnable reviewer route for implementer "${implementer}".`));
                exit(1);
                return;
            }
        }
    }
    else {
        let reviewerStatus = workflowLauncherStatusFn(reviewer);
        const triedReviewers = new Set();
        while (!agents.includes(reviewer) || !reviewerStatus.supported) {
            triedReviewers.add(reviewer);
            if (reviewerSource === 'explicit') {
                if (maybeFallbackToPersistedContinueReviewer()) {
                    reviewerStatus = workflowLauncherStatusFn(reviewer);
                    continue;
                }
                const reason = !agents.includes(reviewer) ? 'blocked or unsupported' : 'launcher is not available';
                error(fmt.status('FAIL', `Unsupported reviewer: "${reviewer}" (${reason}).`));
                if (reviewerStatus.detail) {
                    error(`       Looked for: ${reviewerStatus.detail}`);
                }
                error('\n' + fmt.status('INFO', 'Full runtime matrix:'));
                formatMatrixSummaryFn(buildAutonomousReviewMatrixFn()).forEach((line) => error(`  ${line}`));
                error('\n' + fmt.status('FAIL', `No runnable reviewer route for implementer "${implementer}".`));
                exit(1);
                return;
            }
            const excludeSet = new Set([...triedReviewers, implementer]);
            let fallback;
            let fallbackStatus;
            try {
                fallback = selectAgentFn('review', { exclude: excludeSet });
                if (excludeSet.has(fallback)) {
                    fallback = undefined;
                    fallbackStatus = null;
                }
                else {
                    fallbackStatus = workflowLauncherStatusFn(fallback);
                }
            }
            catch {
                fallback = undefined;
                fallbackStatus = null;
            }
            if (!fallback) {
                const anyDifferentFamilyRunnable = agents.some((a) => a !== implementer && workflowLauncherStatusFn(a).supported);
                const implementerRunnable = agents.includes(implementer) && workflowLauncherStatusFn(implementer).supported;
                if (!anyDifferentFamilyRunnable && implementerRunnable) {
                    log(fmt.status('WARN', `No supported different-family reviewer found for implementer "${implementer}".`));
                    log(fmt.status('WARN', `Single-family fallback: reviewer="${implementer}" (same as implementer) — no different-family agent is runnable or unblocked on this workstation.`));
                    reviewer = implementer;
                    reviewerSource = 'single-family-fallback';
                    break;
                }
                if (dryRun && implementer === 'autonomous') {
                    reviewer = 'autonomous';
                    reviewerSource = 'fallback';
                    log(fmt.status('WARN', `No runnable reviewer launcher available in dry-run; defaulting reviewer identity to "autonomous".`));
                    break;
                }
                const reason = !agents.includes(reviewer) ? 'blocked or unsupported' : 'launcher is not available';
                error(fmt.status('FAIL', `Unsupported reviewer: "${reviewer}" (${reason}) and no unblocked different-family fallback is available.`));
                if (reviewerStatus.detail) {
                    error(`       Looked for: ${reviewerStatus.detail}`);
                }
                error('\n' + fmt.status('INFO', 'Full runtime matrix:'));
                formatMatrixSummaryFn(buildAutonomousReviewMatrixFn()).forEach((line) => error(`  ${line}`));
                error('\n' + fmt.status('FAIL', `No runnable reviewer route for implementer "${implementer}".`));
                exit(1);
                return;
            }
            const reason = !agents.includes(reviewer) ? 'blocked or unsupported' : 'launcher is not available';
            log(fmt.status('WARN', `Unsupported reviewer: "${reviewer}" (${reason}); trying fallback "${fallback}".`));
            reviewer = fallback;
            reviewerStatus = fallbackStatus;
            reviewerSource = reviewerSource === 'persisted' ? 'persisted-fallback' : 'auto-derived-fallback';
        }
    }
    log(fmt.status('INFO', `Selected reviewer: ${reviewer} (${reviewerSource})`));
    // Build the canonical ReviewState instance. When persisted state exists we
    // resume from it — preserving round, startedAt, phase, disposition, retry
    // counts, and metadata — and only overwrite the identities with the ones
    // selected for this launch (which may differ after a reviewer/implementer
    // fallback). Constructing fresh would silently reset all persisted progress.
    let state;
    if (persisted) {
        state = review_state_js_1.ReviewState.from(slug, persisted);
        state.reviewer = reviewer;
        state.implementer = implementer;
    }
    else {
        state = new review_state_js_1.ReviewState(slug, { reviewer, implementer });
    }
    persistNormalizedPhaseRepair(slug, state, worktree, { log, writeReviewStateFn });
    if (persisted && state.round > 1 && !dryRun) {
        log(fmt.status('INFO', `Resuming review loop from round ${state.round} (${state.phase}).`));
    }
    log(fmt.status('INFO', `Starting autonomous review loop for mission: ${slug}`));
    log(fmt.status('INFO', `Branch: ${branch}`));
    log(fmt.status('INFO', `Implementer: ${implementer} | Reviewer: ${reviewer} (${reviewerSource})`));
    log(fmt.status('INFO', `Focus: ${focus} | Max attempts: ${maxAttempts}`));
    log(fmt.status('INFO', `Poll interval: ${Math.round(pollIntervalMs / 1000)}s | Poll timeout: ${Math.round(pollTimeoutMs / 1000)}s${verbose ? ' | Verbose: on' : ''}`));
    if (dryRun) {
        log(fmt.status('DRY-RUN', 'No agents will be launched.'));
    }
    // Only resolve a provider identity and read a token when a provider is enabled.
    const pollingUser = forgejoEnabled ? resolvedReviewUserFn() : null;
    const token = dryRun || !forgejoEnabled ? null : readTokenFn(pollingUser, { rootDir: worktree });
    const initialRound = state.round;
    for (let attempt = initialRound; attempt <= maxAttempts; attempt++) {
        log('\n' + fmt.status('INFO', `========== Round ${attempt} / ${maxAttempts} ==========`));
        // On rounds after the first, advance the state machine
        if (attempt > state.round) {
            state.advanceRound();
        }
        // Snapshot the primary branch's HEAD commit for this round. This is a
        // fallback value only, used for paths that don't rebase this round (a
        // dry run, or resuming with an existing reviewState): once
        // rebaseBeforeReviewRoundFn runs below, HEAD is rebased onto primary's
        // *current* tip, so the baseline is re-captured immediately after the
        // rebase completes (see below). Capturing it here, before the rebase,
        // would pin the diff to a stale pre-rebase SHA; since rebase replays
        // primary's newer commits into HEAD's ancestry, diffing against that
        // stale SHA would surface exactly the "not rebased to main" noise this
        // baseline exists to suppress (task-1407).
        // Falls back to undefined (letting the prompt builders resolve the live
        // primary branch ref themselves) if the primary branch cannot be detected,
        // e.g. in a repo with no main/master branch yet.
        const captureReviewBaseline = () => {
            try {
                const primaryBranchName = (0, mission_utils_js_1.getPrimaryBranch)(worktree, gitFn);
                const reviewBaselineResult = gitFn(['-C', worktree, 'rev-parse', primaryBranchName]);
                return (reviewBaselineResult.stdout || '').trim() || primaryBranchName;
            }
            catch {
                return undefined;
            }
        };
        let reviewBaseline = captureReviewBaseline();
        let reviewState;
        if (state.phase === 'reviewing') {
            // Check if we can skip reviewer launch
            if (isContinue && attempt === initialRound) {
                if (!dryRun) {
                    transitionTaskFn(slug, 'review', { rootDir: worktree, log });
                }
                if (forgejoEnabled) {
                    log(fmt.status('INFO', `Round ${attempt}: checking for existing review by ${reviewer} since ${state.startedAt}...`));
                    reviewState = await pollForReviewFn(prNumber, reviewer, state.startedAt, token, {
                        getLatestReviewForPrFn, sleepFn, intervalMs: 1000, timeoutMs: 2000, retryCount: state.reviewerRetryCount, verbose, label: `round ${attempt} skip-check`, log
                    });
                    // Skip-check timeout means no existing review - treat as null to proceed with initial launch
                    if ((0, review_polling_js_1.isPollTimeout)(reviewState)) {
                        reviewState = null;
                    }
                }
                else {
                    // When the provider is disabled, use local review state instead of polling.
                    log(fmt.status('INFO', `Round ${attempt}: review provider disabled; using workflow-owned review state.`));
                    reviewState = null;
                }
            }
            // Handle reviewState: could be a valid state, null (no existing review or hard failure), or undefined (first time)
            if (dryRun) {
                if (!reviewState) {
                    if (reviewer === 'autonomous') {
                        log(fmt.status('INFO', `Round ${attempt}: reviewer identity is autonomous; skipping dry-run reviewer prompt and using local review artifacts only.`));
                    }
                    else {
                        log(`\n--- DRY-RUN: reviewer (${reviewer}) prompt ---`);
                        log(buildReviewPromptFn({ reviewer: reviewer, branch, implementer: implementer, focus, attempt, repoRoot: worktree, missionPath: effectiveMissionPath || undefined, actualReviewer: reviewer, reviewBaseline }));
                    }
                }
            }
            else {
                if (!reviewState) {
                    // First launch or hard failure (null)
                    const rebaseResult = await rebaseBeforeReviewRoundFn(slug, {
                        worktree, runFn: runFn, log, error,
                        taskFile: taskResolution.taskFile,
                        gitFn,
                        isReviewProviderEnabledFn: forgejoEnabledFn
                    });
                    if (!rebaseResult.ok) {
                        exit(1);
                        return;
                    }
                    // Re-capture after rebase: HEAD is now rebased onto primary's tip,
                    // so the pre-rebase snapshot above is stale and must be replaced
                    // with the SHA that HEAD was actually rebased onto (task-1407).
                    reviewBaseline = captureReviewBaseline();
                    if (!dryRun) {
                        transitionTaskFn(slug, 'review', { rootDir: worktree, log });
                    }
                    state.phase = 'reviewing';
                    (0, review_state_js_1.persistReviewStateOrThrow)(writeReviewStateFn, slug, state, worktree);
                }
                // Pre-review gate enforcement: run before every review round.
                // A failed gate auto-bounces before a reviewer cycle is consumed.
                if (!dryRun) {
                    const preReviewGateResult = await runPreReviewGateFn(slug, worktree, {
                        runFn: runFn,
                        log,
                        error,
                    });
                    if (!preReviewGateResult.ok) {
                        log(fmt.status('WARN', `Pre-review gate failed for area "${preReviewGateResult.area}" (exit ${preReviewGateResult.exitCode}). Auto-bouncing to implementer.`));
                        const bounceResult = await handleGateFailureAutoBounceFn(slug, worktree, preReviewGateResult, implementer, {
                            startAgentFn: startAgentFn,
                            writeReviewStateFn: writeReviewStateFn,
                            readReviewStateFn: readReviewStateFn,
                            transitionTaskFn: transitionTaskFn,
                            applyAgentFallbackFn: applyAgentFallbackFn,
                            taskResolution,
                            enforceTaskAssigneeFn,
                            log,
                            error,
                            sleepFn,
                            buildCompactActOnReviewPromptFn,
                            isForgejoReviewEnabledFn,
                            isReviewProviderEnabledFn,
                            legacyIsForgejoReviewEnabledFn,
                            exit,
                        });
                        if (bounceResult.stranded) {
                            error(fmt.status('FAIL', `Pre-review gate failure stranded mission ${slug}. Exiting review loop.`));
                            exit(1);
                            return;
                        }
                        if (bounceResult.bounced) {
                            log(fmt.status('INFO', `Autonomous review stopped: gate failure auto-bounced to implementer. Hand off to human review.`));
                            return;
                        }
                    }
                    else {
                        log(fmt.status('PASS', `Pre-review gate passed for area "${preReviewGateResult.area}".`));
                    }
                }
                if (!reviewState) {
                    if (reviewer === 'autonomous' && !forgejoEnabled) {
                        log(fmt.status('INFO', `Round ${attempt}: reviewer identity is autonomous; skipping reviewer launch and using local review artifacts only.`));
                    }
                    else {
                        log(fmt.status('INFO', `Round ${attempt}: launching reviewer (${reviewer})...`));
                        let reviewerLaunchResult;
                        try {
                            reviewerLaunchResult = await startAgentFn('review', {
                                agent: reviewer,
                                prompt: (actualReviewer) => buildCompactReviewPromptFn({ reviewer: reviewer, branch, implementer: implementer, focus, attempt, repoRoot: worktree, missionPath: effectiveMissionPath || undefined, actualReviewer, reviewBaseline }),
                                worktree, slug, role: 'reviewer', exclude: [implementer]
                            });
                        }
                        catch (err) {
                            error(fmt.status('FAIL', `Could not launch reviewer agent (${reviewer}): ${err.message}`));
                            exit(1);
                            return;
                        }
                        reviewer = applyAgentFallbackFn({
                            role: 'reviewer', original: reviewer, launchResult: reviewerLaunchResult,
                            state: state, slug, worktree, taskResolution, log, writeReviewStateFn, enforceTaskAssigneeFn
                        });
                        // Record review-stage telemetry immediately after the reviewer runs,
                        // so the worktree's newest codex rollout is this reviewer's session.
                        // The window is bounded to this round's launch so each round adds
                        // only its own usage; accumulateStageStats sums the rounds into one
                        // cumulative row per reviewer family.
                        const reviewSinceMs = stageLaunchSinceMs(reviewerLaunchResult?.result);
                        recordStageStatsSafeFn('review', {
                            stage: 'review', slug, rootDir: worktree, worktree, reviewer, implementer,
                            result: reviewerLaunchResult?.result,
                            sinceMs: reviewSinceMs || 0, log, error, state, writeReviewStateFn,
                            model: (0, product_config_js_1.resolveAgentModel)(reviewer, worktree),
                        });
                    }
                    const reviewerArtifacts = await consumeReviewerArtifactsFn(slug, reviewer, {
                        worktree,
                        tmpDir: artifactDir,
                        fallbackToTmp: true,
                        readTokenFn,
                        getCommentsFn: getCommentsFn,
                        postCommentFn,
                        postReviewFn,
                        buildMetadataFooterFn: review_artifacts_js_1.buildMetadataFooter,
                        forgejoEnabled,
                        log,
                        error
                    });
                    if (reviewerArtifacts.consumed) {
                        if (!reviewerArtifacts.ok) {
                            log(fmt.status('WARN', `Reviewer ${reviewer} produced incomplete or invalid review artifacts; retrying the reviewer.`));
                            reviewState = review_polling_js_1.POLL_TIMEOUT;
                        }
                        else {
                            reviewState = reviewerArtifacts.reviewState;
                        }
                    }
                    if (!reviewState && forgejoEnabled) {
                        reviewState = await pollForReviewFn(prNumber, reviewer, state.startedAt, token, {
                            getLatestReviewForPrFn, sleepFn, intervalMs: pollIntervalMs, timeoutMs: pollTimeoutMs, retryCount: 0, verbose, label: `round ${attempt} review`, log
                        });
                    }
                }
                if ((0, review_polling_js_1.isPollTimeout)(reviewState) || !reviewState) {
                    if (!reviewState) {
                        // Local-artifact review has no provider poll to yield POLL_TIMEOUT.
                        // Treat a missing outcome as reviewer recovery work before entering
                        // the bounded retry loop below.
                        const handoff = forgejoEnabled
                            ? 'did not submit a formal review outcome'
                            : `did not leave a complete local review handoff in ${artifactDir} (${slug}-review-findings.md, ${slug}-review-outcome.md, ${slug}-review-verdict.txt)`;
                        log(fmt.status('WARN', `Reviewer ${reviewer} ${handoff} for ${branch}; retrying the reviewer.`));
                        reviewState = review_polling_js_1.POLL_TIMEOUT;
                    }
                    // Timeout recovery loop for reviewer
                    const stateAny = state;
                    while ((stateAny['reviewerRetryCount'] || 0) < 2) {
                        stateAny['reviewerRetryCount'] = (stateAny['reviewerRetryCount'] || 0) + 1;
                        (0, review_state_js_1.persistReviewStateOrThrow)(writeReviewStateFn, slug, state, worktree);
                        const elapsedStr = (0, review_polling_js_1.formatElapsed)(Date.now() - Date.parse(stateAny['startedAt']));
                        const recoveryPrompt = `RECOVERY: Reviewer timeout after ${elapsedStr}. Please complete the review for ${branch}.`;
                        log(fmt.status('INFO', `Round ${attempt}: relaunching reviewer (${reviewer}) with recovery prompt (retry ${stateAny['reviewerRetryCount']}/3)...`));
                        let relaunchResult;
                        try {
                            relaunchResult = await startAgentFn('review', {
                                agent: reviewer,
                                prompt: (actualReviewer) => buildCompactReviewPromptFn({ reviewer: reviewer, branch, implementer: implementer, focus, attempt, repoRoot: worktree, missionPath: effectiveMissionPath || undefined, actualReviewer, reviewBaseline }) + '\n\n' + recoveryPrompt,
                                worktree, slug, role: 'reviewer', exclude: [implementer]
                            });
                        }
                        catch (err) {
                            error(fmt.status('FAIL', `Could not relaunch reviewer agent (${reviewer}): ${err.message}`));
                            exit(1);
                            return;
                        }
                        reviewer = applyAgentFallbackFn({
                            role: 'reviewer', original: reviewer, launchResult: relaunchResult,
                            state: state, slug, worktree, taskResolution, log, writeReviewStateFn, enforceTaskAssigneeFn
                        });
                        // The preceding attempt timed out. Clear that sentinel before
                        // inspecting artifacts and polling the newly launched reviewer;
                        // otherwise `!reviewState` stays false and every recovery launch
                        // is treated as another timeout without ever checking its result.
                        reviewState = null;
                        const retryArtifacts = await consumeReviewerArtifactsFn(slug, reviewer, {
                            worktree,
                            tmpDir: artifactDir,
                            fallbackToTmp: true,
                            readTokenFn,
                            getCommentsFn: getCommentsFn,
                            postCommentFn,
                            postReviewFn,
                            buildMetadataFooterFn: review_artifacts_js_1.buildMetadataFooter,
                            forgejoEnabled,
                            log,
                            error
                        });
                        if (retryArtifacts.consumed) {
                            if (!retryArtifacts.ok) {
                                log(fmt.status('WARN', `Reviewer ${reviewer} produced incomplete or invalid review artifacts; retrying the reviewer.`));
                                reviewState = review_polling_js_1.POLL_TIMEOUT;
                            }
                            else {
                                reviewState = retryArtifacts.reviewState;
                            }
                        }
                        if (!reviewState && forgejoEnabled) {
                            reviewState = await pollForReviewFn(prNumber, reviewer, state.startedAt, token, {
                                getLatestReviewForPrFn, sleepFn, intervalMs: pollIntervalMs, timeoutMs: pollTimeoutMs, retryCount: state.reviewerRetryCount, verbose, label: `round ${attempt} review retry ${state.reviewerRetryCount}`, log
                            });
                        }
                        if (!(0, review_polling_js_1.isPollTimeout)(reviewState)) {
                            break;
                        }
                    }
                    if ((0, review_polling_js_1.isPollTimeout)(reviewState)) {
                        error(fmt.status('FAIL', `Reviewer ${reviewer} did not submit a usable formal review outcome after ${stateAny['reviewerRetryCount']} recovery retries.`));
                        error('       Human intervention is required to complete or repair the review.');
                        exit(1);
                        return;
                    }
                }
            }
            if (dryRun) {
                return;
            }
            if (!reviewState) {
                if (forgejoEnabled) {
                    error(fmt.status('FAIL', `Reviewer ${reviewer} did not submit a formal review outcome for ${branch}.`));
                    error('       The reviewer agent may have exited without posting to the review PR.');
                }
                else {
                    error(fmt.status('FAIL', `Reviewer ${reviewer} did not leave a complete local review handoff for ${branch}.`));
                    error(`       Expected: ${artifactDir}/${slug}-review-findings.md, ${artifactDir}/${slug}-review-outcome.md, and ${artifactDir}/${slug}-review-verdict.txt.`);
                }
                exit(1);
                return;
            }
            if ((0, review_polling_js_1.isPollTimeout)(reviewState)) {
                error(fmt.status('FAIL', `Reviewer ${reviewer} did not submit a usable formal review outcome after bounded recovery retries.`));
                error('       Human intervention is required to complete or repair the review.');
                exit(1);
                return;
            }
            log(fmt.status('INFO', `Round ${attempt}: reviewer outcome = ${reviewState}`));
            if (reviewState === 'APPROVED') {
                state.transitionTo('approved');
                state.disposition = reviewState;
                (0, review_state_js_1.persistReviewStateOrThrow)(writeReviewStateFn, slug, state, worktree);
                log(fmt.status('PASS', 'Autonomous review stopped: reviewer approved the PR. Hand off to human review/integration.'));
                transitionVirtualFn(transitionTaskFn, slug, 'approved', { log });
                return;
            }
            state.transitionTo('fixing');
            state.disposition = reviewState;
        }
        else {
            // Resume in fixing phase, need reviewState
            if (forgejoEnabled) {
                const latestReview = await getLatestReviewForPrFn(prNumber, reviewer, state.startedAt, token);
                reviewState = latestReview ? latestReview.state : null;
                if (!reviewState) {
                    // Restore retry path: missing review on resume is recoverable
                    // (e.g., reviewer identity changed, state is stale, or artifact not yet
                    // discoverable). Treat as request-changes so the fixing phase proceeds
                    // and can re-trigger the review on the next attempt.
                    log(fmt.status('WARN', `No review found for ${reviewer} since ${state.startedAt}; treating as request-changes and proceeding to fixing phase.`));
                    reviewState = 'request-changes';
                }
            }
            else {
                // When the provider is disabled, use persisted review state.
                reviewState = state.disposition || null;
                if (!reviewState) {
                    // Restore retry path: missing local review state on resume is recoverable.
                    // Treat as request-changes so the fixing phase proceeds.
                    log(fmt.status('WARN', `No local review state found for ${reviewer}; treating as request-changes and proceeding to fixing phase.`));
                    reviewState = 'request-changes';
                }
            }
            log(fmt.status('INFO', `Round ${attempt}: resuming in fixing phase with review outcome = ${reviewState}`));
        }
        // Fixing phase
        let disposition;
        let reLaunch;
        let sinceIso = state.startedAt;
        if (isContinue && attempt === state.round) {
            if (forgejoEnabled) {
                log(fmt.status('INFO', `Round ${attempt}: checking for existing disposition by ${implementer} since ${state.startedAt}...`));
                disposition = await pollForDispositionFn(prNumber, implementer, state.startedAt, token, {
                    getLatestDispositionForPrFn, sleepFn, intervalMs: 1000, timeoutMs: CONTINUE_SKIP_CHECK_TIMEOUT_MS, verbose, label: `round ${attempt} skip-check`, log
                });
                // Skip-check timeout means no existing disposition - treat as null to proceed with initial launch
                if ((0, review_polling_js_1.isPollTimeout)(disposition)) {
                    disposition = null;
                }
                else if (isContinue && (disposition === 'BLOCKED' || disposition === 'PARKED')) {
                    // Stale BLOCKED/PARKED from a previous round: re-launch the implementer
                    // so they can post a fresh disposition reflecting the current state of the branch.
                    log(fmt.status('INFO', `Round ${attempt}: implementer disposition found (${disposition}). Re-launching implementer to assess whether blocker is resolved...`));
                    reLaunch = true;
                    // Capture a fresh sinceIso so the post-relaunch poll doesn't
                    // immediately return the same stale disposition. Use a strictly
                    // newer timestamp than the persisted round start to avoid same-ms
                    // collisions during fast local test runs.
                    sinceIso = strictlyLaterIso(state.startedAt);
                    disposition = null;
                }
            }
            else {
                // When the provider is disabled, use local review state.
                log(fmt.status('INFO', `Round ${attempt}: review provider disabled; using workflow-owned disposition state.`));
                disposition = null;
            }
        }
        if (!disposition) {
            // First launch or re-launch after stale BLOCKED/PARKED
            if (dryRun) {
                log(`\n--- DRY-RUN: implementer (${implementer}) act-on-review prompt ---`);
                log(buildActOnReviewPromptFn({ implementer: implementer, branch, attempt, repoRoot: worktree, missionPath: effectiveMissionPath || undefined, reviewBaseline }));
                if (reLaunch) {
                    log(fmt.status('INFO', `Round ${attempt}: stale BLOCKED/PARKED disposition replaced by fresh implementer action.`));
                }
                return;
            }
            (0, review_state_js_1.persistReviewStateOrThrow)(writeReviewStateFn, slug, state, worktree);
            transitionTaskFn(slug, 'active', { implementer, rootDir: worktree, log });
            if (implementer === 'autonomous' && !forgejoEnabled) {
                log(fmt.status('INFO', `Round ${attempt}: implementer identity is autonomous; skipping implementer launch and using local review artifacts only.`));
            }
            else {
                log(fmt.status('INFO', `Round ${attempt}: launching implementer (${implementer}) for act-on-review...`));
                let implementerLaunchResult;
                try {
                    implementerLaunchResult = await startAgentFn('act-on-review', {
                        agent: implementer,
                        prompt: (actualImplementer) => buildCompactActOnReviewPromptFn({ implementer: implementer, branch, attempt, reviewOutcome: reviewState, repoRoot: worktree, missionPath: effectiveMissionPath || undefined, actualImplementer, reviewBaseline }),
                        worktree, slug, role: 'implementer', exclude: [reviewer]
                    });
                }
                catch (err) {
                    error(fmt.status('FAIL', `Could not launch implementer agent (${implementer}): ${err.message}`));
                    exit(1);
                    return;
                }
                implementer = applyAgentFallbackFn({
                    role: 'implementer', original: implementer, launchResult: implementerLaunchResult,
                    state: state, slug, worktree, taskResolution, log, writeReviewStateFn, enforceTaskAssigneeFn
                });
                // Record follow-up telemetry immediately after the implementer runs.
                // This is intentionally a separate stored phase from the initial
                // execute/active launch. The window is bounded to this round's launch
                // so each act-on-review round adds only its own usage.
                const followUpSinceMs = stageLaunchSinceMs(implementerLaunchResult?.result);
                recordStageStatsSafeFn('active', {
                    stage: 'follow-up', slug, rootDir: worktree, worktree, implementer, reviewer,
                    result: implementerLaunchResult?.result,
                    sinceMs: followUpSinceMs || 0, log, error, state, writeReviewStateFn,
                    model: (0, product_config_js_1.resolveAgentModel)(implementer, worktree),
                });
            }
            const implementerArtifacts = await consumeImplementerArtifactsFn(slug, implementer, {
                worktree,
                tmpDir: artifactDir,
                fallbackToTmp: true,
                readTokenFn,
                getCommentsFn: getCommentsFn,
                postCommentFn,
                buildMetadataFooterFn: review_artifacts_js_1.buildMetadataFooter,
                forgejoEnabled,
                log,
                error
            });
            if (implementerArtifacts.consumed) {
                if (!implementerArtifacts.ok) {
                    exit(1);
                    return;
                }
                disposition = implementerArtifacts.disposition;
            }
            if (!disposition && forgejoEnabled) {
                disposition = await pollForDispositionFn(prNumber, implementer, sinceIso, token, {
                    getLatestDispositionForPrFn, sleepFn, intervalMs: pollIntervalMs, timeoutMs: pollTimeoutMs, retryCount: 0, verbose, label: `round ${attempt} disposition`, log
                });
            }
            if ((0, review_polling_js_1.isPollTimeout)(disposition)) {
                // Timeout recovery loop for implementer
                const stateAny = state;
                while ((stateAny['implementerRetryCount'] || 0) < 2) {
                    stateAny['implementerRetryCount'] = (stateAny['implementerRetryCount'] || 0) + 1;
                    (0, review_state_js_1.persistReviewStateOrThrow)(writeReviewStateFn, slug, state, worktree);
                    const elapsedStr = (0, review_polling_js_1.formatElapsed)(Date.now() - Date.parse(stateAny['startedAt']));
                    const recoveryPrompt = `RECOVERY: Implementer disposition timeout after ${elapsedStr}. Please provide a disposition (PUSHBACK_ALL, BLOCKED, PARKED, or continue with fixes) for ${branch}.`;
                    log(fmt.status('INFO', `Round ${attempt}: relaunching implementer (${implementer}) with recovery prompt (retry ${stateAny['implementerRetryCount']}/3)...`));
                    let relaunchResult;
                    try {
                        relaunchResult = await startAgentFn('act-on-review', {
                            agent: implementer,
                            prompt: (actualImplementer) => buildCompactActOnReviewPromptFn({ implementer: implementer, branch, attempt, reviewOutcome: reviewState, repoRoot: worktree, missionPath: effectiveMissionPath || undefined, actualImplementer, reviewBaseline }) + '\n\n' + recoveryPrompt,
                            worktree, slug, role: 'implementer', exclude: [reviewer]
                        });
                    }
                    catch (err) {
                        error(fmt.status('FAIL', `Could not relaunch implementer agent (${implementer}): ${err.message}`));
                        exit(1);
                        return;
                    }
                    implementer = applyAgentFallbackFn({
                        role: 'implementer', original: implementer, launchResult: relaunchResult,
                        state: state, slug, worktree, taskResolution, log, writeReviewStateFn, enforceTaskAssigneeFn
                    });
                    const retryArtifacts = await consumeImplementerArtifactsFn(slug, implementer, {
                        worktree,
                        tmpDir: artifactDir,
                        fallbackToTmp: true,
                        readTokenFn,
                        getCommentsFn: getCommentsFn,
                        postCommentFn,
                        buildMetadataFooterFn: review_artifacts_js_1.buildMetadataFooter,
                        forgejoEnabled,
                        log,
                        error
                    });
                    if (retryArtifacts.consumed) {
                        if (!retryArtifacts.ok) {
                            exit(1);
                            return;
                        }
                        disposition = retryArtifacts.disposition;
                    }
                    if (!disposition && forgejoEnabled) {
                        disposition = await pollForDispositionFn(prNumber, implementer, sinceIso, token, {
                            getLatestDispositionForPrFn, sleepFn, intervalMs: pollIntervalMs, timeoutMs: pollTimeoutMs, retryCount: state.implementerRetryCount, verbose, label: `round ${attempt} disposition retry ${state.implementerRetryCount}`, log
                        });
                    }
                    if (!(0, review_polling_js_1.isPollTimeout)(disposition)) {
                        break;
                    }
                }
                if ((0, review_polling_js_1.isPollTimeout)(disposition)) {
                    (0, review_state_js_1.persistReviewStateOrThrow)(writeReviewStateFn, slug, state, worktree);
                    log(fmt.status('INFO', `Autonomous review stopped: excessive implementer timeout retries`));
                    return;
                }
            }
            else if (!disposition) {
                error(fmt.status('FAIL', `Implementer ${implementer} did not post an autonomous review disposition comment.`));
                exit(1);
                return;
            }
            // Suppress the duplicate message after re-launch
            reLaunch = null;
        }
        else if (reLaunch) {
            // Re-launch path: stale BLOCKED/PARKED was replaced by fresh implementation.
            // The disposition was set by the re-launch above (lines 767-785).
            // Fall through to disposition handling below.
        }
        else {
            // Skip-check found an existing disposition that is not BLOCKED/PARKED (or reLaunch flag).
            log(fmt.status('INFO', `Round ${attempt}: implementer disposition found (${disposition}). Skipping implementer launch.`));
        }
        if (!disposition) {
            error(fmt.status('FAIL', `Implementer ${implementer} did not post an autonomous review disposition comment.`));
            exit(1);
            return;
        }
        if ((0, review_polling_js_1.isPollTimeout)(disposition)) {
            (0, review_state_js_1.persistReviewStateOrThrow)(writeReviewStateFn, slug, state, worktree);
            log(fmt.status('INFO', `Autonomous review stopped: excessive implementer timeout retries`));
            return;
        }
        log(fmt.status('INFO', `Round ${attempt}: implementer disposition = ${disposition}`));
        if (disposition === 'PUSHBACK_ALL') {
            state.disposition = disposition;
            (0, review_state_js_1.persistReviewStateOrThrow)(writeReviewStateFn, slug, state, worktree);
            log(fmt.status('INFO', 'Autonomous review stopped: implementer pushed back on all remaining comments. Hand off to human review.'));
            return;
        }
        if (disposition === 'BLOCKED' || disposition === 'PARKED') {
            state.disposition = disposition;
            (0, review_state_js_1.persistReviewStateOrThrow)(writeReviewStateFn, slug, state, worktree);
            log(fmt.status('INFO', `Autonomous review stopped: implementer reported ${disposition}. Hand off to human review.`));
            return;
        }
        state.disposition = disposition;
        try {
            state.transitionTo('reviewing');
        }
        catch (_) { /* ignore */ }
        (0, review_state_js_1.persistReviewStateOrThrow)(writeReviewStateFn, slug, state, worktree);
        log(fmt.status('INFO', `Round ${attempt}: implementer made changes. Continuing to round ${attempt + 1}.`));
    }
    if (!state.disposition) {
        state.disposition = 'MAX_ATTEMPTS';
        (0, review_state_js_1.persistReviewStateOrThrow)(writeReviewStateFn, slug, state, worktree);
    }
    log(fmt.status('INFO', `Autonomous review stopped: reached ${maxAttempts} attempts. Hand off to human review.`));
}
