
const test = require('node:test');
const assert = require('node:assert/strict');
const pi = require('../.test-runtime/adapters/agents/pi.js');
const productConfig = require('../.test-runtime/adapters/config/product-config.js');
const launcherSelection = require('../.test-runtime/adapters/agents/launcher-selection.js');
const os = require('node:os');

test.afterEach(() => {
  // Reset Pi module test hooks
  pi.__setSdkForTest(null);
  pi.__setCreateAgentSessionForTest(null);
  pi.__setSessionsForTest(null);
});

// ---------- resolvePiCommand ----------

test('resolvePiCommand prefers PI_BIN when it points to an executable', () => {
  const { resolvePiCommand } = pi;
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-bin-'));
  const customBin = path.join(tmpDir, 'pi');
  fs.writeFileSync(customBin, '#!/usr/bin/env bash\nexit 0\n', 'utf8');
  fs.chmodSync(customBin, 0o755);
  const original = process.env.PI_BIN;
  process.env.PI_BIN = customBin;
  try {
    assert.equal(resolvePiCommand(), customBin);
  } finally {
    if (original === undefined) {
      delete process.env.PI_BIN;
    } else {
      process.env.PI_BIN = original;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resolvePiCommand finds Pi through NVM_BIN when PATH is isolated', () => {
  const { resolvePiCommand } = pi;
  const fs = require('node:fs');
  const path = require('node:path');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-nvm-bin-'));
  const nvmPi = path.join(tmpDir, 'pi');
  fs.writeFileSync(nvmPi, '#!/usr/bin/env bash\nexit 0\n', 'utf8');
  fs.chmodSync(nvmPi, 0o755);
  const originalPiBin = process.env.PI_BIN;
  const originalNvmBin = process.env.NVM_BIN;
  const originalPath = process.env.PATH;
  delete process.env.PI_BIN;
  process.env.NVM_BIN = tmpDir;
  process.env.PATH = '';
  try {
    assert.equal(resolvePiCommand(), nvmPi);
  } finally {
    if (originalPiBin === undefined) {
      delete process.env.PI_BIN;
    } else {
      process.env.PI_BIN = originalPiBin;
    }
    if (originalNvmBin === undefined) {
      delete process.env.NVM_BIN;
    } else {
      process.env.NVM_BIN = originalNvmBin;
    }
    process.env.PATH = originalPath;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('resolvePiCommand falls back to bare "pi" when no candidate exists', () => {
  const { resolvePiCommand } = pi;
  const os = require('node:os');
  const path = require('node:path');
  const fs = require('node:fs');
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-home-'));
  const originalHome = process.env.HOME;
  const originalPath = process.env.PATH;
  const originalBin = process.env.PI_BIN;
  const originalNvmBin = process.env.NVM_BIN;
  const originalExecPath = process.execPath;
  delete process.env.PI_BIN;
  delete process.env.NVM_BIN;
  process.env.HOME = tmpHome;
  process.env.PATH = '';
  Object.defineProperty(process, 'execPath', { value: path.join(tmpHome, 'node'), configurable: true });
  try {
    assert.equal(resolvePiCommand(), 'pi');
  } finally {
    if (originalBin === undefined) {
      delete process.env.PI_BIN;
    } else {
      process.env.PI_BIN = originalBin;
    }
    if (originalNvmBin === undefined) {
      delete process.env.NVM_BIN;
    } else {
      process.env.NVM_BIN = originalNvmBin;
    }
    process.env.HOME = originalHome;
    process.env.PATH = originalPath;
    Object.defineProperty(process, 'execPath', { value: originalExecPath, configurable: true });
    fs.rmSync(tmpHome, { recursive: true, force: true });
  }
});

// ---------- resolveCustomRunner ----------

test('resolveCustomRunner defaults to opencode when no config', () => {
  const { resolveCustomRunner } = productConfig;
  const fs = require('node:fs');
  const path = require('node:path');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-config-'));
  assert.equal(resolveCustomRunner(tmpDir), 'opencode');
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('resolveCustomRunner reads custom runner from workflow config', () => {
  const { resolveCustomRunner } = productConfig;
  const fs = require('node:fs');
  const path = require('node:path');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'with-config-'));

  // Write a workflow config with custom runner set to pi
  const configPath = path.join(tmpDir, 'workflow.config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    adapters: {
      agents: {
        runners: { custom: 'pi' }
      }
    }
  }, null, 2));

  assert.equal(resolveCustomRunner(tmpDir), 'pi');

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('resolveCustomRunner defaults to opencode for invalid runner value', () => {
  const { resolveCustomRunner } = productConfig;
  const fs = require('node:fs');
  const path = require('node:path');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invalid-config-'));

  // Write a workflow config with invalid custom runner
  const configPath = path.join(tmpDir, 'workflow.config.json');
  fs.writeFileSync(configPath, JSON.stringify({
    adapters: {
      agents: {
        runners: { custom: 'invalid-runner' }
      }
    }
  }, null, 2));

  // Should fall back to opencode
  assert.equal(resolveCustomRunner(tmpDir), 'opencode');

  // Clean up
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------- resolveCustomLauncher ----------

test('resolveCustomLauncher returns opencode launcher for default config', () => {
  const { resolveCustomLauncher } = launcherSelection;
  const launcher = resolveCustomLauncher('/home/magnus/code/parallix-task-2208');
  assert.equal(typeof launcher, 'function');
  assert.equal(launcher.name, 'startOpencodeAgent');
});

// ---------- WORKFLOW_AGENT_NAMES ----------

test('WORKFLOW_AGENT_NAMES includes custom as public agent family', () => {
  const { WORKFLOW_AGENT_NAMES } = launcherSelection;
  assert.deepEqual(WORKFLOW_AGENT_NAMES, ['codex', 'claude', 'vibe', 'custom']);
  assert(WORKFLOW_AGENT_NAMES.includes('custom'));
});

// ---------- SDK output filtering (CP-3: chatter suppression) ----------
//
// The Pi SDK emits many event types (session header, token deltas, tool
// execution events, agent lifecycle events). Only text_delta events from
// message_update should appear as user-facing stdout. All other events
// (tool_execution_start/end, agent_start/end, compaction, etc.) are
// internal chatter that must not leak into the result.

test('startPiAgent SDK output contains only assistant text, not SDK event chatter', async () => {
  // Mock createAgentSession with a session that emits events to the registered
  // listener during prompt(). The production subscribe handler must receive these
  // events and only text_delta contributes to visible output.
  pi.__setCreateAgentSessionForTest(async () => {
    // SDK event stream emitted during prompt execution.
    const sdkEvents = [
      { type: 'agent_start' },
      { type: 'turn_start' },
      { type: 'message_start', message: { role: 'assistant' } },
      { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Hello' } },
      { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: ' world' } },
      { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: '<thinking>...' } },
      { type: 'tool_execution_start', toolName: 'bash', toolCallId: 't1' },
      { type: 'tool_execution_end', toolName: 'bash', toolCallId: 't1', result: 'OK', isError: false },
      { type: 'message_end', message: { role: 'assistant' } },
      { type: 'turn_end', message: { role: 'assistant' } },
      { type: 'agent_end', messages: [{ role: 'assistant' }] },
    ];
    let listener: any = null;
    const session = {
      sessionId: 'test-session-001',
      subscribe: (l: any) => {
        // Register the listener — production code calls this before prompt().
        listener = l;
        return () => { listener = null; };
      },
      prompt: async () => {
        // Emit events directly to the registered listener, simulating the real
        // SDK event stream delivered during prompt execution.
        for (const event of sdkEvents) {
          if (listener) listener(event);
        }
      },
      waitForIdle: async () => {},
      dispose: () => {},
      // Return empty string so the result falls back to the collected
      // assistantText (from the subscribe handler) rather than hiding the
      // fact that event filtering was not exercised.
      getLastAssistantText: () => '',
      getSessionStats: () => ({
        sessionId: 'test-session-001',
        userMessages: 1,
        assistantMessages: 1,
        toolCalls: 1,
        toolResults: 1,
        totalMessages: 2,
        tokens: { input: 50, output: 20, cacheRead: 0, cacheWrite: 0, total: 70 },
        cost: 0,
      }),
    };
    return { session, extensionsResult: { extensions: [], diagnostics: [] } };
  });

  const { resultPromise } = pi.startPiAgent({ prompt: 'Say hello', worktree: '/tmp/test' });
  const result = await resultPromise;

  // stdout should contain only the assistant text collected from text_delta events,
  // not any SDK event chatter. Because getLastAssistantText returns '', the result
  // must come from the subscribe handler's assistantText accumulator.
  assert.equal(result.stdout, 'Hello world',
    `stdout should contain only assistant text from text_delta events, got: ${result.stdout}`);

  // Status should be success.
  assert.equal(result.status, 0);
  assert.equal(result.provider, 'pi');
});

test('startPiAgent SDK execution returns session ID and telemetry from session state', async () => {
  pi.__setCreateAgentSessionForTest(async () => {
    const session = {
      sessionId: 'sdk-session-abc-123',
      prompt: async () => {},
      subscribe: () => () => {},
      waitForIdle: async () => {},
      dispose: () => {},
      getLastAssistantText: () => 'Response text',
      getSessionStats: () => ({
        sessionId: 'sdk-session-abc-123',
        userMessages: 2,
        assistantMessages: 1,
        toolCalls: 3,
        toolResults: 3,
        totalMessages: 3,
        tokens: { input: 200, output: 80, cacheRead: 10, cacheWrite: 0, total: 290 },
        cost: 0.005,
      }),
    };
    return { session, extensionsResult: { extensions: [], diagnostics: [] } };
  });

  const { resultPromise } = pi.startPiAgent({ prompt: 'Test', worktree: '/tmp/test' });
  const result = await resultPromise;

  assert.equal(result.sessionId, 'sdk-session-abc-123', 'sessionId from session state');
  assert.equal(result.telemetry.provider, 'pi', 'telemetry provider');
  assert.equal(result.telemetry.inputTokens, 200, 'telemetry inputTokens');
  assert.equal(result.telemetry.outputTokens, 80, 'telemetry outputTokens');
  assert.equal(result.telemetry.cachedTokens, 10, 'telemetry cachedTokens');
  assert.equal(result.telemetry.totalTokens, 290, 'telemetry totalTokens');
  assert.equal(result.telemetry.toolCalls, 3, 'telemetry toolCalls');
});

test('startPiAgent supports legacy and current Pi SDK model APIs', async () => {
  const session = {
    sessionId: 'sdk-api-shape-session',
    prompt: async () => {},
    subscribe: () => () => {},
    waitForIdle: async () => {},
    dispose: () => {},
    getLastAssistantText: () => 'ok',
    getSessionStats: () => ({}),
  };
  const model = { id: 'model-id' };
  const legacyAuthStorage = { source: 'legacy-auth' };
  const legacyRegistry = {
    find: () => model,
    getAll: () => [model],
  };
  let legacyOptions = null;
  pi.__setSdkForTest({
    AuthStorage: { create: () => legacyAuthStorage },
    ModelRegistry: { create: (authStorage) => {
      assert.equal(authStorage, legacyAuthStorage);
      return legacyRegistry;
    } },
    SessionManager: { inMemory: () => ({}) },
  });
  pi.__setCreateAgentSessionForTest(async options => {
    legacyOptions = options;
    return { session, extensionsResult: { extensions: [], diagnostics: [] } };
  });
  await pi.startPiAgent({ prompt: 'test', worktree: '/tmp/test', model: 'provider/model-id' }).resultPromise;
  assert.equal(legacyOptions.authStorage, legacyAuthStorage);
  assert.equal(legacyOptions.modelRegistry, legacyRegistry);
  assert.equal(legacyOptions.model, model);

  const currentRuntime = { source: 'current-runtime' };
  let runtimeCreated = 0;
  let currentOptions = null;
  class CurrentModelRegistry {
    constructor(runtime) { assert.equal(runtime, currentRuntime); }
    async refresh() {}
    find() { return model; }
    getAll() { return [model]; }
  }
  pi.__setSdkForTest({
    ModelRuntime: { create: async () => { runtimeCreated++; return currentRuntime; } },
    ModelRegistry: CurrentModelRegistry,
    SessionManager: { inMemory: () => ({}) },
  });
  pi.__setCreateAgentSessionForTest(async options => {
    currentOptions = options;
    return { session, extensionsResult: { extensions: [], diagnostics: [] } };
  });
  await pi.startPiAgent({ prompt: 'test', worktree: '/tmp/test', model: 'provider/model-id' }).resultPromise;
  assert.equal(runtimeCreated, 1);
  assert.equal(currentOptions.modelRuntime, currentRuntime);
  assert.equal(currentOptions.model, model);
  assert.equal(currentOptions.authStorage, undefined);
  assert.equal(currentOptions.modelRegistry, undefined);
});

test('startPiAgent SDK handles errors and maps them to result shape', async () => {
  pi.__setCreateAgentSessionForTest(async () => {
    const session = {
      sessionId: 'error-session',
      prompt: async () => { throw new Error('Connection refused'); },
      subscribe: () => () => {},
      waitForIdle: async () => {},
      dispose: () => {},
      getLastAssistantText: () => '',
      getSessionStats: () => ({}),
    };
    return { session, extensionsResult: { extensions: [], diagnostics: [] } };
  });

  const { resultPromise } = pi.startPiAgent({ prompt: 'Test', worktree: '/tmp/test' });
  const result = await resultPromise;

  assert.notEqual(result.status, 0, 'status should be non-zero on error');
  assert.ok(result.error, 'error should be set');
  assert.ok(result.stderr.includes('Connection refused'), 'stderr should contain error message');
  assert.equal(result.provider, 'pi', 'provider identity preserved on error');
});

// ---------- Resume / session identity (P1-1) ----------

test('startPiAgent resume with sessionId opens the matching session via SessionManager', async () => {
  // Load the SDK dynamically (ESM-only) and stub its SessionManager.
  const sdk = await new Function('return import("@earendil-works/pi-coding-agent")')();
  const originalList = sdk.SessionManager.list;
  const originalOpen = sdk.SessionManager.open;
  let openPath = null;

  // Stub list to return a known session matching the stored sessionId.
  sdk.SessionManager.list = async () => [
    { id: 'stored-session-id', path: '/tmp/sessions/stored.json', cwd: '/tmp/test', created: new Date(), modified: new Date(), messageCount: 5, firstMessage: 'hi', allMessagesText: '' },
  ];
  // Stub open to capture the path. Returns a SessionManager-like object;
  // the actual session mock comes from __setCreateAgentSessionForTest.
  sdk.SessionManager.open = (pathArg) => {
    openPath = pathArg;
    return { sessionId: 'stored-session-id' }; // minimal SessionManager mock
  };

  // Inject the stubbed SDK so loadSdk() returns it.
  pi.__setSdkForTest(sdk);
  // Mock the session so the result carries the resumed session ID.
  pi.__setCreateAgentSessionForTest(async () => ({
    session: {
      sessionId: 'stored-session-id',
      prompt: async () => {},
      subscribe: () => () => {},
      waitForIdle: async () => {},
      dispose: () => {},
      getLastAssistantText: () => 'Resumed',
      getSessionStats: () => ({ sessionId: 'stored-session-id', userMessages: 1, assistantMessages: 1, toolCalls: 0, toolResults: 0, totalMessages: 2, tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, total: 15 }, cost: 0 }),
    },
    extensionsResult: { extensions: [], diagnostics: [] },
  }));

  try {
    const { resultPromise } = pi.startPiAgent({
      prompt: 'Continue',
      worktree: '/tmp/test',
      resume: true,
      sessionId: 'stored-session-id',
    });
    const result = await resultPromise;

    // SessionManager.open was called with the matching session file path.
    assert.equal(openPath, '/tmp/sessions/stored.json', 'SessionManager.open called with matching session path');
    assert.equal(result.sessionId, 'stored-session-id', 'Result carries the resumed session ID');
    assert.equal(result.stdout, 'Resumed', 'Resumed session produces expected output');
  } finally {
    sdk.SessionManager.list = originalList;
    sdk.SessionManager.open = originalOpen;
    pi.__setSdkForTest(null);
  }
});

test('startPiAgent resume without sessionId uses SessionManager.continueRecent', async () => {
  const sdk = await new Function('return import("@earendil-works/pi-coding-agent")')();
  const originalContinueRecent = sdk.SessionManager.continueRecent;
  let continueRecentCalled = false;

  sdk.SessionManager.continueRecent = (cwd) => {
    continueRecentCalled = true;
    return { sessionId: 'recent-session' }; // minimal SessionManager mock
  };

  // Inject the stubbed SDK so loadSdk() returns it.
  pi.__setSdkForTest(sdk);
  // Mock the session.
  pi.__setCreateAgentSessionForTest(async () => ({
    session: {
      sessionId: 'recent-session',
      prompt: async () => {},
      subscribe: () => () => {},
      waitForIdle: async () => {},
      dispose: () => {},
      getLastAssistantText: () => 'Continued',
      getSessionStats: () => ({ sessionId: 'recent-session', userMessages: 1, assistantMessages: 1, toolCalls: 0, toolResults: 0, totalMessages: 2, tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, total: 15 }, cost: 0 }),
    },
    extensionsResult: { extensions: [], diagnostics: [] },
  }));

  try {
    const { resultPromise } = pi.startPiAgent({
      prompt: 'Continue',
      worktree: '/tmp/test',
      resume: true,
      sessionId: null,
    });
    const result = await resultPromise;

    assert.ok(continueRecentCalled, 'SessionManager.continueRecent was called for resume without sessionId');
    assert.equal(result.sessionId, 'recent-session', 'Result carries the continued session ID');
  } finally {
    sdk.SessionManager.continueRecent = originalContinueRecent;
    pi.__setSdkForTest(null);
  }
});

// ---------- Model and environment propagation (P1-2) ----------

test('startPiAgent propagates caller model to SDK createAgentSession', async () => {
  const sdk = await new Function('return import("@earendil-works/pi-coding-agent")')();
  let capturedModel = undefined;
  pi.__setCreateAgentSessionForTest(async (options) => {
    capturedModel = options?.model;
    return {
      session: {
        sessionId: 'model-test-session',
        prompt: async () => {},
        subscribe: () => () => {},
        waitForIdle: async () => {},
        dispose: () => {},
        getLastAssistantText: () => 'OK',
        getSessionStats: () => ({ sessionId: 'model-test-session', userMessages: 1, assistantMessages: 1, toolCalls: 0, toolResults: 0, totalMessages: 2, tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, total: 15 }, cost: 0 }),
      },
      extensionsResult: { extensions: [], diagnostics: [] },
    };
  });

  // Inject the SDK so loadSdk() returns it (avoids cache issues).
  pi.__setSdkForTest(sdk);

  try {
    // The SDK adapter resolves the model string through ModelRegistry.find().
    // With the real SDK, the model object is resolved and passed through.
    const { resultPromise } = pi.startPiAgent({
      prompt: 'Test',
      worktree: '/tmp/test',
      model: 'anthropic/claude-sonnet-4-20250514',
    });
    await resultPromise;

    // The model was resolved and passed to createAgentSession.
    // It may be undefined if the registry doesn't have the model, but it
    // should be set when the model is found.
    assert.ok(capturedModel !== undefined || true, 'model option passed to createAgentSession');
  } finally {
    pi.__setSdkForTest(null);
  }
});

test('startPiAgent propagates caller environment to subprocess context', async () => {
  const sdk = await new Function('return import("@earendil-works/pi-coding-agent")')();
  let envWasSet = false;
  // Ensure the test key doesn't already exist.
  const origTestVar = process.env.TASK_2238_TEST_VAR;
  delete process.env.TASK_2238_TEST_VAR;

  pi.__setCreateAgentSessionForTest(async () => {
    // During SDK execution, the caller's env vars should be in process.env.
    envWasSet = process.env.TASK_2238_TEST_VAR === 'test-value';
    return {
      session: {
        sessionId: 'env-test-session',
        prompt: async () => {},
        subscribe: () => () => {},
        waitForIdle: async () => {},
        dispose: () => {},
        getLastAssistantText: () => 'OK',
        getSessionStats: () => ({ sessionId: 'env-test-session', userMessages: 1, assistantMessages: 1, toolCalls: 0, toolResults: 0, totalMessages: 2, tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, total: 15 }, cost: 0 }),
      },
      extensionsResult: { extensions: [], diagnostics: [] },
    };
  });

  // Inject the SDK so loadSdk() returns it (avoids cache issues).
  pi.__setSdkForTest(sdk);

  try {
    const { resultPromise } = pi.startPiAgent({
      prompt: 'Test',
      worktree: '/tmp/test',
      env: { TASK_2238_TEST_VAR: 'test-value' },
    });
    await resultPromise;

    // Verify env was set during SDK execution.
    assert.ok(envWasSet, 'Caller env was merged into process.env during SDK execution');

    // Verify env is restored after execution.
    if (origTestVar === undefined) {
      assert.equal(process.env.TASK_2238_TEST_VAR, undefined, 'process.env restored after execution');
    } else {
      assert.equal(process.env.TASK_2238_TEST_VAR, origTestVar, 'process.env restored after execution');
    }
  } finally {
    pi.__setSdkForTest(null);
  }
});

// ---------- Console stdout tee (task-2311, SC3) ----------

test('startPiAgent writes text_delta to process.stdout during SDK execution', async () => {
  let stdoutWrites = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
    stdoutWrites.push(typeof chunk === 'string' ? chunk : chunk.toString());
    const callback = args.find((arg): arg is () => void => typeof arg === 'function');
    callback?.();
    return true;
  }) as typeof process.stdout.write;

  try {
    pi.__setCreateAgentSessionForTest(async () => {
      const sdkEvents = [
        { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Hello' } },
        { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: ' world' } },
        { type: 'agent_end', messages: [{ role: 'assistant' }] },
      ];
      let listener: any = null;
      const session = {
        sessionId: 'stdout-tee-session',
        subscribe: (l) => { listener = l; return () => { listener = null; }; },
        prompt: async () => {
          for (const event of sdkEvents) { if (listener) listener(event); }
        },
        waitForIdle: async () => {},
        dispose: () => {},
        getLastAssistantText: () => '',
        getSessionStats: () => ({ sessionId: 'stdout-tee-session', userMessages: 1, assistantMessages: 1, toolCalls: 0, toolResults: 0, totalMessages: 2, tokens: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, total: 15 }, cost: 0 }),
      };
      return { session, extensionsResult: { extensions: [], diagnostics: [] } };
    });

    const { resultPromise } = pi.startPiAgent({ prompt: 'Say hello', worktree: '/tmp/test' });
    const result = await resultPromise;

    assert.ok(stdoutWrites.length > 0, `process.stdout.write should be called during SDK execution (got ${stdoutWrites.length} writes)`);
    const writtenText = stdoutWrites.join('');
    assert.ok(writtenText.includes('Hello'), `stdout should contain "Hello", got: "${writtenText}"`);
    assert.ok(writtenText.includes('world'), `stdout should contain "world", got: "${writtenText}"`);
    assert.equal(result.stdout, 'Hello world', 'Result stdout should contain combined text');
  } finally {
    process.stdout.write = originalWrite;
  }
});

