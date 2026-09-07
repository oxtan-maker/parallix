import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ClaudeStreamNormalizer,
  condense,
  summarizeToolInput,
  type NormalizedEvent,
} from '../src/adapters/agents/claude-stream-render.js';
import {
  ClaudeStreamView,
  colorEnabled,
  createClaudeRenderSink,
  rawStreamRequested,
  RAW_STREAM_ENV,
} from '../src/adapters/agents/claude-stream-view.js';
import { TailBuffer } from '../src/adapters/process/spawn-tee.js';
import {
  extractClaudeSessionId,
  extractClaudeTelemetryFromStdout,
  startClaudeAgent,
  __setSpawnAndTeeForTest,
} from '../src/adapters/agents/claude.js';
import {
  CLAUDE_STREAM_FIXTURE,
  CLAUDE_STREAM_FIXTURE_WITH_GARBAGE,
} from './fixtures/claude-stream-json.js';

function normalizeAll(stream: string, chunkBytes: number | null = null): NormalizedEvent[] {
  const normalizer = new ClaudeStreamNormalizer();
  const events: NormalizedEvent[] = [];
  if (chunkBytes === null) {
    events.push(...normalizer.push(stream));
  } else {
    const bytes = Buffer.from(stream, 'utf8');
    for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
      events.push(...normalizer.push(bytes.subarray(offset, offset + chunkBytes)));
    }
  }
  events.push(...normalizer.flush());
  return events;
}

// ---------- event normalization ----------

test('normalizer covers every required surface of the recorded stream-json fixture', () => {
  const events = normalizeAll(CLAUDE_STREAM_FIXTURE);

  const system = events.find(e => e.kind === 'system');
  assert.ok(system && system.kind === 'system');
  assert.equal(system.model, 'claude-opus-5');
  assert.equal(system.sessionId, 'sess-2461');

  const text = events.filter(e => e.kind === 'text' && e.agent === null);
  assert.ok(text.length >= 2, 'assistant text deltas are normalized');

  const thinking = events.filter(e => e.kind === 'thinking');
  assert.equal(thinking.length, 1);
  assert.match((thinking[0] as { text: string }).text, /tail buffer/);

  const bash = events.find(e => e.kind === 'tool_start' && e.name === 'Bash');
  assert.ok(bash && bash.kind === 'tool_start');
  assert.equal(bash.input, 'ls src/adapters', 'partial input_json deltas are reassembled');

  const results = events.filter(e => e.kind === 'tool_result');
  assert.ok(results.some(r => r.kind === 'tool_result' && !r.isError && r.name === 'Bash'));
  const errored = results.find(r => r.kind === 'tool_result' && r.isError);
  assert.ok(errored && errored.kind === 'tool_result');
  assert.match(errored.summary, /ENOENT/);

  const final = events.find(e => e.kind === 'result');
  assert.ok(final && final.kind === 'result');
  assert.equal(final.durationMs, 42000);
  assert.equal(final.costUsd, 0.1234);
  assert.equal(final.outputTokens, 640);
  assert.equal(final.isError, false);
});

test('normalizer keeps two concurrent sub-agents separately labelled', () => {
  const events = normalizeAll(CLAUDE_STREAM_FIXTURE);

  const starts = events.filter(e => e.kind === 'tool_start' && e.isSubagent);
  assert.equal(starts.length, 2, 'both Task tool calls are seen');

  const labels = events
    .filter(e => e.kind === 'text' && e.agent !== null)
    .map(e => (e as { agent: string; text: string }));
  assert.equal(labels.length, 2, 'neither sub-agent text delta is dropped');
  assert.notEqual(labels[0].agent, labels[1].agent, 'the two sub-agents get distinct labels');
  assert.match(labels[0].agent, /Explore/);
  assert.match(labels[1].agent, /Plan/);
  assert.equal(labels[0].text, 'scanning src/adapters');
  assert.equal(labels[1].text, 'drafting the plan');

  const subagentResults = events.filter(e => e.kind === 'tool_result' && e.isSubagent);
  assert.equal(subagentResults.length, 2, 'both sub-agent completions are reported');
  assert.notEqual(
    (subagentResults[0] as { name: string }).name,
    (subagentResults[1] as { name: string }).name,
  );
});

