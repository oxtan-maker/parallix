import type { WebEditMissionRequest } from '../../src/interfaces/web/transport-edit-mission.js';
import { useEffect, useState } from 'react';
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
import { validateWebBoardSnapshot, validateWebMissionDetail, validateWebCommandResult, type WebBoardSnapshot, type WebMissionDetail, type WebCommandRequest, type WebCommandResult, type WebCreateMissionRequest } from '../../src/interfaces/web/transport.js';

/** The snapshot read path. This client has no mutation route. */
export const SNAPSHOT_PATH = '/api/board';
export const COMMANDS_PATH = '/api/commands';
export const missionDetailPath = (missionId: string) => `/api/board/${encodeURIComponent(missionId)}/detail`;

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

/** Explain why deferred facts do not describe the rendered board projection. */
export function missionDetailRevisionError(detail: WebMissionDetail, expectedRevision: string | null): string | null {
  if (expectedRevision === null) { return 'the board snapshot has no projection revision'; }
  if (detail.freshness.revision === expectedRevision) { return null; }
  return `detail describes projection ${detail.freshness.revision ?? 'unavailable'}, while the board shows ${expectedRevision}; refresh the board and reopen the detail`;
}

class MissionDetailRevisionMismatch extends Error {}

/** Load one deferred review/checkpoint payload and reject every malformed or mismatched shape. */
export async function loadMissionDetail(missionId: string, expectedRevision: string | null): Promise<WebMissionDetail> {
  const response = await fetch(missionDetailPath(missionId), { headers: { accept: 'application/json' } });
  if (!response.ok) { throw new Error(`HTTP ${response.status} ${response.statusText}`.trim()); }
  let payload: unknown;
  try { payload = await response.json(); }
  catch (error) { throw new Error(`mission detail is not JSON: ${describe(error)}`); }
  const validation = validateWebMissionDetail(payload);
  if ('supported' in validation) {
    throw new Error(`mission detail transport ${String(validation.received)} is incompatible; supported: ${validation.supported.join(', ')}`);
  }
  if ('problems' in validation) { throw new Error(`invalid mission detail: ${validation.problems.join('; ')}`); }
  const revisionError = missionDetailRevisionError(validation.value, expectedRevision);
  if (revisionError !== null) { throw new MissionDetailRevisionMismatch(revisionError); }
  return validation.value;
}

/** One deferred-detail state machine shared by every board disclosure. */
export function useMissionDetail(missionId: string, openedRevision: string | null, currentRevision: string | null): {
  readonly detail: WebMissionDetail | null;
  readonly error: string | null;
} {
  const [detail, setDetail] = useState<WebMissionDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requestRevision, setRequestRevision] = useState(openedRevision);
  const [waitingForCurrent, setWaitingForCurrent] = useState(false);
  const [retried, setRetried] = useState(false);
  useEffect(() => {
    let live = true;
    setError(null);
    void loadMissionDetail(missionId, requestRevision).then(value => {
      if (live) { setDetail(value); setError(null); }
    }, failure => {
      if (!live) { return; }
      if (failure instanceof MissionDetailRevisionMismatch && requestRevision !== null && !retried) {
        setWaitingForCurrent(true);
        return;
      }
      setError(describe(failure));
    });
    return () => { live = false; };
  }, [missionId, requestRevision, retried]);
  useEffect(() => {
    if (!waitingForCurrent || retried || currentRevision === requestRevision) { return; }
    setWaitingForCurrent(false);
    setRetried(true);
    setRequestRevision(currentRevision);
  }, [currentRevision, requestRevision, retried, waitingForCurrent]);
  return { detail, error };
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
