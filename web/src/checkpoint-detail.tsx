import { useState } from 'react';
import type { WebCheckpointEvidence, WebCheckpointSummary, WebMissionCard } from '../../src/interfaces/web/transport.js';
import { useMissionDetail } from './board-data.js';
import { C, MODAL, RADIUS, SPACE, TYPE } from './palette.js';
import { DetailDialog } from './detail-dialog.js';

const STATE_MARK = {
  completed: '✓', current: '▶', future: '○', unknown: '?',
} as const;

function CheckpointEvidenceBody({ active, full, loading, loadError }: {
  readonly active: WebCheckpointSummary | undefined;
  readonly full: WebCheckpointEvidence | undefined;
  readonly loading: boolean;
  readonly loadError: string | null;
}) {
  if (active?.goalCheckCount === 0) { return <p>No evidence recorded for this checkpoint.</p>; }
  if (active === undefined || active.goalCheckCount === 0) { return null; }
  if (loading) { return <p>Loading checkpoint evidence…</p>; }
  if (loadError !== null) { return <p role="alert">Checkpoint evidence unavailable: {loadError}</p>; }
  if (full === undefined) {
    return <p role="alert">Checkpoint evidence changed; refresh the board and reopen this checkpoint.</p>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md, overflowWrap: 'anywhere' }}>
      <span>Last recorded Goal Check evidence</span>
      {full.goalCheck.map((row, index) => (
        <div key={index} style={{ border: `1px solid ${MODAL.accentEdge}`, borderRadius: RADIUS.control, padding: `${SPACE.md}px ${SPACE.lg}px`, background: MODAL.accentFill }}>
          <div style={{ color: MODAL.accent, marginBottom: SPACE.sm }}>{row.criterion}</div>
          <div style={{ color: MODAL.text }}>evidence: {row.evidence}</div>
        </div>
      ))}
    </div>
  );
}

interface CheckpointDetailProps {
  readonly card: WebMissionCard;
  readonly initial: string;
  readonly openedRevision: string | null;
  readonly onClose: () => void;
  readonly snapshotRevision: string | null;
}

/** Shared checkpoint dialog for every board lane, including unevidenced plans. */
export function CheckpointDetail({ card, initial, openedRevision, onClose, snapshotRevision }: CheckpointDetailProps) {
  const evidence = card.checkpointEvidence ?? [];
  const [selected, setSelected] = useState(initial);
  const { detail: loaded, error: loadError } = useMissionDetail(card.id, openedRevision, snapshotRevision);
  // `initial` is the card's checkpoint filename ("CP-2.md"); evidence entries
  // are keyed by checkpoint name ("CP-2"), so match on either form.
  const active = evidence.find((checkpoint) => checkpoint.name === selected || selected === `${checkpoint.name}.md`) ?? evidence[0];
  const full = loaded?.checkpointEvidence.find(checkpoint => checkpoint.name === active?.name);
  if (evidence.length === 0) { return null; }
  return (
    <DetailDialog label={`Checkpoint evidence for ${card.id}`} title={`${card.id} — checkpoints`} width={480} onClose={onClose}>
        <nav aria-label="Checkpoints" style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.sm, marginBottom: SPACE.lg }}>
          {evidence.map((checkpoint) => {
            const chosen = checkpoint.name === active?.name;
            const state = checkpoint.state ?? 'unknown';
            return (
              <button
                key={checkpoint.name}
                type="button"
                aria-pressed={chosen}
                onClick={() => setSelected(checkpoint.name)}
                style={{
                  background: chosen ? MODAL.accentEdge : MODAL.accentFill,
                  border: `1px solid ${chosen ? MODAL.accent : MODAL.accentEdge}`,
                  borderRadius: RADIUS.control, color: chosen ? MODAL.accent : MODAL.muted,
                  cursor: 'pointer', fontFamily: 'inherit', fontSize: TYPE.meta,
                  padding: `${SPACE.xs}px ${SPACE.md}px`,
                }}
              >
                <span aria-hidden="true">{STATE_MARK[state]} </span>{checkpoint.name} · {state}
              </button>
            );
          })}
        </nav>
        <p style={{ margin: `0 0 ${SPACE.md}px`, color: C.dim, fontStyle: 'italic', overflowWrap: 'anywhere' }}>
          {active?.description ?? 'No description recorded for this checkpoint.'}
        </p>
        <CheckpointEvidenceBody active={active} full={full} loading={loaded === null && loadError === null} loadError={loadError} />
    </DetailDialog>
  );
}

