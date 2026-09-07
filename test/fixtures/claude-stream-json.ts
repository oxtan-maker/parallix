// A recorded-shape Claude `--output-format stream-json --include-partial-messages`
// stream covering every surface task-2461 must render: system/init, assistant
// text, thinking, tool call + tool result, an errored tool result, two
// concurrent Task sub-agents, a bare (unwrapped) SSE envelope, malformed and
// unknown records, and the final result event.

const TASK_ONE = 'toolu_task1';
const TASK_TWO = 'toolu_task2';

function wrap(event: object, parentToolUseId: string | null = null) {
  return { type: 'stream_event', event, parent_tool_use_id: parentToolUseId, session_id: 'sess-2461' };
}

const RECORDS: object[] = [
  { type: 'system', subtype: 'init', session_id: 'sess-2461', model: 'claude-opus-5', tools: ['Bash', 'Read', 'Task'] },
  wrap({ type: 'message_start', message: { id: 'msg_turn1', model: 'claude-opus-5', usage: { input_tokens: 1200, cache_read_input_tokens: 8000 } } }),

  // thinking block
  wrap({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }),
  wrap({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'The tail buffer is fed before the sink.' } }),
  wrap({ type: 'content_block_stop', index: 0 }),

  // assistant text, split across two deltas
  wrap({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }),
  wrap({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Checking the launcher ' } }),
  wrap({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'wiring.\n' } }),
  wrap({ type: 'content_block_stop', index: 1 }),

  // tool call with streamed partial input JSON
  wrap({ type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'toolu_bash1', name: 'Bash', input: {} } }),
  wrap({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"command":"ls ' } }),
  wrap({ type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: 'src/adapters"}' } }),
  wrap({ type: 'content_block_stop', index: 2 }),
  { type: 'user', session_id: 'sess-2461', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_bash1', content: 'agents\nprocess' }] } },

  // an errored tool result
  wrap({ type: 'content_block_start', index: 3, content_block: { type: 'tool_use', id: 'toolu_read1', name: 'Read', input: {} } }),
  wrap({ type: 'content_block_delta', index: 3, delta: { type: 'input_json_delta', partial_json: '{"file_path":"/nope.ts"}' } }),
  wrap({ type: 'content_block_stop', index: 3 }),
  { type: 'user', session_id: 'sess-2461', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_read1', is_error: true, content: 'ENOENT: no such file' }] } },

  // two concurrent Task sub-agents
  wrap({ type: 'content_block_start', index: 4, content_block: { type: 'tool_use', id: TASK_ONE, name: 'Task', input: {} } }),
  wrap({ type: 'content_block_delta', index: 4, delta: { type: 'input_json_delta', partial_json: '{"subagent_type":"Explore","description":"map renderers"}' } }),
  wrap({ type: 'content_block_stop', index: 4 }),
  wrap({ type: 'content_block_start', index: 5, content_block: { type: 'tool_use', id: TASK_TWO, name: 'Task', input: {} } }),
  wrap({ type: 'content_block_delta', index: 5, delta: { type: 'input_json_delta', partial_json: '{"subagent_type":"Plan","description":"plan the wiring"}' } }),
  wrap({ type: 'content_block_stop', index: 5 }),

  // interleaved sub-agent activity — both reuse block index 0
  wrap({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, TASK_ONE),
  wrap({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }, TASK_TWO),
  wrap({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'scanning src/adapters' } }, TASK_ONE),
  wrap({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'drafting the plan' } }, TASK_TWO),
  wrap({ type: 'content_block_stop', index: 0 }, TASK_ONE),
  wrap({ type: 'content_block_stop', index: 0 }, TASK_TWO),
  { type: 'user', session_id: 'sess-2461', message: { content: [{ type: 'tool_result', tool_use_id: TASK_ONE, content: [{ type: 'text', text: 'found 3 renderers' }] }] } },
  { type: 'user', session_id: 'sess-2461', message: { content: [{ type: 'tool_result', tool_use_id: TASK_TWO, content: [{ type: 'text', text: 'plan ready' }] }] } },

  // bare (unwrapped) SSE envelope — the second shape claude-telemetry.ts documents
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 640 } },

  // an unknown event type must degrade, not throw
  { type: 'some_future_event', payload: { anything: true } },

  { type: 'result', subtype: 'success', session_id: 'sess-2461', duration_ms: 42000, num_turns: 4, total_cost_usd: 0.1234, usage: { input_tokens: 1200, output_tokens: 640, cache_read_input_tokens: 8000 } },
];

/** The fixture as the CLI would write it: one JSON record per line. */
export const CLAUDE_STREAM_FIXTURE: string = RECORDS.map(r => JSON.stringify(r)).join('\n') + '\n';

/** The same stream with malformed and non-JSON lines spliced in. */
export const CLAUDE_STREAM_FIXTURE_WITH_GARBAGE: string = [
  'Loading Claude Code…',
  '{"type":"system","subtype":"init","session_id":"sess-2461","model":"claude-opus-5"',
  ...CLAUDE_STREAM_FIXTURE.trimEnd().split('\n'),
].join('\n') + '\n';

export const SUBAGENT_IDS = { one: TASK_ONE, two: TASK_TWO };