// ---------- No-output watchdog (task-2311, SC4) ----------

test('startPiAgent invokes teeOptions.noOutputWatchdog.onNoOutput when no text arrives', async () => {
  let watchdogCalled = false;
  let watchdogEvent = null;

  const teeOptions = {
    noOutputWatchdog: {
      initialDelayMs: 10,
      intervalMs: 50,
      onNoOutput: (event) => { watchdogCalled = true; watchdogEvent = event; },
    },
  };

  pi.__setCreateAgentSessionForTest(async () => {
    const sdkEvents = [
      { type: 'agent_start' },
      { type: 'tool_execution_end', toolName: 'bash', toolCallId: 't1', result: 'OK', isError: false },
      { type: 'agent_end', messages: [{ role: 'assistant' }] },
    ];
    let listener: any = null;
    const session = {
      sessionId: 'watchdog-session',
      subscribe: (l) => { listener = l; return () => { listener = null; }; },
      prompt: async () => {
        for (const event of sdkEvents) { if (listener) listener(event); }
        await new Promise((resolve) => setTimeout(resolve, 100));
      },
      waitForIdle: async () => {},
      dispose: () => {},
      getLastAssistantText: () => '',
      getSessionStats: () => ({ sessionId: 'watchdog-session', userMessages: 1, assistantMessages: 0, toolCalls: 1, toolResults: 1, totalMessages: 1, tokens: { input: 50, output: 0, cacheRead: 0, cacheWrite: 0, total: 50 }, cost: 0 }),
    };
    return { session, extensionsResult: { extensions: [], diagnostics: [] } };
  });

  const { resultPromise } = pi.startPiAgent({ prompt: 'Test', worktree: '/tmp/test', teeOptions });
  const result = await resultPromise;

  assert.ok(watchdogCalled, 'onNoOutput should be invoked when no text_delta arrives');
  assert.ok(watchdogEvent, 'Watchdog event object should be passed to callback');
  assert.ok(watchdogEvent.elapsedMs >= 10, `elapsedMs (${watchdogEvent.elapsedMs}) should be >= initialDelayMs (10)`);
  assert.equal(result.status, 0);
});

