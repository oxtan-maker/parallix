// TASK-2557 regression: a Bubblewrap-confined codex profile must bind the
// Parallix state home writable, or `px` mission writes fail inside the sandbox
// with 'attempt to write a readonly database'. The bind-only assertions live in
// agent-sandbox-state-bindings.test.ts; this suite closes the evidence gap by actually
// running `px draft` under the real `bwrap` binary and proving the mission row
// lands in the pinned Parallix database.
//
// The fixture mirrors test/e2e/lifecycle/mission-lifecycle.test.ts: a hermetic Git repo with a
// deterministic stub agent on a restricted PATH, so no real agent, Forgejo, or
// remote is touched inside the sandbox.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { buildBubblewrapArgs, resolveSandboxProfile } from '../../../src/adapters/process/bubblewrap.js';
import { pxNodeArgs, resolvePxEntryLoader } from '../../lib/px-entry.js';

// The prebuilt integration lanes run px from the bundle, which the sandbox
// reaches through the same checkout bind as the source entry.
const PX = resolvePxEntryLoader();

const SLUG = 'task-2599';

function commandDir(command: string): string {
  for (const directory of (process.env.PATH || '').split(path.delimiter)) {
    if (!directory) { continue; }
    const candidate = path.join(directory, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch { /* keep searching PATH */ }
  }
  throw new Error(`Could not resolve command on PATH: ${command}`);
}

function writeExecutable(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  fs.chmodSync(filePath, 0o755);
}

/**
 * Deterministic stub agent (draft mode only). It records the mission contract
 * through `px` — the same commands
 * the draft prompt names — then answers the session-ID line. `px` is resolved
 * through the harness environment because the stub runs as a bare executable
 * on the restricted fixture PATH.
 */
function stubSource(): string {
  return `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
function write(f, c) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, c, 'utf8'); }
function px(args) {
  const entry = process.env.PARALLIX_E2E_PX_ENTRY;
  const loader = process.env.PARALLIX_E2E_PX_LOADER;
  if (!entry) { return null; }
  const run = childProcess.spawnSync(process.execPath, (loader ? ['--import', loader] : []).concat([entry], args), { cwd: process.cwd(), encoding: 'utf8' });
  return run.status === 0 ? (run.stdout || '') : null;
}
function missionVersion(slug) {
  const out = px(['status', slug, '--json']);
  if (!out) { return null; }
  try { return String(JSON.parse(out).version); } catch (_) { return null; }
}
// Each write prints the Mission's new version, so the stub chains writes from
// that instead of re-reading \`px status\` between them: every \`px\` spawn
// costs a full CLI start-up.
function writeChain(slug, writes) {
  let v = missionVersion(slug);
  for (const args of writes) {
    if (v === null) { return; }
    const out = px(args.concat(['--slug', slug, '--expected-version', v]));
    try { v = out ? String(JSON.parse(out).version) : null; } catch (_) { v = null; }
  }
}
function recordContract(slug) {
  writeChain(slug, [
    ['goal', 'set', '--goal', 'Exercise the sandbox px-write path with a deterministic stub agent',
      '--why', 'Protect the sandbox Parallix state-home bind from regression'],
    ['scope', 'set', '--scope', 'Run draft through the real CLI inside bubblewrap',
      '--out-of-scope', 'Real model execution'],
    ['gate', 'add', '--command', 'node -e ""'],
    ['criterion', 'add', '--text', 'Sandboxed px writes Parallix mission state'],
    ['checkpoint', 'plan', '--name', 'CP-1', '--text', 'Draft and execute'],
    ['checkpoint', 'plan', '--name', 'CP-2', '--text', 'Review and integrate'],
    ['nel', 'set', '--predicted', 'Small'],
  ]);
}
const prompt = process.argv[process.argv.length - 1] || '';
const match = (re) => { const m = prompt.match(re); return m && m[1] ? m[1].trim() : null; };
const slug = match(/^(?:Mission s|S)lug:\\s*((?:task-[a-z0-9-]+|parallix-adhoc-\\d+))/im)
  || match(/^Mission:\\s*((?:task-[a-z0-9-]+|parallix-adhoc-\\d+))/im)
  || 'task-unknown';
const missionDir = match(/^Mission dir:\\s*(.+)$/m)
  || path.join(process.cwd(), 'missions', slug);
if (/^Mode: draft\\./m.test(prompt)) {
  recordContract(slug);
  write(path.join(missionDir, 'milestone-1.md'), '# Milestone 1\\n\\nTyped contract recorded.\\n');
}
process.stdout.write('{"sessionID":"ses_stubbed_sandbox"}\\n');
`;
}

/**
 * Hermetic fixture: real Git repo with the backlog layout, a deterministic
 * stub agent on a fixture PATH, and a hermetic workflow config (review provider
 * `none`, no-op verification) so no Forgejo or remote is touched.
 */
function setupFixture(slug: string, title: string): { tmpRoot: string; repo: string; binDir: string; stateHome: string } {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2557-sandbox-'));
  const repo = path.join(tmpRoot, 'repo');
  const binDir = path.join(repo, 'bin');
  const stateHome = path.join(tmpRoot, 'parallix-home');
  const reviewTmpDir = path.join(tmpRoot, 'review-artifacts');

  fs.mkdirSync(path.join(repo, 'backlog', 'tasks'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'backlog', 'completed'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'backlog', 'archive'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'config'), { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(path.join(repo, '.tmp'), { recursive: true });
  fs.mkdirSync(reviewTmpDir, { recursive: true });

  // The custom runner resolves to opencode, so stub every launcher name the
  // draft fallback chain can reach.
  const stub = stubSource();
  for (const name of ['opencode', 'codex', 'custom']) {
    writeExecutable(path.join(binDir, name), stub);
  }
  fs.symlinkSync(process.execPath, path.join(binDir, 'node'));
  fs.symlinkSync(commandDir('git'), path.join(binDir, 'git'));
  fs.symlinkSync(commandDir('bash'), path.join(binDir, 'bash'));
  fs.symlinkSync(commandDir('id'), path.join(binDir, 'id'));
  // Keep the real-bubblewrap confinement path available to the stub launches:
  // the restricted PATH would otherwise exclude bwrap and the confinement gate
  // blocks unconfined mutating launches.
  const bwrapPath = commandDir('bwrap');
  if (bwrapPath) { fs.symlinkSync(bwrapPath, path.join(binDir, 'bwrap')); }

  fs.writeFileSync(path.join(repo, 'workflow.config.json'), JSON.stringify({
    product: { name: 'task-2557-probe', targetUser: 'tests' },
    adapters: {
      tasks: { provider: 'backlog-md', storage: 'backlog', stateMap: 'config/state-map.json' },
      agents: { models: { custom: 'stub/custom' } },
      missions: { baseDir: 'missions', branchPrefix: 'mission/', worktreePattern: 'worktrees/<slug>' },
      verification: { command: ':', defaultArea: 'all' },
      review: { provider: 'none', tmpDir: reviewTmpDir }
    }
  }, null, 2));
  fs.writeFileSync(path.join(repo, 'config', 'state-map.json'), JSON.stringify({
    ready: 'refined',
    approved: 'ready-for-integration'
  }, null, 2));

  const taskId = slug.toUpperCase();
  fs.writeFileSync(
    path.join(repo, 'backlog', 'tasks', `${slug} - ${title.replace(/\s+/g, '-').toLowerCase()}.md`),
    ['---', `id: ${taskId}`, `title: ${title}`, 'status: backlog', 'assignee: []',
      "created_date: '2026-07-01 00:00'", 'labels: [ai_sdlc]', 'dependencies: []', '---', '',
      '## Description', '', 'Sandbox px-write probe.', ''].join('\n'),
    'utf8'
  );

  const git = (args: string[]) => {
    const res = childProcess.spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    if (res.status !== 0) { throw new Error(`git ${args.join(' ')} failed: ${res.stderr}`); }
  };
  git(['init']);
  git(['checkout', '-b', 'main']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Task 2557 Probe']);
  git(['add', '.']);
  git(['commit', '-m', 'initial probe repo']);

  return { tmpRoot, repo, binDir, stateHome };
}

function pxEnv(cwd: string, stateHome: string, binDir: string): NodeJS.ProcessEnv {
  return {
    FORCE_COLOR: '0',
    FORGEJO_USER: 'custom',
    PRIMARY_WORKTREE: cwd,
    PARALLIX_HOME: stateHome,
    PARALLIX_E2E_PX_ENTRY: PX.entry,
    PARALLIX_E2E_PX_LOADER: PX.loader,
    // /tmp stays readonly in the outer sandbox. Give a source (tsx) run a
    // writable cache inside the repo so each contract command can reuse
    // compiled modules.
    TMPDIR: path.join(cwd, '.tmp'),
    // Restricted PATH: only the fixture stubs and symlinks resolve, so the
    // sandboxed px can never reach a real agent or remote.
    PATH: binDir,
    HOME: process.env.HOME ?? '/nonexistent'
  };
}

test('sandboxed codex profile writes Parallix mission state through px under bwrap', () => {
  const bwrapPath = commandDir('bwrap');
  const fixture = setupFixture(SLUG, 'Sandbox px write probe');
  const previousParallixHome = process.env.PARALLIX_HOME;
  // Pin the state home in this process too so the resolved profile binds the
  // same Parallix database the sandboxed px will write.
  process.env.PARALLIX_HOME = fixture.stateHome;
  try {
    const profile = resolveSandboxProfile('active', fixture.repo, null, 'codex');
    // The fixture lives under /tmp, but the production profile grants /tmp as a
    // convenience. Remove that unrelated permission so it cannot mask a missing
    // Parallix state-home bind: with the mission worktree inside the repo, the
    // declared state homes are the only writable grants left.
    profile.optionalWritable = [];
    assert.ok(
      profile.optionalWritableDirectories?.includes(fixture.stateHome),
      'codex profile must declare the pinned Parallix state home writable'
    );
    const confined = childProcess.spawnSync(
      bwrapPath,
      [...buildBubblewrapArgs(profile, fixture.repo), process.execPath, ...pxNodeArgs(PX, ['draft', SLUG, '--agent', 'custom'])],
      {
        cwd: fixture.repo,
        encoding: 'utf8',
        timeout: 120_000,
        env: { ...process.env, ...pxEnv(fixture.repo, fixture.stateHome, fixture.binDir) }
      }
    );
    if (confined.error) { throw confined.error; }
    assert.equal(confined.status, 0, `px draft under bwrap failed (status=${confined.status}):\n${confined.stdout}\n${confined.stderr}`);

    // Host-side read of the pinned database: the mission row must have been
    // written from inside the sandbox.
    const database = new DatabaseSync(path.join(fixture.stateHome, 'parallix.db'), { readOnly: true });
    try {
      const recorded = database.prepare('SELECT id, version FROM missions WHERE id = ?').get(SLUG) as { id?: string; version?: number } | undefined;
      assert.equal(recorded?.id, SLUG);
      assert.ok(recorded?.version !== undefined, 'sandboxed px write must persist a versioned mission row');
    } finally { database.close(); }
    assert.equal(fs.existsSync(path.join(fixture.repo, 'worktrees', SLUG, 'missions', SLUG, 'MISSION.md')), false);
  } finally {
    if (previousParallixHome === undefined) { delete process.env.PARALLIX_HOME; } else { process.env.PARALLIX_HOME = previousParallixHome; }
    fs.rmSync(fixture.tmpRoot, { recursive: true, force: true });
  }
});
