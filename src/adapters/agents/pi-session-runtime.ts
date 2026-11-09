import { failureReasonFromCause, recognizedFailureReason } from '../../domain/failure-reason.js';
import type { PiSdk, PiSessionFactory, PiSessionOptions, PiModelRegistry, PiModelRegistryConstructor, PiStats, PiSession, PiStreamEvent, PiMessage } from './pi-sdk-types.js';
import type { ParallixConfiguration } from "../../application/ports/configuration.js";
import { DEFAULT_CONFIGURATION } from "../../application/ports/configuration.js";
import type { SessionMarkerPort } from '../../application/domain-ports.js';
import { createAgentStreamRenderer, type AgentStreamRenderer, type RenderSink } from './agent-stream-view.js';
import { createOutputWatchdog, type NoOutputWatchdog } from '../process/output-watchdog.js';
import { PiStreamNormalizer } from './pi-stream-render.js';
import { finiteOrNull } from './agent-stream-events.js';
import type { PiWorkerObservation } from './pi-worker-protocol.js';

// A stopped worker gets a finite window to land the session's final events and
// stats before its result is settled from what it observed. Telemetry recovery
// must never hold the process open past this bound.
const PI_SHUTDOWN_FLUSH_MS = 1000;

// Observed provider facts are re-published at most this often: enough that a
// hard kill keeps near-current usage, cheap enough to ride a streaming session.
const PI_OBSERVATION_MIN_INTERVAL_MS = 500;

// Lazily-loaded SDK, using native dynamic import to avoid startup cost.
// Import cost and SDK-owned ambient configuration are isolated in the worker.
let _sdk: PiSdk | null = null;
let _sdkImport: Promise<PiSdk> | null = null;
function sdkImport(): Promise<PiSdk> {
  if (_sdkImport) { return _sdkImport; }
  const pending: Promise<PiSdk> = (new Function('p', 'return import(p)') as (specifier: string) => Promise<PiSdk>)('@earendil-works/pi-coding-agent')
    .then((mod: PiSdk) => { _sdk = mod; return mod; })
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
let _createAgentSession: PiSessionFactory | null = null;
let _sessionPort: SessionMarkerPort | null = null;

// Test hooks: override the launcher's I/O without touching the public signature.
function __setCreateAgentSessionForTest(fn: PiSessionFactory | null) { _createAgentSession = fn || null; }
function __setSessionPortForTest(port: SessionMarkerPort | null) { _sessionPort = port; }
function __setSdkForTest(sdk: PiSdk | null) { _sdk = sdk || null; }
// Legacy test hook retained for backward compatibility (pi.ts no longer uses file-based sessions).
function __setSessionsForTest(_mod: unknown) { /* no-op: pi.ts uses SessionMarkerPort */ }

function isTransientPiFailure(error: { failureReason?: unknown; stdout?: string; stderr?: string } | null) {
  const reason = recognizedFailureReason(error?.failureReason);
  return reason?.code === 'provider-unavailable' || reason?.code === 'infrastructure' && reason.source === 'provider';
}

/** Extract telemetry from SDK session stats. */
function extractTelemetryFromStats(stats: PiStats | null, model?: string) {
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
  sdk: PiSdk,
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
  sdk: PiSdk,
  worktree: string,
  sessionManager: unknown,
  model: string | null,
) {
  const sdkOptions: PiSessionOptions = { cwd: worktree, sessionManager };
  if (!model) { return sdkOptions; }

  let modelRegistry: PiModelRegistry | null = null;
  if (sdk.AuthStorage?.create && sdk.ModelRegistry?.create) {
    const authStorage = sdk.AuthStorage.create();
    modelRegistry = sdk.ModelRegistry.create(authStorage);
    sdkOptions.authStorage = authStorage;
    sdkOptions.modelRegistry = modelRegistry;
  } else if (sdk.ModelRuntime?.create && sdk.ModelRegistry) {
    const modelRuntime = await sdk.ModelRuntime.create();
    modelRegistry = new (sdk.ModelRegistry as PiModelRegistryConstructor)(modelRuntime);
    await modelRegistry.refresh?.();
    sdkOptions.modelRuntime = modelRuntime;
  }

  if (!modelRegistry) { throw new Error(`Pi SDK cannot resolve the requested model: ${model}`); }
  const slashIndex = model.indexOf('/');
  if (slashIndex > 0) {
    sdkOptions.model = modelRegistry.find(model.substring(0, slashIndex), model.substring(slashIndex + 1));
  } else {
    sdkOptions.model = modelRegistry.getAll().find((candidate) => candidate.id === model);
  }
  if (!sdkOptions.model) { throw new Error(`Pi model not found: ${model}`); }
  return sdkOptions;
}

interface PiRunState {
  assistantText: string;
  settleError: string | null;
  stopReason?: string;
}

/** The provider session was stopped before it finished; its observed facts still stand. */
function isInterruptedPiSession(error: unknown): boolean {
  return error instanceof Error && (error as { interrupted?: boolean }).interrupted === true;
}

function abortPiSession(session: PiSession | null): void {
  try { void session?.abort?.(); } catch { /* The session may already be gone. */ }
}

async function flushInterruptedPiSession(error: unknown, prompting: Promise<void> | null, session: PiSession | null): Promise<void> {
  if (!isInterruptedPiSession(error) || !prompting) { return; }
  abortPiSession(session);
  // Finite flush: give the aborted session a bounded chance to settle its final
  // events and stats, then settle from the snapshot regardless.
  await Promise.race([prompting.then(() => undefined, () => undefined),
    new Promise(resolve => { setTimeout(resolve, PI_SHUTDOWN_FLUSH_MS); })]);
}

/** Reject when `signal` aborts, leaving the session promise itself untouched. */
function untilInterrupted(prompting: Promise<void>, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const fail = () => { reject(Object.assign(new Error('Pi session stopped before it completed'), { interrupted: true })); };
    if (signal.aborted) { fail(); return; }
    signal.addEventListener('abort', fail, { once: true });
    const settle = (run: () => void) => { signal.removeEventListener('abort', fail); run(); };
    prompting.then(() => settle(resolve), (error: unknown) => settle(() => reject(error)));
  });
}

