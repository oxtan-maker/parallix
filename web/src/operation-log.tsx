/**
 * The operation log strip: the server's own entries, printed in the order
 * received. Nothing is reconstructed, timestamped or reformatted here.
 */
import type { WebBoardSnapshot, WebProgressEvent } from '../../src/interfaces/web/transport.js';
import { C } from './palette.js';

export const OPERATION_LOG_LIMIT = 256;

export function appendProgress(snapshot: WebBoardSnapshot, progress: WebProgressEvent): WebBoardSnapshot {
  if (snapshot.operationLog.some(entry => entry.operationId === progress.operationId && entry.sequence === progress.sequence)) { return snapshot; }
  const entry = { operationId: progress.operationId, sequence: progress.sequence, phase: progress.phase, message: progress.message, timestamp: progress.timestamp, ...(progress.agent === undefined ? {} : { agent: progress.agent }) };
  return { ...snapshot, operationLog: [...snapshot.operationLog, entry].slice(-OPERATION_LOG_LIMIT) };
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
      {snapshot.operationLog.map((entry) => (
        <div key={`${entry.operationId}-${entry.timestamp}-${entry.phase}`} style={{ color: C.dim, whiteSpace: 'pre-wrap' }}>
          {entry.timestamp}  {entry.phase}  {entry.message}{'agent' in entry ? `  (${entry.agent})` : ''}
        </div>
      ))}
    </section>
  );
}
