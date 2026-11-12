import { decisionWindowDay, type DecisionWindow } from '../../domain/decision-window.js';
import type { MissionId } from '../../domain/mission.js';
import type { BoardProjection } from './board.js';

type DoneWindow = Pick<DecisionWindow, 'startDate' | 'endDate' | 'timeZone'>;

/** One verified delivery cohort for the board's DONE rail and weekly figures. */
export function alignDoneCohort(
  projection: BoardProjection,
  deliveries: ReadonlyMap<MissionId, string>,
  window: DoneWindow | undefined,
): BoardProjection {
  if (!window) { return projection; }
  const stage = projection.stages.find(item => item.lane === 'done');
  if (!stage) { return projection; }
  const cards = stage.cards.filter(card => {
    const at = deliveries.get(card.id);
    const day = at === undefined ? '' : decisionWindowDay(at, window.timeZone);
    return day !== '' && day >= window.startDate && day <= window.endDate;
  });
  const ids = new Set(cards.map(card => card.id));
  const historyCards = stage.cards.filter(card => !ids.has(card.id));
  return {
    ...projection,
    stages: projection.stages.map(item => item.lane === 'done'
      ? { ...item, cards, count: cards.length, historyCards } : item),
  };
}
