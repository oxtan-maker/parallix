import type { MissionId } from '../../domain/mission.js';
import { parseInstantMs } from '../../domain/instant.js';
import type { MissionTransition } from '../../domain/mission-workflow.js';

export interface ActivityEntry {
  readonly missionId: MissionId;
  readonly occurredAt: string;
  readonly actor: string;
  readonly action: string;
  readonly summary: string;
}

export function projectActivityLog(transitions: readonly MissionTransition[]): ActivityEntry[] {
  // Compare parsed instants, not raw text: a mix of UTC `Z` and explicit-offset
  // spellings makes lexical order disagree with temporal order (TASK-2688).
  return [...transitions]
    .sort((left, right) => parseInstantMs(right.occurredAt) - parseInstantMs(left.occurredAt))
    .map((transition) => ({
      missionId: transition.missionId,
      occurredAt: transition.occurredAt,
      actor: transition.actor,
      action: transition.trigger,
      // An intake has no prior lane, so it reads as an arrival rather than as
      // a move out of a lane the mission was never in.
      summary: transition.from === null
        ? `intake → ${transition.to}`
        : `${transition.from} → ${transition.to}`,
    }));
}