// ---------- chunk-boundary framing ----------

test('normalizer emits identical events for a whole-stream write and byte-split writes', () => {
  const whole = normalizeAll(CLAUDE_STREAM_FIXTURE);
  const perByte = normalizeAll(CLAUDE_STREAM_FIXTURE, 1);
  const oddChunks = normalizeAll(CLAUDE_STREAM_FIXTURE, 7);
  assert.deepEqual(perByte, whole, 'a record split across chunks renders exactly once');
  assert.deepEqual(oddChunks, whole);
});

test('normalizer does not corrupt a multi-byte character split across two chunks', () => {
  const line = `${JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'héllo — ✅' } } })}\n`;
  const bytes = Buffer.from(line, 'utf8');
  const normalizer = new ClaudeStreamNormalizer();
  const events: NormalizedEvent[] = [];
  for (let i = 0; i < bytes.length; i += 1) {
    events.push(...normalizer.push(bytes.subarray(i, i + 1)));
  }
  assert.equal(events.length, 1);
  assert.equal((events[0] as { text: string }).text, 'héllo — ✅');
});

test('normalizer emits a record left unterminated at end of stream', () => {
  const normalizer = new ClaudeStreamNormalizer();
  const pushed = normalizer.push('{"type":"system","model":"claude-opus-5","session_id":"s1"}');
  assert.deepEqual(pushed, []);
  const flushed = normalizer.flush();
  assert.equal(flushed.length, 1);
  assert.equal(flushed[0].kind, 'system');
});

test('normalizer drops CLI bookkeeping records that carry no activity', () => {
  // Recorded from a real `--output-format stream-json --verbose` run: the CLI
  // emits `system` records for status and hooks alongside the init record, and
  // top-level rate-limit / tool-progress records. Only init describes the
  // session; the rest must not reach the operator's view.
  const events = normalizeAll([
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', model: 'claude-opus-5', tools: ['Bash'] }),
    JSON.stringify({ type: 'system', subtype: 'status', session_id: 's1', status: {} }),
    JSON.stringify({ type: 'system', subtype: 'hook_started', session_id: 's1', hook_name: 'SessionStart' }),
    JSON.stringify({ type: 'system', subtype: 'hook_response', session_id: 's1', exit_code: 0 }),
    JSON.stringify({ type: 'rate_limit_event', session_id: 's1', rate_limit_info: { status: 'allowed' } }),
    JSON.stringify({ type: 'tool_progress', session_id: 's1' }),
  ].join('\n') + '\n');

  assert.equal(events.length, 1, 'only the init record renders');
  assert.equal(events[0].kind, 'system');
});

test('the Agent sub-agent tool is labelled as a sub-agent, not dumped as raw input', () => {
  // The CLI ships the sub-agent launcher as `Agent`; recorded runs show its
  // input carrying the whole sub-agent prompt, which buries the view when it
  // falls through to the compact-JSON summary.
  const events = normalizeAll([
    JSON.stringify({
      type: 'assistant',
      message: { id: 'msg_a', content: [{ type: 'tool_use', id: 'toolu_agent1', name: 'Agent', input: { subagent_type: 'Explore', description: 'Count files in src', prompt: 'x'.repeat(400) } }] },
    }),
    JSON.stringify({ type: 'stream_event', parent_tool_use_id: 'toolu_agent1', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } }),
    JSON.stringify({ type: 'stream_event', parent_tool_use_id: 'toolu_agent1', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'counting' } } }),
    JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_agent1', content: '303 files' }] } }),
  ].join('\n') + '\n');

  const start = events.find(e => e.kind === 'tool_start');
  assert.ok(start && start.kind === 'tool_start');
  assert.equal(start.isSubagent, true);
  assert.equal(start.input, 'Explore · Count files in src', 'the prompt body is not dumped');

  const nested = events.find(e => e.kind === 'text');
  assert.ok(nested && nested.kind === 'text');
  assert.equal(nested.agent, 'Agent#1 Explore', 'nested activity is attributed to the sub-agent');

  const result = events.find(e => e.kind === 'tool_result');
  assert.ok(result && result.kind === 'tool_result');
  assert.equal(result.isSubagent, true);
  assert.equal(result.name, 'Agent#1 Explore');
});

