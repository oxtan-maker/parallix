import type { RecordedOutputRenderer } from '../../application/ports/recorded-output-renderer.js';
import { createClaudeRenderSink } from './claude-stream-view.js';

/** Reuse provider presentation with colors disabled for recorded web output. */
export function createRecordedOutputRenderer(): RecordedOutputRenderer {
  return { render(family, text) {
    if (family !== 'claude') { return text; }
    const rendered: string[] = [];
    const sink = createClaudeRenderSink({ write: chunk => { rendered.push(String(chunk)); } }, {}, { NO_COLOR: '1' });
    try { sink.write(text); } finally { sink.close(); }
    return rendered.join('') || text;
  } };
}
