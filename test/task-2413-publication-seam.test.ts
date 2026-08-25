/**
 * TASK-2413 CP-3: end-to-end propagation of the structured gate failure through
 * the Forgejo publication seam.
 *
 * Proves acceptance item 5: when publication runs the verifier and it fails, the
 * handoff caller receives the underlying structured gate failure (captured
 * stdout/stderr, exit code, command) rather than only a generic
 * "Forgejo PR creation/update failed" wrapper.
 *
 * These cross a real Git boundary (temp repo + configured verification command),
 * so they run in the integration layer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createPr } from '../src/adapters/forgejo/forgejo-pr.js';

function withCommittedRepo(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-2413-pub-'));
  try { fn(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function initCommittedGitRepo(root) {
  const runGit = (args) => {
    const result = childProcess.spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout || `git ${args.join(' ')} failed`);
  };
  runGit(['init']);
  runGit(['checkout', '-b', 'main']);
  runGit(['config', 'user.name', 'Test User']);
  runGit(['config', 'user.email', 'test@example.com']);
  fs.writeFileSync(path.join(root, 'README.md'), '# temp repo\n', 'utf8');
  runGit(['add', 'README.md']);
  runGit(['commit', '-m', 'init']);
}

function writeWorkflowConfig(root, verificationCommand) {
  fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
    product: { name: 'Task 2413 Pub' },
    adapters: {
      verification: { command: verificationCommand, defaultArea: 'docs' },
      review: { provider: 'forgejo', baseUrl: 'http://localhost:3300', remote: 'review', repo: 'test-org/test-repo' },
    },
  }), 'utf8');
}

test('task-2413: publication verifier failure carries captured output through createPr', () => {
  withCommittedRepo(root => {
    initCommittedGitRepo(root);
    // A verifier that emits diagnostic output and fails non-zero, mirroring a
    // timing/resource-contention gate collapse under host contention.
    const verificationCommand = "sh -c 'echo captured-stdout-line; echo captured-stderr-line 1>&2; exit 3'";
    writeWorkflowConfig(root, verificationCommand);

    const result = createPr('mission/task-9999', 'claude', 'token-123', {
      rootDir: root,
      log: () => {},
    });

    assert.equal(result.ok, false, 'a failing verification gate blocks publication');
    assert.match(result.error || '', /verification gate failed/i);
    assert.match(result.error || '', /exit code 3/);
    // The captured diagnostic survives the wrapper — the task-2373.01 loss.
    assert.match(result.error || '', /captured-stdout-line/);
    assert.match(result.error || '', /captured-stderr-line/);
    assert.deepEqual(result.gateFailure, {
      area: 'docs',
      command: verificationCommand,
      cwd: fs.realpathSync(root),
      exitCode: 3,
      stdout: 'captured-stdout-line',
      stderr: 'captured-stderr-line',
    });
  });
});

test('task-2413: an exit-code-only wrapper string still propagates without crashing createPr', () => {
  withCommittedRepo(root => {
    initCommittedGitRepo(root);
    // A verifier that fails with no stdout/stderr still yields a structured,
    // non-empty gate failure (exit code preserved), never a hidden success.
    const verificationCommand = 'sh -c "exit 2"';
    writeWorkflowConfig(root, verificationCommand);

    const result = createPr('mission/task-9998', 'claude', 'token-123', {
      rootDir: root,
      log: () => {},
    });

    assert.equal(result.ok, false);
    assert.match(result.error || '', /exit code 2/);
  });
});
