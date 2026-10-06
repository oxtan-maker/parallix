import type { FastifyReply } from 'fastify';

export const WEB_CSRF_META_NAME = 'px-csrf';

export interface ShellBootstrap {
  serve(_reply: FastifyReply, _sessionCookieName: string): FastifyReply;
}

/** Build the one shell response used by root and validated index asset paths. */
export function createShellBootstrap(shellHtml: string, launchValue: string): ShellBootstrap {
  if (!shellHtml.includes('</head>')) {
    throw new Error('web shell HTML is malformed: missing </head>');
  }
  const html = shellHtml.replace('</head>', `<meta name="${WEB_CSRF_META_NAME}" content="${launchValue}"></head>`);
  return {
    serve(reply, sessionCookieName) {
      reply.header('set-cookie', `${sessionCookieName}=${launchValue}; HttpOnly; SameSite=Strict; Path=/`);
      reply.header('cache-control', 'no-store');
      return reply.type('text/html; charset=utf-8').send(html);
    },
  };
}
