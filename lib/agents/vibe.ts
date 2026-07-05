import { spawnAndTee } from '../core/spawn-tee.js';
import { parseVibeMeta, getVibeProviderModel, DEFAULT_VIBE_LOG_DIR } from './vibe-telemetry.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
  return path.join(resolveVibeWorktree(worktree), '.workflow', 'vibe-home');
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
    if (out.length > 0 && out[out.length - 1] !== '') {out.push('');}
    out.push('[session_logging]');
    out.push(saveDirLine);
    out.push('enabled = true');
  }

  return out.join('\n');
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
// telemetryToStatsFields in lib/commands/stats.ts.


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

  // Scan session directories chronologically (sorted by basename).
  // For each session, check if its start_time falls within the invocation
  // window, then pick the session closest to the invocation start time.
  // This replaces the previous approach of calling extractVibeTelemetry
  // which always returned the globally newest session regardless of which
  // invocation it belonged to.
  let bestTelemetry: ReturnType<typeof parseVibeMeta> | null = null;
  let bestDistance = Infinity;
  let bestMtimeMs: number | null = null;

  try {
    const entries = fs.readdirSync(scanDir);
    const dirs = entries.filter((d: string) => d.startsWith('session_')).sort();

    for (const dir of dirs) {
      const metaPath = path.join(scanDir, dir, 'meta.json');
      let metaStat: fs.Stats;
      try { metaStat = fs.statSync(metaPath); } catch (_) { continue; }

      let content: string;
      try { content = fs.readFileSync(metaPath, 'utf8'); } catch (_) { continue; }

      let meta: Record<string, unknown>;
      try { meta = JSON.parse(content); } catch (_) { continue; }

      const startTime = meta.start_time;
      if (typeof startTime !== 'string') { continue; }
      const sessionTime = Date.parse(startTime);
      if (Number.isNaN(sessionTime)) { continue; }

      // Check invocation window if applicable
      if (invokeWindow && (sessionTime < invokeWindow.start || sessionTime > invokeWindow.end)) {
        continue;
      }

      const telemetry = parseVibeMeta(meta);
      if (!telemetry) { continue; }

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
  } catch (_) {
    // Directory unreadable — fall through to null telemetry
  }

  if (!bestTelemetry) {
    return { ...result, sessionId: result.sessionId || null, telemetry: null } as ProcessedResult;
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

function extractVibeSessionId(stdout: string) {
  void stdout;
  // Vibe does not currently emit a resume hint in programmatic mode.
  // Return null to indicate no resume capability via stdout parsing.
  return null;
}

function resolveVibeCommand() {
  return 'vibe';
}

function buildVibeInvocation({ prompt, worktree, env, resume, sessionId, model = null }: VibeInvocationOptions) {
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
