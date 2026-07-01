import { spawnAndTee } from '../core/spawn-tee.js';
import { extractClaudeTelemetryFromStdout } from './claude-telemetry.js';
import { createRequire } from 'node:module';
// tools/sessions is still CJS (not converted in this wave); require keeps it
// untyped (any) without pulling a non-included .js into the typecheck program.
const _require = createRequire(__filename);
const sessions = _require('../tools/sessions');

interface ClaudeInvocationOptions {
  prompt: string;
  worktree: string;
  env?: object;
  resume?: boolean;
  sessionId?: string | null;
  model?: string | null;
}

interface StartClaudeAgentOptions extends ClaudeInvocationOptions {
  teeOptions?: object;
  slug?: string | null;
  role?: string | null;
}

// Injectable I/O for tests. Production uses the real spawn-tee / export capture.
let _spawnAndTee: any = spawnAndTee;
let _sessions: any = sessions;

// Test hooks: override the launcher's I/O without touching the public signature.
function __setSpawnAndTeeForTest(fn: any) { _spawnAndTee = fn || spawnAndTee; }
function __setSessionsForTest(mod: any) { _sessions = mod || sessions; }

// Claude usage telemetry is parsed from the `stream-json` stdout stream, which
// carries `message_start` (input) and `message_delta` (output) usage events. The
// leading `message_start` (with input_tokens) sits at the very start of the
// stream, so the spawn-tee tail buffer must be large enough to retain it for a
// full mission-scale invocation rather than the 64 KiB limit-hit default.
const CLAUDE_TELEMETRY_TAIL_BYTES = 8 * 1024 * 1024;

// Claude outputs "Resume this session with: claude --resume <id>" at the end.
const CLAUDE_SESSION_ID_RE = /claude\s+--resume\s+([0-9a-f-]+)/i;

function extractClaudeSessionIdFromStreamJson(stdout: string) {
  if (!stdout) {return null;}
  const lines = stdout.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) {continue;}
    try {
      const evt = JSON.parse(trimmed);
      // stream-json 'result' events carry session_id at the top level.
      if (evt.type === 'result' && evt.session_id) {return evt.session_id;}
    } catch {
      /* not JSON — skip */
    }
  }
  return null;
}

function extractClaudeSessionId(stdout: string) {
  if (!stdout) {return null;}
  // Try stream-json result event first (new default format).
  const fromStream = extractClaudeSessionIdFromStreamJson(stdout);
  if (fromStream) {return fromStream;}
  // Fall back to legacy plain-text regex.
  const m = CLAUDE_SESSION_ID_RE.exec(stdout);
  return m ? m[1] : null;
}

function resolveClaudeCommand() {
  return 'claude';
}

function buildClaudeInvocation({ prompt, worktree, env, resume = false, sessionId = null, model = null }: ClaudeInvocationOptions) {
  const args = ['--dangerously-skip-permissions'];
  if (model) {args.push('--model', model);}
  // Only resume when the marker explicitly says so (resume=true).
  // sessionId from a stale cross-family marker must be ignored when resume=false.
  if (resume && sessionId) {
    args.push('--resume', sessionId);
  } else if (resume) {
    args.push('--continue');
  }
  // Stream human-readable intermediate progress via stream-json events.
  // The spawn-tee tee mechanism forwards these JSONL events to the terminal
  // in real time so the operator sees tool calls and assistant text as they
  // happen, rather than waiting for the final result.
  // --include-partial-messages is required: without it, the assistant event
  // contains the full response at once and no intermediate progress is emitted.
  args.push('--output-format', 'stream-json', '--verbose', '--include-partial-messages');
  args.push('-p', prompt);
  return {
    command: resolveClaudeCommand(),
    args,
    options: {
      stdio: 'inherit',
      cwd: worktree,
      env: { ...process.env, ...env }
    }
  };
}

function startClaudeAgent({ prompt, worktree, env, resume = false, sessionId = null, model = null, teeOptions = {}, slug = null, role = null }: StartClaudeAgentOptions) {
  function isStaleSessionResult(result: any) {
    if (!result) {return false;}
    const stderr = result.stderr || '';
    const stdout = result.stdout || '';
    return (stderr.includes('Session not found') || stdout.includes('Session not found'));
  }

  function processResult(result: any) {
    if (result && result.stdout) {
      result.sessionId = extractClaudeSessionId(result.stdout);
      try {
        const telemetry = extractClaudeTelemetryFromStdout(result.stdout);
        if (telemetry) {
          result.telemetry = telemetry;
          if (telemetry.model) {result.model = telemetry.model;}
          if (telemetry.provider) {result.provider = telemetry.provider;}
        }
      } catch (_) {
        // Telemetry is best-effort; never let it break the launch result.
      }
    }
    return result;
  }

  function staleSessionHandler(invocation: any) {
    const teeWithTail = { maxTailBytes: CLAUDE_TELEMETRY_TAIL_BYTES, ...invocation.options, ...teeOptions };
    return _spawnAndTee(invocation.command, invocation.args, teeWithTail)
      .then((result: any) => {
        if (isStaleSessionResult(result) && worktree && resume) {
          try {
            _sessions.clearSession(worktree, slug, role);
          } catch (_) { /* best-effort */ }
          const freshInv = buildClaudeInvocation({ prompt, worktree, env, resume: false, sessionId: null, model });
          const freshTee = { maxTailBytes: CLAUDE_TELEMETRY_TAIL_BYTES, ...freshInv.options, ...teeOptions };
          return _spawnAndTee(freshInv.command, freshInv.args, freshTee);
        }
        return result;
      })
      .then(processResult);
  }

  const invocation = buildClaudeInvocation({ prompt, worktree, env, resume, sessionId, model });
  const resultPromise = staleSessionHandler(invocation);

  return { invocation, resultPromise };
}

export {
  buildClaudeInvocation,
  extractClaudeSessionId,
  extractClaudeTelemetryFromStdout,
  resolveClaudeCommand,
  startClaudeAgent,
  __setSpawnAndTeeForTest,
  __setSessionsForTest
};
