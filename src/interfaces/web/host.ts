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

import * as crypto from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import type { BoardProjection } from '../../application/projections/board.js';
import {
  subscribeToBoardProjection,
  type BoardSubscriptionOptions,
} from '../../application/projections/board-subscription.js';
import type { BoardProgressSink } from '../../application/controller/board-command.js';
import {
  createWebEventStream,
  formatSseFrame,
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
  cookieValue,
  evaluateContentLength,
  evaluateContentType,
  evaluateHostHeader,
  evaluateMutationAuthorization,
  isLoopbackHost,
  isReadOnlyMethod,
  resolveAssetPath,
  LOOPBACK_LITERALS,
  type LoopbackBinding,
  type LoopbackLiteral,
} from './security.js';

export const WEB_SESSION_COOKIE = 'px_session';
export const WEB_CSRF_HEADER = 'x-px-csrf';
export const WEB_CSRF_META_NAME = 'px-csrf';
export const DEFAULT_BODY_LIMIT_BYTES = 64 * 1024;

/** Read-only route paths. Both outrank the `/*` asset catch-all. */
export const WEB_SNAPSHOT_PATH = '/api/board';
export const WEB_EVENTS_PATH = '/api/events';

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
 * The protection header set every response from this host carries. No
 * `unsafe-inline`, no remote sources: the shell references only same-origin
 * assets, and the CSRF meta tag is data, not executable script.
 */
export const PROTECTION_HEADERS = {
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
    + "connect-src 'self'; font-src 'none'; object-src 'none'; base-uri 'none'; "
    + "frame-ancestors 'none'; form-action 'self'",
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
} as const;

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
   * Timer/interval seam for the shared projection subscription. Tests drive
   * the loop through this rather than a real clock; production takes the
   * default `BOARD_REFRESH_INTERVAL_MS` poll.
   */
  subscription?: BoardSubscriptionOptions;
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

