// TASK-2599 — `npm run dev` (`src/entry/px.ts`) must return control to the
// invoking shell when a command reaches a terminal outcome. A completed
// operation can still leave a loop anchor behind (a kept-alive Forgejo socket,
// an agent SDK handle, a borrowed graph connection). Setting `process.exitCode`
// alone only returns control when the event loop drains naturally, so any ref'd
// anchor leaves the process hanging and hides the exit status. The entry must
// terminate with the operation's status on success or failure.
//
// Each test below runs the dev entry inside a child process that already holds a
// ref'd loop anchor (a 1 s `setInterval`). A command that leaves the loop
// anchored must not prevent the entry from returning: it terminates and kills
// the anchor. A `timeout` that elapses surfaces as `status === null`
// (SIGTERM), which is exactly the "hangs forever" failure this task fixes.
import { resolvePxEntryLoader } from '../../lib/px-entry.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { SqliteDatabaseAdapter } from '../../../src/adapters/sqlite/database-adapter.js';
import { loadDefaultMigrations, SqliteMigrationRunner } from '../../../src/adapters/sqlite/migration-runner.js';

const repoRoot = process.cwd();
const entry = path.join(repoRoot, 'src', 'entry', 'px.ts');
// tsx is resolved from a file URL so the child can run with cwd set to the
// throwaway fixture repository (which has no node_modules) while still loading
// the TypeScript entry.
const TSX_URL = pathToFileURL(path.join(repoRoot, 'node_modules', 'tsx', 'dist', 'esm', 'index.mjs')).href;
const slug = 'task-2599';

test('composed command exits preserve status and cleanup without terminating their host (TASK-2696)', () => {
  const runtime = path.join(repoRoot, 'src/interfaces/cli/runtime.ts');
  const cli = path.join(repoRoot, 'src/composition/create-cli.ts');
  const script = `
    import { mock } from 'node:test';
    import assert from 'node:assert/strict';
    const effects = [];
    let status = 0;
    let unexpected = false;
    const runtimeExports = await import(${JSON.stringify(runtime)});
    mock.module(${JSON.stringify(runtime)}, { namedExports: {
      ...runtimeExports,
      deriveAliases: () => ({}),
      main: async (_args, options) => {
        try {
          if (unexpected) throw new Error('unexpected command failure');
          options.exitFn(status);
          effects.push('unreachable');
        } finally { effects.push('cleanup'); }
      },
    } });
    const { run } = await import(${JSON.stringify(cli)});
    const errors = [];
    const options = { log: () => {}, error: message => errors.push(message) };
    const cwd = process.cwd();
    for (const args of [[], ['aliases']]) {
      for (status of [0, 1, 23]) {
        assert.equal(await run(args, options), status);
        assert.equal(process.cwd(), cwd);
      }
    }
    assert.deepEqual(effects, Array(6).fill('cleanup'));
    assert.deepEqual(errors, []);
    unexpected = true;
    assert.equal(await run(['aliases'], options), 1);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /unexpected command failure/);
    console.log('host survived; exact statuses and cleanup verified');
  `;
  const child = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--import', TSX_URL, '--input-type=module', '-e', script], {
    cwd: repoRoot, encoding: 'utf8', timeout: 8000,
  });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /host survived/);
});

/**
 * Run the dev entry in a child process that already has a ref'd loop anchor.
 * The child imports the real entry, so the entry's own `run().then(...)` host
 * decides whether the process terminates. A missing/`null` status means the
 * child outlived the timeout (the bug); a non-`undefined` `error` means the
 * child failed to start.
 *
 * `process.argv` keeps the entry path at index 1 so `run()` (which slices
 * `process.argv.slice(2)`) receives the real CLI arguments; the child runs with
 * `cwd` set to the fixture repository so the CLI resolves its target, task
 * file, and Forgejo configuration from that throwaway repository rather than
 * the test checkout.
 */
function runDevWithAnchor(
  args: string[],
  { home, cwd, timeoutMs = 8000 }: { home?: string; cwd?: string; timeoutMs?: number } = {},
) {
  const homeDirective = home ? `process.env.PARALLIX_HOME = ${JSON.stringify(home)};` : '';
  const cwdDirective = cwd ? `process.chdir(${JSON.stringify(cwd)});` : '';
  const primaryWorktreeDirective = cwd ? `process.env.PRIMARY_WORKTREE = ${JSON.stringify(cwd)};` : '';
  const script = [
    homeDirective,
    cwdDirective,
    primaryWorktreeDirective,
    'setInterval(() => {}, 1000);',
    `process.argv = [process.execPath, ${JSON.stringify(entry)}, ...${JSON.stringify(args)}];`,
    `await import(${JSON.stringify(entry)});`,
  ].filter(Boolean).join(' ');
  return spawnSync(process.execPath, ['--import', TSX_URL, '-e', script], {
    cwd: cwd ?? repoRoot,
    encoding: 'utf8',
    timeout: timeoutMs,
  });
}

