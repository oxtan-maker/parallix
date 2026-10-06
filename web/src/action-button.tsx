/**
 * A server-projected action. Only the parent can invoke it, and only when the
 * server's current projection marks it enabled.
 */
import type { CSSProperties } from 'react';
import type { WebCommandAction } from '../../src/interfaces/web/transport.js';
import { C } from './palette.js';
import { unavailableReason, type PendingCommand } from './pending-command.js';

export const UNAVAILABLE_HINT = 'action is not available in the current server projection';

function look(state: WebCommandAction['state']): CSSProperties {
  return state === 'enabled'
    ? { background: C.greenFill, border: `1px solid ${C.greenEdge}`, color: C.green }
    : { background: 'none', border: `1px solid ${C.cardEdge}`, color: C.faint };
}

export function ActionButton({ action, style, label, pending, working = false, onInvoke }: {
  action: WebCommandAction;
  style?: CSSProperties;
  /** A short face for the same action; the full display stays the accessible name. */
  label?: string;
  /** Boolean remains supported for isolated presentation callers. */
  pending?: PendingCommand | boolean;
  /** Current-work from the refreshed server projection while this request is pending. */
  working?: boolean;
  onInvoke?: (action: WebCommandAction, control: HTMLButtonElement) => void;
}) {
  const pendingCommand = pending === true ? { id: -1, kind: action.kind } : pending || undefined;
  const reason = unavailableReason(action, pendingCommand);
  const enabled = reason === null;
  const ownPending = pendingCommand?.kind === action.kind;
  return (
    <button
      type="button"
      aria-disabled={!enabled}
      onMouseDown={(event) => event.preventDefault()}
      // Keep the projected unavailable appearance, but still let the board
      // explain a rejected interaction. A disabled-looking control must not
      // turn a click from another surface into a silent no-op.
      onClick={(event) => { onInvoke?.(action, event.currentTarget); }}
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
      title={ownPending ? `${working ? 'Working' : 'Starting'} ${action.display}` : reason ?? action.display}
      aria-label={`${action.display} — ${ownPending ? (working ? 'working' : 'starting') : enabled ? 'enabled' : `unavailable: ${reason ?? UNAVAILABLE_HINT}`}`}
    >
      {ownPending ? `${label ?? action.display} · ${working ? 'working…' : 'starting…'}` : label ?? action.display}
    </button>
  );
}
