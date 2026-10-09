/**
 * Web transport validators: the version-aware entry points that turn a parsed
 * payload into a DTO or an explicit failure state.
 */

import { SUPPORTED_WEB_TRANSPORT_VERSIONS, type WebBoardSnapshot, type WebCommandResult, type WebProgressEvent, type WebCommandRequestKind, type WebHandoffPayload, type WebCommandRequestValidation } from './transport-types.js';
import { LANES, TERMINAL_STATUSES, ERROR_KINDS, EVIDENCE_SOURCES, COMMAND_REQUEST_KINDS, BUCKET_LABELS, ARTIFACT_KINDS, isPlainObject, checkKeys, checkString, checkFiniteNumber, checkEnum, checkOptString, checkOptionalNullableNumber, checkJsonValue, type WebTransportValidation } from './transport-validation-primitives.js';
import { checkCommandAction, checkMissionCard, checkAttentionItem, checkLogEntry, checkAgentAvailability, checkSourceFact, checkMetrics } from './transport-shape-checks.js';

function validateWithVersion<T>(
  payload: unknown,
  kind: string,
  validateShape: (_payload: Record<string, unknown>, _problems: string[]) => void,
): WebTransportValidation<T> {
  if (!isPlainObject(payload)) {
    return { ok: false, code: 'invalid-payload', problems: [`payload is not a ${kind} object`] };
  }
  if (payload.kind !== kind) {
    return { ok: false, code: 'invalid-payload', problems: [`kind must be "${kind}", got ${String(payload.kind)}`] };
  }
  const version = payload.transportVersion;
  if (typeof version !== 'number' || !SUPPORTED_WEB_TRANSPORT_VERSIONS.includes(version)) {
    return {
      ok: false,
      code: 'incompatible-client',
      field: 'transportVersion',
      received: version,
      supported: [...SUPPORTED_WEB_TRANSPORT_VERSIONS],
    };
  }
  const problems: string[] = [];
  validateShape(payload, problems);
  if (problems.length > 0) {
    return { ok: false, code: 'invalid-payload', problems };
  }
  return { ok: true, value: payload as unknown as T };
}

/** Validate a parsed board snapshot payload. */
export function validateWebBoardSnapshot(payload: unknown): WebTransportValidation<WebBoardSnapshot> {
  return validateWithVersion<WebBoardSnapshot>(payload, 'board-snapshot', (p, problems) => {
    checkKeys(p,
      ['kind', 'transportVersion', 'projectionVersion', 'repositoryId', 'stages', 'attentionQueue',
        'availableActions', 'wipCounts', 'inFlightWip', 'operationLog', 'agentAvailability', 'metrics',
        'unattributedRunningSessions', 'sourceFacts'],
      ['kind', 'transportVersion', 'projectionVersion', 'repositoryId', 'stages', 'attentionQueue',
        'availableActions', 'wipCounts', 'inFlightWip', 'operationLog', 'agentAvailability', 'metrics', 'sourceFacts'],
      'snapshot', problems);
    checkFiniteNumber(p, 'projectionVersion', 'snapshot', problems);
    checkString(p, 'repositoryId', 'snapshot', problems);
    checkFiniteNumber(p, 'inFlightWip', 'snapshot', problems);
    checkMetrics(p.metrics, 'snapshot.metrics', problems);
    if (Array.isArray(p.stages)) {
      p.stages.forEach((stage, index) => {
        const path = `snapshot.stages[${index}]`;
        if (!isPlainObject(stage)) { problems.push(`${path} must be an object`); return; }
        checkKeys(stage, ['lane', 'count', 'cards', 'historyCards'], ['lane', 'count', 'cards'], path, problems);
        checkEnum(stage, 'lane', LANES, path, problems);
        checkFiniteNumber(stage, 'count', path, problems);
        if (stage.historyCards !== undefined) {
          if (!Array.isArray(stage.historyCards)) { problems.push(`${path}.historyCards must be an array`); }
          else { stage.historyCards.forEach((card, i) => checkMissionCard(card, `${path}.historyCards[${i}]`, problems)); }
        }
        if (Array.isArray(stage.cards)) {
          stage.cards.forEach((card, cardIndex) => checkMissionCard(card, `${path}.cards[${cardIndex}]`, problems));
        } else {
          problems.push(`${path}.cards must be an array`);
        }
      });
    } else {
      problems.push('snapshot.stages must be an array');
    }
    if (Array.isArray(p.attentionQueue)) {
      p.attentionQueue.forEach((item, index) => checkAttentionItem(item, `snapshot.attentionQueue[${index}]`, problems));
    } else {
      problems.push('snapshot.attentionQueue must be an array');
    }
    if (Array.isArray(p.availableActions)) {
      p.availableActions.forEach((action, index) => checkCommandAction(action, `snapshot.availableActions[${index}]`, problems));
    } else {
      problems.push('snapshot.availableActions must be an array');
    }
    if (Array.isArray(p.wipCounts)) {
      p.wipCounts.forEach((wip, index) => {
        const path = `snapshot.wipCounts[${index}]`;
        if (!isPlainObject(wip)) { problems.push(`${path} must be an object`); return; }
        checkKeys(wip, ['lane', 'count'], ['lane', 'count'], path, problems);
        checkEnum(wip, 'lane', LANES, path, problems);
        checkFiniteNumber(wip, 'count', path, problems);
      });
    } else {
      problems.push('snapshot.wipCounts must be an array');
    }
    if (Array.isArray(p.operationLog)) {
      p.operationLog.forEach((entry, index) => checkLogEntry(entry, `snapshot.operationLog[${index}]`, problems));
    } else {
      problems.push('snapshot.operationLog must be an array');
    }
    if (Array.isArray(p.agentAvailability)) {
      p.agentAvailability.forEach((metric, index) => checkAgentAvailability(metric, `snapshot.agentAvailability[${index}]`, problems));
    } else {
      problems.push('snapshot.agentAvailability must be an array');
    }
    checkOptionalNullableNumber(p, 'unattributedRunningSessions', 'snapshot', problems);
    if (Array.isArray(p.sourceFacts)) {
      p.sourceFacts.forEach((fact, index) => checkSourceFact(fact, `snapshot.sourceFacts[${index}]`, problems));
    } else {
      problems.push('snapshot.sourceFacts must be an array');
    }
  });
}

