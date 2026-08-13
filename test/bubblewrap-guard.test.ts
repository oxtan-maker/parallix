import test from 'node:test';
import assert from 'node:assert/strict';
import * as fmt from '../src/application/presentation/cli-format.js';
import {
  BubblewrapGuardError,
  buildBubblewrapArgs,
  isBubblewrapAvailable,
  isBubblewrapDisabled,
  resolveSandboxProfile,
  setBubblewrapProbeForTest
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
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
