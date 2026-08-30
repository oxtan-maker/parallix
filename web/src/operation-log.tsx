/**
 * The operation log strip: the server's own entries, printed in the order
 * received. Nothing is reconstructed, timestamped or reformatted here.
 */
import type { WebBoardSnapshot } from '../../src/interfaces/web/transport.js';
import { C } from './palette.js';

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
