/**
 * Web transport projection: convert application read models and typed
 * outcomes into wire DTOs, failing closed on values JSON would collapse.
 */

import { BOARD_PROJECTION_VERSION, type AgentAvailabilityMetric, type AttentionItem, type BoardMetrics, type BoardProjection, type OperationLogEntry } from '../../application/projections/board.js';
import { projectMissionActivity, type CoordinatorEvidence, type MissionWorkActivity } from '../../application/projections/mission-activity.js';
import type { BoardCommand, CommandAvailability, MissionCard } from '../../application/projections/mission-board.js';
import { isIntegratedCapability, unavailableReason } from '../../application/controller/board-command.js';
import type { ApplicationOutcome, ProgressEvent, SourceFact } from '../../application/contracts.js';
import { WEB_TRANSPORT_VERSION, WebTransportError, type WebBoardCommandKind, type WebDurationMs, type WebMissionWork, type WebCoordinatorEvidence, type WebCommandAction, type WebMissionCard, type WebAttentionItem, type WebOperationLogEntry, type WebAgentAvailability, type WebSourceFact, type WebBoardMetrics, type WebBoardSnapshot, type WebCommandResult, type WebProgressEvent } from './transport-types.js';

export const BOARD_COMMAND_KINDS: Readonly<Record<BoardCommand, WebBoardCommandKind>> = {
  active: 'active:execute',
  handoff: 'handoff:record',
  review: 'review:submit',
  integrate: 'integrate:merge',
  draft: 'draft:create',
  cancel: 'mission:cancel',
};

const ATTENTION_KIND_COMMANDS: Readonly<Partial<Record<WebBoardCommandKind, BoardCommand>>> = {
  'active:execute': 'active',
  'handoff:record': 'handoff',
  'review:submit': 'review',
  'integrate:merge': 'integrate',
  'draft:create': 'draft',
};

/**
 * Server-owned action state. Unavailable outranks ineligibility: a command
 * whose kind is not an integrated capability is unavailable from the board
 * no matter what the lane says.
 */
function toCommandAction(
  kind: WebBoardCommandKind,
  display: string,
  availability: CommandAvailability | undefined,
): WebCommandAction {
  const label = availability?.label === undefined ? {} : { label: availability.label };
  if (!isIntegratedCapability(kind)) {
    return { kind, display, state: 'unavailable', reason: unavailableReason(kind), targetLane: availability?.targetLane ?? null, ...label };
  }
  if (availability !== undefined && availability.enabled) {
    return { kind, display, state: 'enabled', reason: null, targetLane: availability.targetLane ?? null, ...label };
  }
  return {
    kind,
    display,
    state: 'ineligible',
    reason: availability?.reason ?? 'command is not eligible for this mission',
    targetLane: availability?.targetLane ?? null,
    ...label,
  };
}

function toWireDuration(ms: number, path: string): WebDurationMs {
  if (ms === Infinity) { return { kind: 'indefinite' }; }
  if (!Number.isFinite(ms)) {
    throw new WebTransportError('non-finite-number', `${path} blockedForMs is ${String(ms)}`);
  }
  return { kind: 'finite', ms };
}

function toWebMissionWork(work: MissionWorkActivity): WebMissionWork {
  if (work.kind === 'working') {
    return {
      kind: 'working',
      certainty: work.certainty,
      phase: work.phase,
      summary: work.summary,
      agent: work.agent,
      operationId: work.operationId,
    };
  }
  if (work.kind === 'blocked') { return { kind: 'blocked', reason: work.reason }; }
  return { kind: 'idle' };
}

function toWebCoordinatorEvidence(evidence: CoordinatorEvidence): WebCoordinatorEvidence {
  if (evidence.state === 'live') { return { state: 'live', family: evidence.family }; }
  return { state: evidence.state };
}

function toCardActions(card: MissionCard): WebCommandAction[] {
  return card.commands.map((command) => {
    const kind = BOARD_COMMAND_KINDS[command.command];
    return toCommandAction(kind, `px ${command.command} ${card.id}`, command);
  });
}

