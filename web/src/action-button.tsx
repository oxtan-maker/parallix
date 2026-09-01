/**
 * A server-projected action. Only the parent can invoke it, and only when the
 * server's current projection marks it enabled.
 */
import type { CSSProperties } from 'react';
import type { WebCommandAction } from '../../src/interfaces/web/transport.js';
import { C } from './palette.js';

export const UNAVAILABLE_HINT = 'action is not available in the current server projection';

function look(state: WebCommandAction['state']): CSSProperties {
  return state === 'enabled'
    ? { background: C.greenFill, border: `1px solid ${C.greenEdge}`, color: C.green }
    : { background: 'none', border: `1px solid ${C.cardEdge}`, color: C.faint };
}

export function ActionButton({ action, style, label, pending = false, onInvoke }: {
  action: WebCommandAction;
  style?: CSSProperties;
  /** A short face for the same action; the full display stays the accessible name. */
  label?: string;
  pending?: boolean;
  onInvoke?: (action: WebCommandAction, control: HTMLButtonElement) => void;
}) {
  const enabled = action.state === 'enabled' && !pending;
  return (
    <button
      type="button"
      aria-disabled={!enabled}
      onClick={(event) => { if (enabled) { onInvoke?.(action, event.currentTarget); } }}
      style={{
        ...look(action.state),
        borderRadius: 4,
        fontFamily: 'inherit',
        fontSize: 10.5,
        letterSpacing: 0.5,
        padding: '4px 10px',
        cursor: enabled ? 'pointer' : 'not-allowed',
        whiteSpace: 'nowrap',
        ...style,
      }}
      title={pending ? `Starting ${action.display}` : action.reason ?? (enabled ? action.display : UNAVAILABLE_HINT)}
      aria-label={`${action.display} — ${pending ? 'starting' : action.state}${action.reason === null ? '' : `: ${action.reason}`}`}
    >
      {pending ? `${label ?? action.display} · starting…` : label ?? action.display}
    </button>
  );
}
