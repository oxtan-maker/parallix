import { spawnAndTee } from '../core/spawn-tee.js';
import { extractOpencodeTelemetryFromExport } from './opencode-telemetry.js';
import { captureOpencodeExport } from './opencode-export.js';
import { detectLimitHit } from './limit-hit.js';
// tools/sessions and core/subagent-limit are still CJS (not converted in this
// wave); require keeps them untyped (any) without pulling non-included .js into
// the typecheck program.
const sessions = require('../tools/sessions');
const { buildSubagentLimitPrefix } = require('../core/subagent-limit');

interface BuildOpencodeInvocationOptions {
  prompt: string;
  worktree: string;
  env?: object;
  resume?: boolean;
  sessionId?: string | null;
  model?: string | null;
  preferJson?: boolean;
}

interface StartOpencodeAgentOptions {
  prompt: string;
  worktree: string;
  env?: object;
  resume?: boolean;
  sessionId?: string | null;
  model?: string | null;
  teeOptions?: object;
  slug?: string | null;
  role?: string | null;
  maxTransientRetries?: number;
}

// Injectable I/O for tests. Production uses the real spawn-tee / export capture.
let _spawnAndTee: any = spawnAndTee;
let _captureExport: any = captureOpencodeExport;
let _sessions: any = sessions;

// Test hooks: override the launcher's I/O without touching the public signature.
function __setSpawnAndTeeForTest(fn: any) { _spawnAndTee = fn || spawnAndTee; }
function __setExportCaptureForTest(fn: any) { _captureExport = fn || captureOpencodeExport; }
function __setSessionsForTest(mod: any) { _sessions = mod || sessions; }

// Test hook: override the cached feature-detect for `--format json` support.
// Set to true/false to force inclusion/exclusion of the flag regardless of
// the real binary.  Pass null to reset to the live detect.
function __setJsonFormatSupportForTest(val: boolean | null) {
  _jsonFormatSupported = val;
  _jsonFormatDetectFn = null;
}

