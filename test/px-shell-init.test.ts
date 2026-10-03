// Historical regression provenance: TASK-1390.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test, { describe } from 'node:test';
import { startAgent } from '../src/adapters/agents/agents.js';
import { shellInit } from '../src/composition/create-cli.js';

describe('px shell-init function', () => {
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


  // Builds a fake `px` executable that prints the given transition signal.
  function makeFakePx({ signalPath, exitCode = 0, signal = 'next', messages = [] }) {
    const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), 'px-shell-init-bin-'));
    const pxPath = path.join(fakeBin, 'px');
    const message = signal === 'working-directory'
      ? `[INFO] Working directory: ${signalPath}`
      : `[INFO] Next: cd ${signalPath}`;
    fs.writeFileSync(
      pxPath,
      ['#!/usr/bin/env bash', ...messages.map(line => `echo ${JSON.stringify(line)}`), `echo ${JSON.stringify(message)}`, `exit ${exitCode}`, ''].join('\n'),
    );
    fs.chmodSync(pxPath, 0o755);
    return fakeBin;
  }

  // `shellInit` is read straight from TypeScript source, so these transition
  // tests never depend on a generated tree that a concurrent integration test
  // could rebuild mid-run.  Distribution execution of the shipped entry point is
  // covered by the built-px shebang cases in this file (task-1390).
  function writeShellInit(fakeBin) {
    const initPath = path.join(fakeBin, 'shell-init.sh');
    fs.writeFileSync(initPath, shellInit('bash'));
    return initPath;
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
    const initPath = writeShellInit(fakeBin);

    const result = runBash(
      [
        `source ${JSON.stringify(initPath)}`,
        'px draft task-1 >/dev/null',
        'printf "PWD_AFTER=%s\\n" "$(pwd -P)"',
      ],
      fakeBin,
    );

    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 0, output);
    assert.match(output, new RegExp(`PWD_AFTER=${fs.realpathSync(target).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

    fs.rmSync(fakeBin, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  });

  test('px function follows a Working directory transition', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'px-shell-init-wd-'));
    const fakeBin = makeFakePx({ signalPath: target, signal: 'working-directory' });
    const initPath = writeShellInit(fakeBin);

    const result = runBash(
      [
        `source ${JSON.stringify(initPath)}`,
        'px active task-1 >/dev/null',
        'printf "PWD_AFTER=%s\\n" "$(pwd -P)"',
      ],
      fakeBin,
    );

    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 0, output);
    assert.match(output, new RegExp(`PWD_AFTER=${fs.realpathSync(target).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

    fs.rmSync(fakeBin, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  });

  test('px function ignores a routine agent-launch working-directory log', async () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'px-shell-init-agent-cwd-'));
    const startDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'px-shell-init-start-'));
    const launchLogs = [];
    await startAgent('review', {
      agent: 'claude',
      prompt: 'Test launch logging.',
      isAgentBlockedFn: () => false,
      resolveAgentModelFn: () => null,
      assertAgentSupportedFn: () => {},
      log: message => launchLogs.push(message),
      launchAgentFn: () => ({
        invocation: { command: 'claude', args: [], options: { cwd: target } },
        resultPromise: Promise.resolve({ status: 0, stdout: '', stderr: '' }),
      }),
    });
    const fakeBin = makeFakePx({ signalPath: '', messages: launchLogs });
    const initPath = writeShellInit(fakeBin);

    const result = runBash(
      [
        `cd ${JSON.stringify(startDirectory)}`,
        `source ${JSON.stringify(initPath)}`,
        'px review task-1 >/dev/null',
        'printf "PWD_AFTER=%s\\n" "$(pwd -P)"',
      ],
      fakeBin,
    );

    const output = `${result.stdout}${result.stderr}`;
    assert.equal(result.status, 0, output);
    assert.match(output, new RegExp(`PWD_AFTER=${fs.realpathSync(startDirectory).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

    fs.rmSync(fakeBin, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
    fs.rmSync(startDirectory, { recursive: true, force: true });
  });

  test('px function preserves the runner exit code', () => {
    const target = fs.mkdtempSync(path.join(os.tmpdir(), 'px-shell-init-exit-'));
    const fakeBin = makeFakePx({ signalPath: target, exitCode: 7 });
    const initPath = writeShellInit(fakeBin);

    const result = runBash(
      [
        `source ${JSON.stringify(initPath)}`,
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

  // Reproduction test for task-1381: the px shell function must not emit an error
  // when the integrate command's transition signal points to a directory that does
  // not exist. Before the fix, the shell function writes
  // `[px] ERROR: target directory '<path>' not found.` to stderr and the test
  // fails. After the fix, the function skips the cd silently, writes nothing to
  // stderr, and exits with the runner's original exit code (0).
  test('px function silently skips cd when target directory is missing (task-1381)', () => {
    // Use a path that definitely does not exist — do NOT create the directory.
    const missingTarget = path.join(os.tmpdir(), `px-shell-init-missing-${Date.now()}`);
    assert.ok(!fs.existsSync(missingTarget), 'test setup: target must not exist');

    const fakeBin = makeFakePx({ signalPath: missingTarget });
    const initPath = writeShellInit(fakeBin);

    const result = runBash(
      [
        `source ${JSON.stringify(initPath)}`,
        'px integrate task-1 >/dev/null',
        'printf "STATUS=%s\\n" "$?"',
      ],
      fakeBin,
    );

    // The shell function must NOT print an error to stderr when the directory is
    // missing. Before the fix, stderr contains "ERROR: target directory".
    const stderrOutput = result.stderr || '';
    assert.doesNotMatch(stderrOutput, /ERROR: target directory/, 'shell function must not emit error for missing directory');

    // Exit code should reflect the runner's exit code (0), not an error from the
    // shell function's directory check.
    assert.equal(result.status, 0, `expected exit code 0, got ${result.status}. stderr was: ${stderrOutput}`);

    fs.rmSync(fakeBin, { recursive: true, force: true });
  });

  // Companion test for task-1381: the `Working directory:` signal path must also
  // silently skip the cd when the target directory does not exist. Both signal
  // types share the same _px_target extraction and [ -d ] check in the shell
  // function template, but success criterion #1 explicitly covers both.
  test('px function silently skips cd for Working directory signal when target missing (task-1381)', () => {
    const missingTarget = path.join(os.tmpdir(), `px-shell-init-wd-missing-${Date.now()}`);
    assert.ok(!fs.existsSync(missingTarget), 'test setup: target must not exist');

    const fakeBin = makeFakePx({ signalPath: missingTarget, signal: 'working-directory' });
    const initPath = writeShellInit(fakeBin);

    const result = runBash(
      [
        `source ${JSON.stringify(initPath)}`,
        'px integrate task-1 >/dev/null',
        'printf "STATUS=%s\\n" "$?"',
      ],
      fakeBin,
    );

    const stderrOutput = result.stderr || '';
    assert.doesNotMatch(stderrOutput, /ERROR: target directory/, 'shell function must not emit error for missing directory via Working directory signal');
    assert.equal(result.status, 0, `expected exit code 0, got ${result.status}. stderr was: ${stderrOutput}`);

    fs.rmSync(fakeBin, { recursive: true, force: true });
  });
});

describe("built px.mjs shell-init shebang", () => {
  /**
   * Reproduction test for task-1390: px shell-init bash broken after
   * TypeScript conversion.
   *
   * The distribution build emits the CLI as a bundle. TypeScript and bundlers
   * historically strip shebang lines from generated output, leaving the CLI
   * without a #!/usr/bin/env node header. Without the shebang the entry cannot be
   * executed directly and the npm bin wrapper may behave unexpectedly in certain
   * environments, breaking the shell function generated by `px shell-init bash`
   * (which uses `command px "$@"` to invoke the globally installed px binary).
   *
   * This test verifies that the shipped entry point is directly executable (has
   * the shebang) and that running `shell-init bash` from it produces valid shell
   * output. TASK-2288 retired the transitional dist/px.js, so the assertion now
   * covers build/px.mjs — the target of package.json's `bin.px`.
   *
   * Red at parent commit (before fix): the entry is missing its shebang, or
   *   shell-init bash fails to produce valid output.
   * Green after fix: the entry has a shebang and shell-init bash works.
   */


  const PX_ENTRY = path.resolve(import.meta.dirname, '..', 'build', 'px.mjs');

  test('build/px.mjs has shebang for direct execution (task-1390)', () => {
    assert.ok(fs.existsSync(PX_ENTRY), 'build/px.mjs must exist after npm run build');
    const content = fs.readFileSync(PX_ENTRY, 'utf8');
    const firstLine = content.split('\n')[0];
    assert.equal(
      firstLine,
      '#!/usr/bin/env node',
      'build/px.mjs must start with #!/usr/bin/env node shebang for direct execution',
    );
  });

  test('build/px.mjs shell-init bash produces valid shell function (task-1390)', () => {
    const result = spawnSync('node', [PX_ENTRY, 'shell-init', 'bash'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    assert.equal(result.status, 0, `shell-init bash exited ${result.status}: ${result.stderr}`);
    const output = result.stdout;
    assert.ok(
      output.includes('px() {'),
      'output must contain the px shell function definition',
    );
    assert.ok(
      output.includes('command px'),
      'output must reference command px for PATH resolution',
    );
    assert.ok(
      output.includes('PIPESTATUS'),
      'output must capture bash pipe status for exit code propagation',
    );
  });
});
