// Session / resume marker value object.
//
// Mirrors the per-worktree resume markers written to
// `.workflow/sessions/<slug>-<role>.json`
// (`src/platform/runtime/lib/tools/sessions.ts`: `writeSession` at :35,
// `readSession` at :21, `shouldResume` at :58). A marker records which agent
// family last launched for a (slug, role) so a relaunch can pass the family's
// resume flag. ADR 0044 keeps these markers as target-repository state (they
// control resumability for a particular mission checkout), so they are NOT
// operator-local SQLite state.

import type { AgentFamily } from './agents.js';
import type { MissionId } from './mission.js';

/** Roles a session marker distinguishes (the `<role>` file suffix). */
export type SessionRole = 'execute' | 'draft' | 'review';

/** A resume marker: the agent family, when it last launched, and an optional
 * provider session id. Fields track the persisted body (`sessions.ts:45-49`). */
export interface SessionMarker {
  readonly missionId: MissionId;
  readonly role: SessionRole;
  readonly agent: AgentFamily;
  readonly lastLaunched: string;
  readonly sessionId: string | null;
}

/** Resume only when the previous marker used the same agent family; a fallback
 * to a different family invalidates the marker. Behavioral re-statement of
 * `shouldResume` (`sessions.ts:58`). */
export function shouldResume(
  marker: SessionMarker | null,
  missionId: MissionId,
  role: SessionRole,
  agent: AgentFamily,
): boolean {
  return marker !== null && marker.missionId === missionId && marker.role === role && marker.agent === agent;
}
