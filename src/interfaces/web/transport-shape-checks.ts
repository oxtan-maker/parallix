/**
 * Web transport shape checks: validate each nested wire DTO (cards, work,
 * metrics, evidence) and accumulate its problems.
 */

import { LANES, GATES, ACTION_STATES, CERTAINTIES, ATTENTION_REASONS, COMMAND_KINDS, isPlainObject, checkKeys, checkString, checkNullableString, checkBoolean, checkFiniteNumber, checkNullableFiniteNumber, checkEnum, checkStringArray, checkOptString, checkOptionalNullableNumber, checkDuration } from './transport-validation-primitives.js';

export function checkCommandAction(object: unknown, path: string, problems: string[]): void {
  if (!isPlainObject(object)) { problems.push(`${path} must be an object`); return; }
  checkKeys(object, ['kind', 'display', 'state', 'reason', 'targetLane', 'label'], ['kind', 'display', 'state', 'reason', 'targetLane'], path, problems);
  if ('label' in object) { checkString(object, 'label', path, problems); }
  checkEnum(object, 'kind', COMMAND_KINDS, path, problems);
  checkString(object, 'display', path, problems);
  checkEnum(object, 'state', ACTION_STATES, path, problems);
  checkNullableString(object, 'reason', path, problems);
  if (object.targetLane !== null) { checkEnum(object, 'targetLane', LANES, path, problems); }
}

function checkWork(object: unknown, path: string, problems: string[]): void {
  if (!isPlainObject(object)) { problems.push(`${path} must be an object`); return; }
  const { kind } = object;
  if (kind === 'working') {
    checkKeys(object, ['kind', 'certainty', 'phase', 'summary', 'agent', 'operationId'],
      ['kind', 'certainty', 'phase', 'summary', 'agent', 'operationId'], path, problems);
    checkEnum(object, 'certainty', CERTAINTIES, path, problems);
    checkString(object, 'phase', path, problems);
    checkString(object, 'summary', path, problems);
    checkNullableString(object, 'agent', path, problems);
    checkString(object, 'operationId', path, problems);
  } else if (kind === 'blocked') {
    checkKeys(object, ['kind', 'reason'], ['kind', 'reason'], path, problems);
    checkString(object, 'reason', path, problems);
  } else if (kind === 'idle') {
    checkKeys(object, ['kind'], ['kind'], path, problems);
  } else {
    problems.push(`${path}.kind must be "working", "blocked", or "idle", got ${String(kind)}`);
  }
}

function checkCoordinator(object: unknown, path: string, problems: string[]): void {
  if (!isPlainObject(object)) { problems.push(`${path} must be an object`); return; }
  const { state } = object;
  if (state === 'live') {
    checkKeys(object, ['state', 'family'], ['state', 'family'], path, problems);
    checkNullableString(object, 'family', path, problems);
  } else if (state === 'stopped' || state === 'unknown') {
    checkKeys(object, ['state'], ['state'], path, problems);
  } else {
    problems.push(`${path}.state must be "live", "stopped", or "unknown", got ${String(state)}`);
  }
}

function checkPullRequest(object: unknown, path: string, problems: string[]): void {
  if (object === null) { return; }
  if (!isPlainObject(object)) { problems.push(`${path} must be an object or null`); return; }
  checkKeys(object,
    ['kind', 'provider', 'id', 'url', 'sourceBranch', 'targetBranch'],
    ['kind', 'provider', 'id', 'url', 'sourceBranch', 'targetBranch'], path, problems);
  if (object.kind !== 'pull-request') { problems.push(`${path}.kind must be "pull-request", got ${String(object.kind)}`); }
  checkString(object, 'provider', path, problems);
  checkString(object, 'id', path, problems);
  checkNullableString(object, 'url', path, problems);
  checkString(object, 'sourceBranch', path, problems);
  checkString(object, 'targetBranch', path, problems);
}

