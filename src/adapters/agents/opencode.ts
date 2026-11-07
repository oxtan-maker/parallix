import { recognizedFailureReason } from '../../domain/failure-reason.js';
import { providerEvents } from '../process/failure-normalization.js';
import type { ParallixConfiguration } from "../../application/ports/configuration.js";
import { DEFAULT_CONFIGURATION } from "../../application/ports/configuration.js";
import type { AgentProcessResult, AgentProcessSpawn } from './agent-process-types.js';
import { spawnAndTee, type SpawnTeeOptions } from '../process/spawn-tee.js';
import { extractOpencodeTelemetryFromExport } from './opencode-telemetry.js';
import { captureOpencodeExport } from './opencode-export.js';
import { spawnSync } from 'node:child_process';
import { resolveOpencodeCommand } from './opencode-command.js';
import type { SessionMarkerPort } from '../../application/domain-ports.js';
import type { MissionId } from '../../domain/mission.js';
import type { SessionRole } from '../../domain/session.js';
import { buildSubagentLimitPrefix } from './subagent-limit.js';

interface BuildOpencodeInvocationOptions {
  configuration?: ParallixConfiguration;
  prompt: string;
  worktree: string;
  env?: NodeJS.ProcessEnv;
  resume?: boolean;
  sessionId?: string | null;
  model?: string | null;
  preferJson?: boolean;
}

interface StartOpencodeAgentOptions {
  configuration?: ParallixConfiguration;
  prompt: string;
  worktree: string;
  env?: NodeJS.ProcessEnv;
  resume?: boolean;
  sessionId?: string | null;
  model?: string | null;
  teeOptions?: SpawnTeeOptions;
  slug?: MissionId | null;
  role?: SessionRole | null;
  maxTransientRetries?: number;
  /** Checked application port for session markers (architecture migration cutover). */
  sessionMarkerPort?: SessionMarkerPort;
}

// Injectable I/O for tests. Production uses the real spawn-tee / export capture.
let _spawnAndTee: AgentProcessSpawn = spawnAndTee;
let _captureExport: typeof captureOpencodeExport = captureOpencodeExport;
let _sessionPort: SessionMarkerPort | null = null;

// Test hooks: override the launcher's I/O without touching the public signature.
function __setSpawnAndTeeForTest(fn: AgentProcessSpawn | null) { _spawnAndTee = fn || spawnAndTee; }
function __setExportCaptureForTest(fn: typeof captureOpencodeExport | null) { _captureExport = fn || captureOpencodeExport; }
/** @deprecated Test compatibility hook; file-backed sessions are no longer used. */
function __setSessionsForTest(_mod: unknown) { /* no-op */ }
function __setSessionPortForTest(port: SessionMarkerPort | null) { _sessionPort = port; }

// Test hook: override the cached feature-detect for `--format json` support.
// Set to true/false to force inclusion/exclusion of the flag regardless of
// the real binary.  Pass null to reset to the live detect.
function __setJsonFormatSupportForTest(val: boolean | null) {
  _jsonFormatSupported = val;
  _jsonFormatDetectFn = null;
}

// Test hook: inject a feature-detect function for tests.  This replaces the
// live shell-out with a stubbed function, making tests hermetic.
function __setJsonFormatDetectForTest(fn: (() => boolean) | null) {
  _jsonFormatDetectFn = fn;
  _jsonFormatSupported = null;  // invalidate cache so the detect fn runs
}

// Session-id recovery for telemetry. After session completion `opencode export`
// is invoked to extract token-usage data (see opencode-telemetry.js), so the
// session id MUST be recoverable from the launcher's stdout. Stats hooks in
// active.js and review-loop.js call recordStageStats which defaults to '0' for
// tokens when telemetry is null.
//
// Two shapes are recognized:
//   1. Legacy footer:  "Continue  opencode -s ses_<id>"  (older opencode TUI).
//   2. JSON stream:     `"sessionID":"ses_<id>"`           (opencode v2.0.0
//      `run --format json`). v2.0.0's plain `run` no longer prints the footer,
//      so without the JSON field the id is lost and custom telemetry drops to all
//      zeros (architecture migration). We request `--format json` in buildOpencodeInvocation
//      so this field is always present.
const OPENCODE_SESSION_ID_RE = /opencode\s+-s\s+(ses_\S+)/i;
const OPENCODE_JSON_SESSION_ID_RE = /"sessionID"\s*:\s*"(ses_[^"]+)"/;

function extractOpencodeSessionId(stdout: string) {
  if (!stdout) {return null;}
  const footer = OPENCODE_SESSION_ID_RE.exec(stdout);
  if (footer) {return footer[1];}
  const json = OPENCODE_JSON_SESSION_ID_RE.exec(stdout);
  return json ? json[1] : null;
}

// Cached feature-detect for `--format json` support. Set to `false` only when
// a real invocation proves the flag is rejected (older opencode versions).
// Tests can inject a canned result via __setJsonFormatSupportForTest.
let _jsonFormatSupported: boolean | null = null;

