// Human-readable rendering of the Claude CLI's `--output-format stream-json`
// stdout (ADR 0056).
//
// This module is attached to `spawnAndTee`'s `stdoutSink`, which is written
// strictly *after* `stdoutTail.push(chunk)`. The telemetry tail that
// `claude-telemetry.ts` parses therefore never sees anything this file does.
//
// Two envelope shapes arrive, exactly as documented in `claude-telemetry.ts`:
//   1. {"type":"stream_event","event":{…},"parent_tool_use_id":null|"toolu_…"}
//   2. bare top-level Anthropic SSE events
// plus the CLI's own top-level `system`, `assistant`, `user`, and `result`
// events.
//
// This file holds the normalization half (JSONL framing + event union). The
// terminal formatting half lives in `claude-stream-view.ts`.

import { StringDecoder } from 'node:string_decoder';

import { asRecord, finiteOrNull, condense, ToolCallTracker, type NormalizedEvent } from './agent-stream-events.js';
export { MAX_INPUT_SUMMARY, condense, summarizeToolInput, type NormalizedEvent } from './agent-stream-events.js';

/** Inner SSE / envelope types that carry no renderable surface of their own. */
const IGNORED_TYPES = new Set([
  'ping',
  'message_stop',
  'content_block_stop',
  'message_delta',
  'user',
  'stream_event',
  // Top-level CLI bookkeeping records. They arrive once or twice per turn and
  // say nothing about what the agent is doing, so rendering them as unknown
  // events was pure noise in the operator's view.
  'rate_limit_event',
  'tool_progress',
]);

interface OpenBlock {
  type: string;
  name: string;
  id: string | null;
  partialJson: string;
  agent: string | null;
  /** Whether the block produced any renderable text of its own. */
  sawText: boolean;
}

/**
 * Stateful normalizer: bytes in, `NormalizedEvent[]` out.
 *
 * Framing is chunk-boundary safe in both directions — a JSONL record split
 * across two writes is emitted exactly once, and a multi-byte UTF-8 character
 * split across two writes is not corrupted (`StringDecoder`).
 */
export class ClaudeStreamNormalizer {
  private decoder = new StringDecoder('utf8');
  private buffered = '';
  /** Open content blocks keyed by `<agent>:<block index>`. Concurrent
   *  sub-agents reuse the same block indices, so the index alone collides. */
  private blocks = new Map<string, OpenBlock>();
  private tools = new ToolCallTracker();
  /** Message ids already streamed as partial events. The CLI repeats each
   *  streamed turn as a complete top-level `assistant` record, so that record
   *  is a duplicate only when its own message id was streamed. A later turn
   *  delivered whole (no partials) still renders. */
  private streamedMessageIds = new Set<string>();
  /** Fallback for streams whose events carry no message id: once partials have
   *  been seen, an id-less complete message cannot be told apart from the
   *  duplicate, so it is treated as one. */
  private sawStreamEvents = false;
  /** Latest `system`/`thinking_tokens` estimate for the turn in flight. When
   *  thinking is returned encrypted, its deltas carry an empty string and this
   *  counter is the only observable evidence that the model is reasoning. */
  private thinkingTokens: number | null = null;
  /** Sub-agent tool_use ids whose own events are relayed inline. */
  private relayedAgents = new Set<string>();

  push(chunk: Buffer | string): NormalizedEvent[] {
    const text = typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    this.buffered += text;
    const events: NormalizedEvent[] = [];
    let newline = this.buffered.indexOf('\n');
    while (newline !== -1) {
      const line = this.buffered.slice(0, newline);
      this.buffered = this.buffered.slice(newline + 1);
      this.consumeLine(line, events);
      newline = this.buffered.indexOf('\n');
    }
    return events;
  }

  /** Emit whatever a final chunk left unterminated (stream ended without \n). */
  flush(): NormalizedEvent[] {
    const events: NormalizedEvent[] = [];
    const tail = this.buffered + this.decoder.end();
    this.buffered = '';
    if (tail.trim()) {this.consumeLine(tail, events);}
    return events;
  }

