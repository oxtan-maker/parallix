/**
 * The operation log strip: the server's own entries, printed in the order
 * received. Nothing is reconstructed, timestamped or reformatted here.
 *
 * Live progress is kept beside snapshots. Supported (operationId, sequence)
 * identities absorb persisted/replayed events. Unmatched live entries are
 * inserted using producer timestamps, retaining durable server order and
 * live arrival order on ties. Equal or unparseable times favor durable history
 * at the bounded tail; they do not establish authoritative cross-process order.
 * Regressed stream cursors reset transient state after host restart.
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
  if (live.lastEventId !== null && id < live.lastEventId) { return { entries: [], lastEventId: id }; }
  return { ...live, lastEventId: id };
}

export function recordProgress(live: LiveProgress, progress: WebProgressEvent): LiveProgress {
  if (live.entries.some(entry => sameEvent(entry, progress.operationId, progress.sequence))) { return live; }
  const entry = { operationId: progress.operationId, sequence: progress.sequence, phase: progress.phase, message: progress.message, timestamp: progress.timestamp, ...(progress.agent === undefined ? {} : { agent: progress.agent }) };
  return { ...live, entries: [...live.entries, entry].slice(-OPERATION_LOG_LIMIT) };
}

/** Merge by producer time without comparing different operations' sequences. */
export function withLiveProgress(snapshot: WebBoardSnapshot, live: LiveProgress): WebBoardSnapshot {
  const durable = snapshot.operationLog.filter((entry, index, entries) =>
    entry.sequence === undefined || !entries.slice(0, index).some(previous => sameEvent(previous, entry.operationId, entry.sequence)));
  const pending = live.entries.filter(entry => !durable.some(persisted => sameEvent(persisted, entry.operationId, entry.sequence)));
  const merged = [...durable];
  for (const entry of pending) {
    const time = Date.parse(entry.timestamp);
    // Earlier live entries, including equal timestamps, retain arrival order.
    // For legacy unknown timestamps keep durable history at the recent tail.
    const index = merged.findIndex(other => durable.includes(other) &&
      (!Number.isFinite(time) || !Number.isFinite(Date.parse(other.timestamp)) || Date.parse(other.timestamp) >= time));
    if (index === -1) { merged.push(entry); } else { merged.splice(index, 0, entry); }
  }
  return { ...snapshot, operationLog: merged.slice(-OPERATION_LOG_LIMIT) };
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
