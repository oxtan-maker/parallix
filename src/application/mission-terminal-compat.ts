/**
 * The one bounded compatibility resolver for mission terminals and retained
 * history written before lossless Mission identities (TASK-2749).
 *
 * Earlier releases rewrote a Mission ID into an agent-run token before using
 * it: lowercase, every character outside `[a-z0-9_-]` replaced by `_` (so
 * `task-2622.18` became `task-2622_18`). Run records and history directories
 * carry that token. This module is the only place that knows the old rule and
 * the only place that decides whether a legacy artifact belongs to a Mission.
 * Anything it cannot attribute is reported, never attached to, moved or
 * deleted as another Mission's.
 */
import { agentFamily, type AgentFamily } from '../domain/agents.js';
import { runCaptureKind, type RunRecord } from './run-history-types.js';
import type { MissionTerminalScope } from './ports/mission-terminal.js';

/** The pre-TASK-2749 token of a canonical Mission ID, when it differs. */
export function legacyMissionTokens(missionId: string): string[] {
  const token = String(missionId).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^[_-]+/, '');
  return token && token !== missionId ? [token] : [];
}

export type HistoryAttribution =
  | { readonly kind: 'attributed'; readonly legacy: boolean }
  | { readonly kind: 'unattributed'; readonly reason: string };

/**
 * Whether one retained run record belongs to this Mission. The record's own
 * attribution decides, not the directory it was found in: a record naming
 * another Mission or another repository is reported and excluded.
 */
export function attributeRunRecord(
  identity: MissionTerminalScope,
  record: { readonly missionId?: unknown; readonly repositoryKey?: unknown; readonly repositoryId?: unknown },
  location: { readonly legacy: boolean },
  legacyRepositoryKey?: string,
): HistoryAttribution {
  const recorded = String(record.missionId ?? '');
  const legacyName = legacyMissionTokens(identity.missionId).includes(recorded);
  if (recorded !== identity.missionId && !legacyName) {
    return { kind: 'unattributed', reason: `the record names Mission ${JSON.stringify(recorded)}, not ${identity.missionId}` };
  }
  if (record.repositoryId !== undefined ? record.repositoryId !== identity.repositoryId : record.repositoryKey !== legacyRepositoryKey) {
    return { kind: 'unattributed', reason: `the record names repository ${JSON.stringify(String(record.repositoryId ?? record.repositoryKey ?? ''))}, not this repository` };
  }
  return { kind: 'attributed', legacy: location.legacy || legacyName };
}

export type SessionResolution =
  | { readonly kind: 'owned'; readonly session: string }
  | { readonly kind: 'none' }
  | { readonly kind: 'ambiguous'; readonly sessions: readonly string[]; readonly detail: string };

/**
 * Resolve the Mission's session on its own socket. The host adapter names the
 * session that carries the Mission's native name (`owned`) and any other
 * sessions found there. Only the owned session is ever used; other sessions
 * without it cannot be attributed to one Mission, so they are reported as
 * ambiguous and refused for attach and close.
 */
export function resolveMissionSession(owned: string | null, others: readonly string[]): SessionResolution {
  if (owned !== null) { return { kind: 'owned', session: owned }; }
  if (others.length === 0) { return { kind: 'none' }; }
  return {
    kind: 'ambiguous',
    sessions: [...others],
    detail: `the mission terminal socket holds session(s) ${others.join(', ')} that do not carry this Mission's name; refusing to attach to or close them`,
  };
}

/** Old records stored the run-id token as the family; canonical families never contain underscores. */
export function retainedRunFamily(record: Pick<RunRecord, 'family' | 'captureKind'>): AgentFamily | null {
  if (runCaptureKind(record) === 'coordinator') { return null; }
  if (typeof record.family !== 'string') { throw new Error('Agent history must name a family'); }
  return agentFamily(record.family.replace(/_/g, '-'));
}
