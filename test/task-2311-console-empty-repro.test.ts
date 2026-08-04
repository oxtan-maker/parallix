// Reproduction test for task-2311: after pi tech change console is empty
//
// The pi agent was switched from spawnAndTee (subprocess) to the
// @earendil-works/pi-coding-agent SDK (createAgentSession).
// The SDK collects output through event subscriptions and returns it at
// the end — teeOptions is received but ignored, so nothing is written to
// process.stdout during execution. This test locks the bug by verifying
// that process.stdout.write IS called with text content during a mocked
// SDK session. It fails (red) on the parent commit and turns green once
// the fix lands.
const test = require('node:test');
const assert = require('node:assert/strict');
const pi = require('../.test-runtime/adapters/agents/pi.js');

test.afterEach(() => {
  pi.__setSdkForTest(null);
  pi.__setCreateAgentSessionForTest(null);
  pi.__setSessionsForTest(null);
});

test('startPiAgent writes text_delta to process.stdout during SDK execution (repro: console empty)', async () => {
  let stdoutWrites = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array, ...args: unknown[]) => {
    const encoding = typeof args[0] === 'string' ? args[0] : undefined;
    stdoutWrites.push({ chunk: typeof chunk === 'string' ? chunk : chunk.toString(), encoding });
    const callback = args.find((arg): arg is () => void => typeof arg === 'function');
    callback?.();
    return true;
  }) as typeof process.stdout.write;

  try {
    pi.__setCreateAgentSessionForTest(async () => {
      // SDK event stream with text_delta events that should be teed to stdout.
      const sdkEvents = [
        { type: 'agent_start' },
        { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Hello' } },
        { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: ' world' } },
        { type: 'tool_execution_end', toolName: 'bash', toolCallId: 't1', result: 'OK', isError: false },
        { type: 'message_end', message: { role: 'assistant' } },
        { type: 'agent_end', messages: [{ role: 'assistant' }] },
      ];
      let listener: any = null;
      const session = {
        sessionId: 'repro-session-001',
        subscribe: (l: any) => {
          listener = l;
          return () => { listener = null; };
        },
        prompt: async () => {
          // Emit events synchronously to the registered listener,
          // simulating the real SDK event stream.
          for (const event of sdkEvents) {
            if (listener) listener(event);
          }
        },
        waitForIdle: async () => {},
        dispose: () => {},
        getLastAssistantText: () => '',
        getSessionStats: () => ({
          sessionId: 'repro-session-001',
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

    // The fix: text_delta deltas should be written to process.stdout
    // during session execution (inside the subscribe callback).
    assert.ok(
      stdoutWrites.length > 0,
      `process.stdout.write should be called during SDK execution (got ${stdoutWrites.length} writes). Current code ignores teeOptions and does not tee text_delta to stdout.`
    );

    // Collect the text content written to stdout.
    const writtenText = stdoutWrites.map(w => w.chunk).join('');
    assert.ok(
      writtenText.includes('Hello'),
      `stdout output should contain "Hello" from text_delta events. Got: "${writtenText}"`
    );
    assert.ok(
      writtenText.includes('world'),
      `stdout output should contain "world" from text_delta events. Got: "${writtenText}"`
    );

    // Result should still be correct (stdout from getLastAssistantText or accumulator).
    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'Hello world');
  } finally {
    process.stdout.write = originalWrite;
  }
});

test('startPiAgent invokes teeOptions.noOutputWatchdog.onNoOutput when no text arrives (repro: watchdog ignored)', async () => {
  let watchdogCalled = false;
  let watchdogEvent = null;

  const teeOptions = {
    noOutputWatchdog: {
      initialDelayMs: 10,
      intervalMs: 50,
      onNoOutput: (event) => {
        watchdogCalled = true;
        watchdogEvent = event;
      },
    },
  };

  pi.__setCreateAgentSessionForTest(async () => {
    // Session that emits NO text_delta events — only internal chatter.
    // The watchdog should fire because no visible output arrives.
    const sdkEvents = [
      { type: 'agent_start' },
      { type: 'tool_execution_start', toolName: 'bash', toolCallId: 't1' },
      { type: 'tool_execution_end', toolName: 'bash', toolCallId: 't1', result: 'OK', isError: false },
      { type: 'agent_end', messages: [{ role: 'assistant' }] },
    ];
    let listener: any = null;
    const session = {
      sessionId: 'watchdog-session-001',
      subscribe: (l: any) => {
        listener = l;
        return () => { listener = null; };
      },
      prompt: async () => {
        for (const event of sdkEvents) {
          if (listener) listener(event);
        }
        // Simulate some processing delay so the watchdog timer has time to fire.
        await new Promise((resolve) => setTimeout(resolve, 100));
      },
      waitForIdle: async () => {},
      dispose: () => {},
      getLastAssistantText: () => '',
      getSessionStats: () => ({
        sessionId: 'watchdog-session-001',
        userMessages: 1,
        assistantMessages: 0,
        toolCalls: 1,
        toolResults: 1,
        totalMessages: 1,
        tokens: { input: 50, output: 0, cacheRead: 0, cacheWrite: 0, total: 50 },
        cost: 0,
      }),
    };
    return { session, extensionsResult: { extensions: [], diagnostics: [] } };
  });

  const { resultPromise } = pi.startPiAgent({
    prompt: 'Test',
    worktree: '/tmp/test',
    teeOptions,
  });
  const result = await resultPromise;

  // The fix: teeOptions.noOutputWatchdog.onNoOutput should be called
  // when no text_delta arrives within the configured initialDelayMs.
  assert.ok(
    watchdogCalled,
    'teeOptions.noOutputWatchdog.onNoOutput should be invoked when no text output arrives. Current code ignores teeOptions.'
  );
  assert.ok(watchdogEvent, 'Watchdog event object should be passed to callback');
  assert.ok(watchdogEvent.elapsedMs >= 10, `Watchdog elapsedMs (${watchdogEvent.elapsedMs}) should be >= initialDelayMs (10)`);

  // Result should still be correct.
  assert.equal(result.status, 0);
});
