import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBubblewrapArgs,
  resolveSandboxProfile,
  setBubblewrapProbeForTest,
  type SandboxProfile
} from '../../../src/adapters/process/bubblewrap.js';
import { configCellArgs, type ConfigCell } from '../../../src/adapters/process/config-cell.js';

test.afterEach(() => {
  setBubblewrapProbeForTest(null);
});

/** Run one command inside a Bubblewrap-confined root. Returns the exit status (null on signal). */
function runConfined(args: string[], sh: string): number | null {
  setBubblewrapProbeForTest(() => true);
  const res = childProcess.spawnSync('bwrap', [...args, 'sh', '-c', sh], { encoding: 'utf8' });
  if (res.error) { throw res.error; }
  return res.status;
}

/**
 * Build a host tree reached through a symlink: `<root>/real` is the real
 * directory and `<root>/link` is a symlink to it. Returns both paths.
 */
function makeSymlinkedHost(prefix: string): { root: string; real: string; link: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const real = path.join(root, 'real');
  fs.mkdirSync(real);
  const link = path.join(root, 'link');
  fs.symlinkSync(real, link);
  return { root, real, link };
}

/**
 * TASK-2698 red-before-green proof for the writable bind: the parent guard emits
 * `--bind <symlink> <symlink>` and bwrap 0.12 refuses it; the canonicalized guard
 * binds the resolved real target and bwrap exits 0.
 */
