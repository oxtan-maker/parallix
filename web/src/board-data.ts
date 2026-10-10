import type { WebEditMissionRequest } from '../../src/interfaces/web/transport-edit-mission.js';
/**
 * The browser's only network read: `GET /api/board`, validated by the shared
 * transport contract (`src/interfaces/web/transport.ts`) before anything
 * renders. Every failure the contract distinguishes stays a distinct state —
 * a transport-rejected payload never degrades into "no data", and a previously
 * fetched snapshot is never shown as current (ADR 0054, ADR 0055).
 *
 * No caching, no retry, no polling: `board-sync.ts` decides when to read, and
 * each call performs exactly one read.
 */
import { validateWebBoardSnapshot, validateWebCommandResult, type WebBoardSnapshot, type WebCommandRequest, type WebCommandResult, type WebCreateMissionRequest } from '../../src/interfaces/web/transport.js';

/** The snapshot read path. This client has no mutation route. */
export const SNAPSHOT_PATH = '/api/board';
export const COMMANDS_PATH = '/api/commands';
export const terminalPath = (missionId: string) => `/api/terminal/${encodeURIComponent(missionId)}`;

export type TerminalState =
  | { readonly kind: 'live'; readonly output: string }
  | { readonly kind: 'captured'; readonly output: string; readonly message: string }
  | { readonly kind: 'unavailable'; readonly message: string };

/** The terminal endpoint is a GET-only, same-origin read. */
export async function loadTerminal(missionId: string, signal?: AbortSignal): Promise<TerminalState> {
  try {
    const deadline = AbortSignal.timeout(30000);
    const response = await fetch(terminalPath(missionId), { headers: { accept: 'application/json' }, signal: signal === undefined ? deadline : AbortSignal.any([signal, deadline]) });
    const body: unknown = await response.json();
    if (typeof body === 'object' && body !== null && (body as { kind?: unknown }).kind === 'captured'
      && typeof (body as { output?: unknown }).output === 'string' && typeof (body as { message?: unknown }).message === 'string') {
      return { kind: 'captured', output: (body as { output: string }).output, message: (body as { message: string }).message };
    }
    if (typeof body === 'object' && body !== null && (body as { kind?: unknown }).kind === 'live' && typeof (body as { output?: unknown }).output === 'string') {
      return { kind: 'live', output: (body as { output: string }).output };
    }
    if (typeof body === 'object' && body !== null && typeof (body as { message?: unknown }).message === 'string') {
      return { kind: 'unavailable', message: (body as { message: string }).message };
    }
    return { kind: 'unavailable', message: `Mission terminal is unavailable (HTTP ${response.status}).` };
  } catch {
    return { kind: 'unavailable', message: 'Mission terminal is unavailable.' };
  }
}

/** The four presentation states the board contract distinguishes, plus loading. */
export type SnapshotState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly snapshot: WebBoardSnapshot }
  | { readonly kind: 'request-failed'; readonly detail: string }
  | { readonly kind: 'malformed'; readonly problems: readonly string[] }
  | { readonly kind: 'incompatible'; readonly received: unknown; readonly supported: readonly number[] };

/** A settled state: `loadSnapshot` never resolves to `loading`. */
export type SettledSnapshotState = Exclude<SnapshotState, { kind: 'loading' }>;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Read the current board snapshot once and classify the outcome. */
export async function loadSnapshot(): Promise<SettledSnapshotState> {
  let response: Response;
  try {
    response = await fetch(SNAPSHOT_PATH, { headers: { accept: 'application/json' } });
  } catch (error) {
    return { kind: 'request-failed', detail: describe(error) };
  }
  if (!response.ok) {
    return { kind: 'request-failed', detail: `HTTP ${response.status} ${response.statusText}`.trim() };
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch (error) {
    return { kind: 'malformed', problems: [`response body is not JSON: ${describe(error)}`] };
  }
  // Narrow the validation result by field presence rather than by its `ok`
  // discriminant: `in` narrowing holds under every strictness setting this
  // repository typechecks with, including the test project's non-strict one.
  const validation = validateWebBoardSnapshot(payload);
  if ('supported' in validation) {
    return { kind: 'incompatible', received: validation.received, supported: validation.supported };
  }
  if ('problems' in validation) {
    return { kind: 'malformed', problems: validation.problems };
  }
  return { kind: 'ready', snapshot: validation.value };
}

async function postCommand(request: WebCommandRequest | WebCreateMissionRequest | WebEditMissionRequest): Promise<WebCommandResult> {
  const csrf = globalThis.document?.querySelector('meta[name="px-csrf"]')?.getAttribute('content');
  const response = await fetch(COMMANDS_PATH, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { accept: 'application/json', 'content-type': 'application/json', ...(typeof csrf === 'string' ? { 'x-px-csrf': csrf } : {}) },
    body: JSON.stringify(request),
  });
  const payload: unknown = await response.json();
  const result = validateWebCommandResult(payload);
  if (!result.ok) { throw new Error(`invalid command result: ${'problems' in result ? result.problems.join('; ') : 'unsupported transport version'}`); }
  return result.value;
}

/** Dispatch only the typed request selected from the current projection. */
export function sendCommand(request: WebCommandRequest): Promise<WebCommandResult> {
  return postCommand(request);
}

/** Create a backlog mission; the host allocates the identity and returns it in `value.missionId`. */
export function sendCreateMission(request: WebCreateMissionRequest): Promise<WebCommandResult> {
  return postCommand(request);
}

export function sendEditMission(request: WebEditMissionRequest): Promise<WebCommandResult> { return postCommand(request); }