  private consumeLine(line: string, events: NormalizedEvent[]): void {
    const trimmed = line.trim();
    if (!trimmed) {return;}
    if (!trimmed.startsWith('{')) {
      events.push({ kind: 'passthrough', text: trimmed });
      return;
    }
    let outer: unknown;
    try {
      outer = JSON.parse(trimmed);
    } catch {
      // A truncated or malformed record is dropped; the stream continues.
      return;
    }
    const record = asRecord(outer);
    if (!record) {return;}
    try {
      this.consumeEvent(record, events);
    } catch {
      // Event-shape drift must degrade the view, never abort the stream
      // (ADR 0056, mission criterion 7).
      events.push({ kind: 'unknown', type: String(record.type ?? 'unknown') });
    }
  }

  private consumeEvent(outer: Record<string, any>, events: NormalizedEvent[]): void {
    const agent = this.tools.agentLabel(outer.parent_tool_use_id);
    if (agent && typeof outer.parent_tool_use_id === 'string') {this.relayedAgents.add(outer.parent_tool_use_id);}

    // Only the init record describes the session. The CLI also emits
    // `system` records for `status`, `hook_started` and `hook_response`, which
    // carry no model and no new session id — rendering those repeated the same
    // header line several times per turn.
    if (outer.type === 'system') {this.consumeSystemEvent(outer, events); return;}
    if (outer.type === 'result') {this.consumeResultEvent(outer, events); return;}

    // Tool results only ever arrive on the top-level `user` envelope.
    if (outer.type === 'user') {
      this.consumeToolResults(outer, agent, events);
      return;
    }

    // The complete-message form. It is the only source of assistant content
    // for a turn that arrived without partial events, and a duplicate of the
    // turn that did.
    if (outer.type === 'assistant') {
      const messageId = asRecord(outer.message)?.id;
      const isDuplicate = typeof messageId === 'string' && messageId
        ? this.streamedMessageIds.has(messageId)
        : this.sawStreamEvents;
      if (!isDuplicate) {this.consumeCompleteMessage(outer, agent, events);}
      return;
    }

    const inner = outer.type === 'stream_event' ? asRecord(outer.event) : outer;
    if (!inner) {return;}
    if (outer.type === 'stream_event') {this.sawStreamEvents = true;}
    this.consumeSseEvent(inner, agent, events);
  }

  private consumeSystemEvent(outer: Record<string, any>, events: NormalizedEvent[]): void {
    if (outer.subtype === 'thinking_tokens') {
      this.thinkingTokens = finiteOrNull(outer.estimated_tokens) ?? this.thinkingTokens;
      events.push({ kind: 'thinking_progress', tokens: this.thinkingTokens });
      return;
    }
    if (outer.subtype === 'task_progress') {this.consumeTaskProgress(outer, events); return;}
    if (typeof outer.subtype === 'string' && outer.subtype !== 'init') {return;}
    events.push({ kind: 'system', model: typeof outer.model === 'string' ? outer.model : null,
      sessionId: typeof outer.session_id === 'string' ? outer.session_id : null,
      tools: Array.isArray(outer.tools) ? outer.tools.length : null });
  }

  private consumeResultEvent(outer: Record<string, any>, events: NormalizedEvent[]): void {
    const usage = asRecord(outer.usage) || {};
    events.push({ kind: 'result',
      isError: outer.is_error === true || (typeof outer.subtype === 'string' && outer.subtype !== 'success'),
      durationMs: finiteOrNull(outer.duration_ms), costUsd: finiteOrNull(outer.total_cost_usd),
      inputTokens: finiteOrNull(usage.input_tokens), outputTokens: finiteOrNull(usage.output_tokens),
      numTurns: finiteOrNull(outer.num_turns) });
  }

  /**
   * Sub-agent status the CLI reports out-of-band. A sub-agent whose own events
   * are relayed inline needs no second narration, so this only speaks for the
   * ones that stay silent — a backgrounded agent has no other visible signal.
   */
  private consumeTaskProgress(outer: Record<string, any>, events: NormalizedEvent[]): void {
    const id = typeof outer.tool_use_id === 'string' ? outer.tool_use_id : null;
    if (!id || this.relayedAgents.has(id)) {return;}
    const description = typeof outer.description === 'string' ? outer.description : '';
    if (!description) {return;}
    const usage = asRecord(outer.usage) || {};
    events.push({
      kind: 'agent_progress',
      agent: this.tools.agentLabel(id)!,
      description: condense(description, 60),
      toolUses: finiteOrNull(usage.tool_uses),
    });
  }