/** Validate a parsed command result payload. */
export function validateWebCommandResult(payload: unknown): WebTransportValidation<WebCommandResult> {
  return validateWithVersion<WebCommandResult>(payload, 'command-result', (p, problems) => {
    checkKeys(p, ['kind', 'transportVersion', 'status', 'error', 'durableEvidence', 'value'],
      ['kind', 'transportVersion', 'status', 'error', 'durableEvidence'], 'result', problems);
    checkEnum(p, 'status', TERMINAL_STATUSES, 'result', problems);
    if (p.error === null) {
      if (p.status !== 'completed') { problems.push('result.error must be present when status is not "completed"'); }
    } else if (p.status === 'completed') {
      problems.push('result.error must be null when status is "completed"');
    } else if (isPlainObject(p.error)) {
      checkKeys(p.error, ['kind', 'message'], ['kind', 'message'], 'result.error', problems);
      checkEnum(p.error, 'kind', ERROR_KINDS, 'result.error', problems);
      checkString(p.error, 'message', 'result.error', problems);
    } else {
      problems.push('result.error must be an object or null');
    }
    if (Array.isArray(p.durableEvidence)) {
      p.durableEvidence.forEach((evidence, index) => {
        const path = `result.durableEvidence[${index}]`;
        if (!isPlainObject(evidence)) { problems.push(`${path} must be an object`); return; }
        checkKeys(evidence, ['id', 'source', 'detail'], ['id', 'source', 'detail'], path, problems);
        checkString(evidence, 'id', path, problems);
        checkEnum(evidence, 'source', EVIDENCE_SOURCES, path, problems);
        checkString(evidence, 'detail', path, problems);
      });
    } else {
      problems.push('result.durableEvidence must be an array');
    }
    if (Object.prototype.hasOwnProperty.call(p, 'value') && p.value !== undefined) {
      checkJsonValue(p.value, 'result.value', problems);
    }
  });
}

/**
 * Validate a parsed command request payload (browser → host, TASK-2433).
 * Pure and fail-closed: every unknown top-level key, every kind outside the
 * five card-advertised kinds, a `payload` key on an identity-only kind, and
 * every missing, mistyped, or out-of-range handoff field is rejected. The
 * caller must treat a rejection as zero dispatch.
 */
