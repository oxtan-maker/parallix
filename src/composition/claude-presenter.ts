import { createClaudeRenderSink, CLAUDE_STREAM_PRESENTER_FLAG } from '../adapters/agents/claude-stream-view.js';
import type { ParallixConfiguration } from '../application/ports/configuration.js';
import { resolveProcessConfiguration } from './config.js';

export { CLAUDE_STREAM_PRESENTER_FLAG };

/** Private entry: render a Claude JSONL stream from stdin on the hosted terminal pane. */
export function runClaudeStreamPresenter(configuration: ParallixConfiguration = resolveProcessConfiguration()): void {
  const sink = createClaudeRenderSink(process.stdout, {}, configuration);
  process.stdin.on('data', chunk => sink.write(chunk));
  process.stdin.once('end', () => sink.close());
}