/** What the provider has resolved so far; published before the session finishes. */
function piObservation(session: PiSession, baseline: PiStats): PiWorkerObservation {
  const modelId = session.model?.id;
  return {
    provider: 'pi',
    ...(modelId ? { model: modelId } : {}),
    ...(session.sessionId ? { sessionId: session.sessionId } : {}),
    telemetry: extractTelemetryFromStats(invocationStats(sessionValue(() => session.getSessionStats?.(), {}), baseline), modelId),
  };
}

/** Publish changed provider facts immediately, then at a bounded stream cadence. */
function createObservationPublisher(session: PiSession, baseline: PiStats, onObserved?: (_observation: PiWorkerObservation) => void) {
  let publishedObservation = '';
  let lastPublishedAtMs = 0;
  const publish = () => {
    const observation = piObservation(session, baseline);
    const signature = JSON.stringify(observation);
    if (signature === publishedObservation) { return; }
    publishedObservation = signature;
    onObserved?.(observation);
  };
  return {
    publish,
    republish: () => {
      const now = Date.now();
      if (now - lastPublishedAtMs < PI_OBSERVATION_MIN_INTERVAL_MS) { return; }
      lastPublishedAtMs = now;
      publish();
    },
  };
}

function sessionValue<T>(read: () => T | null | undefined, fallback: T): T {
  try { return read() ?? fallback; } catch { return fallback; }
}

/** SDK stats are lifetime totals; a resumed launch must not bill old work again. */
function invocationStats(current: PiStats, baseline: PiStats) {
  const difference = (value: number | undefined, before: number | undefined) => typeof value === 'number' ? Math.max(0, value - (typeof before === 'number' ? before : 0)) : value;
  const stats = { ...current };
  for (const key of ['assistantMessages', 'userMessages', 'toolCalls', 'toolResults', 'totalMessages', 'cost'] as const) {
    stats[key] = difference(current[key], baseline[key]);
  }
  if (current.tokens) {
    stats.tokens = Object.fromEntries(Object.entries(current.tokens).map(([key, value]) => [key, difference(value, baseline.tokens?.[key])]));
  }
  return stats;
}

function piResult(session: PiSession | null, state: PiRunState, error: unknown, attempts: number, startedAt: string, baseline: PiStats = {}) {
  // Snapshot before disposal: SDK getters need not remain usable afterwards.
  const stats = invocationStats(sessionValue(() => session?.getSessionStats?.(), {}), baseline);
  const modelId = session?.model?.id;
  return {
    failureReason: piFailureReason(error),
    status: error ? (error as { exitCode?: number }).exitCode || 1 : 0,
    stdout: error ? state.assistantText : sessionValue(() => session?.getLastAssistantText?.(), '') || state.assistantText,
    stderr: error ? (error as { message?: string }).message || String(error) : '', error: error || null, signal: null,
    sessionId: session?.sessionId || null, telemetry: extractTelemetryFromStats(stats, modelId),
    model: modelId || undefined, provider: 'pi', transientRetries: attempts,
    startedAt, endedAt: new Date().toISOString(),
    stats,
    ...(state.stopReason ? { stopReason: state.stopReason } : {}),
  };
}

