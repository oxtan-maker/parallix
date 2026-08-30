/**
 * A server-projected action, rendered and never invoked. This client is
 * read-only by construction: the control is natively disabled, carries no
 * handler, and its accessible name states the server's availability verbatim.
 */
import type { CSSProperties } from 'react';
import type { WebCommandAction } from '../../src/interfaces/web/transport.js';
import { C } from './palette.js';

/** Actions are server-projected but never invocable in this read-only client. */
export const READ_ONLY_HINT = 'read-only board: this client cannot run board commands';

function look(state: WebCommandAction['state']): CSSProperties {
  return state === 'enabled'
    ? { background: C.greenFill, border: `1px solid ${C.greenEdge}`, color: C.green }
    : { background: 'none', border: `1px solid ${C.cardEdge}`, color: C.faint };
}

export function ActionButton({ action, style, label }: {
  action: WebCommandAction;
  style?: CSSProperties;
  /** A short face for the same action; the full display stays the accessible name. */
  label?: string;
}) {
  return (
    <button
      type="button"
      disabled
      style={{
        ...look(action.state),
        borderRadius: 4,
        fontFamily: 'inherit',
        fontSize: 10.5,
        letterSpacing: 0.5,
        padding: '4px 10px',
        cursor: 'not-allowed',
        whiteSpace: 'nowrap',
        ...style,
      }}
      title={action.reason ?? READ_ONLY_HINT}
      aria-label={`${action.display} — ${action.state}${action.reason === null ? '' : `: ${action.reason}`}`}
    >
      {label ?? action.display}
    </button>
  );
}
