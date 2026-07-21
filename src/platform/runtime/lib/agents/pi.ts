import { spawnAndTee } from '../core/spawn-tee.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as sessions from '../tools/sessions.js';
import { buildSubagentLimitPrefix } from '../core/subagent-limit.js';

interface BuildPiInvocationOptions {
  prompt: string;
  worktree: string;
  env?: object;
  resume?: boolean;
  sessionId?: string | null;
  model?: string | null;
}

interface StartPiAgentOptions {
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

// Injectable I/O for tests. Production uses the real spawn-tee.
let _spawnAndTee: any = spawnAndTee;
let _sessions: any = sessions;

// Test hooks: override the launcher's I/O without touching the public signature.
function __setSpawnAndTeeForTest(fn: any) { _spawnAndTee = fn || spawnAndTee; }
function __setSessionsForTest(mod: any) { _sessions = mod || sessions; }

function piCommandCandidates() {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const pushCandidate = (candidate?: string | null) => {
    if (!candidate || seen.has(candidate)) {return;}
    seen.add(candidate);
    candidates.push(candidate);
  };

  pushCandidate(process.env.PI_BIN);
  // Pi is commonly installed globally through nvm. Agent launchers may keep
  // NVM_BIN while narrowing PATH to their own tool directory, so retain this
  // absolute candidate instead of losing the real runner at that boundary.
  if (process.env.NVM_BIN) {
    pushCandidate(path.join(process.env.NVM_BIN, 'pi'));
  }
  // A process launched by an nvm-managed Node binary can lose both PATH and
  // NVM_BIN at an agent boundary. Pi's global nvm install lives alongside
  // that Node binary, so this keeps the production launcher self-contained.
  pushCandidate(path.join(path.dirname(process.execPath), 'pi'));
  pushCandidate('pi');
  pushCandidate(path.join(os.homedir(), '.local', 'bin', 'pi'));
  pushCandidate('/usr/local/bin/pi');
  pushCandidate('/opt/pi/bin/pi');

  return candidates;
}

function resolveExistingCommand(candidate: string) {
  if (!candidate) {return null;}
  if (candidate.includes(path.sep)) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch (_) {
      return null;
    }
  }

  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const dir of dirs) {
    if (!dir) {continue;}
    const commandPath = path.join(dir, candidate);
    try {
      fs.accessSync(commandPath, fs.constants.X_OK);
      return candidate;
    } catch (_) { /* keep looking */ }
  }
  return null;
}

function resolvePiCommand() {
  for (const candidate of piCommandCandidates()) {
    const resolved = resolveExistingCommand(candidate);
    if (resolved) {return resolved;}
  }
  return 'pi';
}

// Real pi CLI contract (verified against `pi --help` on
// @earendil-works/pi-coding-agent@0.80.6): non-interactive one-shot mode is
// `--print`/`-p`, machine-readable output is `--mode json` (emits a JSON
// line per event, including a { type: "session", id } header and real
// per-message token usage), and non-interactive runs never show a trust
// prompt but still need `--approve` to load project-local settings/skills.
// There is no `ask` subcommand and no `--quiet` flag on the real CLI.
function buildPiInvocation({ prompt, worktree, env, resume = false, sessionId = null, model = null }: BuildPiInvocationOptions) {
  const args = ['--print', '--mode', 'json', '--approve'];

  if (model) {
    args.push('--model', model);
  }

  if (resume && sessionId) {
    // Reuses the exact session id, creating it if it no longer exists.
    args.push('--session-id', sessionId);
  } else if (resume) {
    args.push('--continue');
  }

  // Prompt is a positional argument.
  args.push(prompt);

  return {
    command: resolvePiCommand(),
    args,
    options: {
      stdio: 'inherit',
      cwd: worktree,
      env: { ...process.env, ...env }
    }
  };
}

