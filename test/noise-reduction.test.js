const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { findLastNonNoiseCommit } = require('../lib/core/mission-utils');

function withTempRepo(fn) {
  const previous = process.cwd();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'noise-reduction-test-'));

  // Initialize git repo
  const { execSync } = require('child_process');
  execSync('git init', { cwd: root });
  execSync('git config user.email "test@example.com"', { cwd: root });
  execSync('git config user.name "Test User"', { cwd: root });

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
    const { execSync } = require('child_process');

    // 1. Initial commit (non-noise)
    fs.writeFileSync('README.md', '# Project\n');
    execSync('git add README.md', { cwd: root });
    execSync('git commit -m "initial commit"', { cwd: root });
    const initialSha = execSync('git rev-parse HEAD', { cwd: root }).toString().trim();

    // 2. Real work (non-noise)
    fs.writeFileSync('app.js', 'console.log("hello");\n');
    execSync('git add app.js', { cwd: root });
    execSync('git commit -m "mission: implement app"', { cwd: root });
    const workSha = execSync('git rev-parse HEAD', { cwd: root }).toString().trim();

    // 3. Backlog noise (noise)
    fs.mkdirSync('backlog/tasks', { recursive: true });
    fs.writeFileSync('backlog/tasks/task-1.md', 'status: backlog\n');
    execSync('git add backlog/', { cwd: root });
    execSync('git commit -m "backlog: add task 1"', { cwd: root });

    // 4. More backlog noise (noise)
    fs.writeFileSync('backlog/tasks/task-1.md', 'status: active\n');
    execSync('git add backlog/', { cwd: root });
    execSync('git commit -m "fixes"', { cwd: root });

    // HEAD should point to trailing noise, findLastNonNoiseCommit should return workSha
    const result = findLastNonNoiseCommit(root);
    assert.equal(execSync(`git rev-parse ${result}`, { cwd: root }).toString().trim(), workSha);
  });
});

test('findLastNonNoiseCommit identifies generic noise messages as noise when only touching backlog', () => {
  withTempRepo(root => {
    const { execSync } = require('child_process');

    fs.writeFileSync('README.md', '# Project\n');
    execSync('git add README.md', { cwd: root });
    execSync('git commit -m "initial commit"', { cwd: root });

    fs.writeFileSync('app.js', 'console.log("hello");\n');
    execSync('git add app.js', { cwd: root });
    execSync('git commit -m "mission: work"', { cwd: root });
    const workSha = execSync('git rev-parse HEAD', { cwd: root }).toString().trim();

    const noiseMessages = ['mission changes', 'random changes', 'new/updated mission', 'housekeeping', 'fixes'];
    for (const msg of noiseMessages) {
      fs.mkdirSync('backlog/tasks', { recursive: true });
      fs.writeFileSync(`backlog/tasks/task-${msg.replace(/\//g, '-')}.md`, 'status: backlog\n');
      execSync('git add backlog/', { cwd: root });
      execSync(`git commit -m "${msg}"`, { cwd: root });
    }

    const result = findLastNonNoiseCommit(root);
    assert.equal(execSync(`git rev-parse ${result}`, { cwd: root }).toString().trim(), workSha);
  });
});

test('findLastNonNoiseCommit identifies "fixes" with mission files as non-noise', () => {
  withTempRepo(root => {
    const { execSync } = require('child_process');

    fs.writeFileSync('README.md', '# Project\n');
    execSync('git add README.md', { cwd: root });
    execSync('git commit -m "initial commit"', { cwd: root });

    // Mixed commit (mission + backlog) with generic message "fixes"
    fs.writeFileSync('app.js', 'console.log("hello");\n');
    fs.mkdirSync('backlog/tasks', { recursive: true });
    fs.writeFileSync('backlog/tasks/task-1.md', 'status: active\n');
    execSync('git add .', { cwd: root });
    execSync('git commit -m "fixes"', { cwd: root });
    const mixedSha = execSync('git rev-parse HEAD', { cwd: root }).toString().trim();

    const result = findLastNonNoiseCommit(root);
    assert.equal(execSync(`git rev-parse ${result}`, { cwd: root }).toString().trim(), mixedSha);
  });
});

