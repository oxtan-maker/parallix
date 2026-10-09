import type { ParallixConfiguration } from "../../application/ports/configuration.js";
import { DEFAULT_CONFIGURATION } from "../../application/ports/configuration.js";
// Terminal formatting for the normalized agent events (ADR 0056).
//
// Colour is produced only through `util.styleText` per ADR 0042 — this file
// contains no ANSI literal except the carriage-return spinner control, which is
// written exclusively to a TTY sink.

import { styleText } from 'node:util';
import type { NormalizedEvent } from './agent-stream-events.js';

type Format = Parameters<typeof styleText>[0];

export interface RenderSink {
  write(_text: string): unknown;
  isTTY?: boolean;
}

export interface AgentStreamViewOptions {
  /** Idle time before the progress indicator appears, in ms. */
  idleMs?: number;
  now?: () => number;
  /** Width cleared when erasing a spinner frame. */
  clearWidth?: number;
}

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const DEFAULT_IDLE_MS = 2000;

/**
 * Whether to emit colour for this sink.
 *
 * `util.styleText`'s own detection validates a real stream, but the sink here
 * is injected (and in tests is a plain object), so the same NO_COLOR /
 * FORCE_COLOR / TTY rules are applied to the sink explicitly and the escape
 * codes themselves still come from `styleText`.
 */
export function colorEnabled(sink: RenderSink, configuration: ParallixConfiguration = DEFAULT_CONFIGURATION): boolean {
  if (configuration.runtime.noColor !== undefined && configuration.runtime.noColor !== '') {return false;}
  // FORCE_COLOR=0 is the conventional force-disable, as `supports-color` and
  // the repo's own `FORCE_COLOR=0` test invocation use it.
  if (configuration.runtime.forceColor === '0') {return false;}
  if (configuration.runtime.forceColor !== undefined && configuration.runtime.forceColor !== '') {return true;}
  if (configuration.runtime.term === 'dumb') {return false;}
  return sink.isTTY === true;
}