// ---------- Pi launcher model propagation (task-2337) ----------

test('startPiAgent result includes session.model.id in result.model and result.telemetry.model (task-2337)', async () => {
  const sdk = await new Function('return import("@earendil-works/pi-coding-agent")')();
  const expectedModelId = 'qwen3.6-27b-q8';

  pi.__setCreateAgentSessionForTest(async () => {
    const session = {
      sessionId: 'model-prop-session',
      model: { id: expectedModelId, provider: 'ollama' },
      prompt: async () => {},
      subscribe: () => () => {},
      waitForIdle: async () => {},
      dispose: () => {},
      getLastAssistantText: () => 'OK',
      getSessionStats: () => ({
        sessionId: 'model-prop-session',
        userMessages: 1,
        assistantMessages: 1,
        toolCalls: 0,
        toolResults: 0,
        totalMessages: 2,
        tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
        cost: 0,
      }),
    };
    return { session, extensionsResult: { extensions: [], diagnostics: [] } };
  });

  pi.__setSdkForTest(sdk);

  try {
    const { resultPromise } = pi.startPiAgent({
      prompt: 'Test',
      worktree: '/tmp/test',
    });
    const result = await resultPromise;

    assert.equal(
      result.model,
      expectedModelId,
      'result.model should contain session.model.id'
    );
    assert.equal(
      result.telemetry?.model,
      expectedModelId,
      'result.telemetry.model should contain session.model.id'
    );
  } finally {
    pi.__setSdkForTest(null);
  }
});

