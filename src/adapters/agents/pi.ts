import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SessionMarkerPort } from '../../application/domain-ports.js';
import { buildSubagentLimitPrefix } from './subagent-limit.js';

interface BuildPiInvocationOptions {
  prompt: string;
  worktree: string;
  env?: object;
  resume?: boolean;
  sessionId?: string | null;
  model?: string | null;
}

interface PiNoOutputWatchdog {
  onNoOutput?: (_event: { command: string; args: string[]; pid: number | undefined; elapsedMs: number }) => void;
  initialDelayMs?: number;
  intervalMs?: number;
}

interface PiTeeOptions {
  noOutputWatchdog?: PiNoOutputWatchdog | null;
}

interface StartPiAgentOptions {
  prompt: string;
  worktree: string;
  env?: object;
  resume?: boolean;
  sessionId?: string | null;
  model?: string | null;
  teeOptions?: PiTeeOptions;
  slug?: string | null;
  role?: string | null;
  maxTransientRetries?: number;
  /** Checked application port for session markers (architecture migration cutover). */
  sessionMarkerPort?: SessionMarkerPort;
}

// Lazily-loaded SDK, using native dynamic import to avoid startup cost.
let _sdk: any = null;
async function loadSdk() {
  if (!_sdk) {
    _sdk = await new Function('p', 'return import(p)')('@earendil-works/pi-coding-agent');
  }
  return _sdk;
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
    usagePercent: null,
  };
}

/** Create a session manager based on resume state. */
async function createSessionManager(
  sdk: typeof import('@earendil-works/pi-coding-agent'),
  worktree: string,
  resume: boolean,
  sessionId: string | null,
) {
  if (resume && sessionId) {
    // Find the session file matching the stored sessionId and open it so the
    // SDK continues the exact prior session instead of creating a new one.
    const sessions = await sdk.SessionManager.list(worktree);
    const match = sessions.find((s) => s.id === sessionId);
    if (match) {
      return sdk.SessionManager.open(match.path, undefined, worktree);
    }
    // Session ID not found — fall back to continuing the most recent session
    // (may be the same session under a different directory).
    return sdk.SessionManager.continueRecent(worktree);
  }
  if (resume) {
    // Resume without a stored sessionId — continue the most recent session.
    return sdk.SessionManager.continueRecent(worktree);
  }
  // Fresh run — in-memory to avoid leaving stale session files.
  return sdk.SessionManager.inMemory();
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

  if (!modelRegistry) { return sdkOptions; }
  const slashIndex = model.indexOf('/');
  if (slashIndex > 0) {
    sdkOptions.model = modelRegistry.find(model.substring(0, slashIndex), model.substring(slashIndex + 1));
  } else {
    sdkOptions.model = modelRegistry.getAll().find((candidate: any) => candidate.id === model);
  }
  if (sdkOptions.model === undefined) { delete sdkOptions.model; }
  return sdkOptions;
}