// Transient failures that Pi may surface - similar to opencode patterns
const TRANSIENT_PI_PATTERNS = [
  /\bECONNRESET\b/i,
  /\bECONNREFUSED\b/i,
  /\bETIMEDOUT\b/i,
  /\bENETUNREACH\b/i,
  /\bENOTFOUND\b/i,
  /\bEAI_AGAIN\b/i,
  /\bEPIPE\b/i,
  /socket hang ?up/i,
  /fetch failed/i,
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

// Hard, non-retryable failures for Pi
const HARD_PI_PATTERNS = [
  /\bmodel not found\b/i,
  /\bno such model\b/i,
  /\bunknown model\b/i,
  /\binvalid (?:api )?key\b/i,
  /\b401\b[^\n]*\bunauthorized\b/i,
  /\bauthentication (?:failed|error)\b/i,
  /\bpermission denied\b/i,
];

function failureText(result: any) {
  return `${(result && result.stdout) || ''}\n${(result && result.stderr) || ''}`;
}

function isHardPiFailure(result: any) {
  if (!result) {return false;}
  if (result.error && (result.error.code === 'ENOENT' || result.error.code === 'EACCES')) {return true;}
  const text = failureText(result);
  return HARD_PI_PATTERNS.some((re) => re.test(text));
}

function isTransientPiFailure(result: any) {
  if (!result) {return false;}
  const text = failureText(result);
  return TRANSIENT_PI_PATTERNS.some((re) => re.test(text));
}

function shouldRetryPiFailure(result: any) {
  if (!result) {return false;}
  if (result.error && (result.error.code === 'ENOENT' || result.error.code === 'EACCES')) {return false;}
  if (result.signal) {return false;}
  if (!(typeof result.status === 'number' && result.status !== 0)) {return false;}
  return isTransientPiFailure(result);
}

// With --mode json, the first stdout line is a session header:
// {"type":"session","version":3,"id":"uuid","timestamp":"...","cwd":"/path"}
// (see @earendil-works/pi-coding-agent docs/json.md). Parsed defensively
// since a hard failure before the header (e.g. bad flags) leaves no JSON.
function extractPiSessionId(stdout: string) {
  if (!stdout) {return null;}
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) {continue;}
    try {
      const event = JSON.parse(trimmed);
      if (event && event.type === 'session' && typeof event.id === 'string') {
        return event.id;
      }
    } catch (_) { /* not a JSON line, or not the header — keep scanning */ }
  }
  return null;
}

// Extracts real token usage from the last assistant message_end/agent_end
// event's `usage` field in the --mode json stream. Unlike opencode (which
// requires a separate `export` step), pi's JSON stream carries usage and
// model/provider identity per-message, so this is derived directly from
// captured stdout. Shape matches lib/commands/stats.ts's telemetryToStatsFields
// (camelCase: provider, model, inputTokens, outputTokens, cachedTokens,
// totalTokens, toolCalls), mirroring extractOpencodeTelemetryFromExport.
function extractPiTelemetry(stdout: string) {
  if (!stdout) {return null;}
  let lastUsage: any = null;
  let lastModel: string | undefined;
  let toolCalls = 0;
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) {continue;}
    let event: any;
    try {
      event = JSON.parse(trimmed);
    } catch (_) {
      continue;
    }
    if (event.type === 'tool_execution_end') {toolCalls += 1;}
    const message = event && (event.message || (event.messages && event.messages[event.messages.length - 1]));
    if (message && message.role === 'assistant' && message.usage) {
      lastUsage = message.usage;
      lastModel = message.model || lastModel;
    }
  }
  if (!lastUsage) {return null;}
  // Pi's usage shape varies by backend: some report {input, output, total},
  // others use {prompt_tokens, completion_tokens, total_tokens}. Normalize to
  // the telemetry convention expected by stats.ts (inputTokens, outputTokens).
  const rawInput = lastUsage.input ?? lastUsage.prompt_tokens;
  const rawOutput = lastUsage.output ?? lastUsage.completion_tokens;
  const rawTotal = lastUsage.totalTokens ?? lastUsage.total ?? lastUsage.prompt_tokens + lastUsage.completion_tokens;
  const inputTokens = Number(rawInput) || (rawTotal !== null && Number(rawInput) === 0
    ? Math.floor(Number(rawTotal) * 0.6) // fallback: estimate input as ~60% of total
    : 0);
  return {
    // Provider is the launcher identity ("pi"), matching opencode-telemetry's
    // convention of reporting the launcher name rather than the underlying
    // backend (e.g. "vllm") — keeps stats attributable to which runner Parallix
    // actually invoked, distinct from opencode's rows even against the same model.
    provider: 'pi',
    model: lastModel,
    inputTokens,
    outputTokens: Number(rawOutput) || 0,
    cachedTokens: Number(lastUsage.cacheRead) || 0,
    totalTokens: Number(rawTotal) || 0,
    toolCalls,
    usagePercent: null
  };
}

