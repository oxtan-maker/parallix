import { spawnAndTee } from '../process/spawn-tee.js';
import { compareCodeUnits } from '../../domain/comparators.js';
import { parseVibeMeta, getVibeProviderModel, DEFAULT_VIBE_LOG_DIR } from './vibe-telemetry.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { vibeHomeRoot as vibeStateHome } from '../config/state-homes.js';

/**
 * Maximum acceptable age (in minutes) for a vibe session's start_time
 * relative to the invocation start. Sessions older than this window are
 * rejected as potentially misattributed across concurrent missions.
 */
const MAX_SESSION_AGE_MINUTES = 120;

interface VibeInvocationOptions {
  prompt: string;
  worktree: string;
  env?: Record<string, string>;
  resume?: boolean;
  sessionId?: string | null;
  model?: string | null;
}

interface StartVibeAgentOptions extends VibeInvocationOptions {
  teeOptions?: object;
}

function resolveVibeWorktree(worktree?: string | null) {
  return worktree || process.cwd();
}

function vibeHomeRoot(worktree: string) {
  return vibeStateHome(resolveVibeWorktree(worktree));
}

function vibeConfigPath(worktree: string) {
  return path.join(vibeHomeRoot(worktree), 'config.toml');
}

function vibeSessionLogDir(worktree: string) {
  return path.join(vibeHomeRoot(worktree), 'logs', 'session');
}

function userVibeConfigPath() {
  return path.join(os.homedir(), '.vibe', 'config.toml');
}

function userVibeEnvPath() {
  return path.join(os.homedir(), '.vibe', '.env');
}

function overrideSessionLogging(configText: string, worktree: string) {
  const saveDirLine = `save_dir = ${JSON.stringify(vibeSessionLogDir(worktree))}`;
  const source = String(configText || '');
  const lines = source.split('\n');
  const out: string[] = [];
  const state = { inSessionLogging: false, wroteSaveDir: false };

  for (const line of lines) {
    const replacement = sessionLoggingLine(line, saveDirLine, state);
    if (replacement !== null) { out.push(replacement); }
  }

  if (state.inSessionLogging && !state.wroteSaveDir) {
    out.push(saveDirLine);
  }

  if (!source.includes('[session_logging]')) { appendSessionLogging(out, saveDirLine); }

  return out.join('\n');
}

function sessionLoggingLine(line: string, saveDirLine: string, state: { inSessionLogging: boolean; wroteSaveDir: boolean }): string | null {
  if (/^\s*\[[^\]]+\]\s*$/.test(line)) {
    if (state.inSessionLogging && !state.wroteSaveDir) { state.wroteSaveDir = true; return `${saveDirLine}\n${line}`; }
    state.inSessionLogging = line.trim() === '[session_logging]';
    return line;
  }
  if (!state.inSessionLogging || !/^\s*save_dir\s*=/.test(line)) { return line; }
  if (state.wroteSaveDir) { return null; }
  state.wroteSaveDir = true;
  return saveDirLine;
}

function appendSessionLogging(out: string[], saveDirLine: string): void {
  if (out.length > 0 && out[out.length - 1] !== '') {out.push('');}
  out.push('[session_logging]', saveDirLine, 'enabled = true');
}

function ensureVibeHome(worktree: string) {
  const home = vibeHomeRoot(worktree);
  fs.mkdirSync(vibeSessionLogDir(worktree), { recursive: true });
  const sourceConfigPath = userVibeConfigPath();
  const targetConfigPath = vibeConfigPath(worktree);

  if (fs.existsSync(sourceConfigPath)) {
    const sourceText = fs.readFileSync(sourceConfigPath, 'utf8');
    fs.writeFileSync(targetConfigPath, overrideSessionLogging(sourceText, worktree), 'utf8');
  }

  const sourceEnvPath = userVibeEnvPath();
  const targetEnvPath = path.join(home, '.env');
  if (fs.existsSync(sourceEnvPath) && !fs.existsSync(targetEnvPath)) {
    fs.copyFileSync(sourceEnvPath, targetEnvPath);
  }
}

// Vibe in programmatic mode (-p/--prompt) does NOT output a resume
// hint to stdout/stderr like other agents do. Session IDs are stored in
// ~/.vibe/logs/session/session_<timestamp>_<short_id>/meta.json with UUID format,
// but there is no reliable stdout pattern to extract. Therefore, Vibe is
// NOT marked as RESUME_CAPABLE in agents.js. If future Vibe versions add
// a resume hint, update this regex and add 'vibe' to RESUME_CAPABLE.
// Current session ID format in meta.json: UUID like "a3dd3d4d-f97d-d57d-4942-a1f694e3a922"
// Directory naming uses first 8 chars: session_20260521_162703_a3dd3d4d
// No stdout marker detected in testing, so we leave this as null.
// Telemetry: vibe writes structured token-usage data to meta.json files
// in ~/.vibe/logs/session/. This module's processResult function scans session
// directories and correlates by start_time window to prevent cross-mission
// telemetry misattribution. The mapped telemetry is consumed by
// telemetryToStatsFields in src/adapters/cli/commands/stats.ts.


