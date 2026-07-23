import type { MissionId } from '../../domain/mission.js';
import type { MissionTransition } from '../../domain/mission-workflow.js';

export interface ActivityEntry {
  readonly missionId: MissionId;
  readonly occurredAt: string;
  readonly actor: string;
  readonly action: string;
  readonly summary: string;
}

export function projectActivityLog(transitions: readonly MissionTransition[]): ActivityEntry[] {
  return [...transitions]
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .map((transition) => ({
      missionId: transition.missionId,
      occurredAt: transition.occurredAt,
      actor: transition.actor,
      action: transition.trigger,
      summary: `${transition.from} → ${transition.to}`,
    }));
}
