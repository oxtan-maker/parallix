import { useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckpointDetail } from './checkpoint-detail.js';
import type { WebMissionCard } from '../../src/interfaces/web/transport.js';
import { C, RADIUS, SPACE, TYPE } from './palette.js';

function checkpointProgress(card: WebMissionCard) {
  const checkpoints = card.checkpointEvidence ?? [];
  const known = checkpoints.length > 0 && checkpoints.every(checkpoint => checkpoint.state !== undefined);
  const completed = checkpoints.filter(checkpoint => checkpoint.state === 'completed').length;
  const current = checkpoints.filter(checkpoint => checkpoint.state === 'current').map(checkpoint => checkpoint.name);
  const progress = checkpoints.length === 0 ? 'Plan unavailable · Completion unknown'
    : known ? `${completed}/${checkpoints.length} completed` : `Completion unknown · ${checkpoints.length} planned`;
  const summary = `${progress}${current.length ? ` · Current: ${current.join(', ')}` : ''}${card.checkpoint ? ` · Recorded: ${card.checkpoint}` : ''}`;
  return { checkpoints, known, completed, current, summary };
}

/** Supplied states alone determine completion; names and evidence are labels. */
export function CheckpointPips({ card }: { card: WebMissionCard }) {
  const [open, setOpen] = useState(false);
  const { checkpoints, known, completed, current, summary } = checkpointProgress(card);
  return (
    <div role="group" aria-label="Checkpoint plan" aria-description={summary} style={{ minWidth: 0, maxWidth: '100%', color: C.dim, fontSize: TYPE.meta, overflowWrap: 'anywhere' }}>
      {checkpoints.length > 0 && <button type="button" aria-haspopup="dialog"
        aria-label={`View checkpoint evidence for ${card.checkpoint ?? card.id}: ${summary}`}
        title={`${summary} · Open checkpoint descriptions and evidence`}
        onClick={(event) => { event.stopPropagation(); setOpen(true); }}
        style={{ display: 'flex', alignItems: 'center', gap: SPACE.sm, width: '100%', maxWidth: 148, minHeight: 24,
          padding: SPACE.xs, border: 0, borderRadius: RADIUS.control, background: 'transparent', color: C.cyan,
          cursor: 'pointer' }}>
        <span data-checkpoint-track="" aria-hidden="true" style={{ display: 'block', flex: 1, minWidth: 0, maxWidth: 120, height: 8, borderRadius: RADIUS.chip, background: C.headEdge, overflow: 'hidden' }}>
          <span data-checkpoint-fill="" style={{ display: 'block', width: `${known ? completed / checkpoints.length * 100 : 0}%`, height: '100%', background: C.cyan }} />
        </span>
        {known && completed === checkpoints.length && <span data-checkpoint-complete="" aria-hidden="true" title="All supplied checkpoints completed">✓</span>}
      </button>}
      {open && createPortal(<CheckpointDetail card={card}
        initial={current[0] ?? card.checkpoint ?? checkpoints[0]?.name ?? ''} onClose={() => setOpen(false)} />, document.body)}
    </div>
  );
}
