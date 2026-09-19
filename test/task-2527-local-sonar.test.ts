import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { runSonar, setupSonar, sonarTokenPath } from '../scripts/sonar-local.js';

test('local SonarQube setup stores one shared token and scanner reuses it', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2527-sonar-'));
  const previous = process.env.FORGEJO_HOME;
  process.env.FORGEJO_HOME = home;
  // Hermetic: clear any SONAR_TOKEN from the CI environment so this test asserts
  // the local file-token path, not the CI env-token path (scripts/sonar-local.ts
  // prefers process.env.SONAR_TOKEN). CI runs that export SONAR_TOKEN and also
  // run npm run test:coverage must not fail here.
  const previousToken = process.env.SONAR_TOKEN;
  delete process.env.SONAR_TOKEN;
  try {
    const calls: Array<{ url: string, init?: RequestInit }> = [];
    const request: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).endsWith('/revoke')) return new Response(null, { status: 204 });
      return new Response(JSON.stringify({ token: 'local-scanner-token' }), { status: 200 });
    };
    const first = await setupSonar({ password: 'admin-password', request });
    const second = await setupSonar({ password: 'unused', request });
    let scan: { command?: string, env?: NodeJS.ProcessEnv } = {};
    runSonar({ spawn: ((command: string, _args: string[], options: { env: NodeJS.ProcessEnv }) => {
      scan = { command, env: options.env };
      return { status: 0 } as ReturnType<typeof import('node:child_process').spawnSync>;
    }) as typeof import('node:child_process').spawnSync });

    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.deepEqual(calls.map(call => call.url), [
      'http://127.0.0.1:9000/api/user_tokens/revoke',
      'http://127.0.0.1:9000/api/user_tokens/generate',
    ]);
    assert.match(String(calls[1].init?.body), /name=parallix-local-scanner/);
    assert.equal(sonarTokenPath(), path.join(home, 'tokens', 'sonarqube'));
    assert.equal(fs.statSync(sonarTokenPath()).mode & 0o777, 0o600);
    assert.equal(scan.command, 'sonar-scanner-npm');
    assert.equal(scan.env?.SONAR_TOKEN, 'local-scanner-token');
  } finally {
    if (previous === undefined) delete process.env.FORGEJO_HOME; else process.env.FORGEJO_HOME = previous;
    if (previousToken === undefined) delete process.env.SONAR_TOKEN; else process.env.SONAR_TOKEN = previousToken;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('local SonarQube setup recovers when the server holds the token but the local file is gone', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2527-sonar-'));
  const previous = process.env.FORGEJO_HOME;
  process.env.FORGEJO_HOME = home;
  try {
    let serverHasToken = true;
    const request: typeof fetch = async (url) => {
      if (String(url).endsWith('/revoke')) { serverHasToken = false; return new Response(null, { status: 204 }); }
      if (serverHasToken) {
        return new Response(JSON.stringify({ errors: [{ msg: "A user token with name 'parallix-local-scanner' already exists" }] }), { status: 400 });
      }
      serverHasToken = true;
      return new Response(JSON.stringify({ token: 'replacement-token' }), { status: 200 });
    };
    const result = await setupSonar({ password: 'admin-password', request });

    assert.equal(result.created, true);
    assert.equal(fs.readFileSync(sonarTokenPath(), 'utf8').trim(), 'replacement-token');
  } finally {
    if (previous === undefined) delete process.env.FORGEJO_HOME; else process.env.FORGEJO_HOME = previous;
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('local SonarQube token path discovers the shared sibling-worktree home', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2527-worktree-'));
  const primary = path.join(sandbox, 'parallix');
  const sibling = path.join(sandbox, 'parallix-feature');
  const mission = path.join(sandbox, 'parallix-mission');
  const previous = process.env.NODE_TEST_CONTEXT;
  const previousHome = process.env.FORGEJO_HOME;
  const previousCwd = process.cwd();
  try {
    fs.mkdirSync(primary);
    execFileSync('git', ['init', '-b', 'main'], { cwd: primary });
    execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: primary });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: primary });
    fs.writeFileSync(path.join(primary, 'README'), 'test\n');
    execFileSync('git', ['add', '.'], { cwd: primary });
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: primary });
    execFileSync('git', ['worktree', 'add', '-b', 'feature', sibling], { cwd: primary });
    execFileSync('git', ['worktree', 'add', '-b', 'mission/task-2527', mission], { cwd: primary });
    fs.mkdirSync(path.join(sibling, '.forgejo-local'));
    delete process.env.NODE_TEST_CONTEXT;
    // The integration suite exports a shared FORGEJO_HOME; this test asserts sibling discovery instead.
    delete process.env.FORGEJO_HOME;
    process.chdir(mission);

    assert.equal(sonarTokenPath(mission), path.join(sibling, '.forgejo-local', 'tokens', 'sonarqube'));
  } finally {
    process.chdir(previousCwd);
    if (previous === undefined) delete process.env.NODE_TEST_CONTEXT; else process.env.NODE_TEST_CONTEXT = previous;
    if (previousHome === undefined) delete process.env.FORGEJO_HOME; else process.env.FORGEJO_HOME = previousHome;
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});