/**
 * A throwaway repository whose Mission is in the operator database with no
 * classification, plus its own Backlog task file (labels: []). The repository
 * declares no `review.provider`, so the integration preflight performs no
 * Forgejo lookups, and the fixture owns its task file so the test does not
 * depend on the test checkout's `backlog/tasks` state (which integration
 * deletes on landing). Returns both the Parallix home and the fixture repo.
 */
async function withIsolatedUnclassifiedFixture(): Promise<{ home: string; repo: string }> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2599-home-'));
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2599-repo-'));
  const previousHome = process.env.PARALLIX_HOME;
  process.env.PARALLIX_HOME = home;
  try {
    // A `main` branch exists so the primary-branch detector resolves, and the
    // current branch is the mission branch the preflight expects.
    execSync('git init -q && git config user.email test@parallix && git config user.name test && git commit -q --allow-empty -m init && git branch main && git checkout -b mission/task-2599', {
      cwd: repo,
      stdio: 'ignore',
    });
    fs.writeFileSync(
      path.join(repo, 'workflow.config.json'),
      JSON.stringify({
        product: { name: 'demo', version: '1.0.0' },
        adapters: { tasks: { provider: 'backlog-md', storage: 'backlog' } },
      }),
    );
    const taskDir = path.join(repo, 'backlog', 'tasks');
    fs.mkdirSync(taskDir, { recursive: true });
    fs.writeFileSync(
      path.join(taskDir, `${slug} - Unclassified-Mission.md`),
      ['---', `id: ${slug.toUpperCase()}`, 'title: Unclassified Mission', 'status: ready-for-draft', 'labels: []', '---', ''].join('\n'),
    );
    execSync(`git -C ${JSON.stringify(repo)} add . && git -C ${JSON.stringify(repo)} commit -q -m fixture`, {
      stdio: 'ignore',
    });
    const db = new SqliteDatabaseAdapter();
    await db.open({ path: path.join(home, 'parallix.db') });
    await new SqliteMigrationRunner(db).applyPending(loadDefaultMigrations());
    await db
      .execute('INSERT INTO repositories (id, origin) VALUES (?, ?)', ['parallix', 'local'])
      .catch(() => {});
    await db
      .execute(
        'INSERT INTO missions (id, repository_id, title, status, version) VALUES (?, ?, ?, ?, ?)',
        [slug, 'parallix', 'Unclassified Mission', 'integration', 1],
      )
      .catch((error: unknown) => {
        throw new Error(`mission insert failed: ${(error as Error).message}`);
      });
    await db.close();
  } catch (error) {
    releaseHome(home, previousHome);
    fs.rmSync(repo, { recursive: true, force: true });
    throw error;
  }
  return { home, repo };
}

/** Release a temp Parallix home once its child has exited. */
function releaseHome(home: string | undefined, previousHome: string | undefined) {
  if (!home) { return; }
  if (previousHome === undefined) { delete process.env.PARALLIX_HOME; } else { process.env.PARALLIX_HOME = previousHome; }
  fs.rmSync(home, { recursive: true, force: true });
}

test('SC1/SC2: a completed dev operation returns control with status 0 even with a loop anchor present', () => {
  const child = runDevWithAnchor(['version'], { timeoutMs: 8000 });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.status, 0, `expected a clean exit 0, got status=${child.status}`);
  assert.match(`${child.stdout ?? ''}${child.stderr ?? ''}`, /@magnusekdahl\/parallix/);
});

