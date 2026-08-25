/**
 * TASK-2413 CP-2: verification-proof reuse and invalidation.
 *
 * Publication must consume/assert the authoritative handoff proof for an
 * unchanged tree/command/toolchain and must never authorize publication from a
 * stale or mismatched proof. These tests pin the identity mechanism
 * (`createVerificationProofIdentity` / `readReusableVerificationProof` /
 * `writeReusableVerificationProof` / `assertVerifiedTreeProof`) that publication
 * depends on.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  createVerificationProofIdentity,
  readReusableVerificationProof,
  writeReusableVerificationProof,
  captureVerifiedTreeProof,
  assertVerifiedTreeProof,
  readPublishedTreeState,
} from '../src/adapters/verification/verification.js';

function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-2413-proof-'));
  try { fn(dir); } finally {
    fs.rmSync(`${dir}.verification-proof.json`, { force: true });
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const proofPath = root => `${root}.verification-proof.json`;

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

test('task-2413: unchanged tree/command/toolchain reuses authoritative proof without re-verification', { concurrency: false }, () => {
  withTempDir(root => {
    initCommittedGitRepo(root);
    const command = './scripts/verify-local.sh all';
    const written = writeReusableVerificationProof(command, root, { proofPath: proofPath(root) });
    assert.equal(written.ok, true);

    // The handoff proof is authoritative and reusable for the identical inputs.
    const reused = readReusableVerificationProof(command, root, { proofPath: proofPath(root) });
    assert.equal(reused.ok, true, 'identical command reuses the proof');
    assert.equal(reused.proof!.command, command);
    assert.equal(reused.proof!.status, 'passed');
    assert.equal(reused.proof!.inputFingerprint, written.proof.inputFingerprint);
    assert.equal(reused.proof!.toolchain, written.proof.toolchain);

    // Publication asserts the unchanged tree authorises the publish using the
    // HEAD/tree identity captured by captureVerifiedTreeProof.
    const state = readPublishedTreeState(root);
    assert.equal(state.ok, true);
    const assertOk = assertVerifiedTreeProof({
      rootDir: fs.realpathSync(root),
      commit: state.commit,
      tree: state.tree,
    }, root);
    assert.equal(assertOk.ok, true, 'assertVerifiedTreeProof authorises the unchanged tree');
  });
});

test('task-2413: changing HEAD/tree invalidates proof reuse', { concurrency: false }, () => {
  withTempDir(root => {
    initCommittedGitRepo(root);
    const command = './scripts/verify-local.sh all';
    const written = writeReusableVerificationProof(command, root, { proofPath: proofPath(root) });
    assert.equal(written.ok, true);

    // A new commit changes HEAD/tree; reuse must fail closed.
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'change.js'), 'x');
    const add = childProcess.spawnSync('git', ['-C', root, 'add', 'src/change.js'], { encoding: 'utf8' });
    assert.equal(add.status, 0);
    const commit = childProcess.spawnSync('git', ['-C', root, 'commit', '-m', 'change tree'], { encoding: 'utf8' });
    assert.equal(commit.status, 0);

    const reused = readReusableVerificationProof(command, root, { proofPath: proofPath(root) });
    assert.equal(reused.ok, false, 'a changed tree must not reuse the proof');
  });
});

test('task-2413: changing HEAD alone invalidates proof reuse', { concurrency: false }, () => {
  withTempDir(root => {
    initCommittedGitRepo(root);
    const command = './scripts/verify-local.sh all';
    assert.equal(writeReusableVerificationProof(command, root, { proofPath: proofPath(root) }).ok, true);

    const commit = childProcess.spawnSync('git', ['-C', root, 'commit', '--allow-empty', '-m', 'new head'], { encoding: 'utf8' });
    assert.equal(commit.status, 0, commit.stderr);
    assert.equal(readReusableVerificationProof(command, root, { proofPath: proofPath(root) }).ok, false);
  });
});

test('task-2413: publication consumes an unchanged reusable proof without executing the gate', { concurrency: false }, () => {
  withTempDir(root => {
    initCommittedGitRepo(root);
    const command = 'exit 9';
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      adapters: { verification: { command, defaultArea: 'all' } },
    }));
    assert.equal(childProcess.spawnSync('git', ['-C', root, 'add', 'workflow.config.json']).status, 0);
    assert.equal(childProcess.spawnSync('git', ['-C', root, 'commit', '-m', 'configure gate']).status, 0);
    assert.equal(writeReusableVerificationProof(command, root, { proofPath: proofPath(root) }).ok, true);

    let executions = 0;
    const result = captureVerifiedTreeProof('all', root, {
      proofPath: proofPath(root), runFn: () => { executions++; return { status: 9, stdout: '', stderr: '' }; },
    });
    assert.equal(result.ok, true);
    assert.equal(executions, 0, 'publication must consume the handoff proof instead of executing the same gate');
  });
});

test('task-2413: publication reuse matches the handoff command after area placeholder resolution', { concurrency: false }, () => {
  withTempDir(root => {
    initCommittedGitRepo(root);
    const template = './scripts/verify-local.sh {{area}}';
    fs.writeFileSync(path.join(root, 'workflow.config.json'), JSON.stringify({
      adapters: { verification: { command: template, defaultArea: 'all' } },
    }));
    assert.equal(childProcess.spawnSync('git', ['-C', root, 'add', 'workflow.config.json']).status, 0);
    assert.equal(childProcess.spawnSync('git', ['-C', root, 'commit', '-m', 'placeholder command']).status, 0);
    const command = './scripts/verify-local.sh all';
    assert.equal(writeReusableVerificationProof(command, root, { proofPath: proofPath(root) }).ok, true);
    let executions = 0;
    const result = captureVerifiedTreeProof('all', root, {
      proofPath: proofPath(root), runFn: () => { executions++; return { status: 9, stdout: '', stderr: '' }; },
    });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.proof?.command, command);
    assert.equal(executions, 0);
  });
});

test('task-2413: changing the verification command invalidates proof reuse', { concurrency: false }, () => {
  withTempDir(root => {
    initCommittedGitRepo(root);
    const written = writeReusableVerificationProof('./scripts/verify-local.sh all', root, { proofPath: proofPath(root) });
    assert.equal(written.ok, true);
    const reused = readReusableVerificationProof('./scripts/verify-local.sh static-analysis', root, { proofPath: proofPath(root) });
    assert.equal(reused.ok, false, 'a different command must not reuse the proof');
  });
});

test('task-2413: a stale/mismatched proof cannot authorize publication', { concurrency: false }, () => {
  withTempDir(root => {
    initCommittedGitRepo(root);
    const state = readPublishedTreeState(root);
    assert.equal(state.ok, true);

    // A proof captured from a *different* checkout must not authorise this tree.
    const foreign = { rootDir: '/some/other/checkout', commit: 'deadbeef', tree: 'foreigntree' };
    const assertForeign = assertVerifiedTreeProof(foreign, root);
    assert.equal(assertForeign.ok, false);
    assert.match(assertForeign.error || '', /different checkout/);

    // A proof whose commit no longer matches the current HEAD must not authorise.
    const staleCommit = { rootDir: fs.realpathSync(root), commit: '000000', tree: state.tree! };
    const assertStale = assertVerifiedTreeProof(staleCommit, root);
    assert.equal(assertStale.ok, false);
    assert.match(assertStale.error || '', /does not match the tree being published/);

    // Missing proof must not authorise.
    const assertMissing = assertVerifiedTreeProof(null, root);
    assert.equal(assertMissing.ok, false);
    assert.match(assertMissing.error || '', /missing verification proof/);
  });
});

test('task-2413: a dirty worktree cannot issue a reusable proof (fails closed)', { concurrency: false }, () => {
  withTempDir(root => {
    initCommittedGitRepo(root);
    fs.writeFileSync(path.join(root, 'README.md'), 'dirty\n');
    const identity = createVerificationProofIdentity('./scripts/verify-local.sh all', root);
    assert.equal(identity.ok, false);
    assert.match(identity.error || '', /dirty worktree/);
  });
});