test('findLastNonNoiseCommit stops at branch-off points even if they are noise', () => {
  withTempRepo(root => {
    const { execSync } = require('child_process');
    const currentBranch = execSync('git symbolic-ref --short HEAD', { cwd: root }).toString().trim();

    // 1. Initial commit
    fs.writeFileSync('README.md', '# Project\n');
    execSync('git add README.md', { cwd: root });
    execSync('git commit -m "initial commit"', { cwd: root });

    // 2. Backlog noise (this will be our branch-off point)
    fs.mkdirSync('backlog/tasks', { recursive: true });
    fs.writeFileSync('backlog/tasks/task-1.md', 'status: backlog\n');
    execSync('git add backlog/', { cwd: root });
    execSync('git commit -m "backlog: add task 1"', { cwd: root });
    const noiseBranchOffSha = execSync('git rev-parse HEAD', { cwd: root }).toString().trim();

    // 3. Create a sibling branch at this noise commit
    execSync(`git branch sibling-branch ${noiseBranchOffSha}`, { cwd: root });

    // 4. Add more noise on current branch
    fs.writeFileSync('backlog/tasks/task-2.md', 'status: backlog\n');
    execSync('git add backlog/', { cwd: root });
    execSync('git commit -m "backlog: task 2"', { cwd: root });

    // 5. Advance sibling-branch so it is not just a tip at the branch-off point
    execSync('git checkout sibling-branch', { cwd: root });
    fs.writeFileSync('other.js', 'console.log("other");\n');
    execSync('git add other.js', { cwd: root });
    execSync('git commit -m "work on other branch"', { cwd: root });
    execSync(`git checkout ${currentBranch}`, { cwd: root });

    // findLastNonNoiseCommit must return null because noiseBranchOffSha is a branch-off
    // point that sibling-branch depends on — returning it would allow the squash path to
    // amend a commit another branch is based on, which is a shared-history violation.
    const result = findLastNonNoiseCommit(root);
    assert.equal(result, null);
  });
});

test('findLastNonNoiseCommit returns null if the non-noise commit is shared', () => {
  withTempRepo(root => {
    const { execSync } = require('child_process');

    // 1. Initial commit (pushed/shared)
    fs.writeFileSync('README.md', '# Project\n');
    execSync('git add README.md', { cwd: root });
    execSync('git commit -m "initial commit"', { cwd: root });
    const sharedSha = execSync('git rev-parse HEAD', { cwd: root }).toString().trim();
    // Simulate it being pushed
    execSync(`git update-ref refs/remotes/origin/main ${sharedSha}`, { cwd: root });

    // 2. Backlog noise (local)
    fs.mkdirSync('backlog/tasks', { recursive: true });
    fs.writeFileSync('backlog/tasks/task-1.md', 'status: backlog\n');
    execSync('git add backlog/', { cwd: root });
    execSync('git commit -m "backlog: add task 1"', { cwd: root });

    // findLastNonNoiseCommit would normally return sharedSha, but because it is shared, it should return null
    const result = findLastNonNoiseCommit(root);
    assert.equal(result, null);
  });
});

const { squashTrailingBacklogNoiseIntoPreviousMission, softResetTrailingBacklogNoise } = require('../lib/core/mission-utils');

