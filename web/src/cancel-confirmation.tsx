import { useEffect, useRef, type ReactNode } from 'react';
import { DANGER, MODAL, RADIUS, SPACE } from './palette.js';

/** A visible modal whose safe choice owns initial and restored keyboard focus. */
export function CancelConfirmation({ missionId, opener, feedback, onKeep, children }: {
  missionId: string; opener: HTMLButtonElement; feedback?: string;
  onKeep: () => void; children: ReactNode;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = panel.current;
    element?.scrollIntoView?.({ block: 'nearest' });
    element?.querySelector<HTMLButtonElement>('[data-cancel-keep]')?.focus();
    return () => { queueMicrotask(() => { if (opener.isConnected) { opener.focus(); } }); };
  }, [missionId, opener]);
  return (
    <div onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => { if (event.target === event.currentTarget) { event.preventDefault(); } }}
      style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: MODAL.scrim }}>
      <section ref={panel} role="dialog" aria-modal="true" aria-label={`Confirm cancelling ${missionId}`}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') { event.preventDefault(); onKeep(); }
          if (event.key === 'Tab') {
            const controls = [...(panel.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
            const index = controls.indexOf(document.activeElement as HTMLButtonElement);
            event.preventDefault();
            controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
          }
        }}
        style={{ width: 560, maxWidth: '90vw', maxHeight: '80vh', overflowY: 'auto', padding: SPACE.xl, border: `1px solid ${DANGER.edge}`, borderRadius: RADIUS.card, background: DANGER.surface, color: DANGER.text }}>
        {children}
        {feedback && <p role="status">{feedback}</p>}
      </section>
    </div>
  );
}