// Injectable feature-detect function for tests.  When set, checkJsonFormatSupport(configuration)
// calls this function instead of shelling out, making tests hermetic.
let _jsonFormatDetectFn: (() => boolean) | null = null;

// Lightweight feature-detect: try `opencode --format json --help`.
// Returns true if the flag is accepted (exit 0 or non-zero for unrelated reasons),
// false if the flag itself is rejected ("unrecognized" / "unknown option").
// Results are cached so the check runs at most once in production.
// Tests can inject a canned result via __setJsonFormatSupportForTest.
function checkJsonFormatSupport(configuration: ParallixConfiguration) {
  if (_jsonFormatSupported !== null) {return _jsonFormatSupported;}
  if (_jsonFormatDetectFn) {
    _jsonFormatSupported = _jsonFormatDetectFn();
    return _jsonFormatSupported;
  }
  try {
    const result = spawnSync(resolveOpencodeCommand(configuration), ['--format', 'json', '--help'], {
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.status !== 0 || result.error || result.signal) { _jsonFormatSupported = false; return false; }
    _jsonFormatSupported = true;
    return true;
  } catch (_) {
    // ENOENT or other spawn errors → assume legacy (no JSON flag).
    _jsonFormatSupported = false;
    return false;
  }
}

function buildOpencodeInvocation({ configuration = DEFAULT_CONFIGURATION, prompt, worktree, env, resume = false, sessionId = null, model = null, preferJson = true }: BuildOpencodeInvocationOptions) {
  // `--format json` makes opencode stream NDJSON events that each carry a
  // "sessionID":"ses_..." field. opencode v2.0.0's default `run` output no
  // longer prints the "Continue  opencode -s ses_..." footer, so JSON is the
  // only reliable way to recover the session id needed for `opencode export`
  // telemetry capture (architecture migration).
  //
  // Compatibility guard: feature-detect the flag on first call; older opencode
  // versions that reject `--format json` will silently fall back to the legacy
  // invocation, preserving launch behaviour at the cost of telemetry.
  const useJson = preferJson && checkJsonFormatSupport(configuration);
  const args = ['run', '--pure', '--dangerously-skip-permissions'];
  if (useJson) {args.push('--format', 'json');}
  if (model) {args.push('-m', model);}
  // Only resume when the marker explicitly says so (resume=true).
  // sessionId from a stale cross-family marker must be ignored when resume=false.
  if (resume && sessionId) {
    args.push('-s', sessionId);
  } else if (resume) {
    args.push('--continue');
  }
  // Installed 0.0.0-dev-202605131349 run reads non-TTY Bun.stdin.text().
  return {
    command: resolveOpencodeCommand(configuration),
    args,
    options: {
      input: prompt,
      stdio: 'inherit',
      cwd: worktree,
      env: { ...configuration.forwardedEnvironment, ...env }
    }
  };
}

function processErrorCode(error: unknown) { return (error as { code?: unknown } | null)?.code; }

function isHardOpencodeFailure(result: AgentProcessResult) {
  if (!result) {return false;}
  if (result.error && (processErrorCode(result.error) === 'ENOENT' || processErrorCode(result.error) === 'EACCES')) {return true;}
  const code = recognizedFailureReason(result.failureReason)?.code;
  return code === 'provider-auth' || code === 'provider-config' || code === 'provider-entitlement';
}

// Opencode v2.0.0 JSON-mode sometimes exits with code 1 during post-run
// cleanup (race closing the stdout pipe, EPIPE, or draining pending events).
// When the transcript contains a valid "reason":"stop" completion event and
// no "type":"error" event, the exit is spurious – the agent actually
// completed successfully. See opencode issues #31446 and #33653.
function isSpuriousOpencodeExit(result: AgentProcessResult) {
  if (!result || result.status !== 1) {return false;}
  const events = [...providerEvents(result.stdout), ...providerEvents(result.stderr)];
  return events.some(event => event.reason === 'stop' || (event.part as { reason?: unknown } | undefined)?.reason === 'stop') && !events.some(event => event.type === 'error');
}

function isTransientOpencodeFailure(result: AgentProcessResult) {
  if (!result) {return false;}
  return recognizedFailureReason(result.failureReason)?.code === 'provider-unavailable';
}

// Decide whether a failed opencode run should be retried once in-family.
// Only genuine non-zero exits carrying a transient backend signature qualify;
// clean exits, spawn errors (ENOENT/EACCES), killing signals, limit-hits, and
// hard errors never retry — so real failures still surface to the reroute loop.
function shouldRetryOpencodeFailure(result: AgentProcessResult) {
  if (!result) {return false;}
  if (result.error && (processErrorCode(result.error) === 'ENOENT' || processErrorCode(result.error) === 'EACCES')) {return false;}
  if (result.signal) {return false;}
  if (!(typeof result.status === 'number' && result.status !== 0)) {return false;}
  // OpenCode owns one bounded same-family retry for typed transient backend
  // unavailability. If that retry also fails, startAgent receives the final
  // result and applies the checked provider block before family reselection.
  return isTransientOpencodeFailure(result);
}

function startOpencodeAgent({ configuration = DEFAULT_CONFIGURATION,
  prompt,
  worktree,
  env,
  resume = false,
  sessionId = null,
  model = null,
  teeOptions = {},
  slug = null,
  role = null,
  maxTransientRetries = 1,
  sessionMarkerPort
}: StartOpencodeAgentOptions) {
  // Prepend the subagent-limit advisory prefix to the prompt.
  // When maxParallel is unset/null/zero the prefix is empty (no-op).
  const subagentPrefix = buildSubagentLimitPrefix(undefined);
  const injectedPrompt = subagentPrefix + prompt;

  function isStaleSessionResult(result: AgentProcessResult) {
    // Adapter-owned parsing of OpenCode CLI diagnostics; never exposed as a workflow signal.
    if (!result) {return false;}
    return recognizedFailureReason(result.failureReason)?.code === 'provider-session-missing';
  }

  function runInvocation(invocation: ReturnType<typeof buildOpencodeInvocation>) {
    const spawnOptions = { ...invocation.options, ...teeOptions, configuration };
    return _spawnAndTee(invocation.command, invocation.args, spawnOptions);
  }

  async function runInvocationWithRetry(invocation: ReturnType<typeof buildOpencodeInvocation>) {
    let attempts = 0;
    let result = await runInvocation(invocation);
    while (attempts < maxTransientRetries && shouldRetryOpencodeFailure(result)) {
      attempts += 1;
      result = await runInvocation(invocation);
    }
    if (result) {result.transientRetries = attempts;}
    return result;
  }

  // Detect whether `--format json` was rejected at runtime (e.g. older opencode
  // that wasn't caught by the feature-detect).  If so, retry the invocation
  // without the flag so the prompt still runs (telemetry will be lost but the
  // agent won't fail outright).
  function isJsonFlagError(result: AgentProcessResult) {
    if (!result) {return false;}
    return recognizedFailureReason(result.failureReason)?.code === 'provider-config';
  }

  async function processResult(result: AgentProcessResult) {
    if (!result) { return result; }
    result.sessionId = result.stdout ? extractOpencodeSessionId(result.stdout) || undefined : result.sessionId;
    await addOpencodeTelemetry(result);
    return result;
  }

  async function addOpencodeTelemetry(result: AgentProcessResult): Promise<void> {
    if (!result.sessionId) { return; }
    try {
      const exportJson = await _captureExport(result.sessionId, { configuration, worktree, env });
      const telemetry = exportJson && extractOpencodeTelemetryFromExport(exportJson, model || undefined);
      if (!telemetry) { return; }
      result.telemetry = telemetry;
      result.model = telemetry.model || result.model;
      result.provider = telemetry.provider || result.provider;
    } catch { /* telemetry is best-effort */ }
  }

  async function runWithJsonFallback(invocation: ReturnType<typeof buildOpencodeInvocation>) {
    let result = await runInvocationWithRetry(invocation);
    // Runtime fallback: if the first invocation used --format json but the
    // binary rejected it, retry without the flag so the prompt still executes.
    if (isJsonFlagError(result) && invocation.args.includes('--format')) {
      const legacyInv = buildOpencodeInvocation({ configuration,
        prompt: injectedPrompt, worktree, env, resume, sessionId, model, preferJson: false,
      });
      result = await runInvocationWithRetry(legacyInv);
      // Mark that we fell back so callers know telemetry may be absent.
      if (result) {result._jsonFallback = true;}
    }
    return result;
  }

  async function staleSessionHandler(invocation: ReturnType<typeof buildOpencodeInvocation>) {
    let result = await runWithJsonFallback(invocation);
    if (isStaleSessionResult(result) && worktree && resume) {
      try {
        const port = sessionMarkerPort || _sessionPort;
        if (!port || !slug || !role) {
          throw new Error('Could not clear stale session marker: SessionMarkerPort is required');
        }
        await port.delete(slug, role);
      } catch (error) { throw error; }
      const freshInv = buildOpencodeInvocation({ configuration, prompt: injectedPrompt, worktree, env, resume: false, sessionId: null, model });
      result = await runWithJsonFallback(freshInv);
    }
    return processResult(result);
  }

  const invocation = buildOpencodeInvocation({ configuration, prompt: injectedPrompt, worktree, env, resume, sessionId, model });
  const resultPromise = staleSessionHandler(invocation);

  return { invocation, resultPromise };
}

export {
  buildOpencodeInvocation,
  extractOpencodeSessionId,
  resolveOpencodeCommand,
  startOpencodeAgent,
  isSpuriousOpencodeExit,
  isTransientOpencodeFailure,
  isHardOpencodeFailure,
  shouldRetryOpencodeFailure,
  __setSpawnAndTeeForTest,
  __setExportCaptureForTest,
  __setSessionsForTest,
  __setSessionPortForTest,
  __setJsonFormatSupportForTest,
  __setJsonFormatDetectForTest,
};
