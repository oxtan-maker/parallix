/** Handwritten history boundary, shared by route projection and browser reads. */
import { isPlainObject, checkString, checkNullableString, checkBoolean, checkEnum, checkStringArray } from './transport-validation-primitives.js';
import type { HistoryOverview, HistoryPage, HistorySearch, LiveView } from './history-transport-types.js';

type ObjectValue = Record<string, unknown>;
type Check = (_value: ObjectValue, _problems: string[]) => void;
const states = ['starting', 'live', 'ended', 'capture-only', 'missing', 'probe-failed', 'probe-timeout', 'ambiguous'];
function strings(value: ObjectValue, keys: string[], problems: string[]) {
  for (const key of keys) { checkString(value, key, 'history', problems); }
}
function arrays(value: ObjectValue, keys: string[], problems: string[]) {
  for (const key of keys) { checkStringArray(value, key, 'history', problems); }
}
function enums(value: ObjectValue, key: string, values: string[], problems: string[]) {
  checkEnum(value, key, values, 'history', problems);
}
/** Byte offsets/counts are non-negative safe integers; attempt numbers start at one. */
function integer(value: unknown, problems: string[], minimum = 0) {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) { problems.push('invalid integer'); }
}
function nested(value: unknown, check: Check, problems: string[]) {
  if (!isPlainObject(value)) { problems.push('expected object'); return; }
  check(value, problems);
}
function entries(value: unknown, check: Check, problems: string[]) {
  if (!Array.isArray(value)) { problems.push('expected array'); return; }
  for (const entry of value) { nested(entry, check, problems); }
}
function probe(value: ObjectValue, problems: string[]) {
  enums(value, 'kind', ['absent', 'idle', 'starting', 'live', 'ambiguous', 'unavailable'], problems);
  if (value.kind === 'starting' || value.kind === 'live') {
    strings(value, ['operation'], problems);
    if ('runId' in value) { checkNullableString(value, 'runId', 'probe', problems); }
    if ('execution' in value && (value.kind !== 'live' || (value.execution !== null && typeof value.execution !== 'boolean'))) { problems.push('invalid execution'); }
  }
  if (value.kind === 'ambiguous') { arrays(value, ['sessions'], problems); strings(value, ['detail'], problems); }
  if (value.kind === 'unavailable') {
    enums(value, 'reason', ['host-missing', 'failed', 'timeout'], problems);
    strings(value, ['detail'], problems);
  }
}
function operation(value: ObjectValue, problems: string[]) {
  strings(value, ['runId', 'role', 'startedAt'], problems);
  for (const key of ['operationId', 'family', 'endedAt', 'signal']) { checkNullableString(value, key, 'operation', problems); }
  enums(value, 'captureKind', ['agent', 'coordinator'], problems);
  enums(value, 'execution', ['live', 'stopped', 'unknown'], problems);
  enums(value, 'state', ['running', 'exited', 'interrupted'], problems);
  enums(value, 'terminalHost', ['pipe', 'tmux'], problems);
  for (const key of ['legacy', 'redacted']) { checkBoolean(value, key, 'operation', problems); }
  if (value.attempt !== null) { integer(value.attempt, problems, 1); }
  // Process exit codes are signed integers; null means no exit result.
  if (value.exitCode !== null && (typeof value.exitCode !== 'number' || !Number.isSafeInteger(value.exitCode))) { problems.push('invalid exit code'); }
  nested(value.streams, (streams, errors) => { integer(streams.stdout, errors); integer(streams.stderr, errors); }, problems);
  arrays(value, ['coverage'], problems);
}
function range(value: ObjectValue, problems: string[]) {
  integer(value.from, problems); integer(value.to, problems);
  if (typeof value.from === 'number' && typeof value.to === 'number' && value.to < value.from) { problems.push('reversed range'); }
}
function stream(value: ObjectValue, problems: string[]) {
  strings(value, ['runId'], problems); enums(value, 'stream', ['stdout', 'stderr'], problems);
}
function overview(value: ObjectValue, problems: string[]) {
  strings(value, ['missionId'], problems); enums(value, 'state', states, problems);
  nested(value.probe, probe, problems); entries(value.operations, operation, problems);
  arrays(value, ['notices', 'unattributed'], problems);
}
function page(value: ObjectValue, problems: string[]) {
  stream(value, problems); range(value, problems); strings(value, ['text'], problems);
  for (const key of ['hasEarlier', 'atEnd', 'running']) { checkBoolean(value, key, 'page', problems); }
  entries(value.gaps, range, problems);
}
function search(value: ObjectValue, problems: string[]) {
  entries(value.hits, (hit, errors) => { stream(hit, errors); strings(hit, ['ref', 'preview'], errors); integer(hit.offset, errors); }, problems);
  integer(value.totalHits, problems);
  checkBoolean(value, 'scanLimited', 'search', problems);
  arrays(value, ['searchedRuns', 'coverage', 'errors'], problems);
  if (Array.isArray(value.hits) && typeof value.totalHits === 'number' && value.totalHits < value.hits.length) { problems.push('hit count mismatch'); }
}
function live(value: ObjectValue, problems: string[]) {
  enums(value, 'kind', ['live', 'not-live'], problems);
  if (value.kind === 'live') { checkNullableString(value, 'operation', 'live', problems); strings(value, ['output'], problems); }
  else if (value.kind === 'not-live') { nested(value.probe, probe, problems); }
}
function validate<T>(value: unknown, check: Check): T | null {
  const problems: string[] = [];
  nested(value, check, problems);
  // The assertion is confined to this complete handwritten validation boundary.
  return problems.length === 0 ? value as T : null;
}
export const validateHistoryOverview = (value: unknown): HistoryOverview | null => validate(value, overview);
export const validateHistoryPage = (value: unknown): HistoryPage | null => validate(value, page);
export const validateHistorySearch = (value: unknown): HistorySearch | null => validate(value, search);
export const validateHistoryLive = (value: unknown): LiveView | null => validate(value, live);
