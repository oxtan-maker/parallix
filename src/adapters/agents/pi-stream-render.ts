import { ToolCallTracker, condense, summarizeToolResult, type NormalizedEvent } from './agent-stream-events.js';

/** Pi owns framing; only its SDK event envelopes differ from the common view. */
export class PiStreamNormalizer {
  private tools = new ToolCallTracker();
  private streamedText = false;
  private streamedThinking = false;

  push(event: any): NormalizedEvent[] {
    switch (event.type) {
      case 'message_start':
        this.streamedText = false;
        this.streamedThinking = false;
        return [];
      case 'message_update': {
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
      case 'message_end':
        return this.completeMessage(event.message);
      case 'tool_execution_start':
        return [this.tools.start(event.toolName || 'tool', event.toolCallId ?? null, event.args)];
      case 'tool_execution_update': {
        if (event.toolName !== 'subagent') { return []; }
        const description = summarizeToolResult(event.partialResult?.content);
        return description ? [{ kind: 'agent_progress', agent: this.tools.agentLabel(event.toolCallId) || 'sub-agent', description, toolUses: null }] : [];
      }
      case 'tool_execution_end':
        return [this.tools.result(event.toolCallId ?? null, event.result?.content ?? event.result, event.isError === true, null, event.toolName ?? null)];
      case 'summarization_retry_scheduled':
      case 'auto_retry_start':
        return [{ kind: 'activity', label: 'retrying', group: 'retry', message: `↻ retry ${event.attempt}/${event.maxAttempts} in ${event.delayMs}ms · ${condense(event.errorMessage || '')}` }];
      case 'compaction_start':
      case 'auto_compaction_start':
        return [{ kind: 'activity', label: 'compacting context', message: '↻ compacting context' }];
      case 'summarization_retry_attempt_start':
        return [{ kind: 'activity', label: 'summarizing context' }];
      case 'summarization_retry_finished':
      case 'auto_retry_end':
        return [{ kind: 'activity', label: null }];
      case 'compaction_end':
      case 'auto_compaction_end':
        return [{ kind: 'activity', label: null }, { kind: 'diagnostic', isError: Boolean(event.errorMessage), text: event.errorMessage ? `✗ compaction: ${condense(event.errorMessage)}` : event.aborted ? '· compaction cancelled' : '✓ context compacted' }];
      case 'agent_start':
      case 'agent_end':
      case 'agent_settled':
      case 'turn_start':
      case 'turn_end':
      case 'entry_appended':
      case 'session_info_changed':
      case 'thinking_level_changed':
      case 'queue_update':
      case 'bash_execution_update':
        return [];
      default:
        return typeof event.type === 'string' ? [{ kind: 'unknown', type: event.type }] : [];
    }
  }

  private completeMessage(message: any): NormalizedEvent[] {
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
