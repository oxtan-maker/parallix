/**
 * Web transport validation primitives: the validation result type, the
 * wire enumerations, and the field-level checkers the shape checks compose.
 */



// ---------------------------------------------------------------------------
// Validation — parsed payloads → DTOs or an explicit failure state
// ---------------------------------------------------------------------------

export type WebTransportValidation<T> =
  | { readonly ok: true; readonly value: T }
  | {
    readonly ok: false;
    readonly code: 'incompatible-client';
    readonly field: 'transportVersion';
    readonly received: unknown;
    readonly supported: readonly number[];
  }
  | { readonly ok: false; readonly code: 'invalid-payload'; readonly problems: readonly string[] };

export const LANES: readonly string[] = ['backlog', 'refined', 'active', 'review', 'integration', 'done'];
export const GATES: readonly string[] = ['passed', 'failed', 'running', 'unknown'];
export const ACTION_STATES: readonly string[] = ['enabled', 'ineligible', 'unavailable'];
export const CERTAINTIES: readonly string[] = ['live', 'unknown', 'stale'];
export const ATTENTION_REASONS: readonly string[] = ['blocking', 'gate-failed', 'review-lane', 'integrate-lane', 'stale-work', 'orphaned-active', 'none'];
export const TERMINAL_STATUSES: readonly string[] = ['completed', 'rejected', 'failed', 'cancelled'];
export const ERROR_KINDS: readonly string[] = ['validation', 'capability', 'conflict', 'unavailable', 'execution', 'cancelled'];
export const EVIDENCE_SOURCES: readonly string[] = ['task-markdown', 'git', 'stats', 'mission-store'];
export const COMMAND_KINDS: readonly string[] = [
  'active:execute', 'mission:intake', 'mission:create', 'draft:create', 'checkpoint:record',
  'handoff:record', 'review:submit', 'review:act-on-findings', 'approve:review',
  'integrate:merge', 'mission:cancel',
];
/** The card-advertised kinds a mutation request may name (TASK-2433). */
export const COMMAND_REQUEST_KINDS: readonly string[] = [
  'active:execute', 'draft:create', 'integrate:merge', 'handoff:record', 'review:submit',
  'mission:cancel',
];
export const BUCKET_LABELS: readonly string[] = ['Small', 'Medium', 'Large'];
export const ARTIFACT_KINDS: readonly string[] = ['file', 'git-range', 'url'];

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function checkKeys(
  object: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  path: string,
  problems: string[],
): void {
  for (const key of Object.keys(object)) {
    if (!allowed.includes(key)) { problems.push(`${path}: unexpected key "${key}"`); }
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(object, key)) { problems.push(`${path}: missing key "${key}"`); }
  }
}

export function checkString(object: Record<string, unknown>, key: string, path: string, problems: string[]): string | null {
  const value = object[key];
  if (typeof value !== 'string') { problems.push(`${path}.${key} must be a string, got ${typeof value}`); return null; }
  return value;
}

export function checkNullableString(object: Record<string, unknown>, key: string, path: string, problems: string[]): void {
  const value = object[key];
  if (value !== null && typeof value !== 'string') { problems.push(`${path}.${key} must be a string or null, got ${typeof value}`); }
}

export function checkBoolean(object: Record<string, unknown>, key: string, path: string, problems: string[]): void {
  if (typeof object[key] !== 'boolean') { problems.push(`${path}.${key} must be a boolean, got ${typeof object[key]}`); }
}

export function checkFiniteNumber(object: Record<string, unknown>, key: string, path: string, problems: string[]): void {
  const value = object[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) { problems.push(`${path}.${key} must be a finite number, got ${String(value)}`); }
}

export function checkNullableFiniteNumber(object: Record<string, unknown>, key: string, path: string, problems: string[]): void {
  const value = object[key];
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
    problems.push(`${path}.${key} must be a finite number or null, got ${String(value)}`);
  }
}

export function checkEnum(object: Record<string, unknown>, key: string, allowed: readonly string[], path: string, problems: string[]): void {
  const value = object[key];
  if (typeof value !== 'string' || !allowed.includes(value)) { problems.push(`${path}.${key} must be one of ${allowed.join(', ')}, got ${String(value)}`); }
}

export function checkStringArray(object: Record<string, unknown>, key: string, path: string, problems: string[]): void {
  const value = object[key];
  if (!Array.isArray(value) || value.some((element) => typeof element !== 'string')) {
    problems.push(`${path}.${key} must be an array of strings`);
  }
}

export function checkOptString(object: Record<string, unknown>, key: string, path: string, problems: string[]): void {
  if (Object.prototype.hasOwnProperty.call(object, key) && object[key] !== undefined) {
    const value = object[key];
    if (typeof value !== 'string') { problems.push(`${path}.${key} must be a string when present, got ${typeof value}`); }
  }
}

export function checkOptionalNullableNumber(object: Record<string, unknown>, key: string, path: string, problems: string[]): void {
  if (Object.prototype.hasOwnProperty.call(object, key) && object[key] !== undefined) {
    const value = object[key];
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
      problems.push(`${path}.${key} must be a finite number or null when present, got ${String(value)}`);
    }
  }
}

/** Recursively ensure a parsed `value` payload is JSON-representable. */
export function checkJsonValue(value: unknown, path: string, problems: string[]): void {
  if (value === null) { return; }
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return;
    case 'number':
      if (!Number.isFinite(value)) { problems.push(`${path} must be a finite number, got ${String(value)}`); }
      return;
    case 'bigint':
    case 'function':
    case 'symbol':
    case 'undefined':
      problems.push(`${path} is not JSON-representable`);
      return;
    default:
      break;
  }
  if (Array.isArray(value)) {
    value.forEach((element, index) => checkJsonValue(element, `${path}[${index}]`, problems));
    return;
  }
  if (value instanceof Set || value instanceof Map) {
    problems.push(`${path} is not JSON-representable`);
    return;
  }
  for (const [key, element] of Object.entries(value as Record<string, unknown>)) {
    checkJsonValue(element, `${path}.${key}`, problems);
  }
}

export function checkDuration(object: unknown, path: string, problems: string[]): void {
  if (!isPlainObject(object)) { problems.push(`${path} must be an object`); return; }
  checkKeys(object, ['kind', 'ms'], ['kind'], path, problems);
  if (object.kind === 'indefinite') {
    if (Object.prototype.hasOwnProperty.call(object, 'ms')) { problems.push(`${path}: indefinite duration has no ms`); }
  } else if (object.kind === 'finite') {
    checkFiniteNumber(object, 'ms', path, problems);
  } else {
    problems.push(`${path}.kind must be "finite" or "indefinite", got ${String(object.kind)}`);
  }
}