test('encrypted thinking still reports that the model reasoned', () => {
  // Recorded shape: the thinking block streams empty `thinking_delta`s plus a
  // signature, and the only observable evidence is the CLI's
  // `system`/`thinking_tokens` counter.
  const stream = [
    JSON.stringify({ type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_a' } } }),
    JSON.stringify({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } } }),
    JSON.stringify({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: 50, estimated_tokens_delta: 50 }),
    JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '' } } }),
    JSON.stringify({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: 148, estimated_tokens_delta: 98 }),
    JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'CAISxgQ' } } }),
    JSON.stringify({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } }),
  ].join('\n') + '\n';

  const summary = normalizeAll(stream).find(e => e.kind === 'thinking_summary');
  assert.ok(summary && summary.kind === 'thinking_summary');
  assert.equal(summary.tokens, 148);
  assert.match(renderFixture(stream), /✳ thinking · 148 tokens/);
});

test('visible thinking text is streamed and not replaced by a token summary', () => {
  const stream = [
    JSON.stringify({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } } }),
    JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'weighing the seam' } } }),
    JSON.stringify({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } }),
  ].join('\n') + '\n';

  assert.ok(!normalizeAll(stream).some(e => e.kind === 'thinking_summary'), 'no summary when the text itself is visible');
  assert.match(renderFixture(stream), /✳ weighing the seam/);
});

test('a silent sub-agent reports progress; a relayed one is not narrated twice', () => {
  const launch = JSON.stringify({
    type: 'assistant',
    message: { id: 'msg_a', content: [{ type: 'tool_use', id: 'toolu_bg', name: 'Agent', input: { subagent_type: 'Explore', description: 'count files' } }] },
  });
  const progress = JSON.stringify({
    type: 'system', subtype: 'task_progress', tool_use_id: 'toolu_bg',
    description: 'Running Breakdown by extension', usage: { tool_uses: 2 },
  });

  const silent = normalizeAll([launch, progress].join('\n') + '\n');
  const reported = silent.find(e => e.kind === 'agent_progress');
  assert.ok(reported && reported.kind === 'agent_progress');
  assert.equal(reported.agent, 'Agent#1 Explore');
  assert.equal(reported.toolUses, 2);
  assert.match(renderFixture([launch, progress].join('\n') + '\n'), /↳ Agent#1 Explore Running Breakdown by extension · 2 tool uses/);

  const relayed = [
    launch,
    JSON.stringify({ type: 'stream_event', parent_tool_use_id: 'toolu_bg', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } }),
    progress,
  ].join('\n') + '\n';
  assert.ok(
    !normalizeAll(relayed).some(e => e.kind === 'agent_progress'),
    'a sub-agent whose own events are relayed inline is not narrated a second time',
  );
});

test('the progress indicator names the current activity', () => {
  let clock = 0;
  const sink = captureSink(true);
  const view = new ClaudeStreamView(sink, { idleMs: 10, now: () => clock, clearWidth: 8 }, { NO_COLOR: '1' });

  view.render(normalizeAll(JSON.stringify({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: 148 }) + '\n'));
  clock = 1000;
  view.tick();
  assert.match(sink.text, /thinking 148 tokens/, 'opaque thinking is visible as a live indicator');

  view.render([{ kind: 'tool_start', id: 't1', name: 'Bash', input: 'npm test', agent: null, isSubagent: false }]);
  clock = 2000;
  view.tick();
  assert.match(sink.text, /Bash… 1\.0s/, 'the elapsed time is the running tool\'s own, not the whole run\'s');

  view.render([{ kind: 'tool_result', id: 't1', name: 'Bash', isError: false, summary: 'ok', agent: null, isSubagent: false }]);
  clock = 3000;
  view.tick();
  assert.match(sink.text.slice(sink.text.lastIndexOf('\r')), /working… /, 'the label falls back once the call completes');
});

// ---------- degradation ----------

