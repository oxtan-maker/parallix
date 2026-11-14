import { isPlainObject, checkEnum, checkFiniteNumber, checkKeys, checkNullableFiniteNumber, checkNullableString, checkString, checkStringArray } from './transport-validation-primitives.js';

const MODES = ['two-independent', 'one-independent', 'same-agent'] as const;
const STATES = ['queued', 'running', 'waiting', 'completed', 'failed'] as const;
const OUTCOMES = ['approved', 'changes-requested', 'unknown'] as const;

function checkUnavailable(value: unknown, path: string, problems: string[]): void {
  if (!Array.isArray(value)) { problems.push(`${path} must be an array`); return; }
  value.forEach((entry, index) => {
    const entryPath = `${path}[${index}]`;
    if (!isPlainObject(entry)) { problems.push(`${entryPath} must be an object`); return; }
    checkKeys(entry, ['family', 'reason'], ['family', 'reason'], entryPath, problems);
    checkString(entry, 'family', entryPath, problems);
    checkString(entry, 'reason', entryPath, problems);
  });
}

function checkReviewer(value: unknown, path: string, problems: string[]): void {
  if (!isPlainObject(value)) { problems.push(`${path} must be an object`); return; }
  checkKeys(value, ['reviewer', 'reviewerLabel', 'runId', 'runLabel', 'state', 'outcome', 'status', 'blocker'],
    ['reviewer', 'reviewerLabel', 'runId', 'runLabel', 'state', 'outcome', 'status', 'blocker'], path, problems);
  checkString(value, 'reviewer', path, problems);
  checkString(value, 'reviewerLabel', path, problems);
  checkNullableString(value, 'runId', path, problems);
  checkString(value, 'runLabel', path, problems);
  checkEnum(value, 'state', STATES, path, problems);
  if (value.outcome !== null) { checkEnum(value, 'outcome', OUTCOMES, path, problems); }
  checkNullableFiniteNumber(value, 'status', path, problems);
  checkNullableString(value, 'blocker', path, problems);
}

export function checkReviewProgress(value: unknown, path: string, problems: string[]): void {
  if (value === null) { return; }
  if (!isPlainObject(value)) { problems.push(`${path} must be an object or null`); return; }
  checkKeys(value, ['round', 'revision', 'mode', 'selected', 'independentAvailable', 'requiredApprovals', 'unavailable', 'degradedReason', 'reviewers', 'blockers', 'nextAction'],
    ['round', 'revision', 'mode', 'selected', 'independentAvailable', 'requiredApprovals', 'unavailable', 'degradedReason', 'reviewers', 'blockers', 'nextAction'], path, problems);
  checkFiniteNumber(value, 'round', path, problems);
  checkString(value, 'revision', path, problems);
  checkEnum(value, 'mode', MODES, path, problems);
  checkStringArray(value, 'selected', path, problems);
  checkFiniteNumber(value, 'independentAvailable', path, problems);
  checkFiniteNumber(value, 'requiredApprovals', path, problems);
  checkUnavailable(value.unavailable, `${path}.unavailable`, problems);
  checkNullableString(value, 'degradedReason', path, problems);
  if (!Array.isArray(value.reviewers)) { problems.push(`${path}.reviewers must be an array`); }
  else { value.reviewers.forEach((entry, index) => checkReviewer(entry, `${path}.reviewers[${index}]`, problems)); }
  checkStringArray(value, 'blockers', path, problems);
  checkString(value, 'nextAction', path, problems);
}
