/**
 * The browser-to-host envelope for "Create new mission".
 *
 * It shares the one mutation route with card commands but is not card-bound:
 * a new mission has no id, lane or status to observe. The browser supplies
 * only the planning fields and a `requestKey` it keeps for the life of one
 * form, which is what makes a retry after a lost response idempotent. There is
 * no key for an identity, repository, status, capability or operation ID: the
 * host and application own those.
 */

import { checkKeys, checkString, checkStringArray, isPlainObject } from './transport-validation-primitives.js';

export interface WebCreateMissionRequest {
  readonly kind: 'mission:create';
  readonly requestKey: string;
  readonly title: string;
  readonly description?: string;
  readonly context?: string;
  readonly labels: readonly string[];
  readonly successCriteria: readonly string[];
  readonly dependencies: readonly string[];
}

export type WebCreateMissionValidation =
  | { readonly ok: true; readonly value: WebCreateMissionRequest }
  | { readonly ok: false; readonly problems: readonly string[] };

/** True when a parsed body claims to be a creation request (shape still unchecked). */
export function isCreateMissionBody(payload: unknown): boolean {
  return isPlainObject(payload) && payload.kind === 'mission:create';
}

/** Pure and fail-closed: any unknown key or mistyped field rejects the whole request. */
export function validateWebCreateMissionRequest(payload: unknown): WebCreateMissionValidation {
  if (!isPlainObject(payload)) { return { ok: false, problems: ['request must be a JSON object'] }; }
  const problems: string[] = [];
  checkKeys(payload,
    ['kind', 'requestKey', 'title', 'description', 'context', 'labels', 'successCriteria', 'dependencies'],
    ['kind', 'requestKey', 'title', 'labels', 'successCriteria', 'dependencies'],
    'request', problems);
  const requestKey = checkString(payload, 'requestKey', 'request', problems);
  if (requestKey !== null && (requestKey.length === 0 || requestKey.length > 128)) {
    problems.push('request.requestKey must be 1-128 characters');
  }
  checkString(payload, 'title', 'request', problems);
  for (const key of ['description', 'context'] as const) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) { checkString(payload, key, 'request', problems); }
  }
  for (const key of ['labels', 'successCriteria', 'dependencies'] as const) { checkStringArray(payload, key, 'request', problems); }
  if (problems.length > 0) { return { ok: false, problems }; }
  return { ok: true, value: payload as unknown as WebCreateMissionRequest };
}
