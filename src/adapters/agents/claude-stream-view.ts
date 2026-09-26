// Claude JSONL framing and raw-stream escape hatch; presentation is shared.
import { ClaudeStreamNormalizer } from './claude-stream-render.js';
import { createAgentStreamRenderer, type RenderSink, type AgentStreamViewOptions } from './agent-stream-view.js';
export { AgentStreamView as ClaudeStreamView, colorEnabled, type RenderSink, type AgentStreamViewOptions as ClaudeStreamViewOptions } from './agent-stream-view.js';

/** Escape hatch: restore the previous verbatim JSONL passthrough (ADR 0056). */
export const RAW_STREAM_ENV = 'PARALLIX_CLAUDE_RAW_STREAM';

export function rawStreamRequested(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env[RAW_STREAM_ENV];
  return value !== undefined && value !== '' && value !== '0';
}

export interface ClaudeRenderSink {
  write(_chunk: Buffer | string): unknown;
  /** Stop the progress timer and flush a trailing record. Idempotent. */
  close(): void;
}

/**
 * Build the `stdoutSink` that `spawnAndTee` writes each Claude stdout chunk to.
 * `spawnAndTee` pushes the same chunk into its tail buffer *before* calling
 * this sink, so nothing here can affect the telemetry the tail carries.
 *
 * With `PARALLIX_CLAUDE_RAW_STREAM` set, the chunk is forwarded unmodified.
 */
export function createClaudeRenderSink(
  target: RenderSink = process.stdout,
  options: AgentStreamViewOptions & { spinnerIntervalMs?: number } = {},
  env: NodeJS.ProcessEnv = process.env,
): ClaudeRenderSink {
  if (rawStreamRequested(env)) {
    return { write: (chunk) => target.write(chunk as string), close: () => {} };
  }

  const normalizer = new ClaudeStreamNormalizer();
  const renderer = createAgentStreamRenderer(target, options, env);
  let closed = false;
  return {
    write(chunk) {
      if (closed) { return; }
      try { renderer.render(normalizer.push(chunk)); } catch { /* Drop malformed input. */ }
    },
    close() {
      if (closed) { return; }
      closed = true;
      try { renderer.render(normalizer.flush()); } catch { /* Drop malformed input. */ } finally { renderer.close(); }
    },
  };
}
