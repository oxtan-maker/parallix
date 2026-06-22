/**
 * Tests for `px shell-init`: the shell function it emits must change the
 * caller's terminal into the next mission worktree when the runtime prints a
 * `[INFO] Next: cd …` or `[INFO] Working directory: …` transition signal.
 *
 * A shell function always runs in the caller's shell, so (unlike the removed
 * sourced `w.sh` wrapper) it can `cd` without any sourced-vs-executed handling.
 * These tests put a fake `px` on PATH so `command px` inside the function is
 * exercised without needing a global install.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const { shellInit } = require('../px.js');

const pxJs = path.resolve(__dirname, '..', 'px.js');

// Builds a fake `px` executable that prints the given transition signal.
function makeFakePx({ signalPath, exitCode = 0, signal = 'next' }) {
  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'px-shell-init-bin-'));
  const pxPath = path.join(fakeBin, 'px');
  const message = signal === 'working-directory'
    ? `[INFO] Working directory: ${signalPath}`
    : `[INFO] Next: cd ${signalPath}`;
  fs.writeFileSync(
    pxPath,
    ['#!/usr/bin/env bash', `echo ${JSON.stringify(message)}`, `exit ${exitCode}`, ''].join('\n'),
  );
  fs.chmodSync(pxPath, 0o755);
  return fakeBin;
}

// PATH must be set inside the script: a login shell (`-l`) reloads the profile
// and would otherwise clobber a PATH passed through the environment, hiding the
// fake `px`.
function runBash(scriptLines, fakeBin) {
  const script = [
    `export PATH=${JSON.stringify(`${fakeBin}:${process.env.PATH}`)}`,
    ...scriptLines,
  ].join('\n');
  return spawnSync('bash', ['-lc', script], { encoding: 'utf8' });
}

test('shellInit emits a bash px function', () => {
  const out = shellInit('bash');
  assert.match(out, /^px\(\) \{/m);
  assert.match(out, /command px "\$@"/);
  assert.match(out, /_px_exit=\$\{PIPESTATUS\[0\]\}/);
});

test('shellInit emits zsh-flavoured pipe status capture', () => {
  const out = shellInit('zsh');
  assert.match(out, /_px_exit=\$\{pipestatus\[1\]\}/);
});

test('shellInit rejects an unsupported shell', () => {
  assert.throws(() => shellInit('fish'), /Unsupported shell/);
});

test('px function follows a Next: cd transition', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'px-shell-init-target-'));
  const fakeBin = makeFakePx({ signalPath: target });

  const result = runBash(
    [
      `eval "$(node ${JSON.stringify(pxJs)} shell-init bash)"`,
      'px draft task-1 >/dev/null',
      'printf "PWD_AFTER=%s\\n" "$(pwd -P)"',
    ],
    fakeBin,
  );

  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 0, output);
  assert.match(output, new RegExp(`PWD_AFTER=${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

  fs.rmSync(fakeBin, { recursive: true, force: true });
  fs.rmSync(target, { recursive: true, force: true });
});

test('px function follows a Working directory transition', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'px-shell-init-wd-'));
  const fakeBin = makeFakePx({ signalPath: target, signal: 'working-directory' });

  const result = runBash(
    [
      `eval "$(node ${JSON.stringify(pxJs)} shell-init bash)"`,
      'px active task-1 >/dev/null',
      'printf "PWD_AFTER=%s\\n" "$(pwd -P)"',
    ],
    fakeBin,
  );

  const output = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 0, output);
  assert.match(output, new RegExp(`PWD_AFTER=${target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

  fs.rmSync(fakeBin, { recursive: true, force: true });
  fs.rmSync(target, { recursive: true, force: true });
});

test('px function preserves the runner exit code', () => {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'px-shell-init-exit-'));
  const fakeBin = makeFakePx({ signalPath: target, exitCode: 7 });

  const result = runBash(
    [
      `eval "$(node ${JSON.stringify(pxJs)} shell-init bash)"`,
      'px integrate task-1 >/dev/null',
      'printf "STATUS=%s\\n" "$?"',
    ],
    fakeBin,
  );

  const output = `${result.stdout}${result.stderr}`;
  assert.match(output, /STATUS=7/);

  fs.rmSync(fakeBin, { recursive: true, force: true });
  fs.rmSync(target, { recursive: true, force: true });
});
