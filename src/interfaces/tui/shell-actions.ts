import type { BoardShellProps } from './shell.js';
import React from 'react';

import type { BoardProjection } from '../../application/projections/board.js';

import type { MissionCard } from '../../application/projections/mission-board.js';
import type { Capability } from '../../application/contracts.js';
import type { BoardCommandKind, BoardCommandResult, BoardProgressEvent } from '../../application/controller/board-command.js';
import { cancelledOutcome, unavailableCapability, unavailableReason } from '../../application/controller/board-command.js';

import { canDispatchAction } from './action-bar.js';

export function useBoardShellActions(projection: BoardProjection, selectedMissionId: string | null, projectionRef: React.RefObject<BoardProjection>, redraw: () => void, commandControllerFactory: BoardShellProps['commandControllerFactory'], refreshProjection: BoardShellProps['refreshProjection']) {
  const [confirmation, setConfirmation] = React.useState<{ kind: BoardCommandKind; mission: MissionCard } | null>(null);
  const [outcome, setOutcome] = React.useState<BoardCommandResult | null>(null);
  const [liveEvents, setLiveEvents] = React.useState<Array<BoardProjection['operationLog'][number] & { sequence: number }>>([]);
  const confirmationRef = React.useRef<{ kind: BoardCommandKind; mission: MissionCard } | null>(null);
  const pushLiveBoardEvent = React.useCallback((event: BoardProgressEvent) => {
    setLiveEvents((previous) => [...previous, event].sort((left, right) => left.sequence - right.sequence));
  }, []);
  const controller = React.useMemo(() => commandControllerFactory?.(pushLiveBoardEvent), [commandControllerFactory]);

  const dispatchMissionAction = (kind: BoardCommandKind, mission: MissionCard): boolean => {
    setOutcome(null);
    if (!controller?.canExecute(kind)) {
      setOutcome(unavailableCapability(kind, unavailableReason(kind) ?? 'no Mission authority is configured for this interface'));
      return false;
    }
    if (!canDispatchAction(kind, mission, controller)) {
      setOutcome(unavailableCapability(kind, 'Mission cannot be activated from its current state'));
      return false;
    }
    const nextConfirmation = { kind, mission };
    confirmationRef.current = nextConfirmation;
    setConfirmation(nextConfirmation);
    return true;
  };

  const startAction = (missionId: string): boolean => {
    const mission = projection.stages.flatMap((stage) => stage.cards).find((card) => card.id === missionId) ?? null;
    return mission ? dispatchMissionAction('active:execute', mission) : false;
  };

  /** Dispatch a lifecycle shortcut command.
   * Integrated capabilities (active:execute) go through ConfirmationDialog
   * with the same canDispatchAction guard as Enter.
   * Unavailable capabilities report immediately without confirmation (R4). */
  const dispatchLifecycle = (kind: BoardCommandKind): boolean => {
    if (!selectedMissionId) { return false; }
    const mission = projection.stages.flatMap((stage) => stage.cards).find((card) => card.id === selectedMissionId) ?? null;
    if (!mission) { return false; }
    if (controller?.canExecute(kind)) {
      /* Integrated: gate on enablement (same check as Enter/startAction). */
      return dispatchMissionAction(kind, mission);
    } else {
      /* Unavailable capability — report immediately without confirmation dialog (R4). */
      const reason = unavailableReason(kind) ?? `${kind} is not yet available`;
      setOutcome(unavailableCapability(kind, reason));
      return false;
    }
  };

  const confirmAction = async () => {
    const pendingConfirmation = confirmationRef.current;
    if (!pendingConfirmation || !controller) { return; }
    const kind = pendingConfirmation.kind;
    const request = {
      operationId: `board-${Date.now()}`,
      kind,
      missionId: pendingConfirmation.mission.id,
      missionStatusAtRequest: pendingConfirmation.mission.status,
      agent: pendingConfirmation.mission.agent,
      capabilities: new Set([kind as Capability] as const),
      cancellation: { requested: false },
    } as const;
    confirmationRef.current = null;
    setConfirmation(null);
    const result = await controller.dispatch(request);
    setOutcome(result);
    // A cancelled mission must leave the board without a restart: its rows are
    // gone, so the next projection simply no longer carries the card.
    if (kind === 'mission:cancel' && result.status === 'completed' && refreshProjection) {
      projectionRef.current = await refreshProjection();
      redraw();
      return;
    }
    if (result.error?.kind === 'conflict' && refreshProjection) {
      const refreshed = await refreshProjection();
      const refreshedMission = refreshed.stages.flatMap((stage) => stage.cards)
        .find((card) => card.id === pendingConfirmation.mission.id) ?? pendingConfirmation.mission;
      const nextConfirmation = { kind, mission: refreshedMission };
      confirmationRef.current = nextConfirmation;
      setConfirmation(nextConfirmation);
    }
  };

  const cancelAction = () => { confirmationRef.current = null; setConfirmation(null); setOutcome(cancelledOutcome('cancelled before dispatch')); };
  return { confirmation, outcome, liveEvents, controller, dispatchMissionAction, startAction, dispatchLifecycle, confirmAction, cancelAction };
}
