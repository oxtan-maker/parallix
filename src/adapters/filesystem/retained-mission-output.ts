import { listRuns, showRun } from '../../application/run-history.js';
import { MAX_RUN_SHOW_BYTES } from '../../application/run-history-types.js';
import { missionRunsDir, runHistoryFileSystem } from './run-history-store.js';
import type { RecordedOutputRenderer } from '../../application/ports/recorded-output-renderer.js';

/** Bounded, already-redacted recorded output; never claims a live terminal. */
export function readRetainedMissionOutput(worktree: string, missionId: string, renderer: RecordedOutputRenderer): {
  kind: 'captured'; output: string; message: string;
} | null {
  const scope = { runsDir: missionRunsDir(worktree, missionId), fs: runHistoryFileSystem, isAlive: (_pid: number) => true };
  for (const run of listRuns(scope)) {
    if (run.record.missionId !== missionId) { continue; }
    const parts: string[] = [];
    for (const stream of ['stdout', 'stderr'] as const) {
      const bytes = run.record.streams[stream].bytes;
      if (bytes === 0) { continue; }
      const slice = showRun(scope, { runId: run.record.runId, stream,
        offset: Math.max(0, bytes - MAX_RUN_SHOW_BYTES), length: Math.min(bytes, MAX_RUN_SHOW_BYTES) });
      if (slice.ok && slice.text) {
        let text = slice.text;
        if (run.record.family === 'claude' && stream === 'stdout') {
          // The bounded tail can start inside a JSONL record. Drop that
          // fragment before the existing provider renderer frames the rest.
          if (bytes > MAX_RUN_SHOW_BYTES) { text = text.slice(text.indexOf('\n') + 1); }
          text = renderer.render(run.record.family, text);
        }
        parts.push(`${stream} (${slice.ref})\n${text}`);
      }
    }
    if (parts.length > 0) {
      return { kind: 'captured', output: parts.join('\n\n'),
        message: `No live tmux session. Recorded output from ${run.record.role} / ${run.record.family}, started ${run.record.startedAt}${run.record.endedAt ? `, ended ${run.record.endedAt}` : ''}. Showing retained tail; this is not a live terminal.` };
    }
  }
  return null;
}
