// TASK-2627: `git commit --only` must name both sides of squash-staged renames.
// This drives production squashAndLand over a throwaway Git repository.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { createSquashLanding } from '../../../src/application/integrate/squash.js';
import * as fmt from '../../../src/application/presentation/cli-format.js';

function git(root: string, args: string[]): string {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`);
  return String(result.stdout);
}

function gitRun(args: string[]) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  return { status: result.status ?? 1, stdout: String(result.stdout), stderr: String(result.stderr) };
}

function fixture(withEdit: boolean): { root: string, oldPath: string, newPath: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2627-'));
  const oldPath = 'test/old-name.test.ts';
  const newPath = 'test/new-name.test.ts';
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@parallix.test']);
  git(root, ['config', 'user.name', 'Test']);
  git(root, ['config', 'core.hooksPath', '/dev/null']);
  fs.mkdirSync(path.join(root, 'test'), { recursive: true });
  fs.writeFileSync(path.join(root, oldPath), 'original\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'base']);
  git(root, ['checkout', '-q', '-b', 'mission/task-2627']);
  fs.renameSync(path.join(root, oldPath), path.join(root, newPath));
  if (withEdit) { fs.appendFileSync(path.join(root, newPath), 'edited\n'); }
  git(root, ['add', '-A']);
  git(root, ['commit', '-qm', 'rename payload']);
  git(root, ['checkout', '-q', 'main']);
  return { root, oldPath, newPath };
}

async function land(
  root: string,
  beforeStagedTreeRead?: () => void,
  tierGuards: { ok: boolean, error?: string } = { ok: true },
  failCleanup = false,
): Promise<void> {
  let stagedTreeRead = false;
  const { squashAndLand } = createSquashLanding({
    git: {
      git: (args: string[]) => {
        if (!stagedTreeRead && args.includes('ls-files') && args.includes('-s')) {
          stagedTreeRead = true;
          beforeStagedTreeRead?.();
        }
        if (failCleanup && args.includes('reset') && args.includes('--merge')) {
          return { status: 1, stdout: '', stderr: 'simulated cleanup failure' };
        }
        return gitRun(args);
      },
    },
    fileSystem: { existsSync: (target: string) => fs.existsSync(target) },
    backlog: { checkBacklogIntegrity: () => [] },
    missionPaths: { softResetTrailingBacklogNoise: () => false },
    productConfig: { isForgejoReviewEnabled: () => false },
    checkout: { maybeUpdateGraphifyOnPrimary: () => {} },
    gates: { isIntendedPayloadAtHead: () => false, runStagedTierGuards: () => tierGuards },
    landing: {
      createAbort: () => new Error('abort'),
      classifyHookFailure: () => ({ isHookFailure: false }),
      persistLandedIntegrationOrAbort: async () => {},
      closeLandedIntegrationOrAbort: async () => {},
      recordPostIntegrationStatsOrAbort: async () => {},
      cleanupMissionWorktree: () => true,
      runPostIntegrateHookOrAbort: () => {},
    },
    verification: { formatVerificationCommand: () => 'verify', captureVerifiedTreeProof: () => ({ ok: true, proof: {} }), assertVerifiedTreeProof: () => ({ ok: true }) },
  } as never, { promoteTaskForIntegrationIfNeeded: async () => {} });
  await squashAndLand({
    slug: 'task-2627', context: { area: 'all' },
    missionServices: { store: { load: async () => ({ kind: 'found', mission: { status: 'integration' } }) } },
    baseWorktree: root, baseBranch: 'main', seams: {}, state: { temporaryStash: null, nextActionMessage: null },
  } as never, { branch: 'mission/task-2627', summary: 'land', landedFromSha: 'base', mainTaskFile: path.join(root, 'absent-task.md') });
}

for (const withEdit of [false, true]) {
  test(`TASK-2627: squash landing removes the old path for a rename${withEdit ? ' with edits' : ''}`, async (t) => {
    for (const method of ['debug', 'pass', 'plain', 'fail', 'info'] as const) { t.mock.method(fmt.log, method, () => {}); }
    const { root, oldPath, newPath } = fixture(withEdit);
    try {
      await land(root);
      assert.notEqual(spawnSync('git', ['-C', root, 'cat-file', '-e', `HEAD:${oldPath}`]).status, 0, 'old path is absent from HEAD');
      assert.equal(git(root, ['show', `HEAD:${newPath}`]), withEdit ? 'original\nedited\n' : 'original\n', 'new path has the mission content');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
}

test('TASK-2627: landing aborts and names a staged payload path changed after the gated tip', async (t) => {
  for (const method of ['debug', 'pass', 'plain', 'info'] as const) { t.mock.method(fmt.log, method, () => {}); }
  const failures: string[] = [];
  t.mock.method(fmt.log, 'fail', (message: string) => { failures.push(String(message)); });
  const { root, newPath } = fixture(false);
  try {
    fs.writeFileSync(path.join(root, 'operator-note.txt'), 'retain exactly\n');
    await assert.rejects(
      () => land(root, () => { git(root, ['rm', '--cached', '--', newPath]); }),
      /abort/,
    );
    assert.ok(failures.some(message => message.includes(newPath)), `failure must name ${newPath}: ${JSON.stringify(failures)}`);
    assert.equal(git(root, ['rev-list', '--count', 'main']).trim(), '1', 'the mismatch aborts before a squash commit lands');
    assert.equal(fs.readFileSync(path.join(root, 'operator-note.txt'), 'utf8'), 'retain exactly\n', 'unrelated local edit is preserved byte-for-byte');
    assert.equal(git(root, ['status', '--porcelain']).trim(), '?? operator-note.txt', 'rejected squash leaves no abandoned tracked payload');
    await land(root);
    assert.equal(git(root, ['rev-list', '--count', 'main']).trim(), '2', 'the cleaned checkout permits retry');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('TASK-2627: a failed staged fast-tier guard aborts before the squash commit', async (t) => {
  for (const method of ['debug', 'pass', 'plain', 'info'] as const) { t.mock.method(fmt.log, method, () => {}); }
  const failures: string[] = [];
  t.mock.method(fmt.log, 'fail', (message: string) => { failures.push(String(message)); });
  const { root } = fixture(false);
  try {
    await assert.rejects(() => land(root, undefined, { ok: false, error: 'test-categories red' }), /abort/);
    assert.ok(failures.some(message => message.includes('test-categories red')), 'the fast-tier failure is reported');
    assert.equal(git(root, ['rev-list', '--count', 'main']).trim(), '1', 'the failed guard prevents a landed commit');
    assert.equal(git(root, ['status', '--porcelain']).trim(), '', 'failed guard removes the abandoned squash payload');
    await land(root);
    assert.equal(git(root, ['rev-list', '--count', 'main']).trim(), '2', 'the cleaned checkout permits retry');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('TASK-2630: rejected squash reports cleanup failure with retry guidance', async (t) => {
  for (const method of ['debug', 'pass', 'plain', 'info'] as const) { t.mock.method(fmt.log, method, () => {}); }
  const failures: string[] = [];
  t.mock.method(fmt.log, 'fail', (message: string) => { failures.push(String(message)); });
  const { root } = fixture(false);
  try {
    await assert.rejects(() => land(root, undefined, { ok: false, error: 'tier failed' }, true), /abort/);
    assert.ok(failures.some(message => message.includes('Could not clean up the rejected squash payload')),
      `cleanup failure gives actionable recovery: ${JSON.stringify(failures)}`);
    assert.ok(failures.some(message => message.includes(root)), 'recovery identifies the affected checkout');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
