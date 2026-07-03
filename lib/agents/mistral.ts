import { spawnAndTee } from '../core/spawn-tee.js';
import { parseMistralMeta, getMistralProviderModel, DEFAULT_MISTRAL_LOG_DIR } from './mistral-telemetry.js';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Maximum acceptable age (in minutes) for a mistral session's start_time
 * relative to the invocation start. Sessions older than this window are
 * rejected as potentially misattributed across concurrent missions.
 */
const MAX_SESSION_AGE_MINUTES = 120;

interface MistralInvocationOptions {
  prompt: string;
  worktree: string;
  env?: Record<string, string>;
  resume?: boolean;
  sessionId?: string | null;
  model?: string | null;
}

interface StartMistralAgentOptions extends MistralInvocationOptions {
  teeOptions?: object;
}

// Mistral Vibe in programmatic mode (-p/--prompt) does NOT output a resume
// hint to stdout/stderr like other agents do. Session IDs are stored in
// ~/.vibe/logs/session/session_<timestamp>_<short_id>/meta.json with UUID format,
// but there is no reliable stdout pattern to extract. Therefore, Mistral is
// NOT marked as RESUME_CAPABLE in agents.js. If future Vibe versions add
// a resume hint, update this regex and add 'mistral' to RESUME_CAPABLE.
// Current session ID format in meta.json: UUID like "a3dd3d4d-f97d-d57d-4942-a1f694e3a922"
// Directory naming uses first 8 chars: session_20260521_162703_a3dd3d4d
// No stdout marker detected in testing, so we leave this as null.
// Telemetry: mistral/vibe writes structured token-usage data to meta.json files
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

  const scanDir = basePath || DEFAULT_MISTRAL_LOG_DIR;

  // Determine the invocation window for session correlation.
  // When invocationStart is provided, only consider sessions whose
  // start_time falls within MAX_SESSION_AGE_MINUTES of the invocation.
  // This prevents cross-mission telemetry misattribution when multiple
  // mistral phases run concurrently against a shared session directory.
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
  // This replaces the previous approach of calling extractMistralTelemetry
  // which always returned the globally newest session regardless of which
  // invocation it belonged to.
  let bestTelemetry: ReturnType<typeof parseMistralMeta> | null = null;
  let bestDistance = Infinity;

  try {
    const entries = fs.readdirSync(scanDir);
    const dirs = entries.filter((d: string) => d.startsWith('session_')).sort();

    for (const dir of dirs) {
      const metaPath = path.join(scanDir, dir, 'meta.json');
      if (!fs.existsSync(metaPath)) { continue; }

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

      const telemetry = parseMistralMeta(meta);
      if (!telemetry) { continue; }

      // When no invocationStart is provided, pick the first valid session.
      // When invocationStart is provided, pick the session closest in time.
      if (Number.isNaN(invokeTime)) {
        bestTelemetry = telemetry;
        break;
      }
      const distance = Math.abs(sessionTime - invokeTime);
      if (distance < bestDistance) {
        bestTelemetry = telemetry;
        bestDistance = distance;
      }
    }
  } catch (_) {
    // Directory unreadable — fall through to null telemetry
  }

  if (!bestTelemetry) {
    return { ...result, sessionId: result.sessionId || null, telemetry: null } as ProcessedResult;
  }

  const allToolCalls =
    (bestTelemetry.toolCallsAgreed || 0) +
    (bestTelemetry.toolCallsRejected || 0) +
    (bestTelemetry.toolCallsFailed || 0) +
    (bestTelemetry.toolCallsSucceeded || 0);

  const pm = getMistralProviderModel();
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

function extractMistralSessionId(stdout: string) {
  void stdout;
  // Vibe does not currently emit a resume hint in programmatic mode.
  // Return null to indicate no resume capability via stdout parsing.
  return null;
}

function resolveMistralCommand() {
  return 'vibe';
}

function buildMistralInvocation({ prompt, worktree, env, resume, sessionId, model = null }: MistralInvocationOptions) {
  void resume;
  void sessionId;
  // --trust only bypasses the working-directory trust prompt; tool-call
  // approval is a separate gate that vibe --help documents as controlled by
  // --auto-approve/--yolo. Without it, any prompt that needs a tool call
  // blocks on interactive approval outside a TTY and fails with a generic
  // error, which then gets misread as a real launch failure and persisted
  // to the blocklist (claude/opencode/codex all pass their own equivalent
  // non-interactive bypass already).
  const args = ['--prompt', prompt, '--trust', '--yolo', '--output', 'text'];

  // Vibe programmatic mode does not support --resume flag in the same way
  // as other agents. The --resume flag exists but requires interactive selection
  // or a session picker. Since we cannot reliably pass a session ID via
  // programmatic mode, we do not add resume flags here.
  // If resume capability is proven in a future version, update this.

  // Vibe has no CLI model flag in programmatic mode; the active model is
  // selected via the VIBE_ACTIVE_MODEL env var (verified from `vibe --help`).
  const modelEnv = model ? { VIBE_ACTIVE_MODEL: model } : {};

  return {
    command: resolveMistralCommand(),
    args,
    options: {
      stdio: 'inherit',
      cwd: worktree,
      env: { ...process.env, ...env, ...modelEnv }
    }
  };
}

function startMistralAgent({ prompt, worktree, env, resume = false, sessionId = null, model = null, teeOptions = {} }: StartMistralAgentOptions) {
  const invocation = buildMistralInvocation({ prompt, worktree, env, resume, sessionId, model });
  const invocationStart = new Date().toISOString();
  const resultPromise = spawnAndTee(invocation.command, invocation.args, { ...invocation.options, ...teeOptions } as any).then((result: any) => {
    if (result && result.stdout) {
      result.sessionId = extractMistralSessionId(result.stdout);
    }
    return processResult(result, undefined, invocationStart);
  });

  return { invocation, resultPromise };
}

export {
  buildMistralInvocation,
  extractMistralSessionId,
  getMistralProviderModel,
  processResult,
  resolveMistralCommand,
  startMistralAgent
};
