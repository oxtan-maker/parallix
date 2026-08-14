import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fmt from '../src/application/presentation/cli-format.js';
import { spawnAndTee } from '../src/adapters/process/spawn-tee.js';
import {
  BUBBLEWRAP_COMMAND,
  BubblewrapGuardError,
  buildBubblewrapArgs,
  isBubblewrapAvailable,
  isBubblewrapDisabled,
  resolveSandboxProfile,
  setBubblewrapProbeForTest,
  withSandboxProfile,
  wrapWithBubblewrap
} from '../src/adapters/process/bubblewrap.js';

test.afterEach(() => {
  setBubblewrapProbeForTest(null);
  delete process.env.PARALLIX_NO_BUBBLEWRAP;
});

function captureLogs<T>(fn: () => T): { result: T; lines: string[] } {
  const lines: string[] = [];
  const previous = fmt.setLogger({
    log: (...args: unknown[]) => lines.push(args.join(' ')),
    error: (...args: unknown[]) => lines.push(args.join(' '))
  });
  try {
    return { result: fn(), lines };
  } finally {
    fmt.setLogger(previous);
  }
}

function makeWorktree(): string { return fs.mkdtempSync(path.join(os.tmpdir(), 'bwrap-guard-')); }

test('isBubblewrapAvailable returns true when bwrap is executable', () => {
  setBubblewrapProbeForTest(() => true);
  assert.equal(isBubblewrapAvailable(), true);
});

test('isBubblewrapAvailable caches the probe result after the first check', () => {
  let calls = 0;
  setBubblewrapProbeForTest(() => { calls += 1; return false; });
  isBubblewrapAvailable();
  isBubblewrapAvailable();
  isBubblewrapAvailable();
  assert.equal(calls, 1);
});

test('isBubblewrapAvailable warns once that the agent runs unsandboxed', () => {
  setBubblewrapProbeForTest(() => false);
  const { lines } = captureLogs(() => {
    isBubblewrapAvailable();
    isBubblewrapAvailable();
  });
  const warnings = lines.filter(line => line.includes('UNSANDBOXED'));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /bubblewrap \(bwrap\) not found or not executable/);
});

test('isBubblewrapDisabled honors PARALLIX_NO_BUBBLEWRAP', () => {
  assert.equal(isBubblewrapDisabled({}), false);
  assert.equal(isBubblewrapDisabled({ PARALLIX_NO_BUBBLEWRAP: '' }), false);
  assert.equal(isBubblewrapDisabled({ PARALLIX_NO_BUBBLEWRAP: '0' }), false);
  assert.equal(isBubblewrapDisabled({ PARALLIX_NO_BUBBLEWRAP: '1' }), true);
});

test('resolveSandboxProfile gives review a read-only worktree plus artifact dir and /tmp', () => {
  const profile = resolveSandboxProfile('review', '/work/tree', '/var/artifacts');
  assert.equal(profile.worktreeWritable, false);
  assert.deepEqual(profile.writable, ['/var/artifacts']);
  assert.deepEqual(profile.optionalWritable, ['/tmp']);
});

test('resolveSandboxProfile gives non-review steps a writable /tmp', () => {
  assert.deepEqual(resolveSandboxProfile('active', '/work/tree').optionalWritable, ['/tmp']);
});

test('buildBubblewrapArgs binds the worktree read-write for implementer steps', () => {
  const worktree = makeWorktree();
  try {
    const args = buildBubblewrapArgs(resolveSandboxProfile('active', worktree), worktree);
    assert.deepEqual(args.slice(0, 3), ['--ro-bind', '/', '/']);
    assert.ok(args.includes('--die-with-parent'));
    assert.ok(args.join(' ').includes(`--bind ${worktree} ${worktree}`));
    assert.deepEqual(args.slice(-3), ['--chdir', worktree, '--']);
  } finally { fs.rmSync(worktree, { recursive: true, force: true }); }
});

