import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { MissionId } from '../../domain/mission.js';
import type { SessionRole } from '../../domain/session.js';
import type { SessionMarkerPort } from '../../application/domain-ports.js';
import { buildSubagentLimitPrefix } from './subagent-limit.js';
import { createAgentStreamRenderer, type AgentStreamRenderer, type RenderSink } from './agent-stream-view.js';
import { createOutputWatchdog, type NoOutputWatchdog } from '../process/output-watchdog.js';
import { PiStreamNormalizer } from './pi-stream-render.js';
import { finiteOrNull } from './agent-stream-events.js';

interface BuildPiInvocationOptions {
  prompt: string;
  worktree: string;
  env?: object;
  resume?: boolean;
  sessionId?: string | null;
  model?: string | null;
}

interface PiTeeOptions {
  stdoutSink?: RenderSink;
  noOutputWatchdog?: NoOutputWatchdog | null;
}

interface StartPiAgentOptions {
  prompt: string;
  worktree: string;
  env?: object;
  resume?: boolean;
  sessionId?: string | null;
  model?: string | null;
  teeOptions?: PiTeeOptions;
  slug?: MissionId | null;
  role?: SessionRole | null;
  maxTransientRetries?: number;
  /** Checked application port for session markers (architecture migration cutover). */
  sessionMarkerPort?: SessionMarkerPort;
}

// Lazily-loaded SDK, using native dynamic import to avoid startup cost.
// The import evaluates the SDK module graph on the calling tick (synchronous
// event-loop block, ~1 s on a cold host), so deadline-sensitive paths must
// warm the cache before their clock starts (warmPiSdk from launch prepare).
let _sdk: any = null;
let _sdkImport: Promise<any> | null = null;
function sdkImport(): Promise<any> {
  if (_sdkImport) { return _sdkImport; }
  const pending: Promise<any> = new Function('p', 'return import(p)')('@earendil-works/pi-coding-agent')
    .then((mod: any) => { _sdk = mod; return mod; })
    .catch((err: unknown) => { _sdkImport = null; throw err; });
  _sdkImport = pending;
  return pending;
}
async function loadSdk() {
  if (!_sdk) { _sdk = await sdkImport(); }
  return _sdk;
}
/**
 * Warm the lazy SDK cache (idempotent; one in-flight import per process).
 * Swallows failures: a failed warm leaves the cache cold, and the launcher's
 * own load surfaces the real error as a launch failure.
 */
export function warmPiSdk(): Promise<void> {
  return sdkImport().then(() => undefined, () => undefined);
}

// Injectable SDK for tests. Production uses the real createAgentSession.
let _createAgentSession: any = null;
let _sessionPort: SessionMarkerPort | null = null;

// Test hooks: override the launcher's I/O without touching the public signature.
function __setCreateAgentSessionForTest(fn: any) { _createAgentSession = fn || null; }
function __setSessionPortForTest(port: SessionMarkerPort | null) { _sessionPort = port; }
function __setSdkForTest(sdk: any) { _sdk = sdk || null; }
// Legacy test hook retained for backward compatibility (pi.ts no longer uses file-based sessions).
function __setSessionsForTest(_mod: any) { /* no-op: pi.ts uses SessionMarkerPort */ }

function piCommandCandidates() {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const pushCandidate = (candidate?: string | null) => {
    if (!candidate || seen.has(candidate)) { return; }
    seen.add(candidate);
    candidates.push(candidate);
  };

  pushCandidate(process.env.PI_BIN);
  if (process.env.NVM_BIN) {
    pushCandidate(path.join(process.env.NVM_BIN, 'pi'));
  }
  pushCandidate(path.join(path.dirname(process.execPath), 'pi'));
  pushCandidate('pi');
  pushCandidate(path.join(os.homedir(), '.local', 'bin', 'pi'));
  pushCandidate('/usr/local/bin/pi');
  pushCandidate('/opt/pi/bin/pi');

  return candidates;
}

function resolveExistingCommand(candidate: string) {
  if (!candidate) { return null; }
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
    if (!dir) { continue; }
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
    if (resolved) { return resolved; }
  }
  return 'pi';
}

