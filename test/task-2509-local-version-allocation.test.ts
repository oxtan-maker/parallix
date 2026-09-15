import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');

// Runs the real bump script against a throwaway repo: branch `main` models the
// primary branch and a commit on `mission/task-2509` models the rebased mission.
function allocateInTempRepo(baseVersion: string, missionVersion = baseVersion) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'task-2509-allocation-'));
  const git = (...args: string[]) => {
    const result = childProcess.spawnSync('git', ['-c', 'user.email=test@example.com', '-c', 'user.name=Test', ...args], { cwd: repo, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const writeVersion = (version: string) => {
    fs.writeFileSync(path.join(repo, 'package.json'), `${JSON.stringify({ version }, null, 2)}\n`);
    fs.writeFileSync(path.join(repo, 'package-lock.json'), `${JSON.stringify({ version, packages: { '': { version } } }, null, 2)}\n`);
  };
  try {
    git('init', '--initial-branch=main');
    writeVersion(baseVersion);
    git('add', '.');
    git('commit', '-m', 'base');
    git('checkout', '-b', 'mission/task-2509');
    fs.writeFileSync(path.join(repo, 'feature.txt'), 'implementation\n');
    writeVersion(missionVersion);
    git('add', '.');
    git('commit', '-m', 'mission implementation');
    // The script resolves the repository from its own location, as it does when
    // integrate runs ./scripts/bump-version.sh inside the mission worktree.
    fs.mkdirSync(path.join(repo, 'scripts'));
    fs.copyFileSync(path.join(root, 'scripts/bump-version.sh'), path.join(repo, 'scripts/bump-version.sh'));
    childProcess.execFileSync('bash', ['scripts/bump-version.sh'], { cwd: repo, env: { ...process.env, INTEGRATE_HOOK_BASE_BRANCH: 'main' } });
    // Model the integrate squash: the mission's changes land as one commit on main.
    git('add', 'package.json', 'package-lock.json');
    git('commit', '--allow-empty', '-m', 'hook');
    git('checkout', 'main');
    git('merge', '--squash', 'mission/task-2509');
    git('commit', '-m', 'mission/task-2509: task-2509');
    return {
      commits: git('rev-list', '--count', 'main'),
      landedFiles: git('show', '--format=', '--name-only', 'main').split('\n'),
      subjects: git('log', '--format=%s', 'main'),
      manifest: JSON.parse(git('show', 'main:package.json')).version,
      lockfile: JSON.parse(git('show', 'main:package-lock.json')),
    };
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
}

test('task-2509: local allocation lands matching package metadata in the one mission commit', () => {
  const landed = allocateInTempRepo('1.5.119');
  assert.equal(landed.commits, '2');
  assert.deepEqual(landed.landedFiles, ['feature.txt', 'package-lock.json', 'package.json']);
  assert.doesNotMatch(landed.subjects, /chore: bump version/);
  assert.equal(landed.manifest, '1.5.120');
  assert.equal(landed.lockfile.version, '1.5.120');
  assert.equal(landed.lockfile.packages[''].version, '1.5.120');
});

test('task-2509: local allocation never moves a stale mission version backwards', () => {
  const landed = allocateInTempRepo('1.5.121', '1.5.100');
  assert.equal(landed.manifest, '1.5.122');
  assert.equal(landed.lockfile.version, '1.5.122');
});

test('task-2509: local allocation keeps a newer version already allocated by a retried integration', () => {
  const landed = allocateInTempRepo('1.5.121', '1.5.122');
  assert.equal(landed.manifest, '1.5.122');
});