async function runPiSession(
  createSession: PiSessionFactory, sdkOptions: PiSessionOptions, prompt: string,
  watchdog: ReturnType<typeof createOutputWatchdog>, renderer: AgentStreamRenderer,
  attempts: number, startedAt: string, usage: { baseline: PiStats | null },
  onObserved?: (_observation: PiWorkerObservation) => void, interruptSignal?: AbortSignal,
) {
  const state: PiRunState = { assistantText: '', settleError: null };
  let session: PiSession | null = null;
  let unsubscribe: (() => void) | undefined;
  let prompting: Promise<void> | null = null;
  try {
    const created = await createSession(sdkOptions);
    session = created.session;
    usage.baseline ??= sessionValue(() => created.session.getSessionStats?.(), {});
    // Publish the resolved model and session before the first token, then again
    // as the session's usage moves: a shutdown that stops this worker must not
    // lose what it had already observed, even when the final result never lands.
    const observations = createObservationPublisher(created.session, usage.baseline as PiStats, onObserved);
    observations.publish();
    renderer.render([{ kind: 'system', model: session.model?.id || null, sessionId: session.sessionId || null,
      tools: sessionValue(() => created.session.getActiveToolNames?.().length, null) }]);
    if (created.modelFallbackMessage) {
      renderer.render([{ kind: 'diagnostic', text: created.modelFallbackMessage, isError: false }]);
    }
    unsubscribe = subscribePiEvents(session, watchdog, renderer, state, observations.republish);
    prompting = session.prompt(prompt);
    await (interruptSignal ? untilInterrupted(prompting, interruptSignal) : prompting);
    if (state.settleError) { throw new Error(state.settleError); }
    const result = piResult(session, state, null, attempts, startedAt, usage.baseline);
    if (!state.assistantText && result.stdout) { renderer.render([{ kind: 'text', text: result.stdout, agent: null }]); }
    return result;
  } catch (error: unknown) {
    await flushInterruptedPiSession(error, prompting, session);
    return piResult(session, state, error, attempts, startedAt, usage.baseline || {});
  } finally {
    try { unsubscribe?.(); } finally { session?.dispose?.(); }
  }
}

async function runPiAttempts(
  createSession: PiSessionFactory, sdkOptions: PiSessionOptions, prompt: string, watchdog: ReturnType<typeof createOutputWatchdog>,
  renderer: AgentStreamRenderer, maxTransientRetries: number, startedAt: string, resume: boolean,
  onObserved?: (_observation: PiWorkerObservation) => void, interruptSignal?: AbortSignal,
) {
  const usage: { baseline: PiStats | null } = { baseline: resume ? null : {} };
  for (let attempts = 0; ; attempts += 1) {
    const result = await runPiSession(createSession, sdkOptions, prompt, watchdog, renderer, attempts, startedAt, usage, onObserved, interruptSignal);
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

function piMessageError(last: PiMessage | undefined): string | null {
      return last?.stopReason === 'error' ? last.errorMessage || 'agent session ended in a provider error'
        : last?.stopReason === 'aborted' ? 'agent session aborted' : null;
}

function updatePiSettlement(event: PiStreamEvent, state: PiRunState) {
    if (event.type === 'message_start' && event.message?.role === 'assistant') { state.settleError = null; }
    if (event.type === 'agent_end' && !event.willRetry) {
      const last = event.messages?.findLast((message) => message.role === 'assistant') ?? event.messages?.at(-1);
      state.stopReason = last?.stopReason === 'length' ? 'output-token-limit' : last?.stopReason;
      state.settleError = piMessageError(last);
    } else if (event.type === 'auto_retry_end') {
      state.settleError = event.success === false ? event.finalError || 'agent retries exhausted without a model response' : null;
    }
}

function subscribePiEvents(session: PiSession, watchdog: { noteOutput: () => void }, renderer: AgentStreamRenderer, state: PiRunState, onObservation?: () => void) {
  const normalizer = new PiStreamNormalizer();
  return session.subscribe((event) => {
    let events;
    try { events = normalizer.push(event); } catch { events = [{ kind: 'unknown' as const, type: String(event.type ?? 'unknown') }]; }
    for (const normalized of events) {
      if (normalized.kind === 'text') { state.assistantText += normalized.text; }
    }
    renderer.render(events);
    if (events.length || event.type === 'tool_execution_update') { watchdog.noteOutput(); }
    updatePiSettlement(event, state);
    onObservation?.();
  });
}


/** SDK execution; production calls this only in its isolated worker. */
export async function runPiSdk(request: {
  configuration?: ParallixConfiguration;
  prompt: string; worktree: string; resume?: boolean; sessionId?: string | null; model?: string | null;
  maxTransientRetries?: number; stdoutSink?: RenderSink; noOutputWatchdog?: NoOutputWatchdog | null;
  clearStaleMarker: () => Promise<void>;
  onObserved?: (_observation: PiWorkerObservation) => void;
  interruptSignal?: AbortSignal;
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
      watchdog, renderer, request.maxTransientRetries ?? 1, startedAt, request.resume ?? false,
      request.onObserved, request.interruptSignal);
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

function piFailureReason(error: unknown) { return error ? failureReasonFromCause(error, 'provider') : undefined; }