function formatDuration(ms: number): string {
  if (ms < 1000) {return `${ms}ms`;}
  const seconds = ms / 1000;
  if (seconds < 60) {return `${seconds.toFixed(1)}s`;}
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m${String(Math.round(seconds - minutes * 60)).padStart(2, '0')}s`;
}

/** Renders normalized events to a terminal sink. */
export class AgentStreamView {
  private readonly sink: RenderSink;
  private readonly useColor: boolean;
  private readonly showSpinner: boolean;
  private readonly idleMs: number;
  private readonly now: () => number;
  private readonly clearWidth: number;
  private atLineStart = true;
  /** Identity of the text stream last written, as `<kind>:<agent>`. A change
   *  forces a line break so thinking and assistant text never run together. */
  private lastStream: string | null = null;
  private spinnerVisible = false;
  private spinnerFrame = 0;
  private lastOutputAt: number;
  private startedAt: number;
  /** What the model is doing right now, shown by the progress indicator in
   *  place of the generic label: the thinking counter while it reasons, the
   *  tool name while a call is outstanding. */
  private activity: string | null = null;
  /** When the current activity started, so the indicator times the tool call
   *  or reasoning in flight rather than the whole run. */
  private activityStartedAt: number;
  private activityGroup: string | null = null;

  constructor(sink: RenderSink, options: AgentStreamViewOptions = {}, configuration: ParallixConfiguration = DEFAULT_CONFIGURATION) {
    this.sink = sink;
    this.useColor = colorEnabled(sink, configuration);
    // No spinner animation off a TTY: captured logs must stay residue-free.
    this.showSpinner = sink.isTTY === true && configuration.runtime.term !== 'dumb';
    this.idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
    this.now = options.now ?? Date.now;
    this.clearWidth = options.clearWidth ?? 48;
    this.lastOutputAt = this.now();
    this.startedAt = this.lastOutputAt;
    this.activityStartedAt = this.lastOutputAt;
  }

  render(events: NormalizedEvent[]): void {
    for (const event of events) {this.renderEvent(event);}
  }

  /**
   * Advance the progress indicator. Called on a timer in production; called
   * directly from tests so no real clock is involved.
   */
  tick(): void {
    if (!this.showSpinner) {return;}
    if (this.now() - this.lastOutputAt < this.idleMs) {return;}
    const frame = SPINNER_FRAMES[this.spinnerFrame % SPINNER_FRAMES.length];
    this.spinnerFrame += 1;
    if (!this.atLineStart) {this.write('\n');}
    const since = this.activity === null ? this.startedAt : this.activityStartedAt;
    this.sink.write(`\r${this.style(['dim'], `${frame} ${this.activity ?? 'working'}… ${formatDuration(this.now() - since)}`)}`);
    this.spinnerVisible = true;
  }

  /** Clear any spinner residue and terminate a half-written line. */
  end(): void {
    this.clearSpinner();
    if (!this.atLineStart) {this.write('\n');}
  }

  // ---------- event formatting ----------

  private renderEvent(event: NormalizedEvent): void {
    switch (event.kind) {
      case 'system': {
        const parts = [event.model, event.sessionId ? `session ${event.sessionId}` : null, event.tools === null ? null : `${event.tools} tools`]
          .filter(Boolean).join(' · ');
        this.line(`${this.style(['cyan'], '●')} ${this.style(['bold'], parts || 'agent')}`);
        return;
      }
      case 'text':
        this.setActivity(null);
        this.text(event.text, event.agent, null, 'text', '');
        return;
      case 'thinking':
        this.setActivity('thinking');
        this.text(event.text, event.agent, ['gray'], 'thinking', '✳ ');
        return;
      case 'thinking_progress':
        // Never printed: thinking that the CLI returns encrypted is only
        // observable as a token counter, so it drives the live indicator.
        this.setActivity(event.tokens === null ? 'thinking' : `thinking ${event.tokens} tokens`, 'thinking');
        return;
      case 'thinking_summary': {
        this.setActivity(null);
        const count = event.tokens === null ? '' : ` · ${event.tokens} tokens`;
        this.line(this.withAgent(this.style(['gray'], `✳ thinking${count}`), event.agent));
        return;
      }
      case 'agent_progress': {
        const uses = event.toolUses === null ? '' : ` · ${event.toolUses} tool uses`;
        this.setActivity(`${event.agent} ${event.description}`);
        this.line(this.style(['magenta'], `  ↳ ${event.agent} `) + this.style(['gray'], `${event.description}${uses}`));
        return;
      }
      case 'tool_start': {
        this.renderToolStart(event);
        return;
      }
      case 'tool_result': {
        this.renderToolResult(event);
        return;
      }
      case 'result': {
        this.renderResult(event);
        return;
      }
      case 'activity':
        this.setActivity(event.label, event.group);
        if (event.message) {this.line(this.style(['gray'], event.message));}
        return;
      case 'diagnostic':
        this.line(this.style([event.isError ? 'red' : 'gray'], event.text));
        return;
      case 'passthrough':
        this.line(event.text);
        return;
      case 'unknown':
        this.line(this.style(['gray'], `· ${event.type}`));
    }
  }

  private renderToolStart(event: Extract<NormalizedEvent, { kind: 'tool_start' }>): void {
    this.setActivity(event.isSubagent ? `sub-agent ${event.input || event.name}` : ['Bash', 'bash'].includes(event.name) ? 'running command' : event.name);
    const label = event.isSubagent
      ? `${this.style(['magenta'], '▶ sub-agent')} ${this.style(['bold'], event.input || event.name)}`
      : `${this.style(['cyan'], '⚒')}${['Bash', 'bash'].includes(event.name) ? '' : ` ${this.style(['bold'], event.name)}`}${event.input ? ` ${event.input}` : ''}`;
    // A shell call without a command still drives the indicator, but has no
    // useful line to print. Never fall back to a Bash/bash label.
    if (['Bash', 'bash'].includes(event.name) && !event.input) {return;}
    this.line(this.withAgent(label, event.agent));
  }

  private renderToolResult(event: Extract<NormalizedEvent, { kind: 'tool_result' }>): void {
    this.setActivity(null);
    const mark = event.isError ? this.style(['red'], '✗') : this.style(['green'], '✓');
    const name = event.name && !['Bash', 'bash'].includes(event.name) ? `${event.name} ` : '';
    const body = event.summary ? this.style(['gray'], event.summary) : '';
    const prefix = event.isSubagent ? `${this.style(['magenta'], '◀')} ` : '  ';
    this.line(this.withAgent(`${prefix}${mark} ${name}${body}`.trimEnd(), event.agent));
  }

  private renderResult(event: Extract<NormalizedEvent, { kind: 'result' }>): void {
    this.setActivity(null);
    const parts = [event.durationMs === null ? null : formatDuration(event.durationMs), event.numTurns === null ? null : `${event.numTurns} turns`,
      event.inputTokens === null && event.outputTokens === null ? null : `${event.inputTokens ?? 0} in / ${event.outputTokens ?? 0} out`,
      event.costUsd === null ? null : `$${event.costUsd.toFixed(4)}`].filter(Boolean).join(' · ');
    this.line(`${event.isError ? this.style(['red'], '● failed') : this.style(['green'], '● done')}${parts ? ` ${parts}` : ''}`);
  }

  /**
   * Set what the indicator reports. The clock restarts when the activity
   * changes, so the elapsed time belongs to the call in flight. `group` keeps
   * a stream of updates (the thinking counter) on one clock.
   */
  private setActivity(label: string | null, group: string | null = label): void {
    const currentGroup = this.activityGroup;
    this.activity = label;
    this.activityGroup = label === null ? null : group;
    if (currentGroup !== this.activityGroup) {this.activityStartedAt = this.now();}
  }

  // ---------- writing ----------

  /** Stream text, re-applying the sub-agent prefix at every line start. */
  private text(text: string, agent: string | null, format: Format | null, kind: string, mark: string): void {
    if (!text) {return;}
    this.clearSpinner();
    const stream = `${kind}:${agent ?? ''}`;
    if (stream !== this.lastStream && !this.atLineStart) {this.write('\n');}
    this.lastStream = stream;
    const prefix = `${agent ? this.agentPrefix(agent) : ''}${mark ? this.style(['gray'], mark) : ''}`;
    for (const segment of text.split(/(\n)/)) {
      if (segment === '') {continue;}
      if (segment === '\n') {
        this.write('\n');
        continue;
      }
      if (this.atLineStart && prefix) {this.write(prefix);}
      this.write(format ? this.style(format, segment) : segment);
    }
  }

  private line(text: string): void {
    this.clearSpinner();
    if (!this.atLineStart) {this.write('\n');}
    this.lastStream = null;
    this.write(`${text}\n`);
  }

  private withAgent(text: string, agent: string | null): string {
    return agent ? `${this.agentPrefix(agent)}${text}` : text;
  }

  private agentPrefix(agent: string): string {
    return this.style(['magenta'], `  ↳ ${agent} `);
  }

  private write(text: string): void {
    this.sink.write(text);
    this.atLineStart = text.endsWith('\n');
    this.lastOutputAt = this.now();
  }

  private clearSpinner(): void {
    if (!this.spinnerVisible) {return;}
    this.spinnerVisible = false;
    this.sink.write(`\r${' '.repeat(this.clearWidth)}\r`);
    this.atLineStart = true;
  }

  private style(format: Format, text: string): string {
    return this.useColor ? styleText(format, text, { validateStream: false }) : text;
  }
}

export interface AgentStreamRenderer {
  render(_events: NormalizedEvent[]): void;
  close(): void;
}

/** Own the terminal view and its timer for either SDK or CLI event adapters. */
export function createAgentStreamRenderer(
  target: RenderSink = process.stdout,
  options: AgentStreamViewOptions & { spinnerIntervalMs?: number } = {},
  configuration: ParallixConfiguration = DEFAULT_CONFIGURATION,
): AgentStreamRenderer {
  const view = new AgentStreamView(target, options, configuration);
  let closed = false;
  const timer = target.isTTY === true ? setInterval(() => {
    try { view.tick(); } catch { /* Presentation must never fail the agent. */ }
  }, options.spinnerIntervalMs ?? 250) : null;
  timer?.unref?.();
  return {
    render(events) {
      if (closed) { return; }
      try { view.render(events); } catch { /* Preserve the launch on a sink fault. */ }
    },
    close() {
      if (closed) { return; }
      closed = true;
      if (timer) { clearInterval(timer); }
      try { view.end(); } catch { /* Preserve the launch on a sink fault. */ }
    },
  };
}