test('SC3: a missing-classification integrate failure returns control with a non-zero status even with a loop anchor present', async () => {
  const previousHome = process.env.PARALLIX_HOME;
  const { home, repo } = await withIsolatedUnclassifiedFixture();
  try {
    // The fixture repo has no `review.provider`, so the preflight performs no
    // Forgejo lookups; the fixture owns its own task file, so the test is
    // self-contained and independent of the test checkout's backlog state.
    const child = runDevWithAnchor(['integrate', slug, '--dry-run'], { home, cwd: repo, timeoutMs: 8000 });
    assert.equal(child.error, undefined, child.error?.message);
    assert.notEqual(child.status, 0, `expected a non-zero exit, got status=${child.status}`);
    const output = `${child.stdout ?? ''}${child.stderr ?? ''}`;
    assert.match(output, /Mission classification: expected exactly one of/);
    // No live Forgejo contact: the fixture declares no review provider, so the
    // preflight must never reach a remote PR/token lookup.
    assert.ok(!/Forgejo API returned HTTP|failed to resolve PR/.test(output), 'unexpected Forgejo remote lookup');
  } finally {
    releaseHome(home, previousHome);
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('SC2: buffered pipe output survives a slow reader and the entry still exits with the loop anchor present', async () => {
  // Write 1 MiB before the entry runs so stdout (a pipe) still holds buffered
  // data when `run()` resolves, then hold the reader back well past any short
  // forced-exit deadline. The entry must neither truncate the buffered output
  // nor wait for the ref'd anchor.
  const payloadBytes = 1 << 20;
  // The CLI graph is preloaded so the command resolves while the reader is
  // still held back, rather than after a slow module load has let it catch up.
  const cli = path.join(repoRoot, 'src', 'composition', 'create-cli.ts');
  const script = [
    'setInterval(() => {}, 1000);',
    `await import(${JSON.stringify(cli)});`,
    `process.stdout.write('x'.repeat(${payloadBytes}) + '\\n');`,
    "process.stderr.write('buffered\\n');",
    `process.argv = [process.execPath, ${JSON.stringify(entry)}, 'version'];`,
    `await import(${JSON.stringify(entry)});`,
  ].join(' ');
  const child = spawn(process.execPath, ['--import', TSX_URL, '-e', script], { cwd: repoRoot });
  child.stdout.pause();
  const chunks: Buffer[] = [];
  child.stdout.on('data', (chunk: Buffer) => { chunks.push(chunk); });
  const closed = new Promise<number | null>(resolve => { child.on('close', code => { resolve(code); }); });
  const killer = setTimeout(() => { child.kill('SIGKILL'); }, 8000);
  // Hold the reader back only once the payload is buffered in the child.
  await Promise.race([
    closed,
    new Promise<void>(resolve => {
      child.stderr.on('data', (chunk: Buffer) => { if (chunk.toString('utf8').includes('buffered')) { resolve(); } });
    }),
  ]);
  await new Promise(resolve => { setTimeout(resolve, 500); });
  child.stdout.resume();
  const status = await closed;
  clearTimeout(killer);
  const stdout = Buffer.concat(chunks).toString('utf8');
  assert.equal(status, 0, `expected a clean exit 0, got status=${status}`);
  assert.ok(stdout.startsWith('x'.repeat(payloadBytes)), `buffered payload truncated: got ${stdout.length} bytes`);
  assert.match(stdout, /@magnusekdahl\/parallix/);
});

test('a rejected dev command flushes its error and exits despite a loop anchor', () => {
  const cli = path.join(repoRoot, 'src', 'composition', 'create-cli.ts');
  const script = [
    "const { mock } = await import('node:test');",
    `mock.module(${JSON.stringify(cli)}, { namedExports: { run: async () => { throw new Error('command rejected'); } } });`,
    'setInterval(() => {}, 1000);',
    `process.argv = [process.execPath, ${JSON.stringify(entry)}];`,
    `await import(${JSON.stringify(entry)});`,
  ].join(' ');
  const child = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--import', TSX_URL, '-e', script], {
    cwd: repoRoot, encoding: 'utf8', timeout: 8000,
  });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.status, 1);
  assert.match(child.stderr, /command rejected/);
});

// TASK-2601: CLI failure must release an inherited live handle.
test('a failed px integrate exits even when an agent-style handle remains active', () => {
  const { entry, loader } = resolvePxEntryLoader();
  const script = `setInterval(() => {}, 1000); process.argv = [process.execPath, ${JSON.stringify(entry)}, 'integrate', 'task-does-not-exist', '--invalid-option']; await import(${JSON.stringify(pathToFileURL(entry).href)});`;
  const child = spawnSync(process.execPath, [...(loader ? ['--import', loader] : []), '--input-type=module', '-e', script], {
    // The child deliberately keeps an interval alive; the assertion is that
    // CLI validation exits anyway. Allow prebuilt coverage workers enough time
    // to load the px entry before treating that as a regression.
    cwd: process.cwd(), encoding: 'utf8', timeout: 20000,
  });
  assert.equal(child.error, undefined, child.error?.message);
  assert.equal(child.status, 1, child.stderr);
  assert.match(child.stderr, /Unknown integrate option: --invalid-option/);
});

