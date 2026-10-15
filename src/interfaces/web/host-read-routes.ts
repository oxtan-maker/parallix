import type { FastifyInstance, FastifyReply } from 'fastify';
import type { WebAssets } from './host.js';
import type { createShellBootstrap } from './shell-bootstrap.js';
import { singleHeader } from './host-support.js';
import { PROTECTION_HEADERS } from './host-request-policy.js';
import { formatSseFrame, type WebEventStream } from './stream.js';
import { resolveAssetPath, sessionCookieName, type LoopbackBinding } from './security.js';

export const WEB_EVENTS_PATH = '/api/events';

export function registerEventRoute(app: FastifyInstance, stream: WebEventStream, clients: Set<() => void>) {
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

}

export function registerAssetRoutes(app: FastifyInstance, webAssets: WebAssets, shell: ReturnType<typeof createShellBootstrap>, currentBinding: () => LoopbackBinding | null) {
  const { manifest, assets } = webAssets;
  app.get('/', async (_request, reply) => {
    const current = currentBinding();
    if (current === null) { return reply.code(503).send(); }
    return shell.serve(reply, sessionCookieName(current));
  });

  app.get('/*', async (request, reply) => {
    const rawPath = (request.raw.url ?? '/').split('?')[0] ?? '/';
    const resolution = resolveAssetPath(rawPath, manifest);
    if (resolution.result === 'reject') { return reply.code(resolution.status).send(); }
    if (resolution.relativePath === 'index.html') {
      const current = currentBinding();
      if (current === null) { return reply.code(503).send(); }
      return shell.serve(reply, sessionCookieName(current));
    }
    const asset = assets.get(resolution.relativePath);
    if (asset === undefined) { return reply.code(500).send(); }
    // Hashed build assets are immutable; the shell page is not.
    reply.header('cache-control', 'public, max-age=31536000, immutable');
    return reply.type(asset.contentType).send(asset.body);
  });

  // Explicit method allowlist: the command route above is the only
  // mutation route, so every other state-changing method on every path is
  // 405 with the allowed set. The onRequest hook still enforces the
  // Host/Origin/session/CSRF boundary before this answer; a second
  // mutation route would need an ADR-level decision.
  const methodNotAllowed = async (_request: unknown, reply: FastifyReply) => {
    reply.header('allow', 'GET, HEAD');
    return reply.code(405).send();
  };
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'] as const) {
    app.route({ method, url: '/*', handler: methodNotAllowed });
  }


}