// Test hook: inject a feature-detect function for tests.  This replaces the
// live shell-out with a stubbed function, making tests hermetic.
function __setJsonFormatDetectForTest(fn: any) {
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
//      zeros (task-1339). We request `--format json` in buildOpencodeInvocation
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

// Injectable feature-detect function for tests.  When set, checkJsonFormatSupport()
// calls this function instead of shelling out, making tests hermetic.
let _jsonFormatDetectFn: (() => any) | null = null;

function resolveOpencodeCommand() {
  return 'opencode';
}

// Lightweight feature-detect: try `opencode --format json --help`.
// Returns true if the flag is accepted (exit 0 or non-zero for unrelated reasons),
// false if the flag itself is rejected ("unrecognized" / "unknown option").
// Results are cached so the check runs at most once in production.
// Tests can inject a canned result via __setJsonFormatSupportForTest.
function checkJsonFormatSupport() {
  if (_jsonFormatSupported !== null) {return _jsonFormatSupported;}
  if (_jsonFormatDetectFn) {
    _jsonFormatSupported = _jsonFormatDetectFn();
    return _jsonFormatSupported;
  }
  try {
    const { spawnSync } = require('node:child_process');
    const result = spawnSync('opencode', ['--format', 'json', '--help'], {
      timeout: 3000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stderr = (result.stderr && result.stderr.toString()) || '';
    const combined = stderr;
    // Flag rejected → fallback to legacy invocation.
    if (/unrecognized|unknown option|no such option|invalid option/i.test(combined)) {
      _jsonFormatSupported = false;
      return false;
    }
    _jsonFormatSupported = true;
    return true;
  } catch (_) {
    // ENOENT or other spawn errors → assume legacy (no JSON flag).
    _jsonFormatSupported = false;
    return false;
  }
}

function buildOpencodeInvocation({ prompt, worktree, env, resume = false, sessionId = null, model = null, preferJson = true }: BuildOpencodeInvocationOptions) {
  // `--format json` makes opencode stream NDJSON events that each carry a
  // "sessionID":"ses_..." field. opencode v2.0.0's default `run` output no
  // longer prints the "Continue  opencode -s ses_..." footer, so JSON is the
  // only reliable way to recover the session id needed for `opencode export`
  // telemetry capture (task-1339).
  //
  // Compatibility guard: feature-detect the flag on first call; older opencode
  // versions that reject `--format json` will silently fall back to the legacy
  // invocation, preserving launch behaviour at the cost of telemetry.
  const useJson = preferJson && checkJsonFormatSupport();
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
  args.push(prompt);
  return {
    command: resolveOpencodeCommand(),
    args,
    options: {
      stdio: 'inherit',
      cwd: worktree,
      env: { ...process.env, ...env }
    }
  };
}

// Transient custom/vLLM backend failures that opencode surfaces as a non-zero
// exit. These are recoverable: the same prompt frequently succeeds on a second
// attempt, so the launcher retries once in-family before agents.js reroutes to a
// different agent family. Limit-hit phrases are intentionally NOT listed here —
// detectLimitHit() in agents.js owns that accounting (lib/agents/limit-hit.js).
// Hard errors (model-not-found, auth, ENOENT/EACCES) are never retried.
const TRANSIENT_OPENCODE_PATTERNS = [
  /\bECONNRESET\b/i,
  /\bECONNREFUSED\b/i,
  /\bETIMEDOUT\b/i,
  /\bENETUNREACH\b/i,
  /\bENOTFOUND\b/i,
  /\bEAI_AGAIN\b/i,
  /\bEPIPE\b/i,
  /socket hang ?up/i,
  /\bfetch failed\b/i,
  /network (?:error|timeout)/i,
  /connection (?:error|reset|closed|refused|timed? ?out)/i,
  /\b(?:502|503|504|529)\b/,
  /\bbad gateway\b/i,
  /\bservice (?:is )?unavailable\b/i,
  /\bgateway time-?out\b/i,
  /\b(?:server |api |model )?overloaded\b/i,
  /\btemporarily unavailable\b/i,
  /\bplease (?:try|retry) again\b/i,
  /\bretry[- ]after\b/i,
];

// Hard, non-retryable failures: retrying cannot help and only wastes time/quota.
const HARD_OPENCODE_PATTERNS = [
  /\bmodel not found\b/i,
  /\bno such model\b/i,
  /\bunknown model\b/i,
  /\binvalid (?:api )?key\b/i,
  /\b401\b[^\n]*\bunauthorized\b/i,
  /\bauthentication (?:failed|error)\b/i,
];

function failureText(result: any) {
  return `${(result && result.stdout) || ''}\n${(result && result.stderr) || ''}`;
}

function isHardOpencodeFailure(result: any) {
  if (!result) {return false;}
  if (result.error && (result.error.code === 'ENOENT' || result.error.code === 'EACCES')) {return true;}
  const text = failureText(result);
  return HARD_OPENCODE_PATTERNS.some((re) => re.test(text));
}

// Opencode v2.0.0 JSON-mode sometimes exits with code 1 during post-run
// cleanup (race closing the stdout pipe, EPIPE, or draining pending events).
// When the transcript contains a valid "reason":"stop" completion event and
// no "type":"error" event, the exit is spurious – the agent actually
// completed successfully. See opencode issues #31446 and #33653.
function isSpuriousOpencodeExit(result: any) {
  if (!result || result.status !== 1) {return false;}
  const text = failureText(result);
  const hasStop = /"reason"\s*:\s*"stop"/.test(text);
  const hasError = /"type"\s*:\s*"error"/.test(text);
  return hasStop && !hasError;
}

function isTransientOpencodeFailure(result: any) {
  if (!result) {return false;}
  const text = failureText(result);
  return TRANSIENT_OPENCODE_PATTERNS.some((re) => re.test(text));
}

// Decide whether a failed opencode run should be retried once in-family.
// Only genuine non-zero exits carrying a transient backend signature qualify;
// clean exits, spawn errors (ENOENT/EACCES), killing signals, limit-hits, and
// hard errors never retry — so real failures still surface to the reroute loop.
function shouldRetryOpencodeFailure(result: any) {
  if (!result) {return false;}
  if (result.error && (result.error.code === 'ENOENT' || result.error.code === 'EACCES')) {return false;}
  if (result.signal) {return false;}
  if (!(typeof result.status === 'number' && result.status !== 0)) {return false;}
  if (detectLimitHit({
    agent: 'custom',
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status,
    signal: result.signal,
    error: result.error,
  })) {return false;}
  if (isHardOpencodeFailure(result)) {return false;}
  return isTransientOpencodeFailure(result);
}

function startOpencodeAgent({
  prompt,
  worktree,
  env,
  resume = false,
  sessionId = null,
  model = null,
  teeOptions = {},
  slug = null,
  role = null,
  maxTransientRetries = 1
}: StartOpencodeAgentOptions) {
  // Prepend the subagent-limit advisory prefix to the prompt.
  // When maxParallel is unset/null/zero the prefix is empty (no-op).
  const subagentPrefix = buildSubagentLimitPrefix();
  const injectedPrompt = subagentPrefix + prompt;

  function isStaleSessionResult(result: any) {
    if (!result) {return false;}
    const stderr = result.stderr || '';
    const stdout = result.stdout || '';
    return stderr.includes('Session not found') || stdout.includes('Session not found');
  }

  function runInvocation(invocation: any) {
    const spawnOptions = { ...invocation.options, ...teeOptions };
    return _spawnAndTee(invocation.command, invocation.args, spawnOptions);
  }

  async function runInvocationWithRetry(invocation: any) {
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
  function isJsonFlagError(result: any) {
    if (!result) {return false;}
    const text = failureText(result);
    return (/\bunrecognized option\b|\bunknown option\b|\bno such option\b|\binvalid option\b|\bunrecognized flag\b|\bunknown flag\b/i).test(text);
  }

  async function processResult(result: any) {
    if (result && result.stdout) {
      result.sessionId = extractOpencodeSessionId(result.stdout) || undefined;
    }
    if (result && result.sessionId) {
      try {
        const exportJson = await _captureExport(result.sessionId, { worktree, env });
        if (exportJson) {
          const telemetry = extractOpencodeTelemetryFromExport(exportJson, model || undefined);
          if (telemetry) {
            result.telemetry = telemetry;
            if ((telemetry as any).model) {result.model = (telemetry as any).model;}
            if ((telemetry as any).provider) {result.provider = (telemetry as any).provider;}
          }
        }
      } catch (_) {
        return result;
      }
    }
    return result;
  }

  async function runWithJsonFallback(invocation: any) {
    let result = await runInvocationWithRetry(invocation);
    // Runtime fallback: if the first invocation used --format json but the
    // binary rejected it, retry without the flag so the prompt still executes.
    if (isJsonFlagError(result) && invocation.args.includes('--format')) {
      const legacyInv = buildOpencodeInvocation({
        prompt: injectedPrompt, worktree, env, resume, sessionId, model, preferJson: false,
      });
      result = await runInvocationWithRetry(legacyInv);
      // Mark that we fell back so callers know telemetry may be absent.
      if (result) {result._jsonFallback = true;}
    }
    return result;
  }

  async function staleSessionHandler(invocation: any) {
    let result = await runWithJsonFallback(invocation);
    if (isStaleSessionResult(result) && worktree && resume) {
      try {
        _sessions.clearSession(worktree, slug || '', role || '');
      } catch (_) { /* best-effort */ }
      const freshInv = buildOpencodeInvocation({ prompt: injectedPrompt, worktree, env, resume: false, sessionId: null, model });
      result = await runWithJsonFallback(freshInv);
    }
    return processResult(result);
  }

  const invocation = buildOpencodeInvocation({ prompt: injectedPrompt, worktree, env, resume, sessionId, model });
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
  __setJsonFormatSupportForTest,
  __setJsonFormatDetectForTest,
};
