import { registerWorkflowReads } from './workflow-route.js';
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
import { createSharedProjection } from './shared-build.js';
import { registerBoardReadRoutes } from './board-read-routes.js';
export { WEB_BOARD_ANALYTICS_PATH, WEB_MISSION_DETAIL_PATH, WEB_SNAPSHOT_PATH, type WebBoardSnapshotError } from './board-read-routes.js';
import type { BoardProjection } from '../../application/projections/board.js';
import {
  subscribeToBoardProjection,
  boardFingerprint,
  type BoardSubscriptionOptions,
  type BoardWakeSource,
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
  toWebProgressEvent,
} from './transport.js';
import {
  actualOrigin,
  isLoopbackHost,
  LOOPBACK_LITERALS,
  type LoopbackBinding,
  type LoopbackLiteral,
} from './security.js';
import { createShellBootstrap } from './shell-bootstrap.js';
import { analyticsFamilyFreshness, errorMessage } from './host-support.js';
import { registerTerminalRoute, type WebMissionTerminal } from './terminal-route.js';
import { registerProviderExecutionRoute, type WebProviderExecution } from './provider-execution-route.js';
export { WEB_PROVIDER_EXECUTION_PATH, type WebProviderExecution, type WebProviderExecutionError } from './provider-execution-route.js';
export { WEB_TERMINAL_PATH, WEB_TERMINAL_HISTORY_PATH, WEB_TERMINAL_LIVE_PATH, WEB_TERMINAL_SEARCH_PATH, type WebMissionTerminal } from './terminal-route.js';

export { PROTECTION_HEADERS, WEB_CSRF_HEADER } from './host-request-policy.js';
export { WEB_CSRF_META_NAME } from './shell-bootstrap.js';
export const DEFAULT_BODY_LIMIT_BYTES = 64 * 1024;

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
  /**
   * Durable-change hint injected by composition (never a watcher the web layer
   * builds itself). Read at start, like `commandDispatcher`, because the board
   * source is resolved after the host is constructed.
   */
  changeSignal?: () => BoardWakeSource | null;
  missionTerminal?: () => WebMissionTerminal | null; // Mission history reads (TASK-2749); `null` when not wired.
  /** Read-only provider snapshot port for same-host samplers; `null` or absent answers 503, never an empty snapshot. */
  providerExecution?: () => WebProviderExecution | null;
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
  const projectionSource = options.buildProjection === undefined ? undefined : createSharedProjection(
    options.buildProjection,
    projection => crypto.createHash('sha256').update(boardFingerprint(projection, {
      displayedCountdown: options.subscription?.displayedCountdown,
      deferredDetails: true,
    })).digest('hex'),
    undefined,
    // One freshness per family: the historical analytics family reports its own
    // observation, so a deferred or failed historical refresh cannot demote the
    // current workflow families (TASK-2854.04).
    projection => ({ analytics: analyticsFamilyFreshness(projection) }),
  );
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
  return {
    progress(event) { stream.publishProgress(toWebProgressEvent(event)); },
    clientCount: () => clients.size,
    async start() {
      if (app !== null) { throw new Error('web host is already started'); }
      app = Fastify({ logger: false, bodyLimit: bodyLimitBytes });

      installHostRequestPolicy(app, () => binding, bodyLimitBytes, launchValue);

      registerEventRoute(app, stream, clients);

      registerBoardReadRoutes(app, projectionSource);
      registerProviderExecutionRoute(app, () => options.providerExecution?.() ?? null);
      // Terminal, detail, and command eligibility reads reuse the completed board.
      registerTerminalRoute(app, { ...options, buildProjection: projectionSource === undefined
        ? undefined : async () => (await projectionSource.read()).projection });
      registerWorkflowReads(app, () => options.commandDispatcher?.() ?? null);
      registerCommandRoute(app, options, projectionSource === undefined ? undefined : () => projectionSource.read(), async () => {
        const source = projectionSource;
        if (source === undefined) { return; }
        // A known command change refreshes the retained projection before the
        // invalidation reaches browsers, so their refetch cannot race back to
        // the pre-command completed value.
        await source.refreshAfterCurrent().then(result => {
          if (result.changed) { stream.publishInvalidation(); }
        }, error => { stream.publishError({ kind: 'unavailable', message: errorMessage(error) }); });
      });

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
      const source = projectionSource;
      if (source !== undefined) {
        // The only board-change detector in web code. No SQLite, no Git, no
        // process scan, no watcher of its own: one shared subscription that
        // publishes a payload-free "refetch" when the fingerprint moves or
        // freshness recovers from stale to fresh (ADR 0051). Composition may
        // inject a durable-change hint that only brings the next poll forward.
        unsubscribeProjection = subscribeToBoardProjection(
          () => source.refresh(),
          () => { stream.publishInvalidation(); },
          {
            ...options.subscription,
            wakeSource: options.subscription?.wakeSource ?? options.changeSignal?.() ?? undefined,
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
