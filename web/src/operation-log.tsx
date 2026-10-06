/**
 * The operation log strip: the server's own entries, printed in the order
 * received. Nothing is reconstructed, timestamped or reformatted here.
 *
 * Live progress from the event stream is transient and lives beside the
 * replaceable snapshot, never inside it, so a snapshot that does not (yet)
 * carry an entry cannot erase it (TASK-2655). Presentation order is the
 * snapshot's log in server order followed by live-only entries in arrival
 * order. Identity is the progress (operationId, sequence) pair and nothing
 * else: replayed frames collapse, but a snapshot entry without a sequence
 * (the wire carries none today) never matches a live entry, and distinct
 * events with identical text are both kept. The live store holds at
 * most `OPERATION_LOG_LIMIT` entries, evicting the oldest; it is in-memory
 * only, survives reconnects (replayed frames deduplicate by identity), and
 * resets when the stream's event ids regress, which means the host
 * restarted and its progress sequences mean something new.
 */
import type { WebBoardSnapshot, WebOperationLogEntry, WebProgressEvent } from '../../src/interfaces/web/transport.js';
import { C } from './palette.js';

export const OPERATION_LOG_LIMIT = 256;

export interface LiveProgress {
  readonly entries: readonly WebOperationLogEntry[];
  /** The newest stream event id seen, or null before the first one. */
  readonly lastEventId: number | null;
}

export const EMPTY_LIVE_PROGRESS: LiveProgress = { entries: [], lastEventId: null };

const sameEvent = (entry: WebOperationLogEntry, operationId: string, sequence: number | undefined) =>
  sequence !== undefined && entry.sequence === sequence && entry.operationId === operationId;

/** Track the stream cursor; a regressed id means a restarted host, so drop live state. */
export function observeStreamId(live: LiveProgress, eventId: string | undefined): LiveProgress {
  const id = eventId === undefined || eventId === '' ? Number.NaN : Number(eventId);
  if (!Number.isInteger(id)) { return live; }
  if (live.lastEventId !== null && id <= live.lastEventId) { return { entries: [], lastEventId: id }; }
  return { ...live, lastEventId: id };
}

export function recordProgress(live: LiveProgress, progress: WebProgressEvent): LiveProgress {
  if (live.entries.some(entry => sameEvent(entry, progress.operationId, progress.sequence))) { return live; }
  const entry = { operationId: progress.operationId, sequence: progress.sequence, phase: progress.phase, message: progress.message, timestamp: progress.timestamp, ...(progress.agent === undefined ? {} : { agent: progress.agent }) };
  return { ...live, entries: [...live.entries, entry].slice(-OPERATION_LOG_LIMIT) };
}

/** The snapshot as presented: its own log followed by live entries it does not carry, bounded. */
export function withLiveProgress(snapshot: WebBoardSnapshot, live: LiveProgress): WebBoardSnapshot {
  const pending = live.entries.filter(entry => !snapshot.operationLog.some(persisted => sameEvent(persisted, entry.operationId, entry.sequence)));
  if (pending.length === 0) { return snapshot; }
  return { ...snapshot, operationLog: [...snapshot.operationLog, ...pending].slice(-OPERATION_LOG_LIMIT) };
}

export function OperationLog({ snapshot }: { snapshot: WebBoardSnapshot }) {
  return (
    <section
      aria-label="Operation log"
      style={{
        flexShrink: 0, borderTop: `1px solid ${C.rule}`, background: C.log,
        padding: '7px 18px', fontSize: 11, lineHeight: 1.7, height: 64, overflowY: 'auto',
      }}
    >
      {snapshot.operationLog.length === 0 && <div style={{ color: C.faint }}>no operations recorded</div>}
      {snapshot.operationLog.map((entry, index) => (
        <div key={`${index}:${entry.operationId}:${entry.sequence ?? ''}`} style={{ color: C.dim, whiteSpace: 'pre-wrap' }}>
          {entry.timestamp}  {entry.phase}  {entry.message}{'agent' in entry ? `  (${entry.agent})` : ''}
        </div>
      ))}
    </section>
  );
}
