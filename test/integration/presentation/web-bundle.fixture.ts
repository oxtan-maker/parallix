// Private source-free copy of the pipeline build for real web/board processes.
// npm-pack-install-smoke owns archive selection and npm installation. Keeping
// compression there avoids repeating it for the HTTP and SQLite contracts.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import { pxNodeArgs } from '../../lib/px-entry.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

let work: string;
let packageDir: string;

function artifactEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_COMPILE_CACHE: path.join(work, 'compile-cache') };
  // ADR 0062: the source-free artifact cannot contribute src/ coverage.
  // Keep the test worker instrumented, but do not serialize discarded ranges or
  // disable compilation reuse in the packaged host and its observer.
  delete env.NODE_V8_COVERAGE;
  delete env.NODE_DISABLE_COMPILE_CACHE;
  return env;
}

/** Each process owns its artifact tree; package and board suites share no state. */
export function useWebArtifactFixture(primeObserver = false): void {
  test.before(() => {
    work = fs.mkdtempSync(path.join(os.tmpdir(), 'px-web-package-'));
    packageDir = path.join(work, 'package');
    fs.mkdirSync(packageDir, { recursive: true });
    for (const entry of ['LICENSE', 'NOTICES', 'README.md', 'package.json', 'build']) {
      fs.cpSync(path.join(ROOT, entry), path.join(packageDir, entry), {
        recursive: true,
        // Match the existing npm allowlist's explicit native-SEA exclusion.
        filter: source => source !== path.join(ROOT, 'build', 'sea'),
      });
    }
    // The host cannot accidentally resolve checkout source or dependencies.
    assert.deepEqual(fs.readdirSync(packageDir).sort(), ['LICENSE', 'NOTICES', 'README.md', 'build', 'package.json']);
    for (const absent of ['src', 'node_modules', 'web', 'test', 'docs']) {
      assert.equal(fs.existsSync(path.join(packageDir, absent)), false, `${absent}/ must not be in the fixture`);
    }
    if (primeObserver) {
      // Only the board starts a second CLI observer. Prime private compilation
      // state once; manual verification also exercises the uncached command.
      execFileSync(process.execPath, pxNodeArgs({ entry: path.join(packageDir, 'build', 'px.mjs'), loader: '' }, ['--version']), {
        env: artifactEnvironment(), encoding: 'utf8', timeout: 10_000,
      });
    }
  }, { timeout: 300_000 });

  test.after(() => {
    if (work) { fs.rmSync(work, { recursive: true, force: true }); }
  });
}

interface RunningHost {
  child: ChildProcess;
  origin: string;
}

export function startBundleWeb(context: test.TestContext, state?: { root: string; home: string }): Promise<RunningHost> {
  const home = state?.home ?? fs.mkdtempSync(path.join(work, 'home-'));
  // ADR 0062: native coverage cannot attribute this source-free bundle to src/.
  // Keep coverage on the owning suite, but avoid collecting and serializing
  // discarded bundle ranges in the host and its independent recovery process.
  const env: NodeJS.ProcessEnv = { ...artifactEnvironment(), PARALLIX_HOME: home, PATH: '/usr/bin:/bin',
    // An inherited read-only CLI cannot recover or admit unrelated work.
    // The synthetic fence has no matching operation; any attempted write fails.
    PARALLIX_WORKFLOW_OPERATION: 'package-smoke-read-only', PARALLIX_WORKFLOW_GENERATION: '1',
    PARALLIX_TEST_NO_FORGEJO: '1', FORCE_COLOR: '0', NO_COLOR: '1' };
  // Use the shared bounded compiler pool for the host and its observer (which
  // inherits execArgv), as for other short integration CLI processes.
  const child = spawn(process.execPath, pxNodeArgs({ entry: path.join(packageDir, 'build', 'px.mjs'), loader: '' }, ['web']), {
    cwd: state?.root ?? packageDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });
  const host = { child, origin: '' };
  context.after(async () => {
    try { await stopHost(host); }
    finally { fs.rmSync(home, { recursive: true, force: true }); }
  });
  return new Promise((resolve, reject) => {
    let output = '';
    const cleanup = () => {
      clearTimeout(startupTimeout);
      child.stdout.removeListener('data', onOutput);
      child.stderr.removeListener('data', onOutput);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
    };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      onError(new Error(`packaged px web exited before announcing its URL (${signal ?? code}): ${output}`));
    };
    const onOutput = (chunk: Buffer) => {
      output += chunk.toString();
      const match = output.match(/listening on (http:\/\/127\.0\.0\.1:\d+)\/ /);
      if (match) {
        host.origin = match[1];
        cleanup();
        // Keep draining both pipes after startup so diagnostics cannot block exit.
        child.stdout.resume();
        child.stderr.resume();
        resolve(host);
      }
    };
    const startupTimeout = setTimeout(() => {
      onError(new Error(`packaged px web did not announce a loopback URL in time: ${output}`));
    }, 60_000);
    startupTimeout.unref();
    child.stdout.on('data', onOutput);
    child.stderr.on('data', onOutput);
    child.once('error', onError);
    child.once('exit', onExit);
  });
}

