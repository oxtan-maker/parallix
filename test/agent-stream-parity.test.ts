import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeStreamNormalizer } from '../src/adapters/agents/claude-stream-render.js';
import { PiStreamNormalizer } from '../src/adapters/agents/pi-stream-render.js';
import { AgentStreamView, createAgentStreamRenderer } from '../src/adapters/agents/agent-stream-view.js';
import { summarizeToolResult, type NormalizedEvent } from '../src/adapters/agents/agent-stream-events.js';
import { createOutputWatchdog } from '../src/adapters/process/output-watchdog.js';

function sink(isTTY = false) {
  return { text: '', isTTY, write(text: string) { this.text += text; } };
}

test('Claude and Pi events produce identical text, reasoning, command, and result output', () => {
  const claude = new ClaudeStreamNormalizer();
  const pi = new PiStreamNormalizer();
  const claudeEvents = claude.push([
    { type: 'assistant', message: { id: 'one', content: [
      { type: 'text', text: 'Checking.' }, { type: 'thinking', thinking: 'Inspecting.' },
      { type: 'tool_use', id: 'tool-one', name: 'Bash', input: { command: 'git status' } },
    ] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-one', content: [{ type: 'text', text: 'clean' }] }] } },
    { type: 'assistant', message: { id: 'two', content: [{ type: 'text', text: 'Done.' }] } },
  ].map(e => JSON.stringify(e)).join('\n') + '\n');
  const piEvents = [
    { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Checking.' } },
    { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'Inspecting.' } },
    { type: 'tool_execution_start', toolCallId: 'tool-one', toolName: 'bash', args: { command: 'git status' } },
    { type: 'tool_execution_end', toolCallId: 'tool-one', toolName: 'bash', result: { content: [{ type: 'text', text: 'clean' }] } },
    { type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Done.' } },
  ].flatMap(e => pi.push(e));
  const output = (events: NormalizedEvent[]) => {
    const target = sink();
    const view = new AgentStreamView(target, {}, { FORCE_COLOR: '0' });
    view.render(events);
    view.end();
    return target.text;
  };
  assert.equal(output(claudeEvents), output(piEvents));
  assert.equal(output(piEvents), 'Checking.\n✳ Inspecting.\n⚒ git status\n  ✓ clean\nDone.\n');
});

test('shell names never appear in command entries, completion entries, or idle indicators', () => {
  for (const name of ['Bash', 'bash']) {
    const target = sink(true);
    let clock = 0;
    const view = new AgentStreamView(target, { now: () => clock, idleMs: 1 }, { FORCE_COLOR: '0' });
    view.render([{ kind: 'tool_start', id: 'one', name, input: 'git status', agent: null, isSubagent: false }]);
    clock = 100;
    view.tick();
    view.render([{ kind: 'tool_result', id: 'one', name, summary: 'clean', isError: false, agent: null, isSubagent: false }]);
    view.render([{ kind: 'tool_start', id: 'two', name, input: '', agent: null, isSubagent: false }]);
    clock = 200;
    view.tick();
    view.end();
    assert.match(target.text, /⚒ git status/);
    assert.match(target.text, /✓ clean/);
    assert.match(target.text, /running command/);
    assert.doesNotMatch(target.text, /\bbash\b/i);
  }
});

test('Pi whole messages render once and streamed messages are not duplicated', () => {
  const pi = new PiStreamNormalizer();
  pi.push({ type: 'message_start', message: { role: 'assistant' } });
  pi.push({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'first' } });
  assert.deepEqual(pi.push({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'first' }] } }), []);
  pi.push({ type: 'message_start', message: { role: 'assistant' } });
  assert.deepEqual(pi.push({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: 'second' }] } }),
    [{ kind: 'text', text: 'second', agent: null }]);
});

test('the common result summary retains Pi length and summarizes every content block', () => {
  assert.equal(summarizeToolResult([{ type: 'text', text: 'one' }, { type: 'image' }, { type: 'text', text: 'two' }]), 'one [image] two');
  assert.equal(summarizeToolResult('a'.repeat(250)), 'a'.repeat(199) + '…');
});