function startPiAgent({
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
}: StartPiAgentOptions) {
  // Prepend the subagent-limit advisory prefix to the prompt.
  const subagentPrefix = buildSubagentLimitPrefix(undefined);
  const injectedPrompt = subagentPrefix + prompt;

  function isStaleSessionResult(result: any) {
    if (!result) {return false;}
    const stderr = result.stderr || '';
    const stdout = result.stdout || '';
    return stderr.includes('Conversation not found') || stdout.includes('Conversation not found') ||
           stderr.includes('Session not found') || stdout.includes('Session not found');
  }

  function runInvocation(invocation: any) {
    // spawn-tee's default 64KB tail buffer silently truncates result.stdout
    // to its LAST 64KB. That's fine for opencode (telemetry comes from a
    // separate bounded `opencode export`), but pi's --mode json stream emits
    // a JSON event per token/delta, not per message, so a real multi-turn
    // session routinely exceeds 64KB by orders of magnitude (observed: 18.6MB
    // for one draft run). With the default tail, both the session-id header
    // (first line) and every tool_execution_end event from early in the
    // session get silently dropped from result.stdout — extractPiSessionId
    // and extractPiTelemetry's toolCalls then read 0/null despite the run
    // having genuinely used tools, because only the final assistant message's
    // usage (near the true end of the stream) survives the tail window. A
    // much larger cap keeps this a soft bound rather than a routine truncation.
    const spawnOptions = { maxTailBytes: 32 * 1024 * 1024, ...invocation.options, ...teeOptions };
    return _spawnAndTee(invocation.command, invocation.args, spawnOptions);
  }

  async function runInvocationWithRetry(invocation: any) {
    let attempts = 0;
    let result = await runInvocation(invocation);
    while (attempts < maxTransientRetries && shouldRetryPiFailure(result)) {
      attempts += 1;
      result = await runInvocation(invocation);
    }
    if (result) {result.transientRetries = attempts;}
    return result;
  }

  function isUnrecognizedFlagError(result: any) {
    if (!result) {return false;}
    const text = failureText(result);
    return (/\bunrecognized option\b|\bunknown option\b|\bno such option\b|\binvalid option\b|\bunrecognized flag\b|\bunknown flag\b/i).test(text);
  }

  async function processResult(result: any) {
    if (result && result.stdout) {
      result.sessionId = extractPiSessionId(result.stdout) || undefined;
      const telemetry = extractPiTelemetry(result.stdout);
      if (telemetry) {
        result.telemetry = telemetry;
        if (telemetry.model) {result.model = telemetry.model;}
        if (telemetry.provider) {result.provider = telemetry.provider;}
      }
    }
    return result;
  }

  async function runWithFallback(invocation: any) {
    let result = await runInvocationWithRetry(invocation);
    // Runtime fallback: if the first invocation used flags that Pi doesn't support,
    // retry without those flags
    if (isUnrecognizedFlagError(result) && invocation.args.includes('--continue')) {
      const legacyInv = buildPiInvocation({
        prompt: injectedPrompt, worktree, env, resume: false, sessionId: null, model,
      });
      result = await runInvocationWithRetry(legacyInv);
    }
    return result;
  }

  async function staleSessionHandler(invocation: any) {
    let result = await runWithFallback(invocation);
    if (isStaleSessionResult(result) && worktree && resume) {
      try {
        _sessions.clearSession(worktree, slug || '', role || '');
      } catch (_) { /* best-effort */ }
      const freshInv = buildPiInvocation({ prompt: injectedPrompt, worktree, env, resume: false, sessionId: null, model });
      result = await runWithFallback(freshInv);
    }
    return processResult(result);
  }

  const invocation = buildPiInvocation({ prompt: injectedPrompt, worktree, env, resume, sessionId, model });
  const resultPromise = staleSessionHandler(invocation);

  return { invocation, resultPromise };
}

export {
  buildPiInvocation,
  extractPiSessionId,
  extractPiTelemetry,
  resolvePiCommand,
  startPiAgent,
  isHardPiFailure,
  isTransientPiFailure,
  shouldRetryPiFailure,
  __setSpawnAndTeeForTest,
  __setSessionsForTest,
};