function toWebMissionCard(card: MissionCard): WebMissionCard {
  const activity = projectMissionActivity(card);
  return {
    id: card.id,
    title: card.title,
    lane: card.lane,
    status: card.status,
    closed: card.closed,
    agent: card.agent,
    checkpoint: card.checkpoint,
    checkpointDescription: card.checkpointDescription,
    checkpointEvidence: card.checkpointEvidence.map(({ name, description, goalCheck }) => ({
      name,
      description,
      goalCheck: goalCheck.map(({ criterion, evidence }) => ({ criterion, evidence })),
    })),
    nextActionText: card.nextActionText,
    gate: card.gate,
    pullRequest: card.pullRequest === null ? null : {
      kind: 'pull-request',
      provider: card.pullRequest.provider,
      id: card.pullRequest.id,
      url: card.pullRequest.url,
      sourceBranch: card.pullRequest.sourceBranch,
      targetBranch: card.pullRequest.targetBranch,
    },
    reviewApproved: card.reviewApproved,
    reviewRound: card.reviewRound,
    reviewPhase: card.reviewPhase,
    reviewDisposition: card.reviewDisposition,
    reviewHistory: card.reviewHistory.map((round) => ({
      number: round.number,
      reviewer: round.reviewer,
      implementer: round.implementer,
      phase: round.phase,
      disposition: round.disposition,
      comment: round.comment,
      findingSummaries: [...round.findingSummaries],
      pushbacks: [...round.pushbacks],
      fixes: [...round.fixes],
    })),
    blockingReason: card.blockingReason,
    flags: [...card.flags],
    activity: {
      work: toWebMissionWork(activity.work),
      coordinator: toWebCoordinatorEvidence(activity.coordinator),
    },
    actions: toCardActions(card),
  };
}

function toWebAttentionItem(item: AttentionItem, card: MissionCard | undefined): WebAttentionItem {
  const kind = item.action.kind;
  const boardCommand = ATTENTION_KIND_COMMANDS[kind];
  const availability = boardCommand === undefined
    ? undefined
    : card?.commands.find((command) => command.command === boardCommand);
  return {
    missionId: item.missionId,
    rank: item.rank,
    reason: { kind: item.reason.kind, detail: item.reason.kind === 'none' ? null : item.reason.detail },
    action: toCommandAction(kind, item.action.display, availability),
    dependsOnSources: [...item.dependsOnSources],
  };
}

function toLogEntry(entry: OperationLogEntry): WebOperationLogEntry {
  return {
    operationId: entry.operationId,
    phase: entry.phase,
    message: entry.message,
    timestamp: entry.timestamp,
    ...(entry.agent !== undefined ? { agent: entry.agent } : {}),
  };
}

function toAgentAvailability(metric: AgentAvailabilityMetric): WebAgentAvailability {
  return {
    family: metric.family,
    available: metric.available,
    blockedFor: toWireDuration(metric.blockedForMs, `agentAvailability[${metric.family}]`),
    reason: metric.reason ?? null,
    ...(metric.runningSessions !== undefined ? { runningSessions: metric.runningSessions } : {}),
  };
}

function toSourceFact(fact: SourceFact<string>): WebSourceFact {
  return {
    source: fact.source,
    status: fact.status,
    ...(fact.value !== undefined ? { value: fact.value } : {}),
  };
}

function toWebMetrics(metrics: BoardMetrics): WebBoardMetrics {
  return {
    health: { state: metrics.health.state },
    provenance: { sampleSize: metrics.provenance.sampleSize, newestEventTimestamp: metrics.provenance.newestEventTimestamp },
    ...(metrics.decisionWindow === undefined ? {} : { flowWindow: {
      startDate: metrics.decisionWindow.current.startDate,
      endDate: metrics.decisionWindow.current.endDate,
      label: metrics.decisionWindow.current.label,
    } }),
    cumulativeFlowByState: { ...metrics.cumulativeFlowByState, series: metrics.cumulativeFlowByState.series.map(point => ({ ...point, counts: { ...point.counts } })) },
    ...(metrics.weeklyCumulativeFlow === undefined ? {} : { weeklyCumulativeFlow: {
      missingHistoryFallback: metrics.weeklyCumulativeFlow.missingHistoryFallback,
      window: { ...metrics.weeklyCumulativeFlow.window },
      series: metrics.weeklyCumulativeFlow.series.map(point => ({ ...point, counts: { ...point.counts } })),
    } }),
    medianCycleTimeByState: { ...metrics.medianCycleTimeByState, series: metrics.medianCycleTimeByState.series.map(point => ({ ...point })) },
    bottleneck: { sentence: metrics.bottleneck.sentence },
  };
}

/**
 * Project a `BoardProjection` to the wire snapshot. Pure and fail-closed:
 * an unknown projection version is rejected rather than guessed at.
 */
