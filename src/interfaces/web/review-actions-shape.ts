import { isPlainObject, checkKeys } from './transport-validation-primitives.js';

const isCount = (value: unknown, minimum: number): boolean => Number.isSafeInteger(value) && Number(value) >= minimum;

function checkLimitHit(hit: unknown, used: unknown, path: string, problems: string[]): void {
  if (hit === null) { return; }
  if (!isPlainObject(hit)) { problems.push(`${path} must be an object or null`); return; }
  checkKeys(hit, ['actionSequence', 'limit', 'recordedAt'], ['actionSequence', 'limit', 'recordedAt'], path, problems);
  const { actionSequence, limit, recordedAt } = hit;
  if (!isCount(actionSequence, 1)) { problems.push(`${path}.actionSequence must be a whole positive action number`); }
  if (!isCount(limit, 1)) { problems.push(`${path}.limit must be a whole positive limit`); }
  if (typeof recordedAt !== 'string' || !Number.isFinite(Date.parse(recordedAt))) {
    problems.push(`${path}.recordedAt must be an ISO timestamp`);
  }
  if (!isCount(actionSequence, 1) || !isCount(limit, 1)) { return; }
  if (Number(actionSequence) < Number(limit)) { problems.push(`${path} must record an action that reached its limit`); }
  if (isCount(used, 0) && Number(actionSequence) > Number(used)) { problems.push(`${path}.actionSequence must not exceed used`); }
}

/**
 * Fail-closed shape of the server-owned review action facts: whole counts, a positive limit
 * or null when unknown, and a limit hit only as an explicit record that agrees with them.
 */
export function checkReviewActions(value: unknown, path: string, problems: string[]): void {
  if (value === null) { return; }
  if (!isPlainObject(value)) { problems.push(`${path} must be an object or null`); return; }
  checkKeys(value, ['used', 'limit', 'limitHit'], ['used', 'limit', 'limitHit'], path, problems);
  if (!isCount(value.used, 0)) { problems.push(`${path}.used must be a whole non-negative action count`); }
  if (value.limit !== null && !isCount(value.limit, 1)) { problems.push(`${path}.limit must be a whole positive limit or null`); }
  checkLimitHit(value.limitHit, value.used, `${path}.limitHit`, problems);
}
