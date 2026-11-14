import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { C, MODAL, RADIUS, SPACE, TYPE } from './palette.js';

function useDialogFocus(panel: RefObject<HTMLElement | null>, onClose: () => void): void {
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

export function DetailDialog({ label, title, width, onClose, children }: {
  readonly label: string;
  readonly title: string;
  readonly width: number;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  useDialogFocus(panel, onClose);
  return (
    <div role="presentation"
      style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: MODAL.scrim }}
      onClick={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) { onClose(); } }}
      onKeyDown={(event) => { if (event.key !== 'Escape') { event.stopPropagation(); } }}>
      <section ref={panel} role="dialog" aria-label={label} aria-modal="true"
        onKeyDown={(event) => {
          if (event.key !== 'Tab') { return; }
          const controls = panel.current?.querySelectorAll<HTMLButtonElement>('button');
          if (!controls?.length) { return; }
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }}
        style={{ width, maxWidth: '92vw', maxHeight: '80vh', overflow: 'auto', background: MODAL.surface,
          border: `1px solid ${MODAL.edge}`, borderRadius: RADIUS.card, color: MODAL.text, padding: SPACE.lg,
          fontFamily: 'inherit', fontSize: TYPE.body, boxShadow: MODAL.shadow }}>
        <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: SPACE.md, marginBottom: SPACE.lg }}>
          <h2 style={{ margin: 0, fontSize: TYPE.title, color: C.cyan }}>{title}</h2>
          <button type="button" onClick={onClose}
            style={{ background: 'none', border: `1px solid ${MODAL.controlEdge}`, borderRadius: RADIUS.control,
              color: MODAL.muted, cursor: 'pointer', fontFamily: 'inherit', fontSize: TYPE.meta,
              padding: `${SPACE.sm}px ${SPACE.md}px` }}>close</button>
        </header>
        {children}
      </section>
    </div>
  );
}
