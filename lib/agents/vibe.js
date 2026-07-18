"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getVibeProviderModel = void 0;
exports.buildVibeInvocation = buildVibeInvocation;
exports.ensureVibeHome = ensureVibeHome;
exports.extractVibeSessionId = extractVibeSessionId;
exports.isSpuriousVibeExit = isSpuriousVibeExit;
exports.processResult = processResult;
exports.resolveVibeCommand = resolveVibeCommand;
exports.startVibeAgent = startVibeAgent;
exports.vibeConfigPath = vibeConfigPath;
exports.vibeHomeRoot = vibeHomeRoot;
exports.vibeSessionLogDir = vibeSessionLogDir;
const spawn_tee_js_1 = require("../core/spawn-tee.js");
const vibe_telemetry_js_1 = require("./vibe-telemetry.js");
Object.defineProperty(exports, "getVibeProviderModel", { enumerable: true, get: function () { return vibe_telemetry_js_1.getVibeProviderModel; } });
const node_fs_1 = __importDefault(require("node:fs"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
/**
 * Maximum acceptable age (in minutes) for a vibe session's start_time
 * relative to the invocation start. Sessions older than this window are
 * rejected as potentially misattributed across concurrent missions.
 */
const MAX_SESSION_AGE_MINUTES = 120;
function resolveVibeWorktree(worktree) {
    return worktree || process.cwd();
}
function vibeHomeRoot(worktree) {
    return node_path_1.default.join(resolveVibeWorktree(worktree), '.workflow', 'vibe-home');
}
function vibeConfigPath(worktree) {
    return node_path_1.default.join(vibeHomeRoot(worktree), 'config.toml');
}
function vibeSessionLogDir(worktree) {
    return node_path_1.default.join(vibeHomeRoot(worktree), 'logs', 'session');
}
function userVibeConfigPath() {
    return node_path_1.default.join(node_os_1.default.homedir(), '.vibe', 'config.toml');
}
function userVibeEnvPath() {
    return node_path_1.default.join(node_os_1.default.homedir(), '.vibe', '.env');
}
function overrideSessionLogging(configText, worktree) {
    const saveDirLine = `save_dir = ${JSON.stringify(vibeSessionLogDir(worktree))}`;
    const source = String(configText || '');
    const lines = source.split('\n');
    const out = [];
    let inSessionLogging = false;
    let wroteSaveDir = false;
    for (const line of lines) {
        const trimmed = line.trim();
        const isTable = /^\s*\[[^\]]+\]\s*$/.test(line);
        if (isTable) {
            if (inSessionLogging && !wroteSaveDir) {
                out.push(saveDirLine);
                wroteSaveDir = true;
            }
            inSessionLogging = trimmed === '[session_logging]';
            out.push(line);
            continue;
        }
        if (inSessionLogging && /^\s*save_dir\s*=/.test(line)) {
            if (!wroteSaveDir) {
                out.push(saveDirLine);
                wroteSaveDir = true;
            }
            continue;
        }
        out.push(line);
    }
    if (inSessionLogging && !wroteSaveDir) {
        out.push(saveDirLine);
        wroteSaveDir = true;
    }
    if (!source.includes('[session_logging]')) {
        if (out.length > 0 && out[out.length - 1] !== '') {
            out.push('');
        }
        out.push('[session_logging]');
        out.push(saveDirLine);
        out.push('enabled = true');
    }
    return out.join('\n');
}
function ensureVibeHome(worktree) {
    const home = vibeHomeRoot(worktree);
    node_fs_1.default.mkdirSync(vibeSessionLogDir(worktree), { recursive: true });
    const sourceConfigPath = userVibeConfigPath();
    const targetConfigPath = vibeConfigPath(worktree);
    if (node_fs_1.default.existsSync(sourceConfigPath)) {
        const sourceText = node_fs_1.default.readFileSync(sourceConfigPath, 'utf8');
        node_fs_1.default.writeFileSync(targetConfigPath, overrideSessionLogging(sourceText, worktree), 'utf8');
    }
    const sourceEnvPath = userVibeEnvPath();
    const targetEnvPath = node_path_1.default.join(home, '.env');
    if (node_fs_1.default.existsSync(sourceEnvPath) && !node_fs_1.default.existsSync(targetEnvPath)) {
        node_fs_1.default.copyFileSync(sourceEnvPath, targetEnvPath);
    }
}
function processResult(result, basePath, invocationStart) {
    if (!result || typeof result !== 'object') {
        return { sessionId: null, telemetry: null };
    }
    const scanDir = basePath || vibe_telemetry_js_1.DEFAULT_VIBE_LOG_DIR;
    // Determine the invocation window for session correlation.
    // When invocationStart is provided, only consider sessions whose
    // start_time falls within MAX_SESSION_AGE_MINUTES of the invocation.
    // This prevents cross-mission telemetry misattribution when multiple
    // vibe phases run concurrently against a shared session directory.
    let invokeTime = NaN;
    let invokeWindow = null;
    if (invocationStart) {
        invokeTime = Date.parse(invocationStart);
        if (!Number.isNaN(invokeTime)) {
            const deltaMs = MAX_SESSION_AGE_MINUTES * 60000;
            invokeWindow = { start: invokeTime - deltaMs, end: invokeTime + deltaMs };
        }
    }
    // Scan session directories chronologically (sorted by basename).
    // For each session, check if its start_time falls within the invocation
    // window, then pick the session closest to the invocation start time.
    // This replaces the previous approach of calling extractVibeTelemetry
    // which always returned the globally newest session regardless of which
    // invocation it belonged to.
    let bestTelemetry = null;
    let bestDistance = Infinity;
    let bestMtimeMs = null;
    try {
        const entries = node_fs_1.default.readdirSync(scanDir);
        const dirs = entries.filter((d) => d.startsWith('session_')).sort();
        for (const dir of dirs) {
            const metaPath = node_path_1.default.join(scanDir, dir, 'meta.json');
            let metaStat;
            try {
                metaStat = node_fs_1.default.statSync(metaPath);
            }
            catch (_) {
                continue;
            }
            let content;
            try {
                content = node_fs_1.default.readFileSync(metaPath, 'utf8');
            }
            catch (_) {
                continue;
            }
            let meta;
            try {
                meta = JSON.parse(content);
            }
            catch (_) {
                continue;
            }
            const startTime = meta.start_time;
            if (typeof startTime !== 'string') {
                continue;
            }
            const sessionTime = Date.parse(startTime);
            if (Number.isNaN(sessionTime)) {
                continue;
            }
            // Check invocation window if applicable
            if (invokeWindow && (sessionTime < invokeWindow.start || sessionTime > invokeWindow.end)) {
                continue;
            }
            const telemetry = (0, vibe_telemetry_js_1.parseVibeMeta)(meta);
            if (!telemetry) {
                continue;
            }
            // When no invocationStart is provided, pick the first valid session.
            // When invocationStart is provided, pick the session closest in time.
            if (Number.isNaN(invokeTime)) {
                bestTelemetry = telemetry;
                bestMtimeMs = metaStat.mtimeMs;
                break;
            }
            const distance = Math.abs(sessionTime - invokeTime);
            if (distance < bestDistance) {
                bestTelemetry = telemetry;
                bestDistance = distance;
                bestMtimeMs = metaStat.mtimeMs;
            }
        }
    }
    catch (_) {
        // Directory unreadable — fall through to null telemetry
    }
    if (!bestTelemetry) {
        return { ...result, sessionId: result.sessionId || null, telemetry: null };
    }
    // Freshness flag for the launch-result success/failure decision (task-1416):
    // a session within the correlation window can still predate this
    // invocation by up to MAX_SESSION_AGE_MINUTES (a leftover from an earlier,
    // unrelated run against the same shared log directory). Only a meta.json
    // written at or after this invocation started is trustworthy evidence
    // that *this* run produced the telemetry, so isSpuriousVibeExit must
    // check telemetryFresh rather than the mere presence of result.telemetry.
    // The +1000ms grace absorbs filesystem mtime rounding (some filesystems
    // truncate to whole seconds) and small clock skew between invokeTime and
    // the meta.json write, so a session written a moment before invokeTime
    // due to that rounding isn't wrongly treated as stale.
    // isSpuriousVibeExit must check telemetryFresh rather than the mere
    // presence of result.telemetry.
    result.telemetryFresh = Boolean(bestMtimeMs !== null && !Number.isNaN(invokeTime) && bestMtimeMs + 1000 >= invokeTime);
    const allToolCalls = (bestTelemetry.toolCallsAgreed || 0) +
        (bestTelemetry.toolCallsRejected || 0) +
        (bestTelemetry.toolCallsFailed || 0) +
        (bestTelemetry.toolCallsSucceeded || 0);
    const pm = (0, vibe_telemetry_js_1.getVibeProviderModel)();
    const model = bestTelemetry.contextTokens > 0 || bestTelemetry.inputTokens > 0 ? 'mistral' : pm.model;
    result.telemetry = {
        provider: pm.provider,
        model,
        inputTokens: bestTelemetry.inputTokens,
        outputTokens: bestTelemetry.outputTokens,
        cachedTokens: bestTelemetry.contextTokens,
        totalTokens: bestTelemetry.totalTokens,
        toolCalls: allToolCalls,
        usagePercent: null,
        cost_usd: bestTelemetry.sessionCost,
    };
    return { ...result, sessionId: result.sessionId || null };
}
function extractVibeSessionId(stdout) {
    void stdout;
    // Vibe does not currently emit a resume hint in programmatic mode.
    // Return null to indicate no resume capability via stdout parsing.
    return null;
}
function resolveVibeCommand() {
    return 'vibe';
}
function buildVibeInvocation({ prompt, worktree, env, resume, sessionId, model = null }) {
    void resume;
    void sessionId;
    const rootDir = resolveVibeWorktree(worktree);
    // --trust only bypasses the working-directory trust prompt; tool-call
    // approval is a separate gate that vibe --help documents as controlled by
    // --auto-approve/--yolo. Without it, any prompt that needs a tool call
    // blocks on interactive approval outside a TTY and fails with a generic
    // error, which then gets misread as a real launch failure and persisted
    // to the blocklist (claude/opencode/codex all pass their own equivalent
    // non-interactive bypass already).
    const args = ['--prompt', prompt, '--trust', '--yolo', '--output', 'text', '--workdir', rootDir, '--add-dir', '/tmp'];
    // Vibe programmatic mode does not support --resume flag in the same way
    // as other agents. The --resume flag exists but requires interactive selection
    // or a session picker. Since we cannot reliably pass a session ID via
    // programmatic mode, we do not add resume flags here.
    // If resume capability is proven in a future version, update this.
    // Vibe has no CLI model flag in programmatic mode; the active model is
    // selected via the VIBE_ACTIVE_MODEL env var (verified from `vibe --help`).
    const modelEnv = model ? { VIBE_ACTIVE_MODEL: model } : {};
    return {
        command: resolveVibeCommand(),
        args,
        options: {
            stdio: 'inherit',
            cwd: rootDir,
            env: { ...process.env, ...env, ...modelEnv, VIBE_HOME: vibeHomeRoot(rootDir) }
        }
    };
}
function startVibeAgent({ prompt, worktree, env, resume = false, sessionId = null, model = null, teeOptions = {} }) {
    const rootDir = resolveVibeWorktree(worktree);
    ensureVibeHome(rootDir);
    const invocation = buildVibeInvocation({ prompt, worktree: rootDir, env, resume, sessionId, model });
    const invocationStart = new Date().toISOString();
    const resultPromise = (0, spawn_tee_js_1.spawnAndTee)(invocation.command, invocation.args, { ...invocation.options, ...teeOptions }).then((result) => {
        if (result && result.stdout) {
            result.sessionId = extractVibeSessionId(result.stdout);
        }
        return processResult(result, vibeSessionLogDir(rootDir), invocationStart);
    });
    return { invocation, resultPromise };
}
// Vibe sometimes exits 1 after a turn that actually completed (e.g.
// a cleanup-path crash once the model has already responded). The session
// meta.json under DEFAULT_VIBE_LOG_DIR is written directly by Vibe as it
// processes the turn, so a non-zero-usage stats block there (attached to
// result.telemetry by processResult above) is trustworthy evidence the run
// produced real work, independent of the final exit code. Mirrors
// isSpuriousOpencodeExit() in opencode.ts.
function isSpuriousVibeExit(result) {
    if (!result || result.status !== 1 || result.signal || result.error) {
        return false;
    }
    if (!result.telemetryFresh) {
        return false;
    }
    const t = result.telemetry;
    return Boolean(t && ((t.totalTokens || 0) > 0 || (t.inputTokens || 0) > 0 || (t.outputTokens || 0) > 0));
}
