// @ts-nocheck -- TASK-2535: inline doubles for git seams; mirrors the
// mockModule/@ts-nocheck pattern in test/stats-backfill.test.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as git from '../src/adapters/git/git.js';

function tempDir(prefix = 'git-pure-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function cleanup(dir) { fs.rmSync(dir, { recursive: true, force: true }); }

// ---------- parseUnmergedFiles (pure: returns the second porcelain column) ----------

test('parseUnmergedFiles extracts the second column from porcelain -u output', () => {
  // git ls-files -u columns are <sha>\t<path>\t<more>; the helper reads column 1.
  const output = 'deadbeef\ta.txt\ndeadbeef\tb.txt\n';
  assert.deepEqual(git.parseUnmergedFiles(output), ['a.txt', 'b.txt']);
});

test('parseUnmergedFiles dedupes identical rows and skips blank lines', () => {
  const output = 'sha\ta.txt\nsha\ta.txt\n\n';
  assert.deepEqual(git.parseUnmergedFiles(output), ['a.txt']);
});

test('parseUnmergedFiles returns an empty array for empty output', () => {
  assert.deepEqual(git.parseUnmergedFiles(''), []);
});

// ---------- detectRebaseState (injected gitRunner + fsModule) ----------

test('detectRebaseState reports in-progress when a rebase-merge directory exists', () => {
  const state = git.detectRebaseState('/nonexistent', {
    gitRunner: () => ({ status: 0, stdout: '.git' }),
    fsModule: { existsSync: () => true },
    pathModule: { isAbsolute: (p) => p.startsWith('/'), join: (...p) => p.join('/') },
  });
  assert.equal(state.inProgress, true);
  assert.equal(state.rebaseDir != null, true);
});

test('detectRebaseState reports a clean, attached HEAD when no rebase is running', () => {
  const state = git.detectRebaseState('/nonexistent', {
    gitRunner: (args) => {
      if (args.includes('--git-dir')) return { status: 0, stdout: '.git' };
      if (args.includes('symbolic-ref')) return { status: 0, stdout: 'main' };
      return { status: 1, stdout: '' }; // show-current + ls-files: nothing in progress
    },
    fsModule: { existsSync: () => false },
    pathModule: { isAbsolute: (p) => p.startsWith('/'), join: (...p) => p.join('/') },
  });
  assert.equal(state.inProgress, false);
  assert.equal(state.detached, false);
  assert.equal(state.rebaseDir, null);
});

test('detectRebaseState reports detached HEAD when symbolic-ref fails', () => {
  const state = git.detectRebaseState('/nonexistent', {
    gitRunner: (args) => {
      if (args.includes('--git-dir')) return { status: 0, stdout: '.git' };
      if (args.includes('symbolic-ref')) return { status: 1, stdout: '' };
      return { status: 1, stdout: '' };
    },
    fsModule: { existsSync: () => false },
    pathModule: { isAbsolute: (p) => p.startsWith('/'), join: (...p) => p.join('/') },
  });
  assert.equal(state.detached, true);
});

// ---------- findIgnoredSourceFiles (injected gitFn over a real temp tree) ----------

test('findIgnoredSourceFiles returns source files that the injected git function reports as ignored', () => {
  const dir = tempDir();
  try {
    fs.writeFileSync(path.join(dir, 'ignored.ts'), '// x\n');
    fs.writeFileSync(path.join(dir, 'tracked.ts'), '// y\n');
    const gitFn = (args) => ({
      status: args.includes('ignored.ts') ? 0 : 1,
      stdout: '',
    });
    const files = git.findIgnoredSourceFiles(dir, gitFn);
    assert.deepEqual(files, ['ignored.ts']);
  } finally { cleanup(dir); }
});

test('findIgnoredSourceFiles returns an empty list when the directory cannot be read', () => {
  const gitFn = () => ({ status: 0, stdout: '' });
  assert.deepEqual(git.findIgnoredSourceFiles('/definitely-missing-dir-12345', gitFn), []);
});