export function validateWebCommandRequest(payload: unknown): WebCommandRequestValidation {
  if (!isPlainObject(payload)) {
    return { ok: false, problems: ['request must be a JSON object'] };
  }
  const problems: string[] = [];
  checkKeys(payload,
    ['missionId', 'kind', 'missionStatusAtRequest', 'payload'],
    ['missionId', 'kind', 'missionStatusAtRequest'],
    'request', problems);
  const missionId = checkString(payload, 'missionId', 'request', problems);
  if (missionId !== null && missionId.length === 0) {
    problems.push('request.missionId must be a non-empty string');
  }
  const kind = checkString(payload, 'kind', 'request', problems);
  if (kind !== null && !COMMAND_REQUEST_KINDS.includes(kind)) {
    problems.push(`request.kind must be one of ${COMMAND_REQUEST_KINDS.join(', ')}, got ${kind}`);
  }
  checkString(payload, 'missionStatusAtRequest', 'request', problems);
  if (Object.prototype.hasOwnProperty.call(payload, 'payload')) {
    const value = payload.payload;
    if (kind === 'handoff:record') {
      checkHandoffPayload(value, 'request.payload', problems);
    } else {
      problems.push(`request.payload is only allowed for handoff:record, got kind ${String(kind)}`);
    }
  }
  if (problems.length > 0) {
    return { ok: false, problems };
  }
  return {
    ok: true,
    value: {
      missionId: payload.missionId as string,
      kind: payload.kind as WebCommandRequestKind,
      missionStatusAtRequest: payload.missionStatusAtRequest as string,
      ...(payload.payload !== undefined ? { payload: payload.payload as WebHandoffPayload } : {}),
    },
  };
}

function checkHandoffPayload(value: unknown, path: string, problems: string[]): void {
  if (!isPlainObject(value)) { problems.push(`${path} must be an object`); return; }
  checkKeys(value,
    ['netEngineeringLines', 'predictedBucket', 'capturedAt', 'artifacts', 'reviewRounds'],
    ['netEngineeringLines', 'capturedAt'], path, problems);
  const lines = value.netEngineeringLines;
  if (typeof lines !== 'number' || !Number.isFinite(lines) || lines < 0) {
    problems.push(`${path}.netEngineeringLines must be a finite number >= 0, got ${String(lines)}`);
  }
  if (Object.prototype.hasOwnProperty.call(value, 'predictedBucket')) {
    checkEnum(value, 'predictedBucket', BUCKET_LABELS, path, problems);
  }
  checkString(value, 'capturedAt', path, problems);
  if (Object.prototype.hasOwnProperty.call(value, 'artifacts')) {
    const artifacts = value.artifacts;
    if (!Array.isArray(artifacts)) {
      problems.push(`${path}.artifacts must be an array`);
    } else {
      artifacts.forEach((artifact, index) => {
        const artifactPath = `${path}.artifacts[${index}]`;
        if (!isPlainObject(artifact)) { problems.push(`${artifactPath} must be an object`); return; }
        checkKeys(artifact, ['kind', 'location', 'byteSize'], ['kind', 'location', 'byteSize'], artifactPath, problems);
        checkEnum(artifact, 'kind', ARTIFACT_KINDS, artifactPath, problems);
        checkString(artifact, 'location', artifactPath, problems);
        const byteSize = artifact.byteSize;
        if (byteSize !== null && (typeof byteSize !== 'number' || !Number.isFinite(byteSize))) {
          problems.push(`${artifactPath}.byteSize must be a finite number or null, got ${String(byteSize)}`);
        }
      });
    }
  }
  if (Object.prototype.hasOwnProperty.call(value, 'reviewRounds')) {
    const rounds = value.reviewRounds;
    if (typeof rounds !== 'number' || !Number.isInteger(rounds) || rounds < 0) {
      problems.push(`${path}.reviewRounds must be an integer >= 0, got ${String(rounds)}`);
    }
  }
}

/** Validate a parsed progress event payload. */
export function validateWebProgressEvent(payload: unknown): WebTransportValidation<WebProgressEvent> {
  return validateWithVersion<WebProgressEvent>(payload, 'progress', (p, problems) => {
    checkKeys(p, ['kind', 'transportVersion', 'operationId', 'sequence', 'phase', 'message', 'timestamp', 'agent'],
      ['kind', 'transportVersion', 'operationId', 'sequence', 'phase', 'message', 'timestamp'], 'progress', problems);
    checkString(p, 'operationId', 'progress', problems);
    checkFiniteNumber(p, 'sequence', 'progress', problems);
    checkString(p, 'phase', 'progress', problems);
    checkString(p, 'message', 'progress', problems);
    checkString(p, 'timestamp', 'progress', problems);
    checkOptString(p, 'agent', 'progress', problems);
  });
}
