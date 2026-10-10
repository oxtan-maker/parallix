import { useEffect, useRef, type ReactNode } from 'react';

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
      style={{ position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.65)' }}>
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
        style={{ width: 560, maxWidth: '90vw', maxHeight: '80vh', overflowY: 'auto', padding: '14px', border: '1px solid #7a2f2f', borderRadius: 5, background: '#1d1112', color: '#e0b7b7' }}>
        {children}
        {feedback && <p role="status">{feedback}</p>}
      </section>
    </div>
  );
}
