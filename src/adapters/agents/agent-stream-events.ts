// Provider-neutral events and tool summaries for launcher terminal output.
/** Salient input field per tool, used to condense a tool call to one line. */
const TOOL_INPUT_FIELDS: Record<string, string[]> = {
  bash: ['command'],
  read: ['path', 'offset', 'limit'],
  write: ['path'],
  edit: ['path'],
  grep: ['pattern', 'path'],
  find: ['pattern', 'path'],
  ls: ['path'],
  subagent: ['agent', 'task'],
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
const SUBAGENT_TOOLS = new Set(['Task', 'Agent', 'subagent']);

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
  | { kind: 'activity'; label: string | null; group?: string; message?: string }
  | { kind: 'diagnostic'; text: string; isError: boolean }
  | { kind: 'passthrough'; text: string }
  | { kind: 'unknown'; type: string };

export function asRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : null;
}

export function finiteOrNull(value: unknown): number | null {
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
export function summarizeToolResult(content: unknown): string {
  if (typeof content === 'string') {return condense(content, 200);}
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
    return condense(text, 200);
  }
  if (content === undefined || content === null) {return '';}
  try {
    return condense(JSON.stringify(content), 200);
  } catch {
    return '';
  }
}

/** Correlate tool results and sub-agent labels independently of provider envelopes. */
export class ToolCallTracker {
  private toolNames = new Map<string, string>();
  private subagents = new Map<string, string>();
  private subagentCount = 0;

  start(name: string, id: string | null, input: unknown, agent: string | null = null): NormalizedEvent {
    const summary = summarizeToolInput(name, input);
    const isSubagent = SUBAGENT_TOOLS.has(name);
    if (id) {
      if (isSubagent) {
        this.subagentCount += 1;
        const record = asRecord(input) || {};
        const descriptor = [record.subagent_type, record.description, record.agent].find(v => typeof v === 'string' && v);
        this.subagents.set(id, `${name}#${this.subagentCount}${descriptor ? ` ${condense(String(descriptor), 40)}` : ''}`);
      } else { this.toolNames.set(id, name); }
    }
    return { kind: 'tool_start', id, name, input: summary, agent, isSubagent };
  }

  result(id: string | null, content: unknown, isError: boolean, agent: string | null = null, name: string | null = null): NormalizedEvent {
    const subagentLabel = id ? this.subagents.get(id) : undefined;
    const resolvedName = subagentLabel ?? (id ? this.toolNames.get(id) ?? name : name);
    if (id) { this.toolNames.delete(id); }
    return { kind: 'tool_result', id, name: resolvedName, isError, summary: summarizeToolResult(content), agent, isSubagent: Boolean(subagentLabel) };
  }

  agentLabel(id: unknown): string | null {
    if (typeof id !== 'string' || !id) { return null; }
    return this.subagents.get(id) ?? `sub-agent ${id.slice(-6)}`;
  }
}
