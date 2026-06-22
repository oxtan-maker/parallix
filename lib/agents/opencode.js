const { spawnAndTee } = require('../core/spawn-tee');
const { extractOpencodeTelemetryFromExport } = require('./opencode-telemetry');
const { captureOpencodeExport } = require('./opencode-export');
const sessions = require('../tools/sessions');
const { detectLimitHit } = require('./limit-hit');

// Injectable I/O for tests. Production uses the real spawn-tee / export capture.
let _spawnAndTee = spawnAndTee;
let _captureExport = captureOpencodeExport;
let _sessions = sessions;

// Test hooks: override the launcher's I/O without touching the public signature.
function __setSpawnAndTeeForTest(fn) { _spawnAndTee = fn || spawnAndTee; }
function __setExportCaptureForTest(fn) { _captureExport = fn || captureOpencodeExport; }
function __setSessionsForTest(mod) { _sessions = mod || sessions; }

// Opencode outputs "Continue  opencode -s ses_<id>" at the end.
// Telemetry: after session completion, `opencode export` is invoked to extract
// token-usage data. See opencode-telemetry.js for the parser.
// Stats hooks in active.js and review-loop.js call recordStageStats which
// defaults to '0' for tokens when telemetry is null.
const OPENCODE_SESSION_ID_RE = /opencode\s+-s\s+(ses_\S+)/i;

function extractOpencodeSessionId(stdout) {
  if (!stdout) return null;
  const m = OPENCODE_SESSION_ID_RE.exec(stdout);
  return m ? m[1] : null;
}

function resolveOpencodeCommand() {
  return 'opencode';
}

function buildOpencodeInvocation({ prompt, worktree, env, resume = false, sessionId = null, model = null }) {
  const args = ['run', '--pure', '--dangerously-skip-permissions'];
  if (model) args.push('-m', model);
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

// Transient qwen/vLLM backend failures that opencode surfaces as a non-zero
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

function failureText(result) {
  return `${(result && result.stdout) || ''}\n${(result && result.stderr) || ''}`;
}

function isHardOpencodeFailure(result) {
  if (!result) return false;
  if (result.error && (result.error.code === 'ENOENT' || result.error.code === 'EACCES')) return true;
  const text = failureText(result);
  return HARD_OPENCODE_PATTERNS.some((re) => re.test(text));
}

function isTransientOpencodeFailure(result) {
  if (!result) return false;
  const text = failureText(result);
  return TRANSIENT_OPENCODE_PATTERNS.some((re) => re.test(text));
}

// Decide whether a failed opencode run should be retried once in-family.
// Only genuine non-zero exits carrying a transient backend signature qualify;
// clean exits, spawn errors (ENOENT/EACCES), killing signals, limit-hits, and
// hard errors never retry — so real failures still surface to the reroute loop.
function shouldRetryOpencodeFailure(result) {
  if (!result) return false;
  if (result.error && (result.error.code === 'ENOENT' || result.error.code === 'EACCES')) return false;
  if (result.signal) return false;
  if (!(typeof result.status === 'number' && result.status !== 0)) return false;
  if (detectLimitHit({
    agent: 'qwen',
    stdout: result.stdout,
    stderr: result.stderr,
    status: result.status,
    signal: result.signal,
    error: result.error,
  })) return false;
  if (isHardOpencodeFailure(result)) return false;
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
}) {
  function isStaleSessionResult(result) {
    if (!result) return false;
    const stderr = result.stderr || '';
    const stdout = result.stdout || '';
    return stderr.includes('Session not found') || stdout.includes('Session not found');
  }

  function runInvocation(invocation) {
    const spawnOptions = { ...invocation.options, ...teeOptions };
    return _spawnAndTee(invocation.command, invocation.args, spawnOptions);
  }

  async function runInvocationWithRetry(invocation) {
    let attempts = 0;
    let result = await runInvocation(invocation);
    while (attempts < maxTransientRetries && shouldRetryOpencodeFailure(result)) {
      attempts += 1;
      result = await runInvocation(invocation);
    }
    if (result) result.transientRetries = attempts;
    return result;
  }

  async function processResult(result) {
    if (result && result.stdout) {
      result.sessionId = extractOpencodeSessionId(result.stdout);
    }
    if (result && result.sessionId) {
      try {
        const exportJson = await _captureExport(result.sessionId, { worktree, env });
        if (exportJson) {
          const telemetry = extractOpencodeTelemetryFromExport(exportJson);
          if (telemetry) {
            result.telemetry = telemetry;
            if (telemetry.model) result.model = telemetry.model;
            if (telemetry.provider) result.provider = telemetry.provider;
          }
        }
      } catch (_) {
        return result;
      }
    }
    return result;
  }

  async function staleSessionHandler(invocation) {
    let result = await runInvocationWithRetry(invocation);
    if (isStaleSessionResult(result) && worktree && resume) {
      try {
        _sessions.clearSession(worktree, slug, role);
      } catch (_) { /* best-effort */ }
      const freshInv = buildOpencodeInvocation({ prompt, worktree, env, resume: false, sessionId: null, model });
      result = await runInvocationWithRetry(freshInv);
    }
    return processResult(result);
  }

  const invocation = buildOpencodeInvocation({ prompt, worktree, env, resume, sessionId, model });
  const resultPromise = staleSessionHandler(invocation);

  return { invocation, resultPromise };
}

module.exports = {
  buildOpencodeInvocation,
  extractOpencodeSessionId,
  resolveOpencodeCommand,
  startOpencodeAgent,
  isTransientOpencodeFailure,
  isHardOpencodeFailure,
  shouldRetryOpencodeFailure,
  __setSpawnAndTeeForTest,
  __setExportCaptureForTest,
  __setSessionsForTest
};
