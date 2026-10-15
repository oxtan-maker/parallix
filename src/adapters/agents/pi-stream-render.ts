import type { PiStreamEvent, PiMessage } from './pi-sdk-types.js';
import { ToolCallTracker, condense, summarizeToolResult, type NormalizedEvent } from './agent-stream-events.js';

const QUIET_EVENTS = new Set(['agent_start', 'agent_end', 'agent_settled', 'turn_start', 'turn_end', 'entry_appended', 'session_info_changed', 'thinking_level_changed', 'queue_update', 'bash_execution_update']);
const ACTIVITY_EVENTS = new Map<string, Extract<NormalizedEvent, { kind: 'activity' }>>([
  ['compaction_start', { kind: 'activity', label: 'compacting context', message: '↻ compacting context' }],
  ['auto_compaction_start', { kind: 'activity', label: 'compacting context', message: '↻ compacting context' }],
  ['summarization_retry_attempt_start', { kind: 'activity', label: 'summarizing context' }],
  ['summarization_retry_finished', { kind: 'activity', label: null }],
  ['auto_retry_end', { kind: 'activity', label: null }],
]);

function progressEvents(event: PiStreamEvent): NormalizedEvent[] | null {
  if (event.type === 'summarization_retry_scheduled' || event.type === 'auto_retry_start') {
    return [{ kind: 'activity', label: 'retrying', group: 'retry', message: `↻ retry ${event.attempt}/${event.maxAttempts} in ${event.delayMs}ms · ${condense(event.errorMessage || '')}` }];
  }
  if (event.type === 'compaction_end' || event.type === 'auto_compaction_end') {
    return [{ kind: 'activity', label: null }, { kind: 'diagnostic', isError: Boolean(event.errorMessage), text: event.errorMessage ? `✗ compaction: ${condense(event.errorMessage)}` : event.aborted ? '· compaction cancelled' : '✓ context compacted' }];
  }
  const activity = ACTIVITY_EVENTS.get(event.type);
  return activity ? [{ ...activity }] : null;
}

/** Pi owns framing; only its SDK event envelopes differ from the common view. */
export class PiStreamNormalizer {
  private tools = new ToolCallTracker();
  private streamedText = false;
  private streamedThinking = false;

  push(event: PiStreamEvent): NormalizedEvent[] {
    if (QUIET_EVENTS.has(event.type)) { return []; }
    switch (event.type) {
      case 'message_start':
        this.streamedText = false;
        this.streamedThinking = false;
        return [];
      case 'message_update':
        return this.messageDelta(event);
      case 'message_end':
        return this.completeMessage(event.message);
      case 'tool_execution_start':
        return [this.tools.start(event.toolName || 'tool', event.toolCallId ?? null, event.args)];
      case 'tool_execution_update':
        return this.subagentUpdate(event);
      case 'tool_execution_end':
        return this.toolResult(event);
      default:
        return progressEvents(event) ?? (typeof event.type === 'string' ? [{ kind: 'unknown', type: event.type }] : []);
    }
  }

  private subagentUpdate(event: PiStreamEvent): NormalizedEvent[] {
    if (event.toolName !== 'subagent') { return []; }
    const description = summarizeToolResult(event.partialResult?.content);
    return description ? [{ kind: 'agent_progress', agent: this.tools.agentLabel(event.toolCallId) || 'sub-agent', description, toolUses: null }] : [];
  }

  private toolResult(event: PiStreamEvent): NormalizedEvent[] {
    return [this.tools.result(event.toolCallId ?? null, event.result?.content ?? event.result, event.isError === true, null, event.toolName ?? null)];
  }

  private messageDelta(event: PiStreamEvent): NormalizedEvent[] {
    const delta = event.assistantMessageEvent;
    if (delta?.type === 'text_delta' && typeof delta.delta === 'string') {
      this.streamedText = true;
      return [{ kind: 'text', text: delta.delta, agent: null }];
    }
    if (delta?.type === 'thinking_delta' && typeof delta.delta === 'string') {
      this.streamedThinking ||= delta.delta.length > 0;
      return [{ kind: 'thinking', text: delta.delta, agent: null }];
    }
    if (delta?.type === 'thinking_end' && !this.streamedThinking) { return [{ kind: 'thinking_summary', tokens: null, agent: null }]; }
    if (delta?.type === 'thinking_start') { return [{ kind: 'thinking_progress', tokens: null }]; }
    return [];
  }

  private completeMessage(message: PiMessage | undefined): NormalizedEvent[] {
    if (message?.role !== 'assistant' || !Array.isArray(message.content)) { return []; }
    const events: NormalizedEvent[] = [];
    for (const block of message.content) {
      if (block.type === 'text' && !this.streamedText && typeof block.text === 'string') {
        events.push({ kind: 'text', text: block.text, agent: null });
      } else if (block.type === 'thinking' && !this.streamedThinking && typeof block.thinking === 'string') {
        events.push({ kind: 'thinking', text: block.thinking, agent: null });
      }
    }
    return events;
  }
}