test('Pi reports sub-agent progress with distinct call labels and no repeated long prompt', () => {
  const pi = new PiStreamNormalizer();
  const target = sink();
  const view = new AgentStreamView(target, {}, { FORCE_COLOR: '0' });
  for (const id of ['one', 'two']) {
    view.render(pi.push({ type: 'tool_execution_start', toolCallId: id, toolName: 'subagent', args: { agent: 'scout', task: 'map code', prompt: 'hidden long prompt' } }));
    view.render(pi.push({ type: 'tool_execution_update', toolCallId: id, toolName: 'subagent', partialResult: { content: [{ type: 'text', text: 'scanning files' }] } }));
    view.render(pi.push({ type: 'tool_execution_end', toolCallId: id, toolName: 'subagent', result: { content: [{ type: 'text', text: 'mapped' }] } }));
  }
  assert.match(target.text, /subagent#1 scout scanning files/);
  assert.match(target.text, /subagent#2 scout scanning files/);
  assert.doesNotMatch(target.text, /hidden long prompt/);
});

test('Pi retries and compaction set and clear the common activity indicator', () => {
  const pi = new PiStreamNormalizer();
  const target = sink(true);
  let clock = 0;
  const view = new AgentStreamView(target, { idleMs: 1, now: () => clock }, { FORCE_COLOR: '0' });
  for (const start of [
    { type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 500, errorMessage: 'overloaded' },
    { type: 'compaction_start', reason: 'threshold' },
  ]) {
    view.render(pi.push(start));
    clock += 100;
    view.tick();
  }
  assert.match(target.text, /retrying/);
  assert.match(target.text, /compacting context/);
  view.render(pi.push({ type: 'compaction_end' }));
  clock += 100;
  view.tick();
  assert.match(target.text.slice(target.text.lastIndexOf('\r')), /working/);
});

test('renderer timers close idempotently and sink faults cannot fail a launch', () => {
  mock.timers.enable({ apis: ['setInterval', 'Date'] });
  let writes = 0;
  const renderer = createAgentStreamRenderer({ isTTY: true, write() { writes++; throw new Error('sink broken'); } }, { idleMs: 0 });
  assert.doesNotThrow(() => mock.timers.tick(250));
  assert.doesNotThrow(() => renderer.render([{ kind: 'text', text: 'ok', agent: null }]));
  renderer.close();
  renderer.close();
  const closedWrites = writes;
  mock.timers.tick(1000);
  renderer.render([{ kind: 'text', text: 'ignored', agent: null }]);
  assert.equal(writes, closedWrites);
  mock.timers.reset();
});

test('dumb terminals do not receive spinner control sequences', () => {
  const target = sink(true);
  const view = new AgentStreamView(target, { idleMs: 0 }, { TERM: 'dumb' });
  view.tick();
  view.end();
  assert.equal(target.text, '');
});

test('shared watchdog reports later stalls, tolerates callback faults, and stops when cleared', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const events: any[] = [];
  const watchdog = createOutputWatchdog({ initialDelayMs: 10, intervalMs: 10, onNoOutput: event => {
    events.push(event); if (events.length === 1) { throw new Error('report failed'); }
  } }, { command: 'agent', args: [], pid: 42 });
  mock.timers.tick(10);
  watchdog.noteOutput();
  mock.timers.tick(10);
  assert.equal(events.length, 2);
  assert.equal(events[1].sawOutput, true);
  assert.equal(events[1].msSinceLastOutput, 10);
  assert.equal(events[1].pid, 42);
  watchdog.clear();
  mock.timers.tick(100);
  assert.equal(events.length, 2);
  mock.timers.reset();
});


test('Pi reasoning without visible text still produces a thinking summary', () => {
  const pi = new PiStreamNormalizer();
  assert.deepEqual(pi.push({ type: 'message_update', assistantMessageEvent: { type: 'thinking_start' } }), [{ kind: 'thinking_progress', tokens: null }]);
  pi.push({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: '' } });
  assert.deepEqual(pi.push({ type: 'message_update', assistantMessageEvent: { type: 'thinking_end' } }), [{ kind: 'thinking_summary', tokens: null, agent: null }]);
});
