import { sessionCookieName } from '../../src/interfaces/web/security.js';
import type { WebHostInfo } from '../../src/interfaces/web/host.js';

export async function workflowHttp(host: WebHostInfo) {
  const shell = await fetch(host.origin);
  const token = shell.headers.get('set-cookie')!.split('=')[1].split(';')[0];
  return {
    post: (missionId: string, requestKey: string) => fetch(`${host.origin}/api/commands`, { method: 'POST',
      headers: { origin: host.origin, cookie: `${sessionCookieName(host)}=${token}`, 'x-px-csrf': token, 'content-type': 'application/json' },
      body: JSON.stringify({ missionId, kind: 'active:execute', missionStatusAtRequest: 'refined', requestKey }) }),
    snapshot: async () => (await fetch(`${host.origin}/api/board`)).json(),
  };
}
