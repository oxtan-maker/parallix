import type { WebCommandAction } from '../../src/interfaces/web/transport.js';

export type PendingCommand = { readonly id: number; readonly kind: WebCommandAction['kind'] };
export type PendingCommands = ReadonlyMap<string, PendingCommand>;

/** The projection is authoritative; a local request blocks only its own mission. */
export function unavailableReason(action: WebCommandAction, pending: PendingCommand | undefined): string | null {
  if (action.state !== 'enabled') { return action.reason ?? 'action is not available in the current server projection'; }
  return pending === undefined ? null : `Another command (${pending.kind}) is already running for this mission.`;
}
