/**
 * The attention rail: the server's ranked queue.
 */
import type {
  WebMissionCard,
  WebAttentionItem,
  WebAttentionReasonKind,
  WebBoardSnapshot,
} from '../../src/interfaces/web/transport.js';
import { actorLine } from './format.js';
import { ReasonDisclosure } from './reason-disclosure.js';
import { ActionButton } from './action-button.js';
import { laneCard, laneHeading } from './lane-header.js';
import { C, RADIUS, SPACE, TRACK, TYPE } from './palette.js';
import type { PendingCommands } from './pending-command.js';

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
  'orphaned-active': C.amber,
  'none': C.dim,
};

const headingStyle = {
  ...laneHeading, color: C.amber,
} as const;

function AttentionEntry({ item, onAction, onSelect, selected, pendingCommands, repeated }: { repeated: boolean; item: WebAttentionItem; onAction: (item: WebAttentionItem, control: HTMLButtonElement) => void; onSelect: (id: string) => void; selected: boolean; pendingCommands: PendingCommands }) {
  const accent = REASON_ACCENT[item.reason.kind];
  return (
    <article
      data-board-card={item.missionId}
      tabIndex={0}
      aria-selected={selected}
      onFocus={() => onSelect(item.missionId)}
      style={{
        ...laneCard(selected), background: C.card,
        marginBottom: SPACE.md, padding: `${SPACE.md}px ${SPACE.lg}px`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: SPACE.md }}>
        <span style={{ color: C.faint }}>{String(item.rank).padStart(2, '0')}</span>
        <span style={{ color: C.cyan, fontWeight: 500 }}>{item.missionId}</span>
        <span
          style={{
            color: accent, border: `1px solid ${accent}55`, borderRadius: RADIUS.chip,
            fontSize: TYPE.micro, padding: `0 ${SPACE.sm}px`,
          }}
        >
          {item.reason.kind}
        </span>
      </div>
      {item.reason.detail !== null && (
        <div style={{ color: C.muted, fontSize: TYPE.meta, margin: `${SPACE.sm}px 0 ${SPACE.md}px 20px`, lineHeight: 1.45 }}>
          {repeated ? <ReasonDisclosure label={`Reason · ${item.missionId}`} reason={item.reason.detail} /> : item.reason.detail}
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: SPACE.md, marginLeft: 20 }}>
        <span
          style={{
            color: C.faint, fontSize: TYPE.meta, flex: 1, minWidth: 0,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          $ {item.action.display}
        </span>
        <ActionButton action={item.action} label="run ▸" pending={pendingCommands.get(item.missionId)} onInvoke={(_action, control) => onAction(item, control)} />
      </div>
    </article>
  );
}

export function AttentionRail({ snapshot, onAction, onSelect, selectedId, pendingCommands, reasonCards = [] }: { reasonCards?: readonly WebMissionCard[]; snapshot: WebBoardSnapshot; onAction: (item: WebAttentionItem, control: HTMLButtonElement) => void; onSelect: (id: string) => void; selectedId: string | null; pendingCommands: PendingCommands }) {
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
          display: 'flex', alignItems: 'baseline', gap: SPACE.md, padding: `${SPACE.xl}px ${SPACE.xl}px ${SPACE.md}px`,
          borderBottom: `1px solid ${C.rule}`, flexShrink: 0,
        }}
      >
        <h2 id="attention-heading" style={headingStyle}>▲ NEEDS YOU NEXT</h2>
        <span style={{ color: C.dim, fontSize: TYPE.meta, letterSpacing: TRACK.normal }}>{snapshot.attentionQueue.length}</span>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: SPACE.lg, minHeight: 0 }}>
        {snapshot.attentionQueue.length === 0 && (
          <p style={{ color: C.faint, fontSize: TYPE.meta, padding: SPACE.xs }}>nothing in the attention queue</p>
        )}
        {snapshot.attentionQueue.map((item) => <AttentionEntry repeated={reasonCards.some(card =>
          card.id === item.missionId && (card.blockingReason === item.reason.detail ||
            (card.activity.work.kind !== 'idle' && actorLine(card).text === item.reason.detail)))} key={item.missionId} item={item} onAction={onAction} onSelect={onSelect} selected={selectedId === item.missionId} pendingCommands={pendingCommands} />)}
      </div>
    </section>
  );
}
