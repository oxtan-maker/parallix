const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { findLastNonNoiseCommit } = require('../lib/core/mission-utils');

function git(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.error && !(result.error.code === 'EPERM' && result.status === 0)) {
    throw result.error;
  }
  assert.equal(result.status, 0, `git ${args.join(' ')}\n${result.stderr}${result.stdout}`);
  return result.stdout || '';
}

function withTempRepo(fn) {
  const previous = process.cwd();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noise-reduction-test-'));

  // Initialize git repo
  git(['init'], root);
  git(['config', 'user.email', 'test@example.com'], root);
  git(['config', 'user.name', 'Test User'], root);

  process.chdir(root);

  try {
    fn(root);
  } finally {
    process.chdir(previous);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('findLastNonNoiseCommit identifies non-noise commits correctly', () => {
  withTempRepo(root => {
    // 1. Initial commit (non-noise)
    fs.writeFileSync('README.md', '# Project\n');
    git(['add', 'README.md'], root);
    git(['commit', '-m', 'initial commit'], root);
    const initialSha = git(['rev-parse', 'HEAD'], root).trim();

    // 2. Real work (non-noise)
    fs.writeFileSync('app.js', 'console.log("hello");\n');
    git(['add', 'app.js'], root);
    git(['commit', '-m', 'mission: implement app'], root);
    const workSha = git(['rev-parse', 'HEAD'], root).trim();

    // 3. Backlog noise (noise)
    fs.mkdirSync('backlog/tasks', { recursive: true });
    fs.writeFileSync('backlog/tasks/task-1.md', 'status: backlog\n');
    git(['add', 'backlog/'], root);
    git(['commit', '-m', 'backlog: add task 1'], root);

    // 4. More backlog noise (noise)
    fs.writeFileSync('backlog/tasks/task-1.md', 'status: active\n');
    git(['add', 'backlog/'], root);
    git(['commit', '-m', 'fixes'], root);

    // HEAD should point to trailing noise, findLastNonNoiseCommit should return workSha
    const result = findLastNonNoiseCommit(root);
    assert.equal(git(['rev-parse', result], root).trim(), workSha);
  });
});

test('findLastNonNoiseCommit identifies generic noise messages as noise when only touching backlog', () => {
  withTempRepo(root => {
    fs.writeFileSync('README.md', '# Project\n');
    git(['add', 'README.md'], root);
    git(['commit', '-m', 'initial commit'], root);

    fs.writeFileSync('app.js', 'console.log("hello");\n');
    git(['add', 'app.js'], root);
    git(['commit', '-m', 'mission: work'], root);
    const workSha = git(['rev-parse', 'HEAD'], root).trim();

    const noiseMessages = ['mission changes', 'random changes', 'new/updated mission', 'housekeeping', 'fixes'];
    for (const msg of noiseMessages) {
      fs.mkdirSync('backlog/tasks', { recursive: true });
      fs.writeFileSync(`backlog/tasks/task-${msg.replace(/\//g, '-')}.md`, 'status: backlog\n');
      git(['add', 'backlog/'], root);
      git(['commit', '-m', msg], root);
    }

    const result = findLastNonNoiseCommit(root);
    assert.equal(git(['rev-parse', result], root).trim(), workSha);
  });
});

test('findLastNonNoiseCommit identifies "fixes" with mission files as non-noise', () => {
  withTempRepo(root => {
    fs.writeFileSync('README.md', '# Project\n');
    git(['add', 'README.md'], root);
    git(['commit', '-m', 'initial commit'], root);

    // Mixed commit (mission + backlog) with generic message "fixes"
    fs.writeFileSync('app.js', 'console.log("hello");\n');
    fs.mkdirSync('backlog/tasks', { recursive: true });
    fs.writeFileSync('backlog/tasks/task-1.md', 'status: active\n');
    git(['add', '.'], root);
    git(['commit', '-m', 'fixes'], root);
    const mixedSha = git(['rev-parse', 'HEAD'], root).trim();

    const result = findLastNonNoiseCommit(root);
    assert.equal(git(['rev-parse', result], root).trim(), mixedSha);
  });
});

test('findLastNonNoiseCommit stops at branch-off points even if they are noise', () => {
  withTempRepo(root => {
    const currentBranch = git(['symbolic-ref', '--short', 'HEAD'], root).trim();

    // 1. Initial commit
    fs.writeFileSync('README.md', '# Project\n');
    git(['add', 'README.md'], root);
    git(['commit', '-m', 'initial commit'], root);

    // 2. Backlog noise (this will be our branch-off point)
    fs.mkdirSync('backlog/tasks', { recursive: true });
    fs.writeFileSync('backlog/tasks/task-1.md', 'status: backlog\n');
    git(['add', 'backlog/'], root);
    git(['commit', '-m', 'backlog: add task 1'], root);
    const noiseBranchOffSha = git(['rev-parse', 'HEAD'], root).trim();

    // 3. Create a sibling branch at this noise commit
    git(['branch', 'sibling-branch', noiseBranchOffSha], root);

    // 4. Add more noise on current branch
    fs.writeFileSync('backlog/tasks/task-2.md', 'status: backlog\n');
    git(['add', 'backlog/'], root);
    git(['commit', '-m', 'backlog: task 2'], root);

    // 5. Advance sibling-branch so it is not just a tip at the branch-off point
    git(['checkout', 'sibling-branch'], root);
    fs.writeFileSync('other.js', 'console.log("other");\n');
    git(['add', 'other.js'], root);
    git(['commit', '-m', 'work on other branch'], root);
    git(['checkout', currentBranch], root);

    // findLastNonNoiseCommit must return null because noiseBranchOffSha is a branch-off
    // point that sibling-branch depends on — returning it would allow the squash path to
    // amend a commit another branch is based on, which is a shared-history violation.
    const result = findLastNonNoiseCommit(root);
    assert.equal(result, null);
  });
});

test('findLastNonNoiseCommit returns null if the non-noise commit is shared', () => {
  withTempRepo(root => {
    // 1. Initial commit (pushed/shared)
    fs.writeFileSync('README.md', '# Project\n');
    git(['add', 'README.md'], root);
    git(['commit', '-m', 'initial commit'], root);
    const sharedSha = git(['rev-parse', 'HEAD'], root).trim();
    // Simulate it being pushed
    git(['update-ref', 'refs/remotes/origin/main', sharedSha], root);

    // 2. Backlog noise (local)
    fs.mkdirSync('backlog/tasks', { recursive: true });
    fs.writeFileSync('backlog/tasks/task-1.md', 'status: backlog\n');
    git(['add', 'backlog/'], root);
    git(['commit', '-m', 'backlog: add task 1'], root);

    // findLastNonNoiseCommit would normally return sharedSha, but because it is shared, it should return null
    const result = findLastNonNoiseCommit(root);
    assert.equal(result, null);
  });
});

const { squashTrailingBacklogNoiseIntoPreviousMission, softResetTrailingBacklogNoise } = require('../lib/core/mission-utils');

test('squashTrailingBacklogNoiseIntoPreviousMission skips when worktree is dirty', () => {
  withTempRepo(root => {
    // 1. Initial commit
    fs.writeFileSync('README.md', '# Project\n');
    git(['add', 'README.md'], root);
    git(['commit', '-m', 'initial commit'], root);
    const initialSha = git(['rev-parse', 'HEAD'], root).trim();

    // 2. Backlog noise
    fs.mkdirSync('backlog/tasks', { recursive: true });
    fs.writeFileSync('backlog/tasks/task-1.md', 'status: backlog\n');
    git(['add', 'backlog/'], root);
    git(['commit', '-m', 'backlog: add task 1'], root);

    // 3. Make worktree dirty
    fs.writeFileSync('README.md', '# Project updated\n');

    // Should skip squash
    const result = squashTrailingBacklogNoiseIntoPreviousMission(root);
    assert.equal(result, false);

    // HEAD should still be the noise commit
    const headSha = git(['rev-parse', 'HEAD'], root).trim();
    assert.notEqual(headSha, initialSha);
  });
});

test('squashTrailingBacklogNoiseIntoPreviousMission skips when index is dirty', () => {
  withTempRepo(root => {
    // 1. Initial commit
    fs.writeFileSync('README.md', '# Project\n');
    git(['add', 'README.md'], root);
    git(['commit', '-m', 'initial commit'], root);

    // 2. Backlog noise
    fs.mkdirSync('backlog/tasks', { recursive: true });
    fs.writeFileSync('backlog/tasks/task-1.md', 'status: backlog\n');
    git(['add', 'backlog/'], root);
    git(['commit', '-m', 'backlog: add task 1'], root);

    // 3. Stage an unrelated change
    fs.writeFileSync('unrelated.txt', 'dirty\n');
    git(['add', 'unrelated.txt'], root);

    // Should skip squash
    const result = squashTrailingBacklogNoiseIntoPreviousMission(root);
    assert.equal(result, false);
  });
});

test('softResetTrailingBacklogNoise skips when worktree is dirty', () => {
  withTempRepo(root => {
    // 1. Initial commit
    fs.writeFileSync('README.md', '# Project\n');
    git(['add', 'README.md'], root);
    git(['commit', '-m', 'initial commit'], root);

    // 2. Backlog noise
    fs.mkdirSync('backlog/tasks', { recursive: true });
    fs.writeFileSync('backlog/tasks/task-1.md', 'status: backlog\n');
    git(['add', 'backlog/'], root);
    git(['commit', '-m', 'backlog: add task 1'], root);

    // 3. Make worktree dirty
    fs.writeFileSync('README.md', '# Project updated\n');

    // Should skip reset
    const result = softResetTrailingBacklogNoise(root);
    assert.equal(result, false);
  });
});

test('squashTrailingBacklogNoiseIntoPreviousMission succeeds when clean', () => {
  withTempRepo(root => {
    // 1. Initial commit
    fs.writeFileSync('README.md', '# Project\n');
    git(['add', 'README.md'], root);
    git(['commit', '-m', 'initial commit'], root);
    const initialSha = git(['rev-parse', 'HEAD'], root).trim();

    // 2. Backlog noise
    fs.mkdirSync('backlog/tasks', { recursive: true });
    fs.writeFileSync('backlog/tasks/task-1.md', 'status: backlog\n');
    git(['add', 'backlog/'], root);
    git(['commit', '-m', 'backlog: add task 1'], root);

    // Should succeed
    const result = squashTrailingBacklogNoiseIntoPreviousMission(root);
    assert.equal(result, true);

    // HEAD should now be a NEW commit that is an amendment of initial commit (so not equal to initialSha but containing its work)
    const headSha = git(['rev-parse', 'HEAD'], root).trim();
    assert.notEqual(headSha, initialSha);
    // The amended commit should contain the backlog noise file in its index (staged)
    const filesInCommit = git(['ls-tree', '-r', 'HEAD', '--name-only'], root);
    assert.ok(filesInCommit.includes('backlog/tasks/task-1.md'));
  });
});