test('buildBubblewrapArgs keeps review worktree read-only and binds an outside artifact directory', () => {
  const worktree = makeWorktree();
  const artifactRoot = makeWorktree();
  const artifactDir = path.join(artifactRoot, 'review-artifacts');
  try {
    const args = buildBubblewrapArgs(resolveSandboxProfile('review', worktree, artifactDir), worktree);
    assert.ok(args.join(' ').includes(`--ro-bind ${worktree} ${worktree}`));
    // This fixture lives under /tmp; the explicit /tmp permission already
    // authorizes it, so the builder correctly avoids a redundant nested bind.
    assert.ok(!args.join(' ').includes(`--bind ${artifactDir} ${artifactDir}`));
    assert.ok(args.join(' ').includes('--bind /tmp /tmp'));
    assert.equal(fs.statSync(artifactDir).isDirectory(), true);
  } finally { fs.rmSync(worktree, { recursive: true, force: true }); fs.rmSync(artifactRoot, { recursive: true, force: true }); }
});

test('buildBubblewrapArgs rejects an unusable permitted path without widening a bind', () => {
  const worktree = makeWorktree();
  const file = path.join(worktree, 'not-a-directory');
  fs.writeFileSync(file, 'x');
  try {
    assert.throws(() => buildBubblewrapArgs({ worktree, worktreeWritable: false, writable: [file] }, worktree), BubblewrapGuardError);
  } finally { fs.rmSync(worktree, { recursive: true, force: true }); }
});

test('wrapWithBubblewrap prefixes bwrap and preserves the original argv', () => {
  setBubblewrapProbeForTest(() => true);
  const worktree = makeWorktree();
  try {
    const wrapped = withSandboxProfile(
      resolveSandboxProfile('active', worktree),
      () => wrapWithBubblewrap('codex', ['exec', '--sandbox', 'danger-full-access'], worktree)
    );
    assert.equal(wrapped.command, BUBBLEWRAP_COMMAND);
    assert.deepEqual(wrapped.args.slice(-4), ['codex', 'exec', '--sandbox', 'danger-full-access']);
    assert.equal(wrapped.args[wrapped.args.indexOf('codex') - 1], '--');
  } finally { fs.rmSync(worktree, { recursive: true, force: true }); }
});

test('spawnAndTee preserves stdout and exit status through bwrap', async () => {
  setBubblewrapProbeForTest(() => true);
  const worktree = makeWorktree();
  const observed: { command: string; args: string[] }[] = [];
  const mocked = test.mock.method(childProcess, 'spawn', (command: string, args: string[]) => {
    observed.push({ command, args });
    return fakeChild();
  });
  try {
    const result = await withSandboxProfile(
      resolveSandboxProfile('active', worktree),
      () => spawnAndTee('codex', ['exec'], { cwd: worktree, stdoutSink: nullSink(), stderrSink: nullSink() })
    );
    assert.equal(observed[0].command, BUBBLEWRAP_COMMAND);
    assert.deepEqual(observed[0].args.slice(-2), ['codex', 'exec']);
    assert.equal(result.status, 0);
    assert.equal(result.signal, null);
    assert.equal(result.stdout, 'hello');
  } finally { mocked.mock.restore(); fs.rmSync(worktree, { recursive: true, force: true }); }
});

test('spawnAndTee fails before spawning when an available guard cannot be built', async () => {
  setBubblewrapProbeForTest(() => true);
  const observed: string[] = [];
  const mocked = test.mock.method(childProcess, 'spawn', (command: string) => {
    observed.push(command);
    return fakeChild();
  });
  try {
    await assert.rejects(
      () => withSandboxProfile(
        resolveSandboxProfile('active', '/nonexistent/worktree'),
        () => spawnAndTee('codex', ['exec'], { cwd: '/nonexistent/worktree' })
      ),
      BubblewrapGuardError
    );
    assert.deepEqual(observed, []);
  } finally { mocked.mock.restore(); }
});

function fakeChild(): EventEmitter & { stdout: EventEmitter; stderr: EventEmitter } {
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter(), pid: 4321 });
  setImmediate(() => { child.stdout.emit('data', Buffer.from('hello')); child.emit('close', 0, null); });
  return child;
}

function nullSink(): NodeJS.WriteStream {
  return new Writable({ write(_chunk, _encoding, callback) { callback(); } }) as unknown as NodeJS.WriteStream;
}
