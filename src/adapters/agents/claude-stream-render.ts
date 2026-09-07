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

/** Salient input field per tool, used to condense a tool call to one line. */
const TOOL_INPUT_FIELDS: Record<string, string[]> = {
  Bash: ['command'],
  Read: ['file_path'],
  Write: ['file_path'],
  Edit: ['file_path'],
  NotebookEdit: ['notebook_path'],
  Glob: ['pattern'],
  Grep: ['pattern'],
  WebFetch: ['url'],
  WebSearch: ['query'],
  Task: ['subagent_type', 'description'],
  Agent: ['subagent_type', 'description'],
  Skill: ['skill'],
};

/** Tools that launch a sub-agent. The CLI has shipped both names; either one
 *  must be labelled as a sub-agent rather than dumped as a raw tool input,
 *  whose `prompt` field is long enough to bury the rest of the view. */
const SUBAGENT_TOOLS = new Set(['Task', 'Agent']);

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

export const MAX_INPUT_SUMMARY = 120;

export type NormalizedEvent =
  | { kind: 'system'; model: string | null; sessionId: string | null; tools: number | null }
  | { kind: 'text'; text: string; agent: string | null }
  | { kind: 'thinking'; text: string; agent: string | null }
  | { kind: 'thinking_summary'; tokens: number | null; agent: string | null }
  | { kind: 'thinking_progress'; tokens: number | null }
  | { kind: 'agent_progress'; agent: string; description: string; toolUses: number | null }
  | { kind: 'tool_start'; id: string | null; name: string; input: string; agent: string | null; isSubagent: boolean }
  | { kind: 'tool_result'; id: string | null; name: string | null; isError: boolean; summary: string; agent: string | null; isSubagent: boolean }
  | { kind: 'result'; isError: boolean; durationMs: number | null; costUsd: number | null; inputTokens: number | null; outputTokens: number | null; numTurns: number | null }
  | { kind: 'passthrough'; text: string }
  | { kind: 'unknown'; type: string };

