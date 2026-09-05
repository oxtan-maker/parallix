/**
 * The attention rail: the server's ranked queue.
 */
import type {
  WebAttentionItem,
  WebAttentionReasonKind,
  WebBoardSnapshot,
} from '../../src/interfaces/web/transport.js';
import { ActionButton } from './action-button.js';
import { C, DISPLAY } from './palette.js';

/**
 * The reference tints each queue entry by why it is queued. This is an accent
 * per received reason kind and nothing else: it changes no ordering, hides no
 * entry, and an unrecognised kind keeps the neutral tone.
 */
const REASON_ACCENT: Readonly<Record<WebAttentionReasonKind, string>> = {
  'blocking': C.purple,
  'gate-failed': C.red,
  'review-lane': C.purple,
  'integrate-lane': C.cyan,
  'stale-work': C.amber,
  'none': C.dim,
};

const headingStyle = {
  color: C.amber, fontFamily: DISPLAY, fontWeight: 700, letterSpacing: 2,
  fontSize: 14, margin: 0, display: 'inline',
} as const;

function AttentionEntry({ item, onAction, onSelect, selected }: { item: WebAttentionItem; onAction: (item: WebAttentionItem, control: HTMLButtonElement) => void; onSelect: (id: string) => void; selected: boolean }) {
  const accent = REASON_ACCENT[item.reason.kind];
  return (
    <article
      data-board-card={item.missionId}
      tabIndex={0}
      aria-selected={selected}
      onFocus={() => onSelect(item.missionId)}
      style={{
        border: `1px solid ${selected ? C.cyan : C.cardEdge}`, borderRadius: 6, background: '#12161b',
        marginBottom: 9, padding: '9px 11px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ color: C.faint }}>{String(item.rank).padStart(2, '0')}</span>
        <span style={{ color: C.cyan, fontWeight: 500 }}>{item.missionId}</span>
        <span
          style={{
            color: accent, border: `1px solid ${accent}55`, borderRadius: 3,
            fontSize: 10, padding: '0 4px',
          }}
        >
          {item.reason.kind}
        </span>
      </div>
      {item.reason.detail !== null && (
        <p style={{ color: C.muted, fontSize: 11, margin: '5px 0 7px 20px', lineHeight: 1.45 }}>
          {item.reason.detail}
        </p>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 20 }}>
        <span
          style={{
            color: C.faint, fontSize: 11, flex: 1, minWidth: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          $ {item.action.display}
        </span>
        <ActionButton action={item.action} label="run ▸" onInvoke={(_action, control) => onAction(item, control)} />
      </div>
    </article>
  );
}

export function AttentionRail({ snapshot, onAction, onSelect, selectedId }: { snapshot: WebBoardSnapshot; onAction: (item: WebAttentionItem, control: HTMLButtonElement) => void; onSelect: (id: string) => void; selectedId: string | null }) {
  return (
    <section
      aria-labelledby="attention-heading"
      style={{
        width: 290, flexShrink: 0, borderRight: `1px solid ${C.rule}`,
        display: 'flex', flexDirection: 'column', background: C.panel, minHeight: 0,
      }}
    >
      <div
        style={{
          display: 'flex', alignItems: 'baseline', gap: 8, padding: '14px 14px 7px',
          borderBottom: `1px solid ${C.rule}`, flexShrink: 0,
        }}
      >
        <h2 id="attention-heading" style={headingStyle}>▲ NEEDS YOU NEXT</h2>
        <span style={{ color: C.dim }}>{snapshot.attentionQueue.length}</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: 10, minHeight: 0 }}>
        {snapshot.attentionQueue.length === 0 && (
          <p style={{ color: C.faint, fontSize: 11, padding: 2 }}>nothing in the attention queue</p>
        )}
        {snapshot.attentionQueue.map((item) => <AttentionEntry key={item.missionId} item={item} onAction={onAction} onSelect={onSelect} selected={selectedId === item.missionId} />)}
      </div>
    </section>
  );
}