function buildPiInvocation({ prompt, worktree, env, resume = false, sessionId = null, model = null }: BuildPiInvocationOptions) {
  const args: string[] = ['--print', '--mode', 'json', '--approve'];

  if (model) {
    args.push('--model', model);
  }

  if (resume && sessionId) {
    args.push('--session-id', sessionId);
  } else if (resume) {
    args.push('--continue');
  }

  args.push(prompt);

  return {
    command: resolvePiCommand(),
    args,
    options: {
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

function isTransientPiFailure(error: any) {
  if (!error) { return false; }
  const text = `${error.stdout || ''}\n${error.stderr || ''}`;
  return TRANSIENT_PI_PATTERNS.some((re) => re.test(text));
}

/** Extract telemetry from SDK session stats. */
function extractTelemetryFromStats(stats: any, model?: string) {
  if (!stats || !stats.tokens) { return null; }
  return {
    provider: 'pi',
    model,
    inputTokens: stats.tokens.input || 0,
    outputTokens: stats.tokens.output || 0,
    cachedTokens: stats.tokens.cacheRead || 0,
    totalTokens: stats.tokens.total || 0,
    toolCalls: stats.toolCalls || 0,
    cost_usd: stats.cost ?? 0,
    usagePercent: null,
  };
}

/** Create a session manager based on resume state. */
async function createSessionManager(
  sdk: typeof import('@earendil-works/pi-coding-agent'),
  worktree: string,
  resume: boolean,
  sessionId: string | null,
  clearStaleMarker: () => Promise<void>,
) {
  if (resume && sessionId) {
    // Find the session file matching the stored sessionId and open it so the
    // SDK continues the exact prior session instead of creating a new one.
    const sessions = await sdk.SessionManager.list(worktree);
    const match = sessions.find((s) => s.id === sessionId);
    if (match) {
      return sdk.SessionManager.open(match.path, undefined, worktree);
    }
    // Never substitute an unrelated conversation for an explicit session ID.
    await clearStaleMarker();
    return sdk.SessionManager.create(worktree);
  }
  if (resume) {
    // Resume without a stored sessionId — continue the most recent session.
    return sdk.SessionManager.continueRecent(worktree);
  }
  // Persist the conversation so the returned marker can actually be resumed.
  return sdk.SessionManager.create(worktree);
}

/**
 * Build SDK options across the supported Pi SDK API shapes. Pi 0.80.6 exposes
 * AuthStorage/ModelRegistry.create(), while later 0.80 releases expose a
 * ModelRuntime factory and a ModelRegistry constructor instead. Sessions with
 * no explicit model can use the SDK defaults and avoid initializing either
 * model/auth API.
 */
async function createSdkSessionOptions(
  sdk: any,
  worktree: string,
  sessionManager: any,
  model: string | null,
) {
  const sdkOptions: any = { cwd: worktree, sessionManager };
  if (!model) { return sdkOptions; }

  let modelRegistry: any = null;
  if (sdk.AuthStorage?.create && sdk.ModelRegistry?.create) {
    const authStorage = sdk.AuthStorage.create();
    modelRegistry = sdk.ModelRegistry.create(authStorage);
    sdkOptions.authStorage = authStorage;
    sdkOptions.modelRegistry = modelRegistry;
  } else if (sdk.ModelRuntime?.create && sdk.ModelRegistry) {
    const modelRuntime = await sdk.ModelRuntime.create();
    modelRegistry = new sdk.ModelRegistry(modelRuntime);
    await modelRegistry.refresh?.();
    sdkOptions.modelRuntime = modelRuntime;
  }

  if (!modelRegistry) { throw new Error(`Pi SDK cannot resolve the requested model: ${model}`); }
  const slashIndex = model.indexOf('/');
  if (slashIndex > 0) {
    sdkOptions.model = modelRegistry.find(model.substring(0, slashIndex), model.substring(slashIndex + 1));
  } else {
    sdkOptions.model = modelRegistry.getAll().find((candidate: any) => candidate.id === model);
  }
  if (!sdkOptions.model) { throw new Error(`Pi model not found: ${model}`); }
  return sdkOptions;
}

interface PiRunState {
  assistantText: string;
  settleError: string | null;
}

function sessionValue(read: () => any, fallback: any) {
  try { return read() ?? fallback; } catch { return fallback; }
}

/** SDK stats are lifetime totals; a resumed launch must not bill old work again. */
function invocationStats(current: any, baseline: any) {
  const difference = (value: any, before: any) => typeof value === 'number' ? Math.max(0, value - (typeof before === 'number' ? before : 0)) : value;
  const stats = { ...current };
  for (const key of ['assistantMessages', 'userMessages', 'toolCalls', 'toolResults', 'totalMessages', 'cost']) {
    stats[key] = difference(current[key], baseline[key]);
  }
  if (current.tokens) {
    stats.tokens = Object.fromEntries(Object.entries(current.tokens).map(([key, value]) => [key, difference(value, baseline.tokens?.[key])]));
  }
  return stats;
}

function piResult(session: any, state: PiRunState, error: any, attempts: number, startedAt: string, baseline: any = {}) {
  // Snapshot before disposal: SDK getters need not remain usable afterwards.
  const stats = invocationStats(sessionValue(() => session?.getSessionStats?.(), {}), baseline);
  return {
    status: error ? error.exitCode || 1 : 0,
    stdout: error ? state.assistantText : sessionValue(() => session?.getLastAssistantText?.(), '') || state.assistantText,
    stderr: error ? error.message || String(error) : '', error: error || null, signal: null,
    sessionId: session?.sessionId || null, telemetry: extractTelemetryFromStats(stats, session?.model?.id),
    model: session?.model?.id || undefined, provider: 'pi', transientRetries: attempts,
    startedAt, endedAt: new Date().toISOString(),
    stats,
  };
}

async function runPiSession(
  createSession: Function, sdkOptions: any, prompt: string,
  watchdog: ReturnType<typeof createOutputWatchdog>, renderer: AgentStreamRenderer,
  attempts: number, startedAt: string, usage: { baseline: any | null },
) {
  const state: PiRunState = { assistantText: '', settleError: null };
  let session: any = null;
  let unsubscribe: (() => void) | undefined;
  try {
    const created = await createSession(sdkOptions);
    session = created.session;
    usage.baseline ??= sessionValue(() => session.getSessionStats?.(), {});
    renderer.render([{ kind: 'system', model: session.model?.id || null, sessionId: session.sessionId || null,
      tools: sessionValue(() => session.getActiveToolNames?.().length, null) }]);
    if (created.modelFallbackMessage) {
      renderer.render([{ kind: 'diagnostic', text: created.modelFallbackMessage, isError: false }]);
    }
    unsubscribe = subscribePiEvents(session, watchdog, renderer, state);
    await session.prompt(prompt);
    if (state.settleError) { throw new Error(state.settleError); }
    const result = piResult(session, state, null, attempts, startedAt, usage.baseline);
    if (!state.assistantText && result.stdout) { renderer.render([{ kind: 'text', text: result.stdout, agent: null }]); }
    return result;
  } catch (error: any) {
    return piResult(session, state, error, attempts, startedAt, usage.baseline || {});
  } finally {
    try { unsubscribe?.(); } finally { session?.dispose?.(); }
  }
}

async function runPiAttempts(
  createSession: Function, sdkOptions: any, prompt: string, watchdog: ReturnType<typeof createOutputWatchdog>,
  renderer: AgentStreamRenderer, maxTransientRetries: number, startedAt: string, resume: boolean,
) {
  const usage = { baseline: resume ? null : {} };
  for (let attempts = 0; ; attempts += 1) {
    const result = await runPiSession(createSession, sdkOptions, prompt, watchdog, renderer, attempts, startedAt, usage);
    if (attempts >= maxTransientRetries || !isTransientPiFailure(result) || result.status === 0) { return result; }
    renderer.render([{ kind: 'activity', label: 'retrying', message: `↻ retry ${attempts + 1}/${maxTransientRetries} · ${result.stderr}` }]);
  }
}

function renderPiResult(renderer: AgentStreamRenderer, result: ReturnType<typeof piResult>) {
  if (result.stderr) { renderer.render([{ kind: 'diagnostic', text: result.stderr, isError: true }]); }
  renderer.render([{ kind: 'result', isError: result.status !== 0,
    durationMs: Date.parse(result.endedAt) - Date.parse(result.startedAt), costUsd: finiteOrNull(result.stats.cost),
    inputTokens: finiteOrNull(result.stats.tokens?.input), outputTokens: finiteOrNull(result.stats.tokens?.output),
    numTurns: finiteOrNull(result.stats.assistantMessages) }]);
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
  sessionMarkerPort,
  maxTransientRetries = 1,
}: StartPiAgentOptions) {
  // Prepend the subagent-limit advisory prefix to the prompt.
  const subagentPrefix = buildSubagentLimitPrefix(undefined);
  const injectedPrompt = subagentPrefix + prompt;

  // Build invocation for logging (preserves caller contract).
  const invocation = buildPiInvocation({
    prompt: injectedPrompt,
    worktree,
    env,
    resume,
    sessionId,
    model,
  });

  // All async work deferred to resultPromise so callers get
  // { invocation, resultPromise } synchronously (agents.ts contract).
  const resultPromise = (async () => {
    const startedAt = new Date().toISOString();
    const renderer = createAgentStreamRenderer(teeOptions.stdoutSink, {}, invocation.options.env);
    const watchdog = createOutputWatchdog(teeOptions.noOutputWatchdog, invocation);
    // Merge caller-supplied environment into process.env so the SDK's
    // subprocess spawning (bash tool, etc.) inherits the caller's scoped
    // environment (e.g., FORGEJO_USER). Restore after the session completes.
    const prevEnvEntries: [string, string | undefined][] = [];
    if (env && typeof env === 'object') {
      for (const [key, value] of Object.entries(env)) {
        prevEnvEntries.push([key, process.env[key as keyof typeof process.env]]);
        if (value === undefined || value === null) {
          delete process.env[key as keyof typeof process.env];
        } else {
          process.env[key as keyof typeof process.env] = String(value);
        }
      }
    }

    try {
      const sdk = await loadSdk();
      const createSession = _createAgentSession || sdk.createAgentSession;
      const clearStaleMarker = async () => {
        const port = sessionMarkerPort || _sessionPort;
        if (!port || !slug || !role) { throw new Error('Could not clear stale session marker: SessionMarkerPort is required'); }
        await port.delete(slug, role);
        renderer.render([{ kind: 'diagnostic', text: '· stored Pi session is unavailable; starting a fresh session', isError: false }]);
      };
      const sessionManager = await createSessionManager(sdk, worktree, resume, sessionId, clearStaleMarker);
      const sdkOptions = await createSdkSessionOptions(sdk, worktree, sessionManager, model);
      const result = await runPiAttempts(createSession, sdkOptions, injectedPrompt, watchdog, renderer, maxTransientRetries, startedAt, resume);
      renderPiResult(renderer, result);
      const { stats: _stats, ...launchResult } = result;
      return launchResult;
    } catch (error: any) {
      const result = piResult(null, { assistantText: '', settleError: null }, error, 0, startedAt);
      renderPiResult(renderer, result);
      const { stats: _stats, ...launchResult } = result;
      return launchResult;
    } finally {
      // Clean up watchdog timer.
      watchdog.clear();
      renderer.close();
      // Restore original process.env.
      for (const [key, prevValue] of prevEnvEntries) {
        if (prevValue === undefined) {
          delete process.env[key as keyof typeof process.env];
        } else {
          process.env[key as keyof typeof process.env] = prevValue;
        }
      }
    }
  })();

  return { invocation, resultPromise };
}

function subscribePiEvents(session: any, watchdog: { noteOutput: () => void }, renderer: AgentStreamRenderer, state: PiRunState) {
  const normalizer = new PiStreamNormalizer();
  return session.subscribe((event: any) => {
    let events;
    try { events = normalizer.push(event); } catch { events = [{ kind: 'unknown' as const, type: String(event.type ?? 'unknown') }]; }
    for (const normalized of events) {
      if (normalized.kind === 'text') { state.assistantText += normalized.text; }
    }
    renderer.render(events);
    if (events.length || event.type === 'tool_execution_update') { watchdog.noteOutput(); }
    if (event.type === 'message_start' && event.message?.role === 'assistant') { state.settleError = null; }
    if (event.type === 'agent_end' && !event.willRetry) {
      const last = event.messages?.findLast((message: any) => message.role === 'assistant') ?? event.messages?.at(-1);
      state.settleError = last?.stopReason === 'error' ? last.errorMessage || 'agent session ended in a provider error'
        : last?.stopReason === 'aborted' ? 'agent session aborted' : null;
    } else if (event.type === 'auto_retry_end') {
      state.settleError = event.success === false ? event.finalError || 'agent retries exhausted without a model response' : null;
    }
  });
}

export {
  buildPiInvocation,
  resolvePiCommand,
  startPiAgent,
  isTransientPiFailure,
  __setSessionPortForTest,
  __setSessionsForTest,
  __setCreateAgentSessionForTest,
  __setSdkForTest,
};