function startPiAgent({
  prompt,
  worktree,
  env,
  resume = false,
  sessionId = null,
  model = null,
  teeOptions = {},
  slug: _slug = null,
  role: _role = null,
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
    // Resolve the SDK (or test override).
    const sdk = await loadSdk();
    const createSession = _createAgentSession || sdk.createAgentSession;

    const sessionManager = await createSessionManager(sdk, worktree, resume, sessionId);
    const sdkOptions = await createSdkSessionOptions(sdk, worktree, sessionManager, model);

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

    // Collect output during SDK execution.
    let assistantText = '';
    let _toolCalls = 0;
    let errorText = '';

    // Tee / watchdog — write text_delta to process.stdout in real time
    // and fire noOutputWatchdog.onNoOutput when no visible text arrives.
    const watchdog = teeOptions.noOutputWatchdog;
    let sawOutput = false;
    let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
    const outputStartTime = Date.now();

    const clearWatchdog = () => {
      if (watchdogTimer) {
        clearTimeout(watchdogTimer);
        watchdogTimer = null;
      }
    };

    const scheduleWatchdog = (delayMs: number) => {
      if (!watchdog || typeof watchdog.onNoOutput !== 'function') { return; }
      const delay = Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : 0;
      watchdogTimer = setTimeout(() => {
        watchdogTimer = null;
        if (sawOutput) { return; }
        if (typeof watchdog.onNoOutput !== 'function') { return; }
        watchdog.onNoOutput({
          command: invocation.command,
          args: invocation.args,
          pid: undefined,
          elapsedMs: Date.now() - outputStartTime,
        });
        scheduleWatchdog(watchdog.intervalMs ?? 0);
      }, delay);
      if (typeof watchdogTimer.unref === 'function') { watchdogTimer.unref(); }
    };

    // Schedule initial watchdog before session starts.
    if (watchdog) {
      scheduleWatchdog(watchdog.initialDelayMs ?? 0);
    }

    let attempts = 0;
    let session: any = null;

    try {
      while (attempts <= maxTransientRetries) {
        try {
          // Reset per-attempt state.
          assistantText = '';
          _toolCalls = 0;
          errorText = '';

          const { session: sdkSession } = await createSession(sdkOptions);
          session = sdkSession;

          // Subscribe to events for output filtering and telemetry.
          const unsubscribe = session.subscribe((event: any) => {
            switch (event.type) {
              case 'message_update':
                if (event.assistantMessageEvent && event.assistantMessageEvent.type === 'text_delta') {
                  const delta = event.assistantMessageEvent.delta;
                  assistantText += delta;
                  // Tee text_delta to stdout for real-time console visibility.
                  process.stdout.write(delta);
                  // Clear the no-output watchdog on first visible text.
                  if (!sawOutput) {
                    sawOutput = true;
                    clearWatchdog();
                  }
                }
                break;
              case 'tool_execution_end':
                _toolCalls += 1;
                break;
              case 'agent_end':
                // Agent completed.
                break;
            }
          });

          // Send the prompt and wait for the agent to complete.
          await session.prompt(injectedPrompt);
          await session.waitForIdle();

          if (typeof unsubscribe === 'function') { unsubscribe(); }
          if (typeof session.dispose === 'function') { session.dispose(); }
          clearWatchdog();

          // Build the result from SDK state.
          const stats = session.getSessionStats?.() || {};
          const lastText = session.getLastAssistantText?.() || assistantText;
          const sdkSessionId = session.sessionId || null;

          const telemetry = extractTelemetryFromStats(stats, session.model?.id);

          return {
            status: 0,
            stdout: lastText,
            stderr: errorText,
            error: null,
            signal: null,
            sessionId: sdkSessionId,
            telemetry,
            model: session.model?.id || undefined,
            provider: 'pi',
            transientRetries: attempts,
            startedAt: new Date().toISOString(),
            endedAt: new Date().toISOString(),
          };
        } catch (err: any) {
          const errorResult = {
            status: err.exitCode || 1,
            stdout: assistantText,
            stderr: err.message || String(err),
            error: err,
            signal: null,
          };

          if (attempts < maxTransientRetries && isTransientPiFailure(errorResult)) {
            attempts += 1;
            continue;
          }

          // Build result from error state.
          const stats = session?.getSessionStats?.() || {};
          const sdkSessionId = session?.sessionId || null;
          const telemetry = extractTelemetryFromStats(stats, session?.model?.id);

          return {
            status: errorResult.status,
            stdout: assistantText,
            stderr: errorResult.stderr,
            error: err,
            signal: errorResult.signal,
            sessionId: sdkSessionId,
            telemetry,
            model: session?.model?.id || undefined,
            provider: 'pi',
            transientRetries: attempts,
            startedAt: new Date().toISOString(),
            endedAt: new Date().toISOString(),
          };
        }
      }

      // Should not reach here, but safety fallback.
      return {
        status: 1,
        stdout: assistantText,
        stderr: 'Max retries exceeded',
        error: new Error('Max retries exceeded'),
        signal: null,
        sessionId: null,
        telemetry: null,
        model: undefined,
        provider: 'pi',
        transientRetries: maxTransientRetries,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      };
    } finally {
      // Clean up watchdog timer.
      clearWatchdog();
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
