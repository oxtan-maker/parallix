import { compareCodeUnits } from '../../domain/comparators.js';
import type { FlowRebaseStageState, ScopedFlowRebaseStageFact } from '../projections/flow-mission-facts.js';

export const FLOW_REBASE_STAGE_DETAIL_LIMIT = 12;
const REBASE_STAGE_STATE_PRIORITY: Readonly<Record<FlowRebaseStageState, number>> = {
  interrupted: 0, running: 1, absent: 2, 'historical-unavailable': 3, inapplicable: 4, measured: 5,
};

/** Server-side detail ordering and bounding shared by CLI and web transport. */
export function selectFlowRebaseStageDetails(stages: readonly ScopedFlowRebaseStageFact[],
  limit = FLOW_REBASE_STAGE_DETAIL_LIMIT): { readonly visible: readonly ScopedFlowRebaseStageFact[]; readonly omitted: number } {
  const ordered = [...stages].sort((left, right) => REBASE_STAGE_STATE_PRIORITY[left.state] - REBASE_STAGE_STATE_PRIORITY[right.state]
    || compareCodeUnits(left.repositoryId, right.repositoryId) || compareCodeUnits(left.missionId, right.missionId)
    || compareCodeUnits(left.stage, right.stage) || compareCodeUnits(left.operationId ?? '', right.operationId ?? '')
    || compareCodeUnits(left.sourceId ?? '', right.sourceId ?? ''));
  return { visible: ordered.slice(0, limit), omitted: Math.max(0, ordered.length - limit) };
}
