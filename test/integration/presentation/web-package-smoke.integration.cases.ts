// web-package-smoke — the package-mode proof for the loopback web host.
//
// Packs the real npm artifact (prepack builds the web bundle and the
// canonical bundle), extracts it into an isolated directory that contains
// no source tree or node_modules, then runs the packaged `px web` command
// against fresh isolated repository/operator fixtures and proves:
//   - the shell is served from the packaged built assets (not src/, not an
//     uploaded artifact, not a Vite dev server — the serving process is the
//     packaged px.mjs itself),
//   - the HTML makes no http(s):// reference (no CDN) and no inline
//     executable script,
//   - real board snapshots contain the expected missions and refresh succeeds,
//   - the per-launch session dies with the process (unreachable after exit).
// Network access is loopback-only; nothing contacts the internet.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as http from 'node:http';
import { seedBoardLoading } from '../../fixtures/board-loading-state.js';
import { validateWebBoardSnapshot } from '../../../src/interfaces/web/transport.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

let work: string;
let packageDir: string;
let tarball: string;

test.before(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'px-web-package-'));
  // `npm pack` runs prepack, so this packs freshly built web + canonical
  // bundles.
  const packArgs = ['pack', '--silent', '--pack-destination', work];
  if (process.env.PARALLIX_PREBUILT_PACK === '1') { packArgs.push('--ignore-scripts'); }
  execFileSync('npm', packArgs, { cwd: ROOT, encoding: 'utf8', timeout: 240_000 });
  const packed = fs.readdirSync(work).filter(file => file.endsWith('.tgz'));
  assert.equal(packed.length, 1, `expected exactly one tarball, got ${packed.join(', ')}`);
  tarball = path.join(work, packed[0]);
  packageDir = path.join(work, 'package');
  fs.mkdirSync(packageDir, { recursive: true });
  // npm tarballs nest every entry under a top-level `package/` directory.
  execFileSync('tar', ['xzf', tarball, '--strip-components=1', '-C', packageDir], { encoding: 'utf8' });
  // Prime only disposable Node compilation state; the uncached public browser
  // command is covered by the manual comparison, not a wall-clock wait here.
  execFileSync(process.execPath, [path.join(packageDir, 'build', 'px.mjs'), '--version'], {
    env: { ...process.env, NODE_COMPILE_CACHE: path.join(work, 'compile-cache') }, encoding: 'utf8',
  });

}, { timeout: 300_000 });

test.after(() => {
  if (work) { fs.rmSync(work, { recursive: true, force: true }); }
});

interface RunningHost {
  child: ChildProcess;
  origin: string;
}

function startPackagedWeb(context: test.TestContext, state?: { root: string; home: string }): Promise<RunningHost> {
  const home = state?.home ?? fs.mkdtempSync(path.join(work, 'home-'));
  // ADR 0062: native coverage cannot attribute this source-free bundle to src/.
  // Keep coverage on the owning suite, but avoid collecting and serializing
  // discarded bundle ranges in the host and its independent recovery process.
  const env: NodeJS.ProcessEnv = { ...process.env, PARALLIX_HOME: home, PATH: '/usr/bin:/bin',
    NODE_COMPILE_CACHE: path.join(work, 'compile-cache'),
    // An inherited read-only CLI cannot recover or admit unrelated work.
    // The synthetic fence has no matching operation; any attempted write fails.
    PARALLIX_WORKFLOW_OPERATION: 'package-smoke-read-only', PARALLIX_WORKFLOW_GENERATION: '1',
    PARALLIX_TEST_NO_FORGEJO: '1', FORCE_COLOR: '0', NO_COLOR: '1' };
  delete env.NODE_V8_COVERAGE;
  const child = spawn(process.execPath, [path.join(packageDir, 'build', 'px.mjs'), 'web'], {
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

async function stopHost(host: RunningHost): Promise<void> {
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
function get(url: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
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

export function assertPackagedAssets(): void {
  const top = fs.readdirSync(packageDir).sort();
  assert.deepEqual(top, ['LICENSE', 'NOTICES', 'README.md', 'build', 'package.json']);
  for (const absent of ['src', 'node_modules', 'web', 'test', 'docs']) {
    assert.equal(fs.existsSync(path.join(packageDir, absent)), false, `${absent}/ must not be in the package`);
  }
  const webDir = path.join(packageDir, 'build', 'web');
  const manifest = JSON.parse(fs.readFileSync(path.join(webDir, 'manifest.json'), 'utf8')) as {
    version: number;
    files: Record<string, { size: number; sha256: string; contentType: string }>;
  };
  assert.equal(manifest.version, 1);
  assert.ok(manifest.files['index.html'], 'manifest must allowlist the shell');
  assert.ok(Object.keys(manifest.files).some(key => key.startsWith('assets/')), 'manifest must allowlist the bundled assets');
  for (const [relativeFile, entry] of Object.entries(manifest.files)) {
    const file = fs.readFileSync(path.join(webDir, relativeFile));
    assert.equal(file.length, entry.size, `${relativeFile} size must match the manifest`);
  }
}

export async function assertPackagedBoard(t: test.TestContext): Promise<void> {
  const stateRoot = fs.mkdtempSync(path.join(work, 'board-'));
  t.after(() => fs.rmSync(stateRoot, { recursive: true, force: true }));
  const state = await seedBoardLoading(stateRoot, 3);
  const host = await startPackagedWeb(t, state);
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
    for (let refresh = 0; refresh < 2; refresh++) {
      const response = await get(`${host.origin}/api/board`);
      assert.equal(response.status, 200, 'real packaged projection must load and refresh');
      const snapshot = validateWebBoardSnapshot(JSON.parse(response.body));
      assert.ok(snapshot.ok, 'packaged CLI must serialize a valid board snapshot');
      const backlog = snapshot.value.stages.find(stage => stage.lane === 'backlog');
      assert.equal(backlog?.count, 2);
      assert.equal(backlog.cards.find(card => card.id === 'task-9001')?.title, 'Board loading fixture 1');
      assert.equal(backlog.cards.find(card => card.id === 'task-9002')?.title, 'Board loading fixture 2');
    }
  } finally {
    await stopHost(host);
  }
  await assert.rejects(() => get(`${host.origin}/`), 'the host and session must be unreachable once the px process has exited');
}