test('squashTrailingBacklogNoiseIntoPreviousMission skips when worktree is dirty', () => {
  withTempRepo(root => {
    const { execSync } = require('child_process');

    // 1. Initial commit
    fs.writeFileSync('README.md', '# Project\n');
    execSync('git add README.md', { cwd: root });
    execSync('git commit -m "initial commit"', { cwd: root });
    const initialSha = execSync('git rev-parse HEAD', { cwd: root }).toString().trim();

    // 2. Backlog noise
    fs.mkdirSync('backlog/tasks', { recursive: true });
    fs.writeFileSync('backlog/tasks/task-1.md', 'status: backlog\n');
    execSync('git add backlog/', { cwd: root });
    execSync('git commit -m "backlog: add task 1"', { cwd: root });

    // 3. Make worktree dirty
    fs.writeFileSync('README.md', '# Project updated\n');

    // Should skip squash
    const result = squashTrailingBacklogNoiseIntoPreviousMission(root);
    assert.equal(result, false);

    // HEAD should still be the noise commit
    const headSha = execSync('git rev-parse HEAD', { cwd: root }).toString().trim();
    assert.notEqual(headSha, initialSha);
  });
});

test('squashTrailingBacklogNoiseIntoPreviousMission skips when index is dirty', () => {
  withTempRepo(root => {
    const { execSync } = require('child_process');

    // 1. Initial commit
    fs.writeFileSync('README.md', '# Project\n');
    execSync('git add README.md', { cwd: root });
    execSync('git commit -m "initial commit"', { cwd: root });

    // 2. Backlog noise
    fs.mkdirSync('backlog/tasks', { recursive: true });
    fs.writeFileSync('backlog/tasks/task-1.md', 'status: backlog\n');
    execSync('git add backlog/', { cwd: root });
    execSync('git commit -m "backlog: add task 1"', { cwd: root });

    // 3. Stage an unrelated change
    fs.writeFileSync('unrelated.txt', 'dirty\n');
    execSync('git add unrelated.txt', { cwd: root });

    // Should skip squash
    const result = squashTrailingBacklogNoiseIntoPreviousMission(root);
    assert.equal(result, false);
  });
});

test('softResetTrailingBacklogNoise skips when worktree is dirty', () => {
  withTempRepo(root => {
    const { execSync } = require('child_process');

    // 1. Initial commit
    fs.writeFileSync('README.md', '# Project\n');
    execSync('git add README.md', { cwd: root });
    execSync('git commit -m "initial commit"', { cwd: root });

    // 2. Backlog noise
    fs.mkdirSync('backlog/tasks', { recursive: true });
    fs.writeFileSync('backlog/tasks/task-1.md', 'status: backlog\n');
    execSync('git add backlog/', { cwd: root });
    execSync('git commit -m "backlog: add task 1"', { cwd: root });

    // 3. Make worktree dirty
    fs.writeFileSync('README.md', '# Project updated\n');

    // Should skip reset
    const result = softResetTrailingBacklogNoise(root);
    assert.equal(result, false);
  });
});

test('squashTrailingBacklogNoiseIntoPreviousMission succeeds when clean', () => {
  withTempRepo(root => {
    const { execSync } = require('child_process');

    // 1. Initial commit
    fs.writeFileSync('README.md', '# Project\n');
    execSync('git add README.md', { cwd: root });
    execSync('git commit -m "initial commit"', { cwd: root });
    const initialSha = execSync('git rev-parse HEAD', { cwd: root }).toString().trim();

    // 2. Backlog noise
    fs.mkdirSync('backlog/tasks', { recursive: true });
    fs.writeFileSync('backlog/tasks/task-1.md', 'status: backlog\n');
    execSync('git add backlog/', { cwd: root });
    execSync('git commit -m "backlog: add task 1"', { cwd: root });

    // Should succeed
    const result = squashTrailingBacklogNoiseIntoPreviousMission(root);
    assert.equal(result, true);

    // HEAD should now be a NEW commit that is an amendment of initial commit (so not equal to initialSha but containing its work)
    const headSha = execSync('git rev-parse HEAD', { cwd: root }).toString().trim();
    assert.notEqual(headSha, initialSha);
    // The amended commit should contain the backlog noise file in its index (staged)
    const filesInCommit = execSync('git ls-tree -r HEAD --name-only', { cwd: root }).toString();
    assert.ok(filesInCommit.includes('backlog/tasks/task-1.md'));
  });
});
