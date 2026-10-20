import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { WebAgentAvailability } from '../../src/interfaces/web/transport.js';

export const AgentFamilies = createContext<readonly WebAgentAvailability[]>([]);
export const AGENT_HOLD_MS = 450;
const selectable = (family: WebAgentAvailability) => family.available && family.blockedFor.kind === 'finite' && family.blockedFor.ms === 0;

/** One gesture owns its timer and synthesized click, including touch cancellation. */
export function useAgentMenu(enabled: boolean, invoke: (family: string, control: HTMLButtonElement) => void) {
  const families = useContext(AgentFamilies);
  const id = useId();
  const control = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const press = useRef<{ x: number; y: number; pointer: number } | null>(null);
  const suppressClick = useRef(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const clearTimer = () => { if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; } };
  const dismiss = (restore = true) => { setPosition(null); if (restore) { control.current?.focus(); } };
  const open = () => {
    if (!enabled || !control.current) { return; }
    clearTimer();
    const rect = control.current.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 260)), top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - Math.min(300, families.length * 40 + 50))) });
  };
  useEffect(() => () => clearTimer(), []);
  useEffect(() => { clearTimer(); press.current = null; setPosition(null); }, [enabled]);
  useEffect(() => {
    if (!position) { return; }
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    // The menu itself remains focusable when all known families are unavailable.
    if (!menu.current?.contains(document.activeElement)) { menu.current?.focus(); }
    const outside = (event: Event) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !control.current?.contains(target)) { dismiss(false); }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('focusin', outside); };
  }, [position]);
  const cancel = () => {
    if (press.current) { suppressClick.current = true; }
    press.current = null; clearTimer();
  };
  const view = position && enabled ? createPortal(
    <div ref={menu} id={id} role="menu" aria-label="Choose agent family" tabIndex={-1}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') { event.preventDefault(); dismiss(); return; }
        if (event.key === 'Tab') { dismiss(); return; }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { return; }
        event.preventDefault();
        const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not([disabled])') ?? [])];
        if (!items.length) { return; }
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next].focus();
      }}
      style={{ position: 'fixed', ...position, zIndex: 1000, width: 244, maxHeight: 'min(300px, 80vh)', overflowY: 'auto', background: '#18212b', color: '#dce4ed', border: '1px solid #536373', borderRadius: 6, padding: 6, boxShadow: '0 6px 24px #0008' }}>
      <div style={{ fontSize: 12, padding: 6 }}>Choose agent family</div>
      {families.length === 0 && <p role="status">Agent availability unavailable. Refresh the board.</p>}
      {families.map(family => <button key={family.family} type="button" role="menuitem" disabled={!selectable(family)}
        onClick={(event) => {
          event.stopPropagation();
          if (!enabled || !selectable(family) || !control.current) { return; }
          const button = control.current;
          dismiss(); invoke(family.family, button);
        }}
        style={{ display: 'block', width: '100%', textAlign: 'left', padding: 8, background: 'transparent', border: 0, color: selectable(family) ? 'inherit' : '#8a95a2', cursor: selectable(family) ? 'pointer' : 'not-allowed' }}>
        {family.family} — {selectable(family) ? 'available' : family.reason ?? 'unavailable'}
      </button>)}
    </div>, document.body) : null;
  return {
    view,
    props: {
      ref: control,
      ...(enabled ? { 'aria-haspopup': 'menu' as const, 'aria-expanded': position !== null, 'aria-controls': position ? id : undefined } : {}),
      onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
        if (!event.isPrimary || event.button !== 0) { return; }
        clearTimer(); suppressClick.current = false;
        if (!enabled) { return; }
        press.current = { x: event.clientX, y: event.clientY, pointer: event.pointerId };
        timer.current = setTimeout(() => { timer.current = null; suppressClick.current = true; open(); }, AGENT_HOLD_MS);
      },
      onPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => {
        if (press.current && (Math.abs(event.clientX - press.current.x) > 10 || Math.abs(event.clientY - press.current.y) > 10)) { cancel(); }
      },
      onPointerUp: () => { clearTimer(); press.current = null; },
      onPointerLeave: cancel,
      onPointerCancel: cancel,
      onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => { if (enabled) { event.preventDefault(); } },
      onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (enabled && (event.key === 'ArrowDown' || (event.shiftKey && event.key === 'F10'))) {
          event.preventDefault(); event.stopPropagation(); open();
        } else if (!position && (event.key === 'Enter' || event.key === ' ')) { suppressClick.current = false; }
        else if (event.key === 'Escape' && position) { event.preventDefault(); event.stopPropagation(); dismiss(); }
      },
    },
    consumeClick: () => { const suppressed = suppressClick.current; suppressClick.current = false; return suppressed; },
  };
}