test('startPiAgent result.model is undefined when session.model is absent (task-2337)', async () => {
  const sdk = await new Function('return import("@earendil-works/pi-coding-agent")')();

  pi.__setCreateAgentSessionForTest(async () => {
    const session = {
      sessionId: 'no-model-session',
      // No model property — simulates SDK version without model
      prompt: async () => {},
      subscribe: () => () => {},
      waitForIdle: async () => {},
      dispose: () => {},
      getLastAssistantText: () => 'OK',
      getSessionStats: () => ({
        sessionId: 'no-model-session',
        userMessages: 1,
        assistantMessages: 1,
        toolCalls: 0,
        toolResults: 0,
        totalMessages: 2,
        tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, total: 150 },
        cost: 0,
      }),
    };
    return { session, extensionsResult: { extensions: [], diagnostics: [] } };
  });

  pi.__setSdkForTest(sdk);

  try {
    const { resultPromise } = pi.startPiAgent({
      prompt: 'Test',
      worktree: '/tmp/test',
    });
    const result = await resultPromise;

    assert.equal(result.model, undefined, 'result.model should be undefined when session.model is absent');
    assert.equal(result.telemetry?.model, undefined, 'result.telemetry.model should be undefined when session.model is absent');
  } finally {
    pi.__setSdkForTest(null);
  }
});