/** A single-value view of a header that the type system allows to repeat. */
function singleHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function injectCsrfMeta(shellHtml: string, launchValue: string): string {
  if (!shellHtml.includes('</head>')) {
    throw new Error('web shell HTML is malformed: missing </head>');
  }
  return shellHtml.replace('</head>', `<meta name="${WEB_CSRF_META_NAME}" content="${launchValue}"></head>`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  const { manifest, assets } = options.assets;
  if (manifest['index.html'] === undefined) {
    throw new Error('web asset manifest has no index.html entry');
  }
  // One unguessable value per launch: the double-submit capability shared by
  // the session cookie, the CSRF meta tag, and the mutation checks.
  const launchValue = crypto.randomBytes(32).toString('base64url');
  const shellHtml = injectCsrfMeta(options.assets.shellHtml, launchValue);
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

      // One origin per launch; the hooks below read the actual bound port.
      app.addHook('onRequest', async (request, reply) => {
        const current = binding;
        if (current === null) {
          reply.code(503).header('connection', 'close');
          return reply.send('host not ready');
        }
        const origin = actualOrigin(current);
        if (evaluateHostHeader(request.headers.host, current) !== 'ok') {
          return reply.code(403).send('host mismatch');
        }
        if (!isReadOnlyMethod(request.method)) {
          // Read-only requests carry no body, so only state-changing methods
          // are length-gated (chunked/absent length = 411, over = 413).
          const lengthCheck = evaluateContentLength(request.headers['content-length'], bodyLimitBytes);
          if (lengthCheck.result === 'reject') { return reply.code(lengthCheck.status).send(); }
          const decision = evaluateMutationAuthorization({
            origin: singleHeader(request.headers.origin),
            sessionCookie: cookieValue(request.headers.cookie, WEB_SESSION_COOKIE),
            csrfHeader: singleHeader(request.headers[WEB_CSRF_HEADER]),
          }, origin, launchValue);
          if (decision.result === 'reject') { return reply.code(403).send(decision.reason); }
          const contentTypeCheck = evaluateContentType(request.method, singleHeader(request.headers['content-type']));
          if (contentTypeCheck.result === 'reject') { return reply.code(contentTypeCheck.status).send(); }
          // Credentials valid, but no mutation routes exist yet: routing
          // answers 405. The boundary above is what a future route would
          // still have to pass.
        }
      });

      app.addHook('onSend', async (_request, reply) => {
        for (const [name, value] of Object.entries(PROTECTION_HEADERS)) {
          reply.header(name, value);
        }
        if (reply.getHeader('cache-control') === undefined) {
          reply.header('cache-control', 'no-store');
        }
      });

      app.get(WEB_EVENTS_PATH, async (request, reply) => {
        // The reply is hijacked, so Fastify's onSend hook never runs for this
        // response: the protection headers are written explicitly here rather
        // than inherited. `connect-src 'self'` in the existing CSP is what
        // permits the same-origin EventSource; it is not widened.
        reply.hijack();
        const raw = reply.raw;
        raw.writeHead(200, {
          ...PROTECTION_HEADERS,
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-store',
          connection: 'keep-alive',
          // Defeats reverse-proxy and framework response buffering, so frames
          // reach the client before the response ends.
          'x-accel-buffering': 'no',
        });
        raw.flushHeaders();
        // Reconnect: replay only what this client has not seen. Truth is still
        // re-established by refetching the snapshot; this only avoids
        // duplicate user-visible progress lines.
        for (const frame of stream.replayAfter(singleHeader(request.headers['last-event-id']))) {
          raw.write(formatSseFrame(frame));
        }
        const unsubscribe = stream.subscribe((frame) => { raw.write(formatSseFrame(frame)); });
        const detach = (): void => {
          if (!clients.delete(detach)) { return; }
          unsubscribe();
          raw.end();
        };
        clients.add(detach);
        request.raw.on('close', detach);
        request.raw.on('error', detach);
      });

      app.get(WEB_SNAPSHOT_PATH, async (_request, reply) => {
        const build = options.buildProjection;
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
          return reply.type('application/json; charset=utf-8').send(toWebBoardSnapshot(projection));
        } catch (error) {
          // A projection the transport refuses to project is a contract
          // failure, not a transient one.
          return reply.code(500).send(snapshotError('execution', errorMessage(error)));
        }
      });

      app.get('/', async (_request, reply) => {
        reply.header('set-cookie', `${WEB_SESSION_COOKIE}=${launchValue}; HttpOnly; SameSite=Strict; Path=/`);
        reply.header('cache-control', 'no-store');
        return reply.type('text/html; charset=utf-8').send(shellHtml);
      });

      app.get('/*', async (request, reply) => {
        const rawPath = (request.raw.url ?? '/').split('?')[0] ?? '/';
        const resolution = resolveAssetPath(rawPath, manifest);
        if (resolution.result === 'reject') { return reply.code(resolution.status).send(); }
        const asset = assets.get(resolution.relativePath);
        if (asset === undefined) { return reply.code(500).send(); }
        // Hashed build assets are immutable; the shell page is not.
        reply.header('cache-control', resolution.relativePath === 'index.html' ? 'no-store' : 'public, max-age=31536000, immutable');
        return reply.type(asset.contentType).send(asset.body);
      });

      // Explicit method allowlist: no mutation routes exist yet, so every
      // state-changing method on every path is 405 with the allowed set.
      // The onRequest hook above still enforces the Origin/session/CSRF
      // boundary before this answer, and a future specific route (e.g.
      // POST /boards/:id/move) will outrank this catch-all.
      const methodNotAllowed = async (_request: unknown, reply: FastifyReply) => {
        reply.header('allow', 'GET, HEAD');
        return reply.code(405).send();
      };
      for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'] as const) {
        app.route({ method, url: '/*', handler: methodNotAllowed });
      }

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
      const build = options.buildProjection;
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
