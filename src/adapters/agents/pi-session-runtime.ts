import type { ParallixConfiguration } from "../../application/ports/configuration.js";
import { DEFAULT_CONFIGURATION } from "../../application/ports/configuration.js";
import type { SessionMarkerPort } from '../../application/domain-ports.js';
import { createAgentStreamRenderer, type AgentStreamRenderer, type RenderSink } from './agent-stream-view.js';
import { createOutputWatchdog, type NoOutputWatchdog } from '../process/output-watchdog.js';
import { PiStreamNormalizer } from './pi-stream-render.js';
import { finiteOrNull } from './agent-stream-events.js';

// Lazily-loaded SDK, using native dynamic import to avoid startup cost.
// Import cost and SDK-owned ambient configuration are isolated in the worker.
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


/** SDK execution; production calls this only in its isolated worker. */
export async function runPiSdk(request: {
  configuration?: ParallixConfiguration;
  prompt: string; worktree: string; resume?: boolean; sessionId?: string | null; model?: string | null;
  maxTransientRetries?: number; stdoutSink?: RenderSink; noOutputWatchdog?: NoOutputWatchdog | null;
  clearStaleMarker: () => Promise<void>;
}) {
  const startedAt = new Date().toISOString();
  const renderer = createAgentStreamRenderer(request.stdoutSink, {}, request.configuration ?? DEFAULT_CONFIGURATION);
  const watchdog = createOutputWatchdog(request.noOutputWatchdog, { command: 'pi', args: [] });
  try {
    const sdk = await loadSdk();
    const manager = await createSessionManager(sdk, request.worktree, request.resume ?? false, request.sessionId ?? null, async () => {
      await request.clearStaleMarker();
      renderer.render([{ kind: 'diagnostic', text: '· stored Pi session is unavailable; starting a fresh session', isError: false }]);
    });
    const options = await createSdkSessionOptions(sdk, request.worktree, manager, request.model ?? null);
    const result = await runPiAttempts(_createAgentSession || sdk.createAgentSession, options, request.prompt,
      watchdog, renderer, request.maxTransientRetries ?? 1, startedAt, request.resume ?? false);
    renderPiResult(renderer, result);
    const { stats: _stats, ...launchResult } = result;
    return launchResult;
  } catch (error) {
    const result = piResult(null, { assistantText: '', settleError: null }, error, 0, startedAt);
    renderPiResult(renderer, result);
    const { stats: _stats, ...launchResult } = result;
    return launchResult;
  } finally { watchdog.clear(); renderer.close(); }
}

export function hasInjectedPiSdk(): boolean { return Boolean(_sdk || _createAgentSession); }
export { isTransientPiFailure, __setCreateAgentSessionForTest, __setSdkForTest, __setSessionPortForTest, __setSessionsForTest };
