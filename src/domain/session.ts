// Session / resume marker value object.
//
// A marker records which agent family last launched for a (mission, role) so a
// relaunch can pass the family's resume flag. ADR 0053 makes the operator
// database authoritative; production callers use the checked application port,
// while legacy worktree files are explicit one-way import input only.

import type { AgentFamily } from './agents.js';
import type { MissionId } from './mission.js';

/** Roles distinguished by the checked session-marker repository. */
export type SessionRole = 'execute' | 'draft' | 'review';

export function sessionRole(value: string): SessionRole {
  if (value === 'execute' || value === 'draft' || value === 'review') {
    return value;
  }
  throw new Error(`Invalid session role: ${JSON.stringify(value)}`);
}

/** A resume marker: the agent family, when it last launched, and an optional
 * provider session id. */
export interface SessionMarker {
  readonly missionId: MissionId;
  readonly role: SessionRole;
  readonly agent: AgentFamily;
  readonly lastLaunched: string;
  readonly sessionId: string | null;
}

/** Resume only when the previous marker used the same agent family; a fallback
 * to a different family invalidates the marker. */
export function shouldResume(
  marker: SessionMarker | null,
  missionId: MissionId,
  role: SessionRole,
  agent: AgentFamily,
): boolean {
  return marker !== null && marker.missionId === missionId && marker.role === role && marker.agent === agent;
}
