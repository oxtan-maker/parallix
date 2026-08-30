/**
 * stream.ts — the per-host event stream behind the SSE route (ADR 0055).
 *
 * Three deliberate constraints live here rather than in the route handler, so
 * they can be proven without a socket:
 *
 *   - One monotonic integer id counter per host process, shared by every event
 *     name and every connected client. Ids are the reconnect cursor, so two
 *     clients must never see the same id mean two different things.
 *   - A replay buffer bounded by `WEB_EVENT_BUFFER_LIMIT`, evicted oldest
 *     first. This is notification state, not history: a client that falls
 *     further behind than the bound re-establishes truth by refetching the
 *     snapshot, which is the same thing it does on any reconnect.
 *   - A listener registry whose size is observable, because one shared
 *     projection subscription feeding many clients makes disconnect
 *     accounting the leak point.
 *
 * Nothing here is persisted. The buffer, the counter, and the listeners all
 * die with the process, exactly like the per-launch session value.
 */

import {
  WEB_TRANSPORT_VERSION,
  type WebCommandError,
  type WebProgressEvent,
  type WebTransportVersion,
} from './transport.js';

/**
 * How many events the replay buffer retains. Exported so the eviction test
 * asserts against the bound rather than a copied literal.
 */
export const WEB_EVENT_BUFFER_LIMIT = 256;

/** SSE event names. `invalidate` deliberately carries no board payload. */
export type WebStreamEventName = 'progress' | 'invalidate' | 'error';

/** "The projection changed; refetch the snapshot." Never a board. */
export interface WebProjectionInvalidated {
  readonly kind: 'projection-invalidated';
  readonly transportVersion: WebTransportVersion;
}

/** A stream-level failure, surfaced instead of a fabricated empty board. */
export interface WebStreamError {
  readonly kind: 'stream-error';
  readonly transportVersion: WebTransportVersion;
  readonly error: WebCommandError;
}

export type WebStreamPayload = WebProgressEvent | WebProjectionInvalidated | WebStreamError;

export interface WebStreamFrame {
  readonly id: number;
  readonly name: WebStreamEventName;
  readonly payload: WebStreamPayload;
}

export type WebStreamListener = (_frame: WebStreamFrame) => void;

export interface WebEventStream {
  /** Assign the next id, buffer the frame, and fan it out. */
  publish(_name: WebStreamEventName, _payload: WebStreamPayload): WebStreamFrame;
  publishProgress(_event: WebProgressEvent): WebStreamFrame;
  publishInvalidation(): WebStreamFrame;
  publishError(_error: WebCommandError): WebStreamFrame;
  /** Buffered frames with an id strictly greater than `Last-Event-ID`. */
  replayAfter(_lastEventId: string | undefined): readonly WebStreamFrame[];
  subscribe(_listener: WebStreamListener): () => void;
  /** Drop every listener; used when the host closes. */
  clearListeners(): void;
  listenerCount(): number;
  bufferedCount(): number;
  /** Read-only view of the buffer, oldest first. */
  buffered(): readonly WebStreamFrame[];
}

export function createWebEventStream(bufferLimit: number = WEB_EVENT_BUFFER_LIMIT): WebEventStream {
  if (!Number.isInteger(bufferLimit) || bufferLimit < 1) {
    throw new Error(`web event buffer limit must be a positive integer, got ${String(bufferLimit)}`);
  }
  let nextId = 0;
  // Mutated in place with push/shift: no `buffer = [...buffer, frame]`, which
  // is how an "in-memory history" quietly becomes an unbounded leak.
  const buffer: WebStreamFrame[] = [];
  const listeners = new Set<WebStreamListener>();

  function publish(name: WebStreamEventName, payload: WebStreamPayload): WebStreamFrame {
    nextId += 1;
    const frame: WebStreamFrame = { id: nextId, name, payload };
    buffer.push(frame);
    while (buffer.length > bufferLimit) { buffer.shift(); }
    for (const listener of [...listeners]) { listener(frame); }
    return frame;
  }

  return {
    publish,
    publishProgress: (event) => publish('progress', event),
    publishInvalidation: () => publish('invalidate', {
      kind: 'projection-invalidated',
      transportVersion: WEB_TRANSPORT_VERSION,
    }),
    publishError: (error) => publish('error', {
      kind: 'stream-error',
      transportVersion: WEB_TRANSPORT_VERSION,
      error,
    }),
    replayAfter(lastEventId) {
      if (lastEventId === undefined) { return []; }
      const cursor = Number(lastEventId);
      // A malformed cursor replays nothing. The client's own reconnect already
      // refetches the snapshot, so silence is correct and duplication is not.
      if (!Number.isInteger(cursor)) { return []; }
      return buffer.filter((frame) => frame.id > cursor);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    clearListeners() { listeners.clear(); },
    listenerCount: () => listeners.size,
    bufferedCount: () => buffer.length,
    buffered: () => [...buffer],
  };
}

/** Serialize one frame as an SSE block, including its reconnect id. */
export function formatSseFrame(frame: WebStreamFrame): string {
  return `id: ${String(frame.id)}\nevent: ${frame.name}\ndata: ${JSON.stringify(frame.payload)}\n\n`;
}