export function toWebBoardSnapshot(projection: BoardProjection): WebBoardSnapshot {
  if (projection.version !== BOARD_PROJECTION_VERSION) {
    throw new WebTransportError(
      'unsupported-projection-version',
      `projection version ${String(projection.version)} is not supported by transport v${WEB_TRANSPORT_VERSION}`,
    );
  }
  const cardsById = new Map<string, MissionCard>();
  for (const stage of projection.stages) {
    for (const card of stage.cards) { cardsById.set(card.id, card); }
  }
  return {
    kind: 'board-snapshot',
    transportVersion: WEB_TRANSPORT_VERSION,
    projectionVersion: projection.version,
    repositoryId: projection.repositoryId,
    stages: projection.stages.map((stage) => ({
      lane: stage.lane,
      count: stage.count,
      cards: stage.cards.map(toWebMissionCard),
    })),
    attentionQueue: projection.attentionQueue.map((item) =>
      toWebAttentionItem(item, cardsById.get(item.missionId))),
    availableActions: projection.availableActions.map((command) =>
      toCommandAction(BOARD_COMMAND_KINDS[command.command], `px ${command.command}`, command)),
    wipCounts: projection.wipCounts.map((wip) => ({ lane: wip.lane, count: wip.count })),
    inFlightWip: projection.inFlightWip,
    operationLog: projection.operationLog.map(toLogEntry),
    agentAvailability: projection.metrics.agentAvailability.map(toAgentAvailability),
    metrics: toWebMetrics(projection.metrics),
    sourceFacts: projection.sourceFacts.map(toSourceFact),
    ...(projection.metrics.unattributedRunningSessions !== undefined
      ? { unattributedRunningSessions: projection.metrics.unattributedRunningSessions }
      : {}),
  };
}

/**
 * Project a typed application outcome to the wire command result.
 *
 * The error is always exactly `{ kind, message }` — a thrown object's stack
 * or extra properties can never cross the wire. An `Error` instance, `Set`,
 * `Map`, function, `Symbol`, `BigInt`, non-finite number, or any
 * `undefined`-dependent field in `value` rejects the whole result.
 */
export function toWebCommandResult(outcome: ApplicationOutcome<unknown>): WebCommandResult {
  let value: unknown;
  let hasValue = false;
  if (outcome.value !== undefined) {
    assertJsonValueSafe(outcome.value, 'value');
    value = outcome.value;
    hasValue = true;
  }
  return {
    kind: 'command-result',
    transportVersion: WEB_TRANSPORT_VERSION,
    status: outcome.status,
    error: outcome.error === undefined ? null : { kind: outcome.error.kind, message: outcome.error.message },
    durableEvidence: outcome.durableEvidence.map((evidence) => ({
      id: evidence.id,
      source: evidence.source,
      detail: evidence.detail,
    })),
    ...(hasValue ? { value } : {}),
  };
}

/** Project a progress event; the optional `agent` is omitted, never `null`. */
export function toWebProgressEvent(event: ProgressEvent): WebProgressEvent {
  return {
    kind: 'progress',
    transportVersion: WEB_TRANSPORT_VERSION,
    operationId: event.operationId,
    sequence: event.sequence,
    phase: event.phase,
    message: event.message,
    timestamp: event.timestamp,
    ...(event.agent !== undefined ? { agent: event.agent } : {}),
  };
}

// ---------------------------------------------------------------------------
// JSON-safety — the converter's fail-closed check for outcome values
// ---------------------------------------------------------------------------

function assertJsonValueSafe(value: unknown, path: string): void {
  if (value === null) { return; }
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return;
    case 'number':
      if (!Number.isFinite(value)) {
        throw new WebTransportError('non-finite-number', `${path} is ${String(value)}`);
      }
      return;
    case 'bigint':
    case 'function':
    case 'symbol':
    case 'undefined':
      throw new WebTransportError('unsafe-value', `${path} cannot cross the JSON wire`);
    default:
      break;
  }
  if (value instanceof Error) {
    throw new WebTransportError('unsafe-value', `${path} carries a thrown ${value.name}`);
  }
  if (Array.isArray(value)) {
    value.forEach((element, index) => assertJsonValueSafe(element, `${path}[${index}]`));
    return;
  }
  if (value instanceof Set || value instanceof Map) {
    throw new WebTransportError('unsafe-value', `${path} is a ${value.constructor.name}`);
  }
  for (const [key, element] of Object.entries(value as Record<string, unknown>)) {
    if (element === undefined) {
      throw new WebTransportError('unsafe-value', `${path}.${key} is undefined and would silently vanish on the wire`);
    }
    assertJsonValueSafe(element, `${path}.${key}`);
  }
}