test('normalizer survives malformed, plain-text, and unknown records', () => {
  const events = normalizeAll(CLAUDE_STREAM_FIXTURE_WITH_GARBAGE);

  assert.ok(
    events.some(e => e.kind === 'passthrough' && e.text === 'Loading Claude Code…'),
    'a plain-text line passes through',
  );
  assert.ok(
    events.some(e => e.kind === 'unknown' && e.type === 'some_future_event'),
    'an unknown type degrades to a fallback event',
  );
  // The truncated `{"type":"system"…` line is dropped, and every later valid
  // event still renders: the result event is the last record in the stream.
  const final = events[events.length - 1];
  assert.equal(final.kind, 'result');
  assert.ok(events.some(e => e.kind === 'tool_start' && e.name === 'Bash'));
});

test('normalizer keeps a whole-message turn that follows a streamed turn', () => {
  // Mixed stream: turn 1 arrives as partial events plus its duplicate complete
  // record; turn 2 arrives only as a complete record and must still render.
  const stream = [
    JSON.stringify({ type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_a', model: 'claude-opus-5' } } }),
    JSON.stringify({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } }),
    JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'streamed turn' } } }),
    JSON.stringify({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } }),
    JSON.stringify({ type: 'assistant', message: { id: 'msg_a', content: [{ type: 'text', text: 'streamed turn' }] } }),
    JSON.stringify({ type: 'assistant', message: { id: 'msg_b', content: [{ type: 'text', text: 'whole turn' }, { type: 'tool_use', id: 'toolu_b', name: 'Bash', input: { command: 'echo hi' } }] } }),
  ].join('\n') + '\n';

  const texts = normalizeAll(stream).filter(e => e.kind === 'text').map(e => (e as { text: string }).text);
  assert.deepEqual(texts, ['streamed turn', 'whole turn'], 'the duplicate is dropped and the later whole turn survives');

  const tools = normalizeAll(stream).filter(e => e.kind === 'tool_start');
  assert.equal(tools.length, 1, 'a tool call inside the later whole turn is not lost');
  assert.equal((tools[0] as { name: string; input: string }).input, 'echo hi');
});

test('normalizer treats an id-less assistant fallback message as a duplicate once partial events were seen', () => {
  const assistantMessage = JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'text', text: 'Checking the launcher wiring.\n' }] },
  });
  const withPartials = normalizeAll(`${CLAUDE_STREAM_FIXTURE}${assistantMessage}\n`);
  const baseline = normalizeAll(CLAUDE_STREAM_FIXTURE);
  assert.deepEqual(withPartials, baseline, 'the duplicate complete message is not rendered twice');

  const withoutPartials = normalizeAll(`${assistantMessage}\n`);
  assert.equal(withoutPartials.length, 1, 'without partial events the complete message is the only source');
  assert.equal(withoutPartials[0].kind, 'text');
});

// ---------- input condensing ----------

test('tool input is condensed to its salient field', () => {
  assert.equal(summarizeToolInput('Bash', { command: 'npm test', timeout: 5000 }), 'npm test');
  assert.equal(summarizeToolInput('Read', { file_path: '/a/b.ts', offset: 10 }), '/a/b.ts');
  assert.equal(summarizeToolInput('Task', { subagent_type: 'Explore', description: 'map it' }), 'Explore · map it');
  assert.equal(summarizeToolInput('Unheard', { a: 1 }), '{"a":1}');
  assert.equal(summarizeToolInput('Unheard', {}), '');
});

test('condense collapses whitespace and caps length', () => {
  assert.equal(condense('a\n  b\tc'), 'a b c');
  const long = condense('x'.repeat(300));
  assert.equal(long.length, 120);
  assert.ok(long.endsWith('…'));
});

// ---------- rendering (CP-3) ----------

interface CapturedSink { write(_text: string): void; isTTY?: boolean; text: string }

function captureSink(isTTY = false): CapturedSink {
  const sink: CapturedSink = { text: '', isTTY, write(chunk: string) { sink.text += chunk; } };
  return sink;
}

function renderFixture(
  stream: string = CLAUDE_STREAM_FIXTURE,
  { isTTY = false, env = { NO_COLOR: '1' } as NodeJS.ProcessEnv } = {},
): string {
  const sink = captureSink(isTTY);
  const view = new ClaudeStreamView(sink, {}, env);
  view.render(normalizeAll(stream));
  view.end();
  return sink.text;
}

