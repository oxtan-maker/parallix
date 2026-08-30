/**
 * The browser's only network read: `GET /api/board`, validated by the shared
 * transport contract (`src/interfaces/web/transport.ts`) before anything
 * renders. Every failure the contract distinguishes stays a distinct state —
 * a transport-rejected payload never degrades into "no data", and a previously
 * fetched snapshot is never shown as current (ADR 0054, ADR 0055).
 *
 * No caching, no retry, no polling: each page load performs exactly one read.
 */
import { validateWebBoardSnapshot, type WebBoardSnapshot } from '../../src/interfaces/web/transport.js';

/** The snapshot read path. This client has no mutation route. */
export const SNAPSHOT_PATH = '/api/board';

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