function checkCheckpointEvidence(object: unknown, path: string, problems: string[]): void {
  if (!Array.isArray(object)) {
    problems.push(`${path}.checkpointEvidence must be an array`);
    return;
  }
  object.forEach((checkpoint, index) => {
    const checkpointPath = `${path}.checkpointEvidence[${index}]`;
    if (!isPlainObject(checkpoint)) { problems.push(`${checkpointPath} must be an object`); return; }
    checkKeys(checkpoint, ['name', 'description', 'goalCheck'], ['name', 'description', 'goalCheck'], checkpointPath, problems);
    checkString(checkpoint, 'name', checkpointPath, problems);
    checkString(checkpoint, 'description', checkpointPath, problems);
    const rows = checkpoint.goalCheck as unknown;
    if (!Array.isArray(rows)) { problems.push(`${checkpointPath}.goalCheck must be an array`); return; }
    rows.forEach((row, rowIndex) => {
      const rowPath = `${checkpointPath}.goalCheck[${rowIndex}]`;
      if (!isPlainObject(row)) { problems.push(`${rowPath} must be an object`); return; }
      checkKeys(row, ['criterion', 'evidence'], ['criterion', 'evidence'], rowPath, problems);
      checkString(row, 'criterion', rowPath, problems);
      checkString(row, 'evidence', rowPath, problems);
    });
  });
}

function checkReviewRound(object: unknown, path: string, problems: string[]): void {
  if (!isPlainObject(object)) { problems.push(`${path} must be an object`); return; }
  checkKeys(object,
    ['number', 'reviewer', 'implementer', 'phase', 'disposition', 'comment',
      'findingSummaries', 'pushbacks', 'fixes'],
    ['number', 'reviewer', 'implementer', 'phase', 'disposition', 'comment',
      'findingSummaries', 'pushbacks', 'fixes'], path, problems);
  checkFiniteNumber(object, 'number', path, problems);
  checkString(object, 'reviewer', path, problems);
  checkString(object, 'implementer', path, problems);
  checkString(object, 'phase', path, problems);
  checkNullableString(object, 'disposition', path, problems);
  checkNullableString(object, 'comment', path, problems);
  checkStringArray(object, 'findingSummaries', path, problems);
  checkStringArray(object, 'pushbacks', path, problems);
  checkStringArray(object, 'fixes', path, problems);
}

export function checkMissionCard(object: unknown, path: string, problems: string[]): void {
  if (!isPlainObject(object)) { problems.push(`${path} must be an object`); return; }
  checkKeys(object,
    ['id', 'title', 'lane', 'status', 'closed', 'agent', 'checkpoint', 'checkpointDescription',
      'checkpointEvidence', 'nextActionText', 'gate', 'pullRequest', 'reviewApproved', 'reviewRound', 'reviewPhase',
      'reviewDisposition', 'reviewHistory', 'blockingReason', 'flags', 'activity', 'actions'],
    ['id', 'title', 'lane', 'status', 'closed', 'agent', 'checkpoint', 'checkpointDescription',
      'nextActionText', 'gate', 'pullRequest', 'reviewApproved', 'reviewRound', 'reviewPhase',
      'reviewDisposition', 'reviewHistory', 'blockingReason', 'flags', 'activity', 'actions'], path, problems);
  checkString(object, 'id', path, problems);
  checkString(object, 'title', path, problems);
  checkEnum(object, 'lane', LANES, path, problems);
  checkEnum(object, 'status', LANES, path, problems);
  checkBoolean(object, 'closed', path, problems);
  checkNullableString(object, 'agent', path, problems);
  checkNullableString(object, 'checkpoint', path, problems);
  checkNullableString(object, 'checkpointDescription', path, problems);
  // checkpointEvidence is optional-and-nullable: an omitted field means "no
  // evidence" and is never malformed, so it is not in the required list above.
  if (Object.prototype.hasOwnProperty.call(object, 'checkpointEvidence')) {
    checkCheckpointEvidence(object.checkpointEvidence, `${path}.checkpointEvidence`, problems);
  }
  checkNullableString(object, 'nextActionText', path, problems);
  checkEnum(object, 'gate', GATES, path, problems);
  checkPullRequest(object.pullRequest, `${path}.pullRequest`, problems);
  checkBoolean(object, 'reviewApproved', path, problems);
  checkNullableFiniteNumber(object, 'reviewRound', path, problems);
  checkNullableString(object, 'reviewPhase', path, problems);
  checkNullableString(object, 'reviewDisposition', path, problems);
  if (Array.isArray(object.reviewHistory)) {
    object.reviewHistory.forEach((round, index) => checkReviewRound(round, `${path}.reviewHistory[${index}]`, problems));
  } else {
    problems.push(`${path}.reviewHistory must be an array`);
  }
  checkNullableString(object, 'blockingReason', path, problems);
  checkStringArray(object, 'flags', path, problems);
  if (isPlainObject(object.activity)) {
    checkKeys(object.activity, ['work', 'coordinator'], ['work', 'coordinator'], `${path}.activity`, problems);
    checkWork(object.activity.work, `${path}.activity.work`, problems);
    checkCoordinator(object.activity.coordinator, `${path}.activity.coordinator`, problems);
  } else {
    problems.push(`${path}.activity must be an object`);
  }
  if (Array.isArray(object.actions)) {
    object.actions.forEach((action, index) => checkCommandAction(action, `${path}.actions[${index}]`, problems));
  } else {
    problems.push(`${path}.actions must be an array`);
  }
}