test('writable bind onto a symlinked destination fails at parent commit and passes after the fix', () => {
  // `worktree` and the symlinked writable `link` are siblings under one base so
  // `link` is neither nested under the worktree nor under the `/tmp` convenience
  // bind: the guard must emit `--bind link link` explicitly for the proof to be
  // about symlink canonicalization, not about an ancestor bind covering it.
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bwrap-sym-writable-base-'));
  const real = path.join(base, 'real');
  fs.mkdirSync(real);
  const link = path.join(base, 'link');
  fs.symlinkSync(real, link);
  const worktree = path.join(base, 'wt');
  fs.mkdirSync(worktree);
  const marker = path.join(real, 'written.txt');
  try {
    // Parent behavior: bind the symlink destination directly.
    const parentArgs = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--die-with-parent'];
    parentArgs.push('--bind', link, link);
    parentArgs.push('--bind', worktree, worktree);
    const denied = runConfined(parentArgs, `printf evidence > "${marker}"`);
    assert.notEqual(denied, 0, 'parent guard must refuse the symlink destination');
    assert.match(
      childProcess.spawnSync('bwrap', [...parentArgs, 'sh', '-c', `cat "${marker}"`], { encoding: 'utf8' }).stderr,
      /Can't mount on symlink destination/
    );

    // Fixed behavior: the profile declares the symlink; the guard canonicalizes
    // it to the real target. Drop the `/tmp` convenience bind so `link` is bound
    // explicitly and the proof is about canonicalization.
    const profile = resolveSandboxProfile('active', worktree, null, 'codex');
    profile.writable = [link];
    profile.optionalWritable = [];
    profile.optionalWritableDirectories = [];
    profile.gitMetadata = [];
    const args = buildBubblewrapArgs(profile, worktree);
    assert.ok(args.includes('--bind') && args.includes(real), 'the guard binds the resolved real target');
    assert.equal(runConfined(args, `printf evidence > "${marker}"`), 0, 'fixed guard mounts the resolved target');
    assert.equal(fs.readFileSync(marker, 'utf8'), 'evidence', 'confined write reached the real target');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

/** Non-symlink mounts must emit a byte-for-byte identical argv. */
test('non-symlink writable bind emits an identical argv with no canonicalization', () => {
  // A shared base so `worktree` and `extra` are siblings: `extra` is neither
  // nested under the worktree (covered by the worktree bind) nor under the
  // `/tmp` convenience bind, so the guard must emit it as its own writable bind.
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bwrap-sym-norm-base-'));
  const worktree = path.join(base, 'wt');
  const extra = path.join(base, 'extra');
  fs.mkdirSync(worktree);
  fs.mkdirSync(extra);
  try {
    // A minimal implementer profile so `extra` is emitted as its own explicit
    // writable bind rather than being covered by an ancestor bind.
    const profile = { worktree, worktreeWritable: true, writable: [extra], gitMetadata: [] } as SandboxProfile;
    const args = buildBubblewrapArgs(profile, worktree);
    // The writable bind must appear as `--bind <extra> <extra>` with the exact,
    // un-canonized path on both sides.
    const bind = args.flatMap((a, i) => a === '--bind' ? [{ src: args[i + 1], dst: args[i + 2] }] : [])
      .find(b => b.src === extra);
    assert.ok(bind, `the writable bind for ${extra} is emitted`);
    assert.equal(bind.src, extra, 'source is the exact non-symlink path');
    assert.equal(bind.dst, extra, 'destination is the exact non-symlink path');
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

/** A read-only worktree reached through a symlink must mount and stay read-only. */
test('read-only worktree reached through a symlink mounts under bwrap and stays read-only', () => {
  const { link } = makeSymlinkedHost('bwrap-sym-wt-');
  const realWorktree = link; // the symlink IS the worktree path handed to the guard
  const source = path.join(realWorktree, 'hello.sh');
  fs.writeFileSync(source, 'original\n');
  try {
    const profile = resolveSandboxProfile('review', realWorktree, path.join(realWorktree, '.art'), 'codex');
    const args = buildBubblewrapArgs(profile, realWorktree);
    const out = path.join(realWorktree, '.art', 'outcome.txt');
    assert.equal(runConfined(args, `printf evidence > "${out}"`), 0, 'confined write into artifact dir succeeds');
    assert.equal(fs.readFileSync(out, 'utf8'), 'evidence');
    const denied = runConfined(args, `printf mutation > "${source}"`);
    assert.notEqual(denied, 0, 'symlinked read-only worktree source stays read-only');
    assert.equal(fs.readFileSync(source, 'utf8'), 'original\n');
  } finally {
    fs.rmSync(path.dirname(link), { recursive: true, force: true });
  }
});

/**
 * A nested Git-metadata bind whose destination is a symlink must let a confined
 * implementer stage and commit: the guard canonicalizes the git common dir.
 */
function makeLinkedWorktree(): { parent: string; worktree: string; cleanup: () => void } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bwrap-sym-git-'));
  const parent = path.join(root, 'parent');
  fs.mkdirSync(parent);
  const git = (args: string[], cwd: string) => {
    const res = childProcess.spawnSync('git', args, {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, GIT_AUTHOR_NAME: 'reg', GIT_AUTHOR_EMAIL: 'reg@test', GIT_COMMITTER_NAME: 'reg', GIT_COMMITTER_EMAIL: 'reg@test' }
    });
    if (res.status !== 0) {
      fs.rmSync(root, { recursive: true, force: true });
      throw new Error(`git ${args.join(' ')} failed: ${res.stderr?.toString() ?? res.error}`);
    }
    return res.stdout;
  };
  git(['init', '-q', '-b', 'main'], parent);
  git(['config', 'user.email', 'reg@test'], parent);
  git(['config', 'user.name', 'reg'], parent);
  fs.writeFileSync(path.join(parent, 'f.txt'), 'base\n');
  git(['add', 'f.txt'], parent);
  git(['commit', '-qm', 'base'], parent);
  git(['checkout', '-q', 'main'], parent);
  const worktree = path.join(root, 'wtree');
  git(['worktree', 'add', '-q', '--detach', worktree], parent);
  return {
    parent, worktree,
    cleanup: () => { try { git(['worktree', 'prune'], parent); } catch { /* ignore */ } fs.rmSync(root, { recursive: true, force: true }); }
  };
}

test('nested Git-metadata bind whose common dir is a symlink lets a confined implementer stage and commit', () => {
  const wt = makeLinkedWorktree();
  try {
    const commonDir = childProcess
      .spawnSync('git', ['-C', wt.worktree, 'rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' })
      .stdout.trim();
    const linkDir = path.join(wt.parent, 'gitlink');
    fs.symlinkSync(commonDir, linkDir);
    // Point the profile at the symlinked common dir as its writable grant.
    const profile = resolveSandboxProfile('active', wt.worktree, wt.worktree, null);
    profile.writable = [linkDir];
    profile.gitMetadata = [linkDir];
    const args = buildBubblewrapArgs(profile, wt.worktree);
    fs.writeFileSync(path.join(wt.worktree, 'confined.txt'), 'change\n');
    assert.equal(
      childProcess.spawnSync('bwrap', [...args, 'git', 'add', 'confined.txt'], { cwd: wt.worktree, encoding: 'utf8' }).status,
      0,
      'confined git add over the symlinked common dir succeeds'
    );
    assert.equal(
      childProcess.spawnSync('bwrap', [...args, 'git', 'commit', '-qm', 'symlink meta'], { cwd: wt.worktree, encoding: 'utf8' }).status,
      0,
      'confined git commit over the symlinked common dir succeeds'
    );
  } finally { wt.cleanup(); }
});

/** A config cell whose target is a symlink mounts successfully; host entries stay read-only. */
test('config cell whose target is a symlink mounts and keeps host entries read-only', () => {
  const { real, link } = makeSymlinkedHost('bwrap-sym-cell-');
  const cell = fs.mkdtempSync(path.join(os.tmpdir(), 'bwrap-sym-cellstate-'));
  const hostEntry = path.join(real, 'settings.json');
  fs.writeFileSync(hostEntry, '{"theme":"dark"}');
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'bwrap-sym-cellwt-'));
  try {
    const configCell: ConfigCell = {
      target: link,
      cell,
      readOnly: [],
      keep: [/\.oauth_refresh\.lock$/, /\.credentials\.json\.tmp\.[0-9a-f]{8}$/],
      guarded: { files: ['settings.json'], directories: [] },
    };
    const profile = { worktree, worktreeWritable: true, writable: [], gitMetadata: [], configCell } as SandboxProfile;
    const args = buildBubblewrapArgs(profile, worktree);
    // The guard canonicalizes the symlinked target: the cell binds the resolved
    // real target and the host entry ro-binds over it.
    assert.ok(args.includes('--bind') && args.includes(real), 'cell binds the resolved real target');
    assert.ok(args.includes('--ro-bind') && args.includes(hostEntry), 'host entry ro-binds over the cell');

    // Read the host entry through the resolved target inside the sandbox.
    const read = childProcess.spawnSync('bwrap', [...args, 'sh', '-c', `cat "${hostEntry}"`], { encoding: 'utf8' });
    assert.equal(read.status, 0, 'confined read of the symlinked host entry succeeds');
    assert.equal(read.stdout.trim(), '{"theme":"dark"}');

    // Write to the host entry must be denied: it is ro-bound over the writable cell.
    const write = childProcess.spawnSync('bwrap', [...args, 'sh', '-c', `printf x > "${hostEntry}"`], { encoding: 'utf8' });
    assert.notEqual(write.status, 0, 'host entry stays read-only over the symlinked cell');
    assert.equal(fs.readFileSync(hostEntry, 'utf8'), '{"theme":"dark"}');

    // The cell can still create new entries next to its host target. Inside the
    // sandbox the cell is mounted over the resolved `real` target, so a new file
    // lands at `<real>/fresh.json`, which is the host `cell` directory.
    const newEntry = path.join(real, 'fresh.json');
    assert.equal(runConfined(args, `printf fresh > "${newEntry}"`), 0, 'cell writable bind reaches a new entry');
    assert.ok(fs.existsSync(path.join(cell, 'fresh.json')), 'new entry persisted into the host cell');
  } finally {
    fs.rmSync(path.dirname(link), { recursive: true, force: true });
    fs.rmSync(cell, { recursive: true, force: true });
    fs.rmSync(worktree, { recursive: true, force: true });
  }
});

/** The exported canonicalization path for config-cell args over a symlinked target. */
test('configCellArgs canonicalizes a symlinked target and its host entries', () => {
  const { real, link } = makeSymlinkedHost('bwrap-sym-cellcfg-');
  const cell = fs.mkdtempSync(path.join(os.tmpdir(), 'bwrap-sym-cellcfgstate-'));
  fs.writeFileSync(path.join(real, 'a.json'), '{}');
  try {
    const args = configCellArgs({ target: link, cell, readOnly: [], keep: [], guarded: { files: [], directories: [] } }, []);
    const realEntry = path.join(real, 'a.json');
    assert.ok(args.includes('--ro-bind') && args.includes(realEntry), `configCellArgs binds the resolved host entry ${realEntry}`);
  } finally {
    fs.rmSync(path.dirname(link), { recursive: true, force: true });
    fs.rmSync(cell, { recursive: true, force: true });
  }
});