test('rendered fixture shows every required surface and no raw JSON envelope', () => {
  const out = renderFixture();

  assert.match(out, /● claude-opus-5 · session sess-2461 · 3 tools/, 'system/init line');
  assert.match(out, /Checking the launcher wiring\./, 'assistant text');
  assert.match(out, /✳ The tail buffer is fed before the sink\./, 'thinking block');
  assert.match(out, /⚒ Bash ls src\/adapters/, 'tool call with name and condensed input');
  assert.match(out, /✓ Bash/, 'tool result');
  assert.match(out, /✗ Read .*ENOENT/, 'tool error');
  assert.match(out, /▶ sub-agent Explore/, 'sub-agent activity');
  assert.match(out, /● done .*\$0\.1234/, 'final result line with cost');
  assert.match(out, /42\.0s/, 'final result line with duration');

  assert.ok(!out.includes('{"type":'), 'no raw stream-json envelope reaches the terminal');
});

test('two concurrent sub-agents render as two separately labelled entries', () => {
  const out = renderFixture();
  const explore = out.match(/↳ Task#1 Explore/g) ?? [];
  const plan = out.match(/↳ Task#2 Plan/g) ?? [];
  assert.ok(explore.length >= 1, 'first sub-agent is labelled');
  assert.ok(plan.length >= 1, 'second sub-agent is labelled');
  assert.match(out, /↳ Task#1 Explore .*scanning src\/adapters/);
  assert.match(out, /↳ Task#2 Plan .*drafting the plan/);
});

test('non-TTY output carries no ANSI escapes and no spinner frames', () => {
  const out = renderFixture(CLAUDE_STREAM_FIXTURE, { isTTY: false, env: {} });
  assert.ok(!out.includes('\x1b['), 'no ANSI escape sequences off a TTY');
  assert.ok(!/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/.test(out), 'no spinner residue off a TTY');
  assert.ok(!out.includes('\r'), 'no carriage-return cursor control off a TTY');
});

test('NO_COLOR suppresses ANSI escapes even on a TTY sink', () => {
  const colored = renderFixture(CLAUDE_STREAM_FIXTURE, { isTTY: true, env: {} });
  assert.ok(colored.includes('\x1b['), 'a TTY sink is coloured by default');
  const plain = renderFixture(CLAUDE_STREAM_FIXTURE, { isTTY: true, env: { NO_COLOR: '1' } });
  assert.ok(!plain.includes('\x1b['), 'NO_COLOR wins over the TTY sink');
  assert.equal(colorEnabled({ write: () => {}, isTTY: true }, { FORCE_COLOR: '0' }), false);
  assert.equal(colorEnabled({ write: () => {}, isTTY: false }, { FORCE_COLOR: '1' }), true);
});

test('idle progress indicator is emitted on a TTY and cleared before the next line', () => {
  const sink = captureSink(true);
  let clock = 0;
  const view = new ClaudeStreamView(sink, { idleMs: 100, now: () => clock, clearWidth: 8 }, { NO_COLOR: '1' });

  view.tick();
  assert.equal(sink.text, '', 'no indicator before the idle threshold');

  clock = 500;
  view.tick();
  assert.match(sink.text, /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] working…/, 'indicator appears once the stream is idle');

  view.render([{ kind: 'unknown', type: 'later_event' }]);
  assert.match(sink.text, /\r {8}\r/, 'the indicator is erased before the next rendered line');
  assert.ok(sink.text.trimEnd().endsWith('· later_event'), 'the next line follows the cleared indicator');

  view.end();
  const frames = sink.text.match(/[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/g) ?? [];
  assert.equal(frames.length, 1, 'no spinner residue is left behind');
});

test('renderer output is identical for one-chunk and byte-split fixture streams', () => {
  const whole = captureSink();
  const split = captureSink();
  const wholeView = new ClaudeStreamView(whole, {}, { NO_COLOR: '1' });
  wholeView.render(normalizeAll(CLAUDE_STREAM_FIXTURE));
  wholeView.end();
  const splitView = new ClaudeStreamView(split, {}, { NO_COLOR: '1' });
  splitView.render(normalizeAll(CLAUDE_STREAM_FIXTURE, 1));
  splitView.end();
  assert.equal(split.text, whole.text);
});

// ---------- wiring and telemetry safety (CP-4) ----------

/**
 * Reproduce spawnAndTee's stdout handling: the chunk goes into the tail buffer
 * first, then to the terminal sink. See `src/adapters/process/spawn-tee.ts`.
 */
function teeThrough(stream: string, sink: { write(_chunk: Buffer): unknown } | null, chunkBytes = 64): string {
  const tail = new TailBuffer(8 * 1024 * 1024);
  const bytes = Buffer.from(stream, 'utf8');
  for (let offset = 0; offset < bytes.length; offset += chunkBytes) {
    const chunk = bytes.subarray(offset, offset + chunkBytes);
    tail.push(chunk);
    sink?.write(chunk);
  }
  return tail.toString();
}

test('telemetry from the fixture is identical with and without the renderer sink', () => {
  const terminal = captureSink();
  const rendered = createClaudeRenderSink(terminal, {}, { NO_COLOR: '1' });
  const withRenderer = teeThrough(CLAUDE_STREAM_FIXTURE, rendered);
  rendered.close();
  const withoutRenderer = teeThrough(CLAUDE_STREAM_FIXTURE, null);

  assert.equal(withRenderer, withoutRenderer, 'the captured tail is byte-identical');
  assert.equal(withRenderer, CLAUDE_STREAM_FIXTURE, 'the tail is the unmodified raw stream');
  assert.deepEqual(
    extractClaudeTelemetryFromStdout(withRenderer),
    extractClaudeTelemetryFromStdout(withoutRenderer),
  );
  assert.equal(extractClaudeSessionId(withRenderer), extractClaudeSessionId(withoutRenderer));
  assert.equal(extractClaudeSessionId(withRenderer), 'sess-2461');
  assert.equal(extractClaudeTelemetryFromStdout(withRenderer)?.outputTokens, 640);
  assert.ok(terminal.text.length > 0, 'the operator still sees rendered output');
  assert.ok(!terminal.text.includes('{"type":'));
});

test('the raw-stream escape hatch writes the unmodified stream to the terminal sink', () => {
  const terminal = captureSink();
  const raw = createClaudeRenderSink(terminal, {}, { [RAW_STREAM_ENV]: '1' });
  teeThrough(CLAUDE_STREAM_FIXTURE, raw, 17);
  raw.close();
  assert.equal(terminal.text, CLAUDE_STREAM_FIXTURE, 'raw mode is a verbatim passthrough');

  assert.equal(rawStreamRequested({ [RAW_STREAM_ENV]: '1' }), true);
  assert.equal(rawStreamRequested({ [RAW_STREAM_ENV]: '0' }), false);
  assert.equal(rawStreamRequested({}), false);
});

test('the render sink renders a chunk-split stream exactly once', () => {
  const perByte = captureSink();
  const sink = createClaudeRenderSink(perByte, {}, { NO_COLOR: '1' });
  teeThrough(CLAUDE_STREAM_FIXTURE, sink, 1);
  sink.close();
  assert.equal(perByte.text, renderFixture(), 'byte-split input renders like a single write');
});

test('startClaudeAgent attaches the renderer sink without changing the telemetry tail size', async () => {
  const captured: Array<Record<string, any>> = [];
  __setSpawnAndTeeForTest((_command: string, _args: string[], options: Record<string, any>) => {
    captured.push(options);
    return Promise.resolve({ status: 0, stdout: CLAUDE_STREAM_FIXTURE, stderr: '' });
  });
  try {
    const { resultPromise } = startClaudeAgent({ prompt: 'p', worktree: '/tmp' });
    const result = await resultPromise;
    assert.equal(captured.length, 1);
    assert.equal(captured[0].maxTailBytes, 8 * 1024 * 1024, 'the telemetry tail budget is unchanged');
    assert.equal(typeof captured[0].stdoutSink.write, 'function', 'a renderer sink is attached');
    assert.equal(typeof captured[0].stdoutSink.close, 'function');
    // Telemetry still comes from the raw stdout the tail captured.
    assert.equal(result.sessionId, 'sess-2461');
    assert.equal(result.telemetry.outputTokens, 640);
    assert.equal(result.telemetry.cost_usd, 0.1234);
  } finally {
    __setSpawnAndTeeForTest(null);
  }
});