interface ProcessedResult {
  sessionId: string | null;
  telemetry: {
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    totalTokens: number;
    toolCalls: number;
    usagePercent: null;
    cost_usd: number;
  } | null;
  [key: string]: unknown;
}

function readVibeSession(scanDir: string, dir: string) {
  try {
    const metaPath = path.join(scanDir, dir, 'meta.json');
    const mtimeMs = fs.statSync(metaPath).mtimeMs;
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as Record<string, unknown>;
    const startTime = meta.start_time;
    const sessionTime = typeof startTime === 'string' ? Date.parse(startTime) : Number.NaN;
    const telemetry = Number.isNaN(sessionTime) ? null : parseVibeMeta(meta);
    return telemetry ? { telemetry, sessionTime, mtimeMs } : null;
  } catch (_) {
    return null;
  }
}

function closestVibeSession(scanDir: string, invokeTime: number, invokeWindow: { start: number; end: number } | null) {
  try {
    const dirs = fs.readdirSync(scanDir).filter((dir: string) => dir.startsWith('session_')).sort(compareCodeUnits);
    let best: ReturnType<typeof readVibeSession> = null;
    for (const dir of dirs) {
      const candidate = readVibeSession(scanDir, dir);
      if (!candidate || (invokeWindow && (candidate.sessionTime < invokeWindow.start || candidate.sessionTime > invokeWindow.end))) { continue; }
      if (Number.isNaN(invokeTime)) { return candidate; }
      if (best === null || Math.abs(candidate.sessionTime - invokeTime) < Math.abs(best.sessionTime - invokeTime)) { best = candidate; }
    }
    return best;
  } catch (_) {
    return null;
  }
}

function processResult(result: any, basePath?: string, invocationStart?: string): ProcessedResult {
  if (!result || typeof result !== 'object') {
    return { sessionId: null, telemetry: null };
  }

  const scanDir = basePath || DEFAULT_VIBE_LOG_DIR;

  // Determine the invocation window for session correlation.
  // When invocationStart is provided, only consider sessions whose
  // start_time falls within MAX_SESSION_AGE_MINUTES of the invocation.
  // This prevents cross-mission telemetry misattribution when multiple
  // vibe phases run concurrently against a shared session directory.
  let invokeTime = NaN;
  let invokeWindow: { start: number; end: number } | null = null;
  if (invocationStart) {
    invokeTime = Date.parse(invocationStart);
    if (!Number.isNaN(invokeTime)) {
      const deltaMs = MAX_SESSION_AGE_MINUTES * 60000;
      invokeWindow = { start: invokeTime - deltaMs, end: invokeTime + deltaMs };
    }
  }

  const bestSession = closestVibeSession(scanDir, invokeTime, invokeWindow);
  const bestTelemetry = bestSession?.telemetry ?? null;
  const bestMtimeMs = bestSession?.mtimeMs ?? null;

  if (!bestTelemetry) {
    return { ...result, sessionId: result.sessionId || null, telemetry: null } as ProcessedResult;
  }

  // Freshness flag for the launch-result success/failure decision (architecture migration):
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
  result.telemetryFresh = Boolean(
    bestMtimeMs !== null && !Number.isNaN(invokeTime) && bestMtimeMs + 1000 >= invokeTime
  );

  const allToolCalls =
    (bestTelemetry.toolCallsAgreed || 0) +
    (bestTelemetry.toolCallsRejected || 0) +
    (bestTelemetry.toolCallsFailed || 0) +
    (bestTelemetry.toolCallsSucceeded || 0);

  const pm = getVibeProviderModel();
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

  return { ...result, sessionId: result.sessionId || null } as ProcessedResult;
}

function extractVibeSessionId(_stdout: string) {
  // Vibe does not currently emit a resume hint in programmatic mode.
  // Return null to indicate no resume capability via stdout parsing.
  return null;
}

function resolveVibeCommand() {
  return 'vibe';
}

function buildVibeInvocation({ prompt, worktree, env, resume: _resume, sessionId: _sessionId, model = null }: VibeInvocationOptions) {
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

function startVibeAgent({ prompt, worktree, env, resume = false, sessionId = null, model = null, teeOptions = {} }: StartVibeAgentOptions) {
  const rootDir = resolveVibeWorktree(worktree);
  ensureVibeHome(rootDir);
  const invocation = buildVibeInvocation({ prompt, worktree: rootDir, env, resume, sessionId, model });
  const invocationStart = new Date().toISOString();
  const resultPromise = spawnAndTee(invocation.command, invocation.args, { ...invocation.options, ...teeOptions } as any).then((result: any) => {
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
function isSpuriousVibeExit(result: any) {
  if (!result || result.status !== 1 || result.signal || result.error) {return false;}
  if (!result.telemetryFresh) {return false;}
  const t = result.telemetry;
  return Boolean(t && ((t.totalTokens || 0) > 0 || (t.inputTokens || 0) > 0 || (t.outputTokens || 0) > 0));
}

export {
  buildVibeInvocation,
  ensureVibeHome,
  extractVibeSessionId,
  getVibeProviderModel,
  isSpuriousVibeExit,
  processResult,
  resolveVibeCommand,
  startVibeAgent,
  vibeConfigPath,
  vibeHomeRoot,
  vibeSessionLogDir
};
