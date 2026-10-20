import { useEffect, useRef, useState } from 'react';
import type { WebMissionCard } from '../../src/interfaces/web/transport.js';
import { C, MODAL, RADIUS, SPACE, TYPE } from './palette.js';

function useDialogFocus(panel: React.RefObject<HTMLElement | null>, onClose: () => void) {
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => opener?.focus();
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
}

/** Shared checkpoint dialog for every board lane, including unevidenced plans. */
export function CheckpointDetail({ card, initial, onClose }: {
  card: WebMissionCard;
  initial: string;
  onClose: () => void;
}) {
  const evidence = card.checkpointEvidence ?? [];
  const [selected, setSelected] = useState(initial);
  // `initial` is the card's checkpoint filename ("CP-2.md"); evidence entries
  // are keyed by checkpoint name ("CP-2"), so match on either form.
  const active = evidence.find((checkpoint) => checkpoint.name === selected || selected === `${checkpoint.name}.md`) ?? evidence[0];
  const panel = useRef<HTMLElement>(null);
  useDialogFocus(panel, onClose);
  const onBackdrop = (event: React.MouseEvent<HTMLDivElement>) => {
    // The backdrop closes only on a direct click. Clicks inside the dialog
    // (checkpoint selector buttons, the close button, evidence text) bubble up
    // to the backdrop and must not dismiss the panel.
    if (event.target !== event.currentTarget) { return; }
    onClose();
  };
  if (evidence.length === 0) { return null; }
  return (
    <div
      role="presentation"
      style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: MODAL.scrim }}
      onClick={(event) => { event.stopPropagation(); onBackdrop(event); }}
      onKeyDown={(event) => { if (event.key !== 'Escape') { event.stopPropagation(); } }}
    >
      <section
        ref={panel}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') { return; }
          const controls = panel.current?.querySelectorAll<HTMLButtonElement>('button');
          if (!controls?.length) { return; }
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }}
        role="dialog"
        aria-label={`Checkpoint evidence for ${card.id}`}
        aria-modal="true"
        style={{
          width: 480,
          maxWidth: '92vw', maxHeight: '80vh', overflow: 'auto',
          background: MODAL.surface, border: `1px solid ${MODAL.edge}`, borderRadius: RADIUS.card,
          color: MODAL.text, padding: SPACE.lg, fontFamily: 'inherit', fontSize: TYPE.body,
          boxShadow: MODAL.shadow,
        }}
      >
        <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: SPACE.md, marginBottom: SPACE.md }}>
          <h2 style={{ margin: 0, fontSize: TYPE.title, color: C.cyan }}>{card.id} — checkpoints</h2>
          <button
            type="button"
            onClick={onClose}
            style={{ background: 'none', border: `1px solid ${MODAL.controlEdge}`, borderRadius: RADIUS.control, color: MODAL.muted, cursor: 'pointer', fontFamily: 'inherit', fontSize: TYPE.meta, padding: `${SPACE.sm}px ${SPACE.md}px` }}
          >
            close
          </button>
        </header>
        <nav aria-label="Checkpoints" style={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.sm, marginBottom: SPACE.lg }}>
          {evidence.map((checkpoint) => {
            const chosen = checkpoint.name === active?.name;
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
                {checkpoint.name}
              </button>
            );
          })}
        </nav>
        <p style={{ margin: `0 0 ${SPACE.md}px`, color: C.dim, fontStyle: 'italic', overflowWrap: 'anywhere' }}>
          {active?.description ?? 'No description recorded for this checkpoint.'}
        </p>
        {active?.goalCheck.length === 0 && <p>No evidence recorded for this checkpoint.</p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: SPACE.md, overflowWrap: 'anywhere' }}>
          <span>Last recorded Goal Check evidence</span>
          {(active?.goalCheck ?? []).map((row, index) => (
            <div key={index} style={{ border: `1px solid ${MODAL.accentEdge}`, borderRadius: RADIUS.control, padding: `${SPACE.md}px ${SPACE.lg}px`, background: MODAL.accentFill }}>
              <div style={{ color: MODAL.accent, marginBottom: SPACE.sm }}>{row.criterion}</div>
              <div style={{ color: MODAL.text }}>evidence: {row.evidence}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

