/**
 * host.ts — the loopback-only local web host (ADR 0054).
 *
 * Fastify runs inside the canonical `px` process as an inbound adapter: it
 * serves the Vite-built browser shell from a manifest-allowlisted asset
 * directory and enforces the security policy from security.ts on every
 * request. Binding is restricted to the explicit loopback literals
 * (`127.0.0.1`, `::1`) on an OS-selected port by default. There is no
 * remote-listener configuration path, no CORS, and no persistent state: the
 * per-launch session value is unguessable, memory-only, and dies with this
 * process.
 */

import { registerEventRoute, registerAssetRoutes } from './host-read-routes.js';
export { WEB_EVENTS_PATH } from './host-read-routes.js';
import { installHostRequestPolicy } from './host-request-policy.js';
import { registerCommandRoute } from './command-route.js';
export { WEB_COMMANDS_PATH } from './command-route.js';
import * as crypto from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { shareBuilds } from './shared-build.js';
import type { BoardProjection } from '../../application/projections/board.js';
import {
  subscribeToBoardProjection,
  type BoardSubscriptionOptions,
} from '../../application/projections/board-subscription.js';
import type {
  BoardCommandDispatcher,
  BoardProgressSink,
} from '../../application/controller/board-command.js';
import {
  createWebEventStream,
  type WebEventStream,
} from './stream.js';
import {
  toWebBoardSnapshot,
  toWebProgressEvent,
  WEB_TRANSPORT_VERSION,
  type WebCommandError,
  type WebTransportVersion,
} from './transport.js';
import {
  actualOrigin,
  isLoopbackHost,
  LOOPBACK_LITERALS,
  type LoopbackBinding,
  type LoopbackLiteral,
} from './security.js';
import { createShellBootstrap } from './shell-bootstrap.js';
import { errorMessage } from './host-support.js';
import { registerTerminalRoute, type WebMissionTerminal } from './terminal-route.js';
export { WEB_TERMINAL_PATH, WEB_TERMINAL_HISTORY_PATH, WEB_TERMINAL_LIVE_PATH, WEB_TERMINAL_SEARCH_PATH, type WebMissionTerminal } from './terminal-route.js';

export { PROTECTION_HEADERS, WEB_CSRF_HEADER } from './host-request-policy.js';
export { WEB_CSRF_META_NAME } from './shell-bootstrap.js';
export const DEFAULT_BODY_LIMIT_BYTES = 64 * 1024;

/** Read-only route paths. Both outrank the `/*` asset catch-all. */
export const WEB_SNAPSHOT_PATH = '/api/board';

/**
 * A projection rebuild that failed. Deliberately *not* an empty board: a
 * locked database or a Git command that lost a race must read as "unavailable,
 * try again", never as zero missions and zero WIP. The envelope reuses the
 * transport's `WebCommandError` shape rather than adding a new one to
 * transport.ts, which this mission consumes but does not renegotiate.
 */
export interface WebBoardSnapshotError {
  readonly kind: 'board-snapshot-error';
  readonly transportVersion: WebTransportVersion;
  readonly error: WebCommandError;
}

/**
 * The loaded, manifest-allowlisted browser assets the host serves. The
 * adapter layer (`src/adapters/web/asset-store.ts`) produces this shape; the
 * host does no file IO itself, so the persistence guardrail and the
 * interfaces-layer boundary stay clean.
 */
export interface WebAssets {
  readonly manifest: Record<string, { size: number; contentType: string }>;
  readonly assets: ReadonlyMap<string, { contentType: string; body: Buffer }>;
  readonly shellHtml: string;
}

export interface WebHostOptions {
  /** Explicit loopback bind literal. Defaults to `127.0.0.1`. */
  host?: LoopbackLiteral;
  /** Port to bind. Defaults to `0` (OS-selected). Must be a valid port. */
  port?: number;
  /** Maximum accepted body size in bytes. Defaults to 64 KiB. */
  bodyLimitBytes?: number;
  /** Integrity-verified packaged browser assets to serve. */
  assets: WebAssets;
  /**
   * Builds the current board projection. Injected as a port so the interfaces
   * layer never constructs a read adapter (ADR 0051); composition supplies the
   * closure from `composeBoardProjection`.
   */
  buildProjection?: () => Promise<BoardProjection>;
  /**
   * The guarded board command dispatcher the mutation route dispatches
   * through (the production `BoardCommandController` shared with the TUI, or
   * a test spy). A supplier because composition resolves the dispatcher only
   * after the host exists; `null` means the host is read-only and the route
   * answers 503. The web layer dispatches only through this port; it
   * constructs no controller, read, or effect adapter (ADR 0051).
   */
  commandDispatcher?: () => BoardCommandDispatcher | null;
  /**
   * Timer/interval seam for the shared projection subscription. Tests drive
   * the loop through this rather than a real clock; production takes the
   * default `BOARD_REFRESH_INTERVAL_MS` poll.
   */
  subscription?: BoardSubscriptionOptions;
  missionTerminal?: () => WebMissionTerminal | null; // Mission history reads (TASK-2749); `null` when not wired.
}

export interface WebHostInfo extends LoopbackBinding {
  origin: string;
}

export interface WebHost {
  start(): Promise<WebHostInfo>;
  close(): Promise<void>;
  /**
   * The command-boundary progress sink. Composition hands this to the board
   * command controller, so SSE clients see the same `operationId` and
   * `sequence` the CLI and TUI already see — not a second identity scheme.
   */
  readonly progress: BoardProgressSink;
  /** Live SSE client count; zero after every client disconnects and after close. */
  clientCount(): number;
}