export async function stopHost(host: RunningHost): Promise<void> {
  const child = host.child;
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) { return; }
  await new Promise<void>(resolve => {
    const force = setTimeout(() => { child.kill('SIGKILL'); }, 5_000);
    force.unref();
    child.once('exit', () => { clearTimeout(force); resolve(); });
    child.kill('SIGTERM');
  });
}

// Use Node's native HTTP client so package startup and projection dominate the
// case's CPU cost. Each response retains a finite deadline.
export function get(url: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const request = http.get(url, { signal: AbortSignal.timeout(2000) }, response => {
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(chunk));
      response.once('error', reject);
      response.once('end', () => resolve({ status: response.statusCode ?? 0,
        headers: response.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    request.once('error', reject);
  });
}

export async function assertBundleShell(t: test.TestContext): Promise<void> {
  const host = await startBundleWeb(t);
  try {
    // The serving process is the packaged px.mjs itself (one process, no
    // Vite dev server): its argv is node + build/px.mjs + web.
    const argv = Array.from(host.child.spawnargs ?? []);
    assert.ok(argv.some(arg => arg.endsWith(path.join('build', 'px.mjs'))),
      `the host must be the packaged px.mjs process, got argv ${JSON.stringify(argv)}`);
    assert.equal(argv[argv.length - 1], 'web');

    const res = await get(`${host.origin}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'] ?? '', /text\/html/);
    assert.match(String(res.headers['content-security-policy'] ?? ''), /default-src 'self'/);
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['referrer-policy'], 'no-referrer');
    assert.match(res.headers['set-cookie']?.join('; ') ?? '', /px_session_v4_\d+=[A-Za-z0-9_-]+/);

    const html = res.body;
    // No CDN: no remote reference of any kind. No inline executable script.
    assert.doesNotMatch(html, /https?:\/\//);
    assert.doesNotMatch(html, /<script(?![^>]*src=)[^>]*>/i);
    // Served from the packaged built asset: identical to build/web/index.html
    // except for the per-launch CSRF meta tag the host injects.
    const packagedHtml = fs.readFileSync(path.join(packageDir, 'build', 'web', 'index.html'), 'utf8');
    const meta = html.match(/<meta name="px-csrf" content="[^"]*">/);
    assert.ok(meta, 'the served shell must carry the per-launch CSRF meta tag');
    assert.equal(html.replace(meta[0], ''), packagedHtml, 'the served shell must be the packaged built asset');

    // The referenced module script is served from the allowlist, not a CDN.
    const scriptSrc = html.match(/<script type="module"[^>]*src="([^"]+)"/)?.[1];
    assert.ok(scriptSrc && scriptSrc.startsWith('/assets/'), 'the shell must reference a local hashed asset');
    const assetRes = await get(`${host.origin}${scriptSrc}`);
    assert.equal(assetRes.status, 200);
    assert.equal(assetRes.headers['content-type'], 'text/javascript');
    const assetBody = assetRes.body;
    assert.ok(assetBody.length > 10_000, 'the packaged browser bundle must be substantial');
    assert.match(packagedHtml, /<title>Parallix web board<\/title>/, 'the packaged shell must retain its title');
  } finally {
    await stopHost(host);
  }
  await assert.rejects(() => get(`${host.origin}/`), 'the host and session must be unreachable once the px process has exited');
}

