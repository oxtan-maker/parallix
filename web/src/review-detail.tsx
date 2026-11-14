import type { WebMissionCard } from '../../src/interfaces/web/transport.js';
import { useMissionDetail } from './board-data.js';
import { MODAL, SPACE } from './palette.js';
import { DetailDialog } from './detail-dialog.js';

/** Full review history loaded only after the operator opens this disclosure. */
export function ReviewDetail({ card, openedRevision, onClose, snapshotRevision }: {
  readonly card: WebMissionCard;
  readonly openedRevision: string | null;
  readonly onClose: () => void;
  readonly snapshotRevision: string | null;
}) {
  const { detail, error } = useMissionDetail(card.id, openedRevision, snapshotRevision);

  return (
    <DetailDialog label={`Review history for ${card.id}`} title={`${card.id} — review history`} width={560} onClose={onClose}>
        {detail === null && error === null && <p>Loading review history…</p>}
        {error !== null && <p role="alert">Review history unavailable: {error}</p>}
        {detail?.reviewHistory.length === 0 && <p>No review rounds recorded.</p>}
        {detail?.reviewHistory.map(round => (
          <article key={round.number} style={{ borderTop: `1px solid ${MODAL.edge}`, padding: `${SPACE.md}px 0` }}>
            <h3 style={{ color: MODAL.accent, margin: `0 0 ${SPACE.sm}px` }}>Round {round.number} · {round.disposition ?? round.phase}</h3>
            <p>{round.reviewer} reviewed {round.implementer}{round.comment === null ? '' : ` — ${round.comment}`}</p>
            {round.findingSummaries.length > 0 && <ul>{round.findingSummaries.map(item => <li key={item}>{item}</li>)}</ul>}
            {round.pushbacks.length > 0 && <p>Pushbacks: {round.pushbacks.join(' · ')}</p>}
            {round.fixes.length > 0 && <p>Fixes: {round.fixes.join(' · ')}</p>}
          </article>
        ))}
    </DetailDialog>
  );
}