function snapshotError(kind: WebCommandError['kind'], message: string): WebBoardSnapshotError {
  return { kind: 'board-snapshot-error', transportVersion: WEB_TRANSPORT_VERSION, error: { kind, message } };
}

export function createWebHost(options: WebHostOptions): WebHost {
  const bindHost: string = options.host ?? '127.0.0.1';
  if (!isLoopbackHost(bindHost)) {
    throw new Error(`web host refuses to bind ${bindHost}: only explicit loopback (${LOOPBACK_LITERALS.join(' or ')}) is allowed`);
  }
  if (options.port !== undefined && (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535)) {
    throw new Error(`web host port must be an integer 0-65535, got ${String(options.port)}`);
  }
  if (options.assets === undefined) {
    throw new Error('web host requires loaded web assets');
  }
  const bodyLimitBytes = options.bodyLimitBytes ?? DEFAULT_BODY_LIMIT_BYTES;
  const sharedBuild = options.buildProjection === undefined ? undefined : shareBuilds(options.buildProjection);
  const { manifest } = options.assets;
  if (manifest['index.html'] === undefined) {
    throw new Error('web asset manifest has no index.html entry');
  }
  // One unguessable value per launch: the double-submit capability shared by
  // the session cookie, the CSRF meta tag, and the mutation checks.
  const launchValue = crypto.randomBytes(32).toString('base64url');
  const shell = createShellBootstrap(options.assets.shellHtml, launchValue);
  let app: FastifyInstance | null = null;
  let binding: LoopbackBinding | null = null;
  let closed = false;
  // One counter, one buffer, one listener set per host process, shared by
  // every connected client.
  const stream: WebEventStream = createWebEventStream();
  // Each entry detaches exactly one client: drops its listener and ends its
  // response. `close()` runs them all, so no stream outlives the host.
  const clients = new Set<() => void>();
  let unsubscribeProjection: (() => void) | null = null;
  let displayedProjection: BoardProjection | null = null;
  return {
    progress(event) { stream.publishProgress(toWebProgressEvent(event)); },
    clientCount: () => clients.size,
    async start() {
      if (app !== null) { throw new Error('web host is already started'); }
      app = Fastify({ logger: false, bodyLimit: bodyLimitBytes });

      installHostRequestPolicy(app, () => binding, bodyLimitBytes, launchValue);

      registerEventRoute(app, stream, clients);

      app.get(WEB_SNAPSHOT_PATH, async (_request, reply) => {
        const build = sharedBuild;
        if (build === undefined) {
          return reply.code(503).send(snapshotError('unavailable', 'board projection port is not wired'));
        }
        let projection: BoardProjection;
        try {
          projection = await build();
        } catch (error) {
          return reply.code(503).send(snapshotError('unavailable', errorMessage(error)));
        }
        try {
          const snapshot = toWebBoardSnapshot(projection);
          displayedProjection = projection;
          return reply.type('application/json; charset=utf-8').send(snapshot);
        } catch (error) {
          // A transport-rejected projection is a contract failure.
          return reply.code(500).send(snapshotError('execution', errorMessage(error)));
        }
      });
      // Terminal polls reuse the displayed board; commands still rebuild below.
      registerTerminalRoute(app, { ...options, buildProjection: sharedBuild === undefined
        ? undefined : async () => displayedProjection ?? sharedBuild() });
      registerCommandRoute(app, options, sharedBuild);

      registerAssetRoutes(app, options.assets, shell, () => binding);

      // The listen callback runs asynchronously, so a failure must reject
      // the promise: a throw here would escape as an uncaught exception and
      // start() would never settle (killing the caller's close-on-failure
      // path in the web command).
      const address = await new Promise<{ port: number; address: string }>((resolve, reject) => {
        app!.listen({ host: bindHost, port: options.port ?? 0 }, error => {
          if (error) { reject(error); return; }
          const addr = app!.server.address();
          if (addr === null || typeof addr === 'string') { reject(new Error('web host listener did not report a port')); return; }
          resolve(addr);
        });
      });
      binding = { host: bindHost, port: address.port };
      const build = sharedBuild;
      if (build !== undefined) {
        // The only board-change detector in web code. No SQLite, no Git, no
        // process scan, no watcher: one shared subscription that publishes a
        // payload-free "refetch" when the fingerprint moves (ADR 0051).
        unsubscribeProjection = subscribeToBoardProjection(
          build,
          () => { stream.publishInvalidation(); },
          {
            ...options.subscription,
            onError: (error) => {
              // A failed rebuild is surfaced, never fabricated into an empty
              // board, and the subscription keeps ticking so the next attempt
              // recovers.
              stream.publishError({ kind: 'unavailable', message: errorMessage(error) });
              options.subscription?.onError?.(error);
            },
          },
        );
      }
      return { host: bindHost, port: address.port, origin: actualOrigin({ host: bindHost, port: address.port }) };
    },
    async close() {
      if (closed) { return; }
      closed = true;
      binding = null;
      unsubscribeProjection?.();
      unsubscribeProjection = null;
      for (const detach of [...clients]) { detach(); }
      stream.clearListeners();
      if (app !== null) {
        await app.close();
        app = null;
      }
    },
  };
}
