import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Disposable real provider. No operator credentials, volumes, repos or ports are reused. */
export async function isolatedForgejo(root: string) {
  const name = `parallix-classifier-${randomUUID()}`;
  const docker = (args: string[]) => execFileSync('docker', args, { encoding: 'utf8', timeout: 30_000 }).trim();
  const cleanup = () => {
    try { docker(['rm', '-f', name]); } catch { /* already removed */ }
  };
  process.once('exit', cleanup);
  try {
    docker(['run', '--rm', '-d', '--name', name, '-p', '127.0.0.1::3000',
      '-e', 'FORGEJO__security__INSTALL_LOCK=true', '-e', 'FORGEJO__database__DB_TYPE=sqlite3',
      '-e', 'FORGEJO__service__DISABLE_REGISTRATION=true',
      '-e', 'FORGEJO__server__DISABLE_SSH=true', 'codeberg.org/forgejo/forgejo:14']);
    const port = docker(['port', name, '3000/tcp']).split(':').at(-1)!;
    const baseUrl = `http://127.0.0.1:${port}`;
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetch(`${baseUrl}/api/v1/version`, { signal: AbortSignal.timeout(1000) });
        if (response.ok) { break; }
      } catch { /* wait for this container only */ }
      if (attempt >= 60) { throw new Error('Isolated Forgejo did not start'); }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    const password = 'isolated-lifecycle-password';
    docker(['exec', '--user', 'git', name, 'forgejo', '--config', '/data/gitea/conf/app.ini',
      'admin', 'user', 'create', '--username', 'human', '--password', password,
      '--email', 'human@example.test', '--admin', '--must-change-password=false']);
    const basic = (user: string) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
    async function api(method: string, route: string, body?: unknown, user = 'human') {
      const response = await fetch(`${baseUrl}/api/v1${route}`, {
        method, headers: { Authorization: basic(user), 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) { throw new Error(`Isolated Forgejo ${method} ${route}: ${response.status} ${await response.text()}`); }
      return response.status === 204 ? null : await response.json() as any;
    }
    const tokens = path.join(root, 'tokens');
    fs.mkdirSync(tokens, { recursive: true });
    for (const user of ['human', 'custom', 'jev', 'parallix']) {
      if (user !== 'human') {
        await api('POST', '/admin/users', { username: user, password, email: `${user}@example.test`, must_change_password: false });
        if (user === 'parallix') { await api('PATCH', `/admin/users/${user}`, { admin: true }); }
      }
      const token = await api('POST', `/users/${user}/tokens`, { name: 'isolated-lifecycle', scopes: ['all'] }, user);
      fs.writeFileSync(path.join(tokens, user), token.sha1, { mode: 0o600 });
    }
    await api('POST', '/user/repos', { name: 'probe', private: false, default_branch: 'main' });
    for (const user of ['custom', 'jev', 'parallix']) {
      await api('PUT', `/repos/human/probe/collaborators/${user}`, { permission: 'write' });
    }
    return { baseUrl, api, remote: `${baseUrl}/human/probe.git`, cleanup: () => {
      process.removeListener('exit', cleanup); cleanup();
    } };
  } catch (error) {
    process.removeListener('exit', cleanup); cleanup(); throw error;
  }
}