function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Collapse to one line and cap the length so a tool call stays scannable. */
export function condense(text: string, max: number = MAX_INPUT_SUMMARY): string {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Pick the salient field(s) of a tool input, falling back to compact JSON. */
export function summarizeToolInput(name: string, input: unknown): string {
  const record = asRecord(input);
  if (!record) {return input === undefined ? '' : condense(String(input));}
  const fields = TOOL_INPUT_FIELDS[name];
  if (fields) {
    const picked = fields
      .map(field => record[field])
      .filter(value => value !== undefined && value !== null && value !== '')
      .map(value => (typeof value === 'string' ? value : JSON.stringify(value)));
    if (picked.length > 0) {return condense(picked.join(' · '));}
  }
  const keys = Object.keys(record);
  if (keys.length === 0) {return '';}
  try {
    return condense(JSON.stringify(record));
  } catch {
    return condense(keys.join(', '));
  }
}

/** Flatten a tool_result `content` payload (string, or array of blocks). */
function summarizeToolResult(content: unknown): string {
  if (typeof content === 'string') {return condense(content);}
  if (Array.isArray(content)) {
    const text = content
      .map(block => {
        const record = asRecord(block);
        if (!record) {return typeof block === 'string' ? block : '';}
        if (typeof record.text === 'string') {return record.text;}
        return record.type ? `[${record.type}]` : '';
      })
      .filter(Boolean)
      .join(' ');
    return condense(text);
  }
  if (content === undefined || content === null) {return '';}
  try {
    return condense(JSON.stringify(content));
  } catch {
    return '';
  }
}

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
  /** Task tool_use id → human label, so sub-agent events can be attributed. */
  private subagents = new Map<string, string>();
  /** Non-Task tool_use id → tool name, so tool results can name their tool. */
  private toolNames = new Map<string, string>();
  private subagentCount = 0;
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
    const agent = this.agentLabel(outer.parent_tool_use_id);
    if (agent && typeof outer.parent_tool_use_id === 'string') {this.relayedAgents.add(outer.parent_tool_use_id);}

    // Only the init record describes the session. The CLI also emits
    // `system` records for `status`, `hook_started` and `hook_response`, which
    // carry no model and no new session id — rendering those repeated the same
    // header line several times per turn.
    if (outer.type === 'system') {
      if (outer.subtype === 'thinking_tokens') {
        this.thinkingTokens = finiteOrNull(outer.estimated_tokens) ?? this.thinkingTokens;
        // Progress only: it feeds the live indicator, it prints no line.
        events.push({ kind: 'thinking_progress', tokens: this.thinkingTokens });
        return;
      }
      if (outer.subtype === 'task_progress') {
        this.consumeTaskProgress(outer, events);
        return;
      }
      if (typeof outer.subtype === 'string' && outer.subtype !== 'init') {return;}
      events.push({
        kind: 'system',
        model: typeof outer.model === 'string' ? outer.model : null,
        sessionId: typeof outer.session_id === 'string' ? outer.session_id : null,
        tools: Array.isArray(outer.tools) ? outer.tools.length : null,
      });
      return;
    }

    if (outer.type === 'result') {
      const usage = asRecord(outer.usage) || {};
      events.push({
        kind: 'result',
        isError: outer.is_error === true || (typeof outer.subtype === 'string' && outer.subtype !== 'success'),
        durationMs: finiteOrNull(outer.duration_ms),
        costUsd: finiteOrNull(outer.total_cost_usd),
        inputTokens: finiteOrNull(usage.input_tokens),
        outputTokens: finiteOrNull(usage.output_tokens),
        numTurns: finiteOrNull(outer.num_turns),
      });
      return;
    }

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
      agent: this.subagents.get(id) ?? `sub-agent ${id.slice(-6)}`,
      description: condense(description, 60),
      toolUses: finiteOrNull(usage.tool_uses),
    });
  }

  private consumeSseEvent(evt: Record<string, any>, agent: string | null, events: NormalizedEvent[]): void {
    const blockKey = `${agent ?? 'main'}:${evt.index}`;
    switch (evt.type) {
      case 'message_start': {
        const startedId = asRecord(evt.message)?.id;
        if (typeof startedId === 'string' && startedId) {this.streamedMessageIds.add(startedId);}
        this.thinkingTokens = null;
        // Drop only this agent's stale blocks; a sub-agent starting a message
        // must not discard the main agent's open tool call.
        const prefix = `${agent ?? 'main'}:`;
        for (const key of this.blocks.keys()) {
          if (key.startsWith(prefix)) {this.blocks.delete(key);}
        }
        return;
      }
      case 'content_block_start': {
        const block = asRecord(evt.content_block) || {};
        if (block.type === 'thinking') {events.push({ kind: 'thinking_progress', tokens: this.thinkingTokens });}
        this.blocks.set(blockKey, {
          type: String(block.type ?? 'text'),
          name: typeof block.name === 'string' ? block.name : '',
          id: typeof block.id === 'string' ? block.id : null,
          partialJson: '',
          agent,
          sawText: false,
        });
        return;
      }
      case 'content_block_delta': {
        const delta = asRecord(evt.delta) || {};
        const open = this.blocks.get(blockKey);
        if (delta.type === 'text_delta' && typeof delta.text === 'string') {
          events.push({ kind: 'text', text: delta.text, agent });
        } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
          if (delta.thinking && open) {open.sawText = true;}
          events.push({ kind: 'thinking', text: delta.thinking, agent });
        } else if (delta.type === 'input_json_delta' && open && typeof delta.partial_json === 'string') {
          open.partialJson += delta.partial_json;
        }
        return;
      }
      case 'content_block_stop': {
        const open = this.blocks.get(blockKey);
        this.blocks.delete(blockKey);
        if (open && open.type === 'thinking' && !open.sawText) {
          // Encrypted thinking: report that the model reasoned, and for how
          // much, rather than leaving a silent gap in the view.
          events.push({ kind: 'thinking_summary', tokens: this.thinkingTokens, agent: open.agent });
          return;
        }
        if (open && open.type === 'tool_use') {
          let input: unknown;
          try {
            input = open.partialJson ? JSON.parse(open.partialJson) : {};
          } catch {
            input = open.partialJson;
          }
          events.push(this.toolStart(open.name, open.id, input, open.agent));
        }
        return;
      }
      default:
        if (typeof evt.type === 'string' && !IGNORED_TYPES.has(evt.type)) {
          events.push({ kind: 'unknown', type: evt.type });
        }
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
        events.push(this.toolStart(String(block.name ?? ''), typeof block.id === 'string' ? block.id : null, block.input, agent));
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
      const subagentLabel = id ? this.subagents.get(id) : undefined;
      events.push({
        kind: 'tool_result',
        id,
        name: subagentLabel ?? (id ? this.toolNames.get(id) ?? null : null),
        isError: block.is_error === true,
        summary: summarizeToolResult(block.content),
        agent,
        isSubagent: Boolean(subagentLabel),
      });
    }
  }

  private toolStart(name: string, id: string | null, input: unknown, agent: string | null): NormalizedEvent {
    const summary = summarizeToolInput(name, input);
    const isSubagent = SUBAGENT_TOOLS.has(name);
    if (id) {
      if (isSubagent) {
        this.subagentCount += 1;
        const record = asRecord(input) || {};
        const descriptor = [record.subagent_type, record.description].find(v => typeof v === 'string' && v);
        this.subagents.set(id, `${name}#${this.subagentCount}${descriptor ? ` ${condense(String(descriptor), 40)}` : ''}`);
      } else {
        this.toolNames.set(id, name);
      }
    }
    return { kind: 'tool_start', id, name, input: summary, agent, isSubagent };
  }

  /** Resolve `parent_tool_use_id` to the label of the Task that owns it. */
  private agentLabel(parentToolUseId: unknown): string | null {
    if (typeof parentToolUseId !== 'string' || !parentToolUseId) {return null;}
    return this.subagents.get(parentToolUseId) ?? `sub-agent ${parentToolUseId.slice(-6)}`;
  }
}
