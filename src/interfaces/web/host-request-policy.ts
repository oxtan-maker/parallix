import type { FastifyInstance } from 'fastify';
import { failure, rejected } from '../../application/contracts.js';
import { actualOrigin, cookieValue, evaluateContentLength, evaluateContentType, evaluateHostHeader, evaluateMutationAuthorization, isReadOnlyMethod, sessionCookieName, type LoopbackBinding } from './security.js';
import { sendCommandResult, singleHeader, transportStatusCode } from './host-support.js';
export const WEB_CSRF_HEADER = 'x-px-csrf';

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

export function installHostRequestPolicy(app: FastifyInstance, currentBinding: () => LoopbackBinding | null, bodyLimitBytes: number, launchValue: string) {
  // js/missing-rate-limiting flags this request path, but the host binds a
  // loopback port for a single launch (ADR 0054) and is never reachable off
  // 127.0.0.1, so there is no network-facing attacker to exhaust. Rate
  // limiting a loopback single-tenant socket would add cost with no threat.
  // One origin per launch; the hooks below read the actual bound port.
  app.addHook('onRequest', async (request, reply) => {
    const current = currentBinding();
    if (current === null) {
      reply.code(503).header('connection', 'close');
      return reply.send('host not ready');
    }
    const origin = actualOrigin(current);
    if (evaluateHostHeader(request.headers.host, current) !== 'ok') {
      // The Host header is part of the per-launch capability (ADR 0054);
      // the rejection carries the same safe envelope as every other
      // command response.
      return sendCommandResult(reply, 403, rejected('capability', 'host mismatch'));
    }
    if (!isReadOnlyMethod(request.method)) {
      // Read-only requests carry no body, so only state-changing methods
      // are length-gated (chunked/absent length = 411, over = 413).
      const lengthCheck = evaluateContentLength(request.headers['content-length'], bodyLimitBytes);
      if (lengthCheck.result === 'reject') { return reply.code(lengthCheck.status).send(); }
      const decision = evaluateMutationAuthorization({
        origin: singleHeader(request.headers.origin),
        sessionCookie: cookieValue(request.headers.cookie, sessionCookieName(current)),
        csrfHeader: singleHeader(request.headers[WEB_CSRF_HEADER]),
      }, origin, launchValue);
      if (decision.result === 'reject') {
        return sendCommandResult(reply, 403, rejected('capability', decision.reason));
      }
      const contentTypeCheck = evaluateContentType(request.method, singleHeader(request.headers['content-type']));
      if (contentTypeCheck.result === 'reject') { return reply.code(contentTypeCheck.status).send(); }
      // Credentials valid: the command route below dispatches, every
      // other path still answers 405. The boundary above is what the
      // route had to pass first.
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

  // Transport-level errors (a malformed JSON body reaches the parser
  // before any route does) answer with the same safe envelope: a parse
  // failure is a 400 validation rejection, transport size/type limits
  // keep their status and empty body, and anything else is a 500 whose
  // body never echoes internal detail.
  app.setErrorHandler((error, _request, reply) => {
    const status = transportStatusCode(error);
    if (status === 400) {
      sendCommandResult(reply, 400, rejected('validation', 'request body is not valid JSON'));
      return;
    }
    if (status === 411 || status === 413 || status === 415) {
      reply.code(status);
      return reply.send();
    }
    sendCommandResult(reply, 500, failure('execution', 'internal error'));
  });

}