  private consumeSseEvent(evt: Record<string, any>, agent: string | null, events: NormalizedEvent[]): void {
    const blockKey = `${agent ?? 'main'}:${evt.index}`;
    switch (evt.type) {
      case 'message_start': {
        this.startSseMessage(evt, agent);
        return;
      }
      case 'content_block_start': {
        this.startContentBlock(evt, blockKey, agent, events);
        return;
      }
      case 'content_block_delta': {
        this.consumeBlockDelta(evt, blockKey, agent, events);
        return;
      }
      case 'content_block_stop': {
        this.consumeBlockStop(blockKey, events);
        return;
      }
      default:
        if (typeof evt.type === 'string' && !IGNORED_TYPES.has(evt.type)) {
          events.push({ kind: 'unknown', type: evt.type });
        }
    }
  }

  private startSseMessage(evt: Record<string, any>, agent: string | null): void {
    const startedId = asRecord(evt.message)?.id;
    if (typeof startedId === 'string' && startedId) {this.streamedMessageIds.add(startedId);}
    this.thinkingTokens = null;
    const prefix = `${agent ?? 'main'}:`;
    for (const key of this.blocks.keys()) {if (key.startsWith(prefix)) {this.blocks.delete(key);}}
  }

  private startContentBlock(evt: Record<string, any>, blockKey: string, agent: string | null, events: NormalizedEvent[]): void {
    const block = asRecord(evt.content_block) || {};
    if (block.type === 'thinking') {events.push({ kind: 'thinking_progress', tokens: this.thinkingTokens });}
    this.blocks.set(blockKey, { type: String(block.type ?? 'text'), name: typeof block.name === 'string' ? block.name : '',
      id: typeof block.id === 'string' ? block.id : null, partialJson: '', agent, sawText: false });
  }

  private consumeBlockDelta(evt: Record<string, any>, blockKey: string, agent: string | null, events: NormalizedEvent[]): void {
    const delta = asRecord(evt.delta) || {};
    const open = this.blocks.get(blockKey);
    if (delta.type === 'text_delta' && typeof delta.text === 'string') {events.push({ kind: 'text', text: delta.text, agent }); return;}
    if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
      if (delta.thinking && open) {open.sawText = true;}
      events.push({ kind: 'thinking', text: delta.thinking, agent }); return;
    }
    if (delta.type === 'input_json_delta' && open && typeof delta.partial_json === 'string') {open.partialJson += delta.partial_json;}
  }

  private consumeBlockStop(blockKey: string, events: NormalizedEvent[]): void {
    const open = this.blocks.get(blockKey);
    this.blocks.delete(blockKey);
    if (open && open.type === 'thinking' && !open.sawText) {
      events.push({ kind: 'thinking_summary', tokens: this.thinkingTokens, agent: open.agent }); return;
    }
    if (open && open.type === 'tool_use') {
      let input: unknown;
      try {input = open.partialJson ? JSON.parse(open.partialJson) : {};} catch {input = open.partialJson;}
      events.push(this.tools.start(open.name, open.id, input, open.agent));
    }
  }

  /** A whole `assistant` message: render its text/thinking/tool_use blocks. */
  private consumeCompleteMessage(outer: Record<string, any>, agent: string | null, events: NormalizedEvent[]): void {
    const message = asRecord(outer.message);
    const content = message && Array.isArray(message.content) ? message.content : [];
    for (const raw of content) {
      const block = asRecord(raw);
      if (!block) {continue;}
      if (block.type === 'text' && typeof block.text === 'string') {
        events.push({ kind: 'text', text: block.text, agent });
      } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
        events.push({ kind: 'thinking', text: block.thinking, agent });
      } else if (block.type === 'tool_use') {
        events.push(this.tools.start(String(block.name ?? ''), typeof block.id === 'string' ? block.id : null, block.input, agent));
      }
    }
  }

  private consumeToolResults(outer: Record<string, any>, agent: string | null, events: NormalizedEvent[]): void {
    const message = asRecord(outer.message);
    const content = message && Array.isArray(message.content) ? message.content : [];
    for (const raw of content) {
      const block = asRecord(raw);
      if (!block || block.type !== 'tool_result') {continue;}
      const id = typeof block.tool_use_id === 'string' ? block.tool_use_id : null;
      events.push(this.tools.result(id, block.content, block.is_error === true, agent));
    }
  }

}