export function checkAttentionItem(object: unknown, path: string, problems: string[]): void {
  if (!isPlainObject(object)) { problems.push(`${path} must be an object`); return; }
  checkKeys(object, ['missionId', 'rank', 'reason', 'action', 'dependsOnSources'],
    ['missionId', 'rank', 'reason', 'action', 'dependsOnSources'], path, problems);
  checkString(object, 'missionId', path, problems);
  checkFiniteNumber(object, 'rank', path, problems);
  if (isPlainObject(object.reason)) {
    checkKeys(object.reason, ['kind', 'detail'], ['kind', 'detail'], `${path}.reason`, problems);
    checkEnum(object.reason, 'kind', ATTENTION_REASONS, `${path}.reason`, problems);
    checkNullableString(object.reason, 'detail', `${path}.reason`, problems);
  } else {
    problems.push(`${path}.reason must be an object`);
  }
  checkCommandAction(object.action, `${path}.action`, problems);
  checkStringArray(object, 'dependsOnSources', path, problems);
}

export function checkLogEntry(object: unknown, path: string, problems: string[]): void {
  if (!isPlainObject(object)) { problems.push(`${path} must be an object`); return; }
  checkKeys(object, ['operationId', 'phase', 'message', 'timestamp', 'agent'],
    ['operationId', 'phase', 'message', 'timestamp'], path, problems);
  checkString(object, 'operationId', path, problems);
  checkString(object, 'phase', path, problems);
  checkString(object, 'message', path, problems);
  checkString(object, 'timestamp', path, problems);
  checkOptString(object, 'agent', path, problems);
}

export function checkAgentAvailability(object: unknown, path: string, problems: string[]): void {
  if (!isPlainObject(object)) { problems.push(`${path} must be an object`); return; }
  checkKeys(object, ['family', 'available', 'blockedFor', 'reason', 'runningSessions'],
    ['family', 'available', 'blockedFor', 'reason'], path, problems);
  checkString(object, 'family', path, problems);
  checkBoolean(object, 'available', path, problems);
  checkDuration(object.blockedFor, `${path}.blockedFor`, problems);
  checkNullableString(object, 'reason', path, problems);
  checkOptionalNullableNumber(object, 'runningSessions', path, problems);
}

export function checkSourceFact(object: unknown, path: string, problems: string[]): void {
  if (!isPlainObject(object)) { problems.push(`${path} must be an object`); return; }
  checkKeys(object, ['source', 'status', 'value'], ['source', 'status'], path, problems);
  checkString(object, 'source', path, problems);
  checkString(object, 'status', path, problems);
  checkOptString(object, 'value', path, problems);
}

type MetricSeriesKey = 'cumulativeFlowByState' | 'weeklyCumulativeFlow' | 'medianCycleTimeByState';

function checkMetricWindow(window: unknown, path: string, problems: string[]): void {
  if (!isPlainObject(window)) { problems.push(`${path} must be an object`); return; }
  checkKeys(window, ['startDate', 'endDate', 'label'], ['startDate', 'endDate', 'label'], path, problems);
  checkString(window, 'startDate', path, problems);
  checkString(window, 'endDate', path, problems);
  checkString(window, 'label', path, problems);
}

function checkMetricPoint(key: MetricSeriesKey, point: unknown, path: string, problems: string[]): void {
  if (!isPlainObject(point)) { problems.push(`${path} must be an object`); return; }
  if (key === 'cumulativeFlowByState' || key === 'weeklyCumulativeFlow') {
    checkKeys(point, ['at', 'counts', 'observationCount'], ['at', 'counts'], path, problems);
    checkString(point, 'at', path, problems);
    if (!isPlainObject(point.counts)) { problems.push(`${path}.counts must be an object`); }
  } else {
    checkKeys(point, ['lane', 'value', 'observationCount'], ['lane', 'value'], path, problems);
    checkString(point, 'lane', path, problems);
    checkNullableFiniteNumber(point, 'value', path, problems);
  }
  checkOptionalNullableNumber(point, 'observationCount', path, problems);
}

function checkMetricSeries(key: MetricSeriesKey, series: unknown, path: string, problems: string[]): void {
  if (!isPlainObject(series)) { problems.push(`${path} must be an object`); return; }
  const keys = key === 'weeklyCumulativeFlow' ? ['series', 'missingHistoryFallback', 'window'] : ['series', 'missingHistoryFallback'];
  checkKeys(series, keys, keys, path, problems);
  if (key === 'weeklyCumulativeFlow') { checkMetricWindow(series.window, `${path}.window`, problems); }
  checkString(series, 'missingHistoryFallback', path, problems);
  if (!Array.isArray(series.series)) { problems.push(`${path}.series must be an array`); return; }
  series.series.forEach((point, index) => checkMetricPoint(key, point, `${path}.series[${index}]`, problems));
}

export function checkMetrics(object: unknown, path: string, problems: string[]): void {
  if (!isPlainObject(object)) { problems.push(`${path} must be an object`); return; }
  checkKeys(object, ['health', 'provenance', 'flowWindow', 'cumulativeFlowByState', 'weeklyCumulativeFlow', 'medianCycleTimeByState', 'bottleneck'], ['health', 'provenance', 'cumulativeFlowByState', 'medianCycleTimeByState', 'bottleneck'], path, problems);
  if (!isPlainObject(object.health)) { problems.push(`${path}.health must be an object`); } else { checkKeys(object.health, ['state'], ['state'], `${path}.health`, problems); checkString(object.health, 'state', `${path}.health`, problems); }
  if (!isPlainObject(object.provenance)) { problems.push(`${path}.provenance must be an object`); } else { checkKeys(object.provenance, ['sampleSize', 'newestEventTimestamp'], ['sampleSize', 'newestEventTimestamp'], `${path}.provenance`, problems); checkFiniteNumber(object.provenance, 'sampleSize', `${path}.provenance`, problems); checkNullableString(object.provenance, 'newestEventTimestamp', `${path}.provenance`, problems); }
  if (object.flowWindow !== undefined) { checkMetricWindow(object.flowWindow, `${path}.flowWindow`, problems); }
  for (const key of ['cumulativeFlowByState', 'weeklyCumulativeFlow', 'medianCycleTimeByState'] as MetricSeriesKey[]) {
    const series = object[key]; const seriesPath = `${path}.${key}`;
    if (key === 'weeklyCumulativeFlow' && series === undefined) { continue; }
    checkMetricSeries(key, series, seriesPath, problems);
  }
  if (!isPlainObject(object.bottleneck)) { problems.push(`${path}.bottleneck must be an object`); } else { checkKeys(object.bottleneck, ['sentence'], ['sentence'], `${path}.bottleneck`, problems); checkString(object.bottleneck, 'sentence', `${path}.bottleneck`, problems); }
}

